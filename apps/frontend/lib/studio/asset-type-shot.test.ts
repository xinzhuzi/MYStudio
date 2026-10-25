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
  getAssetTypeShotProfilesForTrack,
  planAssetTypeFillMissingQueue,
  stripMultiViewLayoutClause,
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

describe("generateAssetTypeShot · i2i 指令可编辑(10-25 追加令)", () => {
  it("instructionOverride 非空=覆盖作终稿指令发送;空=型档案固定指令(既有零变)", async () => {
    generateImage.mockResolvedValue({ url: "http://gen/r.png" } as never);
    await generateAssetTypeShot({
      assetId: "a1",
      assetName: "晏燎",
      kind: "人物海报",
      referenceImage: "asset-file://role/ref.png",
      instructionOverride: "  覆盖指令:按我说的重绘  ",
    });
    const overCall = generateImage.mock.calls[0]![0] as { prompt: string };
    expect(overCall.prompt).toBe("覆盖指令:按我说的重绘");

    generateImage.mockClear();
    await generateAssetTypeShot({
      assetId: "a1",
      assetName: "晏燎",
      kind: "人物海报",
      referenceImage: "asset-file://role/ref.png",
      instructionOverride: "   ",
    });
    const fixedCall = generateImage.mock.calls[0]![0] as { prompt: string };
    const profile = ASSET_TYPE_SHOT_PROFILES.find((x) => x.kind === "人物海报");
    expect(fixedCall.prompt).toBe(profile?.i2iInstruction ?? "");
  });
});
const logEventMock = vi.mocked(logEvent);
const createOperationIdMock = vi.mocked(createOperationId);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * i2i 否定式门词表镜像(_gongbi_gate._NEG;10-21 四连炸实录——指令禁否定式)。
 * 逐字对齐真源(10-24 Round 3 ⑦ 补齐):真源正则 19 个交替项=字面词 18 项+
 * 序数模式 无第[一二三四五六七八九十](真源为正则族,镜像拆为字面清单+等价 regex 双闸)。
 */
const NEGATION_WORDS = [
  "不能", "不得", "不要", "不准", "禁止", "不生成", "不画", "不拆", "不挤占",
  "不造", "不强行", "不见", "互不粘连", "无错字", "无乱码", "不多不少", "看不见", "不为填格",
];
/** _NEG 序数族镜像:无第[一二三四五六七八九十](Round 3 ⑦ 补)。 */
const NEGATION_ORDINAL_PATTERN = /无第[一二三四五六七八九十]/;
/** 画风双写词镜像=真源 _STYLE_WORDS 逐字(Round 3 ⑦ 对齐:补 photorealistic;
 *  「写实」是真源另一独立门(prompt_violations 单列检查),镜像随之单列。 */
const STYLE_WORDS = ["工笔", "白描", "连环画", "厚涂", "赛璐璐", "photorealistic"];

describe("型档案表(批3 逐型档案+Round 3 ⑤ 三轨 track 归属)", () => {
  it("十一型齐收:role 七型节序零变化(定妆→海报→多视图→基准→自由→设定卡→美宣),scene 三型+道具追加", () => {
    expect(ASSET_TYPE_SHOT_PROFILES.map((profile) => profile.kind)).toEqual([
      "无衣物定妆",
      "人物海报",
      "人物多视图",
      "人脸基准",
      "自由",
      "设定卡",
      "美宣",
      "场景",
      "概念气氛图",
      "3D剖面场景图",
      "道具",
    ]);
  });

  it("track 归属(Round 3 ⑤):role 七型归 role;scene 三型归 scene;道具归 tool;自由三轨通用", () => {
    for (const profile of ASSET_TYPE_SHOT_PROFILES) {
      const expected: readonly string[] = profile.kind === "自由"
        ? ["role", "scene", "tool"]
        : profile.kind === "场景" || profile.kind === "概念气氛图" || profile.kind === "3D剖面场景图"
          ? ["scene"]
          : profile.kind === "道具"
            ? ["tool"]
            : ["role"];
      expect(profile.tracks).toEqual(expected);
    }
    // 轨道型档案列:role 七型/scene 四型(含自由)/tool 两型(道具+自由)
    expect(getAssetTypeShotProfilesForTrack("role").map((profile) => profile.kind)).toEqual([
      "无衣物定妆", "人物海报", "人物多视图", "人脸基准", "自由", "设定卡", "美宣",
    ]);
    expect(getAssetTypeShotProfilesForTrack("scene").map((profile) => profile.kind)).toEqual([
      "自由", "场景", "概念气氛图", "3D剖面场景图",
    ]);
    expect(getAssetTypeShotProfilesForTrack("tool").map((profile) => profile.kind)).toEqual([
      "自由", "道具",
    ]);
  });

  it("route 分流(10-25 用户令·派生流水线):无衣物定妆+设定卡/美宣/道具=t2i,余型=i2i", () => {
    const t2iKinds = new Set(["无衣物定妆", "设定卡", "美宣", "道具"]);
    for (const profile of ASSET_TYPE_SHOT_PROFILES) {
      expect(profile.route).toBe(t2iKinds.has(profile.kind) ? "t2i" : "i2i");
    }
  });

  it("画幅/透明档案逐字对齐十型真源 qi21_bases.json(aspect/rgba_default;含 Round 3 ⑤ 四型)", () => {
    const expected: Record<string, { aspect: string; rgba: boolean }> = {
      无衣物定妆: { aspect: "3:4", rgba: true },
      人物海报: { aspect: "3:4", rgba: false },
      人物多视图: { aspect: "16:9", rgba: true },
      人脸基准: { aspect: "1:1", rgba: true },
      自由: { aspect: "1:1", rgba: false },
      设定卡: { aspect: "16:9", rgba: false },
      美宣: { aspect: "16:9", rgba: false },
      场景: { aspect: "16:9", rgba: false },
      概念气氛图: { aspect: "16:9", rgba: false },
      "3D剖面场景图": { aspect: "16:9", rgba: false },
      道具: { aspect: "1:1", rgba: true },
    };
    for (const profile of ASSET_TYPE_SHOT_PROFILES) {
      expect(profile.aspect).toBe(expected[profile.kind].aspect);
      expect(profile.rgba).toBe(expected[profile.kind].rgba);
    }
  });

  it("i2i 八型指令齐备且守纪律(Phase2 瘦身态):保真段先行+单段中文+无否定式词+取景语言已归还型层", () => {
    for (const profile of ASSET_TYPE_SHOT_PROFILES.filter((item) => item.route === "i2i")) {
      const text = profile.i2iInstruction ?? "";
      expect(text.length).toBeGreaterThan(0);
      // 保真段先行(按轨三变体:人物/场景/通用主体,与画风转换三轨变体同构)
      if (profile.kind === "自由") {
        expect(text).toContain("保持画中主体");
      } else if (profile.tracks.includes("scene") && profile.tracks.length === 1) {
        expect(text).toContain("保持画中场景");
      } else {
        expect(text).toContain("保持画中人物");
      }
      expect(text).toContain("不变");
      // Phase2 指令瘦身(⑥):取景/版式/背景语言归还型层——纯色底/画幅/机位词禁入指令
      expect(text).not.toContain("背景为纯色");
      expect(text).not.toContain("纯色");
      for (const framingWord of ["1:1", "16:9", "3:4", "正面直立站姿", "共四幅", "止于颈根", "头顶与足底完整呈现", "三视图并排", "正面平视机位"]) {
        expect(text).not.toContain(framingWord);
      }
      // 单段中文无换行
      expect(text).not.toContain("\n");
      // i2i 否定式门(_gongbi_gate._NEG 镜像词表+序数族):「不得」类必炸
      for (const word of NEGATION_WORDS) {
        expect(text).not.toContain(word);
      }
      expect(NEGATION_ORDINAL_PATTERN.test(text)).toBe(false);
      // 画风双写词禁入(_STYLE_WORDS 镜像=真源逐字;风格归底座,指令只写保真+差异)
      for (const styleWord of STYLE_WORDS) {
        expect(text).not.toContain(styleWord);
      }
      // 真源独立门「写实」镜像(非 _STYLE_WORDS 族,单列检查)
      expect(text).not.toContain("写实");
    }
  });

  it("指令按型文抽样(Phase2 差异要点):海报密度/多视图一致/基准光洁头颅/场景空镜/气氛偏侧/3D剖切;定妆 t2i 化后无固定指令", () => {
    expect(getAssetTypeShotProfile("无衣物定妆")?.route).toBe("t2i");
    expect(getAssetTypeShotProfile("无衣物定妆")?.i2iInstruction).toBeUndefined();
    expect(getAssetTypeShotProfile("人物海报")?.i2iInstruction).toContain("人物细节密度最高");
    expect(getAssetTypeShotProfile("人物多视图")?.i2iInstruction).toContain("保持一致");
    expect(getAssetTypeShotProfile("人脸基准")?.i2iInstruction).toContain("头颅光洁");
    expect(getAssetTypeShotProfile("场景")?.i2iInstruction).toContain("空镜场景");
    expect(getAssetTypeShotProfile("概念气氛图")?.i2iInstruction).toContain("气氛为主");
    expect(getAssetTypeShotProfile("3D剖面场景图")?.i2iInstruction).toContain("剖开");
  });

  it("getAssetTypeShotProfile:未入族型名(高清人脸/表情差分/早期未分类)返回 undefined", () => {
    expect(getAssetTypeShotProfile("高清人脸")).toBeUndefined();
    expect(getAssetTypeShotProfile("表情差分")).toBeUndefined();
    expect(getAssetTypeShotProfile("早期未分类")).toBeUndefined();
  });
});

describe("generateAssetTypeShot(route 分流实装+Phase 2 型层注入+三轨落盘)", () => {
  it("i2i 路(人物海报样板;10-25 定妆已 t2i 化):固定指令+raw+单参考+base_type 型层注入,落盘 characters", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,TypeShot" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/fullbody.png");

    const result = await generateAssetTypeShot({
      assetId: "asset-role-1",
      assetName: "晏燎",
      kind: "人物海报",
      referenceImage: "asset-file://role/main.png",
      projectId: "proj-1",
    });

    const profile = getAssetTypeShotProfile("人物海报")!;
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledWith({
      model: ASSET_TYPE_SHOT_MODEL,
      prompt: profile.i2iInstruction,
      promptPolicy: "raw",
      referenceImages: ["asset-file://role/main.png"],
      // Phase 2(⑥,桥役 3718e469 已落地):i2i 统一 base_type 型层注入
      extraParams: { base_type: "人物海报" },
    });
    expect(TYPE_SHOT_I2I_USE_BASE_TYPE).toBe(true);
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

  it("透明型 RGBA 单测锚(⑥):人物多视图/人脸基准/无衣物定妆(i2i)+道具(t2i)恒带 base_type 注入=桥透明链前置", async () => {
    // 单测锚定请求层:透明型产物 RGBA 由桥 6:180 连线跟 6:4010 注型自动激活,
    // 像素级(PIL mode==RGBA+透明像素>0)核验属装机实弹项(docs/comfyui-kb/生图API直连.md 2c)
    // 10-25 用户令:无衣物定妆 t2i 化——透明 i2i 组摘定妆,t2i 透明组(道具+定妆)同锚
    const transparentI2iKinds = ["人物多视图", "人脸基准"] as const;
    for (const kind of transparentI2iKinds) {
      expect(getAssetTypeShotProfile(kind)?.rgba).toBe(true);
      generateImage.mockClear();
      generateImage.mockResolvedValue({ url: "data:image/png;base64,T" });
      vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/t.png");
      await generateAssetTypeShot({ assetId: "a", assetName: "x", kind, referenceImage: "asset-file://r.png" });
      expect(generateImage.mock.calls[0][0].extraParams).toEqual({ base_type: kind });
    }
    // 道具(透明底型)走 t2i+base_type(⑥ 桥 4010/4011/4022 同覆写→1:1 型画幅);
    // 无衣物定妆(10-25 t2i 化,rgba 透明型)同走 t2i+base_type
    expect(getAssetTypeShotProfile("无衣物定妆")?.rgba).toBe(true);
    generateImage.mockClear();
    generateImage.mockResolvedValue({ url: "data:image/png;base64,FB" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/fb.png");
    await generateAssetTypeShot({ assetId: "a", assetName: "x", kind: "无衣物定妆", subjectText: "少年剑修全身素体立绘" });
    // 10-26 源提示词四副本已随更名:引擎键=UI 名=无衣物定妆,直接注入
    expect(generateImage.mock.calls[0][0].extraParams).toEqual({ base_type: "无衣物定妆" });
    expect(getAssetTypeShotProfile("道具")?.rgba).toBe(true);
    generateImage.mockClear();
    generateImage.mockResolvedValue({ url: "data:image/png;base64,P" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://props/p.png");
    await generateAssetTypeShot({ assetId: "a", assetName: "x", kind: "道具", track: "tool", subjectText: "玄铁剑" });
    expect(generateImage.mock.calls[0][0].extraParams).toEqual({ base_type: "道具" });
  });

  it("三轨落盘分流(⑤):scene 轨走 scene/scenes,tool 轨走 prop/props;缺省 track=role 零变化", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,S" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://scenes/s.png");
    await generateAssetTypeShot({
      assetId: "asset-scene-1", assetName: "山门", kind: "场景",
      track: "scene", referenceImage: "asset-file://scene/s0.png",
    });
    expect(vi.mocked(saveGeneratedAssetImage)).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "scene", category: "scenes" }),
    );
    expect(updateStoreWithResult).toHaveBeenCalledWith("asset-scene-1", "scene", expect.anything());

    generateImage.mockClear();
    vi.mocked(saveGeneratedAssetImage).mockClear();
    vi.mocked(updateStoreWithResult).mockClear();
    generateImage.mockResolvedValue({ url: "data:image/png;base64,T2" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://props/t.png");
    await generateAssetTypeShot({
      assetId: "asset-tool-1", assetName: "玉佩", kind: "道具",
      track: "tool", subjectText: "白玉平安扣",
    });
    expect(vi.mocked(saveGeneratedAssetImage)).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "prop", category: "props" }),
    );
    expect(updateStoreWithResult).toHaveBeenCalledWith("asset-tool-1", "prop", expect.anything());
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

  it("守卫:未入族型名 failed 收口(高清人脸/表情差分既有路不收编,候后续役)", async () => {
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

  it("诊断打点贯通:operationId 贯穿构造/发起/成功三事件,context 带型名/track 与 route", async () => {
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
    expect(threaded[0].context).toMatchObject({ kind: "人物海报", track: "role", route: "i2i" });
  });
});

describe("planAssetTypeFillMissingQueue(一键补缺顺序队列计划;⑤ 三轨取谱)", () => {
  function named(name: string): AssetImage {
    return { name, filePath: `role/${name}.png` };
  }

  it("按核心五必备节序返回缺失型(命名抽样:多视图/海报/人脸已齐→缺定妆+表情差分(正视图归多视图后海报需独立齐格))", () => {
    const images = [
      named("晏燎_练气期_三视图_v1"),
      named("晏燎_筑基期_正视图_v2"),
      named("晏燎_练气期_高清大脸_2026年10月21日"),
      named("晏燎_金丹期_海报_v1"),
      named("晏燎_金丹期_人物海报_v1"),
    ];
    expect(planAssetTypeFillMissingQueue(images)).toEqual(["无衣物定妆", "表情差分"]);
  });

  it("五必备全齐→空队列;持久 kind 压过命名参计", () => {
    const complete = [
      named("a_无衣物定妆_1"),
      named("b_正视图_1"),
      named("b2_人物海报_1"),
      named("c_三视图_1"),
      named("d_人脸_1"),
      { ...named("随手改的名"), kind: "表情差分" as AssetImageKind },
    ];
    expect(planAssetTypeFillMissingQueue(complete)).toEqual([]);
  });

  it("空图集→五型全缺(节序恒定);扩展型缺失恒不入队(补缺只补核心)", () => {
    expect(planAssetTypeFillMissingQueue([])).toEqual([
      "无衣物定妆",
      "人物海报",
      "人物多视图",
      "高清人脸",
      "表情差分",
    ]);
    const onlyExtended = [named("x_设定卡_1"), named("y_人脸基准_1"), named("z_自由_1")];
    expect(planAssetTypeFillMissingQueue(onlyExtended)).toEqual([
      "无衣物定妆",
      "人物海报",
      "人物多视图",
      "高清人脸",
      "表情差分",
    ]);
  });

  it("scene 轨:三核心按谱计缺(场景/概念气氛图/3D剖面场景图);tool 轨:道具一核心", () => {
    const sceneImages = [named("山门_场景_v1")];
    expect(planAssetTypeFillMissingQueue(sceneImages, "scene")).toEqual(["概念气氛图", "3D剖面场景图"]);
    expect(planAssetTypeFillMissingQueue([], "scene")).toEqual(["场景", "概念气氛图", "3D剖面场景图"]);
    // 扩展型(自由)有图不抵核心;识别不出沉未分类不算核心
    expect(planAssetTypeFillMissingQueue([named("随手_自由_1")], "scene")).toEqual([
      "场景", "概念气氛图", "3D剖面场景图",
    ]);

    expect(planAssetTypeFillMissingQueue([], "tool")).toEqual(["道具"]);
    expect(planAssetTypeFillMissingQueue([named("玄铁剑_道具_v1")], "tool")).toEqual([]);
  });
});


describe("stripMultiViewLayoutClause · 定妆单立绘语义裁尾(10-25 用户令)", () => {
  it("晏燎 318 字实名:四视图排布尾整段裁掉,墨黑短发等主体要素保留", () => {
    const subject = "约十七八岁的男孩,道口镇散修孤儿,沉默坚韧。墨黑短发。青灰粗布短褐,栗褐缚裤。同一画面从左至右并排四视图:人像特写自头顶至锁骨完整入画,正面、侧面、背面全身立像自头顶至脚底完整入画;均匀柔和散光。四视图面容、体型、发型、基础服装完全一致。";
    const trimmed = stripMultiViewLayoutClause(subject);
    expect(trimmed).toContain("墨黑短发");
    expect(trimmed).toContain("青灰粗布短褐");
    expect(trimmed).not.toContain("四视图");
    expect(trimmed).not.toContain("从左至右");
    expect(trimmed.endsWith("栗褐缚裤")).toBe(true);
  });

  it("无标记原文返回;多标记取最前;尾分隔符清干净", () => {
    expect(stripMultiViewLayoutClause("普通主体句无排布")).toBe("普通主体句无排布");
    expect(stripMultiViewLayoutClause("甲。并排三视图:xyz")).toBe("甲");
    expect(stripMultiViewLayoutClause("乙,同一画面从左至右并排四视图,并排三视图")).toBe("乙");
  });

  it("generateAssetTypeShot t2i 定妆路实裁:发车 prompt 无排布句;其他型零干预", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,DZ" } as never);
    await generateAssetTypeShot({
      assetId: "a", assetName: "x", kind: "无衣物定妆",
      subjectText: "少年剑修,墨黑短发,素体立姿。同一画面从左至右并排四视图:正侧背全身立像。",
    });
    const dzCall = generateImage.mock.calls[0]![0] as { prompt: string };
    expect(dzCall.prompt).not.toContain("并排");
    expect(dzCall.prompt).toContain("墨黑短发");

    generateImage.mockClear();
    generateImage.mockResolvedValue({ url: "data:image/png;base64,SK" } as never);
    await generateAssetTypeShot({
      assetId: "a", assetName: "x", kind: "设定卡",
      subjectText: "少年剑修设定。同一画面从左至右并排四视图:正侧背。",
    });
    const skCall = generateImage.mock.calls[0]![0] as { prompt: string };
    expect(skCall.prompt).toContain("并排四视图");
  });
});