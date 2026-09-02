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

import { CanvasAssistantDialog } from "./canvas-assistant-dialog";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import { setGeneratedImageResult } from "@/lib/studio/image-workflow/graph-build";
import { registerCanvasDispatcher } from "@/lib/studio/canvas-commands";
import type { CanvasCommand } from "@/lib/studio/canvas-commands";

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
  vi.clearAllMocks();
});

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

/** 引用组装走真实链路:种子一个成图+上游参考 */
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

function renderDialog(selectedNodeId: string | null) {
  // 插回测试需要执行器:手动注册 image-studio surface 的最小执行器
  // (真实挂载在 ImageStudioCanvas 的 useImageStudioCommands);
  // update-node 如实回放 patch(prompt 二期透传后,插回正文走这条指令)
  const unregister = registerCanvasDispatcher("image-studio", (command) => {
    const store = useImageStudioStore.getState();
    if (command.kind === "add-node" && command.nodeType === "prompt") {
      const nodeId = store.addPromptNode();
      return { ok: true, detail: { nodeId } };
    }
    if (command.kind === "update-node") {
      store.updateNode(command.nodeId, {
        ...(command.patch.title !== undefined ? { title: command.patch.title } : {}),
        ...(command.patch.prompt !== undefined ? { prompt: command.patch.prompt } : {}),
      });
      return { ok: true };
    }
    return { ok: false, reason: "测试执行器仅支持 add/update" };
  });
  const onOpenChange = vi.fn();
  const view = render(
    <CanvasAssistantDialog open onOpenChange={onOpenChange} selectedNodeId={selectedNodeId} />,
  );
  return { ...view, unregister, onOpenChange };
}

describe("CanvasAssistantDialog 画布助手弹窗", () => {
  it("选中成图:引用摘要含 1 张图;发送走多模态并渲染回答", async () => {
    const genId = seedWithSelection();
    renderDialog(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: "这张图哪里可以改?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/建议把主体占比提高/)).toBeTruthy();
    });
    const { callFeatureMultimodalAPI } = await import("@/lib/ai/feature-router");
    expect(vi.mocked(callFeatureMultimodalAPI)).toHaveBeenCalledTimes(1);
  });

  it("无选中:纯文本对话走 aiManager.text", async () => {
    renderDialog(null);
    await waitFor(() => {
      expect(screen.getByText(/未选中节点/)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(/问点什么/);
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("纯文本回答")).toBeTruthy();
    });
  });

  it("快捷问法:点击即发,不经输入框", async () => {
    renderDialog(null);
    await waitFor(() => {
      expect(screen.getByText(/不用选中节点也能问/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "推荐一个赛博朋克城市夜景的提示词" }));
    await waitFor(() => {
      expect(screen.getByText("纯文本回答")).toBeTruthy();
    });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const sent = vi.mocked(aiManager.text).mock.calls[0][0];
    expect(sent.messages.at(-1)).toMatchObject({ role: "user", content: "推荐一个赛博朋克城市夜景的提示词" });
  });

  it("插回:回答插入为提示词节点(经 image-studio ops 执行器)", async () => {
    const genId = seedWithSelection();
    renderDialog(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText(/问点什么/), { target: { value: "给建议" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/问点什么/), { key: "Enter" });
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

  it("按此生图:建组→写提示词→触发生成 三连 ops,零 store 直写", async () => {
    const genId = seedWithSelection();
    const dispatched: CanvasCommand[] = [];
    // 记录型执行器:只回执不动 store——若视图绕过 ops 直写,画布图会原样不动
    // 而断言的指令序列也不会出现
    const unregister = registerCanvasDispatcher("image-studio", (command) => {
      dispatched.push(command);
      if (command.kind === "add-node") {
        return { ok: true, detail: { nodeId: "gen-x", promptNodeId: "prompt-x" } };
      }
      return { ok: true };
    });
    const view = render(<CanvasAssistantDialog open onOpenChange={vi.fn()} selectedNodeId={genId} />);
    try {
      await waitFor(() => {
        expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
      });
      fireEvent.change(screen.getByPlaceholderText(/问点什么/), { target: { value: "给建议" } });
      fireEvent.keyDown(screen.getByPlaceholderText(/问点什么/), { key: "Enter" });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /按此生图/ })).toBeTruthy();
      });
      const nodeCountBefore = activeGraph()!.nodes.length;
      fireEvent.click(screen.getByRole("button", { name: /按此生图/ }));
      await waitFor(() => {
        expect(screen.getByText(/已开始生成/)).toBeTruthy();
      });
      expect(dispatched.map((command) => command.kind)).toEqual([
        "add-node",
        "update-node",
        "trigger-node-action",
      ]);
      const addCommand = dispatched[0] as Extract<CanvasCommand, { kind: "add-node" }>;
      expect(addCommand.connectFrom?.nodeId).toBe(genId);
      const updateCommand = dispatched[1] as Extract<CanvasCommand, { kind: "update-node" }>;
      expect(updateCommand.nodeId).toBe("prompt-x");
      expect(updateCommand.patch.prompt).toContain("建议");
      const triggerCommand = dispatched[2] as Extract<
        CanvasCommand,
        { kind: "trigger-node-action" }
      >;
      expect(triggerCommand.nodeId).toBe("gen-x");
      expect(triggerCommand.action).toBe("generate");
      expect(activeGraph()!.nodes.length).toBe(nodeCountBefore);
    } finally {
      unregister();
      view.unmount();
    }
  });

  it("清空对话回到空态(快捷问法可见)", async () => {
    const genId = seedWithSelection();
    renderDialog(genId);
    await waitFor(() => {
      expect(screen.getByText(/引用:1 张图/)).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText(/问点什么/), { target: { value: "问" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/问点什么/), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/清空对话/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /清空对话/ }));
    await waitFor(() => {
      expect(screen.getByText(/问问选中的节点怎么改/)).toBeTruthy();
    });
  });

  it("Esc 触发 onOpenChange(false);X 按钮同效(显性关闭)", async () => {
    const genId = seedWithSelection();
    const { onOpenChange } = renderDialog(genId);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭助手" }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
