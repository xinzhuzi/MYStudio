import { describe, expect, it } from "vitest";
import type { CharacterVariation } from "@/stores/character-library-store";
import { buildCharacterStageVariation, hasMatchingStageVariation } from "./character-stage-variation";

const stageInfo = {
  stageName: "青年期",
  episodeRange: [3, 8] as [number, number],
  ageDescription: "25岁",
};

describe("character stage variation", () => {
  it("maps existing stage and consistency data to the persisted variation contract", () => {
    expect(buildCharacterStageVariation({
      stageInfo,
      consistencyElements: { facialFeatures: "剑眉", bodyType: "修长", uniqueMarks: "左眉痣" },
      visualPromptZh: "玄衣青年剑客",
    })).toEqual({
      name: "青年期",
      visualPrompt: "剑眉, 修长, 左眉痣, 25岁, 青年期",
      visualPromptZh: "玄衣青年剑客",
      isStageVariation: true,
      episodeRange: [3, 8],
      ageDescription: "25岁",
      stageDescription: "青年期",
    });
  });

  it("keeps the calibrated English prompt and identifies an existing stage", () => {
    const variation = buildCharacterStageVariation({
      stageInfo,
      visualPromptEn: "sharp eyes, slim build, young swordsman",
    });
    if (!variation) {
      throw new Error("stage metadata must produce a variation");
    }
    const persisted: CharacterVariation = { id: "variation-1", ...variation };

    expect(variation.visualPrompt).toBe("sharp eyes, slim build, young swordsman");
    expect(hasMatchingStageVariation([persisted], stageInfo)).toBe(true);
    expect(hasMatchingStageVariation([persisted], { ...stageInfo, episodeRange: [9, 12] })).toBe(false);
  });

  it("does not create a variation without stage metadata", () => {
    expect(buildCharacterStageVariation({})).toBeUndefined();
  });
});
