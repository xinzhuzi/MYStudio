// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-studio-mock />,
}));

import { ComfyCanvasSwap } from "./ComfyCanvasSwap";

describe("ComfyCanvasSwap(换代终态,批6)", () => {
  afterEach(cleanup);

  it("槽位=ComfyUI 画布;旧画布不再挂载;头部零冗余 chrome", () => {
    render(<ComfyCanvasSwap title="分镜画布 · ComfyUI" legacy={<div data-legacy-canvas />} onBack={() => {}} />);
    expect(screen.getByText("分镜画布 · ComfyUI")).toBeTruthy();
    expect(document.querySelector("[data-comfy-studio-mock]")).toBeTruthy();
    expect(document.querySelector("[data-legacy-canvas]")).toBeNull();
    // 09-10 用户裁定(三轮):存量迁移按钮与退役说明文案全撤
    expect(screen.queryByText(/导入存量画布/)).toBeNull();
    expect(screen.queryByText(/旧画布已退役/)).toBeNull();
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
