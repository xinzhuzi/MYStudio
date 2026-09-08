// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="handle" />,
  NodeResizer: () => <span data-testid="node-resizer" />,

  Position: { Left: "left", Right: "right" },
}));
vi.mock("@/components/ui/local-image", () => ({
  LocalImage: ({ src }: { src: string }) => <img data-testid="local-image" src={src} alt="" />,
}));
vi.mock("@/lib/media/preview-src", () => ({
  toPreviewSrc: (src: string) => src,
}));
// 运行编排打桩(端到端链在 comfy-execute.test.ts 单测;此处锁卡面状态机)
const runWorkflowNodeMock = vi.fn();
vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({
  runComfyWorkflowNode: (...args: unknown[]) => runWorkflowNodeMock(...args),
}));
vi.mock("@/lib/assist/image-studio/comfy-workflow-library", () => ({
  createComfyWorkflowLibraryClient: () => ({}),
  resolveComfyWorkflowLibraryTransport: () => ({}),
}));

import { ComfyWorkflowCard } from "./comfy-workflow-card";
import {
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { ImageWorkflowComfyWorkflowNode } from "@/types/studio";

afterEach(() => {
  cleanup();
  runWorkflowNodeMock.mockReset();
});

const initialState = useImageStudioStore.getState();
beforeEach(() => {
  useImageStudioStore.setState(initialState, true);
  useImageStudioStore.getState().ensureDefaultWorkflow();
});

function comfyNode(overrides: Partial<ImageWorkflowComfyWorkflowNode> = {}): ImageWorkflowComfyWorkflowNode {
  return {
    id: "cw-1",
    type: "comfy-workflow",
    title: "K2 专业流",
    workflowId: "wf-9",
    workflowName: "K2 专业流",
    descriptor: {
      ports: [
        { id: "6.text", type: "prompt-text", label: "正向提示词", nodeId: "6", inputKey: "text", polarity: "positive" },
        { id: "10.image", type: "image", label: "参考图 1", nodeId: "10", inputKey: "image" },
      ],
      widgets: [
        { id: "12.seed", type: "INT", label: "随机种子", default: 42, nodeId: "12", inputKey: "seed" },
      ],
      classTypesUsed: [],
      nodeCount: 13,
    },
    status: "idle",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderCard(node: ImageWorkflowComfyWorkflowNode) {
  seedNode(node);
  return render(
    <ComfyWorkflowCard
      id={node.id}
      data={{ node, selected: false } as never}
      selected={false}
      type="comfyWorkflow"
      dragging={false}
      zIndex={0}
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      deletable
      selectable
      draggable
      width={420}
      height={320}
    />,
  );
}

describe("ComfyWorkflowCard(工作流节点卡,09-08 二期收官)", () => {
  it("摘要=工作流名·N节点·状态;端口明细/高级参数在卡内", () => {
    renderCard(comfyNode());
    expect(screen.getByText("K2 专业流 · 13节点 · 未运行")).toBeTruthy();
    expect(screen.getByText("正向提示词")).toBeTruthy();
    expect(screen.getByText("参考图 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /展开节点详情/ })).toBeTruthy();
  });

  it("运行按钮触发编排;结果经 store 活订阅回填出图区与张数", async () => {
    runWorkflowNodeMock.mockImplementation(async (_graph: unknown, nodeId: string) => {
      useImageStudioStore.getState().setComfyNodeResult(nodeId, {
        resultUrl: "project-file://p1/x.png",
        resultCount: 2,
      });
      return { imageUrl: "project-file://p1/x.png", imageCount: 2, persisted: true };
    });
    renderCard(comfyNode());
    fireEvent.click(screen.getByRole("button", { name: /运行/ }));
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows[0].nodes[0]).toMatchObject({
        status: "ready",
        resultUrl: "project-file://p1/x.png",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("local-image").getAttribute("src")).toBe("project-file://p1/x.png");
    });
    expect(screen.getByText("2 张输出(显示第一张)")).toBeTruthy();
  });

  it("失败态:错误消息上卡,按钮回到可重试", async () => {
    runWorkflowNodeMock.mockRejectedValue(new Error("引擎没在运行"));
    renderCard(comfyNode());
    fireEvent.click(screen.getByRole("button", { name: /运行/ }));
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows[0].nodes[0]).toMatchObject({ status: "failed" });
    });
    await waitFor(() => {
      expect(screen.getByText(/引擎没在运行/)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /运行/ })).toBeTruthy();
  });
});

/** 往活动画布种一张卡(store 活订阅的数据源) */
function seedNode(node: ImageWorkflowComfyWorkflowNode) {
  useImageStudioStore.getState().updateActiveWorkflow((graph) => ({
    ...graph,
    nodes: [...graph.nodes, node],
  }));
}
