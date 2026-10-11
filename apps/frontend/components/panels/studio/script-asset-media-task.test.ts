// @vitest-environment jsdom
/**
 * 批1 scriptAsset 单资产桥接测试(10-11 pipeline-human-node-automation):
 * 三态(成/败/断言失败)+ 幂等(同指纹 succeeded 跳过 / 指纹变化重跑 / 在途并入)
 * + 桥口径约束(D5:断言只走 App 桥 studioAssets,禁直连 SQLite)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { logEvent } from "@/lib/diagnostics/logger";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { MediaGenerationTask } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import {
  computeScriptAssetInputFingerprint,
  runScriptAssetMediaTask,
  scriptAssetTargetKey,
} from "./script-asset-media-task";
import type { AssetRow } from "./script-asset-generation-model";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    image: vi.fn().mockResolvedValue({ imageUrl: "https://cdn.example/task-lock.png" }),
  },
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (prefix: string) => `${prefix}-test`,
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  AssetType: {},
  selectDaojiePaletteSchemeForAsset: vi.fn().mockResolvedValue(null),
  sanitizeExtendedManualPrompt: vi.fn((text: string) => text),
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished 锁灵链 prompt",
    negativePrompt: "",
  }),
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn().mockResolvedValue("local-image://props/suolinglian.png"),
  getAbsoluteImagePath: vi.fn().mockResolvedValue(null),
  resolveImagePath: vi.fn((path: string) => path),
}));

const GENERATED_URL = "project-file://proj-1/workflow-images/assets/prop/suolinglian-1.png";
const ABSOLUTE_SOURCE = "/Users/tester/漫影工作室/projects/proj-1/workflow-images/assets/prop/suolinglian-1.png";
const LIBRARY_FILE_PATH = "tool/suolinglian-asset-1.png";

const PROP_ASSET = {
  id: "prop-suolinglian",
  name: "锁灵链",
  description: "缚灵古链",
  imageUrl: "",
  folderId: null,
  projectId: "proj-1",
  createdAt: 1,
};

const PROP_ROW: AssetRow = {
  type: "prop",
  id: "prop-suolinglian",
  name: "锁灵链",
  note: "缚灵古链",
  asset: PROP_ASSET,
};

function libraryAsset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "asset-lib-1",
    source: "manying-local",
    type: "tool",
    name: "锁灵链",
    description: "缚灵古链",
    filePath: LIBRARY_FILE_PATH,
    state: "success",
    ...overrides,
  } as StudioAssetSummary;
}

function mockProjectFilesBridge() {
  (window as unknown as Record<string, unknown>).projectFiles = {
    saveImage: vi.fn().mockResolvedValue({ success: true, url: GENERATED_URL, size: 1234 }),
    getAbsolutePath: vi.fn().mockResolvedValue(ABSOLUTE_SOURCE),
  };
}

function mockStudioAssetsBridge(handlers: {
  getByName?: ReturnType<typeof vi.fn>;
  add?: ReturnType<typeof vi.fn>;
}) {
  (window as unknown as Record<string, unknown>).studioAssets = {
    getByName: handlers.getByName ?? vi.fn(),
    add: handlers.add ?? vi.fn(),
  };
}

function mediaTasks(): MediaGenerationTask[] {
  return useStudioStore.getState().mediaTasks;
}

function scriptAssetTasks(): MediaGenerationTask[] {
  return mediaTasks().filter((task) => task.kind === "scriptAsset");
}

function runPropTask(row: AssetRow = PROP_ROW) {
  return runScriptAssetMediaTask({
    row,
    visualManualId: "ink",
    projectId: "proj-1",
    chapterId: "chapter-001",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).projectFiles;
  delete (window as unknown as Record<string, unknown>).studioAssets;
  useStudioStore.getState().resetStudioWorkflow();
  (usePropsLibraryStore as unknown as { persist?: { setOptions: (o: unknown) => void } })
    .persist?.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
  usePropsLibraryStore.setState({
    items: [PROP_ASSET],
    folders: [],
    selectedFolderId: "all",
  });
  mockProjectFilesBridge();
  vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://cdn.example/task-lock.png" });
});

describe("scriptAsset 任务桥接:成功态", () => {
  it("生成→入库→断言全过:任务 success,targetId/指纹/outputRef/checkpointRef 落账", async () => {
    const getByName = vi.fn()
      .mockResolvedValueOnce(null) // 入库前查重:库中无行
      .mockResolvedValueOnce(libraryAsset()); // 断言:行存在+filePath 非空
    const add = vi.fn().mockResolvedValue(libraryAsset());
    mockStudioAssetsBridge({ getByName, add });

    const result = await runPropTask();

    expect(result.status).toBe("success");
    expect(result.outputRef).toBe(LIBRARY_FILE_PATH);
    const tasks = scriptAssetTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: "scriptAsset",
      status: "success",
      targetId: "prop:锁灵链",
      inputFingerprint: expect.any(String),
      episodeId: "chapter-001",
      checkpointRef: "phase:done",
      outputRef: LIBRARY_FILE_PATH,
    });
    // 编排链零改桥接:aiManager 恰好一次;生成图已写回道具行
    expect(aiManager.image).toHaveBeenCalledOnce();
    expect(usePropsLibraryStore.getState().getPropById("prop-suolinglian")?.imageUrl).toBe(
      GENERATED_URL,
    );
    // 自动入库:add 携带经主进程桥解析的受管绝对路径;润色产物作 prompt
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool",
        name: "锁灵链",
        sourceFilePath: ABSOLUTE_SOURCE,
        prompt: "polished 锁灵链 prompt",
      }),
    );
  });

  it("onProgress 阶段实时回写 checkpointRef(phase 标记)", async () => {
    const getByName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset());
    mockStudioAssetsBridge({ getByName, add: vi.fn().mockResolvedValue(libraryAsset()) });

    let resolveImage!: (value: { imageUrl: string }) => void;
    vi.mocked(aiManager.image).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveImage = resolve;
      }),
    );

    const runPromise = runPropTask();
    // 生图挂起期间,任务须已带 generating 阶段标记(进度可见,不靠 toast)
    await vi.waitFor(() => {
      const running = scriptAssetTasks().find((task) => task.status === "running");
      expect(running?.checkpointRef).toBe("phase:generating");
    });
    resolveImage({ imageUrl: "https://cdn.example/task-lock.png" });

    const result = await runPromise;
    expect(result.status).toBe("success");
    expect(scriptAssetTasks()[0].checkpointRef).toBe("phase:done");
  });
});

describe("scriptAsset 任务桥接:失败态", () => {
  it("生成失败(生图抛错):任务 failed 带原因,不触发入库", async () => {
    vi.mocked(aiManager.image).mockRejectedValueOnce(new Error("Failed to fetch"));
    const add = vi.fn();
    const getByName = vi.fn();
    mockStudioAssetsBridge({ getByName, add });

    const result = await runPropTask();

    expect(result.status).toBe("failed");
    expect(result.errorReason).toBe("Failed to fetch");
    const task = scriptAssetTasks()[0];
    expect(task.status).toBe("failed");
    expect(task.errorReason).toBe("Failed to fetch");
    expect(task.checkpointRef).toBe("phase:failed");
    expect(add).not.toHaveBeenCalled();
  });

  it("断言失败(生成 done 但库中无行/无 filePath):failed+『assertion:产物未落盘』,禁静默成功", async () => {
    // 1010 病灶形态:生成链自报 done,但落盘/入库实际没发生——哨兵必须拦下
    const getByName = vi.fn().mockResolvedValue(null);
    const add = vi.fn().mockResolvedValue(null); // 入库也失败(桥静默返回 null)
    mockStudioAssetsBridge({ getByName, add });

    const result = await runPropTask();

    expect(result.status).toBe("failed");
    expect(result.errorReason).toBe("assertion:产物未落盘");
    const task = scriptAssetTasks()[0];
    expect(task.status).toBe("failed");
    expect(task.errorReason).toBe("assertion:产物未落盘");
    expect(task.checkpointRef).toBe("phase:assertion");
    // 断言失败细节落诊断 error 事件(排障抓手,不静默)
    const failureLog = vi.mocked(logEvent).mock.calls.find(
      ([entry]) => entry.message.includes("scriptAsset assertion failed"),
    );
    expect(failureLog?.[0].level).toBe("error");
    expect(failureLog?.[0].context).toMatchObject({ targetId: "prop:锁灵链" });
  });

  it("断言失败(行在但 filePath 为空串)同样拦截", async () => {
    const getByName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset({ filePath: "" }));
    mockStudioAssetsBridge({ getByName, add: vi.fn().mockResolvedValue(libraryAsset({ filePath: "" })) });

    const result = await runPropTask();

    expect(result.status).toBe("failed");
    expect(result.errorReason).toBe("assertion:产物未落盘");
  });

  it("无 App 桥(非桌面环境):任务 failed 明示原因,不烧生成", async () => {
    // 不注入 window.studioAssets

    const result = await runPropTask();

    expect(result.status).toBe("failed");
    expect(result.errorReason).toContain("资产库接口仅在桌面应用中可用");
    expect(aiManager.image).not.toHaveBeenCalled();
    expect(scriptAssetTasks()[0].status).toBe("failed");
  });

  it("行缺本地资产(未落地):failed 明示,不入队生成", async () => {
    mockStudioAssetsBridge({
      getByName: vi.fn().mockResolvedValue(libraryAsset()),
      add: vi.fn(),
    });
    const bareRow: AssetRow = { type: "prop", id: "prop-none", name: "锁灵链" };

    const result = await runPropTask(bareRow);

    expect(result.status).toBe("failed");
    expect(result.errorReason).toContain("缺少可生成的本地资产");
    expect(aiManager.image).not.toHaveBeenCalled();
  });
});

describe("scriptAsset 任务桥接:幂等", () => {
  it("同指纹+succeeded=跳过:不新建任务、不再发图(生图贵)", async () => {
    const getByName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset());
    mockStudioAssetsBridge({ getByName, add: vi.fn().mockResolvedValue(libraryAsset()) });

    const first = await runPropTask();
    expect(first.status).toBe("success");

    const second = await runPropTask();
    expect(second.status).toBe("skipped");
    expect(second.taskId).toBe(first.taskId);
    expect(scriptAssetTasks()).toHaveLength(1);
    expect(aiManager.image).toHaveBeenCalledOnce();
  });

  it("同指纹在途 running=并入,不重复发车", async () => {
    // 种一枚在途任务(同 targetId+同指纹),不再走生成
    const fingerprint = computeScriptAssetInputFingerprint(PROP_ROW, "ink");
    const seededId = useStudioStore.getState().startMediaTask({
      kind: "scriptAsset",
      targetId: scriptAssetTargetKey(PROP_ROW),
      inputFingerprint: fingerprint,
      checkpointRef: "phase:generating",
    });

    const result = await runPropTask();

    expect(result.status).toBe("skipped");
    expect(result.taskId).toBe(seededId);
    expect(scriptAssetTasks()).toHaveLength(1);
    expect(aiManager.image).not.toHaveBeenCalled();
  });

  it("实体行内容变化→指纹变化→重跑并新建任务", async () => {
    const getByName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset());
    mockStudioAssetsBridge({ getByName, add: vi.fn().mockResolvedValue(libraryAsset()) });

    const first = await runPropTask();
    expect(first.status).toBe("success");

    // 内容编辑(描述变化=实体行内容变化)
    const editedAsset = { ...PROP_ASSET, description: "缚灵古链·崩碎后的残链" };
    usePropsLibraryStore.setState({
      items: [editedAsset],
      folders: [],
      selectedFolderId: "all",
    });
    const editedRow: AssetRow = { ...PROP_ROW, asset: editedAsset };
    expect(computeScriptAssetInputFingerprint(editedRow, "ink")).not.toBe(
      computeScriptAssetInputFingerprint(PROP_ROW, "ink"),
    );

    const second = await runScriptAssetMediaTask({
      row: editedRow,
      visualManualId: "ink",
      projectId: "proj-1",
      chapterId: "chapter-001",
    });
    expect(second.status).toBe("success");
    expect(second.taskId).not.toBe(first.taskId);
    expect(scriptAssetTasks()).toHaveLength(2);
    expect(aiManager.image).toHaveBeenCalledTimes(2);
  });

  it("同指纹 failed 任务存在时重试:新任务挂 retryOf 链", async () => {
    vi.mocked(aiManager.image).mockRejectedValueOnce(new Error("boom"));
    mockStudioAssetsBridge({
      getByName: vi.fn().mockResolvedValue(libraryAsset()),
      add: vi.fn(),
    });
    const failedRun = await runPropTask();
    expect(failedRun.status).toBe("failed");

    // 重试:修好生图通道后再跑
    vi.mocked(aiManager.image).mockResolvedValueOnce({ imageUrl: "https://cdn.example/ok.png" });
    const getByName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(libraryAsset());
    mockStudioAssetsBridge({ getByName, add: vi.fn().mockResolvedValue(libraryAsset()) });

    const retried = await runPropTask();
    expect(retried.status).toBe("success");
    const tasks = scriptAssetTasks();
    expect(tasks).toHaveLength(2);
    const retryTask = tasks.find((task) => task.id === retried.taskId);
    expect(retryTask?.retryOf).toBe(failedRun.taskId);
    expect(retryTask?.retryCount).toBe(1);
  });
});

describe("scriptAsset 桥接口径约束(源头锁)", () => {
  it("断言只走 App 桥 getStudioAssetsBridge,禁直连 SQLite(D5 假库陷阱)", () => {
    const source = readFileSync(
      join(process.cwd(), "frontend/components/panels/studio/script-asset-media-task.ts"),
      "utf8",
    );
    expect(source).toContain('import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";');
    expect(source).toContain("bridge.getByName");
    // 禁直连 DB:不引 sqlite 驱动、不碰 SQL 层(注释里解释 D5 陷阱除外)
    expect(source).not.toMatch(/from ["'].*(better-sqlite3|sqlite3|assets-sqlite|assets-queries)["']/);
    expect(source).not.toMatch(/\brunSqlite\w*\(/);
  });

  it("任务中心 label 表收录「资产生成」", () => {
    const source = readFileSync(
      join(process.cwd(), "frontend/components/orbs/use-task-center.ts"),
      "utf8",
    );
    expect(source).toContain('scriptAsset: "资产生成",');
  });
});
