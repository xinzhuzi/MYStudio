import { describe, expect, it } from "vitest";
import { compareToonflowFixtureToStoryboards } from "./toonflow-fixture-parity";
import type { StoryboardItem } from "@/types/studio";

describe("toonflow fixture parity", () => {
  it("matches deterministic Toonflow storyboard rows and defers golden image comparison", () => {
    const report = compareToonflowFixtureToStoryboards({
      storyboardRows: [fixtureRow()],
    }, [storyboard()]);

    expect(report).toMatchObject({
      enabled: true,
      storyboardRows: 1,
      matchedRows: 1,
      promptMismatches: 0,
      referenceOrderMismatches: 0,
      imagePathMissing: 0,
      goldenImageComparisonStatus: "deferred",
    });
    expect(report.issues.map((issue) => issue.code)).toContain("toonflow.goldenImage.deferred");
  });

  it("flags prompt, reference order, and image path mismatches", () => {
    const report = compareToonflowFixtureToStoryboards({
      storyboardRows: [fixtureRow()],
    }, [
        {
          ...storyboard(),
          prompt: "错误提示词",
          orderedReferenceManifest: [
            { order: 1, assetId: "scene-1", imagePath: "/toonflow/scene.png" },
            { order: 2, assetId: "char-1" },
          ],
        },
      ]);

    expect(report.promptMismatches).toBe(1);
    expect(report.referenceOrderMismatches).toBe(1);
    expect(report.imagePathMissing).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "toonflow.storyboard.promptMismatch",
        "toonflow.references.orderMismatch",
        "toonflow.images.pathMissing",
      ]),
    );
  });

  it("flags count and video description mismatches", () => {
    const report = compareToonflowFixtureToStoryboards({
      storyboardRows: [fixtureRow(), { ...fixtureRow(), id: 2, index: 2 }],
    }, [
        {
          ...storyboard(),
          videoDesc: "错误视频描述",
        },
      ]);

    expect(report.storyboardRows).toBe(2);
    expect(report.matchedRows).toBe(1);
    expect(report.videoDescMismatches).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "toonflow.storyboard.countMismatch",
        "toonflow.storyboard.videoDescMismatch",
      ]),
    );
  });

  it("accepts a content-addressed golden image fixture with a verified pixel digest", () => {
    const report = compareToonflowFixtureToStoryboards({
      storyboardRows: [{
        ...fixtureRow(),
        goldenImage: {
          relativePath: "golden/abc.png",
          sha256: "a".repeat(64),
          pixelSha256: "b".repeat(64),
          verified: true,
        },
      }],
    }, [storyboard()]);

    expect(report.goldenImageComparisonStatus).toBe("passed");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ code: "toonflow.goldenImage.deferred" }),
    );
  });
});

function fixtureRow() {
  return {
    id: 1,
    index: 1,
    prompt: "@图1 独孤剑尘站在 @图2 雨巷。",
    videoDesc: "独孤剑尘雨夜入镇",
    referenceAssetIds: ["char-1", "scene-1"],
    referenceImagePaths: ["/toonflow/char.png", "/toonflow/scene.png"],
    shouldGenerateImage: true,
  };
}

function storyboard(): StoryboardItem {
  return {
    id: "shot-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 5,
    prompt: "@图1 独孤剑尘站在 @图2 雨巷。",
    videoDesc: "独孤剑尘雨夜入镇",
    assetIds: ["char-1", "scene-1"],
    state: "ready",
    orderedReferenceManifest: [
      { order: 1, assetId: "char-1", imagePath: "/toonflow/char.png" },
      { order: 2, assetId: "scene-1", imagePath: "/toonflow/scene.png" },
    ],
  };
}
