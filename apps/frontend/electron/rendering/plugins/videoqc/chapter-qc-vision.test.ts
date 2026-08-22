import { describe, expect, it } from "vitest";
import { buildVisionDecisions, checkTransitionDensity, visionSamplePoints, runVisionLayer } from "./chapter-qc-vision";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";

const clipIds = ["c1", "c2", "c3", "c4", "c5", "c6"];

describe("checkTransitionDensity(08-22 密度裁定防御性复检)", () => {
  it("连续 5 边界内同款 → warn finding 定位出镜 ordinal", () => {
    const transitions = [
      { fromClipId: "c1", toClipId: "c2", effectId: "gl:swap", durationUs: 1_000_000 },
      { fromClipId: "c2", toClipId: "c3", effectId: "gl:swap", durationUs: 1_000_000 },
      { fromClipId: "c3", toClipId: "c4", effectId: "gl:swap", durationUs: 1_000_000 },
    ];
    const { findings, checked } = checkTransitionDensity(transitions, clipIds);
    expect(checked).toBe(3);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      code: "chapter-qc.vision.transition-density",
      layer: "vision",
      severity: "warn",
      shotOrdinal: 2,
    });
  });

  it("间距 ≥5 的同款放行;不同款不受限", () => {
    const ok = checkTransitionDensity([
      { fromClipId: "c1", toClipId: "c2", effectId: "gl:swap", durationUs: 1 },
      { fromClipId: "c2", toClipId: "c3", effectId: "fade", durationUs: 1 },
      { fromClipId: "c3", toClipId: "c4", effectId: "crossfade", durationUs: 1 },
      { fromClipId: "c6", toClipId: "c7", effectId: "gl:swap", durationUs: 1 },
    ], clipIds);
    expect(ok.findings).toHaveLength(0);
  });

  it("未知 fromClipId 的转场跳过不计", () => {
    const { findings, checked } = checkTransitionDensity([
      { fromClipId: "cx", toClipId: "c2", effectId: "gl:swap", durationUs: 1 },
    ], clipIds);
    expect(findings).toHaveLength(0);
    expect(checked).toBe(1);
  });
});

describe("visionSamplePoints", () => {
  const spans: ChapterQcShotSpan[] = [
    { shotId: "sb-1", ordinal: 1, startS: 0, endS: 4, durationS: 4 },
    { shotId: "sb-2", ordinal: 2, startS: 3, endS: 6, durationS: 3 }, // 1s 重叠转场窗 [3,4]
  ];
  it("镜中+边界 pre/blend/post,且不越出所属镜", () => {
    const points = visionSamplePoints(spans);
    expect(points.map((point) => point.kind)).toEqual(["mid", "pre", "blend", "post", "mid"]);
    const blend = points.find((point) => point.kind === "blend")!;
    expect(blend.tS).toBeCloseTo(3.5, 5);
    const post = points.find((point) => point.kind === "post")!;
    expect(post.tS).toBeCloseTo(4.25, 5);
    expect(post.shotId).toBe("sb-2");
  });
});

describe("buildVisionDecisions", () => {
  it("把镜描述、装饰效果和出镜转场绑定到同一镜序", () => {
    const spans: ChapterQcShotSpan[] = [
      { shotId: "sb-1", ordinal: 1, startS: 0, endS: 4, durationS: 4 },
      { shotId: "sb-2", ordinal: 2, startS: 3, endS: 6, durationS: 3 },
    ];
    const decisions = buildVisionDecisions({
      spans,
      visualClipIds: ["c1", "c2"],
      descriptionsByShotId: new Map([["sb-1", "晏燎拔剑"], ["sb-2", "敌人后退"]]),
      transitions: [{ fromClipId: "c1", toClipId: "c2", effectId: "gl:swap", durationUs: 800_000 }],
      effects: [{ targetClipId: "c1", effectId: "atmosphere", template: "atmo:fog-band" }],
    });
    expect(decisions[0]).toEqual({
      shotId: "sb-1",
      ordinal: 1,
      description: "晏燎拔剑",
      effects: [{ effectId: "atmosphere", template: "atmo:fog-band" }],
      outgoingTransition: { toShotId: "sb-2", toOrdinal: 2, effectId: "gl:swap", durationS: 0.8 },
    });
  });
});

describe("runVisionLayer 帧物料", () => {
  const spans: ChapterQcShotSpan[] = [
    { shotId: "sb-1", ordinal: 1, startS: 0, endS: 4, durationS: 4 },
    { shotId: "sb-2", ordinal: 2, startS: 3, endS: 6, durationS: 3 },
  ];
  it("抽帧成功 → frames 带 project-file URL;失败帧计入 frameErrors 不中断", async () => {
    const calls: string[] = [];
    const runner = async (_file: string, args: string[]) => {
      const output = args[args.length - 1];
      calls.push(String(output));
      if (String(output).includes("vis-001-pre")) throw new Error("boom");
      return { stdout: "", stderr: "" };
    };
    const outcome = await runVisionLayer({
      projectId: "p1", chapterId: "chapter-001", videoPath: "/tmp/v.mp4",
      spans, transitions: [], visualClipIds: ["c1", "c2"],
      reportDir: "/tmp/qc-report", runner,
    });
    expect(calls).toHaveLength(5);
    expect(outcome.frameErrors).toBe(1);
    expect(outcome.frames).toHaveLength(4);
    expect(outcome.frames[0].frameUrl).toBe(
      "project-file://p1/remotion/qc/chapters/chapter-001/vision-frames/vis-001-mid-t2.0.jpg",
    );
    expect(outcome.densityChecked).toBe(0);
  });
});
