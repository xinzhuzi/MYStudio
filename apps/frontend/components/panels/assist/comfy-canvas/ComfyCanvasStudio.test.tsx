// @vitest-environment jsdom
// ComfyUI 画布工作室 tab 测试(09-09 0b):三态渲染(未装/就绪未跑/运行中 webview)。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(document.querySelector("[data-comfy-canvas-live]")?.textContent).toContain("127.0.0.1:17001");
  });

  it("刷新按钮触发状态重探(toast 反馈)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17002,
    });
    render(<ComfyCanvasStudio />);
    const refresh = await screen.findByRole("button", { name: "刷新引擎状态" });
    fireEvent.click(refresh);
    await waitFor(() => expect(toasts.info).toHaveBeenCalled());
  });
});
