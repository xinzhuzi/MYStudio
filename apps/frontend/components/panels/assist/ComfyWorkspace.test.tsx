// @vitest-environment jsdom
// ComfyWorkspace(09-10 终裁:球是 1 个,上提 Layout 应用层)测试:只剩模式路由。
// 球本体/面板/导航行为见 components/orbs/AppOrb.test.tsx。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./comfy-canvas/ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-canvas-mock>ComfyUI 画布</div>,
}));
vi.mock("./TtsStudio", () => ({
  TtsStudio: () => <div data-tts-mock>配音室</div>,
}));

import { ComfyWorkspace } from "./ComfyWorkspace";
import { useFreedomStore } from "@/stores/assist/freedom-store";

afterEach(() => {
  cleanup();
  useFreedomStore.getState().setActiveStudio("comfy");
});

describe("ComfyWorkspace(全屏 ComfyUI 合一)", () => {
  it("缺省=整屏 ComfyUI 画布", () => {
    render(<ComfyWorkspace />);
    expect(document.querySelector("[data-comfy-workspace]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
  });

  it("模式路由:store 切配音室即整屏换 TTS,切回即画布", async () => {
    render(<ComfyWorkspace />);
    useFreedomStore.getState().setActiveStudio("tts");
    expect(await screen.findByText("配音室")).toBeTruthy();
    expect(document.querySelector("[data-tts-mock]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeNull();
    useFreedomStore.getState().setActiveStudio("comfy");
    expect(await screen.findByText("ComfyUI 画布")).toBeTruthy();
  });
});
