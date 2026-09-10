// @vitest-environment jsdom
// ComfyUI 画布工作室 tab 测试(09-09 0b):三态渲染(未装/就绪未跑/运行中 webview)。

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyCanvasStudio } from "./ComfyCanvasStudio";
import { createMockComfyEngineClient } from "@/components/panels/settings/comfy-engine/mock-comfy-engine-client";
import type { ComfyEngineClient, ComfyEngineStatus } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  vi.clearAllMocks();
});

function stubClient(status: Partial<ComfyEngineStatus>): ComfyEngineClient {
  const base = createMockComfyEngineClient({ initialStatus: status });
  return base;
}

describe("ComfyCanvasStudio(辅助面板第六 tab)", () => {
  it("状态查询不到=「确认中」,绝不误报未安装/渲染安装按钮(09-10 实弹根修)", async () => {
    const client = stubClient({ installed: true, state: "ready", serviceRunning: false, port: 17001 });
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      ...client,
      getEngineStatus: vi.fn(async () => {
        throw new Error("本地生图服务未运行");
      }),
    };
    render(<ComfyCanvasStudio />);
    expect(await screen.findByText(/正在确认引擎状态/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "安装引擎" })).toBeNull();
    expect(screen.queryByText(/还没安装 ComfyUI 引擎/)).toBeNull();
  });

  it("引擎未安装:占位引导+手动安装按钮(绝不自动)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({ installed: false, state: "not-installed" });
    render(<ComfyCanvasStudio />);
    const installButton = await screen.findByRole("button", { name: "安装引擎" });
    expect(installButton).toBeTruthy();
  });

  it("引擎就绪未跑:启动按钮占位", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: false,
      port: 17123,
    });
    render(<ComfyCanvasStudio />);
    expect(await screen.findByRole("button", { name: "启动引擎" })).toBeTruthy();
  });

  it("引擎运行中:webview 指向 127.0.0.1 引擎端口", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17001,
    });
    render(<ComfyCanvasStudio />);
    await waitFor(
      () => expect(document.querySelector("[data-comfy-canvas-webview]")).toBeTruthy(),
      { timeout: 3000 },
    );
    const webview = document.querySelector("[data-comfy-canvas-webview]")!;
    expect(webview.getAttribute("src")).toBe("http://127.0.0.1:17001/");
    // 09-10 用户裁定(二轮):状态条连同按钮整块退役——live 区零按钮零文案,画布即全部
    const live = document.querySelector("[data-comfy-canvas-live]")!;
    expect(live.textContent).toBe("");
    expect(live.querySelector("button")).toBeNull();
    expect(document.querySelector("[data-comfy-canvas-overlay]")).toBeNull();
  });

  it("dom-ready 注入主题选中色(压过 xterm vendor 泄漏的默认黄;09-10 实弹)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17003,
    });
    render(<ComfyCanvasStudio />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { insertCSS?: (css: string) => Promise<string> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    const injected: string[] = [];
    webview.insertCSS = (css: string) => {
      injected.push(css);
      return Promise.resolve("id");
    };
    expect(injected).toHaveLength(0); // 无挂载即调(P1:Electron 同步 throw 白屏)
    webview.dispatchEvent(new Event("dom-ready"));
    expect(injected).toHaveLength(1); // 记录器视角:首笔来自事件
    webview.dispatchEvent(new Event("did-finish-load"));
    expect(injected).toHaveLength(2); // 双事件兜底各一发,同规则无害
    expect(injected[0]).toContain("::selection");
    expect(injected[0]).toContain("hsl(212 100% 48% / 0.28)");
    expect(injected[0]).toContain("color:inherit");
  });
});
