import type { DedupedEntity, EntityKind } from "@/lib/studio/entity-extraction";
import type { EntityExtractionResult } from "@/types/studio";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";

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
  }) => string;
  updateScene: (id: string, updates: Record<string, unknown>) => void;
  getOrCreateProjectFolder: (projectId: string, projectName: string) => string;
}

export interface SyncExtractedEntitiesInput {
  episodeId: string;
  entities: DedupedEntity[];
  projectId: string;
  projectName: string;
}

export interface SyncSinks {
  characterSink: CharacterSink;
  sceneSink: SceneSink;
}

export interface SyncSummary {
  created: number;
  merged: number;
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

  let charFolderId: string | null = null;
  let sceneFolderId: string | null = null;
  const ensureCharFolder = () =>
    (charFolderId ??= characterSink.getOrCreateProjectFolder(projectId, projectName));
  const ensureSceneFolder = () =>
    (sceneFolderId ??= sceneSink.getOrCreateProjectFolder(projectId, projectName));

  for (const entity of entities) {
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
          linkedEpisodeId: episodeId,
        });
        characters.push({ characterId, name: entity.name, aliases: entity.aliases, note: entity.note });
        created += 1;
      } else {
        characterSink.updateCharacter(entity.id, {
          notes: notesFromAliases(entity.aliases),
          status: "linked",
          linkedEpisodeId: episodeId,
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
          linkedEpisodeId: episodeId,
        });
        scenes.push({ sceneId, name: entity.name, note: entity.note });
        created += 1;
      } else {
        sceneSink.updateScene(entity.id, {
          status: "linked",
          linkedEpisodeId: episodeId,
        });
        scenes.push({ sceneId: entity.id, name: entity.name, note: entity.note });
        merged += 1;
      }
      continue;
    }

    // prop: lightweight, no dedicated store (plan §二 待确认点)
    const assetId = entity.id ?? `prop-${episodeId}-${props.length + 1}`;
    props.push({ assetId, name: entity.name, note: entity.note });
    if (entity.isNew || !entity.id) created += 1;
    else merged += 1;
  }

  const result: EntityExtractionResult = {
    id: `entity-extract-${episodeId}-${Date.now()}`,
    episodeId,
    characters,
    scenes,
    props,
  };

  return { result, summary: { created, merged } };
}

/** Build sinks backed by the live MYStudio stores (character/scene libraries). */
export function createMystudioSinks(): SyncSinks {
  return {
    characterSink: {
      addCharacter: (data) =>
        useCharacterLibraryStore.getState().addCharacter({ ...data, views: [] }),
      updateCharacter: (id, updates) => useCharacterLibraryStore.getState().updateCharacter(id, updates),
      getOrCreateProjectFolder: (projectId, projectName) =>
        useCharacterLibraryStore.getState().getOrCreateProjectFolder(projectId, projectName),
    },
    sceneSink: {
      addScene: (data) => useSceneStore.getState().addScene(data),
      updateScene: (id, updates) => useSceneStore.getState().updateScene(id, updates),
      getOrCreateProjectFolder: (projectId, projectName) =>
        useSceneStore.getState().getOrCreateProjectFolder(projectId, projectName),
    },
  };
}
