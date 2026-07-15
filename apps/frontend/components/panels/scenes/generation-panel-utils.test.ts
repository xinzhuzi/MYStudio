import { describe, expect, it } from "vitest";
import {
  buildScenePrompt,
  buildContactSheetCopyText,
  buildAutoContactSheetPrompt,
  buildDirectUploadLayoutData,
  buildOrthographicPrompts,
  extractPropsFromActions,
  extractSpatialAssets,
  getLayoutDimensions,
  mapGridResultsToViewpoints,
  mapAutoContactSheetResults,
  mapOrthographicSplitResults,
} from "./generation-panel-utils";

describe("generation panel helpers", () => {
  it("deduplicates mapped props and keeps the established eight-item limit", () => {
    expect(extractPropsFromActions("饭桌餐桌旁有碗筷菜肴，沙发茶几电视书桌书柜床衣柜")).toEqual([
      "dining table",
      "bowls and chopsticks",
      "dishes of food",
      "sofa",
      "coffee table",
      "television",
      "desk",
      "bookshelf",
    ]);
  });

  it("builds the existing scene prompt with props and fallback style", () => {
    const prompt = buildScenePrompt(
      { location: "old apartment", time: "day", atmosphere: "peaceful" },
      ["饭桌上放着毕业证"],
    );

    expect(prompt).toContain("old apartment, with dining table, graduation certificate");
    expect(prompt).toContain("professional quality");
    expect(prompt).toContain("no characters");
  });

  it("maps supported contact-sheet layouts and split cells deterministically", () => {
    expect(getLayoutDimensions("2x2", "16:9")).toEqual({ rows: 2, cols: 2 });
    expect(getLayoutDimensions("3x3", "9:16")).toEqual({ rows: 3, cols: 3 });
    expect(mapGridResultsToViewpoints(
      [
        { row: 0, col: 1, dataUrl: "back.png" },
        { row: 1, col: 0, dataUrl: "left.png" },
      ],
      [
        { id: "view-back", gridIndex: 1 },
        { id: "view-left", gridIndex: 2 },
        { id: "view-missing", gridIndex: 3 },
      ],
      2,
    )).toEqual({
      "view-back": { imageUrl: "back.png", gridIndex: 1 },
      "view-left": { imageUrl: "left.png", gridIndex: 2 },
    });
  });

  it("builds copy metadata and direct-upload layout state deterministically", () => {
    expect(buildContactSheetCopyText({
      isEnglish: true,
      prompt: "scene prompt",
      styleId: "missing-style",
      aspectRatio: "16:9",
      layout: "2x2",
    })).toContain("Grid Layout: 2 rows x 2 cols (2x2)");
    const directUpload = buildDirectUploadLayoutData("3x3", "9:16");
    expect(directUpload.viewpoints).toHaveLength(9);
    expect(directUpload.pendingViewpoints[8]).toMatchObject({
      id: "viewpoint-9",
      pageIndex: 0,
      shotIndexes: [],
    });
    expect(directUpload.promptPage.gridLayout).toEqual({ rows: 3, cols: 3 });
  });

  it("wraps Chinese auto prompts with the per-page grid layout", () => {
    const prompt = buildAutoContactSheetPrompt({
      prompt: "旧书房的四个视角",
      styleId: "missing-style",
      aspectRatio: "16:9",
      layout: "3x3",
      pageLayout: { rows: 2, cols: 2 },
    });
    expect(prompt).toContain("2x2 storyboard grid with exactly 4 equal-sized panels");
    expect(prompt).toContain("旧书房的四个视角");
    expect(prompt).toContain("Negative constraints:");
  });

  it("maps auto results and creates fallback viewpoints when source mapping is absent", () => {
    const result = mapAutoContactSheetResults([
      { row: 0, col: 0, dataUrl: "one.png" },
      { row: 0, col: 1, dataUrl: "two.png" },
    ], [], 2, 123);
    expect(result.viewpoints.map((viewpoint) => viewpoint.id)).toEqual(["auto-vp-0-123", "auto-vp-1-123"]);
    expect(result.images).toEqual({
      "auto-vp-0-123": { imageUrl: "one.png", gridIndex: 0 },
      "auto-vp-1-123": { imageUrl: "two.png", gridIndex: 1 },
    });

    const fallback = mapAutoContactSheetResults([
      { row: 0, col: 0, dataUrl: "one.png" },
    ], [{ id: "missing", name: "缺失", nameEn: "Missing", shotIds: [], keyProps: [], gridIndex: 9 }], 2, 456);
    expect(fallback.viewpoints[0].id).toBe("fallback-vp-0-456");
    expect(fallback.images["fallback-vp-0-456"].imageUrl).toBe("one.png");
  });

  it("maps a 2x2 orthographic grid to the established cardinal views", () => {
    expect(mapOrthographicSplitResults([
      { row: 1, col: 1, dataUrl: "right.png" },
      { row: 0, col: 0, dataUrl: "front.png" },
      { row: 1, col: 0, dataUrl: "left.png" },
      { row: 0, col: 1, dataUrl: "back.png" },
    ])).toEqual({
      front: "front.png",
      back: "back.png",
      left: "left.png",
      right: "right.png",
    });
  });

  it("extracts the anchor and directional wall descriptions from scene text", () => {
    const result = extractSpatialAssets({
      id: "scene-1",
      name: "旧书房",
      location: "中央书桌，北侧窗户，南侧入口门",
      visualPrompt: "西侧书架，东侧装饰画",
      time: "day",
      atmosphere: "quiet",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(result.anchor).toBe("西侧书架");
    expect(result.walls).toEqual({
      north: "北侧窗户",
      south: "南侧入口门",
      west: "西侧书架",
      east: "东侧装饰画",
    });
  });

  it("builds orthographic prompts with the established cardinal wall mapping", () => {
    const { prompt, promptZh } = buildOrthographicPrompts({
      id: "scene-1",
      name: "旧书房",
      location: "中央书桌，北侧窗户，南侧入口门",
      visualPrompt: "西侧书架，东侧装饰画",
      time: "day",
      atmosphere: "quiet",
      createdAt: 1,
      updatedAt: 1,
    }, "missing-style");

    expect(prompt).toContain("Front View");
    expect(prompt).toContain("featuring 南侧入口门");
    expect(prompt).toContain("featuring 北侧窗户");
    expect(prompt).toContain("strictly featuring 东侧装饰画");
    expect(prompt).toContain("strictly featuring 西侧书架");
    expect(promptZh).toContain("动画风格");
  });
});
