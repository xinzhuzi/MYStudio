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
import type { ImageWorkflowReferenceNode } from "@/types/studio";

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
