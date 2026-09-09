// @vitest-environment jsdom
// 存储位置配置卡测试(09-09 comfyui-frontend-swap 0a):四行渲染、未装直改、
// 运行中禁改、已装走迁移 confirm+job。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";
import { ComfyEngineStoragePaths } from "./ComfyEngineStoragePaths";
import type { ComfyEngineClient, ComfyEngineStatus } from "./comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
// 项目惯例(jsdom 下 Radix 弹窗点击链不可靠):mock alert-dialog 为裸按钮
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/** 更改按钮查询(组件用 data-comfy-path-change 属性非 testid)。 */
const changeButton = () =>
  document.querySelector<HTMLButtonElement>('[data-comfy-path-change="engineDir"]');

const selectDirectory = vi.hoisted(() => vi.fn());

function installClient(client: ComfyEngineClient) {
  (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = client;
}

beforeEach(() => {
  (window as unknown as { storageManager?: unknown }).storageManager = { selectDirectory };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { openPath: vi.fn() };
});

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  delete (window as unknown as { storageManager?: unknown }).storageManager;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
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
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("引擎目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    // mock 弹窗恒渲染:等目标路径文本出现=state 已提交,再取按钮(避免点到旧闭包)
    await screen.findByText("/Volumes/BigDisk/comfyui-src");
    fireEvent.click(screen.getByRole("button", { name: "开始迁移" }));
    await waitFor(() => expect(migratePaths).toHaveBeenCalledWith({ engineDir: "/Volumes/BigDisk/comfyui-src" }), { timeout: 3000 });
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
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("引擎目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    const startBtn = await screen.findByRole("button", { name: "开始迁移" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await sleep(100);
    expect(migratePaths).not.toHaveBeenCalled();
    expect(startBtn).toBeTruthy();
  });
});
