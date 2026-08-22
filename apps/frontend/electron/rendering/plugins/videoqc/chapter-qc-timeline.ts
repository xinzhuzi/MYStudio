/**
 * 镜级时间轴映射基建:video-use 工件 EDL → 镜区间表;时间戳 → shotId。
 * L2(ffmpeg 时间戳归镜)/L3(切片)/L4(代表帧)共用。
 */

import type { VideoUseEdlEntryV1 } from "../../contracts/video-workflow";
import { layoutVisualTimeline } from "../remotion/composition/timing";

export interface ChapterQcShotSpan {
  shotId: string;
  /** 第几镜(按 timelineStartS 排序后 1 起) */
  ordinal: number;
  startS: number;
  endS: number;
  durationS: number;
}

/** 镜交界处的归属容差(秒):落在 [end - ε, end) 的视为下一镜(转场起始)。 */
const BOUNDARY_EPSILON_S = 0.04;

export function buildShotSpans(edl: VideoUseEdlEntryV1[]): ChapterQcShotSpan[] {
  const sorted = [...edl].sort((left, right) => left.timelineStartS - right.timelineStartS);
  return sorted.map((entry, index) => ({
    shotId: entry.shotId,
    ordinal: index + 1,
    startS: entry.timelineStartS,
    endS: entry.timelineStartS + entry.durationS,
    durationS: entry.durationS,
  }));
}

/**
 * 从渲染计划重建镜区间——成片时间轴的唯一权威。
 *
 * artifact EDL 的 timelineStartS 是未压缩时间轴(转场不重叠),而成片经
 * Remotion layoutVisualTimeline 按转场重叠压缩(2026-08-22 审计实测:43 镜
 * 未压缩 174.9s vs 成片 145.1s,尾段漂移可达 ~30s)——直接拿 artifact
 * timelineStartS 对成片做镜归因会系统性错位,L2/L3 切片/L4 代表帧全受
 * 污染。此函数复用渲染侧同一纯函数复算压缩时间轴,与画面逐帧对齐。
 *
 * 返回 null = 计划形状不完整(fail-closed,调用方回落 artifact 口径并留痕)。
 */
export interface ChapterQcRenderPlanSpans {
  spans: ChapterQcShotSpan[];
  /** 视觉 clip 顺序(clipId,与 transitions 的 fromClipId 对齐用) */
  visualClipIds: string[];
  /** render-plan 原始转场(非 cut),供密度闸等确定性检查消费 */
  transitions: Array<{ fromClipId: string; toClipId: string; effectId: string; durationUs: number }>;
  /** 视觉镜上的最小效果决策，供确认前视觉预审解释画面。 */
  effects: Array<{ targetClipId: string; effectId: string; template?: string }>;
  fps: number;
}

export function buildShotSpansFromRenderPlan(plan: unknown): ChapterQcRenderPlanSpans | null {
  if (typeof plan !== "object" || plan === null) return null;
  const record = plan as {
    clips?: unknown;
    transitions?: unknown;
    effects?: unknown;
    renderSettings?: { fps?: unknown };
  };
  if (!Array.isArray(record.clips) || !Array.isArray(record.transitions)) return null;
  const fps = Number(record.renderSettings?.fps ?? 30);
  if (!Number.isFinite(fps) || fps <= 0) return null;

  const visual: Array<{ clipId: string; storyboardId: string; startUs: number; durationUs: number }> = [];
  for (const clip of record.clips) {
    if (typeof clip !== "object" || clip === null) continue;
    const entry = clip as {
      id?: unknown;
      trackKind?: unknown;
      startUs?: unknown;
      durationUs?: unknown;
      source?: { kind?: unknown; evidence?: { storyboardId?: unknown } };
    };
    const isVisual = entry.trackKind === "video" || entry.trackKind === "image"
      || entry.source?.kind === "storyboardVideo";
    const storyboardId = entry.source?.evidence?.storyboardId;
    if (!isVisual) continue;
    if (typeof entry.id !== "string" || typeof storyboardId !== "string" || !storyboardId) return null;
    const startUs = Number(entry.startUs);
    const durationUs = Number(entry.durationUs);
    if (!Number.isFinite(startUs) || !Number.isFinite(durationUs) || durationUs <= 0) return null;
    visual.push({ clipId: entry.id, storyboardId, startUs, durationUs });
  }
  if (visual.length === 0) return null;
  visual.sort((left, right) => left.startUs - right.startUs);

  const transitions: ChapterQcRenderPlanSpans["transitions"] = [];
  for (const transition of record.transitions) {
    if (typeof transition !== "object" || transition === null) continue;
    const entry = transition as { fromClipId?: unknown; toClipId?: unknown; effectId?: unknown; durationUs?: unknown };
    if (typeof entry.fromClipId !== "string" || typeof entry.toClipId !== "string") return null;
    if (entry.effectId === "cut") continue;
    if (typeof entry.effectId !== "string" || !Number.isFinite(Number(entry.durationUs))) return null;
    transitions.push({ fromClipId: entry.fromClipId, toClipId: entry.toClipId, effectId: entry.effectId, durationUs: Number(entry.durationUs) });
  }

  const visualClipIds = new Set(visual.map((clip) => clip.clipId));
  const effects: ChapterQcRenderPlanSpans["effects"] = [];
  for (const effect of Array.isArray(record.effects) ? record.effects : []) {
    if (typeof effect !== "object" || effect === null) continue;
    const entry = effect as {
      targetClipId?: unknown;
      effectId?: unknown;
      enabled?: unknown;
      params?: { template?: unknown };
    };
    if (entry.enabled === false) continue;
    if (typeof entry.targetClipId !== "string" || !visualClipIds.has(entry.targetClipId)) continue;
    if (typeof entry.effectId !== "string" || !entry.effectId) continue;
    effects.push({
      targetClipId: entry.targetClipId,
      effectId: entry.effectId,
      ...(typeof entry.params?.template === "string" ? { template: entry.params.template } : {}),
    });
  }

  const timeline = layoutVisualTimeline(
    visual.map((clip) => ({ clipId: clip.clipId, durationUs: clip.durationUs })),
    transitions,
    fps,
  );
  const framesPerSecond = timeline.fps;
  const byClipId = new Map(visual.map((clip) => [clip.clipId, clip]));
  const spans: ChapterQcShotSpan[] = timeline.clips.map((timing, index) => {
    const clip = byClipId.get(timing.clipId)!;
    const startS = timing.from / framesPerSecond;
    const durationS = timing.durationInFrames / framesPerSecond;
    return { shotId: clip.storyboardId, ordinal: index + 1, startS, endS: startS + durationS, durationS };
  });
  return { spans, visualClipIds: visual.map((clip) => clip.clipId), transitions, effects, fps: framesPerSecond };
}

export function totalTimelineDurationS(spans: ChapterQcShotSpan[]): number {
  if (spans.length === 0) return 0;
  const last = spans[spans.length - 1];
  return last.endS;
}

export interface ChapterQcShotLocation {
  shotId: string;
  ordinal: number;
  offsetInShotS: number;
}

/** 二分定位;镜间空隙(EDL 罕见)向前归。未覆盖区间返回 null。 */
export function mapTimestampToShot(
  spans: ChapterQcShotSpan[],
  timestampS: number,
): ChapterQcShotLocation | null {
  if (spans.length === 0 || !Number.isFinite(timestampS)) return null;
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = spans[mid];
    if (timestampS < span.startS) high = mid - 1;
    else if (timestampS >= span.endS) low = mid + 1;
    else {
      // 命中镜末容差窗:归下一镜(转场起始),避免边界抖动归错镜
      const next = spans[mid + 1];
      if (next && next.startS - span.endS <= BOUNDARY_EPSILON_S && span.endS - timestampS <= BOUNDARY_EPSILON_S) {
        return { shotId: next.shotId, ordinal: next.ordinal, offsetInShotS: 0 };
      }
      return { shotId: span.shotId, ordinal: span.ordinal, offsetInShotS: timestampS - span.startS };
    }
  }
  // 边界容差:落在某镜末尾 ε 内 → 归下一镜;落在镜头 ε 内 → 归上一镜末尾
  const next = spans[Math.min(low, spans.length - 1)];
  if (low > 0 && low < spans.length && timestampS >= next.startS - BOUNDARY_EPSILON_S) {
    return { shotId: next.shotId, ordinal: next.ordinal, offsetInShotS: Math.max(0, timestampS - next.startS) };
  }
  const prev = spans[Math.max(low - 1, 0)];
  if (low > 0 && timestampS < prev.endS + BOUNDARY_EPSILON_S) {
    return { shotId: prev.shotId, ordinal: prev.ordinal, offsetInShotS: prev.durationS };
  }
  return null;
}

/** 多个时间戳合并归镜段:[startS, endS] 与镜区间求交,输出覆盖度最高的镜。 */
export function mapRangeToShot(
  spans: ChapterQcShotSpan[],
  startS: number,
  endS: number,
): ChapterQcShotSpan | null {
  if (spans.length === 0 || endS <= startS) return null;
  let best: ChapterQcShotSpan | null = null;
  let bestOverlap = 0;
  for (const span of spans) {
    const overlap = Math.min(span.endS, endS) - Math.max(span.startS, startS);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = span;
    }
  }
  return best;
}
