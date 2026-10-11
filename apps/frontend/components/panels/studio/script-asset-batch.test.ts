// @vitest-environment jsdom
/**
 * 批2「本章资产一键生成」编排测试(10-11 pipeline-human-node-automation,G7/G15/G16):
 * 全链一键(本地零计费)/成本护栏 fail-closed(超限未发车不发+已完成不回滚)/
 * 已有图跳过/失败清单+单独重试(含护栏拦下重试)/防重入(同章在途并入)/
 * 断言失败入失败清单(批1 哨兵结果的可视化落点)。
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
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import type { EntityExtractionResult } from "@/types/studio";
import {
  buildChapterAssetRows,
  retryScriptAssetBatchRow,
  runChapterScriptAssetGeneration,
  useScriptAssetBatchStore,
} from "./script-asset-batch";
import { computeScriptAssetInputFingerprint } from "./script-asset-media-task";
import type { AssetRow } from "./script-asset-generation-model";

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
const GENERATED_URL = "project-file://proj-1/workflow-images/assets/prop/asset-1.png";
const ABSOLUTE_SOURCE = "/Users/tester/漫影工作室/projects/proj-1/workflow-images/assets/prop/asset-1.png";

const CHAR_ASSET = {
  id: "char-duanbi",
  name: "断臂散修",
  description: "断臂老修士",
  visualTraits: "",
  projectId: PROJECT_ID,
  views: [],
  variations: [],
  createdAt: 1,
  updatedAt: 1,
};

function propAsset(id: string, name: string, imageUrl = "") {
  return { id, name, description: name, imageUrl, folderId: null, projectId: PROJECT_ID, createdAt: 1 };
}

const PROP_QINGYAN = propAsset("prop-qingyan", "青盐鞭");
const PROP_SUOLING = propAsset("prop-suoling", "锁灵链");

const EXTRACTION_BATCH: EntityExtractionResult = {
  id: "extract-1",
  episodeId: CHAPTER_ID,
  sourceId: "src-1",
  revision: 1,
  characters: [{ characterId: CHAR_ASSET.id, name: CHAR_ASSET.name, aliases: [] }],
  scenes: [],
  props: [
    { assetId: PROP_QINGYAN.id, name: PROP_QINGYAN.name },
    { assetId: PROP_SUOLING.id, name: PROP_SUOLING.name },
  ],
};

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

function libraryAsset(name: string, filePath = `tool/${name}-asset.png`) {
  return {
    id: `asset-lib-${name}`,
    source: "manying-local",
    type: name === CHAR_ASSET.name ? "role" : "tool",
    name,
    description: name,
    filePath,
    state: "success",
  };
}

function mockBridges(options?: { missingAssetNames?: string[] }) {
  const missing = new Set(options?.missingAssetNames ?? []);
  (window as unknown as Record<string, unknown>).projectFiles = {
    saveImage: vi.fn().mockResolvedValue({ success: true, url: GENERATED_URL, size: 1234 }),
    getAbsolutePath: vi.fn().mockResolvedValue(ABSOLUTE_SOURCE),
  };
  (window as unknown as Record<string, unknown>).studioAssets = {
    getByName: vi.fn(async ({ name }: { name: string }) =>
      missing.has(name) ? null : libraryAsset(name),
    ),
    add: vi.fn(async ({ name }: { name: string }) => libraryAsset(name)),
  };
}

function seedAll(options?: {
  providers?: IProvider[];
  bindings?: Partial<FeatureBindings>;
  prices?: Record<string, number>;
  chapterCapCny?: number;
  props?: Array<ReturnType<typeof propAsset>>;
}) {
  useStudioStore.setState({ entityExtractions: [EXTRACTION_BATCH] });
  useCharacterLibraryStore.setState({ characters: [CHAR_ASSET], folders: [], currentFolderId: null, selectedCharacterId: null });
  usePropsLibraryStore.setState({
    items: options?.props ?? [PROP_QINGYAN, PROP_SUOLING],
    folders: [],
    selectedFolderId: "all",
  });
  useAPIConfigStore.setState({
    providers: options?.providers ?? [],
    featureBindings: { ...createDefaultFeatureBindings(), ...options?.bindings },
  });
  useScriptAssetCostStore.setState({
    prices: options?.prices ?? {},
    chapterCapCny: options?.chapterCapCny ?? 10,
  });
  useScriptAssetBatchStore.setState({ runsByChapter: {} });
}

function localBindings() {
  const binding = ["manying-local-image:qwen-image-2-1"];
  return {
    character_generation: binding,
    scene_generation: binding,
    prop_generation: binding,
  };
}

function runBatch() {
  return runChapterScriptAssetGeneration({
    chapterId: CHAPTER_ID,
    projectId: PROJECT_ID,
    visualManualId: "ink",
  });
}

function scriptAssetTasks() {
  return useStudioStore.getState().mediaTasks.filter((task) => task.kind === "scriptAsset");
}

function lastReport() {
  return useScriptAssetBatchStore.getState().runsByChapter[CHAPTER_ID]?.report;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).projectFiles;
  delete (window as unknown as Record<string, unknown>).studioAssets;
  useStudioStore.getState().resetStudioWorkflow();
  for (const store of [usePropsLibraryStore, useCharacterLibraryStore]) {
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
  vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://cdn.example/ok.png" });
});

describe("本章资产一键生成:全链", () => {
  it("本地通道全链:3 行串行派发,断言全过,报表/台账/进度收口(零计费)", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });

    const report = await runBatch();

    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      total: 3,
      successCount: 3,
      failedCount: 0,
      skippedCount: 0,
      blockedCount: 0,
      spentCny: 0,
      capCny: 10,
    });
    expect(report?.channelCounts).toEqual([{ label: "本地:qwen-image-2-1", count: 3 }]);
    expect(report?.unpricedCount).toBe(0);
    // 每行一枚 scriptAsset 任务,全部 success+断言哨兵过(outputRef=资产库 filePath)
    const tasks = scriptAssetTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.status === "success" && task.outputRef)).toBe(true);
    expect(tasks.map((task) => task.targetId).sort()).toEqual(
      ["character:断臂散修", "prop:青盐鞭", "prop:锁灵链"].sort(),
    );
    expect(aiManager.image).toHaveBeenCalledTimes(3);
    // 单一收口 toast:成功汇总,不再逐行弹
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain("成 3 · 失 0");
    // 批次态终态:done + 进度满格
    const run = useScriptAssetBatchStore.getState().runsByChapter[CHAPTER_ID];
    expect(run?.status).toBe("done");
    expect(run?.progress).toMatchObject({ done: 3, total: 3 });
  });

  it("已有图的行跳过不派发(生图贵,禁重跑)", async () => {
    seedAll({
      providers: [LOCAL_PROVIDER],
      bindings: localBindings(),
      props: [PROP_QINGYAN, propAsset(PROP_SUOLING.id, PROP_SUOLING.name, "local-image://props/has.png")],
    });

    const report = await runBatch();

    expect(report?.skippedCount).toBe(1);
    expect(report?.rows.find((row) => row.name === "锁灵链")?.status).toBe("skipped-existing");
    expect(aiManager.image).toHaveBeenCalledTimes(2);
    expect(scriptAssetTasks()).toHaveLength(2);
  });

  it("前置不合规则可见拒绝:无视觉手册/无提取批次/无桥,不烧任何生成", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    await runChapterScriptAssetGeneration({ chapterId: CHAPTER_ID, projectId: PROJECT_ID, visualManualId: undefined });
    expect(toast.error).toHaveBeenCalledWith("请先在「风格与导演」中选择视觉手册");

    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    useStudioStore.setState({ entityExtractions: [] });
    await runBatch();
    expect(toast.info).toHaveBeenCalledWith("本章提取批次没有可生成的资产行");
    expect(aiManager.image).not.toHaveBeenCalled();
  });
});

describe("成本护栏(fail-closed)", () => {
  it("云端单价超限:超上限的行不发车(无任务入账),已发车的不回滚", async () => {
    // 角色=本地 ¥0;道具=凡人 ¥6/张;上限 ¥10:青盐鞭 6(累计 6)放行,锁灵链 6+6=12>10 拦下
    seedAll({
      providers: [LOCAL_PROVIDER, FANREN_PROVIDER],
      bindings: {
        character_generation: ["manying-local-image:qwen-image-2-1"],
        scene_generation: ["manying-local-image:qwen-image-2-1"],
        prop_generation: ["fanren:gpt-image-2"],
      },
      prices: { "fanren:gpt-image-2": 6 },
      chapterCapCny: 10,
    });

    const report = await runBatch();

    expect(report).toMatchObject({
      successCount: 2,
      blockedCount: 1,
      spentCny: 6,
      estimatedCny: 12,
    });
    const blocked = report?.rows.find((row) => row.status === "blocked");
    expect(blocked?.name).toBe("锁灵链");
    expect(blocked?.errorReason).toContain("成本护栏");
    // 未发车不发:被拦行连任务都不建(无生成调用、无台账)
    expect(aiManager.image).toHaveBeenCalledTimes(2);
    expect(scriptAssetTasks()).toHaveLength(2);
    expect(scriptAssetTasks().map((task) => task.targetId).sort()).toEqual(
      ["character:断臂散修", "prop:青盐鞭"].sort(),
    );
    // 已完成不回滚:已发车两枚保持 success
    expect(scriptAssetTasks().every((task) => task.status === "success")).toBe(true);
  });

  it("纯本地通道零计费:任意张数都不受上限拦截", async () => {
    seedAll({
      providers: [LOCAL_PROVIDER],
      bindings: localBindings(),
      chapterCapCny: 0.01,
    });
    const report = await runBatch();
    expect(report?.successCount).toBe(3);
    expect(report?.blockedCount).toBe(0);
  });

  it("未估价云端通道按 ¥0 计并在报表标注(不编造单价)", async () => {
    seedAll({
      providers: [FANREN_PROVIDER],
      bindings: {
        character_generation: ["fanren:gpt-image-2"],
        scene_generation: ["fanren:gpt-image-2"],
        prop_generation: ["fanren:gpt-image-2"],
      },
      prices: {},
    });
    const report = await runBatch();
    expect(report?.successCount).toBe(3);
    expect(report?.spentCny).toBe(0);
    expect(report?.unpricedCount).toBe(3);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const options = vi.mocked(toast.success).mock.calls[0][1] as
      | { description?: string }
      | undefined;
    expect(options?.description).toContain("3 张走未估价云端通道");
  });

  it("重试也过护栏:章内累计已满时,重试付费行被拦下且不再发图", async () => {
    seedAll({
      providers: [LOCAL_PROVIDER, FANREN_PROVIDER],
      bindings: {
        character_generation: ["manying-local-image:qwen-image-2-1"],
        scene_generation: ["manying-local-image:qwen-image-2-1"],
        prop_generation: ["fanren:gpt-image-2"],
      },
      prices: { "fanren:gpt-image-2": 6 },
      chapterCapCny: 12,
    });
    // 青盐鞭生成失败(第 2 次调用拒),其余成;章累计=12(0+6+6)
    vi.mocked(aiManager.image)
      .mockResolvedValueOnce({ imageUrl: "https://cdn.example/ok.png" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ imageUrl: "https://cdn.example/ok.png" });
    const report = await runBatch();
    expect(report).toMatchObject({ successCount: 2, failedCount: 1, spentCny: 12 });

    await retryScriptAssetBatchRow({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      type: "prop",
      name: "青盐鞭",
    });
    expect(aiManager.image).toHaveBeenCalledTimes(3); // 重试被护栏拦下,无新调用
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("成本护栏"),
      expect.anything(),
    );
    expect(lastReport()?.failedCount).toBe(1);
  });
});

describe("失败清单 + 单独重试", () => {
  it("生成失败入清单;修好通道后单行重试成功,报表行就地翻绿", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    vi.mocked(aiManager.image)
      .mockResolvedValueOnce({ imageUrl: "https://cdn.example/ok.png" })
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ imageUrl: "https://cdn.example/ok.png" });

    const report = await runBatch();
    expect(report).toMatchObject({ successCount: 2, failedCount: 1 });
    const failedRow = report?.rows.find((row) => row.status === "failed");
    expect(failedRow?.name).toBe("青盐鞭");
    expect(failedRow?.errorReason).toBe("Failed to fetch");
    // 失败行落在台账(failed),可分诊
    expect(scriptAssetTasks().find((task) => task.targetId === "prop:青盐鞭")?.status).toBe("failed");

    // 单独重试:通道修好 → 成功,报表行翻绿、计数重算
    await retryScriptAssetBatchRow({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      type: "prop",
      name: "青盐鞭",
    });
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("青盐鞭"),
      expect.anything(),
    );
    const patched = lastReport();
    expect(patched).toMatchObject({ successCount: 3, failedCount: 0 });
    expect(patched?.rows.find((row) => row.name === "青盐鞭")?.status).toBe("success");
    // 重试走 scriptAsset 执行体:新任务挂 retryOf 链(retryFailedMediaTasks 台账语义)
    const tasks = scriptAssetTasks();
    expect(tasks).toHaveLength(4);
    const retryTask = tasks[tasks.length - 1];
    expect(retryTask.retryOf).toBe(tasks.find((task) => task.targetId === "prop:青盐鞭" && task.status === "failed")?.id);
  });

  it("断言失败(生成 done 但产物未落盘)入失败清单,禁静默成功", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    mockBridges({ missingAssetNames: [PROP_SUOLING.name] });

    const report = await runBatch();

    expect(report).toMatchObject({ successCount: 2, failedCount: 1 });
    const row = report?.rows.find((item) => item.name === PROP_SUOLING.name);
    expect(row?.errorReason).toBe("assertion:产物未落盘");
    expect(scriptAssetTasks().find((task) => task.targetId === "prop:锁灵链")?.status).toBe("failed");
  });
});

describe("防重入(同章在途并入)", () => {
  it("在途批次未收口时再点:并入不另起批,不重复发车", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    let resolveFirst!: (value: { imageUrl: string }) => void;
    vi.mocked(aiManager.image).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const firstRun = runBatch();
    // 首批已发车(在途):第二次点击直接并入
    const secondRun = await runBatch();
    expect(secondRun).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已并入在途批次"));

    resolveFirst({ imageUrl: "https://cdn.example/ok.png" });
    // 生图 resolve 后续两行回落默认 mock,批次收口
    vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://cdn.example/ok.png" });
    const report = await firstRun;
    expect(report?.successCount).toBe(3);
    expect(scriptAssetTasks()).toHaveLength(3);
  });

  it("上批全成后再点:全部已有图→整批免跑早退,不再生图(生图贵)", async () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    const first = await runBatch();
    expect(first?.successCount).toBe(3);

    const second = await runBatch();
    // 全部行已有图(首轮成功已写回):不再发车,可见提示后早退
    expect(second).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("均已有图"));
    expect(aiManager.image).toHaveBeenCalledTimes(3);
  });
});

describe("行收集口径", () => {
  it("只取本章提取批次,跨章批次不并入", () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    useStudioStore.setState({
      entityExtractions: [
        EXTRACTION_BATCH,
        {
          id: "extract-2",
          episodeId: "chapter-002",
          sourceId: "src-2",
          revision: 1,
          characters: [{ characterId: "char-other", name: "别章角色", aliases: [] }],
          scenes: [],
          props: [],
        },
      ],
    });
    const rows = buildChapterAssetRows(CHAPTER_ID, PROJECT_ID);
    expect(rows.map((row) => row.name)).toEqual(["断臂散修", "青盐鞭", "锁灵链"]);
  });

  it("指纹沿用批1 口径(实体行内容+视觉手册),供幂等复用", () => {
    seedAll({ providers: [LOCAL_PROVIDER], bindings: localBindings() });
    const rows = buildChapterAssetRows(CHAPTER_ID, PROJECT_ID);
    const character = rows[0];
    if (character.type !== "character") throw new Error("expected character row first");
    const fresh: AssetRow = {
      ...character,
      asset: useCharacterLibraryStore.getState().getCharacterById(character.id),
    };
    expect(computeScriptAssetInputFingerprint(character, "ink")).toBe(
      computeScriptAssetInputFingerprint(fresh, "ink"),
    );
  });
});
