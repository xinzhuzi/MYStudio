// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: vi.fn(() => <div data-comfy-studio-mock />),
}));

import { ComfyCanvasStudio } from "./ComfyCanvasStudio";
import { ComfyCanvasSwap } from "./ComfyCanvasSwap";

describe("ComfyCanvasSwap(换代终态,批6)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("槽位=ComfyUI 画布;旧画布不再挂载;画布即全部", () => {
    render(<ComfyCanvasSwap />);
    expect(document.querySelector("[data-comfy-studio-mock]")).toBeTruthy();
    // 09-11 沉浸延伸裁定:状态与切换入口归悬浮球,头部标题条(含返回)整块退役
    expect(document.querySelector("[data-comfy-swap-back]")).toBeNull();
    expect(document.body.textContent || "").not.toContain("ComfyUI");
    // 09-10 用户裁定(三轮):存量迁移按钮与退役说明文案全撤
    expect(document.querySelector("[data-legacy-canvas]")).toBeNull();
  });

  it("autoOpenOverview 透传给画布工作室(分镜总览自动打开)", () => {
    render(<ComfyCanvasSwap autoOpenOverview />);
    expect(ComfyCanvasStudio).toHaveBeenCalledWith(
      { autoOpenOverview: true },
      expect.anything(),
    );
  });
});
