// @vitest-environment jsdom
/**
 * polishAssetPrompt 输出格式契约测试 — 手册规定三段输出(中文描述/正文/Negative Prompt),
 * parsePolishResult 按同名标签抽取;本测试用真实种子手册 + mock LLM 验证端到端抽取与道劫清洗。
 */
import { describe, expect, it, vi } from "vitest";
import { polishAssetPrompt } from "./prompt-polisher";

vi.mock("@/lib/bridge/studio-visual-manuals", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(
    process.cwd(),
    "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng",
  );
  const manual = {
    success: true,
    manual: {
      modules: [
        { value: "prefix", content: readFileSync(join(dir, "prefix.md"), "utf-8") },
        { value: "art_character", content: readFileSync(join(dir, "art_prompt/art_character.md"), "utf-8") },
      ],
    },
  };
  return {
    getStudioVisualManualsBridge: () => ({
      read: async () => manual,
    }),
  };
});

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureText: vi.fn().mockResolvedValue(
      [
        "中文描述: 一名清冷出尘的女修四视图设定图,工笔线描,宣纸质感。",
        "",
        "古风女性角色四视图设定图,水墨国风,修仙古韵,工笔线描,写意晕染,宣纸质感,character design sheet, character turnaround,",
        "清冷出尘气质,素颜状态,玉白基调,长发及腰,cinematic lighting, shallow depth of field,",
        "同一画面左至右并排:人像特写+正视图+侧视图+后视图,full body head to toe,四视图一致性",
        "",
        "Negative Prompt: photorealistic photography, 3D render, cel shading, text, watermark, extra characters",
      ].join("\n"),
    ),
    text: vi.fn().mockResolvedValue({ success: false }),
  },
}));

describe("polishAssetPrompt 输出格式契约(道劫)", () => {
  it("按中文描述/Negative Prompt 标签抽取,并施加道劫清洗", async () => {
    const result = await polishAssetPrompt({
      assetType: "character",
      name: "林霜",
      description: "清冷出尘的女修,剑意凌厉",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    // 中文描述按标签抽取
    expect(result.promptZh).toContain("清冷出尘的女修四视图");
    // 正文保留模板主体
    expect(result.prompt).toContain("水墨国风");
    expect(result.prompt).toContain("character turnaround");
    // 道劫清洗生效:cinematic/景深词被改写为水墨等效表达
    expect(result.prompt).not.toContain("cinematic lighting");
    expect(result.prompt).not.toContain("depth of field");
    expect(result.prompt).toContain("even flat diffuse illumination");
    // 手册严禁项经 Negative Prompt 标签激活
    expect(result.negativePrompt).toContain("photorealistic photography");
    expect(result.negativePrompt).toContain("extra characters");
  });
});
