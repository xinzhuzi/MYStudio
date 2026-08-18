// Design §6: panZoom expressed as a frame-based scale/origin interpolation,
// mirroring the FFmpeg zoompan/scale intent (eased scaleFrom -> scaleTo over the
// clip, constant origin). Pure so both the Player and the fixed bundle compute an
// identical transform per frame; the .tsx feeds the result into a CSS transform.
//
// `frame` is clip-relative (0 == first frame of the clip). Progress clamps to
// [0, 1] so frames outside the clip hold the endpoints, matching FFmpeg's
// min(max(t/duration,0),1).

import type { CompositionPanZoom } from "./composition-props";

export interface PanZoomTransform {
  // Uniform scale factor applied to the visual (>= the smaller of from/to).
  scale: number;
  // Fractional origin the scale grows around, 0..1 on each axis. Matches the
  // FFmpeg x='(iw-iw/zoom)*originX' intent: 0 = left/top, 0.5 = center, 1 = right/bottom.
  originX: number;
  originY: number;
}

// Ease-in-out cubic, curve-equivalent to Remotion's Easing.inOut(Easing.cubic)
// (effect 08-18-effect-upgrade design §1.1). Kept hand-written like
// cinematic-camera.ts so this module stays dependency-pure; symmetric, so the
// exact midpoint still maps to the linear midpoint.
export function easeInOutCubic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Eased interpolation of scale across the clip; origin is constant.
export function panZoomAtFrame(
  frame: number,
  durationInFrames: number,
  panZoom: CompositionPanZoom,
): PanZoomTransform {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error(`panZoom 时长必须是正整数帧: ${durationInFrames}`);
  }
  const span = durationInFrames - 1;
  const progress = span <= 0
    ? 0
    : Math.min(1, Math.max(0, frame / span));
  const scale = panZoom.fromScale
    + (panZoom.toScale - panZoom.fromScale) * easeInOutCubic(progress);
  return {
    scale,
    originX: clampUnit(panZoom.originX),
    originY: clampUnit(panZoom.originY),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
