// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsRuntimeStatus } from "@/types/tts";

const mocks = vi.hoisted(() => ({
  getTtsRuntimeStatus: vi.fn(),
  getModelStatus: vi.fn(),
  getActiveTasks: vi.fn(),
  getModelCacheDir: vi.fn(),
  migrateTtsRuntimeStorage: vi.fn(),
  startTtsRuntime: vi.fn(),
  stopTtsRuntime: vi.fn(),
  setTtsModelCacheDir: vi.fn(),
  downloadModel: vi.fn(),
  cancelModelDownload: vi.fn(),
  deleteModel: vi.fn(),
  unloadModel: vi.fn(),
  subscribeModelProgress: vi.fn(),
  statusResolvers: [] as Array<(status: TtsRuntimeStatus) => void>,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  createVoiceProfile: vi.fn(),
  getStorageManagerBridge: vi.fn(),
}));

vi.mock("@/lib/tts/client", () => ({
  getTtsRuntimeStatus: mocks.getTtsRuntimeStatus,
  getModelStatus: mocks.getModelStatus,
  getActiveTasks: mocks.getActiveTasks,
  getModelCacheDir: mocks.getModelCacheDir,
  migrateTtsRuntimeStorage: mocks.migrateTtsRuntimeStorage,
  startTtsRuntime: mocks.startTtsRuntime,
  stopTtsRuntime: mocks.stopTtsRuntime,
  setTtsModelCacheDir: mocks.setTtsModelCacheDir,
  downloadModel: mocks.downloadModel,
  cancelModelDownload: mocks.cancelModelDownload,
  deleteModel: mocks.deleteModel,
  unloadModel: mocks.unloadModel,
  subscribeModelProgress: mocks.subscribeModelProgress,
}));

vi.mock("@/stores/tts/tts-store", () => ({
  useTtsStore: (selector: (state: unknown) => unknown) => selector({
    voiceProfiles: {},
    createVoiceProfile: mocks.createVoiceProfile,
  }),
}));

vi.mock("@/lib/bridge/storage-manager", () => ({
  getStorageManagerBridge: mocks.getStorageManagerBridge,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("./VoiceProfileSection", () => ({ VoiceProfileSection: () => <div>voice profiles</div> }));

import { LocalTtsPanel } from "./LocalTtsPanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function status(overrides: Partial<TtsRuntimeStatus> = {}): TtsRuntimeStatus {
  return {
    installed: true,
    running: false,
    port: 17593,
    baseUrl: "http://127.0.0.1:17593",
    ...overrides,
  };
}

async function resolveNextStatus(value: TtsRuntimeStatus) {
  const resolve = mocks.statusResolvers.shift();
  expect(resolve).toBeDefined();
  await act(async () => {
    resolve?.(value);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.statusResolvers.length = 0;
  mocks.getTtsRuntimeStatus.mockImplementation(
    () => new Promise<TtsRuntimeStatus>((resolve) => mocks.statusResolvers.push(resolve)),
  );
  mocks.getModelStatus.mockResolvedValue({ models: [] });
  mocks.getActiveTasks.mockResolvedValue({ downloads: [], generations: [] });
  mocks.getModelCacheDir.mockResolvedValue({ path: "TTS/model", scan_paths: [] });
  mocks.migrateTtsRuntimeStorage.mockResolvedValue({ success: true });
  mocks.subscribeModelProgress.mockResolvedValue(() => {});
  mocks.startTtsRuntime.mockResolvedValue({ success: true, status: status({ running: true }) });
  mocks.stopTtsRuntime.mockResolvedValue({ success: true });
  mocks.setTtsModelCacheDir.mockResolvedValue({ success: true });
  mocks.downloadModel.mockResolvedValue({ message: "started" });
  mocks.cancelModelDownload.mockResolvedValue({ message: "cancelled" });
  mocks.deleteModel.mockResolvedValue({ message: "deleted" });
  mocks.unloadModel.mockResolvedValue({ message: "unloaded" });
  mocks.getStorageManagerBridge.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
});

describe("LocalTtsPanel mounted lifecycle", () => {
  it("uses the parent width when embedded and preserves the standalone width cap", () => {
    const embedded = render(<LocalTtsPanel embedded />);
    expect(embedded.container.firstElementChild?.className).toContain("w-full");
    expect(embedded.container.firstElementChild?.className).toContain("xl:p-10");
    expect(embedded.container.firstElementChild?.className).not.toContain("max-w-6xl");
    embedded.unmount();

    const standalone = render(<LocalTtsPanel />);
    expect(standalone.container.querySelector(".max-w-6xl")).toBeTruthy();
  });

  it("cancels the delayed initial refresh when unmounted", async () => {
    const { unmount } = render(<LocalTtsPanel />);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.getTtsRuntimeStatus).not.toHaveBeenCalled();
  });

  it("refreshes while mounted and clears the runtime interval on unmount", async () => {
    const { unmount } = render(<LocalTtsPanel />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.getTtsRuntimeStatus).toHaveBeenCalledTimes(1);
    await resolveNextStatus(status({ running: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.getTtsRuntimeStatus).toHaveBeenCalledTimes(2);
    await resolveNextStatus(status({ running: true }));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.getTtsRuntimeStatus).toHaveBeenCalledTimes(2);
  });

  it("renders startup progress from the mounted status poll", async () => {
    render(<LocalTtsPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await resolveNextStatus(status());

    const start = deferred<{ success: boolean; error?: string }>();
    mocks.startTtsRuntime.mockReturnValue(start.promise);
    fireEvent.click(screen.getByRole("button", { name: "启动 TTS 后端服务" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await resolveNextStatus(status({ setupStage: "checking", setupProgress: 42 }));

    expect(screen.getByText("正在检查 Python 运行环境")).toBeTruthy();
    start.resolve({ success: false, error: "启动失败" });
  });

  it("keeps the desktop-only folder guard when the storage bridge is unavailable", () => {
    render(<LocalTtsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "选择模型目录" }));

    expect(mocks.toast.error).toHaveBeenCalledWith("选择文件夹仅在桌面应用中可用");
  });

  it("confirms before migrating the fixed legacy TTS directories", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.getTtsRuntimeStatus.mockResolvedValue(status({
      storageLayout: {
        rootDir: "/data/TTS",
        runtimeDir: "/data/TTS/runtime",
        modelsDir: "/data/TTS/model",
        legacyRuntimeDir: "/data/tts-runtime",
        legacyModelsDir: "/data/tts-models",
        legacyDefaultModelsDir: "/data/TTS/models",
        legacyHuggingFaceHubDir: "/Users/test/.cache/huggingface/hub",
        legacyRuntimeExists: true,
        legacyModelsExists: true,
        legacyDefaultModelsExists: false,
        legacyHuggingFaceHubExists: true,
        migrationState: "ready",
      },
    }));
    render(<LocalTtsPanel />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    fireEvent.click(screen.getByRole("button", { name: "迁移到 TTS 文件夹" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.migrateTtsRuntimeStorage).toHaveBeenCalledOnce();
    expect(mocks.toast.success).toHaveBeenCalledWith("TTS 文件夹已迁移");
    confirm.mockRestore();
  });

  it("applies the directory selected through the storage bridge", async () => {
    const selectDirectory = vi.fn().mockResolvedValue("/models");
    mocks.getStorageManagerBridge.mockReturnValue({ selectDirectory });
    mocks.getTtsRuntimeStatus.mockResolvedValue(status());
    render(<LocalTtsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "选择模型目录" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(selectDirectory).toHaveBeenCalledOnce();
    expect(mocks.setTtsModelCacheDir).toHaveBeenCalledWith("/models");
    expect(mocks.toast.success).toHaveBeenCalledWith("模型缓存路径已切换");
  });

  it("saves a manually entered model cache path", async () => {
    mocks.getTtsRuntimeStatus.mockResolvedValue(status({
      modelCacheDir: "/data/TTS/model",
      defaultModelCacheDir: "/data/TTS/model",
    }));
    render(<LocalTtsPanel />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    fireEvent.change(screen.getByRole("textbox", { name: "模型缓存安装路径" }), {
      target: { value: "/data/custom-models" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.setTtsModelCacheDir).toHaveBeenCalledWith("/data/custom-models");
  });

  it("opens the saved model path and restores the runtime default", async () => {
    const openPath = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", { configurable: true, value: { openPath } });
    mocks.getTtsRuntimeStatus.mockResolvedValue(status({
      modelCacheDir: "/data/custom-models",
      defaultModelCacheDir: "/data/TTS/model",
    }));
    render(<LocalTtsPanel />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开" }));
      await Promise.resolve();
    });
    expect(openPath).toHaveBeenCalledWith("/data/custom-models");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.setTtsModelCacheDir).toHaveBeenCalledWith("/data/TTS/model");
  });
});
