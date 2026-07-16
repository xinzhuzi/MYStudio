import { describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import type { ShotGroup } from "@/stores/sclass-store";
import type { GroupPromptResult } from "./sclass-prompt-builder";
import {
  deriveSClassGroupGenerationFlags,
  prepareSClassGroupGeneration,
} from "./sclass-generation-prep";

const group = {
  id: "group-1",
  name: "第一组",
  sceneIds: [1, 2],
  totalDuration: 10,
  generationType: "new",
} as ShotGroup;

const promptResult = {
  prompt: "prepared prompt",
  charCount: 15,
  overCharLimit: false,
  refs: { images: [], videos: [], audios: [], totalFiles: 0, overLimit: false, limitWarnings: [] },
  shotSegments: [],
  dialogueSegments: [],
} satisfies GroupPromptResult;

const staticScenes = [
  { id: 1, imageDataUrl: "frame-1", cameraMovement: "Static", dialogue: "台词" },
  { id: 2, imageHttpUrl: "frame-2", cameraMovement: "固定" },
] as unknown as SplitScene[];

describe("sclass generation preparation", () => {
  it("derives audio, lip-sync, and static-camera flags", () => {
    expect(deriveSClassGroupGenerationFlags(group, staticScenes)).toEqual({
      isExtendOrEdit: false,
      enableAudio: true,
      enableLipSync: true,
      allStaticCamera: true,
    });
    expect(deriveSClassGroupGenerationFlags(group, [
      { id: 1, cameraMovement: "pan", audioDialogueEnabled: false, audioAmbientEnabled: false, audioSfxEnabled: false },
    ] as SplitScene[])).toEqual({
      isExtendOrEdit: false,
      enableAudio: false,
      enableLipSync: false,
      allStaticCamera: false,
    });
  });

  it("reuses only an exact ordered grid cache", async () => {
    const mergeGridImage = vi.fn(async () => "merged-grid");
    const buildPrompt = vi.fn(() => promptResult);

    const preparation = await prepareSClassGroupGeneration({
      group,
      scenes: staticScenes,
      characters: [],
      sceneLibrary: [],
      aspectRatio: "16:9",
      defaultDuration: 5,
      cachedGridUrl: "https://cache.test/grid.png",
      cachedSceneIds: [1, 2],
    }, { mergeGridImage, buildPrompt });

    expect(mergeGridImage).not.toHaveBeenCalled();
    expect(preparation.gridImageRef).toEqual(expect.objectContaining({
      localUrl: "https://cache.test/grid.png",
      httpUrl: "https://cache.test/grid.png",
      purpose: "grid_image",
    }));
    expect(buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      enableLipSync: true,
      gridImageRef: preparation.gridImageRef,
    }));
    expect(preparation.prompt).toBe("prepared prompt");
    expect(preparation.duration).toBe(10);
  });

  it("merges mismatched grids but skips grid work for extend/edit groups", async () => {
    const mergeGridImage = vi.fn(async () => "data:image/png;base64,merged");
    const buildPrompt = vi.fn(() => ({ ...promptResult, prompt: "" }));

    const fresh = await prepareSClassGroupGeneration({
      group,
      scenes: staticScenes,
      characters: [],
      sceneLibrary: [],
      aspectRatio: "9:16",
      defaultDuration: 5,
      cachedGridUrl: "stale-grid",
      cachedSceneIds: [2, 1],
    }, { mergeGridImage, buildPrompt });
    expect(mergeGridImage).toHaveBeenCalledWith(["frame-1", "frame-2"], "9:16");
    expect(fresh.gridImageRef?.httpUrl).toBeNull();
    expect(fresh.prompt).toBe("Multi-shot video: 第一组");

    const extended = await prepareSClassGroupGeneration({
      group: { ...group, generationType: "extend" },
      scenes: staticScenes,
      characters: [],
      sceneLibrary: [],
      aspectRatio: "16:9",
      defaultDuration: 5,
    }, { mergeGridImage, buildPrompt });
    expect(extended.isExtendOrEdit).toBe(true);
    expect(extended.gridImageRef).toBeNull();
    expect(mergeGridImage).toHaveBeenCalledTimes(1);
  });
});
