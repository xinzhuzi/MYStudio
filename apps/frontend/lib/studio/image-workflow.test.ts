import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addReferenceImageNode,
  buildAssetImageWorkflowPatch,
  buildImageWorkflowGenerationRequest,
  buildStoryboardImageWorkflowPatch,
  connectImageWorkflowNodes,
  createAssetImageWorkflowGraph,
  createImageWorkflowGraph,
  createStoryboardImageWorkflowGraph,
  ensureAssetImageWorkflowGraph,
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

  it("creates a storyboard-targeted image workflow with a generated result node", () => {
    const graph = createStoryboardImageWorkflowGraph({
      storyboard: {
        id: "shot-3",
        index: 3,
        prompt: "道口镇雨夜低机位推进",
      },
      prompt: "水墨国风，道口镇雨夜低机位推进",
      resultImagePath: "project-file://daojie/workflow-images/storyboards/shot-3.png",
      projectName: "道劫",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      referenceImages: [
        {
          assetId: "char-1",
          assetType: "character",
          title: "角色参考：独孤剑尘",
          imageUrl: "project-file://dao/assets/char.png",
        },
        {
          assetId: "scene-1",
          assetType: "scene",
          title: "场景参考：道口镇",
          imageUrl: "project-file://dao/assets/scene.png",
        },
      ],
    });
    const generated = graph.nodes.find((node) => node.type === "generated");
    const references = graph.nodes.filter((node) => node.type === "reference");
    const prompt = graph.nodes.find((node) => node.type === "prompt");

    expect(graph).toMatchObject({
      name: expect.stringContaining("道劫"),
      target: { kind: "storyboard", id: "shot-3" },
    });
    expect(references).toEqual([
      expect.objectContaining({
        type: "reference",
        title: "角色参考：独孤剑尘",
        imageUrl: "project-file://dao/assets/char.png",
        source: { kind: "asset", assetType: "character", id: "char-1" },
      }),
      expect.objectContaining({
        type: "reference",
        title: "场景参考：道口镇",
        imageUrl: "project-file://dao/assets/scene.png",
        source: { kind: "asset", assetType: "scene", id: "scene-1" },
      }),
    ]);
    expect(generated).toMatchObject({
      type: "generated",
      title: "分镜 3 成图",
      prompt: "水墨国风，道口镇雨夜低机位推进",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      resultUrl: "project-file://daojie/workflow-images/storyboards/shot-3.png",
      status: "ready",
    });
    expect(prompt).toMatchObject({
      type: "prompt",
      title: "图片生成",
      prompt: "水墨国风，道口镇雨夜低机位推进",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: references[0]?.id, target: generated?.id }),
        expect.objectContaining({ source: references[1]?.id, target: generated?.id }),
        expect.objectContaining({ source: prompt?.id, target: generated?.id }),
      ]),
    );
    expect(buildImageWorkflowGenerationRequest(graph, generated?.id || "").referenceImages).toEqual([
      "project-file://dao/assets/char.png",
      "project-file://dao/assets/scene.png",
    ]);
    expect(buildStoryboardImageWorkflowPatch(graph, generated?.id || "")).toMatchObject({
      mediaRef: {
        kind: "image",
        path: "project-file://daojie/workflow-images/storyboards/shot-3.png",
        imageWorkflowId: graph.id,
        imageWorkflowNodeId: generated?.id,
      },
      imageWorkflowId: graph.id,
      imageWorkflowNodeId: generated?.id,
      state: "ready",
    });
  });

  it("produces a derived asset patch with Toonflow-style flow traceability", () => {
    let graph = createImageWorkflowGraph({
      id: "asset-flow-1",
      name: "衍生资产图片链",
      target: {
        kind: "asset",
        id: "var-1",
        assetType: "character",
        parentId: "char-1",
      },
      createdAt: 3000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-asset-1",
      prompt: "角色战损状态，水墨国风",
      position: { x: 620, y: 120 },
      createdAt: 3001,
    });
    graph = setGeneratedImageResult(graph, "gen-asset-1", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-1/var-1.png",
      mediaId: "media-asset-1",
      generatedAt: 3002,
    });

    expect(buildAssetImageWorkflowPatch(graph, "gen-asset-1")).toEqual({
      imageUrl: "project-file://daojie/workflow-images/asset-flow-1/var-1.png",
      imageWorkflowId: "asset-flow-1",
      imageWorkflowNodeId: "gen-asset-1",
      generatedAt: 3002,
    });
  });

  it("creates an asset image workflow with parent reference and generated result", () => {
    const graph = createAssetImageWorkflowGraph(
      {
        target: {
          kind: "asset",
          assetType: "prop",
          parentId: "prop-parent",
          id: "prop-derived",
        },
        title: "雨夜湿剑",
        prompt: "断剑雨夜湿润状态",
        sourceImagePath: "project-file://dao/parent.png",
        resultImagePath: "project-file://dao/derived.png",
        imageWorkflowId: "flow-derived-prop",
      },
      "道劫",
    );

    expect(graph.id).toBe("flow-derived-prop");
    expect(graph.name).toBe("道劫 · 雨夜湿剑 图片工作流");
    expect(graph.target).toEqual({
      kind: "asset",
      assetType: "prop",
      parentId: "prop-parent",
      id: "prop-derived",
    });
    const generated = graph.nodes.find((node) => node.type === "generated");
    const prompt = graph.nodes.find((node) => node.type === "prompt");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reference",
          title: "父资产参考图",
          imageUrl: "project-file://dao/parent.png",
        }),
        expect.objectContaining({
          type: "generated",
          title: "雨夜湿剑 成图",
          resultUrl: "project-file://dao/derived.png",
          status: "ready",
        }),
        expect.objectContaining({
          type: "prompt",
          title: "图片生成",
          prompt: "断剑雨夜湿润状态",
          aspectRatio: "16:9",
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: generated?.id }),
        expect.objectContaining({ source: prompt?.id, target: generated?.id }),
      ]),
    );
    expect(buildImageWorkflowGenerationRequest(graph, generated?.id || "")).toMatchObject({
      prompt: "断剑雨夜湿润状态",
      aspectRatio: "16:9",
      referenceImages: ["project-file://dao/parent.png"],
    });
  });

  it("hydrates an existing derived asset workflow with parent reference and result", () => {
    const graph = ensureAssetImageWorkflowGraph(
      createImageWorkflowGraph({
        id: "flow-derived-prop",
        name: "空衍生资产链",
        target: { kind: "asset", assetType: "prop", id: "prop-derived", parentId: "prop-parent" },
      }),
      {
        target: {
          kind: "asset",
          assetType: "prop",
          parentId: "prop-parent",
          id: "prop-derived",
        },
        title: "半截出鞘态",
        prompt: "断剑半截出鞘",
        sourceImagePath: "project-file://dao/parent.png",
        resultImagePath: "project-file://dao/derived.png",
        imageWorkflowId: "flow-derived-prop",
      },
    );

    const generated = graph.nodes.find((node) => node.type === "generated");
    const prompt = graph.nodes.find((node) => node.type === "prompt");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reference", imageUrl: "project-file://dao/parent.png" }),
        expect.objectContaining({
          type: "generated",
          resultUrl: "project-file://dao/derived.png",
          status: "ready",
        }),
        expect.objectContaining({
          type: "prompt",
          title: "图片生成",
          prompt: "断剑半截出鞘",
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: generated?.id }),
        expect.objectContaining({ source: prompt?.id, target: generated?.id }),
      ]),
    );
  });
});
