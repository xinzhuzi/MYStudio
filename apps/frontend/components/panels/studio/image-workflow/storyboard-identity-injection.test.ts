// @vitest-environment jsdom
/**
 * 设计卡全文注入模式单测(1120,PRD 11-20-toonflow-binding-phase1 件三):
 *  - 开关默认值:缺省/非法值恒 canonical(默认路径守门);
 *  - 参考N块编号:N=§4.5 传输槽序(与 assetBindings 写路 slot 解耦),槽缺席(旧章)按序补号;
 *  - 构句形态:零槽=零身份段主体句+块追加;有槽=正典 i2i 指令体直用;
 *  - 全文身份段解析:不洗版(prompt 列全文逐字,与正典白名单提取路对照)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── store/桥注入(与 storyboard-canonical-context.test.ts 同床形) ──
const sceneState = vi.hoisted(() => ({ scenes: [] as Array<Record<string, unknown>> }));
vi.mock("@/stores/library/scene-store", () => ({
  useSceneStore: { getState: () => sceneState },
}));
const characterState = vi.hoisted(() => ({ characters: [] as Array<Record<string, unknown>> }));
vi.mock("@/stores/library/character-library-store", () => ({
  useCharacterLibraryStore: { getState: () => characterState },
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "p1" }) },
}));
const studioAgentState = vi.hoisted(() => ({
  agentWorkData: [] as Array<Record<string, unknown>>,
  workflowConfig: { visualManualId: "" },
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioAgentState },
}));
const assetsBridge = vi.hoisted(() => ({
  getByName: vi.fn(),
}));
vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => assetsBridge,
}));
vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (name: string) => `op-${name}`,
  logEvent: vi.fn(async () => undefined),
}));

import {
  appendIdentityInjectionBlocks,
  buildIdentityInjectionReferenceBlocks,
  buildStoryboardIdentityInjectionPrompt,
  resolveIdentityFullTexts,
  resolveStoryboardPromptMode,
} from "./storyboard-identity-injection";

describe("resolveStoryboardPromptMode(开关默认值)", () => {
  it("缺省/空串/非法值=canonical,仅逐字 identity-injection 认(默认路径守门)", () => {
    expect(resolveStoryboardPromptMode(undefined)).toBe("canonical");
    expect(resolveStoryboardPromptMode("canonical")).toBe("canonical");
    expect(resolveStoryboardPromptMode("identity-injection")).toBe("identity-injection");
    expect(resolveStoryboardPromptMode("Identity-Injection")).toBe("canonical");
    expect(resolveStoryboardPromptMode(42)).toBe("canonical");
    expect(resolveStoryboardPromptMode(null)).toBe("canonical");
  });
});

describe("buildIdentityInjectionReferenceBlocks(参考N块编号=传输槽序)", () => {
  const identities = [
    { name: "独孤剑尘", paragraph: "宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图", origin: "asset-description" as const },
    { name: "赵四", paragraph: "码头监工，肤色黝黑", origin: "asset-description" as const },
  ];

  it("混合镜:块 N=角色所在传输槽号(§4.5 角色恒 image_1),与 assetBindings 写路 slot 解耦", () => {
    // 写路绑定序=场景 slot1→角色 slot2(collectStoryboardAssetBindings 全类型序);
    // 传输槽序=角色 image_1→场景 image_2(mapCanonicalReferenceSlots)——两序
    // 不同源,块编号以传输槽为准才与送模参考图逐槽对上(1120 复审修)。
    const blocks = buildIdentityInjectionReferenceBlocks(identities, [
      { slot: 1, role: "character", title: "独孤剑尘", imageUrl: "data:image/png;base64,c" },
      { slot: 2, role: "scene", title: "金水河码头", imageUrl: "data:image/png;base64,s" },
    ]);
    // 独孤剑尘=传输槽1(非绑定 slot2);赵四无传输槽→全部传输槽(2)之后补号3
    expect(blocks[0]).toBe("参考 1：宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图");
    expect(blocks[1]).toBe("参考 3：码头监工，肤色黝黑");
  });

  it("纯场景槽镜:场景占 image_1,无图角色身份段在其后补号(禁撞号)", () => {
    expect(buildIdentityInjectionReferenceBlocks(identities, [
      { slot: 1, role: "scene", title: "金水河码头", imageUrl: "data:image/png;base64,s" },
    ])).toEqual([
      "参考 2：宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图",
      "参考 3：码头监工，肤色黝黑",
    ]);
  });

  it("传输槽缺席(旧章/零槽 t2i)=身份段按序 1..n 补号(读路兼容零迁移)", () => {
    expect(buildIdentityInjectionReferenceBlocks(identities, undefined)).toEqual([
      "参考 1：宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图",
      "参考 2：码头监工，肤色黝黑",
    ]);
  });

  it("空身份段不产块;复合槽名双向互认(nameMatches 同口径);前帧槽只占号不产块", () => {
    expect(buildIdentityInjectionReferenceBlocks([{ name: "x", paragraph: "  ", origin: "absent" }])).toEqual([]);
    const blocks = buildIdentityInjectionReferenceBlocks(
      [{ name: "李先生", paragraph: "管事相", origin: "asset-description" }],
      [
        { slot: 1, role: "character", title: "李先生；管事", imageUrl: "data:image/png;base64,l" },
        { slot: 2, role: "previous-frame", title: "上一帧画面", imageUrl: "data:image/png;base64,f" },
      ],
    );
    expect(blocks).toEqual(["参考 1：管事相"]);
  });
});

describe("appendIdentityInjectionBlocks(合稿形态)", () => {
  it("基底去句号+「；」拼块+收「。」(单段成文);零块=基底原样", () => {
    expect(appendIdentityInjectionBlocks("夜雨按剑。", ["参考 1：甲", "参考 2：乙"]))
      .toBe("夜雨按剑；参考 1：甲；参考 2：乙。");
    expect(appendIdentityInjectionBlocks("夜雨按剑。", [])).toBe("夜雨按剑。");
  });
});

describe("buildStoryboardIdentityInjectionPrompt(构句形态)", () => {
  const subject = {
    description: "独孤剑尘立于金水河码头，夜雨，按剑远眺。",
    identities: [{ name: "独孤剑尘", paragraph: "宽方厚重脸，浓眉压眼", origin: "asset-description" as const }],
    visibleCharacters: [],
  };

  it("零槽(t2i):基底=零身份段主体句(buildCanonicalSubjectSentence identities:[] 形态),终稿=基底+参考块", () => {
    const result = buildStoryboardIdentityInjectionPrompt({
      subject,
      slots: [],
      canonicalInstructionPrompt: "（零槽不消费）",
      identities: subject.identities,
    });
    // 基底不含身份段内容,首位=动作槽(videoDesc)
    expect(result.base).not.toContain("宽方厚重脸");
    expect(result.base).toContain("独孤剑尘立于金水河码头");
    expect(result.prompt).toBe(`${result.base.replace(/。$/, "")}；参考 1：宽方厚重脸，浓眉压眼。`);
    expect(result.blocks).toEqual(["参考 1：宽方厚重脸，浓眉压眼"]);
  });

  it("有槽(i2i):基底=正典 i2i 指令体逐字直用(本就零身份段),块追加其后", () => {
    const canonicalI2I = "绘制一张全新的单格剧情画面：<image1>为独孤剑尘的身份来源，变化项。";
    const result = buildStoryboardIdentityInjectionPrompt({
      subject,
      slots: [{ slot: 1, role: "character", title: "独孤剑尘", imageUrl: "data:image/png;base64,x" }],
      canonicalInstructionPrompt: canonicalI2I,
      identities: subject.identities,
    });
    expect(result.base).toBe(canonicalI2I);
    expect(result.prompt).toContain("身份来源");
    expect(result.prompt).toContain("参考 1：宽方厚重脸，浓眉压眼");
  });
});

describe("resolveIdentityFullTexts(设计卡全文,不洗版)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    characterState.characters = [];
  });

  it("资产 prompt 列全文逐字(含正典洗版会剔的排版语料),origin=asset-description", async () => {
    assetsBridge.getByName.mockResolvedValue({
      prompt: "约三十岁男性，宽方厚重脸，浓眉压眼，同一画面从左至右并排四视图",
    });
    const identities = await resolveIdentityFullTexts(["独孤剑尘"]);
    expect(identities[0]?.paragraph).toBe("约三十岁男性，宽方厚重脸，浓眉压眼，同一画面从左至右并排四视图");
    expect(identities[0]?.origin).toBe("asset-description");
  });

  it("promptOverrides「分镜剧情图」键优先(逐字);桥失败回落三库视觉字段", async () => {
    assetsBridge.getByName.mockResolvedValue({
      prompt: "prompt 列全文",
      promptOverrides: JSON.stringify({ 分镜剧情图: "override 身份段全文" }),
    });
    const overridden = await resolveIdentityFullTexts(["独孤剑尘"]);
    expect(overridden[0]?.paragraph).toBe("override 身份段全文");
    expect(overridden[0]?.origin).toBe("asset-override");

    assetsBridge.getByName.mockRejectedValue(new Error("桥断"));
    characterState.characters = [{ name: "独孤剑尘", variations: [{ visualPromptZh: "三库视觉字段" }] }];
    const fallback = await resolveIdentityFullTexts(["独孤剑尘"]);
    expect(fallback[0]?.paragraph).toBe("三库视觉字段");
    expect(fallback[0]?.origin).toBe("character-library");
  });
});
