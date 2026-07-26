// Design §6: the frame-based volume callback for an audio clip. Combines the
// clip's static volume, its fade in/out ramps and its envelope into a single
// gain per frame, mirroring the FFmpeg volume expression intent. Voice ducking
// is folded into the envelope by the host at projection time, so this stays a
// pure function of the clip's own props and never needs cross-clip state.
//
// `frame` is relative to the clip start (0 == first frame of the clip), matching
// how Remotion's volume callback reports frames inside a Sequence.

import type {
  CompositionEnvelopePoint,
  CompositionFade,
} from "./composition-props";

export interface AudioVolumeInput {
  // Static clip gain (>= 0). 1 == unity.
  volume: number;
  durationInFrames: number;
  fade?: CompositionFade;
  // Envelope points in clip-relative frames, gain >= 0. Order-independent.
  envelope?: CompositionEnvelopePoint[];
}

// Linear fade-in over the first `fadeInFrames` and fade-out over the last
// `fadeOutFrames`. A zero-length ramp is a no-op. Ramps are clamped to [0, 1].
function fadeGain(frame: number, input: AudioVolumeInput): number {
  const fadeInFrames = input.fade?.fadeInFrames ?? 0;
  const fadeOutFrames = input.fade?.fadeOutFrames ?? 0;
  let gain = 1;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    gain = Math.min(gain, frame / fadeInFrames);
  }
  if (fadeOutFrames > 0) {
    const fadeOutStart = input.durationInFrames - fadeOutFrames;
    if (frame > fadeOutStart) {
      const remaining = input.durationInFrames - frame;
      gain = Math.min(gain, Math.max(0, remaining) / fadeOutFrames);
    }
  }
  return Math.max(0, Math.min(1, gain));
}

// Piecewise-linear envelope sampling. Before the first point holds the first
// gain; after the last point holds the last gain; between points interpolates.
function envelopeGain(
  frame: number,
  envelope: readonly CompositionEnvelopePoint[],
): number {
  const points = [...envelope].sort((left, right) => left.frame - right.frame);
  const first = points[0]!;
  if (frame <= first.frame) return first.gain;
  const last = points[points.length - 1]!;
  if (frame >= last.frame) return last.gain;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (frame <= current.frame) {
      const span = current.frame - previous.frame;
      if (span <= 0) return current.gain;
      const ratio = (frame - previous.frame) / span;
      return previous.gain + (current.gain - previous.gain) * ratio;
    }
  }
  return last.gain;
}

// Combined gain for a single frame: clip volume × fade × envelope, floored at 0.
export function audioVolumeAtFrame(frame: number, input: AudioVolumeInput): number {
  if (!Number.isFinite(input.volume) || input.volume < 0) {
    throw new Error(`音频音量必须是非负有限数值: ${input.volume}`);
  }
  let gain = input.volume * fadeGain(frame, input);
  if (input.envelope && input.envelope.length > 0) {
    gain *= envelopeGain(frame, input.envelope);
  }
  return Math.max(0, gain);
}
