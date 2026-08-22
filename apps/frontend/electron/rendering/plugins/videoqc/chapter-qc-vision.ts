/**
 * L5 视觉审计层(08-22-video-use-vision-release R2)。
 *
 * 确定性部分(主进程即时):
 *   - 转场密度闸:08-22 用户裁定「任意连续 5 个镜头边界内不得出现同款转场」,
 *     对渲染计划里的最终转场序列复检(决策层已在源头钳制;此处对实际渲染
 *     结果防御性复检,捕捉手编/回写/旧计划漂移)。
 * 模型判读部分(物料化):
 *   - 按压缩时间轴镜中点+每边界 pre/blend/post 抽帧到报告目录,登记进
 *     report.vision.frames;渲染端 runner(图像理解绑定,L4 同款)消费。
 *
 * 失败语义:单帧抽取失败跳过计入 frameErrors;密度闸是纯计算不会 throw;
 * 层状态由编排器根据物料与检查结果落 passed/skipped/failed。
 */

import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  createTransitionDiversityTracker,
  TRANSITION_SAME_EFFECT_MIN_BOUNDARY_GAP,
} from "@/lib/studio/editing/transition-policy";
import type {
  ChapterQcFindingV1,
  ChapterQcVisionDecisionV1,
  ChapterQcVisionFrameKind,
} from "./chapter-qc-types";
import type { ChapterQcRenderPlanSpans } from "./chapter-qc-timeline";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";
import { resolveQcFfTool, type QcCommandRunner } from "./chapter-qc-fftools";

const execFileAsync = promisify(execFile);

const defaultVisionRunner: QcCommandRunner = (file, args) =>
  execFileAsync(file, args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });

export interface ChapterQcVisionLayerInput {
  projectId: string;
  chapterId: string;
  videoPath: string;
  /** 压缩时间轴镜区间(buildShotSpansFromRenderPlan 产物) */
  spans: ChapterQcShotSpan[];
  /** render-plan 最终转场(非 cut) */
  transitions: Array<{ fromClipId: string; toClipId: string; effectId: string; durationUs: number }>;
  /** 视觉 clip 顺序(clipId→ordinal,密度闸的边界编号) */
  visualClipIds: string[];
  /** 报告目录(chapterQcReportDir),帧落 <dir>/vision-frames/ */
  reportDir: string;
  runner?: QcCommandRunner;
  now?: () => number;
}

export interface ChapterQcVisionFrameRecord {
  shotId: string;
  ordinal: number;
  kind: ChapterQcVisionFrameKind;
  tS: number;
  frameUrl: string;
}

export interface ChapterQcVisionLayerOutput {
  findings: ChapterQcFindingV1[];
  frames: ChapterQcVisionFrameRecord[];
  densityChecked: number;
  frameErrors: number;
}

/** 密度闸:同 effectId 边界间距 < 5 → warn(每处违反一条,定位出镜 ordinal)。 */
export function checkTransitionDensity(
  transitions: ChapterQcVisionLayerInput["transitions"],
  visualClipIds: readonly string[],
): { findings: ChapterQcFindingV1[]; checked: number } {
  const ordinalByClipId = new Map(visualClipIds.map((clipId, index) => [clipId, index + 1]));
  const tracker = createTransitionDiversityTracker();
  const findings: ChapterQcFindingV1[] = [];
  for (const transition of transitions) {
    const ordinal = ordinalByClipId.get(transition.fromClipId);
    if (!ordinal) continue;
    if (!tracker.allows(transition.effectId, ordinal)) {
      findings.push({
        code: "chapter-qc.vision.transition-density",
        layer: "vision",
        severity: "warn",
        shotOrdinal: ordinal,
        message: `第 ${ordinal} 镜出镜转场 ${transition.effectId} 与前 ${TRANSITION_SAME_EFFECT_MIN_BOUNDARY_GAP - 1} 个边界内同款重复(08-22 密度裁定)`,
        evidence: { effectId: transition.effectId, ordinal, minBoundaryGap: TRANSITION_SAME_EFFECT_MIN_BOUNDARY_GAP },
      });
      continue;
    }
    tracker.record(transition.effectId, ordinal);
  }
  return { findings, checked: transitions.length };
}

export interface ChapterQcVisionSamplePoint {
  tS: number;
  shotId: string;
  ordinal: number;
  kind: ChapterQcVisionFrameKind;
}

/** 抽帧点:每镜 mid;相邻镜边界 pre/blend/post(全部由压缩 spans 推导)。 */
export function visionSamplePoints(
  spans: readonly ChapterQcShotSpan[],
): ChapterQcVisionSamplePoint[] {
  const points: ChapterQcVisionSamplePoint[] = [];
  const push = (tS: number, span: ChapterQcShotSpan, kind: ChapterQcVisionFrameKind) => {
    if (tS > span.startS + 0.05 && tS < span.endS - 0.05) {
      points.push({ tS: Math.round(tS * 1000) / 1000, shotId: span.shotId, ordinal: span.ordinal, kind });
    }
  };
  spans.forEach((span, index) => {
    push(span.startS + span.durationS / 2, span, "mid");
    const next = spans[index + 1];
    if (!next) return;
    // 压缩模型:转场窗 = [next.startS, span.endS](重叠段)
    push(span.endS - 0.35, span, "pre");
    push((next.startS + span.endS) / 2, span, "blend");
    push(span.endS + 0.25, next, "post");
  });
  return points;
}

export function buildVisionDecisions(input: {
  spans: readonly ChapterQcShotSpan[];
  visualClipIds: readonly string[];
  descriptionsByShotId: ReadonlyMap<string, string>;
  transitions: ChapterQcRenderPlanSpans["transitions"];
  effects: ChapterQcRenderPlanSpans["effects"];
}): ChapterQcVisionDecisionV1[] {
  const spanByClipId = new Map(
    input.visualClipIds.map((clipId, index) => [clipId, input.spans[index]] as const),
  );
  const transitionByClipId = new Map(input.transitions.map((transition) => [transition.fromClipId, transition]));
  const effectsByClipId = new Map<string, ChapterQcVisionDecisionV1["effects"]>();
  for (const effect of input.effects) {
    const current = effectsByClipId.get(effect.targetClipId) ?? [];
    current.push({ effectId: effect.effectId, ...(effect.template ? { template: effect.template } : {}) });
    effectsByClipId.set(effect.targetClipId, current);
  }
  return input.visualClipIds.flatMap((clipId) => {
    const span = spanByClipId.get(clipId);
    if (!span) return [];
    const transition = transitionByClipId.get(clipId);
    const nextSpan = transition ? spanByClipId.get(transition.toClipId) : undefined;
    return [{
      shotId: span.shotId,
      ordinal: span.ordinal,
      ...(input.descriptionsByShotId.get(span.shotId)
        ? { description: input.descriptionsByShotId.get(span.shotId) }
        : {}),
      effects: effectsByClipId.get(clipId) ?? [],
      ...(transition && nextSpan
        ? {
            outgoingTransition: {
              toShotId: nextSpan.shotId,
              toOrdinal: nextSpan.ordinal,
              effectId: transition.effectId,
              durationS: transition.durationUs / 1e6,
            },
          }
        : {}),
    }];
  });
}

export async function runVisionLayer(input: ChapterQcVisionLayerInput): Promise<ChapterQcVisionLayerOutput> {
  const runner = input.runner ?? defaultVisionRunner;
  const { findings, checked } = checkTransitionDensity(input.transitions, input.visualClipIds);

  const framesDir = path.join(input.reportDir, "vision-frames");
  await fs.promises.mkdir(framesDir, { recursive: true });
  const tool = resolveQcFfTool("ffmpeg");
  const frames: ChapterQcVisionFrameRecord[] = [];
  let frameErrors = 0;
  for (const point of visionSamplePoints(input.spans)) {
    const fileName = `vis-${String(point.ordinal).padStart(3, "0")}-${point.kind}-t${point.tS.toFixed(1)}.jpg`;
    const framePath = path.join(framesDir, fileName);
    try {
      await runner(tool, [
        "-y", "-ss", point.tS.toFixed(3), "-i", input.videoPath,
        "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "3",
        framePath,
      ]);
      frames.push({
        shotId: point.shotId,
        ordinal: point.ordinal,
        kind: point.kind,
        tS: point.tS,
        frameUrl: `project-file://${input.projectId}/remotion/qc/chapters/${input.chapterId}/vision-frames/${fileName}`,
      });
    } catch {
      frameErrors += 1; // 单帧跳过,不整体失败
    }
  }
  return { findings, frames, densityChecked: checked, frameErrors };
}
