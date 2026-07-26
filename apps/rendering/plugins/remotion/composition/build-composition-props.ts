import type {
  EditingEffect,
  TimelineRenderClip,
  TimelineRenderPlan,
} from "@/types/editing";
import type {
  CompositionAudioClipProps,
  CompositionEnvelopePoint,
  CompositionFade,
  CompositionPanZoom,
  CompositionProps,
  CompositionTransform,
  CompositionTransitionProps,
  CompositionVisualClipProps,
} from "./composition-props";
import {
  clipDurationInFrames,
  layoutVisualTimeline,
  usToFrames,
} from "./timing";

const CAPABILITY_URL = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[A-Za-z0-9._~-]+$/;

export function buildCompositionProps(
  plan: TimelineRenderPlan,
  mediaUrlByClipId: Readonly<Record<string, string>>,
): CompositionProps {
  const fps = plan.renderSettings.fps;
  const visualClips = plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    fps,
  );
  const timingById = new Map(visualTiming.clips.map((timing) => [timing.clipId, timing]));
  const panZoomByClipId = new Map(
    plan.effects
      .filter((effect) => effect.effectId === "panZoom" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  const compositionVisuals: CompositionVisualClipProps[] = visualClips.map((clip) => {
    const timing = timingById.get(clip.id);
    if (!timing) throw new Error(`视觉片段缺少统一时序: ${clip.id}`);
    return {
      clipId: clip.id,
      kind: clip.source.kind === "storyboardVideo" || clip.source.kind === "videoCandidate"
        ? "video"
        : clip.trackKind === "video" && clip.source.kind !== "storyboardImage"
          ? "video"
          : "image",
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: timing.from,
      durationInFrames: timing.durationInFrames,
      transform: clip.transform ?? defaultTransform(),
      panZoom: panZoomForClip(panZoomByClipId.get(clip.id)),
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      muted: clip.muted,
    };
  });
  const audioClips: CompositionAudioClipProps[] = plan.clips
    .filter((clip) => clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx")
    .sort(compareTimelineClips)
    .map((clip) => ({
      clipId: clip.id,
      kind: audioKind(clip),
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: usToFrames(clip.startUs, fps),
      durationInFrames: clipDurationInFrames(clip.durationUs, fps),
      volume: clip.muted ? 0 : clip.volume,
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      fade: fadeForClip(clip, fps),
      envelope: envelopeForClip(clip, fps),
    }));
  const subtitles = plan.clips
    .filter((clip) => clip.trackKind === "text" && typeof clip.source.text === "string")
    .sort(compareTimelineClips)
    .map((clip) => ({
      cueId: clip.id,
      text: clip.source.text!.trim(),
      from: usToFrames(clip.startUs, fps),
      durationInFrames: clipDurationInFrames(clip.durationUs, fps),
    }))
    .filter((cue) => cue.text.length > 0);
  const transitions: CompositionTransitionProps[] = plan.transitions.map((transition) => {
    const from = timingById.get(transition.fromClipId);
    const to = timingById.get(transition.toClipId);
    if (!from || !to) throw new Error(`转场引用不存在的视觉片段: ${transition.id}`);
    return {
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      overlapFrames: Math.max(0, from.from + from.durationInFrames - to.from),
    };
  });
  return {
    width: plan.renderSettings.width,
    height: plan.renderSettings.height,
    fps,
    durationInFrames: visualTiming.durationInFrames,
    visualClips: compositionVisuals,
    transitions,
    audioClips,
    subtitles,
  };
}

function panZoomForClip(effect: Pick<EditingEffect, "params"> | undefined): CompositionPanZoom | undefined {
  if (!effect) return undefined;
  return {
    fromScale: numberParam(effect.params.scaleFrom, 1),
    toScale: numberParam(effect.params.scaleTo, 1.06),
    originX: numberParam(effect.params.x, 0.5),
    originY: numberParam(effect.params.y, 0.5),
  };
}

function fadeForClip(clip: TimelineRenderClip, fps: number): CompositionFade | undefined {
  if (clip.fadeInUs === undefined && clip.fadeOutUs === undefined) return undefined;
  return {
    fadeInFrames: usToFrames(clip.fadeInUs ?? 0, fps),
    fadeOutFrames: usToFrames(clip.fadeOutUs ?? 0, fps),
  };
}

function envelopeForClip(
  clip: TimelineRenderClip,
  fps: number,
): CompositionEnvelopePoint[] | undefined {
  return clip.envelope?.map((point) => ({
    frame: usToFrames(point.timeUs, fps),
    gain: point.gain,
  }));
}

function defaultTransform(): CompositionTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
}

function compareTimelineClips(left: TimelineRenderClip, right: TimelineRenderClip): number {
  return left.startUs - right.startUs || left.id.localeCompare(right.id);
}

function requireCapabilityUrl(value: string | undefined, clipId: string): string {
  if (!value || !CAPABILITY_URL.test(value)) {
    throw new Error(`片段 ${clipId} 缺少 127.0.0.1 capability URL`);
  }
  return value;
}

function numberParam(value: string | number | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function audioKind(clip: TimelineRenderClip): "voice" | "bgm" | "sfx" {
  if (clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx") {
    return clip.trackKind;
  }
  throw new Error(`非音频片段不能投影为音频: ${clip.id}`);
}
