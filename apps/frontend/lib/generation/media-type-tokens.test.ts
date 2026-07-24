import { describe, expect, it } from "vitest";
import {
  getMediaTypeGuidance,
  isFieldSkipped,
  translateToken,
} from "./media-type-tokens";

describe("media-type cinematography token helpers", () => {
  it("passes cinematic tokens through without field skipping", () => {
    expect(translateToken("cinematic", "cameraRig", "dolly", "physical dolly,")).toBe(
      "physical dolly,",
    );
    expect(isFieldSkipped("cinematic", "cameraRig")).toBe(false);
    expect(getMediaTypeGuidance("cinematic")).toContain("physical cinematography");
  });

  it("adapts camera and focus tokens for animation and stop-motion styles", () => {
    expect(translateToken("animation", "cameraRig", "dolly", "physical dolly,")).toBe(
      "smooth tracking with parallax layers,",
    );
    expect(translateToken("animation", "focusTransition", "none", "keep focus,")).toBe("");
    expect(translateToken("stop-motion", "depthOfField", "shallow", "shallow lens,")).toBe(
      "macro lens shallow DOF, miniature scale emphasis,",
    );
  });

  it("skips physical camera fields for graphic styles while preserving mood fields", () => {
    expect(translateToken("graphic", "cameraRig", "dolly", "physical dolly,")).toBe("");
    expect(isFieldSkipped("graphic", "cameraRig")).toBe(true);
    expect(translateToken("graphic", "lightingStyle", "neon", "neon light,")).toBe(
      "vibrant neon color accents,",
    );
    expect(getMediaTypeGuidance("graphic")).toContain("Do NOT use physical camera");
  });

  it("keeps unknown preset IDs as forward-compatible original tokens", () => {
    expect(translateToken("animation", "cameraRig", "future-rig", "future rig,")).toBe(
      "future rig,",
    );
    expect(translateToken("graphic", "shotSize", "future-size", "future size,")).toBe(
      "future size,",
    );
  });
});
