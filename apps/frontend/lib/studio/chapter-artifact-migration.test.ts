import { describe, expect, it } from "vitest";
import {
  collectLegacyStoryboardFlowPlans,
  rewriteChapterArtifactReferences,
} from "./chapter-artifact-migration";
import type { ImageWorkflowGraph } from "@/types/studio";

function graph(id: string, imageUrls: string[]): ImageWorkflowGraph {
  return {
    id,
    name: id,
    target: { kind: "storyboard", id: `sb-${id}` },
    nodes: imageUrls.map((imageUrl, index) => ({
      id: `node-${index}`,
      type: "generated",
      title: "n",
      prompt: "",
      model: "m",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "standard",
      status: "ready",
      position: { x: 0, y: 0 },
      createdAt: 1,
      updatedAt: 1,
      imageUrl,
    })) as ImageWorkflowGraph["nodes"],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  } as ImageWorkflowGraph;
}

describe("collectLegacyStoryboardFlowPlans", () => {
  it("collects only workflows whose image URLs still live in the flat legacy layout", () => {
    const graphs = [
      graph("storyboard-flow-chapter-001-005", [
        "project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-a.png",
        "project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-b.png",
      ]),
      // 新布局:已迁移过 → 跳过(幂等)
      graph("storyboard-flow-chapter-001-006", [
        "project-file://p1/workflow-images/chapter-001/storyboard-flow-chapter-001-006/gen-a.png",
      ]),
      // 自由工作流:ID 不匹配 → 跳过
      graph("image-flow-123", ["project-file://p1/workflow-images/image-flow-123/x.png"]),
      // storyboard 工作流但无图 → 跳过
      graph("storyboard-flow-chapter-002-001", []),
    ];
    const plans = collectLegacyStoryboardFlowPlans(graphs);
    expect(plans).toEqual([
      {
        flowDir: "workflow-images/storyboard-flow-chapter-001-005",
        chapterId: "chapter-001",
        toDir: "workflow-images/chapter-001/storyboard-flow-chapter-001-005",
        urlCount: 2,
      },
    ]);
  });

  it("merges duplicate workflow ids and keeps scan idempotent after rewrite", () => {
    const graphs = [
      graph("storyboard-flow-chapter-001-005", [
        "project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-a.png",
      ]),
      graph("storyboard-flow-chapter-001-005", [
        "project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-b.png",
      ]),
    ];
    const plans = collectLegacyStoryboardFlowPlans(graphs);
    expect(plans).toHaveLength(1);
    expect(plans[0].urlCount).toBe(2);

    const { value: rewritten } = rewriteChapterArtifactReferences({ graphs }, plans);
    expect(collectLegacyStoryboardFlowPlans((rewritten as { graphs: ImageWorkflowGraph[] }).graphs)).toHaveLength(0);
  });
});

describe("rewriteChapterArtifactReferences", () => {
  it("rewrites urls across nested structures with trailing-slash safety", () => {
    const plans = [{
      flowDir: "workflow-images/storyboard-flow-chapter-001-005",
      chapterId: "chapter-001",
      toDir: "workflow-images/chapter-001/storyboard-flow-chapter-001-005",
      urlCount: 1,
    }];
    const state = {
      storyboards: [{ manifest: ["project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-a.png"] }],
      materials: [{ localPath: "project-file://p1/workflow-images/storyboard-flow-chapter-001-005/gen-a.png" }],
      mediaTasks: [{ refs: ["workflow-images/storyboard-flow-chapter-001-005/gen-a.png", "untouched"] }],
      // 前缀碰撞保护:chapter-001-0050 不应被 005 的计划误改
      collision: "workflow-images/storyboard-flow-chapter-001-0050/gen.png",
    };
    const { value, replacedCount } = rewriteChapterArtifactReferences(state, plans);
    expect(value.storyboards[0].manifest[0]).toBe("project-file://p1/workflow-images/chapter-001/storyboard-flow-chapter-001-005/gen-a.png");
    expect(value.materials[0].localPath).toContain("workflow-images/chapter-001/");
    expect(value.mediaTasks[0].refs[0]).toBe("workflow-images/chapter-001/storyboard-flow-chapter-001-005/gen-a.png");
    expect(value.mediaTasks[0].refs[1]).toBe("untouched");
    expect(value.collision).toBe("workflow-images/storyboard-flow-chapter-001-0050/gen.png");
    expect(replacedCount).toBe(3);
  });
});
