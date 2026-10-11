// @vitest-environment jsdom
/**
 * 批3 衍生链闭环测试(10-11 pipeline-human-node-automation,G17/R2):
 * 落地→父图先行(缺父图先派父 scriptAsset,衍生参考图吃到新父图)→
 * derivedAssetImage 任务台账(队列既有 kind)→排序(主次/出场频率)→
 * 单条失败不阻塞+例外清单统一重试→幂等(已有图跳过)→未匹配例外行。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  createDefaultFeatureBindings,
  useAPIConfigStore,
  type FeatureBindings,
  type IProvider,
} from "@/stores/ai/api-config-store";
import { useCharacterLibraryStore, type Character } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import type { EntityExtractionResult, ScriptPlan, StoryboardItem } from "@/types/studio";
import {
  buildParentAppearanceCounts,
  deriveChainSortKey,
  retryFailedDerivedChainEntries,
  runDerivedAssetChain,
  useDerivedChainStore,
} from "./derived-asset-chain";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    image: vi.fn().mockResolvedValue({ imageUrl: "https://cdn.example/ok.png" }),
  },
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  AssetType: {},
  selectDaojiePaletteSchemeForAsset: vi.fn().mockResolvedValue(null),
  sanitizeExtendedManualPrompt: vi.fn((text: string) => text),
  batchPolishAssetPrompts: vi.fn(),
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished prompt",
    negativePrompt: "",
  }),
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn().mockResolvedValue("local-image://props/asset.png"),
  getAbsoluteImagePath: vi.fn().mockResolvedValue(null),
  resolveImagePath: vi.fn((path: string) => path),
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (prefix: string) => `${prefix}-test`,
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const CHAPTER_ID = "chapter-001";
const PROJECT_ID = "proj-1";
const PARENT_IMAGE = "project-file://proj-1/workflow-images/assets/character/char-parent-1.png";
const PARENT_PROP_IMAGE = "project-file://proj-1/workflow-images/assets/prop/prop-parent-1.png";

function generatedUrl(index: number) {
  return `project-file://proj-1/workflow-images/assets/derived-${index}.png`;
}

const CHAR_PARENT: Character = {
  id: "char-parent",
  name: "断臂散修",
  description: "断臂老修士",
  visualTraits: "",
  projectId: PROJECT_ID,
  views: [],
  variations: [],
  createdAt: 1,
  updatedAt: 1,
};

const CHAR_NPC_PARENT: Character = {
  ...CHAR_PARENT,
  id: "char-npc",
  name: "青盐帮众",
  thumbnailUrl: PARENT_IMAGE,
};

const PROP_PARENT = {
  id: "prop-parent",
  name: "断剑",
  description: "父道具",
  imageUrl: PARENT_PROP_IMAGE,
  folderId: null,
  projectId: PROJECT_ID,
  createdAt: 1,
};

const EXTRACTION_BATCH: EntityExtractionResult = {
  id: "extract-1",
  episodeId: CHAPTER_ID,
  sourceId: "src-1",
  revision: 1,
  characters: [
    { characterId: "char-parent", name: "断臂散修", aliases: [], importance: "protagonist" },
    { characterId: "char-npc", name: "青盐帮众", aliases: [], importance: "npc" },
  ],
  scenes: [],
  props: [{ assetId: "prop-parent", name: "断剑" }],
};

const DERIVED_PLAN: ScriptPlan["derivedAssetPlan"] = [
  // 预划序:npc 在前、主角在后——排序后主角须先跑(G17 主次优先)
  { parentAssetId: "青盐帮众", state: "雨夜斗笠", reason: "雨夜镜头复用" },
  { parentAssetId: "断臂散修", state: "雨夜湿衣", reason: "雨夜镜头复用" },
  { parentAssetId: "断剑", state: "雨夜湿剑", reason: "特写复用" },
];

function scriptPlanWith(derivedAssetPlan: ScriptPlan["derivedAssetPlan"]): ScriptPlan {
  return {
    id: "plan-1",
    episodeId: CHAPTER_ID,
    sourceId: "src-1",
    revision: 1,
    theme: "",
    visualStyle: "",
    narrativeRhythm: "",
    sceneIntents: [],
    soundDirection: "",
    transitions: "",
    derivedAssetPlan,
  };
}

function chapterShot(index: number, associateAssetsNames: string[]): Pick<StoryboardItem, "id" | "episodeId" | "index" | "associateAssetsNames"> {
  return {
    id: `sb-${CHAPTER_ID}-${String(index).padStart(3, "0")}`,
    episodeId: CHAPTER_ID,
    index,
    associateAssetsNames,
  };
}

const LOCAL_PROVIDER: IProvider = {
  id: "manying-local-image",
  name: "漫影本地生图",
  platform: "manying-local-image",
  baseUrl: "http://127.0.0.1:17595/v1",
  apiKey: "manying-local-image",
  model: ["qwen-image-2-1"],
};

const FANREN_PROVIDER: IProvider = {
  id: "fanren",
  name: "凡人",
  platform: "openai-compatible",
  baseUrl: "https://api.fanren.example/v1",
  apiKey: "sk-fanren-test",
  model: ["gpt-image-2"],
};

function localBindings(): Partial<FeatureBindings> {
  const binding = ["manying-local-image:qwen-image-2-1"];
  return {
    character_generation: binding,
    scene_generation: binding,
    prop_generation: binding,
  };
}

function mockBridges() {
  (window as unknown as Record<string, unknown>).projectFiles = {
    saveImage: vi.fn(async (_payload: { relativePath: string }) => {
      const index = (counter += 1);
      return { success: true, url: generatedUrl(index), size: 1234 };
    }),
    getAbsolutePath: vi.fn().mockResolvedValue("/abs/derived.png"),
  };
  (window as unknown as Record<string, unknown>).studioAssets = {
    getByName: vi.fn().mockResolvedValue({
      id: "asset-lib-1",
      source: "manying-local",
      type: "role",
      name: "断臂散修",
      filePath: "role/asset-1.png",
      state: "success",
    }),
    add: vi.fn().mockResolvedValue({
      id: "asset-lib-1",
      source: "manying-local",
      type: "role",
      name: "断臂散修",
      filePath: "role/asset-1.png",
      state: "success",
    }),
  };
}

let counter = 0;

function seedAll(options?: {
  providers?: IProvider[];
  bindings?: Partial<FeatureBindings>;
  chapterCapCny?: number;
  prices?: Record<string, number>;
  derivedPlan?: ScriptPlan["derivedAssetPlan"];
  storyboards?: Array<Pick<StoryboardItem, "id" | "episodeId" | "index" | "associateAssetsNames">>;
}) {
  useStudioStore.setState({
    entityExtractions: [EXTRACTION_BATCH],
    scriptPlans: [scriptPlanWith(options?.derivedPlan ?? DERIVED_PLAN)],
    storyboards: (options?.storyboards ?? [
      chapterShot(1, ["夜市街口", "断臂散修"]),
      chapterShot(2, ["断臂散修", "断剑"]),
      chapterShot(3, ["断臂散修"]),
    ]) as StoryboardItem[],
  });
  useCharacterLibraryStore.setState({
    characters: [CHAR_PARENT, CHAR_NPC_PARENT],
    folders: [],
    currentFolderId: null,
    selectedCharacterId: null,
  });
  usePropsLibraryStore.setState({ items: [PROP_PARENT], folders: [], selectedFolderId: "all" });
  useSceneStore.setState({ scenes: [], folders: [], currentFolderId: null });
  useAPIConfigStore.setState({
    providers: options?.providers ?? [LOCAL_PROVIDER],
    featureBindings: { ...createDefaultFeatureBindings(), ...localBindings(), ...options?.bindings },
  });
  useScriptAssetCostStore.setState({
    prices: options?.prices ?? {},
    chapterCapCny: options?.chapterCapCny ?? 10,
  });
  useDerivedChainStore.setState({ runsByChapter: {} });
}

function runChain() {
  return runDerivedAssetChain({
    chapterId: CHAPTER_ID,
    projectId: PROJECT_ID,
    visualManualId: "ink",
  });
}

function mediaTasks() {
  return useStudioStore.getState().mediaTasks;
}

function derivedTasks() {
  return mediaTasks().filter((task) => task.kind === "derivedAssetImage");
}

function scriptAssetTasks() {
  return mediaTasks().filter((task) => task.kind === "scriptAsset");
}

beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  delete (window as unknown as Record<string, unknown>).projectFiles;
  delete (window as unknown as Record<string, unknown>).studioAssets;
  useStudioStore.getState().resetStudioWorkflow();
  for (const store of [usePropsLibraryStore, useCharacterLibraryStore, useSceneStore]) {
    (store as unknown as { persist?: { setOptions: (o: unknown) => void } }).persist?.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
  }
  seedAll();
  mockBridges();
  vi.mocked(aiManager.image).mockImplementation(async () => ({
    imageUrl: `https://cdn.example/${(counter += 1)}.png`,
  }));
});

describe("排序(纯函数):主次→出场频率(G17)", () => {
  it("importance 优先于出场数:protagonist 出场 1 次排在 npc 出场 5 次前", () => {
    const protagonist = deriveChainSortKey({
      parentName: "断臂散修",
      importance: "protagonist",
      appearanceCount: 1,
    });
    const npc = deriveChainSortKey({
      parentName: "青盐帮众",
      importance: "npc",
      appearanceCount: 5,
    });
    expect(protagonist[0]).toBeLessThan(npc[0]);
  });

  it("同档按出场数降序;无档(场景/道具)排角色后", () => {
    const more = deriveChainSortKey({ parentName: "甲", importance: "supporting", appearanceCount: 3 });
    const less = deriveChainSortKey({ parentName: "乙", importance: "supporting", appearanceCount: 1 });
    const scene = deriveChainSortKey({ parentName: "夜市街口", importance: undefined, appearanceCount: 9 });
    expect(more[1]).toBeLessThan(less[1]);
    expect(scene[0]).toBeGreaterThan(less[0]);
  });

  it("出场计数:分镜 associateAssetsNames 逐镜归并", () => {
    const counts = buildParentAppearanceCounts([
      chapterShot(1, ["断臂散修", "夜市街口"]),
      chapterShot(2, ["断臂散修"]),
      chapterShot(3, []),
    ]);
    expect(counts.get("断臂散修")).toBe(2);
    expect(counts.get("夜市街口")).toBe(1);
  });
});

describe("衍生链闭环:全链", () => {
  it("缺父图先派父 scriptAsset→衍生参考图吃到新父图→derivedAssetImage 台账", async () => {
    const report = await runChain();

    // 3 条全部成功(主角/npc 角色变体+道具衍生),零失败
    expect(report).toMatchObject({
      total: 3,
      successCount: 3,
      failedCount: 0,
      landedCount: 3,
    });
    // 主角缺父图:补了一枚父 scriptAsset 任务且成功(批1 链)
    const parentTasks = scriptAssetTasks();
    expect(parentTasks).toHaveLength(1);
    expect(parentTasks[0]).toMatchObject({
      targetId: "character:断臂散修",
      status: "success",
    });
    // 3 枚 derivedAssetImage 任务(队列既有 kind),全部 success 带 outputRef
    const derived = derivedTasks();
    expect(derived).toHaveLength(3);
    expect(derived.every((task) => task.status === "success" && task.outputRef)).toBe(true);
    // 排序(主次优先):主角条目先入台账(npc 预划在前被重排;道具无档=0 排最后)
    expect(derived.map((task) => task.targetId)).toEqual([
      "derived:断臂散修:雨夜湿衣",
      "derived:青盐帮众:雨夜斗笠",
      "derived:断剑:雨夜湿剑",
    ]);
    // 主角 2 次 aiManager.image(父+衍生),npc/断剑 1 次(父图已在)
    expect(aiManager.image).toHaveBeenCalledTimes(4);
    // 变体行落图(断言哨兵口径:variation.referenceImage 非空)
    const protagonist = useCharacterLibraryStore.getState().getCharacterById("char-parent");
    const variation = protagonist?.variations.find((item) => item.name === "雨夜湿衣");
    expect(variation?.referenceImage).toBeTruthy();
    // 父图先行实锤:主角衍生的生图请求带刚生成的父图作参考(链首发时父图尚缺,
    // 计划在父图落位后重建——参考图不是空集)
    const parentImage = protagonist?.thumbnailUrl;
    expect(parentImage).toBeTruthy();
    const derivedWithParentRef = vi.mocked(aiManager.image).mock.calls.filter(
      ([request, category]) =>
        category === "character" &&
        Boolean(request.referenceImages?.some((image) => image === parentImage)),
    );
    expect(derivedWithParentRef.length).toBeGreaterThanOrEqual(1);
    // 报表落 zustand 批次态(终态 done)
    const run = useDerivedChainStore.getState().runsByChapter[CHAPTER_ID];
    expect(run?.status).toBe("done");
    expect(run?.report?.parentGeneratedCount).toBe(1);
  });

  it("单条失败不阻塞其余:失败进例外清单,其余继续成", async () => {
    // 发车序:①主角父图 ②主角衍生 ③npc 衍生(炸) ④断剑衍生
    let call = 0;
    vi.mocked(aiManager.image).mockImplementation(async () => {
      call += 1;
      if (call === 3) throw new Error("npc 衍生生图 503");
      return { imageUrl: `https://cdn.example/${call}.png` };
    });

    const report = await runChain();

    expect(report?.successCount).toBe(2);
    expect(report?.failedCount).toBe(1);
    const failedRow = report?.rows.find((row) => row.status === "failed");
    expect(failedRow?.key).toBe("derived:青盐帮众:雨夜斗笠");
    expect(failedRow?.errorReason).toContain("npc 衍生生图 503");
    // 失败台账:derivedAssetImage failed+原因可见(禁静默)
    const failedTask = derivedTasks().find((task) => task.status === "failed");
    expect(failedTask?.errorReason).toContain("npc 衍生生图 503");
    // 其余两条不受阻
    expect(derivedTasks().filter((task) => task.status === "success")).toHaveLength(2);
  });

  it("父资产生成失败:条目进例外清单(parent-failed),不阻塞其余", async () => {
    // 第 1 发=主角父图,炸掉;后续全成功
    let call = 0;
    vi.mocked(aiManager.image).mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("父图生成失败");
      return { imageUrl: `https://cdn.example/${call}.png` };
    });

    const report = await runChain();

    const parentFailedRow = report?.rows.find((row) => row.status === "parent-failed");
    expect(parentFailedRow?.key).toBe("derived:断臂散修:雨夜湿衣");
    expect(parentFailedRow?.errorReason).toContain("父资产图生成失败");
    // 其余(npc/断剑)不受阻,链收终态
    expect(report?.successCount).toBe(2);
    expect(useDerivedChainStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("done");
  });

  it("未匹配父资产:进例外清单(unmatched),零任务派发", async () => {
    seedAll({
      derivedPlan: [
        ...DERIVED_PLAN,
        { parentAssetId: "不存在的资产", state: "幻影", reason: "实体库无此行" },
      ],
    });

    const report = await runChain();

    expect(report?.unmatchedCount).toBe(1);
    const unmatched = report?.rows.find((row) => row.status === "unmatched");
    expect(unmatched?.errorReason).toContain("父资产未匹配");
    // 只跑了 3 条匹配项
    expect(report?.successCount).toBe(3);
    expect(derivedTasks()).toHaveLength(3);
  });

  it("幂等/断点续跑:已有图的衍生不重跑(生图贵)", async () => {
    const first = await runChain();
    expect(first?.successCount).toBe(3);
    expect(aiManager.image).toHaveBeenCalledTimes(4);

    const second = await runChain();

    // 第二轮:全部「已成跳过」,零新任务零新生成
    expect(second).toMatchObject({ successCount: 0, alreadyCompleteCount: 3 });
    expect(derivedTasks()).toHaveLength(3);
    expect(aiManager.image).toHaveBeenCalledTimes(4);
  });

  it("成本护栏 fail-closed:云端通道超章上限未发车(blocked,已完成不回滚)", async () => {
    seedAll({
      providers: [FANREN_PROVIDER],
      bindings: {
        character_generation: ["fanren:gpt-image-2"],
        scene_generation: ["fanren:gpt-image-2"],
        prop_generation: ["fanren:gpt-image-2"],
      },
      prices: { "fanren:gpt-image-2": 3 },
      chapterCapCny: 7,
    });

    const report = await runChain();

    // 排序后:主角(父¥3+衍生¥3=6 ≤7 全过)→断剑衍生 ¥3:6+3>7 拦下→npc ¥3 同拦
    expect(report?.successCount).toBe(1);
    expect(report?.blockedCount).toBe(2);
    expect(report?.rows.filter((row) => row.status === "blocked")).toHaveLength(2);
    // 拦截=未发车:aiManager 只烧了主角的 2 发(父+衍生)
    expect(aiManager.image).toHaveBeenCalledTimes(2);
  });

  it("无视觉手册:落地完成后明示不生成(禁静默半跑)", async () => {
    const report = await runDerivedAssetChain({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: undefined,
    });

    expect(report).toBeNull();
    expect(derivedTasks()).toHaveLength(0);
    // 落地已发生(行在库),生成未发车
    const protagonist = useCharacterLibraryStore.getState().getCharacterById("char-parent");
    expect(protagonist?.variations.some((item) => item.name === "雨夜湿衣")).toBe(true);
    expect(aiManager.image).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("未选择视觉手册"),
    );
  });

  it("防重入:同章在途并入,不另起一批", async () => {
    let releaseImage!: (value: { imageUrl: string }) => void;
    vi.mocked(aiManager.image).mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseImage = resolve;
      }),
    );
    const firstRun = runChain();
    await vi.waitFor(() => {
      expect(
        useDerivedChainStore.getState().runsByChapter[CHAPTER_ID]?.status,
      ).toBe("running");
    });

    const second = await runDerivedAssetChain({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    expect(second).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已并入在途批次"));
    releaseImage({ imageUrl: "https://cdn.example/released.png" });
    const first = await firstRun;
    expect(first?.total).toBe(3);
  });
});

describe("例外清单统一重试", () => {
  it("批完统一重试:失败行重跑成功,报表行回写", async () => {
    let call = 0;
    vi.mocked(aiManager.image).mockImplementation(async () => {
      call += 1;
      if (call === 3) throw new Error("npc 衍生生图 503");
      return { imageUrl: `https://cdn.example/${call}.png` };
    });
    const first = await runChain();
    expect(first?.failedCount).toBe(1);

    // 修好通道后统一重试
    vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://cdn.example/fixed.png" });
    await retryFailedDerivedChainEntries({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    const report = useDerivedChainStore.getState().runsByChapter[CHAPTER_ID]?.report;
    expect(report?.failedCount).toBe(0);
    expect(report?.successCount).toBe(3);
    const row = report?.rows.find((item) => item.key === "derived:青盐帮众:雨夜斗笠");
    expect(row?.status).toBe("success");
    expect(row?.imageRef).toBeTruthy();
  });
});
