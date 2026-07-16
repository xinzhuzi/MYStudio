import { describe, expect, it, vi } from "vitest";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import { createImageWorkflowReactNodes } from "./image-workflow-react-nodes";

const context = {
  target: {
    kind: "asset" as const,
    assetType: "character" as const,
    parentId: "character-parent",
    id: "character-derived",
  },
  title: "灰衫入镇态",
  prompt: "水墨国风角色设定",
  sourceImagePath: "project-file://demo/source.png",
  resultImagePath: "project-file://demo/result.png",
  imageWorkflowId: "workflow-derived",
};

describe("image workflow ReactFlow node projection", () => {
  it("returns no ReactFlow nodes when no graph is active", () => {
    expect(createImageWorkflowReactNodes({
      graph: undefined,
      selectedNodeId: null,
      storyboards: [],
      onUpdate: vi.fn(),
      onGenerate: vi.fn(),
      onApplyToStoryboard: vi.fn(),
      onDelete: vi.fn(),
    })).toEqual([]);
  });

  it("keeps node data, selection, prompt linkage, and action forwarding intact", () => {
    const graph = createAssetImageWorkflowGraph(context, "道劫");
    const prompt = graph.nodes.find((node) => node.type === "prompt")!;
    const generated = graph.nodes.find((node) => node.type === "generated")!;
    const storyboards = [{
      id: "storyboard-1",
      episodeId: "episode-1",
      index: 1,
      trackKey: "track-1",
      trackId: "track-1",
      duration: 5,
      prompt: "雨夜街口",
      videoDesc: "雨夜街口镜头",
      assetIds: [],
      state: "ready" as const,
    }];
    const onUpdate = vi.fn();
    const onGenerate = vi.fn(async () => undefined);
    const onApplyToStoryboard = vi.fn();
    const onDelete = vi.fn();

    const nodes = createImageWorkflowReactNodes({
      graph,
      selectedNodeId: generated.id,
      storyboards,
      onUpdate,
      onGenerate,
      onApplyToStoryboard,
      onDelete,
    });

    const projectedGenerated = nodes.find((node) => node.id === generated.id)!;

    expect(projectedGenerated).toMatchObject({
      id: generated.id,
      type: "imageWorkflow",
      position: generated.position,
    });
    expect(projectedGenerated.data.node).toBe(generated);
    expect(projectedGenerated.data.promptNode).toBe(prompt);
    expect(projectedGenerated.data.selected).toBe(true);
    expect(projectedGenerated.data.storyboards).toBe(storyboards);

    projectedGenerated.data.onUpdate(generated.id, { title: "新标题" });
    projectedGenerated.data.onGenerate(generated.id);
    projectedGenerated.data.onApplyToStoryboard(generated.id);
    projectedGenerated.data.onDelete(generated.id);

    expect(onUpdate).toHaveBeenCalledWith(generated.id, { title: "新标题" });
    expect(onGenerate).toHaveBeenCalledWith(generated.id);
    expect(onApplyToStoryboard).toHaveBeenCalledWith(generated.id);
    expect(onDelete).toHaveBeenCalledWith(generated.id);
  });
});
