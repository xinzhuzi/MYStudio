// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("ComfyCanvasSwap(换代终态,批6)", () => {
  afterEach(cleanup);

  it("槽位=ComfyUI 画布(embedded);退役横幅;旧画布不再挂载", () => {
    render(<ComfyCanvasSwap title="分镜画布 · ComfyUI" legacy={<div data-legacy-canvas />} onBack={() => {}} />);
    expect(screen.getByText("分镜画布 · ComfyUI")).toBeTruthy();
    expect(screen.getByText(/旧画布已退役/)).toBeTruthy();
    expect(document.querySelector("[data-comfy-studio-mock]")?.getAttribute("data-embedded")).toBe("1");
    expect(document.querySelector("[data-legacy-canvas]")).toBeNull();
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
