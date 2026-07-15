import { describe, expect, it } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import {
  buildMergedFrameTasks,
  calculateMergedGridAspectRatio,
  calculateMergedGridLayout,
  paginateMergedFrameTasks,
} from "./storyboard-merged-grid-utils";

function scene(id: number, updates: Partial<SplitScene> = {}): SplitScene {
  return { id, needsEndFrame: true, ...updates } as SplitScene;
}

describe("storyboard merged grid utils", () => {
  it("builds mixed first/end tasks and skips completed video scenes", () => {
    expect(buildMergedFrameTasks([
      scene(1),
      scene(2, { imageDataUrl: "first.png" }),
      scene(3, { videoStatus: "completed" }),
      scene(4, { needsEndFrame: false }),
    ], "both").map((task) => [task.scene.id, task.type])).toEqual([
      [1, "first"],
      [1, "end"],
      [2, "end"],
      [4, "first"],
    ]);
  });

  it("paginates at nine tasks and keeps square grid contracts", () => {
    const tasks = buildMergedFrameTasks(
      Array.from({ length: 6 }, (_, index) => scene(index + 1)),
      "both",
    );
    expect(paginateMergedFrameTasks(tasks).map((page) => page.length)).toEqual([9, 3]);
    expect(calculateMergedGridLayout(4)).toEqual({ cols: 2, rows: 2, paddedCount: 4 });
    expect(calculateMergedGridLayout(5)).toEqual({ cols: 3, rows: 3, paddedCount: 9 });
    expect(calculateMergedGridAspectRatio("9:16")).toBe("9:16");
  });
});
