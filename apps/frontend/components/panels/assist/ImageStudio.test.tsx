// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./comfy-canvas/ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-studio-mock />,
}));

import { ImageStudio } from "./ImageStudio";

describe("ImageStudio(画布宿主,09-09 换代终态)", () => {
  afterEach(cleanup);

  it("槽位=ComfyCanvasSwap→ComfyCanvasStudio;旧 React Flow 画布不再挂载", () => {
    render(<ImageStudio />);
    expect(screen.getByText("图片工作室画布 · ComfyUI")).toBeTruthy();
    expect(document.querySelector("[data-comfy-studio-mock]")).toBeTruthy();
    expect(screen.getByText(/旧画布已退役/)).toBeTruthy();
  });
});
