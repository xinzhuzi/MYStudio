// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  mergeSelectedShotDefinitions,
  selectPlanIssuesForShotIds,
  selectShotIdsForRun,
} from "./render-shot-slots";

const SHOT_IDS = [
  "sb-chapter-001-001",
  "sb-chapter-001-002",
  "sb-chapter-001-003",
];

describe("selectShotIdsForRun", () => {
  it("keeps the complete chapter when no allowlist is provided", () => {
    expect(selectShotIdsForRun(SHOT_IDS, undefined)).toEqual(SHOT_IDS);
  });

  it("returns requested shots in chapter order", () => {
    expect(selectShotIdsForRun(
      SHOT_IDS,
      "sb-chapter-001-002,sb-chapter-001-001",
    )).toEqual([
      "sb-chapter-001-001",
      "sb-chapter-001-002",
    ]);
  });

  it("fails closed for empty, duplicate, or unknown shot IDs", () => {
    expect(() => selectShotIdsForRun(SHOT_IDS, "")).toThrow("非空 shot ID");
    expect(() => selectShotIdsForRun(
      SHOT_IDS,
      "sb-chapter-001-001,sb-chapter-001-001",
    )).toThrow("重复 shot ID");
    expect(() => selectShotIdsForRun(SHOT_IDS, "sb-chapter-001-099"))
      .toThrow("当前章节不存在");
  });
});

describe("mergeSelectedShotDefinitions", () => {
  it("replaces selected shots while preserving every unselected manifest entry", () => {
    expect(mergeSelectedShotDefinitions({
      availableShotIds: SHOT_IDS,
      selectedShots: [{ shotId: SHOT_IDS[0], revision: 2 }],
      currentShots: SHOT_IDS.map((shotId) => ({ shotId, revision: 1 })),
      scoped: true,
    })).toEqual([
      { shotId: SHOT_IDS[0], revision: 2 },
      { shotId: SHOT_IDS[1], revision: 1 },
      { shotId: SHOT_IDS[2], revision: 1 },
    ]);
  });

  it("fails closed when an unselected manifest entry is missing", () => {
    expect(() => mergeSelectedShotDefinitions({
      availableShotIds: SHOT_IDS,
      selectedShots: [{ shotId: SHOT_IDS[0], revision: 2 }],
      currentShots: [{ shotId: SHOT_IDS[1], revision: 1 }],
      scoped: true,
    })).toThrow("缺少未选镜头");
  });
});

describe("selectPlanIssuesForShotIds", () => {
  it("keeps selected-shot and chapter-level issues while hiding unselected-shot noise", () => {
    const issues = [
      { path: "shots.sb-chapter-001-001.$.storyboard.visualReview", message: "selected" },
      { path: "shots.sb-chapter-001-003.$.storyboard.visualReview", message: "unselected" },
      { path: "$.chapter", message: "chapter" },
    ];

    expect(selectPlanIssuesForShotIds(issues, ["sb-chapter-001-001"])).toEqual([
      issues[0],
      issues[2],
    ]);
  });
});
