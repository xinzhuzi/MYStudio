import type { StoryboardItem } from "@/types/studio";

export interface ToonflowFixtureStoryboardRow {
  id: string | number;
  index: number;
  prompt: string;
  videoDesc: string;
  referenceAssetIds: Array<string | number>;
  referenceImagePaths: string[];
  shouldGenerateImage?: boolean;
}

export interface ToonflowStoryboardFixture {
  storyboardRows: ToonflowFixtureStoryboardRow[];
}

export interface ToonflowFixtureParityIssue {
  code:
    | "toonflow.storyboard.countMismatch"
    | "toonflow.storyboard.promptMismatch"
    | "toonflow.storyboard.videoDescMismatch"
    | "toonflow.references.orderMismatch"
    | "toonflow.images.pathMissing"
    | "toonflow.goldenImage.deferred";
  message: string;
  storyboardIndex?: number;
}

export interface ToonflowFixtureParityReport {
  enabled: boolean;
  storyboardRows: number;
  matchedRows: number;
  promptMismatches: number;
  videoDescMismatches: number;
  referenceOrderMismatches: number;
  imagePathMissing: number;
  goldenImageComparisonStatus: "passed" | "failed" | "deferred";
  goldenImageBlocker?: string;
  issues: ToonflowFixtureParityIssue[];
}

export function compareToonflowFixtureToStoryboards(
  fixture: ToonflowStoryboardFixture | undefined,
  storyboards: StoryboardItem[],
): ToonflowFixtureParityReport {
  if (!fixture) {
    return {
      enabled: false,
      storyboardRows: 0,
      matchedRows: 0,
      promptMismatches: 0,
      videoDescMismatches: 0,
      referenceOrderMismatches: 0,
      imagePathMissing: 0,
      goldenImageComparisonStatus: "deferred",
      issues: [],
    };
  }
  const byIndex = new Map(storyboards.map((item) => [item.index, item]));
  const issues: ToonflowFixtureParityIssue[] = [];
  let matchedRows = 0;
  let promptMismatches = 0;
  let videoDescMismatches = 0;
  let referenceOrderMismatches = 0;
  let imagePathMissing = 0;

  if (fixture.storyboardRows.length !== storyboards.length) {
    issues.push({
      code: "toonflow.storyboard.countMismatch",
      message: `Toonflow fixture rows=${fixture.storyboardRows.length}, MYStudio rows=${storyboards.length}.`,
    });
  }

  for (const row of fixture.storyboardRows) {
    const storyboard = byIndex.get(row.index);
    if (!storyboard) continue;
    matchedRows += 1;
    if (normalize(row.prompt) !== normalize(storyboard.prompt)) {
      promptMismatches += 1;
      issues.push({
        code: "toonflow.storyboard.promptMismatch",
        message: `Storyboard ${row.index} prompt differs from Toonflow fixture.`,
        storyboardIndex: row.index,
      });
    }
    if (normalize(row.videoDesc) !== normalize(storyboard.videoDesc)) {
      videoDescMismatches += 1;
      issues.push({
        code: "toonflow.storyboard.videoDescMismatch",
        message: `Storyboard ${row.index} videoDesc differs from Toonflow fixture.`,
        storyboardIndex: row.index,
      });
    }

    const expectedRefs = row.referenceAssetIds.map(String);
    const actualRefs = (storyboard.orderedReferenceManifest ?? []).map((item) => String(item.assetId));
    if (expectedRefs.join("|") !== actualRefs.join("|")) {
      referenceOrderMismatches += 1;
      issues.push({
        code: "toonflow.references.orderMismatch",
        message: `Storyboard ${row.index} reference order differs from Toonflow fixture.`,
        storyboardIndex: row.index,
      });
    }

    const actualPaths = new Set((storyboard.orderedReferenceManifest ?? []).map((item) => item.imagePath).filter(Boolean));
    const missingPaths = row.referenceImagePaths.filter((path) => !actualPaths.has(path));
    if (missingPaths.length) {
      imagePathMissing += missingPaths.length;
      issues.push({
        code: "toonflow.images.pathMissing",
        message: `Storyboard ${row.index} is missing Toonflow image paths: ${missingPaths.join(", ")}`,
        storyboardIndex: row.index,
      });
    }
  }

  issues.push({
    code: "toonflow.goldenImage.deferred",
    message: "Golden image pixel comparison is deferred until portable Toonflow OSS fixture ownership is stable.",
  });

  return {
    enabled: true,
    storyboardRows: fixture.storyboardRows.length,
    matchedRows,
    promptMismatches,
    videoDescMismatches,
    referenceOrderMismatches,
    imagePathMissing,
    goldenImageComparisonStatus: "deferred",
    goldenImageBlocker: "Portable Toonflow image fixture paths are not stable for unit tests.",
    issues,
  };
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
