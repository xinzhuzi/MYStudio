import { describe, expect, it } from "vitest";
import {
  assertOrderedReferences,
  storyboardContinuityStateIssues,
  storyboardPrimarySceneIssues,
} from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ImageWorkflowGraph,
  StoryboardItem,
} from "@/types/studio";
import { buildStoryboardContinuityLanding } from "./continuity-landing";

function sceneVersion(assetId: string, viewpoint: string, overrides: Partial<ContinuityAssetVersion> = {}): ContinuityAssetVersion {
  return {
    assetId,
    versionId: `${assetId}:${viewpoint}:v1`,
    assetKind: "scene",
    label: viewpoint,
    source: "test-source",
    referenceImagePaths: [`project-file://proj/continuity/${assetId}-${viewpoint}.png`],
    referenceImageSha256: ["a".repeat(64)],
    reviewEvidencePaths: [],
    reviewEvidenceSha256: [],
    sceneViewpointId: viewpoint,
    spatialLayout: "纵深测试",
    lightingDesign: "冷光漫射",
    colorPalette: "墨青灰",
    structurallyComplete: true,
    contentFingerprint: `fp-${assetId}-${viewpoint}`,
    approved: false,
    ...overrides,
  };
}

function characterVersion(assetId: string, wardrobe: string): ContinuityAssetVersion {
  return {
    assetId,
    versionId: `${assetId}:${wardrobe}:v1`,
    assetKind: "character",
    label: wardrobe,
    source: "test-source",
    referenceImagePaths: ["p1.png", "p2.png", "p3.png"],
    referenceImageSha256: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
    reviewEvidencePaths: [],
    reviewEvidenceSha256: [],
    referenceViewTypes: ["front", "side", "back"],
    wardrobeVersion: wardrobe,
    identityAnchors: { hairStyle: "束发", uniqueMarks: ["束发", "灰袍"] },
    negativePrompt: { avoid: ["换脸"] },
    structurallyComplete: true,
    contentFingerprint: `fp-${assetId}-${wardrobe}`,
    approved: true,
    approvalFingerprint: `af-${assetId}`,
  };
}

function propVersion(assetId: string): ContinuityAssetVersion {
  return {
    assetId,
    versionId: `${assetId}:base:v1`,
    assetKind: "prop",
    label: "base",
    source: "test-source",
    referenceImagePaths: [`project-file://proj/continuity/${assetId}.png`],
    referenceImageSha256: ["e".repeat(64)],
    reviewEvidencePaths: [],
    reviewEvidenceSha256: [],
    structurallyComplete: true,
    contentFingerprint: `fp-${assetId}`,
    approved: true,
    approvalFingerprint: `af-${assetId}-prop`,
  };
}

function graphWithReferences(refs: Array<{ id: string; title: string; assetType: "scene" | "character" | "prop"; assetId: string; order?: number }>): ImageWorkflowGraph {
  const nodes: ImageWorkflowGraph["nodes"] = refs.map((ref, index) => ({
    id: ref.id,
    type: "reference" as const,
    title: ref.title,
    imageUrl: `file:///refs/${ref.id}.png`,
    position: { x: 80, y: 80 + index * 120 },
    source: { kind: "asset" as const, assetType: ref.assetType, id: ref.assetId },
    continuityOrder: ref.order ?? index + 1,
    createdAt: 1,
    updatedAt: 1,
  }));
  nodes.push({
    id: "gen-1",
    type: "generated",
    title: "成图",
    position: { x: 600, y: 120 },
    prompt: "",
    aspectRatio: "16:9",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    id: "wf-1",
    name: "测试工作流",
    target: { kind: "storyboard", id: "sb-1" },
    nodes,
    edges: refs.map((ref) => ({ id: `e-${ref.id}`, source: ref.id, target: "gen-1" })),
    createdAt: 1,
    updatedAt: 1,
  } as ImageWorkflowGraph;
}

function storyboardFixture(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    episodeId: "chapter-001",
    index: 2,
    trackKey: "001-2",
    trackId: "",
    duration: 4,
    prompt: "码头雾气中的劳作。",
    videoDesc: "镜头描述",
    assetIds: [],
    state: "ready",
    lines: "旁白：测试。",
    speakerId: "narrator",
    shotSemantics: {
      sceneViewpointId: "码头-夜泊轴",
      personFree: false,
      visibleCharacters: [
        { name: "监工赵四", position: "左中景", orientation: "侧身朝右", actionIn: "抬臂", actionOut: "挥鞭" },
        { name: "画外人", position: "画外", orientation: "画外", actionIn: "x", actionOut: "y" },
      ],
      visibleProps: [],
      actionIn: "开场动作",
      actionOut: "收束动作",
    },
    ...overrides,
  } as StoryboardItem;
}

describe("buildStoryboardContinuityLanding", () => {
  const versions = [
    sceneVersion("scene-dock", "dock-main-axis"),
    sceneVersion("scene-school", "window-axis"),
    sceneVersion("scene-school", "lamp-desk-axis"),
    characterVersion("char-zhao", "dock-overseer"),
    propVersion("prop-whip"),
  ];

  it("构建场景+角色+道具清单且顺序从 1 连续", () => {
    const patch = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
        { id: "r2", title: "监工赵四", assetType: "character", assetId: "char-zhao" },
        { id: "r3", title: "赤练蛇皮鞭", assetType: "prop", assetId: "prop-whip" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [storyboardFixture()],
    });
    expect(patch).not.toBeNull();
    const roles = patch!.orderedReferenceManifest.map((reference) => reference.referenceRole);
    expect(roles).toEqual(["scene-viewpoint", "canonical", "prop-state"]);
    expect(patch!.orderedReferenceManifest.map((reference) => reference.order)).toEqual([1, 2, 3]);
    expect(patch!.orderedReferenceManifest[0]!.assetName).toBe("金水河码头");
    // 版本元数据逐字段复制
    expect(patch!.orderedReferenceManifest[1]!.wardrobeVersion).toBe("dock-overseer");
    expect(patch!.orderedReferenceManifest[1]!.approvalFingerprint).toBe("af-char-zhao");
  });

  it("产出数据通过原生审计三件套校验(顺序/指纹/主场景)", () => {
    const storyboard = storyboardFixture();
    const patch = buildStoryboardContinuityLanding({
      storyboard,
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
        { id: "r2", title: "监工赵四", assetType: "character", assetId: "char-zhao" },
        { id: "r3", title: "赤练蛇皮鞭", assetType: "prop", assetId: "prop-whip" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [storyboard],
    })!;
    const row = { ...storyboard, ...patch };
    expect(() => assertOrderedReferences(row.id, row.orderedReferenceManifest)).not.toThrow();
    expect(storyboardContinuityStateIssues(row)).toEqual([]);
    expect(storyboardPrimarySceneIssues(row)).toEqual([]);
    expect(row.continuityState.characters).toHaveLength(1);
    expect(row.continuityState.characters[0]).toMatchObject({
      characterId: "char-zhao",
      versionId: "char-zhao:dock-overseer:v1",
      position: "左中景",
    });
    // 画面外角色(参考未挂)不入连续性
    expect(row.continuityState.characters[0]!.characterId).not.toBe("画外人");
  });

  it("语义标签含「夜」时优先 night/归视角;多视角默认字典序首个", () => {
    const patch = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水塾馆", assetType: "scene", assetId: "scene-school" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [storyboardFixture()],
    })!;
    // 标签「码头-夜泊轴」不含塾馆关键词,scene-school 两版本走字典序默认
    expect(patch.continuityState.sceneViewpointId).toBe("lamp-desk-axis");

    const nightLabel = storyboardFixture({
      shotSemantics: {
        sceneViewpointId: "塾馆-夜课轴",
        personFree: false,
        visibleCharacters: [],
        visibleProps: [],
        actionIn: "a",
        actionOut: "b",
      },
    });
    const nightPatch = buildStoryboardContinuityLanding({
      storyboard: nightLabel,
      graph: graphWithReferences([
        { id: "r1", title: "金水塾馆", assetType: "scene", assetId: "scene-school" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [nightLabel],
    })!;
    // 「夜」命中 night 但两视角无 night token,回落「课」→ school/desk → lamp-desk-axis
    expect(nightPatch.continuityState.sceneViewpointId).toBe("lamp-desk-axis");
  });

  it("previousStoryboardId 兼容历史 backfill 组格式并取最近上一镜", () => {
    const previous = storyboardFixture({
      id: "sb-0",
      index: 1,
      continuityState: { groupId: "chapter-001:backfill:scene-dock" } as StoryboardItem["continuityState"],
    });
    const patch = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [previous, storyboardFixture()],
    })!;
    expect(patch.continuityState.previousStoryboardId).toBe("sb-0");
    expect(patch.continuityState.groupId).toBe("chapter-001:scene:scene-dock");
    // 不同场景的上一镜不承接
    const otherScene = storyboardFixture({
      id: "sb-other",
      index: 1,
      continuityState: { groupId: "chapter-001:scene:scene-other" } as StoryboardItem["continuityState"],
    });
    const noPrev = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [otherScene, storyboardFixture()],
    })!;
    expect(noPrev.continuityState.previousStoryboardId).toBeUndefined();
  });

  it("资产库 UUID 经 resolveAssetKey 桥接到实体 id(双 id 空间)", () => {
    const patch = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "ef3df572-asset-lib-uuid" },
        { id: "r2", title: "监工赵四", assetType: "character", assetId: "d715e3de-asset-lib-uuid" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [storyboardFixture()],
      resolveAssetKey: (_assetType, _assetLibraryId, title) => {
        if (title === "金水河码头") return "scene-dock";
        if (title === "监工赵四") return "char-zhao";
        return undefined;
      },
    })!;
    expect(patch.orderedReferenceManifest.map((reference) => reference.assetId)).toEqual(["scene-dock", "char-zhao"]);
    expect(patch.orderedReferenceManifest[0]!.versionId).toBe("scene-dock:dock-main-axis:v1");
    expect(patch.continuityState.characters[0]!.characterId).toBe("char-zhao");
  });

  it("前置不满足时返回 null:无逐镜语义/无场景版本/非分镜目标/无成图节点", () => {
    const graph = graphWithReferences([
      { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
    ]);
    const base = { graph, generatedNodeId: "gen-1", continuityAssetVersions: versions, storyboards: [] as StoryboardItem[] };
    expect(buildStoryboardContinuityLanding({ ...base, storyboard: storyboardFixture({ shotSemantics: undefined }) })).toBeNull();
    expect(buildStoryboardContinuityLanding({
      ...base,
      storyboard: storyboardFixture(),
      graph: { ...graph, target: { kind: "asset", id: "a", assetType: "character" } } as ImageWorkflowGraph,
    })).toBeNull();
    expect(buildStoryboardContinuityLanding({
      ...base,
      storyboard: storyboardFixture(),
      continuityAssetVersions: [],
    })).toBeNull();
    expect(buildStoryboardContinuityLanding({
      ...base,
      storyboard: storyboardFixture(),
      generatedNodeId: "missing",
    })).toBeNull();
  });

  it("次场景挂 secondary-scene 且主场景唯一", () => {
    const patch = buildStoryboardContinuityLanding({
      storyboard: storyboardFixture(),
      graph: graphWithReferences([
        { id: "r1", title: "金水河码头", assetType: "scene", assetId: "scene-dock" },
        { id: "r2", title: "金水塾馆", assetType: "scene", assetId: "scene-school" },
      ]),
      generatedNodeId: "gen-1",
      continuityAssetVersions: versions,
      storyboards: [storyboardFixture()],
    })!;
    const sceneRefs = patch.orderedReferenceManifest.filter((reference) => reference.assetKind === "scene");
    expect(sceneRefs.map((reference) => reference.referenceRole)).toEqual(["scene-viewpoint", "secondary-scene"]);
    const row = { ...storyboardFixture(), ...patch };
    expect(storyboardPrimarySceneIssues(row)).toEqual([]);
  });
});
