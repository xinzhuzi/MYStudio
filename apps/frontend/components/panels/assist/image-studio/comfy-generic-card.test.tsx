// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
// Radix Slider(控件区数值控件,09-09 体内直显后触达)在 jsdom 需要
// ResizeObserver(仓库惯例:各测试文件自行 stub)
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <span data-testid="handle" data-handle-id={id ?? "single"} data-handle-type={type} />
  ),
  NodeResizer: () => <span data-testid="node-resizer" />,
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
  it("动态口按 descriptor 渲染且锚进端口行(输入口 id=输入 key,输出口 id=槽位);控件体内直显(照 ComfyUI)", () => {
    renderCard(genericNode());
    const handles = screen.getAllByTestId("handle");
    const inputHandles = handles.filter((h) => h.getAttribute("data-handle-type") === "target");
    const outputHandles = handles.filter((h) => h.getAttribute("data-handle-type") === "source");
    expect(inputHandles.map((h) => h.getAttribute("data-handle-id"))).toEqual(["image", "mask"]);
    expect(outputHandles.map((h) => h.getAttribute("data-handle-id"))).toEqual(["0"]);
    // 09-09 照 ComfyUI 节点布局:控件一行一个直接在体内,不再藏「高级参数」折叠
    expect(screen.getByLabelText("模糊半径")).toBeTruthy();
    // 端口行:端口名可见
    expect(screen.getByText("图片")).toBeTruthy();
    expect(screen.getByText("蒙版")).toBeTruthy();
    expect(screen.getByText("输出")).toBeTruthy();
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
