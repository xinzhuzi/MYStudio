import { describe, expect, it, vi } from "vitest";
import {
  calculateGrid,
  getRecommendedResolution,
  validateSceneCount,
} from "./grid-calculator";

describe("storyboard grid calculator", () => {
  it("uses one full canvas cell for empty and single-scene inputs", () => {
    expect(calculateGrid({ sceneCount: 0, aspectRatio: "16:9", resolution: "2K" })).toMatchObject({
      cols: 1,
      rows: 1,
      canvasWidth: 1920,
      canvasHeight: 1080,
      totalCells: 1,
      emptyCells: 1,
    });

    expect(calculateGrid({ sceneCount: 1, aspectRatio: "9:16", resolution: "2K" })).toMatchObject({
      cols: 1,
      rows: 1,
      canvasWidth: 1080,
      canvasHeight: 1920,
      emptyCells: 0,
    });
  });

  it("uses predefined balanced layouts for common scene counts", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(calculateGrid({ sceneCount: 4, aspectRatio: "16:9", resolution: "2K" })).toMatchObject({
      cols: 2,
      rows: 2,
      totalCells: 4,
      emptyCells: 0,
    });
    expect(calculateGrid({ sceneCount: 12, aspectRatio: "9:16", resolution: "4K" })).toMatchObject({
      cols: 3,
      rows: 4,
      canvasWidth: 2160,
      canvasHeight: 3840,
      totalCells: 12,
      emptyCells: 0,
    });

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("calculates dynamic layouts for non-predefined counts without underallocating cells", () => {
    const landscape = calculateGrid({ sceneCount: 13, aspectRatio: "16:9", resolution: "4K" });
    expect(landscape.totalCells).toBeGreaterThanOrEqual(13);
    expect(landscape.emptyCells).toBe(landscape.totalCells - 13);
    expect(landscape.cols).toBeGreaterThanOrEqual(landscape.rows);

    const portrait = calculateGrid({ sceneCount: 13, aspectRatio: "9:16", resolution: "4K" });
    expect(portrait.totalCells).toBeGreaterThanOrEqual(13);
    expect(portrait.emptyCells).toBe(portrait.totalCells - 13);
    expect(portrait.rows).toBeGreaterThanOrEqual(portrait.cols);
  });

  it("validates resolution-specific scene limits and recommends the smallest fitting resolution", () => {
    expect(validateSceneCount(12, "2K")).toEqual({ isValid: true, limit: 12, message: "" });
    expect(validateSceneCount(13, "2K")).toMatchObject({
      isValid: false,
      limit: 12,
    });

    expect(getRecommendedResolution(12)).toBe("2K");
    expect(getRecommendedResolution(13)).toBe("4K");
  });
});
