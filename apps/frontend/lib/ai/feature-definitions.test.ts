import { describe, expect, it } from "vitest";
import { AI_FEATURES } from "./feature-definitions";

describe("AI feature definitions", () => {
  it("keeps every feature key unique and preserves the compatibility list", () => {
    const keys = AI_FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "script_analysis",
      "character_generation",
      "scene_generation",
      "prop_generation",
      "video_generation",
      "image_understanding",
      "chat",
      "freedom_image",
      "freedom_video",
      "tts",
    ]);
  });
});
