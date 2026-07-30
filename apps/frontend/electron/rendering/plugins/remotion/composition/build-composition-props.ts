import type {
  EditingEffect,
  TimelineRenderClip,
  TimelineRenderPlan,
} from "@/types/editing";
import type {
  ChapterVideoCompositionProps,
  CompositionAudioClipProps,
  CompositionEnvelopePoint,
  CompositionFade,
  CompositionPanZoom,
  CompositionProps,
  CompositionTransform,
  CompositionTransitionProps,
  CompositionVisualClipProps,
} from "./composition-props";
import { validateChapterVideoCompositionProps } from "./composition-props-validation";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { validateCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";
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

export interface ChapterVideoCompositionInput {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  mediaUrlByClipId: Readonly<Record<string, string>>;
  chapterAudioClipIds: readonly string[];
}

export type ChapterVideoCompositionResult =
  | { success: true; value: ChapterVideoCompositionProps }
  | { success: false; issues: Array<{ path: string; message: string }> };

/**
 * Projects a validated chapter plan into the ChapterVideo target. Every
 * visual clip must be backed by the matching current Remotion shot slot; the
 * chapter audio allow-list makes the once-only mix boundary explicit.
 */
export function buildChapterVideoCompositionProps(
  input: ChapterVideoCompositionInput,
): ChapterVideoCompositionResult {
  const issues: Array<{ path: string; message: string }> = [];
  const slotsByShotId = new Map<string, RemotionCurrentSlotV1>();
  const validShotSlots: Array<{ index: number; shotId: string }> = [];
  for (const [index, slot] of input.currentShotSlots.entries()) {
    const validation = validateCurrentSlot(slot);
    if (!validation.success) {
      issues.push({ path: `currentShotSlots[${index}]`, message: validation.issues.map((issue) => issue.message).join("；") });
      continue;
    }
    if (validation.value.projectId !== input.plan.projectId
      || validation.value.target.kind !== "shot"
      || validation.value.target.chapterId !== input.plan.episodeId
      || validation.value.evidence.compositionId !== "StoryboardShot"
      || validation.value.evidence.renderer.actual !== "remotion") {
      issues.push({ path: `currentShotSlots[${index}]`, message: "shot current slot 不属于当前项目/章节或不是 Remotion 成功输出" });
      continue;
    }
    if (slotsByShotId.has(validation.value.target.shotId)) {
      issues.push({ path: `currentShotSlots[${index}]`, message: "同一 shot 不得提供多个 current slot" });
      continue;
    }
    slotsByShotId.set(validation.value.target.shotId, validation.value);
    validShotSlots.push({ index, shotId: validation.value.target.shotId });
  }

  const visualClips = input.plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  if (visualClips.length === 0) {
    issues.push({ path: "plan.clips", message: "章节必须包含至少一个 Remotion shot visual clip" });
  }
  const requiredShotIds = new Set<string>();
  for (const [index, clip] of visualClips.entries()) {
    const sourceKind = clip.source.kind;
    const storyboardId = typeof clip.source.evidence?.storyboardId === "string"
      ? clip.source.evidence.storyboardId
      : undefined;
    if (storyboardId) {
      if (requiredShotIds.has(storyboardId)) {
        issues.push({ path: `visualClips[${index}].source.evidence.storyboardId`, message: "章节不得重复绑定同一 Remotion shot" });
      }
      requiredShotIds.add(storyboardId);
    }
    const slot = storyboardId ? slotsByShotId.get(storyboardId) : undefined;
    if (sourceKind !== "storyboardVideo" || !storyboardId || !slot) {
      issues.push({ path: `visualClips[${index}]`, message: "章节视觉片段必须绑定当前 Remotion shot MP4" });
      continue;
    }
    if (clip.source.path !== slot.outputPath) {
      issues.push({ path: `visualClips[${index}].source.path`, message: "视觉片段路径与 current shot slot 不一致" });
    }
    if (clip.source.evidence?.remotionJobId !== slot.job.jobId
      || clip.source.evidence?.remotionEvidenceSha256 !== slot.evidence.sha256) {
      issues.push({ path: `visualClips[${index}].source.evidence`, message: "视觉片段缺少匹配的 Remotion job/evidence identity" });
    }
    if (slot.target.kind !== "shot" || clip.source.evidence?.outputVersion !== slot.target.shotRevision) {
      issues.push({ path: `visualClips[${index}].source.evidence.outputVersion`, message: "视觉片段 shot revision 与 current slot 不一致" });
    }
  }
  for (const { index, shotId } of validShotSlots) {
    if (!requiredShotIds.has(shotId)) {
      issues.push({ path: `currentShotSlots[${index}]`, message: "current shot slot 不得包含章节未引用的额外 shot" });
    }
  }

  const audioClips = input.plan.clips.filter((candidate) => (
    candidate.trackKind === "voice" || candidate.trackKind === "bgm" || candidate.trackKind === "sfx"
  ));
  const audioClipIds = new Set(audioClips.map((clip) => clip.id));
  const audioIds = new Set<string>();
  for (const [index, clipId] of input.chapterAudioClipIds.entries()) {
    if (typeof clipId !== "string" || !clipId.trim()) {
      issues.push({ path: `chapterAudioClipIds[${index}]`, message: "chapter audio ID 必须是非空字符串" });
      continue;
    }
    if (audioIds.has(clipId)) {
      issues.push({ path: `chapterAudioClipIds[${index}]`, message: "chapter audio ID 不得重复" });
    }
    audioIds.add(clipId);
    if (!audioClipIds.has(clipId)) {
      issues.push({ path: `chapterAudioClipIds[${index}]`, message: "chapter audio ID 未在当前章节计划中声明" });
    }
  }
  for (const clip of audioClips) {
    if (!audioIds.has(clip.id)) {
      issues.push({ path: `audioClips.${clip.id}`, message: "未显式声明为 chapter-scoped 音频，拒绝重复混音" });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  const base = buildCompositionProps(input.plan, input.mediaUrlByClipId);
  const props: ChapterVideoCompositionProps = {
    ...base,
    target: "chapter",
    projectId: input.plan.projectId,
    chapterId: input.plan.episodeId,
    editingProjectId: input.plan.editingProjectId,
    editingRevision: input.plan.editingRevision,
    visualClips: base.visualClips.map((clip) => ({ ...clip, muted: false })),
    audioClips: base.audioClips
      .filter((clip) => audioIds.has(clip.clipId))
      .map((clip) => ({ ...clip, renderScope: "chapter" as const })),
  };
  const validation = validateChapterVideoCompositionProps(props);
  if (!validation.success) return { success: false, issues: validation.issues };
  return { success: true, value: validation.value };
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
