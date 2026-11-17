// @vitest-environment jsdom
/**
 * 第六病理单姿裁切语义测试(1116 回归钉):
 *  - 竖幅(已是单姿立绘)→ 原图保留(2d312474 原语义;旧实现返回 null=丢槽,
 *    会把主角 image_1 抽走,身份参考归零);
 *  - 横幅多视图卡 → 裁最左连续内容块为正面单姿;
 *  - 横幅裁不出 → null(调用方丢槽留痕,宁缺勿染,禁整卡入参考);
 *  - 场景/前帧 → 恒不裁。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── 1117 C2 G1/G5 测试床:store/桥注入(vi.mock 提升到全文件,裁切测试零感知) ──
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
  batchMatch: vi.fn(),
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
  buildStoryboardCanonicalContext,
  collectDerivedAssetPlanEntries,
  extractEnvironmentClauses,
  findDerivedPlanEntryForCharacter,
  resolveShotTimeOfDay,
  resolveStoryboardScene,
  cropSlotReferenceToSinglePose,
  sanitizeAssetPromptForIdentity,
  type StoryboardCropImageSource,
} from "./storyboard-canonical-context";
import type { StoryboardItem } from "@/types/studio";

const VERTICAL: StoryboardCropImageSource = { naturalWidth: 800, naturalHeight: 1200 };
const BANNER: StoryboardCropImageSource = { naturalWidth: 1248, naturalHeight: 832 };

const loader = (image: StoryboardCropImageSource | null) => vi.fn(async () => image);

/** 512 探针列:除 [contentStart, contentEnd) 外均为背景色。 */
function stubCanvas(contentStart: number, contentEnd: number) {
  const drawImage = vi.fn();
  const fillPixels = (width: number, height: number): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const foreground = x >= contentStart && x < contentEnd;
        data[at] = foreground ? 20 : 200;
        data[at + 1] = foreground ? 20 : 200;
        data[at + 2] = foreground ? 20 : 200;
        data[at + 3] = 255;
      }
    }
    return data;
  };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: fillPixels(width, height),
      }),
    } as unknown as CanvasRenderingContext2D;
  } as never);
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,CROPPED");
  return { drawImage, getContext, toDataURL };
}

describe("cropSlotReferenceToSinglePose", () => {
  it("竖幅单姿立绘原图保留,不丢槽(1117 残项③:竖幅先探竖排多视图,整幅单内容=保留)", async () => {
    // 竖幅探针内容带=横向满幅(fillPixels 按 x∈[start,end) 前景;竖幅竖排分析
    // 逐行探中带,满幅内容→isSinglePoseFullFrame 单内容判定=原图保留。
    stubCanvas(4, 508); // 窄背景边框防四角取样全前景(满幅被误判全背景)
    const load = loader(VERTICAL);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,VERTICAL", "character", load);
    expect(result).toBe("data:image/png;base64,VERTICAL");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("横幅多视图卡裁出最左连续内容块", async () => {
    const { toDataURL } = stubCanvas(100, 200);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BANNER", "character", loader(BANNER));
    expect(result).toBe("data:image/png;base64,CROPPED");
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it("横幅全背景无法定位单姿=丢槽(null)", async () => {
    stubCanvas(0, 0);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BANNER", "character", loader(BANNER));
    expect(result).toBeNull();
  });

  it("场景与前帧恒不裁,原样透传", async () => {
    const sceneLoad = loader(BANNER);
    await expect(cropSlotReferenceToSinglePose("data:image/png;base64,SCENE", "scene", sceneLoad))
      .resolves.toBe("data:image/png;base64,SCENE");
    const frameLoad = loader(BANNER);
    await expect(cropSlotReferenceToSinglePose("data:image/png;base64,FRAME", "previous-frame", frameLoad))
      .resolves.toBe("data:image/png;base64,FRAME");
    expect(sceneLoad).not.toHaveBeenCalled();
    expect(frameLoad).not.toHaveBeenCalled();
  });

  it("解码失败=丢槽(null)", async () => {
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BROKEN", "character", loader(null));
    expect(result).toBeNull();
  });
});

// ─── 1117 C2 G1:场景五级序 + 时辰五源序(剧情锚定主修) ──────────────────────

const PROJECT_ID = "p1";

function sceneRow(partial: Record<string, unknown>) {
  return {
    id: "scene-x", name: "未名场景", location: "", time: "", atmosphere: "",
    projectId: PROJECT_ID, createdAt: 0, updatedAt: 0, ...partial,
  } as never;
}

function installScenes(rows: Array<Record<string, unknown>>) {
  sceneState.scenes = rows as never;
}

function installCharacters(rows: Array<Record<string, unknown>>) {
  characterState.characters = rows as never;
}

function shot(partial: Partial<StoryboardItem> = {}) {
  return {
    id: "sb-test-001", episodeId: "chapter-001", index: 1,
    associateAssetsIds: [], associateAssetsNames: [],
    ...partial,
  } as StoryboardItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  installScenes([]);
  installCharacters([]);
  studioAgentState.agentWorkData = [];
  assetsBridge.batchMatch.mockResolvedValue([]);
  assetsBridge.getByName.mockResolvedValue(null);
});

describe("resolveStoryboardScene(五级序,B1/B4 主修)", () => {
  it("㊠ associateAssetsIds scene_ id 精确命中(S12 金水塾馆 id 在行而名不在)", () => {
    installScenes([
      sceneRow({ id: "scene_1780296482374_jew094y", name: "金水塾馆", location: "金水塾馆" }),
      sceneRow({ id: "scene_1792470440631_o8y9d7n", name: "晏燎静室", location: "晏燎静室" }),
    ]);
    const resolved = resolveStoryboardScene(shot({
      associateAssetsIds: ["scene_1780296482374_jew094y", "char_x"],
      associateAssetsNames: ["独孤剑尘", "晏燎"],
    }));
    expect(resolved.fact?.name).toBe("金水塾馆");
    expect(resolved.source).toBe("asset-id");
  });

  it("㊣ 角色库命中的查询词不作场景名(B4:晏燎⊂晏燎静室误绑根除)", () => {
    installScenes([sceneRow({ id: "scene_o", name: "晏燎静室", location: "晏燎静室" })]);
    installCharacters([{ id: "c1", name: "晏燎", projectId: PROJECT_ID }]);
    const resolved = resolveStoryboardScene(shot({ associateAssetsNames: ["晏燎"] }));
    expect(resolved.row).toBeNull();
    expect(resolved.fact).toBeNull();
    expect(resolved.warnings.join(";")).toContain("scene-query-guarded:晏燎");
  });

  it("㊢ prompt/videoDesc 场名探针(S9 首字场景名回填;多命中取最长名)", () => {
    installScenes([
      sceneRow({ id: "scene_a", name: "金水塾馆" }),
      sceneRow({ id: "scene_b", name: "金水塾馆后院" }),
    ]);
    const resolved = resolveStoryboardScene(shot({ prompt: "夜。金水塾馆后院三间青瓦房亮着灯。" }));
    expect(resolved.fact?.name).toBe("金水塾馆后院");
    expect(resolved.source).toBe("text-probe");
  });

  it("㊡ sceneName 新字段命中(分镜表场景列落库,B1 主修路径)", () => {
    installScenes([sceneRow({ id: "scene_a", name: "金水塾馆" })]);
    const resolved = resolveStoryboardScene(shot({ sceneName: "金水塾馆" }));
    expect(resolved.fact?.name).toBe("金水塾馆");
    expect(resolved.source).toBe("scene-name-field");
  });

  it("㊄ 态行优选:时辰已知选「·夜内态」派生行,时辰未知回落基础行", () => {
    installScenes([
      sceneRow({ id: "scene_base", name: "金水塾馆", location: "金水塾馆" }),
      sceneRow({
        id: "scene_state", name: "金水塾馆·夜内态：两盏油灯·墨板·盘坐孩童·北墙角落",
        location: "金水塾馆", atmosphere: "两盏油灯·墨板·盘坐孩童·北墙角落",
      }),
    ]);
    const night = resolveStoryboardScene(shot({
      sceneName: "金水塾馆",
      prompt: "夜。墨板前孩童盘坐。",
    }));
    expect(night.fact?.name).toContain("夜内态");
    expect(night.timeOfDay).toBe("夜");
    // 时辰不可知:基础行
    const unknown = resolveStoryboardScene(shot({ sceneName: "金水塾馆" }));
    expect(unknown.fact?.name).toBe("金水塾馆");
  });

  it("全断=null 不编造(scene-unresolved 留痕由场景落地驱动承担)", () => {
    installScenes([]);
    expect(resolveStoryboardScene(shot({})).row).toBeNull();
  });
});

describe("resolveShotTimeOfDay(五源序,B2 主修)", () => {
  it("㊠ timeOfDay 新字段(场头时辰落库)第一优先", () => {
    expect(resolveShotTimeOfDay(shot({ timeOfDay: "夜", prompt: "白日当空。" }))).toBe("夜");
  });

  it("㊢ slug 时段 token(jinshui-shuguan-hall-night-v1→夜)", () => {
    expect(
      resolveShotTimeOfDay(shot({
        shotSemantics: {
          sceneViewpointId: "jinshui-shuguan-hall-night-v1",
          personFree: false, visibleCharacters: [], visibleProps: [],
          actionIn: "入画", actionOut: "出画",
        },
      })),
    ).toBe("夜");
  });

  it("㊣ prompt 首字「夜。」探针命中(S9 实录);videoDesc 同查", () => {
    expect(resolveShotTimeOfDay(shot({ prompt: "夜。金水塾馆三间青瓦房。" }))).toBe("夜");
    expect(resolveShotTimeOfDay(shot({ videoDesc: "独孤剑尘晨起收剑。" }))).toBe("晨");
  });

  it("㊤ 场景行态名标记兜底(夜内态);全空=undefined(门A 拒发锚)", () => {
    const stateRow = sceneRow({ name: "金水塾馆·夜内态：两盏油灯" });
    expect(resolveShotTimeOfDay(shot({}), stateRow)).toBe("夜");
    expect(resolveShotTimeOfDay(shot({}), sceneRow({ name: "金水塾馆", time: "" }))).toBeUndefined();
    expect(resolveShotTimeOfDay(shot({}))).toBeUndefined();
  });
});

describe("extractEnvironmentClauses(B3:prompt 列不再整段弃)", () => {
  it("剔除含可见角色名的子句,余句含环境物词才收", () => {
    const clauses = extractEnvironmentClauses(
      "屋内灯下:墨板是拿门板刷了一层墨汁凑的。独孤剑尘捏笔落灰。转身面向孩子开口讲课。晏燎在角落呼吸。",
      ["独孤剑尘", "晏燎"],
    );
    expect(clauses).toEqual(["屋内灯下:墨板是拿门板刷了一层墨汁凑的", "转身面向孩子开口讲课"]);
  });

  it("无环境词子句不收(未知项不猜不写)", () => {
    expect(extractEnvironmentClauses("气氛安静得出奇。", ["甲"])).toEqual([]);
  });
});

describe("buildStoryboardCanonicalContext(1117 C2 装配联动)", () => {
  it("B3:videoDesc 在位时 prompt 环境句萃取进 subject.environmentClauses", async () => {
    installScenes([]);
    const { subject } = await buildStoryboardCanonicalContext(shot({
      videoDesc: "独孤剑尘捏笔落灰、转身开讲。",
      prompt: "屋内灯下:墨板凑的。孩子身形晃动。",
    }));
    expect(subject.environmentClauses).toEqual(["屋内灯下:墨板凑的", "孩子身形晃动"]);
  });

  it("要素⑤:visibleProps 空而点名 tool 资产,name-only 并入配器句", async () => {
    assetsBridge.batchMatch.mockImplementation(async ({ type }: { type: string }) =>
      type === "tool"
        ? [{ name: "白土笔", asset: { name: "白土笔", id: "t1" } }, { name: "墨板", asset: { name: "墨板", id: "t2" } }]
        : []);
    const { subject } = await buildStoryboardCanonicalContext(shot({
      associateAssetsNames: ["独孤剑尘", "白土笔", "墨板"],
      videoDesc: "独孤剑尘开讲。",
    }));
    expect(subject.visibleProps).toEqual([{ name: "白土笔" }, { name: "墨板" }]);
  });

  it("G5③:衍生行缺席=形态句文字承载进 derivedStateNotes(身份段不改写)", async () => {
    installCharacters([{ id: "c1", name: "晏燎", projectId: PROJECT_ID, appearance: "灰袍少年晏燎" }]);
    studioAgentState.agentWorkData = [{
      id: "work-1", key: "directorPlan", episodeId: "chapter-001",
      data: "## ⑦ 衍生资产预划清单\n| 资产名 | 衍生状态 | 原因 |\n|---|---|---|\n| 晏燎·夜课少年 | 基础态锁定:灰布短褐袖口短一截 | Sc3 |\n",
      createdAt: 1, updatedAt: 1,
    }];
    assetsBridge.getByName.mockResolvedValue(null); // 衍生行 0(实库实证)
    const { subject, sentence, warnings } = await buildStoryboardCanonicalContext(shot({
      videoDesc: "晏燎盘坐呼吸。",
      shotSemantics: {
        sceneViewpointId: "v1", personFree: false,
        visibleCharacters: [{ name: "晏燎", position: "北墙角落", orientation: "正面", actionIn: "盘坐", actionOut: "不动" }],
        visibleProps: [], actionIn: "入画", actionOut: "出画",
      },
    }));
    expect(subject.derivedStateNotes?.[0]).toContain("晏燎·夜课少年");
    expect(warnings.join(";")).toContain("derived-missing:晏燎·夜课少年");
    // 身份段禁改写:character-library 回落逐字在句
    expect(sentence.text).toContain("灰袍少年晏燎");
  });

  it("G5③:衍生行带图=挂参考不写形态句", async () => {
    installCharacters([{ id: "c1", name: "晏燎", projectId: PROJECT_ID, appearance: "灰袍少年晏燎" }]);
    studioAgentState.agentWorkData = [{
      id: "work-1", key: "directorPlan", episodeId: "chapter-001",
      data: "## ⑦ 衍生资产预划清单\n| 晏燎·夜课少年 | 基础态锁定:灰布短褐 | Sc3 |",
      createdAt: 1, updatedAt: 1,
    }];
    assetsBridge.getByName.mockResolvedValue({ id: "d1", name: "晏燎·夜课少年", previewUrl: "asset-file://d1.png" });
    const { subject } = await buildStoryboardCanonicalContext(shot({
      videoDesc: "晏燎盘坐呼吸。",
      shotSemantics: {
        sceneViewpointId: "v1", personFree: false,
        visibleCharacters: [{ name: "晏燎", position: "角落", orientation: "正面", actionIn: "盘坐", actionOut: "不动" }],
        visibleProps: [], actionIn: "入画", actionOut: "出画",
      },
    }));
    // 衍生带图=参考承载,形态句零落位(键缺席=无句)
    expect(subject.derivedStateNotes).toBeUndefined();
  });

  it("anchors:场景/时辰/主角(=identities 首位)落位;软名单=visibleCharacters", async () => {
    installScenes([sceneRow({ id: "scene_j", name: "金水塾馆" })]);
    installCharacters([{ id: "c1", name: "独孤剑尘", projectId: PROJECT_ID, appearance: "灰袍客独孤剑尘" }]);
    const { anchors, anchorSoftNames } = await buildStoryboardCanonicalContext(shot({
      associateAssetsIds: ["scene_j"],
      prompt: "夜。金水塾馆灯下。",
      videoDesc: "独孤剑尘开讲。",
      shotSemantics: {
        sceneViewpointId: "v1", personFree: false,
        visibleCharacters: [{ name: "独孤剑尘", position: "中", orientation: "正面", actionIn: "站", actionOut: "讲" }],
        visibleProps: [], actionIn: "入画", actionOut: "出画",
      },
    }));
    expect(anchors.sceneName).toBe("金水塾馆");
    expect(anchors.timeOfDay).toBe("夜");
    expect(anchors.protagonist).toBe("独孤剑尘");
    expect(anchorSoftNames).toEqual(["独孤剑尘"]);
  });
});

describe("collectDerivedAssetPlanEntries(规划⑦ 清单解析)", () => {
  it("最新 directorPlan ⑦ 表解析:kind 按状态列词面(场景/道具/角色)", () => {
    studioAgentState.agentWorkData = [
      {
        id: "work-old", key: "directorPlan", episodeId: "chapter-001",
        data: "| 旧·态 | 旧 | x |", createdAt: 1, updatedAt: 1,
      },
      {
        id: "work-new", key: "directorPlan", episodeId: "chapter-001",
        data: [
          "## ⑦ 衍生资产预划清单",
          "| 资产名 | 衍生状态 | 原因/出现段落 |",
          "|---|---|---|",
          "| 晏燎·夜课少年 | 基础态锁定:灰布短褐 | Sc3 |",
          "| 金水塾馆·夜 | 场景时间态(院门朽匾) | Sc3 |",
          "| 灰白碎灵石 | 道具三态:暗/白闪 | Sc4 |",
        ].join("\n"),
        createdAt: 2, updatedAt: 2,
      },
    ];
    const entries = collectDerivedAssetPlanEntries("chapter-001");
    expect(entries.map((e) => [e.compoundName, e.kind])).toEqual([
      ["晏燎·夜课少年", "role"],
      ["金水塾馆·夜", "scene"],
      ["灰白碎灵石", "tool"],
    ]);
    expect(findDerivedPlanEntryForCharacter(entries, "晏燎")?.compoundName).toBe("晏燎·夜课少年");
  });

  it("无 directorPlan=空数组(fail-open)", () => {
    expect(collectDerivedAssetPlanEntries("chapter-001")).toEqual([]);
  });
});

function storyboardShotFixture() {
  return {
    id: "sb-9k", episodeId: "chapter-001", index: 1,
    trackKey: "001-1", trackId: "", duration: 6,
    prompt: "赵四立于高台挥鞭呵斥。", videoDesc: "赵四立于高台挥鞭呵斥。",
    assetIds: [], state: "idle",
  } as unknown as import("@/types/studio").StoryboardItem;
}
describe("第九刀:vc 缺席不触发弃参考(未知≠单角色)", () => {
  it("无 shotSemantics → 正常构建 context 不抛错", async () => {
    const bare = storyboardShotFixture();
    delete (bare as { shotSemantics?: unknown }).shotSemantics;
    const ctx = await buildStoryboardCanonicalContext(bare);
    expect(ctx).toBeTruthy();
  });
});

describe("十五刀A:sanitizeAssetPromptForIdentity(资产 prompt 列洗版)", () => {
  it("① 铁山实录:负面指令句/换行/英文标签剔,正向视觉文保留(1027→非零)", () => {
    const raw = "男性角色四视图设定图，水墨国风，修仙古韵，工笔线描，写意晕染，宣纸绢本质感，\ncharacter design sheet, character turnaround,\n面容粗犷坚毅，眉眼沉重而刚烈，图中不要有任何文字，禁止写实摄影，严禁照片级真实感，严禁高饱和动漫";
    const out = sanitizeAssetPromptForIdentity(raw);
    expect(out).toContain("水墨国风");
    expect(out).toContain("面容粗犷坚毅");
    expect(out).not.toContain("不要");
    expect(out).not.toContain("禁");
    expect(out).not.toContain("写实");
    expect(out).not.toContain("照片级");
    expect(out).not.toContain("character");
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("② 赵四实录:画幅段(21:9 横幅)与布光段剔,身份特征词保留", () => {
    const raw = "约三十岁的男性码头监工,凶横刻薄,宽方厚重脸、浓眉压眼、眼神严厉,肤色黝黑粗糙,21:9 横幅,均匀柔和散光,四视图面容完全一致";
    const out = sanitizeAssetPromptForIdentity(raw);
    expect(out).toContain("凶横刻薄");
    expect(out).toContain("浓眉压眼");
    expect(out).not.toContain("横幅");
    expect(out).not.toContain("21:9");
    expect(out).not.toContain("散光");
  });

  it("③ 全指令文(铁山纯负面尾部) → 空串=回落 description 取用序", () => {
    expect(sanitizeAssetPromptForIdentity("图中不要有任何文字，禁止写实摄影，严禁照片级真实感")).toBe("");
  });
});
