// @vitest-environment jsdom
// 空章开门(P2,livefire18 候专刀 → 1015 用户令本役解决):
// storyboards 为空的章也开门——画布照常自动打开模板工作流,不再静默 return。
// 依据:G1 切章修复后用户会落进全新空章,画布面板不应一片空白。

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyCanvasStudio } from "./ComfyCanvasStudio";
import { createMockComfyEngineClient } from "@/components/panels/settings/comfy-engine/mock-comfy-engine-client";
import { resetComfyEngineAutoStartStateForTests } from "@/components/panels/settings/comfy-engine/useComfyEngineSettings";
import type { ComfyEngineClient, ComfyEngineStatus } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const templateContentMock = vi.hoisted(() => vi.fn(async (id: string) => {
  if (String(id).includes("分镜工作流")) {
    return JSON.stringify({ last_node_id: 7, last_link_id: 6, nodes: [
      { id: 1, type: "MyStage", pos: [0, 60], properties: { "Node name for S&R": "MyStage" }, widgets_values: ["script", "剧本", "", ""], inputs: [], outputs: [{ name: "flow", type: "MY_FLOW", links: [], slot_index: 0 }] },
      { id: 2, type: "MyStage", pos: [840, 60], properties: { "Node name for S&R": "MyStage" }, widgets_values: ["scriptPlan", "导演规划", "", ""], inputs: [], outputs: [{ name: "flow", type: "MY_FLOW", links: [], slot_index: 0 }] },
    ], links: [], groups: [], config: {}, extra: {}, version: 0.4 });
  }
  throw new Error("not found");
}));
vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createHttpComfyWorkflowLibraryTransport: () => ({ content: templateContentMock }) };
});

// studio-store mock:空章(无分镜)形态——本文件专测空章开门
const storeState = vi.hoisted(() => ({
  storyboards: [] as unknown[],
  novelChapters: [] as unknown[],
  scriptPlans: [] as unknown[],
  entityExtractions: [] as unknown[],
  productionTracks: [] as unknown[],
  activeChapterId: undefined as string | undefined,
  agentWorkData: [] as unknown[],
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => storeState, subscribe: () => () => undefined },
}));
vi.mock("@/stores/project/project-store", () => ({ useProjectStore: {
  getState: () => ({ activeProjectId: "project-a" }),
  subscribe: () => () => undefined,
} }));

afterEach(() => {
  cleanup();
  resetComfyEngineAutoStartStateForTests();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  delete window.remotionQueue;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  storeState.storyboards = [];
  storeState.activeChapterId = undefined;
});

function stubClient(status: Partial<ComfyEngineStatus>): ComfyEngineClient {
  return createMockComfyEngineClient({ initialStatus: status });
}

describe("空章开门(P2,livefire18 候专刀)", () => {
  it("storyboards 为空也自动打开画布工作流(开门,不静默 return)", async () => {
    storeState.storyboards = [];
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({ installed: true, state: "ready", serviceRunning: true, port: 17006 });
    render(<ComfyCanvasStudio autoOpenOverview />);
    const webview = await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as HTMLElement & { executeJavaScript?: (code: string) => Promise<void> };
      if (!el) throw new Error("webview not mounted");
      return el;
    });
    const scripts: string[] = [];
    webview.executeJavaScript = async (code) => { scripts.push(code); };
    webview.dispatchEvent(new Event("dom-ready"));
    await waitFor(() => expect(templateContentMock).toHaveBeenCalled());
    expect(scripts.some((script) => script.includes("MyStage"))).toBe(true);
  });
});
