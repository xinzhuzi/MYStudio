import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { ScriptCharacter, ScriptScene, Shot } from "@/types/script";

import {
  findQuickSceneViewpointMatch,
  mapScriptCharactersToLibraryIds,
} from "./director-context-mapping";

const libraryCharacter = (id: string, name: string): Character => ({
  id,
  name,
  description: "",
  visualTraits: "",
  views: [],
  variations: [],
  createdAt: 1,
  updatedAt: 1,
});

const libraryScene = (overrides: Partial<Scene>): Scene => ({
  id: "scene-library",
  name: "雨夜法坛",
  location: "法坛",
  time: "夜",
  atmosphere: "肃杀",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const scriptScene: ScriptScene = {
  id: "scene-1",
  name: "雨夜法坛",
  location: "法坛",
  time: "夜",
  atmosphere: "肃杀",
};

const shot: Shot = {
  id: "shot-1",
  index: 1,
  sceneRefId: "scene-1",
  actionSummary: "举起火把",
  characterIds: [],
  characterVariations: {},
  imageStatus: "idle",
  imageProgress: 0,
  videoStatus: "idle",
  videoProgress: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapScriptCharactersToLibraryIds", () => {
  it("prefers valid linked ids and deduplicates supplemental name matches", () => {
    const scriptCharacters: ScriptCharacter[] = [
      { id: "script-zhaosi", name: "赵四", characterLibraryId: "library-zhaosi" },
    ];
    const libraryCharacters = [libraryCharacter("library-zhaosi", "赵四")];

    expect(mapScriptCharactersToLibraryIds({
      scriptCharacterIds: ["script-zhaosi"],
      characterNames: ["赵四"],
      scriptCharacters,
      libraryCharacters,
    })).toEqual(["library-zhaosi"]);
  });

  it("falls back from an invalid linked id and supports exact/fuzzy names", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scriptCharacters: ScriptCharacter[] = [
      { id: "script-zhaosi", name: "赵四", characterLibraryId: "missing" },
    ];
    const libraryCharacters = [
      libraryCharacter("library-zhaosi", "赵四"),
      libraryCharacter("library-worker", "小杂役少年"),
    ];

    expect(mapScriptCharactersToLibraryIds({
      scriptCharacterIds: ["script-zhaosi"],
      characterNames: ["小杂役", ""],
      scriptCharacters,
      libraryCharacters,
    })).toEqual(["library-zhaosi", "library-worker"]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid characterLibraryId "missing"'),
    );
  });
});

describe("findQuickSceneViewpointMatch", () => {
  it("returns null without a matching parent and falls back to a parent without variants", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(findQuickSceneViewpointMatch({
      shot,
      scene: scriptScene,
      sceneLibraryScenes: [],
    })).toBeNull();

    expect(findQuickSceneViewpointMatch({
      shot,
      scene: scriptScene,
      sceneLibraryScenes: [libraryScene({ referenceImage: "parent.png" })],
    })).toEqual(expect.objectContaining({
      sceneLibraryId: "scene-library",
      sceneReferenceImage: "parent.png",
      matchMethod: "fallback",
      confidence: 0.5,
    }));
  });

  it("prioritizes variant shot ids over script viewpoint names", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scene = {
      ...scriptScene,
      viewpoints: [{
        id: "script-window",
        name: "窗边",
        nameEn: "Window",
        shotIds: ["shot-1"],
        keyProps: [],
        gridIndex: 0,
      }],
    };
    const parent = libraryScene({ id: "parent" });
    const direct = libraryScene({
      id: "direct",
      parentSceneId: "parent",
      viewpointId: "door",
      viewpointName: "门口",
      shotIds: ["shot-1"],
      createdAt: 2,
    });
    const named = libraryScene({
      id: "named",
      parentSceneId: "parent",
      viewpointId: "window",
      viewpointName: "窗边",
      createdAt: 1,
    });

    expect(findQuickSceneViewpointMatch({
      shot,
      scene,
      sceneLibraryScenes: [parent, direct, named],
    })).toEqual(expect.objectContaining({
      sceneLibraryId: "direct",
      viewpointId: "door",
      confidence: 0.98,
    }));
  });

  it("uses script viewpoint linkage before cycling by shot index", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const parent = libraryScene({ id: "parent" });
    const first = libraryScene({
      id: "first",
      parentSceneId: "parent",
      viewpointId: "door",
      viewpointName: "门口",
      createdAt: 1,
    });
    const second = libraryScene({
      id: "second",
      parentSceneId: "parent",
      viewpointId: "window",
      viewpointName: "窗边区域",
      createdAt: 2,
    });
    const sceneWithViewpoint: ScriptScene = {
      ...scriptScene,
      viewpoints: [{
        id: "script-window",
        name: "窗边",
        nameEn: "Window",
        shotIds: ["shot-1"],
        keyProps: [],
        gridIndex: 0,
      }],
    };

    expect(findQuickSceneViewpointMatch({
      shot,
      scene: sceneWithViewpoint,
      sceneLibraryScenes: [parent, first, second],
      shotIndexInScene: 4,
    })).toEqual(expect.objectContaining({
      sceneLibraryId: "second",
      confidence: 0.95,
    }));

    expect(findQuickSceneViewpointMatch({
      shot: { ...shot, id: "unlinked" },
      scene: scriptScene,
      sceneLibraryScenes: [parent, first, second],
      shotIndexInScene: 3,
    })).toEqual(expect.objectContaining({
      sceneLibraryId: "second",
      confidence: 0.9,
    }));
  });
});
