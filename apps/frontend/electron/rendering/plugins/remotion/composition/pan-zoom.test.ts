import { describe, expect, it } from "vitest";
import { panZoomAtFrame } from "./pan-zoom";
import type { CompositionPanZoom } from "./composition-props";

const zoomIn: CompositionPanZoom = {
  fromScale: 1,
  toScale: 1.2,
  originX: 0.5,
  originY: 0.5,
};

describe("panZoomAtFrame", () => {
  it("holds fromScale at the first frame and toScale at the last", () => {
    expect(panZoomAtFrame(0, 61, zoomIn).scale).toBeCloseTo(1);
    expect(panZoomAtFrame(60, 61, zoomIn).scale).toBeCloseTo(1.2);
  });

  it("interpolates scale with ease-in-out cubic across the clip", () => {
    // span = 60 frames. Easing.inOut(cubic) is symmetric: the exact midpoint
    // (frame 30) still lands on the linear midpoint, while the quarter points
    // lag/lead the linear ramp (0.25 -> 0.0625, 0.75 -> 0.9375 eased progress).
    expect(panZoomAtFrame(15, 61, zoomIn).scale).toBeCloseTo(1.0125);
    expect(panZoomAtFrame(30, 61, zoomIn).scale).toBeCloseTo(1.1);
    expect(panZoomAtFrame(45, 61, zoomIn).scale).toBeCloseTo(1.1875);
  });

  it("clamps progress so frames outside the clip hold the endpoints", () => {
    expect(panZoomAtFrame(-5, 61, zoomIn).scale).toBeCloseTo(1);
    expect(panZoomAtFrame(999, 61, zoomIn).scale).toBeCloseTo(1.2);
  });

  it("keeps a single-frame clip at fromScale", () => {
    expect(panZoomAtFrame(0, 1, zoomIn).scale).toBeCloseTo(1);
  });

  it("passes origin through, clamped to 0..1", () => {
    const offOrigin: CompositionPanZoom = {
      fromScale: 1,
      toScale: 1.5,
      originX: -0.3,
      originY: 1.8,
    };
    const result = panZoomAtFrame(0, 30, offOrigin);
    expect(result.originX).toBe(0);
    expect(result.originY).toBe(1);
  });

  it("rejects a non-positive or fractional duration", () => {
    expect(() => panZoomAtFrame(0, 0, zoomIn)).toThrow("panZoom 时长必须是正整数帧");
    expect(() => panZoomAtFrame(0, 1.5, zoomIn)).toThrow("panZoom 时长必须是正整数帧");
  });
});
