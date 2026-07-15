import { describe, expect, it } from "vitest";
import {
  EDITING_EFFECT_IDS,
  getEditingEffectDefinition,
  isEditingEffectId,
} from "./effect-registry";

describe("editing effect registry", () => {
  it("owns the complete v1 effect allowlist", () => {
    expect(EDITING_EFFECT_IDS).toEqual([
      "cut",
      "fade",
      "crossfade",
      "flash",
      "blackout",
      "panZoom",
      "shake",
      "glitch",
      "chromaticAberration",
      "blur",
      "glow",
      "grain",
      "speed",
    ]);
  });

  it("returns renderer capabilities only for registered effects", () => {
    expect(getEditingEffectDefinition("crossfade")).toMatchObject({
      id: "crossfade",
      category: "transition",
      preview: "full",
      finalRenderer: "ffmpeg",
    });
    expect(getEditingEffectDefinition("glitch")).toMatchObject({
      id: "glitch",
      category: "style",
      preview: "approximate",
      finalRenderer: "ffmpeg",
    });
    expect(getEditingEffectDefinition("raw-filter")).toBeNull();
    expect(isEditingEffectId("speed")).toBe(true);
    expect(isEditingEffectId("-vf scale=1:1")).toBe(false);
  });
});
