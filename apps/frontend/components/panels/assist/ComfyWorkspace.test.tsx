// @vitest-environment jsdom
// ComfyWorkspace(09-10 全屏 ComfyUI 合一)测试:模式路由(画布/配音室)+ 悬浮球在位。
// 重数据面(mock 画布/TTS/就绪弧)之外全部真实:freedom-store、media-panel-store、球本体与面板。
// 09-10 拆双球过渡态:navigation 融合通道已撤(本视图/前往导航随批次 2 归 LocalModelOrb),
// 本文件暂只覆盖路由与球在位;导航面板用例随 LocalModelOrb 测试回归。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("缺省=整屏 ComfyUI 画布+悬浮球在位", async () => {
    render(<ComfyWorkspace />);
    expect(document.querySelector("[data-comfy-workspace]")).toBeTruthy();
    expect(document.querySelector("[data-comfy-canvas-mock]")).toBeTruthy();
    expect(document.querySelector("[data-workflow-orb]")).toBeTruthy();
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

  it("面板可开(待推进可见),面板内无视图导航内容(拆双球过渡态)", async () => {
    render(<ComfyWorkspace />);
    expect(openOrbPanel()).toBe(true);
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "视图导航" })).toBeNull();
  });
});
