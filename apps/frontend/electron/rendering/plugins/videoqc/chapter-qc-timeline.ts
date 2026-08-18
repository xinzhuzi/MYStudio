/**
 * 镜级时间轴映射基建:video-use 工件 EDL → 镜区间表;时间戳 → shotId。
 * L2(ffmpeg 时间戳归镜)/L3(切片)/L4(代表帧)共用。
 */

import type { VideoUseEdlEntryV1 } from "../../contracts/video-workflow";

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
