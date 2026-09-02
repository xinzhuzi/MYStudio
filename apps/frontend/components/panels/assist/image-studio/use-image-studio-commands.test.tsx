// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCanvasCommandBusForTests,
  dispatchCanvasCommand,
} from "@/lib/studio/canvas-commands";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import { useImageStudioCommands } from "./use-image-studio-commands";

/**
 * 09-03-canvas-assistant-phase2 R2:执行器扩容实证——
 * add-node 建组回执带 promptNodeId + connectFrom 按契约接边、
 * update-node prompt 透传、trigger-node-action "generate" 路由注入编排。
 */

const initialImageStudioState = useImageStudioStore.getState();

afterEach(() => {
  cleanup();
  __resetCanvasCommandBusForTests();
  useImageStudioStore.setState(initialImageStudioState, true);
  vi.clearAllMocks();
});

function seedGroup() {
  useImageStudioStore.getState().ensureDefaultWorkflow();
  return useImageStudioStore.getState().addGenerationGroup();
}

function mountExecutor(generateNode?: (nodeId: string) => void | Promise<void>) {
  const workflow = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
  return renderHook(() => useImageStudioCommands({ workflow, generateNode }));
}

function dispatch(command: Parameters<typeof dispatchCanvasCommand>[1]) {
  let result!: ReturnType<typeof dispatchCanvasCommand>;
  act(() => {
    result = dispatchCanvasCommand("image-studio", command);
  });
  return result;
}

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

describe("image-studio 指令执行器(二期扩容)", () => {
  it("add-node connectFrom:建组回执带 promptNodeId,源→成图按契约接边", () => {
    const group = seedGroup();
    mountExecutor();

    const before = activeGraph()!.nodes.length;
    const result = dispatch({
      kind: "add-node",
      surface: "image-studio",
      nodeType: "generated",
      connectFrom: { nodeId: group.promptNodeId, handleType: "target" },
    });

    expect(result.ok).toBe(true);
    const detail = (result as { detail?: { nodeId?: string; promptNodeId?: string } }).detail;
    expect(detail?.nodeId).toBeTruthy();
    expect(detail?.promptNodeId).toBeTruthy();
    const graph = activeGraph()!;
    expect(graph.nodes.length).toBe(before + 2);
    // 09-03 一个成图只吃一根提示词:新组自带提示词(promptNodeId),旧提示词的
    // 额外连线被单源拒绝——不再出现第二根提示词边
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === group.promptNodeId && edge.target === detail?.nodeId,
      ),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === detail?.promptNodeId && edge.target === detail?.nodeId,
      ),
    ).toBe(true);
  });

  it("update-node:patch.prompt 透传落节点(面板直写归零的执行器侧支撑)", () => {
    const group = seedGroup();
    mountExecutor();

    const result = dispatch({
      kind: "update-node",
      surface: "image-studio",
      nodeId: group.promptNodeId,
      patch: { prompt: "助手写的提示词" },
    });

    expect(result.ok).toBe(true);
    // ImageWorkflowNode 是联合类型,reference 节点无 prompt 字段,断言前收窄
    const updated = activeGraph()!.nodes.find(
      (node) => node.id === group.promptNodeId,
    ) as { prompt?: string } | undefined;
    expect(updated?.prompt).toBe("助手写的提示词");
  });

  it("trigger-node-action generate:路由到注入编排;未注入/未知动作可操作失败", () => {
    const group = seedGroup();
    const generateNode = vi.fn();
    mountExecutor(generateNode);

    const result = dispatch({
      kind: "trigger-node-action",
      surface: "image-studio",
      nodeId: group.generatedNodeId,
      action: "generate",
    });
    expect(result.ok).toBe(true);
    expect(generateNode).toHaveBeenCalledTimes(1);
    expect(generateNode).toHaveBeenCalledWith(group.generatedNodeId);

    const unknown = dispatch({
      kind: "trigger-node-action",
      surface: "image-studio",
      nodeId: group.generatedNodeId,
      action: "explode",
    });
    expect(unknown.ok).toBe(false);

    cleanup();
    __resetCanvasCommandBusForTests();
    mountExecutor();
    const missing = dispatch({
      kind: "trigger-node-action",
      surface: "image-studio",
      nodeId: group.generatedNodeId,
      action: "generate",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain("生成编排未就绪");
  });

  it("restore-generation:新建「复原·」画布整组复原,旧画布零污染", () => {
    seedGroup();
    mountExecutor();
    const store = useImageStudioStore.getState();
    const workflowCountBefore = store.workflows.length;
    const oldCanvasId = store.activeWorkflowId;
    const oldCanvasNodesBefore = activeGraph()!.nodes.length;

    const result = dispatch({
      kind: "restore-generation",
      surface: "image-studio",
      prompt: "黄昏暖色",
      negativePrompt: "模糊",
      model: "krea2-turbo",
      aspectRatio: "16:9",
      references: ["project-file://p/media/ai-image/2026-09/ref.png"],
      result: { imageUrl: "project-file://p/media/ai-image/2026-09/out.png", mediaId: "m9" },
      batchImageUrls: [
        "project-file://p/media/ai-image/2026-09/out.png",
        "project-file://p/media/ai-image/2026-09/b.png",
      ],
      generatedAt: 12345,
    });
    expect(result.ok).toBe(true);
    const detail = (result as { detail?: { nodeId?: string; promptNodeId?: string; workflowId?: string; workflowName?: string } }).detail;
    expect(detail?.workflowId).toBeTruthy();
    expect(detail?.workflowName).toMatch(/^复原·/);

    // 新画布已建并切激活;复原组落在新画布
    const state = useImageStudioStore.getState();
    expect(state.workflows.length).toBe(workflowCountBefore + 1);
    expect(state.activeWorkflowId).toBe(detail?.workflowId);
    const newCanvas = state.workflows.find((workflow) => workflow.id === detail?.workflowId)!;
    expect(newCanvas.name).toMatch(/^复原·/);
    // 旧画布一个节点都没动(复原不污染现场)
    const oldCanvas = state.workflows.find((workflow) => workflow.id === oldCanvasId)!;
    expect(oldCanvas.nodes.length).toBe(oldCanvasNodesBefore);

    const graph = newCanvas;
    const generated = graph.nodes.find((node) => node.id === detail?.nodeId) as
      | { status?: string; resultUrl?: string; aspectRatio?: string; imageBatch?: { images: string[] } }
      | undefined;
    expect(generated?.status).toBe("ready");
    expect(generated?.resultUrl).toBe("project-file://p/media/ai-image/2026-09/out.png");
    expect(generated?.aspectRatio).toBe("16:9");
    expect(generated?.imageBatch?.images).toHaveLength(2);
    // 参考边+提示词边都指向成图
    const edgesToGenerated = graph.edges.filter((edge) => edge.target === detail?.nodeId);
    expect(edgesToGenerated).toHaveLength(2);
    const promptNode = graph.nodes.find((node) => node.id === detail?.promptNodeId) as
      | { prompt?: string; negativePrompt?: string }
      | undefined;
    expect(promptNode?.prompt).toBe("黄昏暖色");
    expect(promptNode?.negativePrompt).toBe("模糊");
  });
});
