import { describe, expect, it } from "vitest";
import {
  EDITING_EFFECT_IDS,
  getEditingEffectDefinition,
  isEditingEffectId,
} from "./effect-registry";

describe("editing effect registry", () => {
  it("owns the complete v1 effect allowlist + timing-aligned transition closure", async () => {
    const { COMPOSITION_TRANSITION_EFFECTS } = await import(
      "@/electron/rendering/plugins/remotion/composition/timing"
    );
    const base = [
      "cut", "fade", "crossfade", "flash", "blackout", "impact-frame", "ink-bleed",
      "panZoom", "shake", "glitch", "chromaticAberration", "blur", "glow", "grain",
      "speed", "afterimage", "speedSilhouette", "godRays", "onTwos", "gradePulse",
      "atmosphere", "grade", "ambient",
    ];
    // 基线在前保持稳定顺序，其后为 timing 转场闭集减基线（顺序同 timing）。
    expect(EDITING_EFFECT_IDS).toEqual([
      ...base,
      ...COMPOSITION_TRANSITION_EFFECTS.filter((id) => !base.includes(id)),
    ]);
    // 全部转场闭集成员都有 definition 且 category=transition（EDL 投影闸）。
    for (const id of COMPOSITION_TRANSITION_EFFECTS) {
      const def = getEditingEffectDefinition(id);
      expect(def, id).toBeDefined();
      expect(def?.category, id).toBe("transition");
    }
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
    expect(getEditingEffectDefinition("gl:swap")).toMatchObject({
      id: "gl:swap",
      category: "transition",
      preview: "full",
      finalRenderer: "ffmpeg",
    });
    expect(getEditingEffectDefinition("gl:CrossZoom")).toMatchObject({
      id: "gl:CrossZoom",
      category: "transition",
      preview: "full",
      finalRenderer: "ffmpeg",
    });
    expect(getEditingEffectDefinition("gl:NotInRegistry")).toBeNull();
    expect(getEditingEffectDefinition("raw-filter")).toBeNull();
    expect(isEditingEffectId("speed")).toBe(true);
    expect(isEditingEffectId("-vf scale=1:1")).toBe(false);
  });
});
