import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: vi.fn(),
}));

// ── 1117 C2 G1/G5:场景五级序与衍生预划经 canonical-context 消费 store——注入桩。 ──
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
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioAgentState },
}));

const bridgeMock = vi.mocked(getStudioAssetsBridge);

afterEach(() => {
  bridgeMock.mockReset();
});

function makeBridge(entries: {
  scene?: Array<{ name: string; assetName?: string; id?: string; previewUrl?: string; images?: Array<{ name?: string; url?: string }> }>;
  role?: Array<{ name: string; assetName?: string; id?: string; previewUrl?: string; images?: Array<{ name?: string; url?: string }> }>;
  tool?: Array<{ name: string; assetName?: string; id?: string; previewUrl?: string; images?: Array<{ name?: string; url?: string }> }>;
}) {
  return {
    batchMatch: vi.fn(({ type }: { type: string }) => Promise.resolve(
      (type === "scene" ? entries.scene ?? []
        : type === "role" ? entries.role ?? []
        : entries.tool ?? []).map((entry) => ({
        name: entry.name,
        asset: {
          id: entry.id ?? `id-${entry.name}`,
          name: entry.assetName ?? entry.name,
          previewUrl: entry.previewUrl === undefined ? `file:///assets/${entry.name}.png` : entry.previewUrl,
          ...(entry.images ? { images: entry.images } : {}),
        },
      })),
    )),
  } as never;
}

describe("resolveStoryboardAssetReferences", () => {
  it("collects lightweight file:// urls scene-first then characters with caps", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水河码头" }, { name: "道口镇" }],
      role: [
        { name: "独孤剑尘" }, { name: "赵四" }, { name: "老苦力" }, { name: "铁山" },
      ],
    }));

    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水河码头", "道口镇", "独孤剑尘", "赵四", "老苦力", "铁山"],
    });

    expect(refs?.map((ref) => [ref.title, ref.assetType, ref.imageUrl.startsWith("file://")])).toEqual([
      ["金水河码头", "scene", true],
      ["独孤剑尘", "character", true],
      ["赵四", "character", true],
      ["老苦力", "character", true],
    ]);
  });

  it("never returns data: urls (persistence discipline) and skips imageless matches", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [
        { name: "赵四", previewUrl: "" },
        { name: "旧资产", previewUrl: "data:image/png;base64,QUJD" },
        { name: "临时预览", previewUrl: "blob:https://example.test/transient" },
        { name: "老苦力" },
      ],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["赵四", "旧资产", "临时预览", "老苦力"],
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["老苦力"]);
    expect(refs?.every((ref) => !/^(?:data|blob):/.test(ref.imageUrl))).toBe(true);
  });

  it("fails empty when the bridge is missing or names are absent", async () => {
    bridgeMock.mockReturnValue(undefined);
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: ["赵四"] })).toEqual([]);
    bridgeMock.mockReturnValue(makeBridge({}));
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: [] })).toEqual([]);
  });
  it("filters off-frame characters when frame text exists (S08 身份防线)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水河码头" }],
      role: [
        { name: "独孤剑尘" }, { name: "监工赵四" }, { name: "小杂役" },
      ],
    }));
    // S08 画面: 小杂役+赵四扬鞭;独孤剑尘在 associateAssetsNames 但不在画面
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水河码头", "独孤剑尘", "小杂役", "灵矿藤筐"],
      videoDesc: "小杂役指腹被灵矿倒刺扎破，抬头时赵四已从右侧逼近并扬起长鞭；小杂役缩住肩膀。",
    });
    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([
      ["金水河码头", "scene"],
      ["监工赵四", "character"],
      ["小杂役", "character"],
    ]);
  });

  it("keeps a character referenced by full name in frame text", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "独孤剑尘" }, { name: "赵四" }],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["独孤剑尘", "赵四"],
      prompt: "独孤剑尘低头从两人侧后方经过；赵四手腕压下。",
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["独孤剑尘", "赵四"]);
  });

  it("keeps a character referenced by short name in frame text (R17 正文短名方向)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水塾馆" }],
      role: [{ name: "独孤剑尘" }, { name: "管事", assetName: "李先生;管事" }],
    }));
    // 正文只写「独孤」不写全名——旧逻辑静默滤掉参考,模型自由发挥画成黑发青年
    // (08-28 S10/S21/S35 等实锤);前缀截取(独孤/独孤剑)命中即视为提名
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水塾馆", "独孤剑尘", "管事"],
      videoDesc: "独孤观察、抬手又停，管事在门口持筹",
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["金水塾馆", "独孤剑尘", "李先生;管事"]);
  });

  it("F5①(1115):scene 包含命中(短名查询→全名资产)挂载为场景参考", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "灵矿", assetName: "灵矿坑道葬玉;灵矿坑道;坑道深处石室" }],
      role: [{ name: "独孤剑尘" }],
    }));

    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["灵矿", "独孤剑尘"],
      videoDesc: "独孤剑尘蹲在坑道里，指腹被灵矿倒刺扎破。",
    });

    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([
      ["灵矿坑道葬玉;灵矿坑道;坑道深处石室", "scene"],
      ["独孤剑尘", "character"],
    ]);
  });

  it("queries the bridge for tool assets and lands them as prop references with cap 2 (L1 两词分工)", async () => {
    const bridge = makeBridge({
      scene: [{ name: "金水河码头" }],
      role: [{ name: "赵四" }],
      tool: [{ name: "青盐鞭" }, { name: "灵矿藤筐" }, { name: "第三件道具" }],
    });
    bridgeMock.mockReturnValue(bridge);
    const names = ["金水河码头", "赵四", "青盐鞭", "灵矿藤筐", "第三件道具"];

    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: names,
      id: "sb-chapter-001-001",
      videoDesc: "赵四在金水河码头扬起青盐鞭。",
    });

    // 桥查询词=tool(DB 实型);引用层=prop(拼板标签/@图N kindLabel/连续性落库键)
    expect((bridge as unknown as { batchMatch: { mock: { calls: Array<[unknown]> } } }).batchMatch.mock.calls
      .some(([payload]) => JSON.stringify(payload) === JSON.stringify({ type: "tool", names }))).toBe(true);
    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([
      ["金水河码头", "scene"],
      ["赵四", "character"],
      ["青盐鞭", "prop"],
      ["灵矿藤筐", "prop"],
    ]);
  });

  it("logs a warn diagnostics trace when names are present but the bridge is missing (L2 fail-empty 可观测)", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { diagnosticsLog: { write } });
    try {
      bridgeMock.mockReturnValue(undefined);
      const refs = await resolveStoryboardAssetReferences({
        associateAssetsNames: ["赵四", "青盐鞭"],
        id: "sb-chapter-001-001",
      });
      expect(refs).toEqual([]);
      expect(write).toHaveBeenCalledTimes(1);
      const entry = write.mock.calls[0]?.[0] as {
        level: string; message: string; context: Record<string, unknown>;
      };
      expect(entry.level).toBe("warn");
      expect(entry.message).toContain("bridge missing");
      expect(entry.context.shotId).toBe("sb-chapter-001-001");
      expect(entry.context.associateAssetsNames).toEqual(["赵四", "青盐鞭"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a character referenced only by suffix short name in frame text (L4 后缀方向)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "独孤剑尘" }],
    }));
    // 正文只写「剑尘」——全名/剥前缀/前缀逐级截取全不命中,后缀截取(≥2字)兜住;
    // 旧逻辑静默滤掉,道具/环境之外的主角参考也丢
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["独孤剑尘"],
      videoDesc: "剑尘侧身避开鞭梢，肩头擦出一线血痕。",
    });
    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([["独孤剑尘", "character"]]);
  });

  it("still filters a character with zero mention after suffix matching is in play (S08 防线不破)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "独孤剑尘" }, { name: "赵四" }],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["独孤剑尘", "赵四"],
      videoDesc: "赵四把鞭子盘在腰间，走进矿洞深处。",
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["赵四"]);
  });

  // === 1115 第六病理修(参考图种类错配):资产库单姿立绘优先 ===

  it("prefers gallery single-pose portrait over card/plain main for characters (单姿立绘优先)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [
        {
          // 晏燎实盘形态:主图=人脸派生(无单姿标记),图库含 _人物图_ 单姿
          name: "晏燎",
          previewUrl: "file:///assets/role/晏燎/晏燎_无衣物定妆_v1_人脸_2026年10月26日.png",
          images: [
            { name: "晏燎_多视图_2026年10月26日", url: "file:///assets/role/晏燎/晏燎_多视图_2026年10月26日.png" },
            { name: "晏燎_人物图_2026年10月26日", url: "file:///assets/role/晏燎/晏燎_人物图_2026年10月26日.png" },
          ],
        },
      ],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["晏燎"],
      videoDesc: "晏燎立在坑道口。",
    });
    expect(refs?.[0]?.imageUrl).toBe("file:///assets/role/晏燎/晏燎_人物图_2026年10月26日.png");
  });

  it("keeps main image when it is already single-pose or gallery has no pose (主图已单姿/无更优)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [
        {
          name: "独孤剑尘",
          previewUrl: "file:///assets/role/独孤剑尘/独孤剑尘_人物图_2026年10月21日.png",
          images: [{ name: "独孤剑尘_多视图_2026年10月21日", url: "file:///assets/role/独孤剑尘/独孤剑尘_多视图_2026年10月21日.png" }],
        },
        {
          // 赵四实盘形态:主图与图库均无单姿标记 → 维持主图(横幅卡由拼板层裁切兜底)
          name: "赵四",
          previewUrl: "file:///assets/role/赵四/监工赵四,赵四_袍旧版_2026年10月21日.png",
          images: [{ name: "监工赵四,赵四_监工赵四_c3c92dfb_2026年10月21日", url: "file:///assets/role/赵四/监工赵四,赵四_监工赵四_c3c92dfb_2026年10月21日.png" }],
        },
      ],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["独孤剑尘", "赵四"],
      videoDesc: "独孤剑尘与赵四在坑道深处对峙。",
    });
    expect(refs?.[0]?.imageUrl).toBe("file:///assets/role/独孤剑尘/独孤剑尘_人物图_2026年10月21日.png");
    expect(refs?.[1]?.imageUrl).toBe("file:///assets/role/赵四/监工赵四,赵四_袍旧版_2026年10月21日.png");
  });

  it("never switches image for scene references even when gallery has pose-named images (场景零切)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [
        {
          name: "灵矿坑道葬玉",
          previewUrl: "file:///assets/scene/灵矿坑道葬玉/灵矿坑道葬玉_场景图.png",
          images: [{ name: "灵矿坑道葬玉_人物图_2026年10月26日", url: "file:///assets/scene/灵矿坑道葬玉/pose.png" }],
        },
      ],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["灵矿坑道葬玉"],
    });
    expect(refs?.[0]?.imageUrl).toBe("file:///assets/scene/灵矿坑道葬玉/灵矿坑道葬玉_场景图.png");
  });
});


// ─── 1117 C2:off-frame 第四源(visibleCharacters 提名)/场景名前置/衍生优先 ───

describe("resolveStoryboardAssetReferences 1117 C2 联动", () => {
  beforeEach(() => {
    sceneState.scenes = [];
    characterState.characters = [];
    studioAgentState.agentWorkData = [];
  });

  it("B5:visibleCharacters 名单=提名(S11 晏燎参考恢复——videoDesc 只写「孩子们」)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "晏燎" }, { name: "管事" }],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["管事", "晏燎"],
      videoDesc: "管事蹲到第一排按背,孩子们憋笑。",
      shotSemantics: {
        sceneViewpointId: "hall-night-v1", personFree: false,
        visibleCharacters: [
          { name: "管事", position: "前排", orientation: "正面", actionIn: "按背", actionOut: "直身" },
          { name: "晏燎", position: "北墙角落", orientation: "正面", actionIn: "盘坐", actionOut: "不动" },
        ],
        visibleProps: [], actionIn: "入画", actionOut: "出画",
      },
    } as never);
    // 晏燎:文本零点名但语义在场=提名→参考保留(旧滤网会滤掉)
    expect(refs?.map((ref) => ref.title).sort()).toEqual(["晏燎", "管事"]);
  });

  it("G3:G1 解析场景名前置进 scene 发查询名单(S12 id 命中金水塾馆,场景节点恢复可挂)", async () => {
    sceneState.scenes = [
      { id: "scene_1780296482374_jew094y", name: "金水塾馆", location: "金水塾馆", projectId: "p1" },
    ];
    const bridge = makeBridge({
      scene: [{ name: "金水塾馆" }],
      role: [{ name: "独孤剑尘" }],
    });
    bridgeMock.mockReturnValue(bridge);
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsIds: ["scene_1780296482374_jew094y"],
      associateAssetsNames: ["独孤剑尘"],
      videoDesc: "独孤剑尘捏笔落灰、转身开讲。",
    } as never);
    const sceneCall = (bridge as unknown as { batchMatch: { mock: { calls: Array<[{ type: string; names: string[] }]> } } })
      .batchMatch.mock.calls.find(([payload]) => payload.type === "scene");
    expect(sceneCall?.[0].names[0]).toBe("金水塾馆");
    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([
      ["金水塾馆", "scene"],
      ["独孤剑尘", "character"],
    ]);
  });

  it("G5①:规划⑦衍生行带图=角色参考改挂衍生行(基础行留 derived-preferred 痕)", async () => {
    characterState.characters = [{ id: "c1", name: "晏燎", projectId: "p1" }];
    studioAgentState.agentWorkData = [{
      id: "work-1", key: "directorPlan", episodeId: "chapter-001",
      data: "## ⑦ 衍生资产预划清单\n| 资产名 | 衍生状态 |\n| 晏燎·夜课少年 | 基础态锁定:灰布短褐 |",
      createdAt: 1, updatedAt: 1,
    }];
    const bridge = makeBridge({
      role: [{ name: "晏燎", previewUrl: "file:///assets/role/晏燎/主图人脸.png" }],
    });
    // 衍生单发:名字=复合名时返回衍生行(带图)
    const batchMatchFn = (bridge as unknown as { batchMatch: ReturnType<typeof vi.fn> }).batchMatch;
    batchMatchFn.mockImplementation(async (payload: { type: string; names: string[] }) => {
        if (payload.type === "role" && payload.names.includes("晏燎·夜课少年")) {
          return [{
            name: "晏燎·夜课少年",
            asset: {
              id: "derived-1", name: "晏燎·夜课少年",
              previewUrl: "file:///assets/role/晏燎/晏燎·夜课少年_人物图_v1.png",
            },
          }];
        }
        if (payload.type === "role") {
          return [{ name: "晏燎", asset: { id: "base-1", name: "晏燎", previewUrl: "file:///assets/role/晏燎/主图人脸.png" } }];
        }
        return [];
      });
    bridgeMock.mockReturnValue(bridge);
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["晏燎"],
      videoDesc: "晏燎盘坐呼吸。",
      shotSemantics: {
        sceneViewpointId: "v1", personFree: false,
        visibleCharacters: [{ name: "晏燎", position: "角落", orientation: "正面", actionIn: "盘坐", actionOut: "不动" }],
        visibleProps: [], actionIn: "入画", actionOut: "出画",
      },
    } as never);
    expect(refs?.[0]).toMatchObject({
      title: "晏燎·夜课少年",
      imageUrl: "file:///assets/role/晏燎/晏燎·夜课少年_人物图_v1.png",
    });
  });
});
