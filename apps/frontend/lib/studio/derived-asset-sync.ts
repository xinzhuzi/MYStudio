import type { DerivedAsset, ScriptPlan } from "@/types/studio";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore, type PropItem } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";

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
) => { kind: "character" | "scene" | "prop"; id: string; name: string } | null;

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
      // 1013 修 RC-7③:行名/location 用解析实体的规范名(复合名 parentAssetId
      // 降级命中时前段=规范名,两段式同长形态;幂等键 parentSceneId/viewpointName
      // 不依赖行名)
      const sceneId = sceneSink.addScene({
        name: `${target.name}·${item.state}`,
        location: target.name,
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
      // 1013 修 RC-7③:同场景行——行名前段用规范名而非原始复合名
      name: `${target.name}·${item.state}`,
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
  const map = new Map<
    string,
    { kind: "character" | "scene" | "prop"; id: string; name: string }
  >();
  const put = (
    key: string,
    value: { kind: "character" | "scene" | "prop"; id: string; name: string },
  ) => {
    const normalized = key.trim().toLowerCase();
    if (normalized) map.set(normalized, value);
  };
  for (const c of characters) {
    const value = { kind: "character" as const, id: c.id, name: c.name };
    put(c.name, value);
    put(c.id, value);
    for (const alias of c.aliases ?? []) put(alias, value);
  }
  for (const s of scenes) {
    const value = { kind: "scene" as const, id: s.id, name: s.name };
    put(s.name, value);
    put(s.id, value);
  }
  for (const p of props) {
    const value = { kind: "prop" as const, id: p.id, name: p.name };
    put(p.name, value);
    put(p.id, value);
  }
  // 1013 修 RC-7:存量 derivedAssetPlan 的 parentAssetId 是「名·状态」复合名
  // (如「独孤剑尘·灰衫逃亡状态」)——整名精确未中时取首个「·」前段降级匹配;
  // 前段须精确等于某键才命中(「灰白碎灵石·测灵状态」前段≠碎灵石不中,
  // 「旧背囊」无实体不中),防误匹配。
  const resolveKey = (name: string): string | null => {
    const whole = name.trim().toLowerCase();
    if (map.has(whole)) return whole;
    const dotIndex = name.indexOf("·");
    if (dotIndex > 0) {
      const head = name.slice(0, dotIndex).trim().toLowerCase();
      if (head && map.has(head)) return head;
    }
    return null;
  };
  return (name) => {
    const key = resolveKey(name);
    return key ? (map.get(key) ?? null) : null;
  };
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
