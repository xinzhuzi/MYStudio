// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImageWorkflowGraph } from "@/lib/studio/image-workflow";
import { useProjectStore } from "@/stores/project-store";
import { useImageWorkflowActions } from "./use-image-workflow-actions";

const initialProjectState = useProjectStore.getState();

function createOptions() {
  const uploadInput = document.createElement("input");
  uploadInput.value = "selected.png";
  return {
    activeGraph: createImageWorkflowGraph({ id: "flow-1", name: "测试工作流" }),
    projectName: "道劫",
    imageWorkflowCount: 2,
    storyboards: [],
    targetStoryboardId: "",
    selectedNodeId: null,
    preferredGeneratedNodeId: null,
    selectedEdgeId: null,
    uploadInputRef: { current: uploadInput },
    saveGraph: vi.fn(),
    addMaterial: vi.fn(() => "material-1"),
    createImageWorkflow: vi.fn(() => "flow-3"),
    updateImageWorkflow: vi.fn(),
    applyImageWorkflowResultToAsset: vi.fn(),
    applyImageWorkflowResultToStoryboard: vi.fn(),
    setActiveWorkflowId: vi.fn(),
    setSelectedNodeId: vi.fn(),
    setPreferredGeneratedNodeId: vi.fn(),
    setSelectedEdgeId: vi.fn(),
  };
}

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: "dao-project" });
});

afterEach(() => {
  useProjectStore.setState(initialProjectState, true);
  delete window.projectFiles;
  vi.restoreAllMocks();
});

describe("useImageWorkflowActions", () => {
  it("creates a free workflow and resets node selection", () => {
    const options = createOptions();
    const { result } = renderHook(() => useImageWorkflowActions(options));

    act(() => result.current.createNewFlow());

    expect(options.createImageWorkflow).toHaveBeenCalledWith({
      name: "道劫 图像工作流 3",
      target: { kind: "free" },
    });
    expect(options.setActiveWorkflowId).toHaveBeenCalledWith("flow-3");
    expect(options.setSelectedNodeId).toHaveBeenCalledWith(null);
    expect(options.setPreferredGeneratedNodeId).toHaveBeenCalledWith(null);
  });

  it("adds a generated node with its prompt node and connection", () => {
    const options = createOptions();
    const { result } = renderHook(() => useImageWorkflowActions(options));

    act(() => result.current.addGeneratedNode());

    const savedGraph = options.saveGraph.mock.calls[0]?.[0];
    expect(savedGraph.nodes.map((node) => node.type)).toEqual(["generated", "prompt"]);
    expect(savedGraph.edges).toHaveLength(1);
    expect(options.setSelectedNodeId).toHaveBeenCalledWith(savedGraph.nodes[1].id);
    expect(options.setPreferredGeneratedNodeId).toHaveBeenCalledWith(savedGraph.nodes[0].id);
  });

  it("persists an uploaded reference before adding its material and node", async () => {
    const options = createOptions();
    const writeBinary = vi.fn().mockResolvedValue({
      success: true,
      url: "project-file://dao-project/studio/image-workflows/flow-1/ref.png",
      size: 4,
    });
    window.projectFiles = { writeBinary } as unknown as typeof window.projectFiles;
    const file = new File(["test"], "ref.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    });
    const { result } = renderHook(() => useImageWorkflowActions(options));

    await act(async () => result.current.handleUploadReference(file));

    expect(writeBinary).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "dao-project",
      bytes: expect.any(ArrayBuffer),
    }));
    expect(options.addMaterial).toHaveBeenCalledWith(expect.objectContaining({
      name: "ref.png",
      localPath: "project-file://dao-project/studio/image-workflows/flow-1/ref.png",
    }));
    expect(options.saveGraph.mock.calls[0]?.[0].nodes[0]).toMatchObject({
      type: "reference",
      imageUrl: "project-file://dao-project/studio/image-workflows/flow-1/ref.png",
      source: { kind: "material", id: "material-1" },
    });
    expect(options.uploadInputRef.current.value).toBe("");
  });
});
