import { describe, expect, it } from "vitest";
import {
  latestAgentWork,
  scriptPlanSourceFingerprint,
  stableRunFingerprint,
} from "./workflow-helpers";

describe("latestAgentWork chapter isolation", () => {
  const records = [
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-1",
      data: "第一章分镜",
      updatedAt: 1,
    },
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-2",
      data: "第二章分镜",
      updatedAt: 2,
    },
  ];

  it("returns the current chapter record when it exists", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-1")).toBe("第一章分镜");
  });

  it("does not fall back to another chapter in strict mode", () => {
    expect(
      latestAgentWork(records, "storyboardTable", "chapter-3", {
        allowUnscopedFallback: false,
      }),
    ).toBe("");
  });

  it("keeps legacy unscoped fallback opt-in for non-storyboard callers", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-3")).toBe("第二章分镜");
  });
});

describe("scriptPlanSourceFingerprint 预划剧本锚(二期 R1)", () => {
  it("stableRunFingerprint 对对象 key 顺序不敏感(确定性序列化)", () => {
    expect(stableRunFingerprint({ b: 1, a: { y: 2, x: 3 } }))
      .toBe(stableRunFingerprint({ a: { x: 3, y: 2 }, b: 1 }));
  });

  it("同章同剧本 → 同指纹;剧本改一个字或换章 → 指纹变", () => {
    const base = scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头。");
    expect(scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头。")).toBe(base);
    expect(scriptPlanSourceFingerprint("chapter-001", "第一场金水河码头!")).not.toBe(base);
    expect(scriptPlanSourceFingerprint("chapter-002", "第一场金水河码头。")).not.toBe(base);
  });

  it("指纹只含章 id 与剧本正文,不含人工指令字段", () => {
    const episodeId = "chapter-001";
    const scriptText = "第一场金水河码头。";
    const parsed = JSON.parse(scriptPlanSourceFingerprint(episodeId, scriptText)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["episodeId", "scriptText"]);
  });
});
