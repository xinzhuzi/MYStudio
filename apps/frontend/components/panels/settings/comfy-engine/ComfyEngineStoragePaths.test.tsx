// @vitest-environment jsdom
// 存储位置配置卡测试(09-09 comfyui-frontend-swap 0a):四行渲染、未装直改、
// 运行中禁改、已装走迁移 confirm+job。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";
import { ComfyEngineStoragePaths } from "./ComfyEngineStoragePaths";
import type { ComfyEngineClient, ComfyEngineStatus } from "./comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

/** 更改按钮查询(组件用 data-comfy-path-change 属性非 testid)。 */
const changeButton = () =>
  document.querySelector<HTMLButtonElement>('[data-comfy-path-change="engineDir"]');

const selectDirectory = vi.hoisted(() => vi.fn());
const confirmSpy = vi.hoisted(() => vi.fn());

function installClient(client: ComfyEngineClient) {
  (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = client;
}

beforeEach(() => {
  (window as unknown as { storageManager?: unknown }).storageManager = { selectDirectory };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { openPath: vi.fn() };
  vi.stubGlobal("confirm", confirmSpy);
});

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  delete (window as unknown as { storageManager?: unknown }).storageManager;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function readyStatus(overrides: Partial<ComfyEngineStatus> = {}): Partial<ComfyEngineStatus> {
  return {
    installed: true,
    state: "ready",
    serviceRunning: false,
    version: "v0.34.6",
    modelsDir: null,
    ...overrides,
  } as Partial<ComfyEngineStatus>;
}

describe("ComfyEngineStoragePaths(存储位置配置卡)", () => {
  it("渲染四行目录(引擎/Python运行时/模型/工作流)与默认路径", async () => {
    installClient(createMockComfyEngineClient());
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect((screen.getByLabelText("引擎目录路径") as HTMLInputElement).value).toContain("/ComfyUI"));
    expect((screen.getByLabelText("Python 运行时路径") as HTMLInputElement).value).toContain("/venv");
    expect((screen.getByLabelText("工作流目录路径") as HTMLInputElement).value).toContain("/workflows");
    expect((screen.getByLabelText("模型目录路径") as HTMLInputElement).value).toContain("/models");
  });

  it("未安装态:选目录→校验→直改落账,界面更新并标「自定义」", async () => {
    const base = createMockComfyEngineClient();
    const setPaths = vi.fn(base.setPaths.bind(base));
    installClient({ ...base, setPaths });
    selectDirectory.mockResolvedValue("/Volumes/Data/ComfyUI");
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect((screen.getByLabelText("引擎目录路径") as HTMLInputElement).value).toContain("/ComfyUI"));
    fireEvent.click(changeButton()!);
    await waitFor(() => expect(setPaths).toHaveBeenCalledWith({ engineDir: "/Volumes/Data/ComfyUI" }));
    await waitFor(() =>
      expect((screen.getByLabelText("引擎目录路径") as HTMLInputElement).value).toBe("/Volumes/Data/ComfyUI"));
    expect(screen.getByText("(自定义)")).toBeTruthy();
    expect(toasts.success).toHaveBeenCalled();
  });

  it("校验失败(空路径)不落账并 toast 错误", async () => {
    const base = createMockComfyEngineClient();
    const setPaths = vi.fn(base.setPaths.bind(base));
    installClient({ ...base, setPaths });
    selectDirectory.mockResolvedValue("   ");
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("引擎目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(setPaths).not.toHaveBeenCalled();
  });

  it("引擎运行中:更改按钮禁用(title 指路先停止)", async () => {
    installClient(createMockComfyEngineClient({ initialStatus: readyStatus({ serviceRunning: true }) }));
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => {
      expect(changeButton()).toBeTruthy();
      expect(changeButton()!.disabled).toBe(true);
    });
  });

  it("已安装未跑:confirm 确认后走迁移 job,完成刷新", async () => {
    const base = createMockComfyEngineClient({ initialStatus: readyStatus() });
    const migratePaths = vi.fn(base.migratePaths.bind(base));
    installClient({ ...base, migratePaths });
    selectDirectory.mockResolvedValue("/Volumes/BigDisk/comfyui-src");
    confirmSpy.mockReturnValue(true);
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("引擎目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    await waitFor(() => expect(migratePaths).toHaveBeenCalledWith({ engineDir: "/Volumes/BigDisk/comfyui-src" }));
    // job 轮询推进(mock getJob 逐步到 succeeded)后路径更新+成功 toast
    await waitFor(
      () => expect((screen.getByLabelText("引擎目录路径") as HTMLInputElement).value).toBe("/Volumes/BigDisk/comfyui-src"),
      { timeout: 4000 },
    );
    expect(toasts.success).toHaveBeenCalled();
  });

  it("已安装未跑:confirm 取消不迁移", async () => {
    const base = createMockComfyEngineClient({ initialStatus: readyStatus() });
    const migratePaths = vi.fn(base.migratePaths.bind(base));
    installClient({ ...base, migratePaths });
    selectDirectory.mockResolvedValue("/Volumes/BigDisk/comfyui-src");
    confirmSpy.mockReturnValue(false);
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("引擎目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(migratePaths).not.toHaveBeenCalled();
  });
});
