// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsRuntimeStatus } from "@/types/tts";

const mocks = vi.hoisted(() => ({
  getTtsRuntimeStatus: vi.fn(),
  getModelStatus: vi.fn(),
  getActiveTasks: vi.fn(),
  getModelCacheDir: vi.fn(),
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
}));

vi.mock("@/lib/tts/client", () => ({
  getTtsRuntimeStatus: mocks.getTtsRuntimeStatus,
  getModelStatus: mocks.getModelStatus,
  getActiveTasks: mocks.getActiveTasks,
  getModelCacheDir: mocks.getModelCacheDir,
  startTtsRuntime: mocks.startTtsRuntime,
  stopTtsRuntime: mocks.stopTtsRuntime,
  setTtsModelCacheDir: mocks.setTtsModelCacheDir,
  downloadModel: mocks.downloadModel,
  cancelModelDownload: mocks.cancelModelDownload,
  deleteModel: mocks.deleteModel,
  unloadModel: mocks.unloadModel,
  subscribeModelProgress: mocks.subscribeModelProgress,
}));

vi.mock("@/stores/tts-store", () => ({
  useTtsStore: (selector: (state: unknown) => unknown) => selector({
    voiceProfiles: {},
    createVoiceProfile: mocks.createVoiceProfile,
  }),
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
  mocks.getModelCacheDir.mockResolvedValue({ path: "tts-models", scan_paths: [] });
  mocks.subscribeModelProgress.mockResolvedValue(() => {});
  mocks.startTtsRuntime.mockResolvedValue({ success: true, status: status({ running: true }) });
  mocks.stopTtsRuntime.mockResolvedValue({ success: true });
  mocks.setTtsModelCacheDir.mockResolvedValue({ success: true });
  mocks.downloadModel.mockResolvedValue({ message: "started" });
  mocks.cancelModelDownload.mockResolvedValue({ message: "cancelled" });
  mocks.deleteModel.mockResolvedValue({ message: "deleted" });
  mocks.unloadModel.mockResolvedValue({ message: "unloaded" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LocalTtsPanel mounted lifecycle", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "启动" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await resolveNextStatus(status({ setupStage: "checking", setupProgress: 42 }));

    expect(screen.getByText("正在检查 Python 运行环境")).toBeTruthy();
    start.resolve({ success: false, error: "启动失败" });
  });
});
