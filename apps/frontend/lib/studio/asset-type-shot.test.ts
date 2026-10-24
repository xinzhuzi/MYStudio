import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { AssetImage, AssetImageKind } from "@/types/studio-assets";
import {
  saveGeneratedAssetImage,
  updateStoreWithResult,
} from "./asset-generation-store-writers";
import {
  ASSET_TYPE_SHOT_MODEL,
  ASSET_TYPE_SHOT_PROFILES,
  TYPE_SHOT_I2I_USE_BASE_TYPE,
  generateAssetTypeShot,
  getAssetTypeShotProfile,
  planAssetTypeFillMissingQueue,
} from "./asset-type-shot";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn() },
}));

vi.mock("./asset-generation-store-writers", () => ({
  saveGeneratedAssetImage: vi.fn(),
  updateStoreWithResult: vi.fn(),
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: vi.fn(() => "asset-type-shot-fallback"),
  logEvent: vi.fn(),
}));

const generateImage = vi.mocked(aiManager.generateImage);
const logEventMock = vi.mocked(logEvent);
const createOperationIdMock = vi.mocked(createOperationId);

beforeEach(() => {
  vi.clearAllMocks();
});

/** i2i 否定式门词表镜像(_gongbi_gate._NEG;10-21 四连炸实录——指令禁否定式)。 */
const NEGATION_WORDS = [
  "不能", "不得", "不要", "不准", "禁止", "不生成", "不画", "不拆", "不挤占",
  "不造", "不强行", "不见", "互不粘连", "无错字", "无乱码", "不多不少", "看不见", "不为填格",
];

describe("型档案表(批3 逐型档案,grill Round 1 裁定3 route 分流)", () => {
  it("七型齐收且节序=型谱节序(全身定妆→人物海报→人物多视图→人脸基准→自由→设定卡→美宣)", () => {
    expect(ASSET_TYPE_SHOT_PROFILES.map((profile) => profile.kind)).toEqual([
      "全身定妆",
      "人物海报",
      "人物多视图",
      "人脸基准",
      "自由",
      "设定卡",
      "美宣",
    ]);
  });

  it("route 分流:设定卡/美宣=t2i+base_type,余五型=i2i(禁一刀切)", () => {
    for (const profile of ASSET_TYPE_SHOT_PROFILES) {
      if (profile.kind === "设定卡" || profile.kind === "美宣") {
        expect(profile.route).toBe("t2i");
      } else {
        expect(profile.route).toBe("i2i");
      }
    }
  });

  it("画幅/透明档案逐字对齐十型真源 qi21_bases.json(aspect/rgba_default)", () => {
    const expected: Record<string, { aspect: string; rgba: boolean }> = {
      全身定妆: { aspect: "3:4", rgba: true },
      人物海报: { aspect: "3:4", rgba: false },
      人物多视图: { aspect: "16:9", rgba: true },
      人脸基准: { aspect: "1:1", rgba: true },
      自由: { aspect: "1:1", rgba: false },
      设定卡: { aspect: "16:9", rgba: false },
      美宣: { aspect: "16:9", rgba: false },
    };
    for (const profile of ASSET_TYPE_SHOT_PROFILES) {
      expect(profile.aspect).toBe(expected[profile.kind].aspect);
      expect(profile.rgba).toBe(expected[profile.kind].rgba);
    }
  });

  it("i2i 五型取景借语齐备且守纪律:保真段先行+单段中文+无否定式词(Phase1 纯色底)", () => {
    for (const profile of ASSET_TYPE_SHOT_PROFILES.filter((item) => item.route === "i2i")) {
      const text = profile.i2iInstruction ?? "";
      expect(text.length).toBeGreaterThan(0);
      // 保真段先行(与画风转换/人脸/表情差分同款家族形态)
      expect(text).toContain("保持画中人物");
      expect(text).toContain("不变");
      // Phase1 借语=纯色底(桥未切 base_type 前的既定边界)
      expect(text).toContain("背景为纯色");
      // 单段中文无换行
      expect(text).not.toContain("\n");
      // i2i 否定式门(_gongbi_gate._NEG 镜像词表):「不得」类必炸
      for (const word of NEGATION_WORDS) {
        expect(text).not.toContain(word);
      }
      // 画风双写词禁入(风格归底座,取景借语只借取景语言)
      for (const styleWord of ["工笔", "白描", "连环画", "厚涂", "赛璐璐", "写实"]) {
        expect(text).not.toContain(styleWord);
      }
    }
  });

  it("取景借语按型文抽样:多视图四幅布局/基准止颈零发型/定妆素体零衣物", () => {
    expect(getAssetTypeShotProfile("人物多视图")?.i2iInstruction).toContain("共四幅");
    expect(getAssetTypeShotProfile("人脸基准")?.i2iInstruction).toContain("止于颈根");
    expect(getAssetTypeShotProfile("人脸基准")?.i2iInstruction).toContain("零发型");
    expect(getAssetTypeShotProfile("全身定妆")?.i2iInstruction).toContain("零衣物零配饰零鞋履");
    expect(getAssetTypeShotProfile("人物海报")?.i2iInstruction).toContain("头顶与足底完整呈现");
  });

  it("getAssetTypeShotProfile:未入族型名(高清人脸/表情差分/早期未分类)返回 undefined", () => {
    expect(getAssetTypeShotProfile("高清人脸")).toBeUndefined();
    expect(getAssetTypeShotProfile("表情差分")).toBeUndefined();
    expect(getAssetTypeShotProfile("早期未分类")).toBeUndefined();
  });
});

describe("generateAssetTypeShot(route 分流实装)", () => {
  it("i2i 路(全身定妆):取景借语指令+raw+单参考直通,Phase1 零 base_type,落盘 characters", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,TypeShot" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/fullbody.png");

    const result = await generateAssetTypeShot({
      assetId: "asset-role-1",
      assetName: "晏燎",
      kind: "全身定妆",
      referenceImage: "asset-file://role/main.png",
      projectId: "proj-1",
    });

    const profile = getAssetTypeShotProfile("全身定妆")!;
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledWith({
      model: ASSET_TYPE_SHOT_MODEL,
      prompt: profile.i2iInstruction,
      promptPolicy: "raw",
      referenceImages: ["asset-file://role/main.png"],
    });
    // Phase 1 借语模式锚定:i2i 路不带 extraParams.base_type(Phase2 单点开关候桥役验收)
    expect(TYPE_SHOT_I2I_USE_BASE_TYPE).toBe(false);
    expect(generateImage.mock.calls[0][0]).not.toHaveProperty("extraParams");
    expect(saveGeneratedAssetImage).toHaveBeenCalledWith({
      source: "data:image/png;base64,TypeShot",
      assetType: "character",
      assetId: "asset-role-1",
      assetName: "晏燎",
      projectId: "proj-1",
      isDerivative: false,
      category: "characters",
    });
    expect(updateStoreWithResult).toHaveBeenCalledWith("asset-role-1", "character", {
      imageLocalPath: "local-image://characters/fullbody.png",
    });
    expect(result).toEqual({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
  });

  it("t2i 路(设定卡):描述主体句+base_type 型层注入,零参考图", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,Sheet" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/sheet.png");

    await generateAssetTypeShot({
      assetId: "asset-role-1",
      assetName: "晏燎",
      kind: "设定卡",
      subjectText: "北境剑修,玄色长衣,背负旧债",
    });

    expect(generateImage).toHaveBeenCalledWith({
      model: ASSET_TYPE_SHOT_MODEL,
      prompt: "北境剑修,玄色长衣,背负旧债",
      promptPolicy: "raw",
      extraParams: { base_type: "设定卡" },
    });
    expect(generateImage.mock.calls[0][0]).not.toHaveProperty("referenceImages");
  });

  it("t2i 路(美宣)同款 base_type 注入(裁定3:t2i 型层正途)", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,Promo" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/promo.png");

    await generateAssetTypeShot({
      assetId: "asset-role-2",
      assetName: "主角",
      kind: "美宣",
      subjectText: "渡劫瞬间的少年剑修",
    });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ extraParams: { base_type: "美宣" } }),
    );
  });

  it("守卫:i2i 路缺参考图/t2i 路缺描述均 failed 收口,零生成调用", async () => {
    const noRef = await generateAssetTypeShot({ assetId: "a", assetName: "x", kind: "人物海报" });
    expect(noRef.phase).toBe("failed");
    expect(noRef.error).toContain("参考");

    const noSubject = await generateAssetTypeShot({ assetId: "a", assetName: "x", kind: "美宣" });
    expect(noSubject.phase).toBe("failed");
    expect(noSubject.error).toContain("描述");

    expect(generateImage).not.toHaveBeenCalled();
  });

  it("守卫:未入族型名 failed 收口(高清人脸/表情差分既有路不收编,候 Phase2)", async () => {
    const result = await generateAssetTypeShot({
      assetId: "a",
      assetName: "x",
      kind: "高清人脸",
      referenceImage: "asset-file://role/main.png",
    });
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("未知型名");
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("生成未返回 URL / 异常均 failed 收口,异常透传错误原文", async () => {
    generateImage.mockResolvedValue({ url: "" });
    const noUrl = await generateAssetTypeShot({
      assetId: "a", assetName: "x", kind: "自由", referenceImage: "asset-file://r.png",
    });
    expect(noUrl).toEqual({ phase: "failed", error: "图片生成未返回 URL" });
    expect(vi.mocked(saveGeneratedAssetImage)).not.toHaveBeenCalled();

    generateImage.mockRejectedValue(new Error("本地图片生成失败:引擎不在驾"));
    const rejected = await generateAssetTypeShot({
      assetId: "a", assetName: "x", kind: "人脸基准", referenceImage: "asset-file://r.png",
    });
    expect(rejected).toEqual({ phase: "failed", error: "本地图片生成失败:引擎不在驾" });
  });

  it("诊断打点贯通:operationId 贯穿构造/发起/成功三事件,context 带型名与 route", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,IMG" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/ok.png");

    await generateAssetTypeShot({
      assetId: "asset-log",
      assetName: "主角",
      kind: "人物海报",
      referenceImage: "asset-file://role/main.png",
      operationId: "op-from-handler",
    });

    const entries = logEventMock.mock.calls.map(([entry]) => entry);
    const threaded = entries.filter((entry) => entry.operationId === "op-from-handler");
    expect(threaded.map((entry) => entry.message)).toEqual([
      "Asset type shot instruction built",
      "Asset type shot generation started",
      "Asset type shot image saved",
    ]);
    expect(createOperationIdMock).not.toHaveBeenCalled();
    expect(threaded[0].context).toMatchObject({ kind: "人物海报", route: "i2i" });
  });
});

describe("planAssetTypeFillMissingQueue(一键补缺顺序队列计划)", () => {
  function named(name: string): AssetImage {
    return { name, filePath: `role/${name}.png` };
  }

  it("按核心五必备节序返回缺失型(晏燎 40 图抽样:多视图/海报/人脸已齐→缺定妆+表情差分)", () => {
    const images = [
      named("晏燎_练气期_三视图_v1"),
      named("晏燎_筑基期_正视图_v2"),
      named("晏燎_练气期_高清大脸_2026年10月21日"),
      named("晏燎_金丹期_海报_v1"),
    ];
    expect(planAssetTypeFillMissingQueue(images)).toEqual(["全身定妆", "表情差分"]);
  });

  it("五必备全齐→空队列;持久 kind 压过命名参计", () => {
    const complete = [
      named("a_全身定妆_1"),
      named("b_正视图_1"),
      named("c_三视图_1"),
      named("d_人脸_1"),
      { ...named("随手改的名"), kind: "表情差分" as AssetImageKind },
    ];
    expect(planAssetTypeFillMissingQueue(complete)).toEqual([]);
  });

  it("空图集→五型全缺(节序恒定);扩展型缺失恒不入队(补缺只补核心)", () => {
    expect(planAssetTypeFillMissingQueue([])).toEqual([
      "全身定妆",
      "人物海报",
      "人物多视图",
      "高清人脸",
      "表情差分",
    ]);
    const onlyExtended = [named("x_设定卡_1"), named("y_人脸基准_1"), named("z_自由_1")];
    expect(planAssetTypeFillMissingQueue(onlyExtended)).toEqual([
      "全身定妆",
      "人物海报",
      "人物多视图",
      "高清人脸",
      "表情差分",
    ]);
  });
});
