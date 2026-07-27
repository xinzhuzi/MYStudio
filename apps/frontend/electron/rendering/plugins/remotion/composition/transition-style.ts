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
    return {
      incomingOpacity: durationInFrames === 1
        ? 1
        : localFrame / (durationInFrames - 1),
      overlayOpacity: 0,
    };
  }

  const lastFrame = durationInFrames - 1;
  const midpoint = Math.floor(lastFrame / 2);
  const beforeMidpoint = localFrame <= midpoint;
  const overlayOpacity = beforeMidpoint
    ? (midpoint === 0 ? 1 : localFrame / midpoint)
    : (lastFrame === midpoint ? 0 : (lastFrame - localFrame) / (lastFrame - midpoint));

  return {
    incomingOpacity: beforeMidpoint ? 0 : 1,
    overlayColor: effectId === "flash" ? "#ffffff" : "#000000",
    overlayOpacity: clamp01(overlayOpacity),
  };
}

function clampFrame(frame: number, durationInFrames: number): number {
  return Math.max(0, Math.min(durationInFrames - 1, Math.floor(frame)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
