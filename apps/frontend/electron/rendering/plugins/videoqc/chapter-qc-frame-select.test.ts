import { describe, expect, it } from "vitest";

import { describeFrameChoices, pickShotFrameTimes, FRAME_EDGE_INSET_S } from "./chapter-qc-frame-select";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";
import type { FrameMetricPoint } from "./parse-ffmpeg-probe";

const SPANS: ChapterQcShotSpan[] = [
  { shotId: "sb-1", ordinal: 1, startS: 0, endS: 4, durationS: 4 },
  { shotId: "sb-2", ordinal: 2, startS: 3, endS: 6, durationS: 3 }, // 1s 重叠转场窗 [3,4]
];

function point(tS: number, extra: Partial<FrameMetricPoint> = {}): FrameMetricPoint {
  return { frameIndex: Math.round(tS * 24), tS, ...extra };
}

describe("pickShotFrameTimes(L4 代表帧择帧,吃 L2 同一趟的逐帧分)", () => {
  it("镜内取 blur 最小帧(越大越糊)", () => {
    const choices = pickShotFrameTimes([SPANS[0]], [
      point(0.5, { blur: 8 }),
      point(1.5, { blur: 2 }),
      point(2.5, { blur: 5 }),
      point(3.9, { blur: 0.1 }),
    ]);
    const choice = choices.get("sb-1")!;
    expect(choice).toMatchObject({ basis: "sharpest-in-shot", tS: 1.5, candidates: 3 });
    // 3.9s 落在尾内缩窗(转场残影)之外,不参与
    expect(choice.tS).toBeLessThan(SPANS[0].endS - FRAME_EDGE_INSET_S);
  });

  it("近黑/过曝候选即便最清晰也剔掉,并计数", () => {
    const choices = pickShotFrameTimes([SPANS[0]], [
      point(1.0, { blur: 0.5, yavg: 8 }), // 近黑:最糊-free 但废图
      point(1.5, { blur: 3, yavg: 120 }),
      point(2.0, { blur: 4, yavg: 250 }), // 过曝
    ]);
    const choice = choices.get("sb-1")!;
    expect(choice.tS).toBe(1.5);
    expect(choice.rejectedByExposure).toBe(2);
    expect(choice.candidates).toBe(1);
  });

  it("无 yavg 的帧不惩罚,仍参与清晰度打分", () => {
    const choices = pickShotFrameTimes([SPANS[0]], [point(1.2, { blur: 1.5 }), point(2, { blur: 6, yavg: 100 })]);
    expect(choices.get("sb-1")!.tS).toBe(1.2);
  });

  it("blur 缺分的镜回退镜中点并写明原因(不许冒充挑成了)", () => {
    const choices = pickShotFrameTimes([SPANS[0]], [point(1.0, { yavg: 100 }), point(2, {})]);
    expect(choices.get("sb-1")).toMatchObject({
      basis: "midpoint-fallback",
      tS: 2,
      candidates: 0,
      reason: "镜内候选全部无清晰度分或出曝光窗",
    });
  });

  it("镜内无采样点 → 中点兜底,原因区分于「全部被剔」", () => {
    const choices = pickShotFrameTimes([SPANS[0]], [point(9, { blur: 1 })]);
    expect(choices.get("sb-1")).toMatchObject({
      basis: "midpoint-fallback",
      tS: 2,
      reason: "镜内无逐帧采样点(L2 采样步长覆盖不到)",
    });
  });

  it("平票取离镜中点(2.0s)近的,且与输入顺序无关", () => {
    const input = [point(1.4, { blur: 3 }), point(2.8, { blur: 3 })];
    expect(pickShotFrameTimes([SPANS[0]], input).get("sb-1")!.tS).toBe(1.4);
    expect(pickShotFrameTimes([SPANS[0]], [...input].reverse()).get("sb-1")!.tS).toBe(1.4);
  });

  it("短镜不内缩:整镜都是候选", () => {
    const short: ChapterQcShotSpan = { shotId: "sb-9", ordinal: 9, startS: 0, endS: 0.5, durationS: 0.5 };
    const choices = pickShotFrameTimes([short], [point(0.05, { blur: 7 }), point(0.45, { blur: 1 })]);
    expect(choices.get("sb-9")).toMatchObject({ basis: "sharpest-in-shot", tS: 0.45, candidates: 2 });
  });

  it("重叠转场窗按各自镜内缩窗计:sb-2 不取 3.35 之前的帧", () => {
    const choices = pickShotFrameTimes(SPANS, [
      point(3.1, { blur: 0.2 }), // 落在 sb-1 内缩窗 [0.35,3.65) 内,sb-2 窗 [3.35,5.65) 外
      point(3.6, { blur: 9 }), // 两镜窗内都算,但最糊
      point(4.6, { blur: 1.2 }),
    ]);
    expect(choices.get("sb-1")!.tS).toBe(3.1);
    expect(choices.get("sb-2")!.tS).toBe(4.6);
    expect(choices.get("sb-2")!.candidates).toBe(2);
  });

  it("describeFrameChoices 分开计挑成与兜底", () => {
    const choices = pickShotFrameTimes(SPANS, [point(1.5, { blur: 2 }), point(4.5, { blur: 3, yavg: 5 })]);
    const stats = describeFrameChoices(choices);
    expect(stats).toMatchObject({ picked: 1, fallback: 1, total: 2, rejected: 1 });
  });

  it("曝光窗可覆盖(暗戏镜放宽后不再全剔)", () => {
    const points = [point(1.5, { blur: 2, yavg: 12 })];
    expect(pickShotFrameTimes([SPANS[0]], points).get("sb-1")!.basis).toBe("midpoint-fallback");
    expect(
      pickShotFrameTimes([SPANS[0]], points, { exposureWindow: [8, 245] }).get("sb-1"),
    ).toMatchObject({ basis: "sharpest-in-shot", rejectedByExposure: 0 });
  });
});
