import { migrateFromLocalStorage } from "@/lib/indexed-db-storage";
import type {
  Character,
  CharacterFolder,
  CharacterVariation,
} from "./character-library-store";

export type CharPersistedState = {
  folders: CharacterFolder[];
  characters: Character[];
  currentFolderId: string | null;
};

export type CharacterLibraryStateLike = {
  characters: Character[];
  folders: CharacterFolder[];
  currentFolderId: string | null;
};

export function splitCharData(state: CharPersistedState, pid: string) {
  return {
    projectData: {
      folders: state.folders.filter((folder) => folder.projectId === pid),
      characters: state.characters.filter((character) => character.projectId === pid),
      currentFolderId: state.currentFolderId,
    },
    sharedData: {
      folders: state.folders.filter((folder) => !folder.projectId),
      characters: state.characters.filter((character) => !character.projectId),
      currentFolderId: null,
    },
  };
}

export function mergeCharData(
  projectData: CharPersistedState | null,
  sharedData: CharPersistedState | null,
): CharPersistedState {
  return {
    folders: [
      ...(sharedData?.folders ?? []),
      ...(projectData?.folders ?? []),
    ],
    characters: [
      ...(sharedData?.characters ?? []),
      ...(projectData?.characters ?? []),
    ],
    currentFolderId: projectData?.currentFolderId ?? null,
  };
}

export function partializeCharacterLibrary<T extends CharacterLibraryStateLike>(state: T) {
  return {
    folders: state.folders,
    currentFolderId: state.currentFolderId,
    characters: state.characters.map((character) => ({
      ...character,
      // Reference images and clothing images are base64 and recreated at runtime.
      referenceImages: undefined,
      views: character.views.map((view) => ({
        viewType: view.viewType,
        imageUrl: view.imageUrl,
        generatedAt: view.generatedAt,
      })),
      variations: (character.variations || []).map((variation: CharacterVariation) => ({
        id: variation.id,
        name: variation.name,
        visualPrompt: variation.visualPrompt,
        visualPromptZh: variation.visualPromptZh,
        referenceImage: variation.referenceImage,
        imageWorkflowId: variation.imageWorkflowId,
        imageWorkflowNodeId: variation.imageWorkflowNodeId,
        generatedAt: variation.generatedAt,
        isStageVariation: variation.isStageVariation,
        episodeRange: variation.episodeRange,
        ageDescription: variation.ageDescription,
        stageDescription: variation.stageDescription,
      })),
    })),
  };
}

export function mergeCharacterLibrary<T extends CharacterLibraryStateLike>(persisted: unknown, current: T): T {
  if (!persisted) return current;

  const data = persisted as {
    folders?: CharacterFolder[];
    characters?: Character[];
    currentFolderId?: string | null;
  };
  if (data.characters?.length) {
    const varSummary = data.characters.map((character) => ({
      name: character.name,
      pid: character.projectId?.substring(0, 8),
      vars: (character.variations || []).length,
      varNames: (character.variations || []).map((variation) => variation.name),
    }));
    console.log("[CharStore] merge: persisted characters →", JSON.stringify(varSummary));
  }
  return {
    ...current,
    folders: data.folders ?? current.folders,
    characters: data.characters ?? current.characters,
    currentFolderId: data.currentFolderId ?? current.currentFolderId,
  } as T;
}

export function onCharacterLibraryRehydrate(
  state: unknown,
  error?: unknown,
): void {
  if (error) {
    console.error("Failed to rehydrate character library:", error);
  } else if (state) {
    const characters = (state as { characters?: Character[] }).characters ?? [];
    const varSummary = characters.map((character) => ({
      name: character.name,
      vars: (character.variations || []).length,
      varNames: (character.variations || []).map((variation) => variation.name),
      varRefs: (character.variations || []).map((variation) => variation.referenceImage ? "✓" : "✗"),
    }));
    console.log(`[CharStore] rehydrated: ${characters.length} chars →`, JSON.stringify(varSummary));
  }
  migrateFromLocalStorage("mystudio-character-library");
}
