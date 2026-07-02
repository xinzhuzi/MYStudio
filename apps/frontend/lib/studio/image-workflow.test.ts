import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addReferenceImageNode,
  buildImageWorkflowGenerationRequest,
  buildStoryboardImageWorkflowPatch,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "./image-workflow";

describe("image workflow graph", () => {
  it("builds a Toonflow-style generation request from incoming reference edges", () => {
    let graph = createImageWorkflowGraph({
      id: "flow-1",
      name: "分镜 1 图像链",
      target: { kind: "storyboard", id: "shot-1" },
      createdAt: 1000,
    });

    graph = addReferenceImageNode(graph, {
      id: "ref-1",
      title: "角色正面",
      imageUrl: "local-image://characters/hero.png",
      position: { x: 0, y: 0 },
      source: { kind: "material", id: "material-1" },
      createdAt: 1001,
    });
    graph = addReferenceImageNode(graph, {
      id: "ref-2",
      title: "场景气氛",
      imageUrl: "https://example.test/scene.png",
      position: { x: 0, y: 260 },
      createdAt: 1002,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-1",
      title: "成图",
      prompt: "水墨风横版战斗分镜",
      model: "gemini-3-pro-image-preview",
      aspectRatio: "16:9",
      quality: "hd",
      position: { x: 420, y: 80 },
      createdAt: 1003,
    });
    graph = connectImageWorkflowNodes(graph, {
      id: "edge-1",
      source: "ref-1",
      target: "gen-1",
    });
    graph = connectImageWorkflowNodes(graph, {
      id: "edge-2",
      source: "ref-2",
      target: "gen-1",
    });
    graph = connectImageWorkflowNodes(graph, {
      id: "edge-duplicate",
      source: "ref-2",
      target: "gen-1",
    });

    expect(graph.edges).toHaveLength(2);
    expect(buildImageWorkflowGenerationRequest(graph, "gen-1")).toEqual({
      prompt: "水墨风横版战斗分镜",
      model: "gemini-3-pro-image-preview",
      aspectRatio: "16:9",
      quality: "hd",
      referenceImages: [
        "local-image://characters/hero.png",
        "https://example.test/scene.png",
      ],
    });
  });

  it("records generated result and produces a storyboard patch with flow traceability", () => {
    let graph = createImageWorkflowGraph({
      id: "flow-2",
      name: "shot result",
      target: { kind: "storyboard", id: "shot-2" },
      createdAt: 2000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-2",
      prompt: "雨夜街巷",
      position: { x: 120, y: 80 },
      createdAt: 2001,
    });
    graph = setGeneratedImageResult(graph, "gen-2", {
      imageUrl: "project-file://daojie/workflow-images/flow-2/shot-2.png",
      mediaId: "media-2",
      generatedAt: 2002,
    });

    const node = graph.nodes.find((item) => item.id === "gen-2");
    expect(node).toMatchObject({
      type: "generated",
      resultUrl: "project-file://daojie/workflow-images/flow-2/shot-2.png",
      resultMediaId: "media-2",
      status: "ready",
    });
    expect(buildStoryboardImageWorkflowPatch(graph, "gen-2")).toEqual({
      mediaRef: {
        kind: "image",
        path: "project-file://daojie/workflow-images/flow-2/shot-2.png",
        imageWorkflowId: "flow-2",
        imageWorkflowNodeId: "gen-2",
      },
      imageWorkflowId: "flow-2",
      imageWorkflowNodeId: "gen-2",
      state: "ready",
    });
  });
});
