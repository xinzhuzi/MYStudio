import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";

/**
 * 分镜关键帧规范化与不变式校验(08-27-storyboard-keyframe-sequence design.md §1)。
 * 写入唯一走 store.setStoryboardKeyframes;本模块是其校验内核,也可被
 * 回接脚本/帧规划器在产数据侧复用。纯函数,无 store 依赖。
 */

export const KEYFRAME_MIN = 1;
export const KEYFRAME_MAX = 4;

export function buildKeyframeId(storyboardId: string, frameIndex: number): string {
  return `${storyboardId}-kf-${frameIndex}`;
}

/**
 * 归一化读:任何分镜的"生效帧序列"。
 * keyframes 缺失 = 单图时代数据 → 由 mediaRef 合成单帧(mediaRef 也缺 → 空数组,
 * 表示该镜尚无任何画面)。下游一律经本函数取帧,禁止直读 keyframes 字段。
 */
export function effectiveKeyframes(storyboard: Pick<StoryboardItem, "keyframes" | "mediaRef">): StoryboardKeyframe[] {
  if (storyboard.keyframes?.length) return storyboard.keyframes;
  if (storyboard.mediaRef) {
    return [{ frameId: buildKeyframeId("", 1), mediaRef: storyboard.mediaRef, inUs: 0 }];
  }
  return [];
}

export interface KeyframeValidationOptions {
  /** 镜时长(ms):提供时校验末帧 inUs < durationUs */
  shotDurationUs?: number;
  /** 允许空帧槽(帧规划器建槽时 mediaRef.path 为占位):默认拒绝 */
  allowEmptySlots?: boolean;
}

export function validateStoryboardKeyframes(
  frames: StoryboardKeyframe[],
  options: KeyframeValidationOptions = {},
): string[] {
  const issues: string[] = [];
  if (frames.length < KEYFRAME_MIN || frames.length > KEYFRAME_MAX) {
    issues.push(`帧数须在 ${KEYFRAME_MIN}..${KEYFRAME_MAX},实为 ${frames.length}`);
  }
  const seenIds = new Set<string>();
  frames.forEach((frame, index) => {
    if (!frame.frameId) issues.push(`第 ${index + 1} 帧缺 frameId`);
    if (seenIds.has(frame.frameId)) issues.push(`frameId 重复:${frame.frameId}`);
    seenIds.add(frame.frameId);
    if (index === 0 && frame.inUs !== 0) issues.push(`首帧 inUs 须为 0,实为 ${frame.inUs}`);
    if (index > 0 && frame.inUs <= frames[index - 1].inUs) {
      issues.push(`第 ${index + 1} 帧 inUs=${frame.inUs} 未严格递增(前帧 ${frames[index - 1].inUs})`);
    }
    if (typeof frame.inUs !== "number" || !Number.isFinite(frame.inUs) || frame.inUs < 0) {
      issues.push(`第 ${index + 1} 帧 inUs 非法:${frame.inUs}`);
    }
    const path = frame.mediaRef?.path ?? "";
    if (!options.allowEmptySlots) {
      if (!frame.mediaRef?.kind) issues.push(`第 ${index + 1} 帧缺 mediaRef.kind`);
      if (!path) issues.push(`第 ${index + 1} 帧缺 mediaRef.path`);
    }
    // I4:受管虚拟协议纪律(与 storyboard-json isPersistableMediaPath 同源口径)
    if (path && /^(?:data:|blob:|https?:|file:)/.test(path)) {
      issues.push(`第 ${index + 1} 帧 path 违反受管协议纪律:${path.slice(0, 40)}…`);
    }
  });
  if (options.shotDurationUs && frames.length) {
    const last = frames[frames.length - 1];
    if (last.inUs >= options.shotDurationUs) {
      issues.push(`末帧 inUs=${last.inUs} 须小于镜时长 ${options.shotDurationUs}ms`);
    }
  }
  return issues;
}

/**
 * 写入前整备:仅按 inUs 排序——不静默修数(首帧非 0 等违规留给校验拒绝,
 * 防非法数据经"归一"洗白入库)。返回新数组,不改入参。
 */
export function normalizeStoryboardKeyframes(frames: StoryboardKeyframe[]): StoryboardKeyframe[] {
  return frames.slice().sort((left, right) => left.inUs - right.inUs);
}
