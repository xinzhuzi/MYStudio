// @vitest-environment jsdom
// ComfyWorkspace(09-10 全屏 ComfyUI 合一)测试:模式路由(画布/配音室)+
// 悬浮球导航区接线(本视图切换+视图跳转)。重数据面(mock 画布/TTS/就绪弧)
// 之外全部真实:freedom-store、media-panel-store、球本体与面板。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./comfy-canvas/ComfyCanvasStudio", () => ({
  ComfyCanvasStudio: () => <div data-comfy-canvas-mock>ComfyUI 画布</div>,
}));
vi.mock("./TtsStudio", () => ({
  TtsStudio: () => <div data-tts-mock>配音室</div>,
}));
vi.mock("../studio/workflow-stage/useWorkflowReadiness", () => ({
  useWorkflowReadiness: () => ({
    progress: 50,
    nextStageId: "manuals",
    nextActionLabel: "选视觉手册",
    nextAction: { kind: "open-stage", stageId: "manuals", label: "选手册", enabled: true },
    stages: [
      {
        id: "manuals",
        label: "风格与导演",
        status: "active",
        completed: [],
        missing: ["还没有选手册"],
        actionLabel: "选择视觉与导演手册",
      },
      {
        id: "script",
        label: "剧本生产阶段",
        status: "blocked",
        completed: [],
        missing: ["还没有剧本"],
        actionLabel: "生成剧本",
      },
    ],
  }),
}));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import { ComfyWorkspace } from "./ComfyWorkspace";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";

afterEach(() => {
  cleanup();
  useFreedomStore.getState().setActiveStudio("comfy");
  useMediaPanelStore.setState({ activeTab: "freedom" });
});

function openOrbPanel() {
  const orb = document.querySelector("[data-workflow-orb]") as HTMLElement | null;
  if (!orb) return false;
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 20, clientY: 20 });
  return true;
}

describe("ComfyWorkspace(全屏 ComfyUI 合一)", () => {
  it("缺省=整屏 ComfyUI 画布+悬浮球在位(沉浸视图球=导航枢纽)", async () => {
    render(<ComfyWorkspace />);
    expect(document.querySelector("[data-comfy-workspace]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-workflow-orb]")).toBeTruthy();
  });

  it("球面板导航区:本视图切换到配音室即整屏换 TTS", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    const ttsButton = await screen.findByRole("button", { name: /配音室/ });
    fireEvent.click(ttsButton);
    await waitFor(() =>
      expect(document.querySelector("[data-tts-mock]")).toBeTruthy(),
    );
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeNull();
  });

  it("球面板导航区:视图跳转落 media-panel activeTab(设置)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    const settingsButton = await screen.findByRole("button", { name: "设置" });
    fireEvent.click(settingsButton);
    expect(useMediaPanelStore.getState().activeTab).toBe("settings");
  });

  it("导航区不含分镜面板入口(唯一入口=节点图「进入」,08-23 裁定)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    await screen.findByRole("group", { name: "视图导航" });
    expect(document.body.textContent ?? "").not.toContain("分镜面板");
  });
});
