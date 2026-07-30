// Design §6: unified microsecond→frame rounding shared by the Player and the
// fixed render bundle. Transition overlap shortens total duration to match the
// existing FFmpeg trim + blend + concat semantics (total = Σclip − Σoverlap).
//
// This module is pure and defines its own minimal input shapes. The host
// projects a validated TimelineRenderPlan into these before rendering, so the
// composition never imports the Zustand store, plan JSON, or Studio panels.

export const MICROSECONDS_PER_SECOND = 1_000_000;

// A transition effect of "cut" produces no overlap; every other effect blends
// the tail of the outgoing clip with the head of the incoming one. Mirrors the
// authoritative EditingTransition.effectId union (editing.ts) — no "slide".
export const COMPOSITION_TRANSITION_EFFECTS = [
  "cut",
  "fade",
  "crossfade",
  "flash",
  "blackout",
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
  // The timeline render compiler caps every non-cut transition at 15% of the
  // shorter clip before blending (timeline-render-compiler.ts).
  const maxByFfmpegTransition = Math.floor(Math.min(fromDurationInFrames, toDurationInFrames) * 0.15);
  return Math.max(0, Math.min(requested, maxByNeighbours, maxByFfmpegTransition));
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
