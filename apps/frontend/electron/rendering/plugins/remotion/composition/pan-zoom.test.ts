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

  it("explicit easing=cubic is frame-identical to the default curve", () => {
    const cubic: CompositionPanZoom = { ...zoomIn, easing: "cubic" };
    for (const frame of [0, 7, 15, 30, 45, 59, 60]) {
      expect(panZoomAtFrame(frame, 61, cubic).scale)
        .toBe(panZoomAtFrame(frame, 61, zoomIn).scale);
    }
  });

  describe("easing=spring（08-21 Remotion spring 接入）", () => {
    const springZoom: CompositionPanZoom = { ...zoomIn, easing: "spring" };

    it("starts at fromScale and lands on toScale at the last frame", () => {
      expect(panZoomAtFrame(0, 61, springZoom).scale).toBeCloseTo(1);
      // durationInFrames 归一：spring 在末帧精确到达 to=1
      expect(panZoomAtFrame(60, 61, springZoom).scale).toBeCloseTo(1.2);
    });

    it("overshoots the target mid-clip (弹性过冲) unlike the cubic curve", () => {
      // damping 14 / stiffness 100 / mass 1（ζ≈0.7）约 4-5% 过冲：
      // 1→1.2 的 zoom-in 在中段 scale 会短暂越过 1.2；cubic 曲线永不越界。
      const peak = Math.max(
        ...Array.from({ length: 61 }, (_, frame) => panZoomAtFrame(frame, 61, springZoom).scale),
      );
      expect(peak).toBeGreaterThan(1.2);
      const cubicPeak = Math.max(
        ...Array.from({ length: 61 }, (_, frame) => panZoomAtFrame(frame, 61, zoomIn).scale),
      );
      expect(cubicPeak).toBeCloseTo(1.2);
    });

    it("single-frame spring clip holds fromScale like the default", () => {
      expect(panZoomAtFrame(0, 1, springZoom).scale).toBeCloseTo(1);
    });
  });
});
