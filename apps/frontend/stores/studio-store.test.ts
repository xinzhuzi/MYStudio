// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "./studio-store";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
  useCharacterLibraryStore.getState().reset();
  useSceneStore.getState().reset();
  usePropsLibraryStore.setState({
    items: [],
    folders: [],
    selectedFolderId: "all",
  });
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

  it("applies generated image workflow output to a character derived asset", () => {
    const characterId = useCharacterLibraryStore.getState().addCharacter({
      name: "晏燎",
      description: "少年修士",
      visualTraits: "ink wash xianxia teen",
      views: [],
      variations: [
        {
          id: "var-battle",
          name: "战损",
          visualPrompt: "破衣血痕",
        },
      ],
    });
    let graph = createImageWorkflowGraph({
      id: "asset-flow-character",
      name: "角色衍生图",
      target: {
        kind: "asset",
        assetType: "character",
        parentId: characterId,
        id: "var-battle",
      },
      createdAt: 4000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-character",
      prompt: "战损状态",
      position: { x: 620, y: 120 },
      createdAt: 4001,
    });
    graph = setGeneratedImageResult(graph, "gen-character", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-character/var-battle.png",
      generatedAt: 4002,
    });

    useStudioStore.getState().upsertImageWorkflow(graph);
    useStudioStore.getState().applyImageWorkflowResultToAsset(graph.target, graph.id, "gen-character");

    expect(useCharacterLibraryStore.getState().getVariationById(characterId, "var-battle")).toMatchObject({
      referenceImage: "project-file://daojie/workflow-images/asset-flow-character/var-battle.png",
      imageWorkflowId: "asset-flow-character",
      imageWorkflowNodeId: "gen-character",
      generatedAt: 4002,
    });
  });

  it("applies generated image workflow output to scene and prop derived assets", () => {
    const sceneId = useSceneStore.getState().addScene({
      name: "义庄夜景",
      location: "义庄",
      time: "夜",
      atmosphere: "阴冷",
      visualPrompt: "义庄夜景",
    });
    const prop = usePropsLibraryStore.getState().addProp({
      name: "裂纹木牌",
      description: "道具衍生",
      imageUrl: "",
      folderId: null,
      isDerivative: true,
      parentId: "prop-parent",
    });
    let sceneGraph = createImageWorkflowGraph({
      id: "asset-flow-scene",
      name: "场景衍生图",
      target: {
        kind: "asset",
        assetType: "scene",
        id: sceneId,
      },
      createdAt: 5000,
    });
    sceneGraph = addGeneratedImageNode(sceneGraph, {
      id: "gen-scene",
      prompt: "义庄夜景",
      position: { x: 620, y: 120 },
      createdAt: 5001,
    });
    sceneGraph = setGeneratedImageResult(sceneGraph, "gen-scene", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-scene/night.png",
      generatedAt: 5002,
    });
    let propGraph = createImageWorkflowGraph({
      id: "asset-flow-prop",
      name: "道具衍生图",
      target: {
        kind: "asset",
        assetType: "prop",
        parentId: "prop-parent",
        id: prop.id,
      },
      createdAt: 6000,
    });
    propGraph = addGeneratedImageNode(propGraph, {
      id: "gen-prop",
      prompt: "裂纹木牌",
      position: { x: 620, y: 120 },
      createdAt: 6001,
    });
    propGraph = setGeneratedImageResult(propGraph, "gen-prop", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-prop/prop.png",
      generatedAt: 6002,
    });

    useStudioStore.getState().upsertImageWorkflow(sceneGraph);
    useStudioStore.getState().upsertImageWorkflow(propGraph);
    useStudioStore.getState().applyImageWorkflowResultToAsset(sceneGraph.target, sceneGraph.id, "gen-scene");
    useStudioStore.getState().applyImageWorkflowResultToAsset(propGraph.target, propGraph.id, "gen-prop");

    expect(useSceneStore.getState().getSceneById(sceneId)).toMatchObject({
      referenceImage: "project-file://daojie/workflow-images/asset-flow-scene/night.png",
      imageWorkflowId: "asset-flow-scene",
      imageWorkflowNodeId: "gen-scene",
    });
    expect(usePropsLibraryStore.getState().getPropById(prop.id)).toMatchObject({
      imageUrl: "project-file://daojie/workflow-images/asset-flow-prop/prop.png",
      imageWorkflowId: "asset-flow-prop",
      imageWorkflowNodeId: "gen-prop",
    });
  });

  it("replaces stale storyboard rows for the same episode without losing existing media", () => {
    const store = useStudioStore.getState();

    store.addStoryboard({
      id: "sb-ep1-1",
      episodeId: "ep1",
      index: 1,
      trackKey: "old-1",
      prompt: "旧分镜一",
      mediaRef: { kind: "image", path: "project-file://frames/old-1.png" },
      audioRef: { kind: "audio", path: "project-file://audio/old-1.wav" },
      state: "ready",
    });
    store.addStoryboard({
      id: "sb-ep1-2",
      episodeId: "ep1",
      index: 2,
      trackKey: "old-2",
      prompt: "旧分镜二",
    });
    store.addStoryboard({
      id: "sb-ep2-1",
      episodeId: "ep2",
      index: 1,
      trackKey: "other-episode",
      prompt: "其他集分镜",
    });

    useStudioStore.getState().replaceStoryboardsForEpisode("ep1", [
      {
        id: "sb-ep1-1",
        episodeId: "ep1",
        index: 1,
        trackKey: "segment-001",
        trackId: "",
        duration: 8,
        prompt: "当前片段一",
        videoDesc: "当前片段一的画面",
        assetIds: ["role-1"],
        state: "idle",
      },
    ]);

    const state = useStudioStore.getState();
    expect(state.storyboards.map((item) => item.id)).toEqual([
      "sb-ep2-1",
      "sb-ep1-1",
    ]);
    expect(state.storyboards.find((item) => item.id === "sb-ep1-2")).toBeUndefined();
    expect(state.storyboards.find((item) => item.id === "sb-ep1-1")).toMatchObject({
      prompt: "当前片段一",
      trackKey: "segment-001",
      mediaRef: { kind: "image", path: "project-file://frames/old-1.png" },
      audioRef: { kind: "audio", path: "project-file://audio/old-1.wav" },
    });
    expect(
      state.productionTracks.flatMap((track) => track.storyboardIds),
    ).not.toContain("sb-ep1-2");
  });
});
