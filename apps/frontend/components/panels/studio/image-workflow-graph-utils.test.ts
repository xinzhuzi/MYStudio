import { describe, expect, it } from "vitest";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import {
  assetWorkflowContextKey,
  findLinkedPromptNodeForGenerated,
  focusNodeIdsForGenerated,
  imageWorkflowTargetKey,
  nextNodePosition,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
} from "./image-workflow-graph-utils";

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

describe("image workflow graph utils", () => {
  it("resolves prompt and preferred generated targets without changing graph data", () => {
    const graph = createAssetImageWorkflowGraph(context, "道劫");
    const prompt = graph.nodes.find((node) => node.type === "prompt")!;
    const generated = graph.nodes.find((node) => node.type === "generated")!;

    expect(resolveGenerationTargetNodeId(graph, prompt.id)).toBe(generated.id);
    expect(resolveActionGeneratedNode(graph, prompt.id, null)?.id).toBe(generated.id);
    expect(findLinkedPromptNodeForGenerated(graph, generated.id)?.id).toBe(prompt.id);
    expect(focusNodeIdsForGenerated(graph, generated.id)).toContain(generated.id);
  });

  it("keeps target identity and placement deterministic", () => {
    const graph = createAssetImageWorkflowGraph(context, "道劫");

    expect(imageWorkflowTargetKey(context.target)).toBe(
      "asset:character:character-parent:character-derived",
    );
    expect(assetWorkflowContextKey(context)).toBe(
      "workflow-derived|asset:character:character-parent:character-derived",
    );
    expect(nextNodePosition(graph, "reference").x).toBe(80);
    expect(nextNodePosition(graph, "generated").x).toBe(620);
  });
});
