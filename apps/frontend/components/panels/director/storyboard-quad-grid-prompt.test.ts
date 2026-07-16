import { describe, expect, it } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { buildStoryboardQuadGridPrompt } from "./storyboard-quad-grid-prompt";

const scene = {
  imagePromptZh: "码头边的独孤剑尘",
  sceneName: "金水河码头",
  sceneLocation: "外景",
  actionSummary: "抬头望向河面",
  characterIds: ["hero"],
} as SplitScene;

describe("buildStoryboardQuadGridPrompt", () => {
  it("keeps variation labels and panel order stable", () => {
    const result = buildStoryboardQuadGridPrompt({
      scene,
      variationType: "angle",
      useCharacterRef: true,
      aspect: "9:16",
      styleTokens: ["水墨国风"],
      emotionDescription: "压迫",
      includeDialogueBoxConstraint: true,
    });

    expect(result.variationLabels).toEqual(["正面偏左", "正面偏右", "侧面特写", "全景俯瞰"]);
    expect(result.prompt).toContain("Panel [row 1, col 1]");
    expect(result.prompt).toContain("Panel [row 2, col 2]");
    expect(result.prompt).toContain("EXACTLY ONE person in each panel");
    expect(result.prompt).toContain("NO DIALOGUE BOXES");
  });

  it("uses the source composition constraint when character references are disabled", () => {
    const result = buildStoryboardQuadGridPrompt({
      scene: { ...scene, characterIds: ["hero", "villain"] } as SplitScene,
      variationType: "moment",
      useCharacterRef: false,
      aspect: "16:9",
    });

    expect(result.prompt).toContain("Keep the EXACT same number of characters");
    expect(result.prompt).toContain("Action sequence context: 抬头望向河面.");
    expect(result.prompt).not.toContain("vertical composition");
  });
});
