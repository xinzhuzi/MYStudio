import type { DerivedAsset, ScriptPlan } from "@/types/studio";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore, type PropItem } from "@/stores/props-library-store";
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

export interface DerivedPropSink {
  addProp: (input: Omit<PropItem, "id" | "createdAt">) => string;
}

export type EntityResolver = (
  name: string,
) => { kind: "character" | "scene" | "prop"; id: string } | null;

export interface SyncDerivedAssetsDeps {
  projectId: string;
  resolver: EntityResolver;
  characterSink: DerivedCharacterSink;
  sceneSink: DerivedSceneSink;
  propSink: DerivedPropSink;
}

export interface SyncDerivedAssetsResult {
  created: DerivedAsset[];
  summary: { created: number; skipped: number };
}

export function syncDerivedAssets(
  plan: ScriptPlan["derivedAssetPlan"],
  deps: SyncDerivedAssetsDeps,
): SyncDerivedAssetsResult {
  const { projectId, resolver, characterSink, sceneSink, propSink } = deps;
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

    if (target.kind === "scene") {
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
      continue;
    }

    const propId = propSink.addProp({
      name: `${item.parentAssetId}·${item.state}`,
      projectId,
      description: item.reason,
      visualPrompt: `${item.state}：${item.reason}`.trim(),
      imageUrl: "",
      isDerivative: true,
      parentId: target.id,
      category: item.state,
      folderId: null,
    });
    created.push({
      id: propId,
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
  props: { id: string; name: string }[] = [],
): EntityResolver {
  const map = new Map<string, { kind: "character" | "scene" | "prop"; id: string }>();
  for (const c of characters) {
    map.set(c.name, { kind: "character", id: c.id });
    map.set(c.id, { kind: "character", id: c.id });
    for (const alias of c.aliases ?? []) map.set(alias, { kind: "character", id: c.id });
  }
  for (const s of scenes) {
    map.set(s.name, { kind: "scene", id: s.id });
    map.set(s.id, { kind: "scene", id: s.id });
  }
  for (const p of props) {
    map.set(p.name, { kind: "prop", id: p.id });
    map.set(p.id, { kind: "prop", id: p.id });
  }
  return (name) => map.get(name) ?? null;
}

/** 真实 MYStudio store 适配 sink。 */
export function createMystudioDerivedSinks(): {
  characterSink: DerivedCharacterSink;
  sceneSink: DerivedSceneSink;
  propSink: DerivedPropSink;
} {
  return {
    characterSink: {
      addVariation: (characterId, variation) => {
        const store = useCharacterLibraryStore.getState();
        const existing = store
          .getCharacterById(characterId)
          ?.variations.find((item) => item.name === variation.name);
        return existing?.id ?? store.addVariation(characterId, variation);
      },
    },
    sceneSink: {
      addScene: (input) => {
        const store = useSceneStore.getState();
        const existing = store.scenes.find(
          (scene) =>
            scene.parentSceneId === input.parentSceneId &&
            scene.viewpointName === input.viewpointName &&
            (!input.projectId || scene.projectId === input.projectId),
        );
        return existing?.id ?? store.addScene(input);
      },
    },
    propSink: {
      addProp: (input) => {
        const store = usePropsLibraryStore.getState();
        const existing = store.items.find(
          (item) =>
            item.parentId === input.parentId &&
            item.category === input.category &&
            (!input.projectId || item.projectId === input.projectId),
        );
        return existing?.id ?? store.addProp(input).id;
      },
    },
  };
}
