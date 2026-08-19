// Design §6: unified microsecond→frame rounding shared by the Player and the
// fixed render bundle. Transition overlap shortens total duration to match the
// existing FFmpeg trim + blend + concat semantics (total = Σclip − Σoverlap).
//
// This module is pure and defines its own minimal input shapes. The host
// projects a validated TimelineRenderPlan into these before rendering, so the
// composition never imports the Zustand store, plan JSON, or Studio panels.

import { GL_TRANSITION_IDS } from "./gl-transition-registry";

export const MICROSECONDS_PER_SECOND = 1_000_000;

// 基线 5 种手搓转场 + gl-transitions 收录白名单（单一事实源：
// gl-transition-registry.ts，三处镜像由 transition-enum-sync.test.ts 孪生对拍守护）。
export const COMPOSITION_TRANSITION_EFFECTS = [
  "cut",
  "fade",
  "crossfade",
  "flash",
  "blackout",
  "impact-frame",
  "ink-bleed",
  ...GL_TRANSITION_IDS,
] as const;

export type CompositionTransitionEffect =
  typeof COMPOSITION_TRANSITION_EFFECTS[number];

export interface CompositionVisualClipInput {
  clipId: string;
  durationUs: number;
}

export interface CompositionTransitionInput {
  fromClipId: string;
  toClipId: string;
  effectId: CompositionTransitionEffect;
  durationUs: number;
}

export interface CompositionClipTiming {
  clipId: string;
  from: number;
  durationInFrames: number;
}

export interface CompositionVisualTimeline {
  fps: number;
  clips: CompositionClipTiming[];
  durationInFrames: number;
}

// Unified rounding: microseconds → frames via Math.round, mirroring the
// existing FFmpeg Math.round((us / 1e6) * fps).
export function usToFrames(us: number, fps: number): number {
  if (!Number.isFinite(us) || us < 0) {
    throw new Error(`时长必须是非负有限微秒数: ${us}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`帧率必须是正有限数: ${fps}`);
  }
  return Math.round((us / MICROSECONDS_PER_SECOND) * fps);
}

// A rendered clip always occupies at least one frame so a very short clip never
// collapses to zero-length in the composition.
export function clipDurationInFrames(durationUs: number, fps: number): number {
  return Math.max(1, usToFrames(durationUs, fps));
}

// Overlap frames between two adjacent clips joined by a transition. "cut" never
// overlaps; other effects overlap by the transition duration, clamped so the
// overlap can never consume an entire adjacent clip (leaving >=1 frame each).
export function transitionOverlapFrames(
  transition: CompositionTransitionInput,
  fromDurationInFrames: number,
  toDurationInFrames: number,
  fps: number,
): number {
  if (transition.effectId === "cut") return 0;
  const requested = usToFrames(transition.durationUs, fps);
  const maxByNeighbours = Math.max(
    0,
    Math.min(fromDurationInFrames, toDurationInFrames) - 1,
  );
  // A transition may consume at most half of its shorter neighbour — the same
  // bound the video-use contract validator and the Python decision layer
  // enforce. (The legacy 15% FFmpeg-compiler cap was retired with the bypass
  // lineage; slow ink-wash crossfades need the full half-neighbour budget.)
  const maxByHalfNeighbour = Math.floor(Math.min(fromDurationInFrames, toDurationInFrames) * 0.5);
  return Math.max(0, Math.min(requested, maxByNeighbours, maxByHalfNeighbour));
}

// Lay ordered main-visual clips end-to-end, pulling each clip earlier by the
// overlap of the transition that joins it to its predecessor.
export function layoutVisualTimeline(
  clips: readonly CompositionVisualClipInput[],
  transitions: readonly CompositionTransitionInput[],
  fps: number,
): CompositionVisualTimeline {
  const transitionByPair = new Map<string, CompositionTransitionInput>();
  for (const transition of transitions) {
    transitionByPair.set(
      transitionPairKey(transition.fromClipId, transition.toClipId),
      transition,
    );
  }

  const laid: CompositionClipTiming[] = [];
  let cursor = 0;
  let end = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const durationInFrames = clipDurationInFrames(clip.durationUs, fps);
    if (index > 0) {
      const previous = clips[index - 1];
      const transition = transitionByPair.get(
        transitionPairKey(previous.clipId, clip.clipId),
      );
      const overlap = transition
        ? transitionOverlapFrames(
          transition,
          laid[index - 1].durationInFrames,
          durationInFrames,
          fps,
        )
        : 0;
      cursor = end - overlap;
    }
    laid.push({ clipId: clip.clipId, from: cursor, durationInFrames });
    end = cursor + durationInFrames;
  }

  return { fps, clips: laid, durationInFrames: Math.max(1, end) };
}

function transitionPairKey(fromClipId: string, toClipId: string): string {
  return `${fromClipId}->${toClipId}`;
}
