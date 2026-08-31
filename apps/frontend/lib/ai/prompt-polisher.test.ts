// @vitest-environment jsdom
/**
 * polishAssetPrompt 输出格式契约测试 — 手册规定三段输出(中文描述/正文/Negative Prompt),
 * parsePolishResult 按同名标签抽取;本测试用真实种子手册 + mock LLM 验证端到端抽取与道劫清洗。
 */
import { describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { logEvent } from "@/lib/diagnostics/logger";
import { polishAssetPrompt, sanitizeExtendedManualPrompt } from "./prompt-polisher";

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (prefix: string) => `${prefix}-test`,
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bridge/studio-visual-manuals", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  // 2026-08-22 道劫手册移至项目真源(<项目根>/skills);本机无该项目时该用例跳过内容级断言
  const dir = join(
    process.cwd(),
    "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng",
  );
  const daojieManual = {
    success: true,
    manual: {
      modules: [
        { value: "prefix", content: readFileSync(join(dir, "prefix.md"), "utf-8") },
        { value: "art_character", content: readFileSync(join(dir, "art_prompt/art_character.md"), "utf-8") },
        { value: "art_scene", content: readFileSync(join(dir, "art_prompt/art_scene.md"), "utf-8") },
        { value: "art_prop", content: readFileSync(join(dir, "art_prompt/art_prop.md"), "utf-8") },
      ],
    },
  };
  return {
    getStudioVisualManualsBridge: () => ({
      read: async (id: string) =>
        id === "daojie_ink_guofeng" ? daojieManual : { success: true, manual: { modules: [] } },
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

describe("polishAssetPrompt 道劫三轨合同(LLM 只拥有题材正文)", () => {
  it("道劫润色返回题材正文本体,不夹带自动层与通用清洁/降噪词", async () => {
    const result = await polishAssetPrompt({
      assetType: "character",
      name: "林霜",
      description: "清冷出尘的女修,剑意凌厉",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    // 题材正文由 LLM 拥有,自动层(底座/轨道/成片/负面)归编译器,不在此出现
    expect(result.daojie?.subjectBody).toBe(result.prompt);
    expect(result.prompt).not.toContain("风格底座");
    expect(result.prompt).not.toContain("TRACK=");
    expect(result.prompt).not.toContain("成片质量");
    // 编译前的题材正文不做通用 clean/denoise 追加
    expect(result.prompt).not.toContain("clean image");
    expect(result.negativePrompt).not.toContain("visual noise");
    expect(result.negativePrompt).not.toContain("dirty texture");
    // LLM 负面原样保留,等待编译期与通用负面合并
    expect(result.negativePrompt).toContain("photorealistic photography");
  });

  it.each([
    ["scene"],
    ["prop"],
  ] as const)("道劫 %s 轨同样走题材正文合同", async (assetType) => {
    const result = await polishAssetPrompt({
      assetType,
      name: "矿场入口",
      description: "夜雨中的矿场入口",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.daojie?.subjectBody).toBe(result.prompt);
    expect(result.prompt).not.toContain("风格底座");
    expect(result.prompt).not.toContain("clean image");
  });

  it("LLM 失败时道劫 fallback 构造同合同题材正文,保留原负面且不注入英文默认负面", async () => {
    vi.mocked(aiManager.featureText)
      .mockRejectedValueOnce(new Error("LLM down"))
      .mockRejectedValueOnce(new Error("LLM down"));

    const result = await polishAssetPrompt({
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
      negativePrompt: "水印",
    });

    expect(result.status).toBe("success");
    expect(result.daojie?.subjectBody).toBe(result.prompt);
    // 本地题材正文含名称/描述与道具轨职责,不再是英文逗号串
    expect(result.prompt).toContain("断剑");
    expect(result.prompt).toContain("一柄断裂的古剑");
    expect(result.prompt).not.toMatch(/^[A-Za-z0-9, .]+$/);
    expect(result.prompt).not.toContain("low quality");
    // 作业负面保留;通用负面归编译器,不在 fallback 注入
    expect(result.negativePrompt).toBe("水印");
  });

  it("AI 自动选配:LLM 第二调用返回合法方案,随题材正文一起返回", async () => {
    vi.mocked(aiManager.featureText)
      .mockResolvedValueOnce([
        "中文描述: 焚香符修。",
        "",
        "焚香仪式中的符修，朱砂法脉气质，面部与手势清晰。",
        "",
        "Negative Prompt: watermark",
      ].join("\n"))
      .mockResolvedValueOnce('{"schemeId": "person.02"}');

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "焚香符修",
      description: "主持仪式、绘制符箓",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.daojie?.schemeId).toBe("person.02");
    const decision = [...vi.mocked(logEvent).mock.calls].reverse()
      .find(([e]) => e.message.includes("palette scheme decision"));
    expect(decision?.[0].context).toMatchObject({ schemeId: "person.02", tier: "llm", maTrack: "person" });
  });

  it("防冲突:正文色彩段已写明职责色相时,选配只接受一致方案,否则 null", async () => {
    const selectionCalls: string[] = [];
    vi.mocked(aiManager.featureText)
      .mockResolvedValueOnce([
        "中文描述: 白衣剑修。",
        "",
        "白衣剑修，衣袂当风；色彩段:主色月白，辅烟灰，点睛旧银。",
        "",
        "Negative Prompt: watermark",
      ].join("\n"))
      .mockImplementationOnce(async (_f: unknown, _s: unknown, user: string) => {
        selectionCalls.push(String(user));
        return '{"schemeId": null}';
      });

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "林霜",
      description: "主持仪式、绘制符箓的剑修",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    // 选配 prompt 必须携带题材正文(色彩段可见)
    expect(selectionCalls[0]).toContain("主色月白");
    // 与正文职责色不一致 → 显式 null → 不带方案(避免同框双主色)
    expect(result.daojie?.schemeId).toBeUndefined();
    const decision = [...vi.mocked(logEvent).mock.calls].reverse()
      .find(([e]) => e.message.includes("palette scheme decision"));
    expect(decision?.[0].context).toMatchObject({ schemeId: null, tier: "llm" });
  });

  it("AI 选配失败降级规则预筛,再降级 source-facts-only,不阻断润色", async () => {
    vi.mocked(aiManager.featureText)
      .mockResolvedValueOnce([
        "中文描述: 器物。",
        "",
        "丹炉一尊，铜质，炉口衔环。",
        "",
        "Negative Prompt: watermark",
      ].join("\n"))
      .mockRejectedValueOnce(new Error("选配模型不可用"))
      .mockRejectedValueOnce(new Error("选配模型不可用"));

    const result = await polishAssetPrompt({
      assetType: "prop",
      name: "丹炉",
      description: "炼制丹药的铜炉，无关键词命中方案",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.daojie?.subjectBody).toContain("丹炉");
    // 预筛零命中 → 不带 schemeId(source-facts-only)
    expect(result.daojie?.schemeId).toBeUndefined();
  });

  it("非道劫手册保持既有 enhanced normalize 行为", async () => {
    const result = await polishAssetPrompt({
      assetType: "character",
      name: "林霜",
      description: "清冷出尘的女修",
      isDerivative: false,
      visualManualId: "2d_shonen",
    });

    expect(result.status).toBe("success");
    expect(result.daojie).toBeUndefined();
    expect(result.prompt).toContain("clean image");
    expect(result.negativePrompt).toContain("visual noise");
  });
});

describe("sanitizeExtendedManualPrompt 旧压色 token 升级(08-28 无色根修)", () => {
  it("存量旧 token 彩色化:restrained→muted yet visible,墨色行补点缀,分层句升级", () => {
    const legacy =
      "Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, restrained mineral-color palette, smooth pale matte flat-wash ground, 工笔线描，写意晕染，浅净平涂底，墨色层次丰富, clear layered ink-wash composition, atmospheric depth, crisp gongbi linework throughout, clean finished gongbi quality";
    const out = sanitizeExtendedManualPrompt(legacy);
    expect(out).toContain("muted yet visible mineral-color palette with soft cyan-green and vermilion accents");
    expect(out).not.toContain("restrained mineral-color");
    expect(out).toContain("墨色层次丰富，青绿朱砂赭石淡彩点缀");
    expect(out).toContain("clear layered colored ink-wash composition with visible mineral pigments");
  });

  it("幂等:升级产物再次净化不再变化", () => {
    const once = sanitizeExtendedManualPrompt(
      "工笔线描，写意晕染，浅净平涂底，墨色层次丰富, clear layered ink-wash composition, restrained mineral-color palette",
    );
    expect(sanitizeExtendedManualPrompt(once)).toBe(once);
  });

  it("muted cyan-green palette 输入词映射到新彩句(旧规则反向已解除)", () => {
    expect(sanitizeExtendedManualPrompt("muted cyan-green palette")).toBe(
      "muted yet visible mineral-color palette with soft cyan-green and vermilion accents",
    );
  });
});
