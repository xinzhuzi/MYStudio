import { describe, expect, it } from "vitest";
import {
  aggregateSemanticResults,
  buildSemanticPrompt,
  parseSemanticReply,
  runSemanticQcLayer,
  type SemanticQcShotInput,
  type SemanticQcShotResult,
} from "./semantic-runner";

describe("buildSemanticPrompt", () => {
  it("含镜序/描述/严格 JSON 指令", () => {
    const prompt = buildSemanticPrompt({ shotId: "s1", ordinal: 3, frameUrl: "u", description: "晏燎在道口镇拔剑" }, 43);
    expect(prompt).toContain("第 3/43 镜");
    expect(prompt).toContain("晏燎在道口镇拔剑");
    expect(prompt).toContain("JSON");
  });
});

describe("parseSemanticReply", () => {
  it("裸 JSON / 围栏 / 带噪声均可解析", () => {
    expect(parseSemanticReply('{"pass": true, "reason": "一致"}')).toEqual({ pass: true, reason: "一致" });
    expect(parseSemanticReply('```json\n{"pass": false, "reason": "人物不符"}\n```')).toEqual({ pass: false, reason: "人物不符" });
    expect(parseSemanticReply('好的,结论如下:\n{"pass": true, "reason": "ok"}\n以上。')).toEqual({ pass: true, reason: "ok" });
  });

  it("无 JSON / pass 非布尔返回 null", () => {
    expect(parseSemanticReply("画面看起来不错")).toBeNull();
    expect(parseSemanticReply('{"pass": "yes"}')).toBeNull();
  });
});

describe("aggregateSemanticResults", () => {
  it("单镜 fail → warn finding;连败≥3 → 章节 suspect blocker", () => {
    const results: SemanticQcShotResult[] = [
      { shotId: "s1", ordinal: 1, status: "pass" },
      { shotId: "s2", ordinal: 2, status: "fail", reason: "场景不符" },
      { shotId: "s3", ordinal: 3, status: "fail", reason: "人物不符" },
      { shotId: "s4", ordinal: 4, status: "fail", reason: "动作不符" },
    ];
    const { findings, stats } = aggregateSemanticResults(results);
    expect(stats).toEqual({ checked: 4, passed: 1, failed: 3, skipped: 0 });
    expect(findings.filter((f) => f.code === "chapter-qc.semantic.shot-mismatch")).toHaveLength(3);
    const suspect = findings.find((f) => f.code === "chapter-qc.semantic.chapter-suspect");
    expect(suspect?.severity).toBe("blocker");
  });

  it("散点低 fail 率不升级", () => {
    const results: SemanticQcShotResult[] = Array.from({ length: 20 }, (_, index) => ({
      shotId: `s${index}`,
      ordinal: index + 1,
      status: (index === 5 || index === 14 ? "fail" : "pass") as "fail" | "pass",
    }));
    const { findings } = aggregateSemanticResults(results);
    expect(findings.some((f) => f.code === "chapter-qc.semantic.chapter-suspect")).toBe(false);
  });
});

describe("runSemanticQcLayer", () => {
  const shots: SemanticQcShotInput[] = [
    { shotId: "s1", ordinal: 1, frameUrl: "f1", description: "镜一" },
    { shotId: "s2", ordinal: 2, frameUrl: "f2", description: "" },
    { shotId: "s3", ordinal: 3, frameUrl: "f3", description: "镜三" },
  ];

  it("无描述镜跳过;正常镜问答聚合", async () => {
    const outcome = await runSemanticQcLayer({
      shots,
      call: async () => '{"pass": true, "reason": "ok"}',
      readFrameDataUrl: async () => "data:image/jpeg;base64,xx",
    });
    expect(outcome.stats).toEqual({ checked: 2, passed: 2, failed: 0, skipped: 1 });
  });

  it("帧读取失败镜跳过不调用模型", async () => {
    let calls = 0;
    const outcome = await runSemanticQcLayer({
      shots,
      call: async () => {
        calls += 1;
        return '{"pass": true}';
      },
      readFrameDataUrl: async () => null,
    });
    expect(calls).toBe(0);
    expect(outcome.stats.skipped).toBe(3);
  });

  it("费用护栏:超 maxCalls 的镜跳过", async () => {
    const outcome = await runSemanticQcLayer({
      shots,
      maxCalls: 1,
      call: async () => '{"pass": true}',
      readFrameDataUrl: async () => "data:",
    });
    expect(outcome.stats).toEqual({ checked: 1, passed: 1, failed: 0, skipped: 2 });
  });

  it("不可解析回复重试一次后记 unparsed(不计 fail)", async () => {
    let calls = 0;
    const outcome = await runSemanticQcLayer({
      shots: [shots[0]],
      call: async () => {
        calls += 1;
        return "看不懂";
      },
      readFrameDataUrl: async () => "data:",
    });
    expect(calls).toBe(2);
    expect(outcome.results[0].status).toBe("unparsed");
    expect(outcome.stats.failed).toBe(0);
  });
});
