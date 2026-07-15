import { describe, expect, it } from "vitest";
import type { ScriptCharacter } from "@/types/script";
import type { CharacterStageAnalysis } from "./character-stage-analyzer";
import { expandCharacterStages } from "./character-stage-expansion";

const baseCharacter: ScriptCharacter = {
  id: "hero",
  name: "阿青",
  role: "山村少年",
  tags: ["protagonist", "剑客"],
  identityAnchors: { faceShape: "清瘦面型", uniqueMarks: [] },
};

const analysis: CharacterStageAnalysis = {
  characterName: "阿青",
  needsMultiStage: true,
  reason: "跨越青年与成年",
  consistencyElements: {
    facialFeatures: "sharp eyes",
    bodyType: "slender",
    uniqueMarks: "scar",
  },
  stages: [{
    name: "青年 版",
    episodeRange: [1, 10],
    ageDescription: "18岁",
    stageDescription: "初入江湖",
    visualPromptEn: "young swordsman",
    visualPromptZh: "青年剑客",
  }],
};

describe("expandCharacterStages", () => {
  it("creates ordered stage characters without mutating the input", () => {
    const input = [baseCharacter];
    const result = expandCharacterStages(input, [analysis], "zh+en");

    expect(input[0]).toBe(baseCharacter);
    expect(input[0].stageCharacterIds).toBeUndefined();
    expect(result.stageCount).toBe(1);
    expect(result.multiStageCharacterCount).toBe(1);
    expect(result.characters.map((character) => character.id)).toEqual([
      "hero",
      "hero_stage_0_青年_版",
    ]);
    expect(result.characters[0].tags).toEqual(["剑客", "父角色"]);
    expect(result.characters[1]).toEqual(expect.objectContaining({
      baseCharacterId: "hero",
      age: "18岁",
      visualPromptZh: "青年剑客",
      visualPromptEn: "sharp eyes, slender, scar, young swordsman",
    }));
  });

  it("respects prompt language gates", () => {
    expect(expandCharacterStages([baseCharacter], [analysis], "zh").characters[1].visualPromptEn).toBeUndefined();
    expect(expandCharacterStages([baseCharacter], [analysis], "en").characters[1].visualPromptZh).toBeUndefined();
  });

  it("leaves characters unchanged when an analysis name does not match", () => {
    const result = expandCharacterStages([baseCharacter], [{ ...analysis, characterName: "不存在" }], "zh");
    expect(result.characters).toEqual([baseCharacter]);
    expect(result.stageCount).toBe(0);
    expect(result.multiStageCharacterCount).toBe(0);
  });

  it("deduplicates repeated analyses and ignores empty stages", () => {
    const result = expandCharacterStages([
      baseCharacter,
      { id: "support", name: "配角", tags: ["supporting"] },
    ], [
      analysis,
      analysis,
      { ...analysis, characterName: "配角", stages: [] },
    ], "zh+en");

    expect(result.characters.filter((character) => character.baseCharacterId === "hero")).toHaveLength(1);
    expect(new Set(result.characters.map((character) => character.id)).size).toBe(result.characters.length);
    expect(result.characters.find((character) => character.id === "support")?.stageCharacterIds).toBeUndefined();
    expect(result.multiStageCharacterCount).toBe(1);
  });
});
