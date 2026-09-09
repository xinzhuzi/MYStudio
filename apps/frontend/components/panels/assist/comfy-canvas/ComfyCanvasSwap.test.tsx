// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./useComfyEngineSettings", () => ({
  useComfyEngineSettings: () => ({
    hasBridge: true,
    status: { state: "running", serviceRunning: true, port: 17001 },
    activeJob: null,
    installEngine: vi.fn(),
    startService: vi.fn(),
    isStartingService: false,
    refreshStatus: vi.fn(),
  }),
}));
vi.mock("./ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: ({ embedded }: { embedded?: boolean }) => (
    <div data-comfy-studio-mock data-embedded={embedded ? "1" : "0"} />
  ),
}));

import { ComfyCanvasSwap } from "./ComfyCanvasSwap";

describe("ComfyCanvasSwap(画布换壳,阶段2 批4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("默认=ComfyUI 画布(embedded 透传);旧画布不挂载", () => {
    render(
      <ComfyCanvasSwap title="分镜画布 · ComfyUI" legacy={<div data-legacy-canvas />} onBack={() => {}} />,
    );
    expect(screen.getByText("分镜画布 · ComfyUI")).toBeTruthy();
    const studio = document.querySelector("[data-comfy-studio-mock]");
    expect(studio?.getAttribute("data-embedded")).toBe("1");
    expect(document.querySelector("[data-legacy-canvas]")).toBeNull();
    expect(document.querySelector("[data-comfy-swap]")?.getAttribute("data-comfy-swap")).toBe("comfy");
  });

  it("切到旧画布:只读封印(pointer-events-none)+banner+返回按钮", () => {
    render(
      <ComfyCanvasSwap title="图片工作室画布" legacy={<div data-legacy-canvas>旧画布内容</div>} onBack={() => {}} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /旧画布/ }));
    const legacyBox = document.querySelector("[data-comfy-swap-legacy]");
    expect(legacyBox).toBeTruthy();
    expect(legacyBox?.className).toContain("pointer-events-none");
    expect(screen.getByText(/旧画布只读存档/)).toBeTruthy();
    expect(screen.getByText("旧画布内容")).toBeTruthy();
    expect(document.querySelector("[data-comfy-studio-mock]")).toBeNull();
  });

  it("返回按钮回调;无 onBack 不渲染返回", () => {
    const onBack = vi.fn();
    const { rerender } = render(<ComfyCanvasSwap title="t" legacy={<div />} onBack={onBack} />);
    fireEvent.click(screen.getByText("返回"));
    expect(onBack).toHaveBeenCalledTimes(1);
    rerender(<ComfyCanvasSwap title="t" legacy={<div />} />);
    expect(screen.queryByText("返回")).toBeNull();
  });
});
