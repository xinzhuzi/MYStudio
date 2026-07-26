import { describe, expect, it } from "vitest";
import {
  clipDurationInFrames,
  layoutVisualTimeline,
  transitionOverlapFrames,
  usToFrames,
  type CompositionTransitionInput,
  type CompositionVisualClipInput,
} from "./timing";

const FPS = 30;

describe("usToFrames", () => {
  it("rounds microseconds to the nearest frame at the given fps", () => {
    expect(usToFrames(1_000_000, 30)).toBe(30);
    expect(usToFrames(500_000, 30)).toBe(15);
    // 1/60s at 30fps = 0.5 frame -> rounds to 1 (Math.round half-up)
    expect(usToFrames(16_667, 30)).toBe(1);
    expect(usToFrames(0, 30)).toBe(0);
  });

  it("rejects negative or non-finite durations and non-positive fps", () => {
    expect(() => usToFrames(-1, 30)).toThrow("时长必须是非负有限微秒数");
    expect(() => usToFrames(Number.NaN, 30)).toThrow("时长必须是非负有限微秒数");
    expect(() => usToFrames(1_000_000, 0)).toThrow("帧率必须是正有限数");
    expect(() => usToFrames(1_000_000, -30)).toThrow("帧率必须是正有限数");
  });
});

describe("clipDurationInFrames", () => {
  it("never collapses a positive clip below one frame", () => {
    expect(clipDurationInFrames(1_000_000, 30)).toBe(30);
    expect(clipDurationInFrames(1, 30)).toBe(1);
    expect(clipDurationInFrames(0, 30)).toBe(1);
  });
});

describe("transitionOverlapFrames", () => {
  const fade = (durationUs: number): CompositionTransitionInput => ({
    fromClipId: "a",
    toClipId: "b",
    effectId: "fade",
    durationUs,
  });

  it("returns zero for a cut", () => {
    const cut: CompositionTransitionInput = {
      fromClipId: "a",
      toClipId: "b",
      effectId: "cut",
      durationUs: 500_000,
    };
    expect(transitionOverlapFrames(cut, 30, 30, FPS)).toBe(0);
  });

  it("overlaps by the transition duration in frames", () => {
    // 200_000us at 30fps = 6 frames, both neighbours long enough.
    expect(transitionOverlapFrames(fade(200_000), 30, 30, FPS)).toBe(4);
  });

  it("clamps overlap so each neighbour keeps at least one frame", () => {
    // Requested 30 frames but the shorter neighbour is 10 frames -> max 9.
    expect(transitionOverlapFrames(fade(1_000_000), 30, 10, FPS)).toBe(1);
  });
});

describe("layoutVisualTimeline", () => {
  const clips: CompositionVisualClipInput[] = [
    { clipId: "a", durationUs: 1_000_000 },
    { clipId: "b", durationUs: 1_000_000 },
    { clipId: "c", durationUs: 1_000_000 },
  ];

  it("lays clips end-to-end when every join is a cut", () => {
    const transitions: CompositionTransitionInput[] = [
      { fromClipId: "a", toClipId: "b", effectId: "cut", durationUs: 0 },
      { fromClipId: "b", toClipId: "c", effectId: "cut", durationUs: 0 },
    ];
    const timeline = layoutVisualTimeline(clips, transitions, FPS);
    expect(timeline.clips).toEqual([
      { clipId: "a", from: 0, durationInFrames: 30 },
      { clipId: "b", from: 30, durationInFrames: 30 },
      { clipId: "c", from: 60, durationInFrames: 30 },
    ]);
    expect(timeline.durationInFrames).toBe(90);
  });

  it("pulls clips earlier by transition overlap and shortens total duration", () => {
    // fade a->b overlaps 6 frames; b->c cut has no overlap.
    const transitions: CompositionTransitionInput[] = [
      { fromClipId: "a", toClipId: "b", effectId: "fade", durationUs: 200_000 },
      { fromClipId: "b", toClipId: "c", effectId: "cut", durationUs: 0 },
    ];
    const timeline = layoutVisualTimeline(clips, transitions, FPS);
    expect(timeline.clips).toEqual([
      { clipId: "a", from: 0, durationInFrames: 30 },
      { clipId: "b", from: 26, durationInFrames: 30 },
      { clipId: "c", from: 56, durationInFrames: 30 },
    ]);
    // 90 total minus two 4-frame (15%-capped) overlaps = 86.
    expect(timeline.durationInFrames).toBe(86);
  });

  it("handles a single clip and empty timeline", () => {
    const single = layoutVisualTimeline(
      [{ clipId: "only", durationUs: 1_000_000 }],
      [],
      FPS,
    );
    expect(single.clips).toEqual([
      { clipId: "only", from: 0, durationInFrames: 30 },
    ]);
    expect(single.durationInFrames).toBe(30);

    const empty = layoutVisualTimeline([], [], FPS);
    expect(empty.clips).toEqual([]);
    expect(empty.durationInFrames).toBe(1);
  });
});
