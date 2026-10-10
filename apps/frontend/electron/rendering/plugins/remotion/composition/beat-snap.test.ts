// 节拍切点吸附(10-10 批D,决议 D5)——吸附引擎烧金样+通道纪律锁。
import { describe, expect, it } from "vitest";
import { snapVisualTimelineToBeats, BEAT_SNAP_MAX_SHIFT_FRAMES } from "./beat-snap";
import { layoutVisualTimeline, type CompositionTransitionInput } from "./timing";

const FPS = 30;

/** 三镜布局:1s/1s/1s,边界 1-2 fade 200ms(overlap 6)、边界 2-3 cut。 */
function threeShotLayout() {
  const clips = [
    { clipId: "a", durationUs: 1_000_000 },
    { clipId: "b", durationUs: 1_000_000 },
    { clipId: "c", durationUs: 1_000_000 },
  ];
  const transitions: CompositionTransitionInput[] = [
    { fromClipId: "a", toClipId: "b", effectId: "fade", durationUs: 200_000 },
    { fromClipId: "b", toClipId: "c", effectId: "cut", durationUs: 0 },
  ];
  return { clips, transitions, timing: layoutVisualTimeline(clips, transitions, FPS) };
}

describe("snapVisualTimelineToBeats", () => {
  it("无 beats/单镜:原样返回(零吸附,BGM 有 beats 才激活的引擎侧底线)", () => {
    const { timing, transitions } = threeShotLayout();
    expect(snapVisualTimelineToBeats(timing.clips, transitions, [], FPS)).toEqual(timing.clips);
    expect(snapVisualTimelineToBeats([timing.clips[0]!], [], [500_000], FPS)).toEqual([timing.clips[0]!]);
  });

  it("fade 边界吸附到节拍:切点=节拍帧,每镜时长逐值不变", () => {
    const { timing, transitions } = threeShotLayout();
    // 布局:a[0,30) b[24,54) c[54,84)(fade overlap 6;b 尾与 c 硬切)。
    expect(timing.clips).toEqual([
      { clipId: "a", from: 0, durationInFrames: 30 },
      { clipId: "b", from: 24, durationInFrames: 30 },
      { clipId: "c", from: 54, durationInFrames: 30 },
    ]);
    // 节拍在帧 20(b 入点 24 前 4 帧):overlap 6→10,b.from=20,c.from=50。
    const snapped = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((20 / FPS) * 1_000_000),
    ], FPS);
    expect(snapped).toEqual([
      { clipId: "a", from: 0, durationInFrames: 30 },
      { clipId: "b", from: 20, durationInFrames: 30 },
      { clipId: "c", from: 50, durationInFrames: 30 },
    ]);
  });

  it("硬切边界不吸附(切点=前镜内容尾帧;动了它就要裁/冻镜内容)", () => {
    const { timing, transitions } = threeShotLayout();
    // 节拍钉在帧 57(b|c 硬切点 54 后 3 帧):c 入点不动。
    const snapped = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((57 / FPS) * 1_000_000),
    ], FPS);
    expect(snapped[2]).toEqual({ clipId: "c", from: 54, durationInFrames: 30 });
  });

  it("钳制:|Δ|>maxShiftFrames 不吸附;越 half-neighbour 落不进=保持原切点", () => {
    const { timing, transitions } = threeShotLayout();
    // 节拍帧 8(距 b 入点 24 达 16 帧 > 12):不吸附。
    const tooFar = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((8 / FPS) * 1_000_000),
    ], FPS);
    expect(tooFar[1]).toEqual({ clipId: "b", from: 24, durationInFrames: 30 });

    // 落点在 end(30) 之后=负重叠(gap):candidate<1,保持原切点。
    const afterEnd = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((33 / FPS) * 1_000_000),
    ], FPS);
    expect(afterEnd[1]).toEqual({ clipId: "b", from: 24, durationInFrames: 30 });
  });

  it("maxShiftFrames 钳制常量=12f(@30fps=0.4s,超过读作镜头被拖走)", () => {
    expect(BEAT_SNAP_MAX_SHIFT_FRAMES).toBe(12);
  });

  it("half-neighbour 上限:重叠最多吃短邻一半(同 transitionOverlapFrames 纪律)", () => {
    const clips = [
      { clipId: "a", durationUs: 1_000_000 },
      { clipId: "b", durationUs: 1_000_000 },
    ];
    const transitions: CompositionTransitionInput[] = [
      { fromClipId: "a", toClipId: "b", effectId: "crossfade", durationUs: 200_000 },
    ];
    const timing = layoutVisualTimeline(clips, transitions, FPS);
    // 节拍钉在帧 5(b 入点 24 前 19 帧,Δ≤12 内的极限位):candidate=30−5=25
    // > half(15) → 落不进,保持原切点 24。
    const snapped = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((5 / FPS) * 1_000_000),
    ], FPS);
    expect(snapped[1]).toEqual({ clipId: "b", from: 24, durationInFrames: 30 });
    // 节拍钉在帧 16:candidate=30−16=14 ≤15 → 吸附,b.from=16。
    const landed = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((16 / FPS) * 1_000_000),
    ], FPS);
    expect(landed[1]).toEqual({ clipId: "b", from: 16, durationInFrames: 30 });
  });

  it("链式传播:吸附件 i 后后续片段同步平移,from 严格递增且每镜 ≥1 帧", () => {
    const clips = [
      { clipId: "a", durationUs: 1_000_000 },
      { clipId: "b", durationUs: 1_000_000 },
      { clipId: "c", durationUs: 1_000_000 },
      { clipId: "d", durationUs: 1_000_000 },
    ];
    const transitions: CompositionTransitionInput[] = [
      { fromClipId: "a", toClipId: "b", effectId: "fade", durationUs: 200_000 },
      { fromClipId: "b", toClipId: "c", effectId: "fade", durationUs: 200_000 },
      { fromClipId: "c", toClipId: "d", effectId: "fade", durationUs: 200_000 },
    ];
    const timing = layoutVisualTimeline(clips, transitions, FPS);
    // 未吸附:0/24/48/72。节拍=帧 20 与帧 44(各把该边界拉前到节拍;d 边界
    // 无邻近节拍,链上 c 提前后 overlap 自动收窄吸收,c|d 切点保持 72)。
    const snapped = snapVisualTimelineToBeats(timing.clips, transitions, [
      Math.round((20 / FPS) * 1_000_000),
      Math.round((44 / FPS) * 1_000_000),
    ], FPS);
    expect(snapped.map((clip) => clip.from)).toEqual([0, 20, 44, 72]);
    for (let index = 1; index < snapped.length; index += 1) {
      expect(snapped[index]!.from).toBeGreaterThan(snapped[index - 1]!.from);
      expect(snapped[index]!.durationInFrames)
        .toBe(timing.clips[index]!.durationInFrames);
    }
  });

  it("节拍帧域:排序去重、区间外(0 与总帧数端点)剔除", () => {
    const { timing, transitions } = threeShotLayout();
    // 同一节拍重复+端点帧 0/84:等价于单节拍 20。
    const snapped = snapVisualTimelineToBeats(timing.clips, transitions, [
      0,
      Math.round((20 / FPS) * 1_000_000),
      Math.round((20 / FPS) * 1_000_000),
      Math.round((84 / FPS) * 1_000_000),
    ], FPS);
    expect(snapped[1]!.from).toBe(20);
  });

  it("确定性:同输入两次调用同输出(纯函数,无随机无时钟)", () => {
    const { timing, transitions } = threeShotLayout();
    const beats = [Math.round((20 / FPS) * 1_000_000), Math.round((50 / FPS) * 1_000_000)];
    expect(snapVisualTimelineToBeats(timing.clips, transitions, beats, FPS))
      .toEqual(snapVisualTimelineToBeats(timing.clips, transitions, beats, FPS));
  });
});
