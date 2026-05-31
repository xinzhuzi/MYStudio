import type { DerivedAsset, ScriptPlan } from "@/types/studio";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";

export interface DerivedCharacterSink {
  addVariation: (
    characterId: string,
    variation: {
      name: string;
      visualPrompt: string;
      visualPromptZh?: string;
      isStageVariation?: boolean;
    },
  ) => string;
}

export interface DerivedSceneSink {
  addScene: (input: {
    name: string;
    location: string;
    time: string;
    atmosphere: string;
    projectId?: string;
    parentSceneId?: string;
    isViewpointVariant?: boolean;
    viewpointName?: string;
    notes?: string;
    status?: "draft" | "linked";
  }) => string;
}

export type EntityResolver = (
  name: string,
) => { kind: "character" | "scene"; id: string } | null;

export interface SyncDerivedAssetsDeps {
  projectId: string;
  resolver: EntityResolver;
  characterSink: DerivedCharacterSink;
  sceneSink: DerivedSceneSink;
}

export interface SyncDerivedAssetsResult {
  created: DerivedAsset[];
  summary: { created: number; skipped: number };
}

export function syncDerivedAssets(
  plan: ScriptPlan["derivedAssetPlan"],
  deps: SyncDerivedAssetsDeps,
): SyncDerivedAssetsResult {
  const { projectId, resolver, characterSink, sceneSink } = deps;
  const created: DerivedAsset[] = [];
  let skipped = 0;

  for (const item of plan) {
    const target = resolver(item.parentAssetId);
    if (!target) {
      skipped += 1;
      continue;
    }

    if (target.kind === "character") {
      const variationId = characterSink.addVariation(target.id, {
        name: item.state,
        visualPrompt: `${item.state}：${item.reason}`.trim(),
        visualPromptZh: `${item.state}：${item.reason}`.trim(),
      });
      created.push({
        id: variationId,
        parentAssetId: target.id,
        state: item.state,
        desc: item.reason,
        imageRef: null,
      });
      continue;
    }

    // scene: 角度/时段/天候/破坏 衍生统一落为视角变体场景行
    const sceneId = sceneSink.addScene({
      name: `${item.parentAssetId}·${item.state}`,
      location: item.parentAssetId,
      time: "",
      atmosphere: "",
      projectId,
      parentSceneId: target.id,
      isViewpointVariant: true,
      viewpointName: item.state,
      notes: item.reason,
      status: "linked",
    });
    created.push({
      id: sceneId,
      parentAssetId: target.id,
      state: item.state,
      desc: item.reason,
      imageRef: null,
    });
  }

  return { created, summary: { created: created.length, skipped } };
}

/** 基于已存实体批次构建一个名称/ID → 实体 的解析器。 */
export function buildEntityResolver(
  characters: { id: string; name: string; aliases?: string[] }[],
  scenes: { id: string; name: string }[],
): EntityResolver {
  const map = new Map<string, { kind: "character" | "scene"; id: string }>();
  for (const c of characters) {
    map.set(c.name, { kind: "character", id: c.id });
    map.set(c.id, { kind: "character", id: c.id });
    for (const alias of c.aliases ?? []) map.set(alias, { kind: "character", id: c.id });
  }
  for (const s of scenes) {
    map.set(s.name, { kind: "scene", id: s.id });
    map.set(s.id, { kind: "scene", id: s.id });
  }
  return (name) => map.get(name) ?? null;
}

/** 真实 MYStudio store 适配 sink。 */
export function createMystudioDerivedSinks(): { characterSink: DerivedCharacterSink; sceneSink: DerivedSceneSink } {
  return {
    characterSink: {
      addVariation: (characterId, variation) =>
        useCharacterLibraryStore.getState().addVariation(characterId, variation),
    },
    sceneSink: {
      addScene: (input) => useSceneStore.getState().addScene(input),
    },
  };
}
