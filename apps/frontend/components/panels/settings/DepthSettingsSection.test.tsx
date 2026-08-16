// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DepthRuntimeActionReplyV1,
  DepthRuntimeStatusV1,
} from "@rendering/contracts/depth-workflow";
import type { DepthDownloadProgress, DepthRuntimeStatus } from "@/types/depth";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  probe: vi.fn(),
  prepare: vi.fn(),
  rollback: vi.fn(),
  status: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/bridge/storage-manager", () => ({
  getStorageManagerBridge: () => null,
}));

import { DepthSettingsSection } from "./DepthSettingsSection";

const cacheDir = "/tmp/mystudio-depth-model";

function lifecycleStatus(state: DepthRuntimeStatusV1["state"], modelDownloaded = true): DepthRuntimeStatusV1 {
  return {
    schemaVersion: 1,
    state,
    model: "depth-anything-v2-small",
    modelCacheDir: cacheDir,
    modelDownloaded,
    message: state === "error" ? "worker probe failed" : undefined,
  };
}

function legacyStatus(state: DepthRuntimeStatus["state"], modelDownloaded = true): DepthRuntimeStatus {
  return {
    state,
    setupStage: state === "ready" ? "ready" : "idle",
    setupProgress: undefined,
    setupMessage: undefined,
    modelDownloaded,
    modelSizeMb: 96.4,
    downloadStatus: modelDownloaded ? "complete" : "idle",
    downloadProgress: modelDownloaded ? 100 : 0,
    downloadError: undefined,
    cinematicPreset: "cinematic-dolly-in",
    cinematicPresetMode: "auto",
    cinematicPresetCount: 0,
    modelCacheDir: cacheDir,
  };
}

function installBridge(initial: DepthRuntimeStatusV1["state"] = "needs-runtime") {
  let current = initial;
  mocks.probe.mockImplementation(async () => lifecycleStatus(current, current === "ready"));
  mocks.status.mockImplementation(async () => legacyStatus(current, current === "ready"));
  mocks.prepare.mockImplementation(async (): Promise<DepthRuntimeActionReplyV1> => {
    current = "ready";
    return { schemaVersion: 1, success: true, status: lifecycleStatus("ready") };
  });
  mocks.rollback.mockImplementation(async (): Promise<DepthRuntimeActionReplyV1> => {
    current = "needs-runtime";
    return { schemaVersion: 1, success: true, status: lifecycleStatus("needs-runtime", false) };
  });

  window.depthRuntime = {
    probe: mocks.probe,
    prepare: mocks.prepare,
    rollback: mocks.rollback,
    status: mocks.status,
    setup: vi.fn(),
    refresh: vi.fn(),
    scanModel: vi.fn(async () => ({ models: [] })),
    downloadModel: vi.fn(async () => ({ accepted: true, message: "accepted" })),
    downloadProgress: vi.fn(async (): Promise<DepthDownloadProgress> => ({ status: "complete", progress: 100, current: 1, total: 1 })),
    setCinematicPreset: vi.fn(async () => ({ accepted: true, message: "ok" })),
    setCinematicMode: vi.fn(async () => ({ accepted: true, message: "ok" })),
    setPresetMap: vi.fn(async () => ({ accepted: true, count: 0, message: "ok" })),
    getConfig: vi.fn(async () => ({ modelCacheDir: cacheDir })),
    setModelCacheDir: vi.fn(async () => ({ success: true })),
    deleteModel: vi.fn(async () => ({ success: true })),
  };
}

afterEach(() => {
  cleanup();
  delete window.depthRuntime;
  vi.clearAllMocks();
});

describe("DepthSettingsSection", () => {
  it("completes the typed probe, prepare, ready, and rollback loop", async () => {
    installBridge();
    render(<DepthSettingsSection embedded />);

    expect(await screen.findByText("需要准备运行时")).toBeTruthy();
    expect(screen.getByText("Depth Anything V2 Small")).toBeTruthy();
    expect(screen.getByText("Apache-2.0")).toBeTruthy();
    expect(screen.getByDisplayValue(cacheDir)).toBeTruthy();
    expect(screen.getByText("分镜选择 cinematic 预设后渲染时自动调用；CLI 用 MYSTUDIO_CINEMATIC=1 npm run video:full-pipeline")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "准备" }));
    await waitFor(() => expect(screen.getByText("已就绪")).toBeTruthy());
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.toast.success).toHaveBeenCalledWith("深度估计运行时准备完成");
    expect(screen.getByRole("button", { name: "已准备" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "回滚" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "回滚" }));
    await waitFor(() => expect(screen.getByText("需要准备运行时")).toBeTruthy());
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.toast.success).toHaveBeenCalledWith("深度估计运行时回滚完成");
  });

  it("keeps the legacy setup fallback when lifecycle methods are unavailable", async () => {
    installBridge();
    const legacyBridge = window.depthRuntime as unknown as {
      probe?: unknown;
      prepare?: unknown;
      rollback?: unknown;
      setup: () => Promise<DepthRuntimeStatus>;
    };
    delete legacyBridge.probe;
    delete legacyBridge.prepare;
    delete legacyBridge.rollback;
    const setup = vi.fn(async () => legacyStatus("ready"));
    legacyBridge.setup = setup;

    render(<DepthSettingsSection embedded />);
    expect(await screen.findByText("需要准备运行时")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "回滚" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "准备" }));
    await waitFor(() => expect(setup).toHaveBeenCalledOnce());
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("深度估计运行时配置完成");
  });

  it.each([
    ["blocked", "已阻塞"],
    ["error", "检查失败"],
  ] as const)("renders the fail-closed %s badge", async (state, label) => {
    installBridge(state);
    render(<DepthSettingsSection embedded />);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByRole("button", { name: "准备" }).hasAttribute("disabled")).toBe(false);
  });

  it("surfaces a failed typed prepare as an error toast and alert", async () => {
    installBridge();
    mocks.prepare.mockResolvedValueOnce({
      schemaVersion: 1,
      success: false,
      status: lifecycleStatus("error", false),
      code: "worker-probe-failed",
      message: "worker probe failed",
    } satisfies DepthRuntimeActionReplyV1);
    render(<DepthSettingsSection embedded />);

    fireEvent.click(await screen.findByRole("button", { name: "准备" }));
    expect((await screen.findByRole("alert")).textContent).toContain("worker probe failed");
    expect(mocks.toast.error).toHaveBeenCalledWith("worker probe failed");
  });
});
