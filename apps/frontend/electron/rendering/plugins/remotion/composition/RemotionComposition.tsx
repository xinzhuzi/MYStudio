import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { AudioClip } from "./AudioClip";
import { CinematicVisualClip } from "./CinematicVisualClip";
import { LayeredVisualClip } from "./LayeredVisualClip";
import { CustomFontFaceLoader } from "./CustomFontFaceLoader";
import { GLTransitionLayer } from "./GLTransitionLayer";
import { isGlTransitionEffect } from "./gl-transition-registry";
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
      {props.customFonts?.length ? <CustomFontFaceLoader fonts={props.customFonts} /> : null}
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
        <GLTransitionOrOverlay
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
      {/* GLTransitionLayer 的 ThreeCanvas 带 zIndex:2;字幕须恒居其上
          (editing-audio-subtitles.md:Remotion 拥有最终可见字幕层),
          否则 gl:* 转场四边形整个 overlap 窗口盖掉燃嵌字幕
          (预览走 DOM crossfade 兜底无 zIndex,不吞——预览/渲染就此不一致)。 */}
      <AbsoluteFill style={{ zIndex: 3 }}>
        <SubtitleTrack cues={props.subtitles} font={props.subtitleFont} />
      </AbsoluteFill>
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
  const transitionStyle = incoming
    ? transitionStyleAtFrame(incoming.effectId, frame, incoming.overlapFrames)
    : undefined;
  const incomingOpacity = transitionStyle?.incomingOpacity ?? 1;
  // 水墨晕染转场(08-19 第二批):进场镜头用双 blob 扩张遮罩揭示 + 递减模糊
  const inkMask = transitionStyle?.inkReveal !== undefined
    ? `radial-gradient(circle at 50% 46%, black ${(transitionStyle.inkReveal * 68).toFixed(1)}%, rgba(0,0,0,0.75) ${(transitionStyle.inkReveal * 84).toFixed(1)}%, transparent ${(transitionStyle.inkReveal * 100).toFixed(1)}%), radial-gradient(circle at 68% 40%, black ${(transitionStyle.inkReveal * 42).toFixed(1)}%, transparent ${(transitionStyle.inkReveal * 62).toFixed(1)}%)`
    : undefined;
  return (
    <AbsoluteFill
      style={{
        opacity: incomingOpacity,
        ...(inkMask
          ? {
              WebkitMaskImage: inkMask,
              maskImage: inkMask,
              filter: `blur(${transitionStyle?.inkBlurPx ?? 0}px)`,
            }
          : {}),
      }}
    >
      {clip.cinematic ? (
        <CinematicVisualClip {...clip} />
      ) : clip.layerStack?.length ? (
        <LayeredVisualClip
          layerStack={clip.layerStack}
          durationInFrames={clip.durationInFrames}
          panZoom={clip.panZoom}
          ambient={clip.ambient}
          fx={clip.fx}
          grade={clip.grade}
          frameStep={clip.frameStep}
          baseSrc={clip.src}
          baseKind={clip.kind}
          trimStartFrames={clip.trimStartFrames}
          playbackRate={clip.playbackRate}
          muted={clip.muted}
        />
      ) : clip.layers ? (
        <LayeredVisualClip
          backgroundSrc={clip.layers.backgroundSrc}
          subjectSrc={clip.layers.subjectSrc}
          parallax={clip.layers.parallax}
          durationInFrames={clip.durationInFrames}
          panZoom={clip.panZoom}
          ambient={clip.ambient}
          grade={clip.grade}
          frameStep={clip.frameStep}
        />
      ) : (
        <VisualClip {...clip} />
      )}
    </AbsoluteFill>
  );
}

function GLTransitionOrOverlay({
  transition,
  clips,
}: {
  transition: CompositionTransitionProps;
  clips: CompositionProps["visualClips"];
}): React.ReactElement | null {
  if (isGlTransitionEffect(transition.effectId) && transition.overlapFrames > 0) {
    const from = clips.find((clip) => clip.clipId === transition.fromClipId);
    const to = clips.find((clip) => clip.clipId === transition.toClipId);
    if (!from || !to) return null;
    return (
      <Sequence
        from={from.from + from.durationInFrames - transition.overlapFrames}
        durationInFrames={transition.overlapFrames}
        layout="none"
      >
        <GLTransitionLayer transition={transition} fromClip={from} toClip={to} />
      </Sequence>
    );
  }
  return <TransitionOverlay transition={transition} clips={clips} />;
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
  if (style.impactInvert) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          mixBlendMode: "difference",
          opacity: 1,
        }}
      />
    );
  }
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
