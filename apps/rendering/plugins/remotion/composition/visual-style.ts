// Design §6: build the CSS style a visual clip applies each frame. Combines the
// base CompositionTransform (translate/scale/rotate/opacity) with the optional
// per-frame panZoom scale and origin. Pure and framework-light so the .tsx layer
// stays a thin wrapper: it only samples panZoom (pan-zoom.ts) and passes the
// resulting style to AbsoluteFill. Values mirror the FFmpeg transform intent.

import type { CSSProperties } from "react";
import type { CompositionTransform } from "./composition-props";
import type { PanZoomTransform } from "./pan-zoom";

// Compose the transform string. Order matches how the editing preview applies
// it: translate, then panZoom scale, then base scale, then rotate. panZoom origin
// drives transform-origin so the zoom pivots around the same point as FFmpeg.
export function buildVisualStyle(
  transform: CompositionTransform,
  panZoom?: PanZoomTransform,
): CSSProperties {
  const panScale = panZoom ? panZoom.scale : 1;
  const parts = [
    `translate(${round(transform.x)}px, ${round(transform.y)}px)`,
    `scale(${round(transform.scaleX * panScale)}, ${round(transform.scaleY * panScale)})`,
    `rotate(${round(transform.rotation)}deg)`,
  ];
  const style: CSSProperties = {
    transform: parts.join(" "),
    opacity: clamp01(transform.opacity),
  };
  if (panZoom) {
    style.transformOrigin =
      `${round(panZoom.originX * 100)}% ${round(panZoom.originY * 100)}%`;
  }
  return style;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Trim floating-point noise so equal transforms produce byte-identical strings
// (golden tests compare the emitted style directly).
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
