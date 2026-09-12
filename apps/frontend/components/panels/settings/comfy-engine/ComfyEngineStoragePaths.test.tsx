// @vitest-environment jsdom
// 存储位置配置卡测试(09-09 comfyui-frontend-swap 0a;09-10 卡内去嵌套盒子改平文本):
// 三行渲染(模型目录行由设置区注入,不在本组件)、未装直改、运行中禁改、已装走迁移 confirm+job。

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
  (window as unknown as { storageManager?: unknown }).storageManager = {
    selectDirectory,
    getPaths: async () => ({
      basePath: "/Users/demo/Library/Application Support/漫影工作室",
      pythonRuntimeDir: "/Users/demo/Library/Application Support/漫影工作室/python",
    }),
  };
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
  it("渲染三行目录(引擎/引擎虚拟环境/工作流)平文本无内嵌输入框", async () => {
    installClient(createMockComfyEngineClient());
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("源码目录路径").textContent).toContain("/ComfyUI"));
    expect(screen.getByLabelText("引擎虚拟环境路径").textContent).toContain("/venv");
    expect(screen.getByLabelText("工作流目录路径").textContent).toContain("/workflows");
    // 09-10 用户裁定回归锁:卡内不嵌盒子——路径是纯文本,不再是 readOnly Input
    expect(screen.getByLabelText("源码目录路径").tagName).toBe("SPAN");
  });

  it("输入/输出目录可更改(09-11):行渲染+已装确认框走 setIODirs", async () => {
    // 需求升级:从只读行 → 可编辑(manifest 键迁出源码目录,spawn 注入官方参数)
    const base = createMockComfyEngineClient({ initialStatus: readyStatus() });
    const setIODirs = vi.fn(base.setIODirs.bind(base));
    installClient({ ...base, setIODirs });
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("输入目录路径").textContent).toContain("/ComfyUI/input"));
    expect(screen.getByLabelText("输出目录路径").textContent).toContain("/ComfyUI/output");
    // 更改按钮在(运行中禁用逻辑与可改三行同款)
    expect(document.querySelector('[data-comfy-path-change="inputDir"]')).toBeTruthy();
    expect(document.querySelector('[data-comfy-path-change="outputDir"]')).toBeTruthy();
    // 已装:选目录 → 确认框 → setIODirs + 搬移说明 + 重启生效 toast
    selectDirectory.mockResolvedValue("/Volumes/Data/comfyui-input");
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-comfy-path-change="inputDir"]')!);
    await screen.findByText("/Volumes/Data/comfyui-input");
    fireEvent.click(screen.getByRole("button", { name: "确认更改" }));
    await waitFor(() => expect(setIODirs).toHaveBeenCalledWith({ inputDir: "/Volumes/Data/comfyui-input" }));
    await waitFor(() => expect(screen.getByLabelText("输入目录路径").textContent).toBe("/Volumes/Data/comfyui-input"));
    expect(toasts.success).toHaveBeenCalled();
    // 09-12 用户裁定回归锁:不标「(自定义)」(默认都是自定义)
    expect(screen.queryByText("(自定义)")).toBeNull();
  });

  it("未安装态改输入目录:直改落账不走确认框", async () => {
    const base = createMockComfyEngineClient();
    const setIODirs = vi.fn(base.setIODirs.bind(base));
    installClient({ ...base, setIODirs });
    selectDirectory.mockResolvedValue("/Volumes/Data/comfyui-input");
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("输入目录路径")).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-comfy-path-change="inputDir"]')!);
    await waitFor(() => expect(setIODirs).toHaveBeenCalledWith({ inputDir: "/Volumes/Data/comfyui-input" }));
    expect(toasts.success).toHaveBeenCalledWith("已更新(引擎尚未安装,安装后首启生效)");
  });

  it("引擎运行中:输入/输出更改按钮禁用(须先停止)", async () => {
    installClient(createMockComfyEngineClient({ initialStatus: readyStatus({ serviceRunning: true }) }));
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-comfy-path-change="inputDir"]');
      expect(btn).toBeTruthy();
      expect(btn!.disabled).toBe(true);
    });
  });

  it("探测失败(sidecar 未起)静默回落:不弹 toast,默认路径直接写上", async () => {
    // 09-09 用户裁定回归锁:探测期没必要提示——默认路径直显,等真值
    const base = createMockComfyEngineClient();
    let failFirst = true;
    installClient({
      ...base,
      getPaths: async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("本地生图服务未运行,请先在 设置→本地配置 完成「准备运行时」");
        }
        return base.getPaths();
      },
    });
    render(<ComfyEngineStoragePaths />);
    // 回落默认路径直显(09-09 裁定:家与 python 平级,<userData>/comfyui)
    await waitFor(() =>
      expect(screen.getByLabelText("源码目录路径").textContent).toContain(
        "漫影工作室/comfyui/ComfyUI",
      ),
    );
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("未安装态:选目录→校验→直改落账,界面更新", async () => {
    const base = createMockComfyEngineClient();
    const setPaths = vi.fn(base.setPaths.bind(base));
    installClient({ ...base, setPaths });
    selectDirectory.mockResolvedValue("/Volumes/Data/ComfyUI");
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("源码目录路径").textContent).toContain("/ComfyUI"));
    fireEvent.click(changeButton()!);
    await waitFor(() => expect(setPaths).toHaveBeenCalledWith({ engineDir: "/Volumes/Data/ComfyUI" }));
    await waitFor(() =>
      expect(screen.getByLabelText("源码目录路径").textContent).toBe("/Volumes/Data/ComfyUI"));
    expect(screen.queryByText("(自定义)")).toBeNull();
    expect(toasts.success).toHaveBeenCalled();
  });

  it("校验失败(空路径)不落账并 toast 错误", async () => {
    const base = createMockComfyEngineClient();
    const setPaths = vi.fn(base.setPaths.bind(base));
    installClient({ ...base, setPaths });
    selectDirectory.mockResolvedValue("   ");
    render(<ComfyEngineStoragePaths />);
    await waitFor(() => expect(screen.getByLabelText("源码目录路径")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByLabelText("源码目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    // mock 弹窗恒渲染:等目标路径文本出现=state 已提交,再取按钮(避免点到旧闭包)
    await screen.findByText("/Volumes/BigDisk/comfyui-src");
    fireEvent.click(screen.getByRole("button", { name: "开始迁移" }));
    await waitFor(() => expect(migratePaths).toHaveBeenCalledWith({ engineDir: "/Volumes/BigDisk/comfyui-src" }), { timeout: 3000 });
    // job 轮询推进(mock getJob 逐步到 succeeded)后路径更新+成功 toast
    await waitFor(
      () => expect(screen.getByLabelText("源码目录路径").textContent).toBe("/Volumes/BigDisk/comfyui-src"),
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
    await waitFor(() => expect(screen.getByLabelText("源码目录路径")).toBeTruthy());
    fireEvent.click(changeButton()!);
    const startBtn = await screen.findByRole("button", { name: "开始迁移" });
    // mock 下两弹窗恒渲染:取消钮取迁移弹窗那颗(DOM 前位;IO 弹窗取消在后)
    fireEvent.click(screen.getAllByRole("button", { name: "取消" })[0]);
    await sleep(100);
    expect(migratePaths).not.toHaveBeenCalled();
    expect(startBtn).toBeTruthy();
  });
});
