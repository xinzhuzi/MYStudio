// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <span data-testid="handle" data-handle-id={id ?? "single"} data-handle-type={type} />
  ),
  Position: { Left: "left", Right: "right" },
}));
vi.mock("@/components/ui/local-image", () => ({
  LocalImage: ({ src }: { src: string }) => <img data-testid="local-image" src={src} alt="" />,
}));
vi.mock("@/lib/media/preview-src", () => ({ toPreviewSrc: (src: string) => src }));

import { ComfyGenericCard } from "./comfy-generic-card";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import type { ImageWorkflowComfyGenericNode } from "@/types/studio";

afterEach(() => cleanup());

const initialState = useImageStudioStore.getState();

function genericNode(overrides: Partial<ImageWorkflowComfyGenericNode> = {}): ImageWorkflowComfyGenericNode {
  return {
    id: "cg-1",
    type: "comfy-generic",
    title: "模糊",
    classType: "ImageBlur",
    descriptor: {
      ports: [
        { id: "image", label: "图片", type: "IMAGE", side: "input" },
        { id: "mask", label: "蒙版", type: "MASK", side: "input" },
        { id: "0", label: "输出", type: "IMAGE", side: "output" },
      ],
      widgets: [
        { id: "blur_radius", label: "blur_radius", zhLabel: "模糊半径", type: "INT", default: 1, min: 1, max: 128 },
      ],
    },
    status: "idle",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderCard(node: ImageWorkflowComfyGenericNode) {
  useImageStudioStore.setState(initialState, true);
  useImageStudioStore.getState().ensureDefaultWorkflow();
  useImageStudioStore.getState().updateActiveWorkflow((graph) => ({
    ...graph,
    nodes: [...graph.nodes, node],
  }));
  return render(
    <ComfyGenericCard
      id={node.id}
      data={{ node, selected: false } as never}
      selected={false}
      type="comfyGeneric"
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

describe("ComfyGenericCard(效果节点卡,09-08 三期收官)", () => {
  it("动态口按 descriptor 渲染(输入口 id=输入 key,输出口 id=槽位);端口明细与高级参数在卡内", () => {
    renderCard(genericNode());
    const handles = screen.getAllByTestId("handle");
    const inputHandles = handles.filter((h) => h.getAttribute("data-handle-type") === "target");
    const outputHandles = handles.filter((h) => h.getAttribute("data-handle-type") === "source");
    expect(inputHandles.map((h) => h.getAttribute("data-handle-id"))).toEqual(["image", "mask"]);
    expect(outputHandles.map((h) => h.getAttribute("data-handle-id"))).toEqual(["0"]);
    // 通用卡主体:端口明细 + 高级参数折叠
    expect(screen.getAllByText("模糊").length).toBeGreaterThanOrEqual(1); // 壳标题+通用卡标题同现
    expect(screen.getByText(/无参数|高级参数/)).toBeTruthy();
  });

  it("摘要携带 classType/口数/状态;子图结果回显出图", () => {
    useImageStudioStore.setState(initialState, true);
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const node = genericNode({ status: "ready", resultUrl: "local-image://out.png" });
    useImageStudioStore.getState().updateActiveWorkflow((graph) => ({
      ...graph,
      nodes: [...graph.nodes, node],
    }));
    render(
      <ComfyGenericCard
        id={node.id}
        data={{ node, selected: false } as never}
        selected={false}
        type="comfyGeneric"
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
    expect(screen.getByText("ImageBlur · 3口 · 已出图")).toBeTruthy();
    expect(screen.getByTestId("local-image").getAttribute("src")).toBe("local-image://out.png");
  });
});
