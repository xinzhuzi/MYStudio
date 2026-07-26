import { describe, expect, it } from "vitest";
import type { AssetRef, ShotGroup } from "@/stores/sclass/sclass-store";
import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { SplitScene } from "@/stores/director/director-store";
import {
  collectAllRefs,
  collectCharacterRefs,
  collectFirstFrameRefs,
  collectSceneRefs,
} from "./sclass-reference-collector";

function ref(id: string, type: AssetRef["type"]): AssetRef {
  return {
    id,
    type,
    tag: "@未编号",
    localUrl: `${id}.bin`,
    httpUrl: null,
    fileName: `${id}.bin`,
    fileSize: 0,
    duration: null,
    purpose: type === "video" ? "video_ref" : type === "audio" ? "audio_ref" : "grid_image",
  } as AssetRef;
}

describe("S-Class reference collection", () => {
  it("deduplicates character and scene references while preserving source priority", () => {
    const characters = [{
      id: "char-1",
      name: "剑客",
      views: [{ imageBase64: "base64-character", imageUrl: "url-character" }],
      thumbnailUrl: "thumb-character",
    }] as unknown as Character[];
    const scenes = [
      { id: 1, characterIds: ["char-1", "char-1"], sceneReferenceImage: "direct-scene", imageDataUrl: "frame-1", sceneName: "山门" },
      { id: 2, characterIds: ["char-1"], sceneLibraryId: "library-1", imageHttpUrl: "frame-2", sceneName: "殿内" },
      { id: 3, sceneLibraryId: "library-1" },
    ] as unknown as SplitScene[];
    const sceneLibrary = [{ id: "library-1", name: "殿内", referenceImageBase64: "library-base64" }] as Scene[];

    expect(collectCharacterRefs(["char-1", "char-1"], characters)).toEqual([
      expect.objectContaining({ id: "char_char-1", localUrl: "base64-character", purpose: "character_ref" }),
    ]);
    expect(collectSceneRefs(scenes, sceneLibrary)).toEqual([
      expect.objectContaining({ id: "scene_ref_1", localUrl: "direct-scene" }),
      expect.objectContaining({ id: "scene_lib_library-1", localUrl: "library-base64" }),
    ]);
    expect(collectFirstFrameRefs(scenes).map(({ localUrl }) => localUrl)).toEqual(["frame-1", "frame-2"]);
  });

  it("reserves one grid slot, clamps each media kind, and renumbers tags", () => {
    const characters = Array.from({ length: 10 }, (_, index) => ({
      id: `char-${index}`,
      name: `角色${index}`,
      views: [{ imageUrl: `char-${index}.png` }],
    })) as unknown as Character[];
    const scenes = [{ id: 1, characterIds: characters.map(({ id }) => id) }] as unknown as SplitScene[];
    const group = {
      videoRefs: Array.from({ length: 4 }, (_, index) => ref(`video-${index}`, "video")),
      audioRefs: Array.from({ length: 4 }, (_, index) => ref(`audio-${index}`, "audio")),
    } as ShotGroup;

    const result = collectAllRefs(group, scenes, characters, [], ref("grid", "image"));
    expect(result.images).toHaveLength(9);
    expect(result.videos).toHaveLength(3);
    expect(result.audios).toHaveLength(3);
    expect(result.images.map(({ tag }) => tag)).toEqual(Array.from({ length: 9 }, (_, index) => `@图片${index + 1}`));
    expect(result.totalFiles).toBe(15);
    expect(result.overLimit).toBe(true);
    expect(result.limitWarnings).toEqual(["图片引用已达上限 9", "总文件数 15 超出限制 12"]);
  });
});
