import { describe, expect, it, vi } from "vitest";
import {
  buildVisionPreflightTasks,
  parseVisionPreflightReply,
  runVisionPreflight,
  type VisionPreflightDecisionInput,
  type VisionPreflightFrameInput,
} from "./vision-preflight-runner";

const frames: VisionPreflightFrameInput[] = [
  { shotId: "s1", ordinal: 1, kind: "mid", tS: 2, frameUrl: "mid-1" },
  { shotId: "s1", ordinal: 1, kind: "pre", tS: 3.6, frameUrl: "pre-1" },
  { shotId: "s1", ordinal: 1, kind: "blend", tS: 3.8, frameUrl: "blend-1" },
  { shotId: "s2", ordinal: 2, kind: "post", tS: 4.1, frameUrl: "post-2" },
  { shotId: "s2", ordinal: 2, kind: "mid", tS: 5, frameUrl: "mid-2" },
];

const decisions: VisionPreflightDecisionInput[] = [
  {
    shotId: "s1",
    ordinal: 1,
    description: "晏燎拔剑",
    effects: [{ effectId: "atmosphere", template: "atmo:fog-band" }],
    outgoingTransition: { toShotId: "s2", toOrdinal: 2, effectId: "gl:swap", durationS: 0.8 },
  },
  { shotId: "s2", ordinal: 2, description: "敌人后退", effects: [] },
];

describe("buildVisionPreflightTasks", () => {
  it("按 ordinal 组成 mid 单帧与 pre/blend/post 边界三帧，不靠数组相邻猜测", () => {
    const tasks = buildVisionPreflightTasks([...frames].reverse(), decisions);
    expect(tasks.filter((task) => task.kind === "shot")).toHaveLength(2);
    const boundary = tasks.find((task) => task.kind === "boundary");
    expect(boundary?.frames.map((frame) => frame.kind)).toEqual(["pre", "blend", "post"]);
    expect(boundary?.decision?.outgoingTransition).toMatchObject({ effectId: "gl:swap", toOrdinal: 2 });
  });

  it("边界缺任一帧时不创建转场任务", () => {
    const tasks = buildVisionPreflightTasks(frames.filter((frame) => frame.kind !== "blend"), decisions);
    expect(tasks.some((task) => task.kind === "boundary")).toBe(false);
  });
});

describe("parseVisionPreflightReply", () => {
  it("解析围栏 JSON，并拒绝契约外 code/severity", () => {
    expect(parseVisionPreflightReply('```json\n{"pass":false,"issues":[{"code":"subtitle-obstruction","severity":"warn","reason":"字幕遮住人物"}]}\n```')).toEqual({
      pass: false,
      issues: [{ code: "subtitle-obstruction", severity: "warn", reason: "字幕遮住人物" }],
    });
    expect(parseVisionPreflightReply('{"pass":false,"issues":[{"code":"unknown","severity":"critical","reason":"x"}]}')).toBeNull();
  });
});

describe("runVisionPreflight", () => {
  it("聚合 findings，保留 vision-preflight 来源和决策证据", async () => {
    const outcome = await runVisionPreflight({
      frames,
      decisions,
      readFrameDataUrl: async (url) => `data:image/jpeg;base64,${url}`,
      call: async (messages) => JSON.stringify({
        pass: false,
        issues: [{ code: "decorative-clutter", severity: "warn", reason: "雾效遮住主体" }],
        messages,
      }),
    });
    expect(outcome.findings.length).toBeGreaterThan(0);
    expect(outcome.findings[0]).toMatchObject({
      code: "chapter-qc.vision.preflight.decorative-clutter",
      layer: "vision",
      severity: "warn",
      evidence: { source: "vision-preflight" },
    });
  });

  it("maxCalls 按实际 provider 调用计数，解析失败重试也占预算", async () => {
    const call = vi.fn(async () => "无法解析");
    const outcome = await runVisionPreflight({
      frames: [frames[0]],
      decisions,
      maxCalls: 1,
      readFrameDataUrl: async () => "data:image/jpeg;base64,x",
      call,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.results[0]?.status).toBe("unparsed");
    expect(outcome.stats).toEqual({ checked: 0, passed: 0, failed: 0, skipped: 1 });
  });

  it("读帧失败或 provider 异常均诚实 skipped 且不抛错", async () => {
    const unreadableCall = vi.fn(async () => '{"pass":true,"issues":[]}');
    const unreadable = await runVisionPreflight({
      frames: [frames[0]],
      decisions,
      readFrameDataUrl: async () => null,
      call: unreadableCall,
    });
    expect(unreadableCall).not.toHaveBeenCalled();
    expect(unreadable.stats.skipped).toBe(1);

    const failed = await runVisionPreflight({
      frames: [frames[0]],
      decisions,
      readFrameDataUrl: async () => "data:image/jpeg;base64,x",
      call: async () => { throw new Error("provider down"); },
    });
    expect(failed.stats.skipped).toBe(1);
  });
});
