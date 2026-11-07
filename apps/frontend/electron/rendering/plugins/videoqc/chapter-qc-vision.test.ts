import { describe, expect, it } from "vitest";
import { buildVisionDecisions, checkTransitionDensity, registerFaceCropFrames, visionSamplePoints, runVisionLayer } from "./chapter-qc-vision";
import { buildVisionPreflightCalls } from "@/lib/studio/qc/vision-preflight-runner";
import type { ChapterQcFaceCropV1 } from "./chapter-qc-types";
import type { ChapterQcVisionFrameRecord } from "./chapter-qc-vision";
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

describe("L5 物料 ↔ 渲染端预审调用数(缺证门的算术前提)", () => {
  const spans: ChapterQcShotSpan[] = [
    { shotId: "sb-1", ordinal: 1, startS: 0, endS: 4, durationS: 4 },
    { shotId: "sb-2", ordinal: 2, startS: 3.2, endS: 6.2, durationS: 3 },
    { shotId: "sb-3", ordinal: 3, startS: 5.4, endS: 9, durationS: 3.6 },
    { shotId: "sb-4", ordinal: 4, startS: 8.2, endS: 11.2, durationS: 3 },
  ];
  const transitions = [
    { fromClipId: "c1", toClipId: "c2", effectId: "gl:swap", durationUs: 800_000 },
    { fromClipId: "c2", toClipId: "c3", effectId: "gl:zoom", durationUs: 800_000 },
    { fromClipId: "c3", toClipId: "c4", effectId: "gl:swap", durationUs: 800_000 },
  ];

  it("每个探针帧恰一次单帧调用、每对相邻镜恰一次成对调用,总数=帧数+决策数-1", () => {
    const points = visionSamplePoints(spans);
    // 4 镜中帧 + 3 组完整 pre/blend/post(转场窗足够宽,一个都没被裁掉)
    expect(points.filter((point) => point.kind === "mid")).toHaveLength(4);
    expect(points).toHaveLength(13);

    const frames = points.map((point, index) => ({ ...point, frameUrl: `f-${index}` }));
    const decisions = buildVisionDecisions({
      spans,
      visualClipIds: ["c1", "c2", "c3", "c4"],
      descriptionsByShotId: new Map(spans.map((span) => [span.shotId, `第 ${span.ordinal} 镜`])),
      transitions,
      effects: [],
    });
    const calls = buildVisionPreflightCalls(frames, decisions);

    // chapter-qc-verdicts.ts 的 expectedCalls 就写死这个等式;L5 改抽帧点而这里没跟着动,
    // 看板会把「查得不够」误判成缺证(或反过来放行)。
    expect(decisions).toHaveLength(4);
    expect(calls).toHaveLength(frames.length + decisions.length - 1);
    const frameCalls = calls.filter((call) => call.kind === "frame");
    expect(frameCalls).toHaveLength(frames.length);
    expect(new Set(frameCalls.flatMap((call) => call.frames.map((frame) => frame.frameUrl))).size)
      .toBe(frames.length);
    expect(calls.filter((call) => call.kind === "pair")).toHaveLength(decisions.length - 1);
  });

  it("极短镜抽不出探针帧时,只断掉自己的配对链,不牵连其余镜的调用", () => {
    const withShort: ChapterQcShotSpan[] = [
      ...spans,
      { shotId: "sb-5", ordinal: 5, startS: 11.2, endS: 11.28, durationS: 0.08 },
    ];
    const points = visionSamplePoints(withShort);
    // 0.08s 的镜容不下 mid(±0.05s 边界),4→5 又是硬切,pre/blend/post 凑不齐一组
    expect(points.filter((point) => point.ordinal === 5)).toHaveLength(0);

    const decisions = buildVisionDecisions({
      spans: withShort,
      visualClipIds: ["c1", "c2", "c3", "c4", "c5"],
      descriptionsByShotId: new Map(),
      transitions: [...transitions, { fromClipId: "c4", toClipId: "c5", effectId: "gl:zoom", durationUs: 100_000 }],
      effects: [],
    });
    const calls = buildVisionPreflightCalls(points.map((point, index) => ({ ...point, frameUrl: `s-${index}` })), decisions);
    // 断链只发生在 4→5;1→2→3→4 三对与每个探针帧的单帧调用照常(缺证由 verdicts 点名第 5 镜)
    expect(calls.filter((call) => call.kind === "pair")).toHaveLength(3);
    expect(calls.filter((call) => call.kind === "pair").every((call) => !call.frames.some((frame) => frame.ordinal === 5)))
      .toBe(true);
    expect(calls.filter((call) => call.kind === "frame")).toHaveLength(points.length);
  });

  it("头部特写并入帧物料后仍是「每帧恰一次调用」,expectedCalls 等式不许破", () => {
    const points = visionSamplePoints(spans);
    const mid = points.filter((point) => point.kind === "mid");
    const frames: ChapterQcVisionFrameRecord[] = points.map((point, index) => ({ ...point, frameUrl: `f-${index}` }));
    const cropFrames = registerFaceCropFrames(frames, {
      available: true,
      crops: mid.map((_, index) => ({
        index,
        tS: mid[index].tS,
        status: "crop" as const,
        file: `face-crop-${String(index).padStart(3, "0")}.jpg`,
      })),
    }, { projectId: "p1", chapterId: "chapter-001" });
    expect(cropFrames).toHaveLength(mid.length);

    const decisions = buildVisionDecisions({
      spans,
      visualClipIds: ["c1", "c2", "c3", "c4"],
      descriptionsByShotId: new Map(),
      transitions,
      effects: [],
    });
    const all = [...frames, ...cropFrames];
    const calls = buildVisionPreflightCalls(all, decisions);
    expect(calls).toHaveLength(all.length + decisions.length - 1);
    expect(calls.filter((call) => call.kind === "frame" && call.frames[0]?.kind === "face")).toHaveLength(mid.length);
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

  it("探针帧上限 1280(1102):1080P 成片不许在送模型前被压回 768", async () => {
    const argsList: string[][] = [];
    const runner = async (_file: string, args: string[]) => {
      argsList.push(args);
      return { stdout: "", stderr: "" };
    };
    await runVisionLayer({
      projectId: "p1", chapterId: "chapter-001", videoPath: "/tmp/v.mp4",
      spans, transitions: [], visualClipIds: ["c1", "c2"],
      reportDir: "/tmp/qc-report", runner,
    });
    expect(argsList).toHaveLength(5);
    for (const args of argsList) {
      expect(args[args.indexOf("-vf") + 1]).toBe("scale='min(1280,iw)':-2");
      expect(args).toContain("-q:v");
    }
  });
});

describe("registerFaceCropFrames(1107 吸收件②:裁片落进 vision-frames 供渲染端读)", () => {
  const mid: ChapterQcVisionFrameRecord[] = [
    { shotId: "sb-1", ordinal: 1, kind: "mid", tS: 2, frameUrl: "u-mid-1" },
    { shotId: "sb-2", ordinal: 2, kind: "mid", tS: 4.7, frameUrl: "u-mid-2" },
  ];
  const crop = (index: number, overrides: Partial<ChapterQcFaceCropV1>): ChapterQcFaceCropV1 => ({
    index,
    tS: mid[index]?.tS ?? 0,
    status: "crop",
    file: `face-crop-${String(index).padStart(3, "0")}.jpg`,
    ...overrides,
  });

  it("出成的裁片挂在探针帧同一目录,时刻/镜号跟着中帧锚点", () => {
    const frames = registerFaceCropFrames(mid, { available: true, crops: [crop(0, {}), crop(1, {})] }, { projectId: "p1", chapterId: "c-01" });
    expect(frames).toEqual([
      { shotId: "sb-1", ordinal: 1, kind: "face", tS: 2, frameUrl: expect.stringContaining("remotion/qc/chapters/c-01/vision-frames/face-crop-000.jpg") },
      { shotId: "sb-2", ordinal: 2, kind: "face", tS: 4.7, frameUrl: expect.stringContaining("vision-frames/face-crop-001.jpg") },
    ]);
  });

  it("no-face / read-failed / 缺 file 都不造帧:空证据与坏台账不许冒充一张图", () => {
    const frames = registerFaceCropFrames(mid, { available: true, crops: [
      crop(0, { status: "no-face" }),
      crop(1, { status: "read-failed" }),
      { ...crop(0, {}), file: undefined },
    ] }, { projectId: "p1", chapterId: "c-01" });
    expect(frames).toHaveLength(0);
  });

  it("台账 index 超出中帧范围(请求与台账错位)→ 该条不出帧,由编排器按 gaps 记缺证", () => {
    const frames = registerFaceCropFrames(mid, { available: true, crops: [crop(7, {})] }, { projectId: "p1", chapterId: "c-01" });
    expect(frames).toHaveLength(0);
  });

  // 认领口径是 index:批次被判定不采信时,每条裁片挂到哪一镜已经不可知。
  // 这时照旧注册=用别的镜的脸替这镜回答「五官没问题」,正是本层最禁的那种假证据。
  it("整批不采信 → 一条都不注册,哪怕台账里每条看着都完好", () => {
    const frames = registerFaceCropFrames(mid, {
      available: false,
      crops: [crop(1, { tS: 2 }), crop(0, { tS: 4.7 })],
    }, { projectId: "p1", chapterId: "c-01" });
    expect(frames).toEqual([]);
  });
});
