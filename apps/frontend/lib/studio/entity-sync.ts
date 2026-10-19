import type { DedupedEntity, EntityKind } from "@/lib/studio/entity-extraction";
import type { EntityExtractionResult } from "@/types/studio";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { formatAssetName } from "@/lib/studio/asset-names";

export interface CharacterSink {
  addCharacter: (input: {
    name: string;
    description: string;
    visualTraits: string;
    projectId?: string;
    folderId?: string | null;
    notes?: string;
    status?: "draft" | "linked";
    linkedEpisodeId?: string;
    assetName?: string;
  }) => string;
  updateCharacter: (id: string, updates: Record<string, unknown>) => void;
  getOrCreateProjectFolder: (projectId: string, projectName: string) => string;
}

export interface SceneSink {
  addScene: (input: {
    name: string;
    location: string;
    time: string;
    atmosphere: string;
    projectId?: string;
    folderId?: string | null;
    notes?: string;
    status?: "draft" | "linked";
    linkedEpisodeId?: string;
    assetName?: string;
  }) => string;
  updateScene: (id: string, updates: Record<string, unknown>) => void;
  getOrCreateProjectFolder: (projectId: string, projectName: string) => string;
}

export interface PropSink {
  addProp: (input: {
    name: string;
    description: string;
    projectId?: string;
    folderId?: string | null;
    category?: string;
    assetName?: string;
  }) => string;
}

/**
 * 同步实体(D10/D11 扩展,10-19 C1 Step 10):
 * - firstEpisodeId:首次出场章(真源=出场索引);入库时作为 linkedEpisodeId,
 *   缺省回落本批 episodeId(单章路径无索引时的已知首章)。
 * - promoted:显式 false=未晋升(D10)——不入三库,批内记确定性伪 id 留痕
 *   (资产页按章展示不空,可后续手动晋升);缺省=入库(单章既有语义)。
 */
export interface SyncExtractedEntity extends DedupedEntity {
  firstEpisodeId?: string;
  promoted?: boolean;
}

export interface SyncExtractedEntitiesInput {
  episodeId: string;
  entities: SyncExtractedEntity[];
  projectId: string;
  projectName: string;
}

export interface SyncSinks {
  characterSink: CharacterSink;
  sceneSink: SceneSink;
  propSink?: PropSink;
}

export interface SyncSummary {
  created: number;
  merged: number;
  /** D10:未晋升被挡在三库外的实体数(批内伪 id 留痕)。 */
  deferred: number;
}

export interface SyncExtractedEntitiesOutput {
  result: EntityExtractionResult;
  summary: SyncSummary;
}

function notesFromAliases(aliases: string[]): string | undefined {
  return aliases.length ? `别名：${aliases.join("、")}` : undefined;
}

function isKind(entity: DedupedEntity, kind: EntityKind): boolean {
  return entity.kind === kind;
}

export function syncExtractedEntities(
  input: SyncExtractedEntitiesInput,
  sinks: SyncSinks,
): SyncExtractedEntitiesOutput {
  const { episodeId, entities, projectId, projectName } = input;
  const { characterSink, sceneSink } = sinks;

  const characters: EntityExtractionResult["characters"] = [];
  const scenes: EntityExtractionResult["scenes"] = [];
  const props: EntityExtractionResult["props"] = [];
  let created = 0;
  let merged = 0;
  let deferred = 0;
  let pseudoCharSeq = 0;
  let pseudoSceneSeq = 0;

  let charFolderId: string | null = null;
  let sceneFolderId: string | null = null;
  const ensureCharFolder = () =>
    (charFolderId ??= characterSink.getOrCreateProjectFolder(projectId, projectName));
  const ensureSceneFolder = () =>
    (sceneFolderId ??= sceneSink.getOrCreateProjectFolder(projectId, projectName));

  for (const entity of entities) {
    // D10 晋升过滤:未晋升不入三库(批内确定性伪 id 留痕,可后续手动晋升)
    if (entity.promoted === false) {
      if (isKind(entity, "character")) {
        pseudoCharSeq += 1;
        characters.push({
          characterId: `char-${episodeId}-${pseudoCharSeq}`,
          name: entity.name,
          aliases: entity.aliases,
          note: entity.note,
        });
      } else if (isKind(entity, "scene")) {
        pseudoSceneSeq += 1;
        scenes.push({
          sceneId: `scene-${episodeId}-${pseudoSceneSeq}`,
          name: entity.name,
          note: entity.note,
        });
      } else {
        props.push({ assetId: `prop-${episodeId}-${props.length + 1}`, name: entity.name, note: entity.note });
      }
      deferred += 1;
      continue;
    }

    // D11:入库 linkedEpisodeId=首次出场章(缺省=本批章,即单章路径下的该章)
    const linkedEpisodeId = entity.firstEpisodeId ?? episodeId;

    if (isKind(entity, "character")) {
      if (entity.isNew || !entity.id) {
        const characterId = characterSink.addCharacter({
          name: entity.name,
          description: entity.note ?? "",
          visualTraits: "",
          projectId,
          folderId: ensureCharFolder(),
          notes: notesFromAliases(entity.aliases),
          status: "linked",
          linkedEpisodeId,
          assetName: formatAssetName(entity.name, entity.aliases),
        });
        characters.push({ characterId, name: entity.name, aliases: entity.aliases, note: entity.note });
        created += 1;
      } else {
        // 并集别名非空才下发 notes:updateCharacter 是 {...char,...updates} 浅展开,
        // 无条件发 notes:undefined 会抹掉库内既有别名备注(1013 修:新手册把已知实体
        // 输出一行变成主流量,merged 更新的抹库自毁循环不再可回避)
        const notesValue = notesFromAliases(entity.aliases);
        characterSink.updateCharacter(entity.id, {
          ...(notesValue ? { notes: notesValue } : {}),
          status: "linked",
          // D11(10-19 C1 Step 10):不再覆盖 linkedEpisodeId——旧语义每批覆盖为
          // 最近章,首次出场信息被冲掉;库内值保持首晋升时写入的 firstChapterId。
        });
        characters.push({ characterId: entity.id, name: entity.name, aliases: entity.aliases, note: entity.note });
        merged += 1;
      }
      continue;
    }

    if (isKind(entity, "scene")) {
      if (entity.isNew || !entity.id) {
        const sceneId = sceneSink.addScene({
          name: entity.name,
          location: entity.name,
          time: "",
          atmosphere: "",
          projectId,
          folderId: ensureSceneFolder(),
          notes: entity.note ?? notesFromAliases(entity.aliases),
          status: "linked",
          linkedEpisodeId,
          assetName: formatAssetName(entity.name, entity.aliases),
        });
        scenes.push({ sceneId, name: entity.name, note: entity.note });
        created += 1;
      } else {
        sceneSink.updateScene(entity.id, {
          status: "linked",
          // D11:同角色,不再覆盖 linkedEpisodeId
        });
        scenes.push({ sceneId: entity.id, name: entity.name, note: entity.note });
        merged += 1;
      }
      continue;
    }

    // prop: 写入 propsLibraryStore；独立资产库只由资产库功能显式写入。
    if (sinks.propSink && (entity.isNew || !entity.id)) {
      const propId = sinks.propSink.addProp({
        name: entity.name,
        projectId,
        description: entity.note ?? "",
        assetName: formatAssetName(entity.name, entity.aliases),
      });
      props.push({ assetId: propId, name: entity.name, note: entity.note });
      created += 1;
    } else {
      const assetId = entity.id ?? `prop-${episodeId}-${props.length + 1}`;
      props.push({ assetId, name: entity.name, note: entity.note });
      if (entity.isNew || !entity.id) created += 1;
      else merged += 1;
    }
  }

  const result: EntityExtractionResult = {
    id: `entity-extract-${episodeId}-${Date.now()}`,
    episodeId,
    characters,
    scenes,
    props,
  };

  return { result, summary: { created, merged, deferred } };
}

/** Build sinks backed by the live MYStudio project stores. */
export function createMystudioSinks(): SyncSinks {
  return {
    characterSink: {
      addCharacter: (data) => {
        const id = useCharacterLibraryStore.getState().addCharacter({
          name: data.name,
          description: data.description,
          visualTraits: data.visualTraits,
          projectId: data.projectId,
          folderId: data.folderId,
          notes: data.notes,
          status: data.status,
          linkedEpisodeId: data.linkedEpisodeId,
          views: [],
        });
        return id;
      },
      updateCharacter: (id, updates) => useCharacterLibraryStore.getState().updateCharacter(id, updates),
      getOrCreateProjectFolder: (projectId, projectName) =>
        useCharacterLibraryStore.getState().getOrCreateProjectFolder(projectId, projectName),
    },
    sceneSink: {
      addScene: (data) => {
        const id = useSceneStore.getState().addScene({
          name: data.name,
          location: data.location,
          time: data.time,
          atmosphere: data.atmosphere,
          projectId: data.projectId,
          folderId: data.folderId,
          notes: data.notes,
          status: data.status,
          linkedEpisodeId: data.linkedEpisodeId,
        });
        return id;
      },
      updateScene: (id, updates) => useSceneStore.getState().updateScene(id, updates),
      getOrCreateProjectFolder: (projectId, projectName) =>
        useSceneStore.getState().getOrCreateProjectFolder(projectId, projectName),
    },
    propSink: {
      addProp: (data) => {
        const newProp = usePropsLibraryStore.getState().addProp({
          name: data.name,
          projectId: data.projectId,
          description: data.description || "",
          imageUrl: "",
          folderId: data.folderId ?? null,
          category: data.category,
        });
        return newProp.id;
      },
    },
  };
}
