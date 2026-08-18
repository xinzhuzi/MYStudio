import { describe, expect, it } from "vitest";
import {
  buildShotSpans,
  mapRangeToShot,
  mapTimestampToShot,
  totalTimelineDurationS,
} from "./chapter-qc-timeline";
import type { VideoUseEdlEntryV1 } from "../../contracts/video-workflow";

function edl(shotId: string, startS: number, durationS: number): VideoUseEdlEntryV1 {
  return { shotId, sourcePath: `/x/${shotId}.mp4`, sourceInS: 0, sourceOutS: durationS, timelineStartS: startS, durationS };
}

describe("buildShotSpans", () => {
  it("按 timelineStartS 排序并编 1 起序号", () => {
    const spans = buildShotSpans([edl("b", 10, 5), edl("a", 0, 10), edl("c", 15, 3)]);
    expect(spans.map((span) => span.shotId)).toEqual(["a", "b", "c"]);
    expect(spans.map((span) => span.ordinal)).toEqual([1, 2, 3]);
    expect(spans[1]).toMatchObject({ startS: 10, endS: 15, durationS: 5 });
  });

  it("空 EDL 返回空表", () => {
    expect(buildShotSpans([])).toEqual([]);
    expect(totalTimelineDurationS([])).toBe(0);
  });

  it("总时长取末镜 endS", () => {
    expect(totalTimelineDurationS(buildShotSpans([edl("a", 0, 4), edl("b", 4, 6)]))).toBe(10);
  });
});

describe("mapTimestampToShot", () => {
  const spans = buildShotSpans([edl("a", 0, 4), edl("b", 4, 6), edl("c", 10, 2)]);

  it("镜中定位返回镜内偏移", () => {
    expect(mapTimestampToShot(spans, 5.5)).toEqual({ shotId: "b", ordinal: 2, offsetInShotS: 1.5 });
    expect(mapTimestampToShot(spans, 0)).toEqual({ shotId: "a", ordinal: 1, offsetInShotS: 0 });
  });

  it("镜末边界容差归下一镜", () => {
    const location = mapTimestampToShot(spans, 4 - 0.02);
    expect(location?.shotId).toBe("b");
  });

  it("超出末镜的容差内归末镜,容差外返回 null", () => {
    expect(mapTimestampToShot(spans, 12 - 0.02)?.shotId).toBe("c");
    expect(mapTimestampToShot(spans, 13)).toBeNull();
    expect(mapTimestampToShot(spans, -0.5)).toBeNull();
  });

  it("空表/非有限值返回 null", () => {
    expect(mapTimestampToShot([], 1)).toBeNull();
    expect(mapTimestampToShot(spans, Number.NaN)).toBeNull();
  });
});

describe("mapRangeToShot", () => {
  const spans = buildShotSpans([edl("a", 0, 4), edl("b", 4, 6)]);

  it("返回重叠最大的镜", () => {
    expect(mapRangeToShot(spans, 3, 5)?.shotId).toBe("a");
    expect(mapRangeToShot(spans, 3.5, 9)?.shotId).toBe("b");
  });

  it("无效区间返回 null", () => {
    expect(mapRangeToShot(spans, 5, 5)).toBeNull();
    expect(mapRangeToShot([], 0, 1)).toBeNull();
  });
});
