import { describe, expect, it } from "vitest";
import {
  crossCheckDerivedPlan,
  type DerivedPlanCrossCheckInput,
  type DerivedPlanCrossCheckParent,
} from "./workflow-derived-plan-cross-check";
import type {
  ContinuityAssetVersion,
  ScriptPlan,
  StoryboardItem,
} from "@/types/studio";

const parents: Record<string, DerivedPlanCrossCheckParent> = {
  "lib-char-1": { id: "char-1", name: "独孤剑尘", kind: "character" },
  "char-1": { id: "char-1", name: "独孤剑尘", kind: "character" },
  "scene-1": { id: "scene-1", name: "义庄", kind: "scene" },
  "prop-1": { id: "prop-1", name: "断剑", kind: "prop" },
  断剑: { id: "prop-1", name: "断剑", kind: "prop" },
};

const versions: ContinuityAssetVersion[] = [
  {
    assetId: "lib-char-1",
    versionId: "v-grey",
    assetKind: "character",
    label: "灰衫入镇态",
    wardrobeVersion: "grey-town",
    referenceImagePaths: [],
    structurallyComplete: true,
    contentFingerprint: "fp-grey",
    approved: true,
    source: "test",
  },
  {
    assetId: "lib-char-1",
    versionId: "v-rain",
    assetKind: "character",
    label: "雨夜破衣",
    referenceImagePaths: [],
    structurallyComplete: true,
    contentFingerprint: "fp-rain",
    approved: true,
    source: "test",
  },
];

function storyboard(partial: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: "shot-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 4,
    prompt: "镜",
    videoDesc: "镜",
    assetIds: [],
    state: "ready",
    ...partial,
  };
}

function planItem(
  parentAssetId: string,
  state: string,
): ScriptPlan["derivedAssetPlan"][number] {
  return { parentAssetId, state, reason: "" };
}

function buildInput(
  overrides: Partial<DerivedPlanCrossCheckInput>,
): DerivedPlanCrossCheckInput {
  return {
    planItems: [],
    chapterStoryboards: [],
    continuityAssetVersions: versions,
    resolveParent: (key) => parents[key] ?? null,
    resolveSceneVariant: (sceneRef) =>
      sceneRef === "scene-1-rain"
        ? { parent: parents["scene-1"]!, state: "夜雨视角" }
        : null,
    hasDerivedVariant: () => false,
    ...overrides,
  };
}

describe("crossCheckDerivedPlan(⑦ 预划 × 当前章分镜交叉核对)", () => {
  it("角色:版本 label/wardrobeVersion 被分镜引用——已预划=正常,未预划=提示,预划零引用=未使用", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("char-1", "灰衫入镇态"), planItem("char-1", "战损")],
      chapterStoryboards: [
        storyboard({
          id: "shot-1",
          continuityState: {
            groupId: "g1",
            sceneVersionId: "sv1",
            sceneViewpointId: "dock",
            lighting: "",
            palette: "",
            actionIn: "",
            actionOut: "",
            characters: [{ characterId: "lib-char-1", versionId: "v-grey", position: "", orientation: "", actionIn: "", actionOut: "" }],
            inputFingerprint: "",
          },
        }),
        storyboard({
          id: "shot-2",
          continuityState: {
            groupId: "g1",
            sceneVersionId: "sv1",
            sceneViewpointId: "dock",
            lighting: "",
            palette: "",
            actionIn: "",
            actionOut: "",
            characters: [{ characterId: "lib-char-1", versionId: "v-rain", position: "", orientation: "", actionIn: "", actionOut: "" }],
            inputFingerprint: "",
          },
        }),
      ],
    }));
    // 灰衫入镇态:已预划+分镜引用 → 两边都不报
    // 雨夜破衣(v-rain label):分镜引用但未预划 → unplanned,证据=shot-2
    // 战损:预划了但分镜零引用 → unused
    expect(result.unplanned).toEqual([
      { parentAssetId: "char-1", kind: "character", state: "雨夜破衣", evidenceShotIds: ["shot-2"] },
    ]);
    expect(result.unused).toEqual([{ parentAssetId: "char-1", state: "战损" }]);
  });

  it("角色 wardrobeVersion 也可作状态证据;项目内已有变体记录时不再报未预划", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("char-1", "grey-town")],
      chapterStoryboards: [
        storyboard({
          continuityState: {
            groupId: "g1",
            sceneVersionId: "sv1",
            sceneViewpointId: "dock",
            lighting: "",
            palette: "",
            actionIn: "",
            actionOut: "",
            characters: [{ characterId: "lib-char-1", versionId: "v-grey", position: "", orientation: "", actionIn: "", actionOut: "" }],
            inputFingerprint: "",
          },
        }),
        storyboard({
          id: "shot-2",
          continuityState: {
            groupId: "g1",
            sceneVersionId: "sv1",
            sceneViewpointId: "dock",
            lighting: "",
            palette: "",
            actionIn: "",
            actionOut: "",
            characters: [{ characterId: "lib-char-1", versionId: "v-rain", position: "", orientation: "", actionIn: "", actionOut: "" }],
            inputFingerprint: "",
          },
        }),
      ],
      hasDerivedVariant: (parent, state) =>
        parent.id === "char-1" && state === "雨夜破衣",
    }));
    // 雨夜破衣 有变体记录(只是漏预划)→ 不混入 unplanned
    expect(result.unplanned).toEqual([]);
    // grey-town(wardrobeVersion)被引用 → 不算未使用
    expect(result.unused).toEqual([]);
  });

  it("场景:分镜引用衍生变体场景 → viewpointName 即衍生状态", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("scene-1", "雪夜视角")],
      chapterStoryboards: [storyboard({ assetIds: ["scene-1-rain", "scene-1"] })],
    }));
    expect(result.unplanned).toEqual([
      { parentAssetId: "scene-1", kind: "scene", state: "夜雨视角", evidenceShotIds: ["shot-1"] },
    ]);
    expect(result.unused).toEqual([{ parentAssetId: "scene-1", state: "雪夜视角" }]);
  });

  it("道具:出镜语义 {name, state} 精确对父道具名与预划状态", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("prop-1", "裂纹版")],
      chapterStoryboards: [
        storyboard({
          shotSemantics: {
            sceneViewpointId: "dock",
            personFree: false,
            visibleCharacters: [],
            visibleProps: [
              { name: "断剑", position: "前景", state: "裂纹版" },
              { name: "断剑", position: "前景", state: "染血版" },
            ],
            actionIn: "",
            actionOut: "",
          },
        }),
        storyboard({
          id: "shot-2",
          shotSemantics: {
            sceneViewpointId: "dock",
            personFree: false,
            visibleCharacters: [],
            visibleProps: [{ name: "断剑", position: "前景", state: "染血版" }],
            actionIn: "",
            actionOut: "",
          },
        }),
      ],
    }));
    expect(result.unplanned).toEqual([
      { parentAssetId: "prop-1", kind: "prop", state: "染血版", evidenceShotIds: ["shot-1", "shot-2"] },
    ]);
    expect(result.unused).toEqual([]);
  });

  it("证据通道缺失(旧分镜无连续性/出镜语义)时,「未使用」静默跳过不误报", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("char-1", "雨夜破衣"), planItem("prop-1", "裂纹版")],
      chapterStoryboards: [storyboard({ assetIds: ["char-1"] })],
    }));
    expect(result.unplanned).toEqual([]);
    expect(result.unused).toEqual([]);
  });

  it("父资产解析不到的计划条目跳过,不进 unused 也不进 planned 匹配", () => {
    const result = crossCheckDerivedPlan(buildInput({
      planItems: [planItem("ghost-parent", "任意状态")],
      chapterStoryboards: [
        storyboard({
          shotSemantics: {
            sceneViewpointId: "dock",
            personFree: true,
            visibleCharacters: [],
            visibleProps: [{ name: "无名道具", position: "", state: "任意状态" }],
            actionIn: "",
            actionOut: "",
          },
        }),
      ],
    }));
    expect(result.unused).toEqual([]);
    expect(result.unplanned).toEqual([]);
  });
});
