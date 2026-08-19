import type { CompositionTransitionEffect } from "./timing";
import { isGlTransitionEffect } from "./gl-transition-registry";

export interface TransitionFrameStyle {
  incomingOpacity: number;
  overlayColor?: "#000000" | "#ffffff";
  overlayOpacity: number;
  /** 冲击帧：中帧全画面反色（filter:invert(1)，动漫手法）。 */
  impactInvert?: boolean;
}

/**
 * Frame-exact transition state shared by Player and fixed-bundle rendering.
 *
 * The incoming clip is rendered above the outgoing clip. Crossfade therefore
 * only needs to ramp the incoming alpha. Fade/blackout and flash switch the
 * underlying clip while an opaque black/white midpoint hides that switch,
 * matching the existing FFmpeg through-color blend.
 */
export function transitionStyleAtFrame(
  effectId: CompositionTransitionEffect,
  frame: number,
  durationInFrames: number,
): TransitionFrameStyle {
  if (effectId === "cut" || durationInFrames <= 0) {
    return { incomingOpacity: 1, overlayOpacity: 0 };
  }
  const localFrame = clampFrame(frame, durationInFrames);
  if (effectId === "impact-frame") {
    // 冲击帧：单帧高对比反色（动漫打击感核心手法）
    if (durationInFrames === 1) return { incomingOpacity: 1, overlayOpacity: 0 };
    const lastFrame = durationInFrames - 1;
    const isImpact = localFrame === Math.floor(lastFrame / 2);
    return {
      incomingOpacity: localFrame <= Math.floor(lastFrame / 2) ? 0 : 1,
      overlayColor: isImpact ? "#ffffff" : undefined,
      overlayOpacity: isImpact ? 0 : (localFrame < Math.floor(lastFrame / 2) ? 1 : 0),
      ...(isImpact ? { impactInvert: true } : {}),
    };
  }
  if (effectId === "crossfade" || isGlTransitionEffect(effectId)) {
    if (durationInFrames === 1) return { incomingOpacity: 1, overlayOpacity: 0 };
    // Smoothstep easing: heads and tails breathe in/out instead of moving at a
    // constant rate — reads as an ink-wash bleed rather than a mechanical dip.
    // gl:* 渲染期由 GLTransitionLayer 全屏接管（不透明覆盖，此 opacity 不可见）；
    // Player 预览（无渲染 proxy）降级为 crossfade 视觉兜底。
    const t = localFrame / (durationInFrames - 1);
    return {
      incomingOpacity: t * t * (3 - 2 * t),
      overlayOpacity: 0,
    };
  }

  const lastFrame = durationInFrames - 1;
  const midpoint = Math.floor(lastFrame / 2);
  // 血祭黑场与 fade 的差异化：快出→按 hold 保持→快入的梯形包络（连续近黑帧），
  // 对称三角的 fade 只在正中单帧到达峰值。hold 先用与 transition-policy
  // params 默认一致的模块内比例（0.15），契约扩展（S3 Phase 2）时再从计划穿真值。
  if (effectId === "blackout" && durationInFrames >= 3) {
    const local = clampFrame(frame, durationInFrames);
    const holdFrames = Math.min(
      Math.max(Math.round(BLACKOUT_HOLD_FRACTION * durationInFrames), 0),
      durationInFrames - 2,
    );
    const rampFrames = Math.floor((durationInFrames - holdFrames) / 2);
    const holdEnd = rampFrames + holdFrames;
    const opacity = local < rampFrames && rampFrames > 0
      ? local / rampFrames
      : local < holdEnd
        ? 1
        : holdEnd >= lastFrame
          ? 1
          : (lastFrame - local) / (lastFrame - holdEnd);
    return {
      incomingOpacity: local < holdEnd ? 0 : 1,
      overlayColor: "#000000",
      overlayOpacity: clamp01(opacity),
    };
  }
  const beforeMidpoint = localFrame <= midpoint;
  const ramp = beforeMidpoint
    ? (midpoint === 0 ? 1 : localFrame / midpoint)
    : (lastFrame === midpoint ? 0 : (lastFrame - localFrame) / (lastFrame - midpoint));
  // A softened flash never reaches full white — full-screen pure white reads
  // as a glitch; 0.75 keeps a strong "breakthrough light" beat without the sting.
  const peak = effectId === "flash" ? FLASH_PEAK_OPACITY : 1;

  return {
    incomingOpacity: beforeMidpoint ? 0 : 1,
    overlayColor: effectId === "flash" ? "#ffffff" : "#000000",
    overlayOpacity: clamp01(ramp * peak),
  };
}

const FLASH_PEAK_OPACITY = 0.75;
const BLACKOUT_HOLD_FRACTION = 0.15;

function clampFrame(frame: number, durationInFrames: number): number {
  return Math.max(0, Math.min(durationInFrames - 1, Math.floor(frame)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
