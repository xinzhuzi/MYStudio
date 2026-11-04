import { describe, expect, it, vi } from "vitest";
import {
  ASSEMBLY_ISSUE_CODES,
  CHARACTER_INTEGRITY_ISSUE_CODES,
  COHERENCE_ISSUE_CODES,
  TEXT_INTEGRITY_ISSUE_CODES,
  VISION_PREFLIGHT_ISSUE_CODES,
  buildVisionPreflightCalls,
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

  it("1102 新码全部收进契约:形体/文字/跨镜三组都要能被解析", () => {
    for (const code of ["face-anomaly", "hand-anomaly", "pose-anomaly", "lip-sync-suspect",
      "text-garbled", "identity-drift", "style-inconsistency"]) {
      expect(parseVisionPreflightReply(`{"pass":false,"issues":[{"code":"${code}","severity":"blocker","reason":"r"}]}`), code)
        .toEqual({ pass: false, issues: [{ code, severity: "blocker", reason: "r" }] });
    }
    expect(VISION_PREFLIGHT_ISSUE_CODES).toHaveLength(11);
    expect([...ASSEMBLY_ISSUE_CODES, ...CHARACTER_INTEGRITY_ISSUE_CODES, ...TEXT_INTEGRITY_ISSUE_CODES, ...COHERENCE_ISSUE_CODES].sort())
      .toEqual([...VISION_PREFLIGHT_ISSUE_CODES].sort());
  });
});

describe("buildVisionPreflightCalls(1102:单帧 + 相邻镜成对)", () => {
  it("每探针帧一次单帧调用,再为相邻 mid 追加成对调用", () => {
    const calls = buildVisionPreflightCalls(frames, decisions);
    expect(calls.filter((call) => call.kind === "frame")).toHaveLength(frames.length);
    const pairs = calls.filter((call) => call.kind === "pair");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.frames.map((frame) => frame.ordinal)).toEqual([1, 2]);
  });

  it("成对 prompt 只放跨镜两条码,并写明「两张图按先后顺序」", () => {
    const pair = buildVisionPreflightCalls(frames, decisions).find((call) => call.kind === "pair");
    expect(pair?.prompt).toContain("两张图按先后顺序给出");
    expect(pair?.prompt).toContain("identity-drift|style-inconsistency");
    expect(pair?.prompt).not.toContain("hand-anomaly");
    // 漂移误伤防线:不同角色同现属正常叙事
    expect(pair?.prompt).toContain("不算漂移");
  });

  it("单帧 prompt 带上新崩坏维与「看不清不要硬判」", () => {
    const shotCall = buildVisionPreflightCalls(frames, decisions).find((call) => call.id === "shot:1:mid");
    expect(shotCall?.prompt).toContain("hand-anomaly");
    expect(shotCall?.prompt).toContain("text-garbled");
    expect(shotCall?.prompt).toContain("看不清的细节不要硬判");
  });

  it("缺一镜 mid 时不成对(没有对照物就不问,而不是拿别的帧凑)", () => {
    const calls = buildVisionPreflightCalls(frames.filter((frame) => frame.kind !== "mid" || frame.ordinal !== 2), decisions);
    expect(calls.some((call) => call.kind === "pair")).toBe(false);
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

  it("成对调用一次送两张图,finding 锚在后一镜并留 pairTs", async () => {
    const seen: Array<{ images: number; text: string }> = [];
    const outcome = await runVisionPreflight({
      frames,
      decisions,
      readFrameDataUrl: async (url) => `data:image/jpeg;base64,${url}`,
      call: async (messages) => {
        const content = (messages[0] as { content: Array<Record<string, unknown>> }).content;
        const images = content.filter((part) => part.type === "image_url").length;
        const text = String(content.find((part) => part.type === "text")?.text ?? "");
        seen.push({ images, text });
        return text.includes("相邻两镜")
          ? '{"pass":false,"issues":[{"code":"identity-drift","severity":"warn","reason":"发型与服饰换了"}]}'
          : '{"pass":true,"issues":[]}';
      },
    });
    const pairCalls = seen.filter((call) => call.images === 2);
    expect(pairCalls).toHaveLength(1);
    expect(outcome.results.filter((result) => result.kind === "pair" && result.status === "fail")).toHaveLength(1);
    const drift = outcome.findings.find((finding) => finding.code === "chapter-qc.vision.preflight.identity-drift");
    expect(drift).toMatchObject({
      shotOrdinal: 2,
      shotId: "s2",
      severity: "warn",
      message: "第 1→2 镜跨镜一致：发型与服饰换了",
      evidence: { source: "vision-preflight", callId: "pair:1:2", pairTs: [2, 5] },
    });
  });

  it("成对中任一帧读不出→整对 skipped,不拿单帧冒充跨镜证据", async () => {
    const call = vi.fn(async () => '{"pass":true,"issues":[]}');
    const outcome = await runVisionPreflight({
      frames,
      decisions,
      readFrameDataUrl: async (url) => (url === "mid-2" ? null : "data:image/jpeg;base64,x"),
      call,
    });
    const pair = outcome.results.find((result) => result.kind === "pair");
    expect(pair).toMatchObject({ status: "skipped", reason: "探针帧读取失败" });
    // 单帧调用仍按能读到的那些跑:mid-2 读不出,其余照问
    expect(outcome.results.filter((result) => result.kind === "frame" && result.status === "skipped")).toHaveLength(1);
  });

  it("maxCalls 用尽后余下调用记 unparsed,不许翻成 pass", async () => {
    const call = vi.fn(async () => '{"pass":true,"issues":[]}');
    const outcome = await runVisionPreflight({
      frames,
      decisions,
      maxCalls: 2,
      readFrameDataUrl: async () => "data:image/jpeg;base64,x",
      call,
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(outcome.results.filter((result) => result.status === "unparsed").length).toBeGreaterThan(0);
    expect(outcome.stats.checked).toBe(2);
  });
});
