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
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
} from "@/types/remotion-workspace";
import { validateRemotionCurrentSlot as validateCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
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

export interface ChapterVideoSourceInput {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
}

export interface ChapterVideoCompositionInput extends ChapterVideoSourceInput {
  mediaUrlByClipId: Readonly<Record<string, string>>;
  mediaUrlByBindingId: Readonly<Record<string, string>>;
}

export interface ChapterVoiceInterval {
  startFrame: number;
  endFrame: number;
}

export type ChapterVoiceIntervalResult =
  | { success: true; value: ChapterVoiceInterval[] }
  | { success: false; issues: Array<{ path: string; message: string }> };

export type ChapterVideoCompositionResult =
  | { success: true; value: ChapterVideoCompositionProps }
  | { success: false; issues: Array<{ path: string; message: string }> };

/**
 * Projects a validated chapter plan into the ChapterVideo target. Every
 * visual clip must be backed by the matching current Remotion shot slot. Shared
 * audio is projected only from the validated current chapter manifest.
 */
export function buildChapterVideoCompositionProps(
  input: ChapterVideoCompositionInput,
): ChapterVideoCompositionResult {
  const sourceValidation = inspectChapterVideoSource(input);
  if (!sourceValidation.success) return sourceValidation;

  const base = buildCompositionProps(input.plan, input.mediaUrlByClipId);
  const audioClips: Array<CompositionAudioClipProps & { renderScope: "chapter" }> =
    input.chapterManifest.sharedAudioBindings.flatMap((binding) => {
      const from = usToFrames(binding.chapterStartUs, base.fps);
      const requestedDurationInFrames = clipDurationInFrames(binding.durationUs, base.fps);
      const durationInFrames = Math.min(
        requestedDurationInFrames,
        Math.max(0, base.durationInFrames - from),
      );
      // A shared track may intentionally outlive the edited chapter. It is
      // still valid manifest data, but there is no frame to render after the
      // chapter boundary; omit that empty projection instead of handing
      // Remotion an out-of-range Sequence.
      if (durationInFrames <= 0) return [];
      return {
        clipId: binding.bindingId,
        kind: binding.role,
        src: requireCapabilityUrl(input.mediaUrlByBindingId[binding.bindingId], binding.bindingId),
        from,
        durationInFrames,
        volume: binding.volume,
        renderScope: "chapter",
        trimStartFrames: usToFrames(binding.sourceStartUs, base.fps),
        playbackRate: 1,
        fade: {
          fadeInFrames: Math.min(usToFrames(binding.fadeInUs, base.fps), durationInFrames),
          fadeOutFrames: Math.min(usToFrames(binding.fadeOutUs, base.fps), durationInFrames),
        },
        envelope: projectEnvelopeForDuration(binding.envelope, durationInFrames, base.fps),
        duckingEnvelope: buildDuckingEnvelope({
          voiceIntervals: sourceValidation.value,
          clipFrom: from,
          durationInFrames,
          ducking: binding.ducking,
          fps: base.fps,
        }),
      };
    });
  const props: ChapterVideoCompositionProps = {
    ...base,
    target: "chapter",
    projectId: input.plan.projectId,
    chapterId: input.plan.episodeId,
    editingProjectId: input.plan.editingProjectId,
    editingRevision: input.plan.editingRevision,
    visualClips: base.visualClips.map((clip) => ({ ...clip, muted: false })),
    audioClips,
  };
  const validation = validateChapterVideoCompositionProps(props);
  if (!validation.success) return { success: false, issues: validation.issues };
  return { success: true, value: validation.value };
}

function projectEnvelopeForDuration(
  envelope: RemotionChapterManifestV2["sharedAudioBindings"][number]["envelope"],
  durationInFrames: number,
  fps: number,
): CompositionEnvelopePoint[] {
  const projected = envelope
    .map((point) => ({ frame: usToFrames(point.timeUs, fps), gain: point.gain }))
    .filter((point) => point.frame <= durationInFrames);
  if (projected.length === 0) return [];
  if (projected[0]!.frame > 0) {
    projected.unshift({ frame: 0, gain: projected[0]!.gain });
  }
  const last = projected[projected.length - 1]!;
  if (last.frame < durationInFrames) {
    projected.push({ frame: durationInFrames, gain: last.gain });
  }
  return projected;
}

export function mapEditedVoiceIntervals(
  input: ChapterVideoSourceInput,
): ChapterVoiceIntervalResult {
  return inspectChapterVideoSource(input);
}

function inspectChapterVideoSource(
  input: ChapterVideoSourceInput,
): ChapterVoiceIntervalResult {
  const issues: Array<{ path: string; message: string }> = [];
  const manifest = input.chapterManifest;
  if (manifest.projectId !== input.plan.projectId
    || manifest.chapterId !== input.plan.episodeId
    || manifest.sourceSnapshotHash !== input.plan.sourceSnapshotHash) {
    issues.push({ path: "chapterManifest", message: "chapter manifest 与当前 plan 的 project/chapter/source identity 不一致" });
  }
  const editingAudio = input.plan.clips.filter((clip) => (
    clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx"
  ));
  if (editingAudio.length > 0) {
    issues.push({ path: "plan.clips", message: "ChapterVideo 禁止从 EditingProject 投影 voice/BGM/SFX 音频" });
  }
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
  const manifestShotById = new Map(manifest.shots.map((shot) => [shot.shotId, shot]));
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
    const manifestShot = storyboardId ? manifestShotById.get(storyboardId) : undefined;
    if (sourceKind !== "storyboardVideo" || !storyboardId || !slot) {
      issues.push({ path: `visualClips[${index}]`, message: "章节视觉片段必须绑定当前 Remotion shot MP4" });
      continue;
    }
    if (slot.target.kind !== "shot") {
      issues.push({ path: `visualClips[${index}]`, message: "章节视觉片段 current slot target 必须是 shot" });
      continue;
    }
    if (!manifestShot || manifestShot.storyboardId !== storyboardId) {
      issues.push({ path: `visualClips[${index}].source.evidence.storyboardId`, message: "视觉片段未精确匹配 chapter manifest shot/storyboard identity" });
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
    if (manifestShot.revision !== slot.target.shotRevision) {
      issues.push({ path: `chapterManifest.shots.${manifestShot.shotId}.revision`, message: "chapter manifest shot revision 与 current slot 不一致" });
    }
  }
  for (const { index, shotId } of validShotSlots) {
    if (!requiredShotIds.has(shotId)) {
      issues.push({ path: `currentShotSlots[${index}]`, message: "current shot slot 不得包含章节未引用的额外 shot" });
    }
  }
  const manifestRequired = new Set(manifest.requiredShotIds);
  if (manifestRequired.size !== requiredShotIds.size
    || [...requiredShotIds].some((shotId) => !manifestRequired.has(shotId))) {
    issues.push({ path: "chapterManifest.requiredShotIds", message: "chapter manifest required shots 与编辑后的视觉片段不一致" });
  }
  for (const binding of manifest.sharedAudioBindings) {
    if (binding.renderScope !== "chapter" || (binding.role !== "bgm" && binding.role !== "ambience")) {
      issues.push({ path: `chapterManifest.sharedAudioBindings.${binding.bindingId}`, message: "ChapterVideo 共享音频只允许 chapter-scoped BGM/ambience" });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    input.plan.transitions.map((transition) => ({
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      durationUs: transition.durationUs,
    })),
    input.plan.renderSettings.fps,
  );
  const timingById = new Map(visualTiming.clips.map((timing) => [timing.clipId, timing]));
  const voiceIntervals: ChapterVoiceInterval[] = [];
  for (const clip of visualClips) {
    const storyboardId = clip.source.evidence.storyboardId;
    const shot = manifestShotById.get(storyboardId!);
    const timing = timingById.get(clip.id);
    if (!shot || !timing) continue;
    const sourceEndUs = clip.trimStartUs + clip.durationUs * clip.speed;
    for (const binding of shot.audioBindings) {
      if (binding.role !== "voice") continue;
      const intersectionStartUs = Math.max(binding.shotStartUs, clip.trimStartUs);
      const intersectionEndUs = Math.min(binding.shotStartUs + binding.durationUs, sourceEndUs);
      if (intersectionEndUs <= intersectionStartUs) continue;
      const startFrame = Math.max(
        timing.from,
        timing.from + usToFrames((intersectionStartUs - clip.trimStartUs) / clip.speed, visualTiming.fps),
      );
      const endFrame = Math.min(
        timing.from + timing.durationInFrames,
        timing.from + usToFrames((intersectionEndUs - clip.trimStartUs) / clip.speed, visualTiming.fps),
      );
      if (endFrame > startFrame) voiceIntervals.push({ startFrame, endFrame });
    }
  }
  return { success: true, value: mergeVoiceIntervals(voiceIntervals) };
}

export function buildDuckingEnvelope(input: {
  voiceIntervals: readonly ChapterVoiceInterval[];
  clipFrom: number;
  durationInFrames: number;
  ducking: RemotionChapterManifestV2["sharedAudioBindings"][number]["ducking"];
  fps: number;
}): CompositionEnvelopePoint[] {
  if (!input.ducking.enabled || input.voiceIntervals.length === 0) {
    return [{ frame: 0, gain: 1 }, { frame: input.durationInFrames, gain: 1 }];
  }
  const holdGain = 10 ** (input.ducking.reductionDb / 20);
  const attackFrames = usToFrames(input.ducking.attackUs, input.fps);
  const releaseFrames = usToFrames(input.ducking.releaseUs, input.fps);
  const values = Array.from({ length: input.durationInFrames + 1 }, (_, localFrame) => {
    const chapterFrame = input.clipFrom + localFrame;
    let gain = 1;
    for (const interval of input.voiceIntervals) {
      gain = Math.min(gain, duckGainAtFrame(chapterFrame, interval, holdGain, attackFrames, releaseFrames));
    }
    return gain;
  });
  return compressFrameEnvelope(values);
}

function duckGainAtFrame(
  frame: number,
  interval: ChapterVoiceInterval,
  holdGain: number,
  attackFrames: number,
  releaseFrames: number,
): number {
  if (frame < interval.startFrame) {
    if (attackFrames === 0 || frame <= interval.startFrame - attackFrames) return 1;
    const progress = (frame - (interval.startFrame - attackFrames)) / attackFrames;
    return 1 + (holdGain - 1) * progress;
  }
  if (frame <= interval.endFrame) return holdGain;
  if (releaseFrames === 0 || frame >= interval.endFrame + releaseFrames) return 1;
  const progress = (frame - interval.endFrame) / releaseFrames;
  return holdGain + (1 - holdGain) * progress;
}

function compressFrameEnvelope(values: readonly number[]): CompositionEnvelopePoint[] {
  if (values.length <= 1) return [{ frame: 0, gain: values[0] ?? 1 }];
  const points: CompositionEnvelopePoint[] = [{ frame: 0, gain: values[0]! }];
  let previousSlope = values[1]! - values[0]!;
  for (let frame = 2; frame < values.length; frame += 1) {
    const slope = values[frame]! - values[frame - 1]!;
    if (Math.abs(slope - previousSlope) > 1e-12) {
      points.push({ frame: frame - 1, gain: values[frame - 1]! });
    }
    previousSlope = slope;
  }
  const lastFrame = values.length - 1;
  if (points.at(-1)?.frame !== lastFrame) points.push({ frame: lastFrame, gain: values[lastFrame]! });
  return points;
}

function mergeVoiceIntervals(intervals: readonly ChapterVoiceInterval[]): ChapterVoiceInterval[] {
  const ordered = [...intervals].sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  const merged: ChapterVoiceInterval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, interval.endFrame);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
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
