import { describe, expect, it, vi } from "vitest";
import {
  applyAIAnalysis,
  normalizeScriptFormat,
  preprocessLineBreaks,
  type ScriptStructureAnalysis,
} from "./script-normalizer";

function analysis(overrides: Partial<ScriptStructureAnalysis>): ScriptStructureAnalysis {
  return {
    title: "",
    era: "",
    genre: "",
    hasOutline: false,
    generatedOutline: "",
    characterSectionKeyword: "",
    outlineSectionKeyword: "",
    ...overrides,
  };
}

describe("preprocessLineBreaks", () => {
  it("inserts line breaks before compact episode, scene, and action markers", () => {
    const result = preprocessLineBreaks("开头第1集：初遇1-1 日 内 张家△雨落");

    expect(result).toEqual({
      inserted: true,
      text: "开头\n第1集：初遇\n1-1 日 内 张家\n△雨落",
    });
  });

  it("leaves already formatted short lines unchanged", () => {
    const text = ["《测》", "大纲：故事", "人物小传：", "甲：勇敢", "第1集：开端", "1-1 日 内 家"].join("\n");

    expect(preprocessLineBreaks(text)).toEqual({ text, inserted: false });
  });
});

describe("normalizeScriptFormat", () => {
  it("is idempotent for standard script structure markers", () => {
    const text = "《测》\n大纲：故事\n人物小传：\n甲：勇敢";

    expect(normalizeScriptFormat(text)).toEqual({ normalized: text, changes: [] });
  });

  it("normalizes explicit sections and nonstandard episode markers", () => {
    const result = normalizeScriptFormat(
      ["我的剧本", "故事简介：成长", "人物介绍：", "第1章：开端", "第2幕：冲突", "EP.3:收尾"].join("\n"),
    );

    expect(result.normalized).toContain("《我的剧本》");
    expect(result.normalized).toContain("大纲：成长");
    expect(result.normalized).toContain("人物小传：");
    expect(result.normalized).toContain("第1集：开端");
    expect(result.normalized).toContain("第2集：冲突");
    expect(result.normalized).toContain("第3集：收尾");
    expect(result.changes).toEqual(
      expect.arrayContaining([
        '标题: "我的剧本" → 《我的剧本》',
        '集标记: 非标准集标记已归一化为"第X集"格式',
      ]),
    );
  });

  it("inserts an empty outline before a detected character section", () => {
    const result = normalizeScriptFormat("《测》\n张明：年龄：35\n第1集：开端");

    expect(result.normalized).toBe("《测》\n大纲：\n\n人物小传：\n张明：年龄：35\n第1集：开端");
    expect(result.changes).toEqual(
      expect.arrayContaining([
        '人物小传标记: 在角色描述"张明：年龄：..."前插入',
        "大纲标记: 插入空大纲（未找到大纲内容）",
      ]),
    );
  });
});

describe("applyAIAnalysis", () => {
  it("does not insert an episode title as the script title", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = applyAIAnalysis(
        "第一集 初遇\n大纲：已有\n人物小传：\n甲：勇敢",
        analysis({ title: "第一集 初遇", hasOutline: true }),
      );

      expect(result.normalized).not.toContain("《第一集 初遇》");
      expect(result.changes).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("inserts generated outlines while preventing episode marker collisions", () => {
    const aiAnalysis = analysis({
      title: "测",
      hasOutline: false,
      generatedOutline: "第1集：初遇",
    });

    const result = applyAIAnalysis("《测》\n人物小传：\n甲：勇敢", aiAnalysis);

    expect(result.normalized).toBe("《测》\n大纲：\n第1话：初遇\n\n人物小传：\n甲：勇敢");
    expect(result.normalized).not.toContain("第1集：初遇");
    expect(result.aiAnalysis).toBe(aiAnalysis);
  });
});
