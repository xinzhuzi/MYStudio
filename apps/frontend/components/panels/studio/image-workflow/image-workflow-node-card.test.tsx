// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/local-image", () => ({
  LocalImage: ({ src }: { src: string }) => <img data-testid="local-image" src={src} alt="" />,
}));
vi.mock("@/components/ui/image-resolution-badge", () => ({
  ResolutionBadge: ({ src }: { src?: string }) => <span data-testid="resolution-badge" data-src={src} />,
  probeImagePixelSize: vi.fn(async () => null),
}));
vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="handle" />,
  Position: { Left: "left", Right: "right" },
}));

import { ImageWorkflowNodeCard } from "./image-workflow-node-card";
import type { ImageWorkflowNode, ImageWorkflowReferenceNode } from "@/types/studio";

afterEach(() => cleanup());

describe("ImageWorkflowNodeCard media previews", () => {
  it("renders managed reference images with a thumb while keeping the badge on the original", () => {
    const node: ImageWorkflowReferenceNode = {
      id: "reference-1",
      type: "reference",
      title: "参考图",
      imageUrl: "project-file://p/workflow-images/reference.png",
      notes: "",
      position: { x: 0, y: 0 },
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <ImageWorkflowNodeCard
        id={node.id}
        data={{
          node,
          selected: false,
          storyboards: [],
          onUpdate: vi.fn(),
          onGenerate: vi.fn(),
          onUpscale: vi.fn(),
          onApplyToStoryboard: vi.fn(),
          onDelete: vi.fn(),
        }}
        selected={false}
        type="reference"
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
    expect(screen.getByTestId("local-image").getAttribute("src")).toBe(
      "project-file://p/workflow-images/reference.png?thumb=1",
    );
    expect(screen.getByTestId("resolution-badge").getAttribute("data-src")).toBe(
      "project-file://p/workflow-images/reference.png",
    );
  });
});

describe("ImageWorkflowNodeCard 衍生过期提示(09-03-derived-expiry-chain)", () => {
  const baseNode: ImageWorkflowReferenceNode = {
    id: "reference-derived",
    type: "reference",
    title: "裁剪产物",
    imageUrl: "project-file://p/crop.png",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
  };

  function renderCard(node: ImageWorkflowReferenceNode) {
    return render(
      <ImageWorkflowNodeCard
        id={node.id}
        data={{
          node,
          selected: false,
          storyboards: [],
          onUpdate: vi.fn(),
          onGenerate: vi.fn(),
          onUpscale: vi.fn(),
          onApplyToStoryboard: vi.fn(),
          onDelete: vi.fn(),
        }}
        selected={false}
        type="reference"
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

  it("血缘带 staleSince 时呈现过期提示条", () => {
    const { container } = renderCard({
      ...baseNode,
      derivedFrom: { kind: "crop", sourceNodeId: "gen-1", createdAt: 1000, staleSince: 5000 },
    });
    const hint = container.querySelector("[data-image-workflow-derived-stale]");
    expect(hint?.textContent).toContain("父图已更新");
  });

  it("无血缘/未过期节点零提示(渲染零变化)", () => {
    const { container } = renderCard(baseNode);
    expect(container.querySelector("[data-image-workflow-derived-stale]")).toBeNull();
    const fresh = renderCard({
      ...baseNode,
      derivedFrom: { kind: "crop", sourceNodeId: "gen-1", createdAt: 1000 },
    });
    expect(fresh.container.querySelector("[data-image-workflow-derived-stale]")).toBeNull();
  });
});

describe("ImageWorkflowNodeCard 无衣物(09-04 通用化)", () => {
  function renderCard(node: ImageWorkflowNode, dataOverrides: Record<string, unknown> = {}) {
    return render(
      <ImageWorkflowNodeCard
        id={node.id}
        data={{
          node,
          selected: false,
          storyboards: [],
          onUpdate: vi.fn(),
          onGenerate: vi.fn(),
          onUpscale: vi.fn(),
          onApplyToStoryboard: vi.fn(),
          onDelete: vi.fn(),
          ...dataOverrides,
        }}
        selected={false}
        type="imageWorkflow"
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        deletable
        selectable
        draggable
        width={420}
        height={520}
      />,
    );
  }

  const unclothNode = {
    id: "unc-1",
    type: "uncloth",
    title: "无衣物",
    prompt: "重绘",
    position: { x: 80, y: 600 },
    createdAt: 1,
    updatedAt: 1,
  } as ImageWorkflowNode;

  it("uncloth 卡渲染共享参数编辑器(两遍采样组默认展开)与无衣物标识", () => {
    const { container } = renderCard(unclothNode);
    expect(container.querySelector("[data-image-workflow-node-kind]")?.getAttribute("data-image-workflow-node-kind")).toBe("uncloth");
    expect(screen.getByText("无衣物")).toBeTruthy();
    // 共享编辑器(ui/uncloth-node-editor)挂载:参数组标题可见
    expect(screen.getByText("两遍采样(常调)")).toBeTruthy();
    expect(screen.getByText("蒙版(GrowMask / 输入规模)")).toBeTruthy();
    expect(screen.getByText(/复合处理节点/)).toBeTruthy();
  });

  it("成图有 uncloth 上游:不显示兜底提示词面板,改示链路说明(用户裁定)", () => {
    const generatedNode = {
      id: "gen-1",
      type: "generated",
      title: "成图",
      status: "ready",
      resultUrl: "project-file://w/1.png",
      position: { x: 760, y: 120 },
      createdAt: 1,
      updatedAt: 1,
    } as ImageWorkflowNode;
    const { container, rerender } = renderCard(generatedNode, { hasUnclothUpstream: true });
    expect(container.querySelector("[data-toonflow-generated-prompt-panel]")).toBeNull();
    // 用户裁定(c7e6268 同款):链路说明文字也删——零文字占位
    expect(screen.queryByText(/无衣物/)).toBeNull();
    // 对照:无 uncloth 上游时兜底面板在
    rerender(
      <ImageWorkflowNodeCard
        id={generatedNode.id}
        data={{
          node: generatedNode,
          selected: false,
          storyboards: [],
          onUpdate: vi.fn(),
          onGenerate: vi.fn(),
          onUpscale: vi.fn(),
          onApplyToStoryboard: vi.fn(),
          onDelete: vi.fn(),
        }}
        selected={false}
        type="imageWorkflow"
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        deletable
        selectable
        draggable
        width={560}
        height={440}
      />,
    );
    expect(container.querySelector("[data-toonflow-generated-prompt-panel]")).toBeTruthy();
  });
});
