import { describe, expect, it } from "vitest";
import {
  buildMentionToken,
  filterMentionCandidates,
  mentionTriggerState,
  resolveMentionTokens,
} from "./mention-token";

const NODES = {
  ref1: { id: "ref1", type: "reference", title: "赵四正脸" },
  ref2: { id: "ref2", type: "reference", title: "断剑道具" },
  gen1: { id: "gen1", type: "generated", title: "成图 A" },
  p1: { id: "p1", type: "prompt", title: "主提示词" },
} as const;

describe("resolveMentionTokens", () => {
  it("图/文本各自按连线序独立编号", () => {
    const prompt = `参考 ${buildMentionToken(NODES.ref1)} 和 ${buildMentionToken(NODES.ref2)},风格见 ${buildMentionToken(NODES.gen1)},要求 ${buildMentionToken(NODES.p1)}`;
    const { text, missing } = resolveMentionTokens(prompt, (id) => (NODES as Record<string, { id: string; type: string; title: string }>)[id]);
    expect(text).toBe("参考 图1 和 图2,风格见 图3,要求 文本1");
    expect(missing).toBe(0);
  });

  it("断连保留原文并计数降级", () => {
    const prompt = `用 ${buildMentionToken(NODES.ref1)} 和 @[已删节点](ref:gone)`;
    const { text, missing } = resolveMentionTokens(prompt, (id) => id === "ref1" ? NODES.ref1 : undefined);
    expect(text).toContain("图1");
    expect(text).toContain("@[已删节点](ref:gone)");
    expect(missing).toBe(1);
  });

  it("无令牌原文直返零成本", () => {
    expect(resolveMentionTokens("普通提示词", () => undefined)).toEqual({
      text: "普通提示词",
      missing: 0,
    });
  });
});

describe("mentionTriggerState", () => {
  it("输入 @ 或 @词 触发;@@ 不触发;行中 @ 触发", () => {
    expect(mentionTriggerState("@", 1)).toEqual({ active: true, query: "" });
    expect(mentionTriggerState("@赵", 2)).toEqual({ active: true, query: "赵" });
    expect(mentionTriggerState("前文 @剑", 5).active).toBe(true);
    expect(mentionTriggerState("email@host", 10).active).toBe(false);
    expect(mentionTriggerState("没有符号", 5).active).toBe(false);
  });
});

describe("filterMentionCandidates", () => {
  it("标题/摘要模糊过滤", () => {
    const candidates = [
      { id: "a", type: "reference", title: "赵四正脸", summary: "角色参考" },
      { id: "b", type: "prompt", title: "主提示词", summary: "" },
    ];
    expect(filterMentionCandidates(candidates, "赵")).toHaveLength(1);
    expect(filterMentionCandidates(candidates, "参考")).toHaveLength(1);
    expect(filterMentionCandidates(candidates, "")).toHaveLength(2);
  });
});

describe("buildMentionToken 转义", () => {
  it("标题含 ] 不破语法", () => {
    const token = buildMentionToken({ id: "x", type: "prompt", title: "含]标题" });
    expect(token).toBe("@[含\uff3d标题](ref:x)");
    expect(resolveMentionTokens(`见 ${token} 完`, () => ({ id: "x", type: "prompt", title: "含]标题" })).text)
      .toBe("见 文本1 完");
  });
});
