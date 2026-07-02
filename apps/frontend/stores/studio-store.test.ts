// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useStudioStore } from "./studio-store";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

describe("studio workflow store", () => {
  it("keeps chapter ids when creating storyboards from imported chapters", () => {
    const store = useStudioStore.getState();

    store.replaceNovelText("第1章 断剑夜访\n独孤剑尘入镇。\n\n第2章 塾馆燃气\n晏燎掌心发热。");
    useStudioStore.getState().createStoryboardsFromChapters();

    const state = useStudioStore.getState();
    expect(state.storyboards.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
    expect(state.productionTracks.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
  });

  it("persists image workflows and applies generated node output to storyboard media", () => {
    const store = useStudioStore.getState();
    const storyboardId = store.addStoryboard({ id: "shot-1", prompt: "雨夜街巷" });
    let graph = createImageWorkflowGraph({
      id: "flow-1",
      name: "shot image flow",
      target: { kind: "storyboard", id: storyboardId },
      createdAt: 3000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-1",
      prompt: "雨夜街巷，水墨风",
      position: { x: 120, y: 80 },
      createdAt: 3001,
    });
    graph = setGeneratedImageResult(graph, "gen-1", {
      imageUrl: "project-file://daojie/workflow-images/flow-1/shot-1.png",
      mediaId: "media-1",
      generatedAt: 3002,
    });

    useStudioStore.getState().upsertImageWorkflow(graph);
    useStudioStore.getState().applyImageWorkflowResultToStoryboard(storyboardId, "flow-1", "gen-1");

    const state = useStudioStore.getState();
    expect(state.imageWorkflows).toHaveLength(1);
    expect(state.storyboards.find((item) => item.id === storyboardId)).toMatchObject({
      mediaRef: {
        kind: "image",
        path: "project-file://daojie/workflow-images/flow-1/shot-1.png",
        imageWorkflowId: "flow-1",
        imageWorkflowNodeId: "gen-1",
      },
      imageWorkflowId: "flow-1",
      imageWorkflowNodeId: "gen-1",
      state: "ready",
    });
  });
});
