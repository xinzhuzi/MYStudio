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
/** 环境动画参数(从 ShotFxAmbient 量化而来,经 plan.effects → composition props)。 */
export interface CompositionAmbient {
  type: "float" | "breathe" | "sway" | "pulse" | "flow";
  ampX: number;
  ampY: number;
  ampScale: number;
  ampRot: number;
  freq: number;
  phase: number;
}

export interface AmbientTransform {
  /** 附加 X 偏移(画面宽度百分比) */
  offsetX: number;
  /** 附加 Y 偏移(画面高度百分比) */
  offsetY: number;
  /** 附加缩放增量 */
  deltaScale: number;
  /** 附加旋转(度) */
  deltaRot: number;
}

/**
 * 环境动画: sin/cos 周期运动,让静态画面「活」起来。
 * 叠加在 panZoom 缓动之上,每帧产生微量偏移/缩放/旋转。
 */
export function ambientAtFrame(
  frame: number,
  fps: number,
  ambient: CompositionAmbient,
): AmbientTransform {
  if (!Number.isFinite(fps) || fps <= 0) return { offsetX: 0, offsetY: 0, deltaScale: 0, deltaRot: 0 };
  const t = frame / fps; // 秒
  const phase = ambient.phase * Math.PI * 2;
  switch (ambient.type) {
    case "float":
      // 上下浮动:sin 波 Y 偏移,带轻微缩放变化
      return {
        offsetX: 0,
        offsetY: ambient.ampY * Math.sin(t * ambient.freq * Math.PI * 2 + phase),
        deltaScale: ambient.ampScale * Math.sin(t * ambient.freq * Math.PI * 2 + phase + Math.PI / 4),
        deltaRot: 0,
      };
    case "breathe":
      // 呼吸:缩放脉动
      return {
        offsetX: 0,
        offsetY: 0,
        deltaScale: ambient.ampScale * Math.sin(t * ambient.freq * Math.PI * 2 + phase),
        deltaRot: 0,
      };
    case "sway":
      // 摇摆:左右+微旋转
      return {
        offsetX: ambient.ampX * Math.sin(t * ambient.freq * Math.PI * 2 + phase),
        offsetY: 0,
        deltaScale: 0,
        deltaRot: ambient.ampRot * Math.sin(t * ambient.freq * Math.PI * 2 + phase + Math.PI / 3),
      };
    case "pulse":
      // 脉动:推拉交替(呼吸变焦,频率更低)
      return {
        offsetX: 0,
        offsetY: 0,
        deltaScale: ambient.ampScale * Math.sin(t * ambient.freq * Math.PI * 2 + phase),
        deltaRot: 0,
      };
    case "flow":
      // 流动:多轴漫游(XY 不同频率的 sin 叠加,无方向感)
      return {
        offsetX: ambient.ampX * (Math.sin(t * ambient.freq * Math.PI * 2 + phase) * 0.7
          + Math.sin(t * ambient.freq * Math.PI * 2 * 1.618 + phase) * 0.3),
        offsetY: ambient.ampY * (Math.cos(t * ambient.freq * Math.PI * 2 + phase * 1.3) * 0.7
          + Math.sin(t * ambient.freq * Math.PI * 2 * 0.618 + phase) * 0.3),
        deltaScale: ambient.ampScale * Math.sin(t * ambient.freq * Math.PI * 2 * 0.85 + phase * 0.7),
        deltaRot: ambient.ampRot * Math.sin(t * ambient.freq * Math.PI * 2 * 1.2 + phase * 0.5),
      };
  }
}

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
