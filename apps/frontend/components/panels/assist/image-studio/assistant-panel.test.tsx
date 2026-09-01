// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as any).Element.prototype.scrollTo ??= () => {};

vi.mock("@/lib/ai/feature-router", () => ({
  callFeatureMultimodalAPI: vi.fn(async () => "建议把主体占比提高,配冷色调背景。"),
}));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: vi.fn(async () => ({ success: true, text: "纯文本回答", error: undefined })),
  },
}));
vi.mock("@/lib/ai/image-transfer", () => ({
  prepareReferenceImageForTransfer: vi.fn(async (source: string) => source),
}));

import { AssistantPanel } from "./assistant-panel";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import { setGeneratedImageResult } from "@/lib/studio/image-workflow/graph-build";
import { registerCanvasDispatcher } from "@/lib/studio/canvas-commands";

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
  vi.clearAllMocks();
});

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

/** 引用组装走面板真实链路:种子一个成图+上游参考 */
function seedWithSelection() {
  useImageStudioStore.getState().ensureDefaultWorkflow();
  const group = useImageStudioStore.getState().addGenerationGroup();
  useImageStudioStore.setState((state) => ({
    workflows: state.workflows.map((workflow) =>
      setGeneratedImageResult(workflow, group.generatedNodeId, {
        imageUrl: "project-file://mock/gen.png",
      }),
    ),
  }));
  return group.generatedNodeId;
}

function renderPanel(selectedNodeId: string | null) {
  // 插回测试需要执行器:手动注册 image-studio surface 的最小执行器
  // (真实挂载在 ImageStudioCanvas 的 useImageStudioCommands)
  const unregister = registerCanvasDispatcher("image-studio", (command) => {
    const store = useImageStudioStore.getState();
    if (command.kind === "add-node" && command.nodeType === "prompt") {
      const nodeId = store.addPromptNode();
      return { ok: true, detail: { nodeId } };
    }
    if (command.kind === "update-node") {
      return { ok: true };
    }
    return { ok: false, reason: "测试执行器仅支持 add/update" };
  });
  const view = render(<AssistantPanel selectedNodeId={selectedNodeId} onClose={() => {}} />);
  return { ...view, unregister };
}

describe("AssistantPanel", () => {
  it("选中成图:引用摘要含 1 张图;发送走多模态并渲染回答", async () => {
    const genId = seedWithSelection();
    renderPanel(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("问点什么…");
    fireEvent.change(input, { target: { value: "这张图哪里可以改?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/建议把主体占比提高/)).toBeTruthy();
    });
    const { callFeatureMultimodalAPI } = await import("@/lib/ai/feature-router");
    expect(vi.mocked(callFeatureMultimodalAPI)).toHaveBeenCalledTimes(1);
  });

  it("无选中:纯文本对话走 aiManager.text", async () => {
    renderPanel(null);
    await waitFor(() => {
      expect(screen.getByText(/未选中节点/)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("问点什么…");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("纯文本回答")).toBeTruthy();
    });
  });

  it("插回:回答插入为提示词节点(经 image-studio ops 执行器)", async () => {
    const genId = seedWithSelection();
    renderPanel(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText("问点什么…"), { target: { value: "给建议" } });
    fireEvent.keyDown(screen.getByPlaceholderText("问点什么…"), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /插为提示词节点/ })).toBeTruthy();
    });
    const before = activeGraph()!.nodes.length;
    fireEvent.click(screen.getByRole("button", { name: /插为提示词节点/ }));
    await waitFor(() => {
      expect(screen.getByText(/已插入为提示词节点/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(activeGraph()!.nodes.length).toBeGreaterThan(before);
    });
    const inserted = activeGraph()!.nodes.find(
      (node) => node.type === "prompt" && node.prompt.includes("建议"),
    );
    expect(inserted).toBeTruthy();
  });

  it("清空对话可用", async () => {
    const genId = seedWithSelection();
    renderPanel(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText("问点什么…"), { target: { value: "问" } });
    fireEvent.keyDown(screen.getByPlaceholderText("问点什么…"), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/清空对话/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /清空对话/ }));
    await waitFor(() => {
      expect(screen.getByText(/选中一个节点/)).toBeTruthy();
    });
  });
});
