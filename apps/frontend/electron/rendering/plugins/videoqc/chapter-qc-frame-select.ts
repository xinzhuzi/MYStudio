/**
 * L4 代表帧择帧(1030 吸收 `Simbastack-hq/framedex` 采样法的单机版)。
 *
 * framedex 原法:160px 廉价缩略图池 → 直方图距离 + 清晰度打分 → 剔近黑/过曝 → 近邻去重 →
 * 取 N 张互差最大帧。本链每镜只要 1 张喂语义模型,所以取其可用的一半:
 *   - 池 = L2 同一次 ffmpeg 趟已经算好的逐帧采样点(blurdetect/signalstats 顺手出数,零新增开销);
 *   - 打分 = 每帧 `lavfi.blur`(越大越糊,取最小);
 *   - 剔除 = YAVG 出曝光窗的近黑/过曝帧(对模型等于废图);
 *   - 内缩 = 避开转场混合窗(压缩模型转场窗≈0.5s,取 0.35s 常量)。
 * 剔完无可选 → 回退镜中点并标 `midpoint-fallback`:没挑成要如实说,不许冒充挑好了。
 */

import { EXPOSURE_HIGH_YAVG, EXPOSURE_LOW_YAVG } from "./chapter-qc-ffmpeg-scan";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";
import type { FrameMetricPoint } from "./parse-ffmpeg-probe";

/** 镜首尾内缩(秒):避开转场混合窗与切点残影。 */
export const FRAME_EDGE_INSET_S = 0.35;

export type ShotFrameBasis = "sharpest-in-shot" | "midpoint-fallback";

export interface ShotFrameChoice {
  shotId: string;
  ordinal: number;
  /** 实际抽帧时间点(成片压缩时间轴秒) */
  tS: number;
  basis: ShotFrameBasis;
  /** 参与打分的候选帧数 */
  candidates: number;
  /** 因出曝光窗被剔掉的帧数 */
  rejectedByExposure: number;
  /** midpoint-fallback 的原因 */
  reason?: string;
}

export interface PickFrameOptions {
  insetS?: number;
  /** 覆盖曝光窗(默认与 L2 逐帧统计同窗,单一真源在 chapter-qc-ffmpeg-scan) */
  exposureWindow?: readonly [number, number];
}

function isOutOfExposure(point: FrameMetricPoint, low: number, high: number): boolean {
  if (point.yavg === undefined) return false; // 无信号不惩罚,留给 blur 打分
  return point.yavg < low || point.yavg > high;
}

/**
 * 每镜一个择帧点。`points` 为 L2 的逐帧采样点(按 tS 升序不要求,内部自排序无关)。
 * 平票取离镜中点最近的一个,保证同一份输入恒得同一结果(报告可复算)。
 */
export function pickShotFrameTimes(
  spans: readonly ChapterQcShotSpan[],
  points: readonly FrameMetricPoint[],
  options: PickFrameOptions = {},
): Map<string, ShotFrameChoice> {
  const inset = options.insetS ?? FRAME_EDGE_INSET_S;
  const [low, high] = options.exposureWindow ?? [EXPOSURE_LOW_YAVG, EXPOSURE_HIGH_YAVG];
  const choices = new Map<string, ShotFrameChoice>();
  for (const span of spans) {
    const midS = span.startS + span.durationS / 2;
    // 短镜(≤2×inset)不内缩,否则窗口为空——此时全镜都是候选
    const shrinkable = span.durationS > inset * 2;
    const fromS = shrinkable ? span.startS + inset : span.startS;
    const toS = shrinkable ? span.endS - inset : span.endS;
    const inWindow = points.filter((point) => point.tS >= fromS && point.tS < toS);
    const rejectedByExposure = inWindow.filter(
      (point) => point.blur !== undefined && isOutOfExposure(point, low, high),
    ).length;
    const candidates = inWindow.filter(
      (point) => point.blur !== undefined && !isOutOfExposure(point, low, high),
    );
    if (candidates.length === 0) {
      choices.set(span.shotId, {
        shotId: span.shotId,
        ordinal: span.ordinal,
        tS: midS,
        basis: "midpoint-fallback",
        candidates: 0,
        rejectedByExposure,
        reason: inWindow.length === 0
          ? "镜内无逐帧采样点(L2 采样步长覆盖不到)"
          : "镜内候选全部无清晰度分或出曝光窗",
      });
      continue;
    }
    const best = candidates.reduce((sharpest, candidate) => {
      const blur = candidate.blur as number;
      const current = sharpest.blur as number;
      if (blur < current) return candidate;
      if (blur > current) return sharpest;
      // 平票:离镜中点近的胜出(确定性)
      return Math.abs(candidate.tS - midS) < Math.abs(sharpest.tS - midS) ? candidate : sharpest;
    });
    choices.set(span.shotId, {
      shotId: span.shotId,
      ordinal: span.ordinal,
      tS: best.tS,
      basis: "sharpest-in-shot",
      candidates: candidates.length,
      rejectedByExposure,
    });
  }
  return choices;
}

/** 择帧统计句(落 QC notes;不撒谎:N 是挑成的,兜底另计)。 */
export function describeFrameChoices(
  choices: ReadonlyMap<string, ShotFrameChoice>,
): { picked: number; fallback: number; rejected: number; total: number } {
  let picked = 0;
  let fallback = 0;
  let rejected = 0;
  for (const choice of choices.values()) {
    if (choice.basis === "sharpest-in-shot") picked += 1;
    else fallback += 1;
    rejected += choice.rejectedByExposure;
  }
  return { picked, fallback, rejected, total: choices.size };
}
