// beatTimesUs → 镜头切点吸附(10-10 批D,决议 D5:只做切点吸附,不做 librosa)。
//
// 任务档 design §5:节奏卡点=「切点吸附已有 beatTimesUs」(BGM 能量峰,渲染期
// 禁异步的预计算输入,章级开关默认关、BGM 有 beats 才激活)。
//
// 吸附通道裁定:转场重叠是唯一不动物镜内容的切点平移通道——
// clip[i].from = end(i-1) − overlap_i,吸附件 i 的入点=调 overlap_i ∈
// [1, halfNeighbour](非 cut 转场窗内);cut/无转场边界重叠恒 0,切点=前镜
// 内容尾帧,动了它就要裁/冻逐镜渲染产物(shot MP4),故硬切不吸附(零内容
// 改动的纪律;与 deriveTransitionSfxClips 的「吸附只在转场窗内」同款口径)。
//
// 确定性:纯函数(排序去重后的节拍帧×固定钳制),同输入同输出,无随机无时钟。

import type { CompositionTransitionInput, CompositionClipTiming } from "./timing";

/** 单切点最大平移帧数(钳制;12f@30fps=0.4s——超过读作「镜头被拖走」)。 */
export const BEAT_SNAP_MAX_SHIFT_FRAMES = 12;

export interface BeatSnapOptions {
  /** 单切点最大平移帧数,缺省 BEAT_SNAP_MAX_SHIFT_FRAMES。 */
  maxShiftFrames?: number;
}

/**
 * 把已布局的视觉时序切点吸附到最近节拍帧(纯函数)。
 *
 * 输入=layoutVisualTimeline 的产出(clips 按序、from 已含转场重叠折减)+
 * 原始转场表;输出=新时序(每镜 durationInFrames 逐值不变,只动 from 与
 * 衍生的总时长)。约束逐条:
 * - 只动非 cut 且存在的转场边界:overlap' = clamp(end(i-1) − 最近节拍, 1,
 *   floor(min(d(i-1), d(i))·0.5))(half-neighbour 上限同
 *   transitionOverlapFrames;非 cut 重叠必须 >0);
 * - |切点平移| ≤ maxShiftFrames,出界保持原切点;
 * - 链式传播:吸附件 i 后,后续片段的 end 同步平移,链上不变式
 *   from 严格递增、每镜 ≥1 帧恒成立(overlap < min(d) 保证)。
 * - 节拍帧先排序去重并限制在 (0, 总帧数) 开区间(端点无吸附意义)。
 */
export function snapVisualTimelineToBeats(
  clips: readonly CompositionClipTiming[],
  transitions: readonly CompositionTransitionInput[],
  beatTimesUs: readonly number[],
  fps: number,
  options?: BeatSnapOptions,
): CompositionClipTiming[] {
  if (clips.length <= 1 || beatTimesUs.length === 0) return [...clips];
  const maxShift = options?.maxShiftFrames ?? BEAT_SNAP_MAX_SHIFT_FRAMES;
  const totalFrames = clips.reduce(
    (total, clip) => Math.max(total, clip.from + clip.durationInFrames),
    0,
  );
  const beatFrames = [...new Set(
    beatTimesUs.map((us) => Math.round((us / 1_000_000) * fps)),
  )]
    .filter((frame) => frame > 0 && frame < totalFrames)
    .sort((left, right) => left - right);
  if (beatFrames.length === 0) return [...clips];

  const transitionByPair = new Map<string, CompositionTransitionInput>();
  for (const transition of transitions) {
    transitionByPair.set(`${transition.fromClipId}->${transition.toClipId}`, transition);
  }
  const nearestBeat = (frame: number): { beat: number; delta: number } | undefined => {
    let best: { beat: number; delta: number } | undefined;
    for (const beat of beatFrames) {
      const delta = Math.abs(beat - frame);
      if (!best || delta < best.delta) best = { beat, delta };
    }
    return best;
  };

  const out: CompositionClipTiming[] = [{ ...clips[0]! }];
  for (let index = 1; index < clips.length; index += 1) {
    const previous = out[index - 1]!;
    const current = clips[index]!;
    const endPrevious = previous.from + previous.durationInFrames;
    const overlapOriginal = endPrevious - current.from;
    const transition = transitionByPair.get(`${clips[index - 1]!.clipId}->${current.clipId}`);
    // 硬切/无转场:重叠恒 0(内容尾帧=切点),不吸附。
    let overlap = Math.max(0, overlapOriginal);
    if (transition && transition.effectId !== "cut") {
      const snapped = nearestBeat(current.from);
      const halfNeighbour = Math.floor(Math.min(previous.durationInFrames, current.durationInFrames) * 0.5);
      // 落点式吸附(land-or-keep):candidate=end−beat 必须落在 [1, halfNeighbour]
      // (非-cut 重叠 >0;half-neighbour 上限同 transitionOverlapFrames)——钳不
      // 进去=落不到节拍上,保持原切点(半吊子的「更近一点」读作切点漂移)。
      if (snapped && snapped.delta <= maxShift) {
        const candidate = endPrevious - snapped.beat;
        if (candidate >= 1 && candidate <= halfNeighbour) {
          overlap = candidate;
        }
      }
    }
    const from = Math.max(previous.from + 1, endPrevious - overlap);
    out.push({ clipId: current.clipId, from, durationInFrames: current.durationInFrames });
  }
  return out;
}
