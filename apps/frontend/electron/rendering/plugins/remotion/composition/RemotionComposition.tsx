import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { AudioClip } from "./AudioClip";
import { CinematicVisualClip } from "./CinematicVisualClip";
import type {
  CompositionProps,
  CompositionTransitionProps,
  CompositionVisualClipProps,
} from "./composition-props";
import { SilentAudioTrack } from "./SilentAudioTrack";
import { SubtitleTrack } from "./SubtitleTrack";
import { transitionStyleAtFrame } from "./transition-style";
import { VisualClip } from "./VisualClip";

/** Shared composition mounted by both Player and the fixed bundle. */
export function RemotionComposition(props: CompositionProps): React.ReactElement {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {props.visualClips.map((clip) => (
        <Sequence
          key={clip.clipId}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
          layout="none"
        >
          <TransitionedVisualClip
            clip={clip}
            incoming={props.transitions.find((transition) => transition.toClipId === clip.clipId)}
          />
        </Sequence>
      ))}
      {props.transitions.map((transition) => (
        <TransitionOverlay
          key={`${transition.fromClipId}:${transition.toClipId}`}
          transition={transition}
          clips={props.visualClips}
        />
      ))}
      <OverlayTrack clips={props.overlayClips ?? []} />
      {props.audioClips.length === 0
        ? <SilentAudioTrack durationInFrames={props.durationInFrames} />
        : props.audioClips.map((clip) => (
          <Sequence
            key={clip.clipId}
            from={clip.from}
            durationInFrames={clip.durationInFrames}
            layout="none"
          >
            <AudioClip {...clip} />
          </Sequence>
        ))}
      <SubtitleTrack cues={props.subtitles} />
    </AbsoluteFill>
  );
}

function OverlayTrack({
  clips,
}: {
  clips: NonNullable<CompositionProps["overlayClips"]>;
}): React.ReactElement {
  return (
    <AbsoluteFill>
      {clips.map((clip) => (
        <Sequence
          key={clip.clipId}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
          layout="none"
        >
          {/* HyperFrames overlays ship as ProRes 4444 with alpha; without
              `transparent` OffthreadVideo drops the alpha channel and the
              mostly-transparent overlay renders as an opaque black/white
              layer covering the entire chapter video. */}
          <OffthreadVideo src={clip.src} muted transparent style={OVERLAY_STYLE} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function TransitionedVisualClip({
  clip,
  incoming,
}: {
  clip: CompositionVisualClipProps;
  incoming?: CompositionTransitionProps;
}): React.ReactElement {
  const frame = useCurrentFrame();
  const incomingOpacity = incoming
    ? transitionStyleAtFrame(incoming.effectId, frame, incoming.overlapFrames).incomingOpacity
    : 1;
  return (
    <AbsoluteFill style={{ opacity: incomingOpacity }}>
      {clip.cinematic ? <CinematicVisualClip {...clip} /> : <VisualClip {...clip} />}
    </AbsoluteFill>
  );
}

function TransitionOverlay({
  transition,
  clips,
}: {
  transition: CompositionTransitionProps;
  clips: CompositionProps["visualClips"];
}): React.ReactElement | null {
  if (transition.overlapFrames <= 0
    || transition.effectId === "cut"
    || transition.effectId === "crossfade") {
    return null;
  }
  const from = clips.find((clip) => clip.clipId === transition.fromClipId);
  if (!from) return null;
  return (
    <Sequence
      from={from.from + from.durationInFrames - transition.overlapFrames}
      durationInFrames={transition.overlapFrames}
      layout="none"
    >
      <TransitionOverlayFrame transition={transition} />
    </Sequence>
  );
}

function TransitionOverlayFrame({
  transition,
}: {
  transition: CompositionTransitionProps;
}): React.ReactElement | null {
  const style = transitionStyleAtFrame(
    transition.effectId,
    useCurrentFrame(),
    transition.overlapFrames,
  );
  if (style.overlayOpacity <= 0 || !style.overlayColor) return null;
  return (
    <AbsoluteFill
      style={{
        opacity: style.overlayOpacity,
        backgroundColor: style.overlayColor,
      }}
    />
  );
}

const OVERLAY_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
};
