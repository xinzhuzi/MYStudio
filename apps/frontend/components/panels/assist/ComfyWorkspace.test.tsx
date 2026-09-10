// @vitest-environment jsdom
// ComfyWorkspace(09-10 全屏 ComfyUI 合一 + 拆双球)测试:模式路由(画布/配音室)+
// 本地模型球在位+沉浸视图零工作流内容(AC2)。重数据面(mock 画布/TTS)之外全部
// 真实:freedom-store、media-panel-store、球本体与面板。
// 导航面板行为详见 LocalModelOrb.test.tsx(本视图/前往两折叠分区)。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./comfy-canvas/ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-canvas-mock>ComfyUI 画布</div>,
}));
vi.mock("./TtsStudio", () => ({
  TtsStudio: () => <div data-tts-mock>配音室</div>,
}));

import { ComfyWorkspace } from "./ComfyWorkspace";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useFreedomStore.getState().setActiveStudio("comfy");
  useMediaPanelStore.setState({ activeTab: "freedom" });
});

function openOrbPanel() {
  const orb = document.querySelector("[data-local-model-orb]") as HTMLElement | null;
  if (!orb) return false;
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 20, clientY: 20 });
  return true;
}

function expandSection(title: string) {
  const header = screen.getByRole("button", { name: new RegExp(`^${title}$`) });
  fireEvent.click(header);
}

describe("ComfyWorkspace(全屏 ComfyUI 合一·拆双球)", () => {
  it("缺省=整屏 ComfyUI 画布+本地模型球在位", async () => {
    render(<ComfyWorkspace />);
    expect(document.querySelector("[data-comfy-workspace]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-local-model-orb]")).toBeTruthy();
  });

  it("AC2:沉浸视图零工作流内容——无工作流球/进度弧/待推进文案", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(await screen.findByRole("button", { name: /^本视图$/ })).toBeTruthy();
    expect(document.querySelector("[data-workflow-orb]")).toBeNull();
    expect(document.querySelector("[data-orb-segment]")).toBeNull();
    expect(screen.queryByText(/待推进：/)).toBeNull();
    expect(screen.queryByText(/切换阶段/)).toBeNull();
  });

  it("球面板:展开「本视图」切配音室即整屏换 TTS,切回即画布(分区默认收起)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    // 默认收起:配音室按钮不在 DOM
    expect(screen.queryByRole("button", { name: /配音室/ })).toBeNull();
    expandSection("本视图");
    const ttsButton = await screen.findByRole("button", { name: /配音室/ });
    fireEvent.click(ttsButton);
    expect(document.querySelector("[data-tts-mock]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeNull();
    // 反向分支:切回画布
    const comfyButton = screen.getByRole("button", { name: /ComfyUI 画布/ });
    fireEvent.click(comfyButton);
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-tts-mock]")).toBeNull();
  });

  it("球面板:展开「前往」跳设置,落 media-panel activeTab", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(screen.queryByRole("button", { name: /^设置$/ })).toBeNull();
    expandSection("前往");
    const settingsButton = await screen.findByRole("button", { name: /^设置$/ });
    fireEvent.click(settingsButton);
    expect(useMediaPanelStore.getState().activeTab).toBe("settings");
  });

  it("面板不含分镜面板入口(唯一入口=节点图「进入」,08-23 裁定)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expandSection("本视图");
    expandSection("前往");
    await screen.findByRole("group", { name: "前往" });
    expect(document.body.textContent ?? "").not.toContain("分镜面板");
  });
});
