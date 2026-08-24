/**
 * 章节成片 QC 编排器(08-19-chapter-video-qc parent 集成件)。
 *
 * L1 结构比对 → L2 ffmpeg 逐帧 → L3 DOVER 观感(skip-able)→ L4 语义(留 pending
 * 给渲染端)。fire-and-forget:任何一层失败只进报告,不向调用方(渲染队列)抛错。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readStudioWorkflowStore } from "../../../storage/studio-workflow-store-io";
import { createProjectFileUrl } from "../../../storage/storage-paths";
import { readLatestVideoWorkflowChapterArtifacts } from "../video-workflow/video-workflow-artifact-store";
import type { VideoUseEdlEntryV1, VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import type { VideoQcRuntimeController } from "./dover-runtime-controller";
import { extractShotKeyframes } from "./chapter-qc-fftools";
import { runFfmpegScanLayer } from "./chapter-qc-ffmpeg-scan";
import { readChapterQcReport, writeChapterQcReport, chapterQcReportDir } from "./chapter-qc-report-store";
import { runStructuralLayer } from "./chapter-qc-structural";
import { buildShotSpans, buildShotSpansFromRenderPlan, type ChapterQcRenderPlanSpans } from "./chapter-qc-timeline";
import { buildVisionDecisions, runVisionLayer } from "./chapter-qc-vision";
import type { ChapterQcVisionResultV1 } from "./chapter-qc-types";
import {
  CHAPTER_QC_SCHEMA_VERSION,
  summarizeChapterQcFindings,
  type ChapterQcFindingV1,
  type ChapterQcLayerResultV1,
  type ChapterQcReportV1,
} from "./chapter-qc-types";

export interface ChapterQcOrchestratorDeps {
  /** remotion 工作区根:<projectRoot>/remotion */
  remotionWorkspaceRootForProject: (projectId: string) => string;
  /** video-use 工件根:<projectRoot>/video-use */
  videoUseWorkspaceRootForProject: (projectId: string) => string;
  /** 项目数据根(getDataDir()),readStudioWorkflowStore 用 */
  dataRoot: string;
  /** L3 控制器;缺省=观感层 skipped-no-controller */
  videoQc?: Pick<VideoQcRuntimeController, "runVideoQcScore" | "readBaselines" | "status">;
  now?: () => number;
}

export interface ChapterQcRunInput {
  projectId: string;
  chapterId: string;
  /** 成片绝对路径;缺省按 slot 约定 outputs/chapters/{chapterId}/current.mp4 */
  outputPath?: string;
}

interface StoryboardLike {
  episodeId?: string;
  duration?: number;
  durationTarget?: number;
  ttsSpokenText?: string;
  shotAudioBindings?: Array<{ role?: string; sourceDurationUs?: number }>;
}

interface AgentWorkLike {
  key?: string;
  episodeId?: string;
  data?: unknown;
  updatedAt?: number;
}

function sha256File(filePath: string): string {
  const digest = createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return digest.digest("hex");
}

function latestScriptDraft(agentWork: unknown, chapterId: string): string | undefined {
  if (!Array.isArray(agentWork)) return undefined;
  const entries = agentWork
    .filter((entry): entry is AgentWorkLike =>
      typeof entry === "object" && entry !== null && entry.key === "scriptDraft")
    .filter((entry) => typeof entry.data === "string" && (entry.data as string).trim().length > 0)
    // scriptDraft 优先本章,退而取最新(章节级工作数据缺省时兜底)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const chapterScoped = entries.find((entry) => entry.episodeId === chapterId);
  const chosen = chapterScoped ?? entries[0];
  return typeof chosen?.data === "string" ? chosen.data : undefined;
}

/** 观感层基线告警:偏离 mean - max(2σ, 0.05) 报 warn;无基线只记录。 */
function evaluateAestheticAgainstBaseline(
  controller: ChapterQcOrchestratorDeps["videoQc"],
  seriesId: string,
  fused: number,
): { baseline?: NonNullable<ChapterQcReportV1["aesthetic"]>["baseline"]; finding?: ChapterQcFindingV1 } {
  const baselines = controller?.readBaselines() ?? {};
  const baseline = baselines[seriesId] ?? baselines["default"];
  if (!baseline || baseline.sampleCount < 2) return {};
  const threshold = baseline.meanFused - Math.max(2 * baseline.sigma, 0.05);
  if (fused < threshold) {
    return {
      baseline,
      finding: {
        code: "chapter-qc.aesthetic.below-baseline",
        layer: "aesthetic",
        severity: "warn",
        message: `观感总分 ${fused.toFixed(3)} 低于系列基线 ${baseline.meanFused.toFixed(3)}(阈值 ${threshold.toFixed(3)})`,
        evidence: { fused, meanFused: baseline.meanFused, sigma: baseline.sigma, seriesId: baseline.seriesId },
      },
    };
  }
  return { baseline };
}

export async function runChapterQc(
  deps: ChapterQcOrchestratorDeps,
  input: ChapterQcRunInput,
): Promise<ChapterQcReportV1 | null> {
  const now = deps.now ?? Date.now;
  const workspaceRoot = deps.remotionWorkspaceRootForProject(input.projectId);
  const outputPath =
    input.outputPath ?? path.join(workspaceRoot, "outputs", "chapters", input.chapterId, "current.mp4");
  if (!fs.existsSync(outputPath)) return null;

  const layers: Record<string, ChapterQcLayerResultV1> = {
    structural: { status: "running", startedAt: now() },
    ffmpegScan: { status: "pending" },
    aesthetic: { status: "pending" },
    semantic: { status: "pending" },
    vision: { status: "pending" },
  };
  const findings: ChapterQcFindingV1[] = [];
  const notes: string[] = [];

  // ---- 上下文组装 ----
  let edl: VideoUseEdlEntryV1[] = [];
  let cues: VideoUseSubtitleCueV1[] = [];
  try {
    const artifacts = await readLatestVideoWorkflowChapterArtifacts(
      deps.videoUseWorkspaceRootForProject,
      { projectId: input.projectId, chapterId: input.chapterId },
    );
    if (artifacts.success && artifacts.value?.artifacts.videoUseArtifact) {
      edl = artifacts.value.artifacts.videoUseArtifact.edl ?? [];
      cues = artifacts.value.artifacts.videoUseArtifact.subtitles ?? [];
    } else if (!artifacts.success) {
      notes.push("video-use 工件读取失败");
    }
  } catch (error) {
    notes.push(`video-use 工件读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }

  let plannedVoiceDurationUs: number | undefined;
  let scriptText: string | undefined;
  const descriptionByShotId = new Map<string, string>();
  try {
    const store = readStudioWorkflowStore(deps.dataRoot, input.projectId);
    if (store) {
      const storyboards = Array.isArray(store.state.storyboards)
        ? (store.state.storyboards as Array<StoryboardLike & { id?: string; videoDesc?: string; prompt?: string }>)
        : [];
      const chapterStoryboards = storyboards.filter((item) => item.episodeId === input.chapterId);
      plannedVoiceDurationUs = chapterStoryboards.reduce(
        (sum, item) =>
          sum + (item.shotAudioBindings ?? [])
            .filter((binding) => binding.role === "voice")
            .reduce((inner, binding) => inner + (binding.sourceDurationUs ?? 0), 0),
        0,
      );
      for (const item of chapterStoryboards) {
        if (typeof item.id === "string") {
          const description = item.videoDesc?.trim() || item.prompt?.trim() || item.ttsSpokenText?.trim();
          if (description) descriptionByShotId.set(item.id, description);
        }
      }
      scriptText = latestScriptDraft(store.state.agentWorkData, input.chapterId);
    } else {
      notes.push("no-workflow-store");
    }
  } catch (error) {
    notes.push(`workflow store 读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ---- 镜区间:render-plan(压缩时间轴权威)优先,artifact EDL 兜底 ----
  // artifact timelineStartS 是未压缩口径(2026-08-22 审计:43 镜 174.9s vs
  // 成片 145.1s,尾段漂移 ~30s),只在没有渲染计划时退回并留痕。
  let renderPlanSpans: ChapterQcRenderPlanSpans | null = null;
  try {
    const planPath = path.join(workspaceRoot, "jobs", "chapter", input.chapterId, "current-render-plan.json");
    if (fs.existsSync(planPath)) {
      renderPlanSpans = buildShotSpansFromRenderPlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
      if (!renderPlanSpans) notes.push("render-plan 形状不完整,镜区间退回 artifact EDL 口径");
    } else {
      notes.push("render-plan 缺失,镜区间退回 artifact EDL 口径(未压缩,镜归因可能漂移)");
    }
  } catch (error) {
    notes.push(`render-plan 读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }
  const spans = renderPlanSpans ? renderPlanSpans.spans : buildShotSpans(edl);

  // ---- L1 结构比对 ----
  let probeDurationS: number | undefined;
  try {
    const structural = await runStructuralLayer({
      videoPath: outputPath,
      spans,
      cues,
      scriptText,
      plannedVoiceDurationUs,
    });
    findings.push(...structural.findings);
    notes.push(...structural.notes);
    probeDurationS = structural.probe?.durationS;
    layers.structural = { status: structural.findings.some((f) => f.severity === "blocker") ? "failed" : "passed", finishedAt: now() };
  } catch (error) {
    layers.structural = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
  }

  const structuralBlocked = layers.structural.status === "failed";

  // ---- 代表帧提取(L4 消费;L1 过了才抽,省 CPU) ----
  let extractedFrames: Array<{ shotId: string; ordinal: number; framePath: string }> = [];
  if (!structuralBlocked && spans.length > 0) {
    const framesDir = path.join(chapterQcReportDir(workspaceRoot, input.chapterId), "frames");
    try {
      const extraction = await extractShotKeyframes({ videoPath: outputPath, spans, outDir: framesDir });
      extractedFrames = extraction.frames;
      if (extraction.errors.length > 0) {
        notes.push(`代表帧提取失败 ${extraction.errors.length}/${spans.length} 镜`);
      }
    } catch (error) {
      notes.push(`代表帧提取异常: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- L2 ffmpeg 逐帧 ----
  if (structuralBlocked) {
    layers.ffmpegScan = { status: "skipped", reason: "structural blocker 短路" };
  } else {
    try {
      const scan = await runFfmpegScanLayer({
        videoPath: outputPath,
        spans,
        durationS: probeDurationS,
        plannedVoiceS: plannedVoiceDurationUs ? plannedVoiceDurationUs / 1e6 : undefined,
        cues,
      });
      findings.push(...scan.findings);
      notes.push(...scan.notes);
      layers.ffmpegScan = { status: "passed", finishedAt: now() };
    } catch (error) {
      layers.ffmpegScan = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
    }
  }

  // ---- L3 DOVER 观感 ----
  let aesthetic: ChapterQcReportV1["aesthetic"];
  if (structuralBlocked) {
    layers.aesthetic = { status: "skipped", reason: "structural blocker 短路" };
  } else if (!deps.videoQc) {
    layers.aesthetic = { status: "skipped", reason: "skipped-no-controller" };
  } else {
    const controllerStatus = deps.videoQc.status();
    if (!controllerStatus.modelReady) {
      layers.aesthetic = {
        status: "skipped",
        reason: controllerStatus.modelCode === "arch-unavailable" ? "skipped-arch-unavailable" : "skipped-model-missing",
      };
      notes.push(`观感层跳过: ${controllerStatus.modelMessage ?? controllerStatus.modelCode ?? "模型未就绪"}`);
    } else {
      try {
        const outcome = await deps.videoQc.runVideoQcScore({
          projectId: input.projectId,
          chapterId: input.chapterId,
          videoPath: outputPath,
          mode: "whole",
        });
        if (outcome.status === "accepted" && outcome.mode === "whole") {
          // seriesId v1 用 projectId(系列级基线的数据源在设置页录入,此处先项目级)
          const evaluation = evaluateAestheticAgainstBaseline(deps.videoQc, input.projectId, outcome.overall.fused);
          aesthetic = { ...outcome.overall, ...(evaluation.baseline ? { baseline: evaluation.baseline } : {}), elapsedMs: outcome.elapsedMs };
          if (evaluation.finding) findings.push(evaluation.finding);
          // 整片低于基线 → 按镜切片粗到细定位
          if (evaluation.finding && spans.length > 0) {
            const sliceOutcome = await deps.videoQc.runVideoQcScore({
              projectId: input.projectId,
              chapterId: input.chapterId,
              videoPath: outputPath,
              mode: "slices",
              slices: spans.map((span) => ({ shotId: span.shotId, startS: span.startS, durationS: span.durationS })),
            });
            if (sliceOutcome.status === "accepted" && sliceOutcome.slices) {
              aesthetic.slices = sliceOutcome.slices.map((slice) => {
                const span = spans.find((candidate) => candidate.shotId === slice.shotId);
                return { shotId: slice.shotId, ordinal: span?.ordinal ?? 0, fused: slice.fused };
              });
              for (const slice of aesthetic.slices) {
                if (slice.fused < (evaluation.baseline?.meanFused ?? 1) * 0.8) {
                  findings.push({
                    code: "chapter-qc.aesthetic.shot-below-baseline",
                    layer: "aesthetic",
                    severity: "warn",
                    shotId: slice.shotId,
                    shotOrdinal: slice.ordinal,
                    message: `第 ${slice.ordinal} 镜观感分 ${slice.fused.toFixed(3)} 显著低于基线`,
                    evidence: { fused: slice.fused },
                  });
                }
              }
            }
          }
          layers.aesthetic = { status: "passed", finishedAt: now() };
        } else if (outcome.status === "blocked") {
          layers.aesthetic = { status: "failed", reason: `${outcome.code}: ${outcome.message}`, finishedAt: now() };
        } else {
          // slices artifact 意外混入 whole 调用:视为无效产物而非崩溃
          layers.aesthetic = { status: "failed", reason: "invalid-artifact: slices outcome on whole request", finishedAt: now() };
        }
      } catch (error) {
        layers.aesthetic = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
      }
    }
  }

  // ---- L5 视觉审计:密度闸(确定性)+ 帧物料(模型侧 runner 消费) ----
  let vision: ChapterQcVisionResultV1 | undefined;
  if (structuralBlocked) {
    layers.vision = { status: "skipped", reason: "structural blocker 短路" };
  } else if (!renderPlanSpans) {
    layers.vision = { status: "skipped", reason: "skipped-no-render-plan" };
  } else {
    try {
      const outcome = await runVisionLayer({
        projectId: input.projectId,
        chapterId: input.chapterId,
        videoPath: outputPath,
        spans: renderPlanSpans.spans,
        transitions: renderPlanSpans.transitions,
        visualClipIds: renderPlanSpans.visualClipIds,
        reportDir: chapterQcReportDir(workspaceRoot, input.chapterId),
      });
      findings.push(...outcome.findings);
      vision = {
        frameCount: outcome.frames.length,
        frames: outcome.frames,
        decisions: buildVisionDecisions({
          spans: renderPlanSpans.spans,
          visualClipIds: renderPlanSpans.visualClipIds,
          descriptionsByShotId: descriptionByShotId,
          transitions: renderPlanSpans.transitions,
          effects: renderPlanSpans.effects,
        }),
        densityChecked: outcome.densityChecked,
        frameErrors: outcome.frameErrors,
      };
      if (outcome.frameErrors > 0) notes.push(`视觉审计帧提取失败 ${outcome.frameErrors} 帧(已跳过)`);
      layers.vision = { status: "passed", finishedAt: now() };
    } catch (error) {
      layers.vision = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
    }
  }

  // ---- 报告落盘 ----
  const summary = summarizeChapterQcFindings(findings);
  const report: ChapterQcReportV1 = {
    schemaVersion: CHAPTER_QC_SCHEMA_VERSION,
    projectId: input.projectId,
    chapterId: input.chapterId,
    outputPath,
    outputSha256: sha256File(outputPath),
    createdAt: now(),
    durationS: probeDurationS,
    shotCount: spans.length,
    layers: layers as ChapterQcReportV1["layers"],
    findings,
    summary,
    ...(extractedFrames.length > 0
      ? {
          shots: extractedFrames.map((frame) => ({
            shotId: frame.shotId,
            ordinal: frame.ordinal,
            frameUrl: createProjectFileUrl(input.projectId, `remotion/qc/chapters/${input.chapterId}/frames/${path.basename(frame.framePath)}`),
            ...(descriptionByShotId.get(frame.shotId) ? { description: descriptionByShotId.get(frame.shotId) } : {}),
          })),
        }
      : {}),
    ...(aesthetic ? { aesthetic } : {}),
    ...(vision ? { vision } : {}),
  };
  await writeChapterQcReport(workspaceRoot, input.chapterId, report);
  return report;
}

export async function readReport(
  deps: Pick<ChapterQcOrchestratorDeps, "remotionWorkspaceRootForProject">,
  identity: { projectId: string; chapterId: string },
): Promise<ChapterQcReportV1 | null> {
  return readChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId);
}
