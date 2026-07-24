import { afterEach, describe, expect, it } from "vitest";
import { mergeCharData, splitCharData, useCharacterLibraryStore } from "./character-library-store";
import type { Character, CharacterFolder } from "./character-library-store";

const folder = (id: string, projectId?: string): CharacterFolder => ({
  id,
  name: id,
  parentId: null,
  ...(projectId ? { projectId } : {}),
  createdAt: 1,
});

const character = (id: string, projectId?: string): Character => ({
  id,
  name: id,
  description: "description",
  visualTraits: "traits",
  ...(projectId ? { projectId } : {}),
  views: [{ viewType: "front", imageUrl: "https://image", imageBase64: "data:image/png;base64,view", generatedAt: 1 }],
  variations: [{ id: "variation", name: "daily", visualPrompt: "prompt", clothingReferenceImages: ["base64"] }],
  referenceImages: ["base64"],
  createdAt: 1,
  updatedAt: 1,
});

describe("character library persistence characterization", () => {
  afterEach(() => {
    useCharacterLibraryStore.getState().reset();
  });

  it("splits project-owned records from shared records and preserves project folder selection", () => {
    const state = {
      folders: [folder("project-folder", "p1"), folder("shared-folder")],
      characters: [character("project-character", "p1"), character("shared-character")],
      currentFolderId: "project-folder",
    };

    expect(splitCharData(state, "p1")).toEqual({
      projectData: { folders: [state.folders[0]], characters: [state.characters[0]], currentFolderId: "project-folder" },
      sharedData: { folders: [state.folders[1]], characters: [state.characters[1]], currentFolderId: null },
    });
  });

  it("merges shared data before project data and tolerates legacy null payloads", () => {
    expect(mergeCharData(
      { folders: [folder("p")], characters: [character("p")], currentFolderId: "p" },
      { folders: [folder("s")], characters: [character("s")], currentFolderId: null },
    )).toEqual({
      folders: [folder("s"), folder("p")],
      characters: [character("s"), character("p")],
      currentFolderId: "p",
    });
    expect(mergeCharData(null, null)).toEqual({ folders: [], characters: [], currentFolderId: null });
  });

  it("partializes persisted characters without base64 references while retaining view and variation fields", () => {
    const partialize = useCharacterLibraryStore.persist.getOptions().partialize!;
    const result = partialize({
      ...useCharacterLibraryStore.getState(),
      folders: [folder("shared-folder")],
      characters: [character("hero")],
      currentFolderId: "shared-folder",
    }) as { characters: Character[] };
    const persisted = result.characters[0];
    expect(persisted.referenceImages).toBeUndefined();
    expect(persisted.views).toEqual([{ viewType: "front", imageUrl: "https://image", generatedAt: 1 }]);
    expect(JSON.stringify(persisted.views)).not.toContain("imageBase64");
    expect(persisted.variations[0]).toMatchObject({ id: "variation", name: "daily", visualPrompt: "prompt" });
    expect(persisted.variations[0].clothingReferenceImages).toBeUndefined();
  });

  it("merge option keeps current state when persisted payload is absent and accepts legacy partial payloads", () => {
    const merge = useCharacterLibraryStore.persist.getOptions().merge!;
    const current = useCharacterLibraryStore.getState();
    expect(merge(undefined, current)).toBe(current);
    expect(merge({ characters: [character("legacy")] }, current)).toMatchObject({ characters: [character("legacy")], folders: current.folders });
  });

  it("persists a stage variation under its base character", () => {
    const store = useCharacterLibraryStore.getState();
    const characterId = store.addCharacter({
      name: "谢乘风",
      description: "剑客",
      visualTraits: "swordsman",
      views: [],
    });
    const variationId = store.addVariation(characterId, {
      name: "青年期",
      visualPrompt: "剑眉, 修长, 青年剑客",
      isStageVariation: true,
      episodeRange: [3, 8],
      ageDescription: "25岁",
      stageDescription: "青年期",
    });

    expect(store.getCharacterById(characterId)?.variations).toEqual([expect.objectContaining({
      id: variationId,
      name: "青年期",
      isStageVariation: true,
      episodeRange: [3, 8],
      ageDescription: "25岁",
      stageDescription: "青年期",
    })]);
  });
});
