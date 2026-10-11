// @vitest-environment jsdom
/**
 * 批2「本章资产一键生成」UI 集成测试(10-11 pipeline-human-node-automation):
 * 按钮入口(资产生成区头部)→ 点击整批跑 → 跑完报表卡(成/失/渠道/成本)→
 * 失败清单行单独重试 → 关闭报表。生成链 mock 在 orchestrator 层
 * (批1 契约:runScriptAssetMediaTask 包装 generateAsset,不越层)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  createDefaultFeatureBindings,
  useAPIConfigStore,
  type FeatureBindings,
  type IProvider,
} from "@/stores/ai/api-config-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { useScriptAssetBatchStore } from "./script-asset-batch";
import {
  retryDerivedChainRow,
  retryFailedDerivedChainEntries,
  runDerivedAssetChain,
  useDerivedChainStore,
} from "./derived-asset-chain";

const orchestratorMocks = vi.hoisted(() => ({
  generateAsset: vi.fn(),
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: orchestratorMocks.generateAsset,
}));

// 批3 衍生链 UI 接线测试用:编排入口 mock(批次态 store 保留真身)
vi.mock("./derived-asset-chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./derived-asset-chain")>();
  return {
    ...actual,
    runDerivedAssetChain: vi.fn(),
    retryDerivedChainRow: vi.fn(),
    retryFailedDerivedChainEntries: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (prefix: string) => `${prefix}-test`,
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const CHAPTER_ID = "chapter-001";
const PROJECT_ID = "proj-1";
const GENERATED_URL = "project-file://proj-1/workflow-images/assets/prop/asset-1.png";
const ABSOLUTE_SOURCE = "/Users/tester/漫影工作室/projects/proj-1/workflow-images/assets/prop/asset-1.png";

const LOCAL_PROVIDER: IProvider = {
  id: "manying-local-image",
  name: "漫影本地生图",
  platform: "manying-local-image",
  baseUrl: "http://127.0.0.1:17595/v1",
  apiKey: "manying-local-image",
  model: ["qwen-image-2-1"],
};

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

const PROP_ASSET = { id: "prop-suoling", name: "锁灵链", description: "缚灵古链", imageUrl: "", folderId: null, projectId: PROJECT_ID, createdAt: 1 };

function libraryAsset(name: string) {
  return {
    id: `asset-lib-${name}`,
    source: "manying-local",
    type: "tool",
    name,
    description: name,
    filePath: `tool/${name}-asset.png`,
    state: "success",
  };
}

function seed() {
  useStudioStore.getState().resetStudioWorkflow();
  useStudioStore.setState({
    entityExtractions: [
      {
        id: "extract-1",
        episodeId: CHAPTER_ID,
        sourceId: "src-1",
        revision: 1,
        characters: [{ characterId: CHAR_ASSET.id, name: CHAR_ASSET.name, aliases: [] }],
        scenes: [],
        props: [{ assetId: PROP_ASSET.id, name: PROP_ASSET.name }],
      },
    ],
    workflowConfig: {
      ...useStudioStore.getState().workflowConfig,
      visualManualId: "ink",
    },
  });
  useCharacterLibraryStore.setState({
    characters: [CHAR_ASSET],
    folders: [],
    currentFolderId: null,
    selectedCharacterId: null,
  });
  usePropsLibraryStore.setState({ items: [PROP_ASSET], folders: [], selectedFolderId: "all" });
  const binding = ["manying-local-image:qwen-image-2-1"];
  useAPIConfigStore.setState({
    providers: [LOCAL_PROVIDER],
    featureBindings: {
      ...createDefaultFeatureBindings(),
      character_generation: binding,
      scene_generation: binding,
      prop_generation: binding,
    },
  });
  useScriptAssetCostStore.setState({ prices: {}, chapterCapCny: 10 });
  useScriptAssetBatchStore.setState({ runsByChapter: {} });
  useDerivedChainStore.setState({ runsByChapter: {} });
  (window as unknown as Record<string, unknown>).projectFiles = {
    saveImage: vi.fn(),
    getAbsolutePath: vi.fn().mockResolvedValue(ABSOLUTE_SOURCE),
  };
  (window as unknown as Record<string, unknown>).studioAssets = {
    getByName: vi.fn(async ({ name }: { name: string }) => libraryAsset(name)),
    add: vi.fn(async ({ name }: { name: string }) => libraryAsset(name)),
    batchMatch: vi.fn(),
  };
}

function renderTab() {
  render(
    <ScriptAssetGenerationTab
      productionEpisodeId={CHAPTER_ID}
      scriptPlanCount={0}
      hasSeriesBible={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const store of [usePropsLibraryStore, useCharacterLibraryStore]) {
    (store as unknown as { persist?: { setOptions: (o: unknown) => void } }).persist?.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
  }
  seed();
  orchestratorMocks.generateAsset.mockReset();
  orchestratorMocks.generateAsset.mockImplementation(async (_task, onProgress) => {
    onProgress?.({ phase: "generating" });
    return { phase: "done", imageLocalPath: GENERATED_URL } as never;
  });
});

afterEach(cleanup);

describe("本章资产一键生成 UI", () => {
  it("头部按钮入口:点击整批跑,跑完报表卡(成/渠道/成本)+断言全过", async () => {
    renderTab();

    const button = screen.getByRole("button", { name: /本章资产一键生成/ });
    expect(button).toBeTruthy();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/成 2 · 失 0/)).toBeTruthy();
    });
    // 渠道分布+成本徽章(本地零计费)
    expect(screen.getByText(/渠道 本地:qwen-image-2-1×2/)).toBeTruthy();
    expect(screen.getByText(/成本 ¥0.00／预估 ¥0.00（上限 ¥10.00）/)).toBeTruthy();
    // 断言哨兵全过:scriptAsset 任务台账 success 且带资产库 filePath
    const tasks = useStudioStore
      .getState()
      .mediaTasks.filter((task) => task.kind === "scriptAsset");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.status === "success" && task.outputRef)).toBe(true);
    expect(orchestratorMocks.generateAsset).toHaveBeenCalledTimes(2);
  });

  it("失败清单:失败行可见原因+单独重试翻绿;护栏拦截行也入清单可重试", async () => {
    orchestratorMocks.generateAsset.mockImplementationOnce(async () => {
      throw new Error("Failed to fetch");
    });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /本章资产一键生成/ }));
    await waitFor(() => {
      expect(screen.getByText(/成 1 · 失 1/)).toBeTruthy();
    });
    // 失败行入清单:行名(资产行同名并存)+原因+重试按钮
    expect(screen.getAllByText("断臂散修").length).toBeGreaterThan(1);
    expect(screen.getByText("Failed to fetch")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: /重试/ });
    expect(retryButton).toBeTruthy();

    fireEvent.click(retryButton);
    await waitFor(() => {
      expect(screen.getByText(/成 2 · 失 0/)).toBeTruthy();
    });
    // 首跑 2 次(1败1成)+ 单行重试 1 次
    expect(orchestratorMocks.generateAsset).toHaveBeenCalledTimes(3);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("断臂散修"),
      expect.anything(),
    );
  });

  it("护栏拦截行入清单并带原因;关闭按钮清掉报表卡", async () => {
    // 云端通道 ¥6/张,上限 ¥4:角色(本地¥0)放行,道具 ¥6>¥4 拦截
    const FANREN: IProvider = {
      id: "fanren",
      name: "凡人",
      platform: "openai-compatible",
      baseUrl: "https://api.fanren.example/v1",
      apiKey: "sk-fanren-test",
      model: ["gpt-image-2"],
    };
    useAPIConfigStore.setState({
      providers: [LOCAL_PROVIDER, FANREN],
      featureBindings: {
        ...createDefaultFeatureBindings(),
        character_generation: ["manying-local-image:qwen-image-2-1"],
        scene_generation: ["manying-local-image:qwen-image-2-1"],
        prop_generation: ["fanren:gpt-image-2"],
      } satisfies Partial<FeatureBindings>,
    });
    useScriptAssetCostStore.setState({ prices: { "fanren:gpt-image-2": 6 }, chapterCapCny: 4 });

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /本章资产一键生成/ }));
    await waitFor(() => {
      expect(screen.getByText(/成 1 · 失 0 · 护栏拦截 1/)).toBeTruthy();
    });
    expect(screen.getByText(/成本护栏/)).toBeTruthy();
    expect(orchestratorMocks.generateAsset).toHaveBeenCalledTimes(1);

    // 关闭报表卡
    fireEvent.click(screen.getByRole("button", { name: "关闭本章生成报表" }));
    await waitFor(() => {
      expect(screen.queryByText(/护栏拦截 1/)).toBeNull();
    });
  });

  it("无提取批次时按钮禁用(不误导可点)", () => {
    useStudioStore.setState({ entityExtractions: [] });
    renderTab();
    expect(
      (screen.getByRole("button", { name: /本章资产一键生成/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("落地衍生资产·衍生链闭环 UI(批3)", () => {
  function renderTabWithPlan() {
    render(
      <ScriptAssetGenerationTab
        productionEpisodeId={CHAPTER_ID}
        scriptPlanCount={1}
        hasSeriesBible={false}
      />,
    );
  }

  beforeEach(() => {
    useProjectStore.setState({ activeProjectId: PROJECT_ID });
  });

  it("按钮直连衍生链全链(落地→父图→衍生图),带章/项目/视觉手册", async () => {
    vi.mocked(runDerivedAssetChain).mockResolvedValue(null);
    renderTabWithPlan();

    fireEvent.click(screen.getByRole("button", { name: /落地衍生资产/ }));
    await waitFor(() => {
      expect(runDerivedAssetChain).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID,
        visualManualId: "ink",
      });
    });
  });

  it("无导演规划(scriptPlanCount=0)按钮禁用——链入口守卫前置到 UI", () => {
    renderTab();
    expect(
      (screen.getByRole("button", { name: /落地衍生资产/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("跑完报表条:成/失/落地/补父图+例外清单统一重试+单行重试+关闭", async () => {
    useDerivedChainStore.setState({
      runsByChapter: {
        [CHAPTER_ID]: {
          chapterId: CHAPTER_ID,
          status: "done",
          progress: { done: 2, total: 2, currentName: "" },
          report: {
            chapterId: CHAPTER_ID,
            startedAt: 1,
            finishedAt: 2,
            durationMs: 1,
            total: 2,
            successCount: 1,
            failedCount: 1,
            blockedCount: 0,
            skippedCount: 0,
            unmatchedCount: 0,
            rows: [
              {
                key: "derived:断臂散修:雨夜湿衣",
                parentName: "断臂散修",
                state: "雨夜湿衣",
                kind: "character",
                status: "success",
                statusLabel: "成功",
                costCny: 0,
                unpriced: false,
              },
              {
                key: "derived:锁灵链:崩碎",
                parentName: "锁灵链",
                state: "崩碎",
                kind: "prop",
                status: "failed",
                statusLabel: "失败",
                errorReason: "生图 503",
                costCny: 0,
                unpriced: false,
              },
            ],
            landedCount: 2,
            alreadyCompleteCount: 0,
            parentGeneratedCount: 1,
            spentCny: 0,
            capCny: 10,
            unpricedCount: 0,
            channelCounts: [],
          },
        },
      },
    });
    renderTabWithPlan();

    expect(screen.getByText(/衍生链：成 1 · 失 1/)).toBeTruthy();
    expect(screen.getByText(/落地 2 条 · 补父图 1 张/)).toBeTruthy();
    // 例外行可见+单行重试走 retryDerivedChainRow
    expect(screen.getByText(/生图 503/)).toBeTruthy();
    vi.mocked(retryDerivedChainRow).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /^重试$/ }));
    await waitFor(() => {
      expect(retryDerivedChainRow).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID,
        visualManualId: "ink",
        parentName: "锁灵链",
        state: "崩碎",
      });
    });
    // 统一重试走 retryFailedDerivedChainEntries(批完统一重试语义)
    vi.mocked(retryFailedDerivedChainEntries).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /统一重试\(1\)/ }));
    await waitFor(() => {
      expect(retryFailedDerivedChainEntries).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID,
        visualManualId: "ink",
      });
    });
    // 关闭报表条
    fireEvent.click(screen.getByRole("button", { name: "关闭衍生链报表" }));
    await waitFor(() => {
      expect(screen.queryByText(/衍生链：成 1 · 失 1/)).toBeNull();
    });
  });
});
