// @vitest-environment jsdom
// ComfyWorkspace(09-10 全屏 ComfyUI 合一 + 两球功能一致终裁)测试:
// 模式路由(画布/配音室)+本地模型球在位+「切换阶段」直达跳转。
// 重数据面(mock 画布/TTS)之外全部真实:freedom-store、studio-store、
// media-panel-store、球本体与面板。导航分区行为详见 LocalModelOrb.test.tsx。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./comfy-canvas/ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-canvas-mock>ComfyUI 画布</div>,
}));
vi.mock("./TtsStudio", () => ({
  TtsStudio: () => <div data-tts-mock>配音室</div>,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { ComfyWorkspace } from "./ComfyWorkspace";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useStudioStore } from "@/stores/studio/studio-store";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useFreedomStore.getState().setActiveStudio("comfy");
  useMediaPanelStore.setState({ activeTab: "freedom" });
  useStudioStore.setState({ workflowConfig: { ...useStudioStore.getState().workflowConfig, workflowStage: "manuals" } });
});

function openOrbPanel() {
  const orb = document.querySelector("[data-local-model-orb]") as HTMLElement | null;
  if (!orb) return false;
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 20, clientY: 20 });
  return true;
}

function expandSection(title: string) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${title}$`) }),
  );
}

describe("ComfyWorkspace(全屏 ComfyUI 合一·两球功能一致)", () => {
  it("缺省=整屏 ComfyUI 画布+本地模型球在位", async () => {
    render(<ComfyWorkspace />);
    expect(document.querySelector("[data-comfy-workspace]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-local-model-orb]")).toBeTruthy();
  });

  it("面板分区全面:本视图+切换阶段+前往都在(默认收起);无工作流球/待推进头", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(await screen.findByRole("button", { name: /^本视图$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^切换阶段$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^前往$/ })).toBeTruthy();
    // 沉浸视图没有工作流球本体(进度弧/待推进头=工作流视图专属)
    expect(document.querySelector("[data-workflow-orb]")).toBeNull();
    expect(document.querySelector("[data-orb-segment]")).toBeNull();
    expect(screen.queryByText(/待推进：/)).toBeNull();
  });

  it("球面板:展开「本视图」切配音室即整屏换 TTS,切回即画布", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(screen.queryByRole("button", { name: /配音室/ })).toBeNull();
    expandSection("本视图");
    const ttsButton = await screen.findByRole("button", { name: /配音室/ });
    fireEvent.click(ttsButton);
    expect(document.querySelector("[data-tts-mock]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeNull();
    const comfyButton = screen.getByRole("button", { name: /ComfyUI 画布/ });
    fireEvent.click(comfyButton);
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-tts-mock]")).toBeNull();
  });

  it("直达恢复(终裁):展开「切换阶段」点手册阶段→跳工作流视图并落档", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expandSection("切换阶段");
    const item = await screen.findByRole("button", { name: /风格与导演/ });
    fireEvent.click(item);
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
    expect(useStudioStore.getState().workflowConfig.workflowStage).toBe("manuals");
  });

  it("手册门禁照旧:未选手册点后续阶段被阻(toast),不跳转", async () => {
    const { toast } = await import("sonner");
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expandSection("切换阶段");
    const item = await screen.findByRole("button", { name: /剧本生产阶段/ });
    fireEvent.click(item);
    expect(toast.error).toHaveBeenCalled();
    expect(useMediaPanelStore.getState().activeTab).toBe("freedom");
  });

  it("球面板:展开「前往」跳设置,落 media-panel activeTab", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(screen.queryByRole("button", { name: /^设置$/ })).toBeNull();
    expandSection("前往");
    fireEvent.click(await screen.findByRole("button", { name: /^设置$/ }));
    expect(useMediaPanelStore.getState().activeTab).toBe("settings");
  });

  it("「前往」分区不含分镜面板入口(唯一入口=节点图「进入」,08-23 裁定)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expandSection("前往");
    await screen.findByRole("group", { name: "前往" });
    const entries = document.querySelectorAll("[data-orb-nav-view]");
    expect(entries.length).toBe(9);
    const gotoText = Array.from(entries)
      .map((node) => node.textContent ?? "")
      .join(" ");
    expect(gotoText).not.toContain("分镜面板");
  });
});
