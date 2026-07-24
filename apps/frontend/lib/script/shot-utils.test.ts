import { describe, expect, it } from "vitest";
import type { Shot } from "@/types/script";
import {
  calculateProgress,
  getShotCompletionStatus,
  normalizeShotSize,
} from "./shot-utils";

function shot(overrides: Partial<Shot>): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneRefId: "scene-1",
    actionSummary: "动作",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
    ...overrides,
  };
}

describe("shot utility helpers", () => {
  it("derives completion status from image and video generation state", () => {
    expect(getShotCompletionStatus(shot({
      imageStatus: "completed",
      videoStatus: "completed",
    }))).toBe("completed");

    expect(getShotCompletionStatus(shot({
      imageStatus: "completed",
      videoStatus: "idle",
    }))).toBe("in_progress");

    expect(getShotCompletionStatus(shot({
      imageStatus: "failed",
      videoStatus: "generating",
    }))).toBe("pending");
  });

  it("counts completed items without treating missing status as complete", () => {
    expect(calculateProgress([
      { status: "completed" },
      { status: "in_progress" },
      { status: "pending" },
      {},
    ])).toBe("1/4");

    expect(calculateProgress([])).toBe("0/0");
  });

  it("normalizes known shot-size labels and rejects empty or unknown values", () => {
    expect(normalizeShotSize("特写")).toBe("ecu");
    expect(normalizeShotSize("Medium Long Shot")).toBe("mls");
    expect(normalizeShotSize("POV Shot")).toBe("pov");
    expect(normalizeShotSize("unknown")).toBeNull();
    expect(normalizeShotSize("")).toBeNull();
    expect(normalizeShotSize(undefined)).toBeNull();
    expect(normalizeShotSize(null)).toBeNull();
  });
});
