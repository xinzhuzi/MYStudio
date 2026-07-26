// Design §6: one audio clip (voice / BGM / SFX) mounted by time. Uses
// @remotion/media Audio with a frame-based volume callback that combines clip
// volume, fade and envelope (audio-volume.ts). Voice ducking is folded into the
// envelope by the host at projection time, so this stays a thin wrapper and the
// src is always a capability URL.

import { Audio } from "@remotion/media";
import type { CompositionAudioClipProps } from "./composition-props";
import { audioVolumeAtFrame } from "./audio-volume";

export function AudioClip(props: CompositionAudioClipProps): React.ReactElement {
  // The volume callback receives the Sequence-relative frame (0 == clip start),
  // matching how audioVolumeAtFrame interprets fade and envelope frames.
  const volumeAt = (frame: number): number =>
    audioVolumeAtFrame(frame, {
      volume: props.volume,
      durationInFrames: props.durationInFrames,
      fade: props.fade,
      envelope: props.envelope,
    });

  return (
    <Audio
      src={props.src}
      trimBefore={props.trimStartFrames}
      playbackRate={props.playbackRate ?? 1}
      volume={volumeAt}
    />
  );
}
