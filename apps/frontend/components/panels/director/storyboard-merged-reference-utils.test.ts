import { describe, expect, it, vi } from "vitest";

import type { SplitScene } from "@/stores/director-store";
import type { MergedFrameTask } from "./storyboard-merged-grid-utils";
import {
  collectMergedFrameReferenceImages,
  collectOptimizedMergedFrameReferenceImages,
} from "./storyboard-merged-reference-utils";

function scene(id: number, overrides: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    sceneReferenceImage: `scene-${id}`,
    characterIds: [`character-${id}`],
    characterVariationMap: {},
    ...overrides,
  } as SplitScene;
}

describe("storyboard merged reference utils", () => {
  it("deduplicates scenes and caps minimal references", () => {
    const getCharacterReferenceImages = vi.fn((ids: string[]) => [`ref-${ids[0]}`, "shared"]);
    const firstScene = scene(1);
    const tasks: MergedFrameTask[] = [
      { scene: firstScene, type: "first" },
      { scene: firstScene, type: "end" },
      { scene: scene(2), type: "first" },
    ];

    const result = collectMergedFrameReferenceImages(tasks, {
      strategy: "minimal",
      getCharacterReferenceImages,
    });

    expect(result).toEqual(["scene-1", "ref-character-1"]);
    expect(getCharacterReferenceImages).toHaveBeenCalledTimes(2);
  });

  it("prioritizes exemplar anchors and end-frame scene references for identity models", () => {
    const tasks: MergedFrameTask[] = [{
      scene: scene(1, {
        imageDataUrl: "first-frame",
        endFrameImageUrl: "last-frame",
        endFrameSceneReferenceImage: "end-scene",
      }),
      type: "end",
    }];

    const result = collectOptimizedMergedFrameReferenceImages(tasks, {
      strategy: "cluster",
      model: "nano-banana-pro",
      exemplar: true,
      getCharacterReferenceImages: () => ["character-ref"],
    });

    expect(result).toEqual(["first-frame", "character-ref", "end-scene"]);
  });

  it("returns no references when the strategy is none", () => {
    const getCharacterReferenceImages = vi.fn();
    expect(collectMergedFrameReferenceImages([{ scene: scene(1), type: "first" }], {
      strategy: "none",
      getCharacterReferenceImages,
    })).toEqual([]);
    expect(getCharacterReferenceImages).not.toHaveBeenCalled();
  });
});
