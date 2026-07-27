import { describe, expect, it } from "vitest";
import { buildVisualStyle } from "./visual-style";
import type { CompositionTransform } from "./composition-props";

const identity: CompositionTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

describe("buildVisualStyle", () => {
  it("emits an identity transform with full opacity", () => {
    const style = buildVisualStyle(identity);
    expect(style.transform).toBe("translate(0px, 0px) scale(1, 1) rotate(0deg)");
    expect(style.opacity).toBe(1);
    expect(style.transformOrigin).toBeUndefined();
  });

  it("applies translate, scale and rotation", () => {
    const style = buildVisualStyle({
      x: 10,
      y: -20,
      scaleX: 1.5,
      scaleY: 2,
      rotation: 45,
      opacity: 0.5,
    });
    expect(style.transform).toBe(
      "translate(10px, -20px) scale(1.5, 2) rotate(45deg)",
    );
    expect(style.opacity).toBe(0.5);
  });

  it("multiplies panZoom scale into the base scale and sets transform-origin", () => {
    const style = buildVisualStyle(identity, {
      scale: 1.2,
      originX: 0.5,
      originY: 0.25,
    });
    expect(style.transform).toBe("translate(0px, 0px) scale(1.2, 1.2) rotate(0deg)");
    expect(style.transformOrigin).toBe("50% 25%");
  });

  it("clamps opacity into [0, 1]", () => {
    expect(buildVisualStyle({ ...identity, opacity: 2 }).opacity).toBe(1);
    expect(buildVisualStyle({ ...identity, opacity: -1 }).opacity).toBe(0);
  });
});
