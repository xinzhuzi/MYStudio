import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addReferenceImageNode,
  buildAssetImageWorkflowPatch,
  buildImageWorkflowGenerationRequest,
  assertImageWorkflowContinuityCapability,
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
      orderedReferenceManifest: [
        { order: Number.MAX_SAFE_INTEGER, imageUrl: "local-image://characters/hero.png" },
        { order: Number.MAX_SAFE_INTEGER, imageUrl: "https://example.test/scene.png" },
      ],
      continuityRequired: false,
      previousApprovedFrameIncluded: false,
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
          order: 2,
          versionId: "dugu:base",
          referenceRole: "canonical",
          identityAnchors: {
            faceShape: "清瘦长脸",
            uniqueMarks: ["银白长发与右肩破损灰袍"],
            hairStyle: "及腰银白长发，半束高髻",
          },
          negativePrompt: { avoid: ["黑发", "圆脸"] },
          wardrobeVersion: "灰衫入镇态",
          characterViewType: "front",
        },
        {
          assetId: "scene-1",
          assetType: "scene",
          title: "场景参考：道口镇",
          imageUrl: "project-file://dao/assets/scene.png",
          order: 1,
          versionId: "scene:main",
          referenceRole: "scene-viewpoint",
          sceneViewpointId: "dock-main-axis",
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
        title: "场景参考：道口镇",
        imageUrl: "project-file://dao/assets/scene.png",
        source: { kind: "asset", assetType: "scene", id: "scene-1" },
        continuityOrder: 1,
        sceneViewpointId: "dock-main-axis",
      }),
      expect.objectContaining({
        type: "reference",
        title: "角色参考：独孤剑尘",
        imageUrl: "project-file://dao/assets/char.png",
        source: { kind: "asset", assetType: "character", id: "char-1" },
        continuityOrder: 2,
        wardrobeVersion: "灰衫入镇态",
        characterViewType: "front",
        identityAnchors: expect.objectContaining({ hairStyle: "及腰银白长发，半束高髻" }),
        negativePrompt: { avoid: ["黑发", "圆脸"] },
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
    const request = buildImageWorkflowGenerationRequest(graph, generated?.id || "");
    expect(request.referenceImages).toEqual([
      "project-file://dao/assets/scene.png",
      "project-file://dao/assets/char.png",
    ]);
    expect(request.prompt).toContain("【资产圣经】");
    expect(request.prompt).toContain("dock-main-axis");
    expect(request.prompt).toContain("银白长发与右肩破损灰袍");
    expect(request.prompt).toContain("灰衫入镇态");
    expect(request.prompt).toContain("角色视图：front");
    expect(request.orderedReferenceManifest[1]).toMatchObject({ characterViewType: "front" });
    expect(request.negativePrompt).toContain("黑发");
    expect(request.negativePrompt).toContain("圆脸");
    expect(() => assertImageWorkflowContinuityCapability(
      buildImageWorkflowGenerationRequest(graph, generated?.id || ""),
    )).not.toThrow();
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

  it("groups multiple character views as one in-frame identity", () => {
    const graph = createStoryboardImageWorkflowGraph({
      storyboard: {
        id: "shot-11",
        index: 11,
        prompt: "小杂役滚入船影。",
        continuityState: {
          groupId: "dock-1",
          previousStoryboardId: "shot-10",
          sceneVersionId: "dock:morning",
          sceneViewpointId: "dock-main-axis",
          lighting: "冷青晨雾",
          palette: "墨青灰蓝",
          actionIn: "小杂役贴地滚动",
          actionOut: "小杂役缩进船影",
          characters: [{
            characterId: "char-helper",
            versionId: "char-helper:dock-ragged:v1",
            position: "右后格",
            orientation: "背部三分之四朝右",
            actionIn: "贴地滚动",
            actionOut: "缩进船影",
          }],
          inputFingerprint: "fingerprint",
        },
      },
      prompt: "小杂役滚入船影。",
      resultImagePath: "project-file://dao/shot-11.png",
      projectName: "道劫",
      model: "gpt-image-2",
      referenceImages: ["front", "side", "back"].map((view, index) => ({
        assetId: "char-helper",
        assetType: "character" as const,
        title: "小杂役",
        imageUrl: `project-file://dao/helper-${view}.png`,
        order: index + 1,
        versionId: "char-helper:dock-ragged:v1",
        referenceRole: "canonical" as const,
        characterViewType: view as "front" | "side" | "back",
        identityAnchors: { faceShape: "清瘦少年脸", uniqueMarks: ["凌乱及肩黑发"] },
      })),
    });
    const generated = graph.nodes.find((node) => node.type === "generated");
    const request = buildImageWorkflowGenerationRequest(graph, generated?.id || "");

    expect(request.referenceImages).toHaveLength(3);
    expect(request.prompt).toContain("【多视图身份锁】");
    expect(request.prompt).toContain("@图1/@图2/@图3 为小杂役同一角色、同一版本的 front/side/back 参考视图");
    expect(request.prompt).toContain("不是三个人");
    expect(request.prompt).toContain("该角色在本镜只允许出现一个实例");
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

  it("deduplicates equivalent local parent reference paths when hydrating a derived asset workflow", () => {
    let existing = createImageWorkflowGraph({
      id: "flow-derived-character",
      name: "角色衍生资产链",
      target: { kind: "asset", assetType: "character", id: "char-derived", parentId: "char-parent" },
    });
    existing = addReferenceImageNode(existing, {
      id: "ref-file-url",
      title: "父资产参考图",
      imageUrl: "file:///Users/zhengbingjin/Project/asset%20source.png",
      position: { x: 80, y: 100 },
    });
    existing = addReferenceImageNode(existing, {
      id: "ref-absolute-path",
      title: "父资产参考图",
      imageUrl: "/Users/zhengbingjin/Project/asset source.png",
      position: { x: 80, y: 360 },
    });
    existing = addGeneratedImageNode(existing, {
      id: "gen-character",
      title: "灰衫入镇态 成图",
      prompt: "灰衫入镇态",
      position: { x: 620, y: 120 },
    });
    existing = connectImageWorkflowNodes(existing, {
      source: "ref-file-url",
      target: "gen-character",
    });
    existing = connectImageWorkflowNodes(existing, {
      source: "ref-absolute-path",
      target: "gen-character",
    });

    const graph = ensureAssetImageWorkflowGraph(existing, {
      target: {
        kind: "asset",
        assetType: "character",
        parentId: "char-parent",
        id: "char-derived",
      },
      title: "灰衫入镇态",
      prompt: "灰衫入镇态",
      sourceImagePath: "/Users/zhengbingjin/Project/asset source.png",
      resultImagePath: "project-file://dao/workflow-images/assets/character/char-derived.png",
      imageWorkflowId: "flow-derived-character",
    });

    const references = graph.nodes.filter((node) => node.type === "reference");
    const generated = graph.nodes.find((node) => node.type === "generated");

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      id: "ref-file-url",
      imageUrl: "file:///Users/zhengbingjin/Project/asset%20source.png",
    });
    expect(graph.edges.filter((edge) => edge.target === generated?.id && edge.source === "ref-file-url")).toHaveLength(1);
    expect(graph.edges.some((edge) => edge.source === "ref-absolute-path")).toBe(false);
    expect(buildImageWorkflowGenerationRequest(graph, generated?.id || "").referenceImages).toEqual([
      "file:///Users/zhengbingjin/Project/asset%20source.png",
    ]);
  });

  it("deduplicates MYStudio asset file and thumbnail references for the same parent asset", () => {
    let existing = createImageWorkflowGraph({
      id: "flow-derived-character",
      name: "角色衍生资产链",
      target: { kind: "asset", assetType: "character", id: "char-derived", parentId: "char-parent" },
    });
    existing = addReferenceImageNode(existing, {
      id: "ref-file",
      title: "父资产参考图",
      imageUrl: "/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/role/d715e3de.png",
      source: { kind: "asset", assetType: "character", id: "char-parent" },
      position: { x: 80, y: 100 },
    });
    existing = addReferenceImageNode(existing, {
      id: "ref-thumb",
      title: "父资产参考图",
      imageUrl: "file:///Users/zhengbingjin/Library/Application%20Support/漫影工作室/assets/thumbs/role/d715e3de.png",
      source: { kind: "asset", assetType: "character", id: "char-parent" },
      position: { x: 80, y: 360 },
    });
    existing = addGeneratedImageNode(existing, {
      id: "gen-character",
      title: "灰衫入镇态 成图",
      prompt: "灰衫入镇态",
      position: { x: 620, y: 120 },
    });
    existing = connectImageWorkflowNodes(existing, {
      source: "ref-file",
      target: "gen-character",
    });
    existing = connectImageWorkflowNodes(existing, {
      source: "ref-thumb",
      target: "gen-character",
    });

    const graph = ensureAssetImageWorkflowGraph(existing, {
      target: {
        kind: "asset",
        assetType: "character",
        parentId: "char-parent",
        id: "char-derived",
      },
      title: "灰衫入镇态",
      prompt: "灰衫入镇态",
      sourceImagePath: "/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/role/d715e3de.png",
      resultImagePath: "project-file://dao/workflow-images/assets/character/char-derived.png",
      imageWorkflowId: "flow-derived-character",
    });

    const references = graph.nodes.filter((node) => node.type === "reference");
    const generated = graph.nodes.find((node) => node.type === "generated");

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      id: "ref-file",
      imageUrl: "/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/role/d715e3de.png",
    });
    expect(graph.edges.filter((edge) => edge.target === generated?.id && edge.source === "ref-file")).toHaveLength(1);
    expect(graph.edges.some((edge) => edge.source === "ref-thumb")).toBe(false);
  });
});
