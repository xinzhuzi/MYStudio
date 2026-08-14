import type { CompositionTransitionEffect } from "./timing";

export interface TransitionFrameStyle {
  incomingOpacity: number;
  overlayColor?: "#000000" | "#ffffff";
  overlayOpacity: number;
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
  if (effectId === "crossfade") {
    if (durationInFrames === 1) return { incomingOpacity: 1, overlayOpacity: 0 };
    // Smoothstep easing: heads and tails breathe in/out instead of moving at a
    // constant rate — reads as an ink-wash bleed rather than a mechanical dip.
    const t = localFrame / (durationInFrames - 1);
    return {
      incomingOpacity: t * t * (3 - 2 * t),
      overlayOpacity: 0,
    };
  }

  const lastFrame = durationInFrames - 1;
  const midpoint = Math.floor(lastFrame / 2);
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

function clampFrame(frame: number, durationInFrames: number): number {
  return Math.max(0, Math.min(durationInFrames - 1, Math.floor(frame)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
