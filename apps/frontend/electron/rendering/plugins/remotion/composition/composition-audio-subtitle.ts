import path from "node:path";
import type { CompositionEnvelopePoint, CompositionOverlayClipProps } from "./composition-props";
import { MICROSECONDS_PER_SECOND, clipDurationInFrames, layoutVisualTimeline, usToFrames } from "./timing";
import { parseProjectFileUrl } from "@/electron/storage/storage-paths";
import { validateRemotionCurrentSlot as validateCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import type { TimelineRenderClip } from "@/types/editing";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { ChapterVideoCompositionInput, ChapterVideoSourceInput, ChapterVoiceInterval, ChapterVoiceIntervalResult } from "./composition-chapter-video";
import { compareTimelineClips } from "./composition-clip-effects";

/**
 * 字幕与音频包络——可读字幕轴/语音区间/HyperFrames 覆盖/源检查/ducking 包络/转场语音安全。file-size-reduction P1 拆出,体逐字保留。
 */
const SUBTITLE_READ_CHARS_PER_SEC = 4.5;
const SUBTITLE_MIN_DURATION_US = 900_000;

interface SubtitleCueDraft {
  cueId: string;
  text: string;
  from: number;
  audioSpanFrames: number;
}

/**
 * 把音频对齐的句级 cue 投影成可读字幕：停留时长取 max(语音时长, 可读下限)，
 * 延长只占语音结束后的静默段（画面应等语音与字幕结束再切，见转场钳制），
 * 且不得越过下一条 cue 的起点（防双字幕同屏）与 composition 末帧
 * （fail-closed 校验禁止越界 Sequence）。
 */
export function readableSubtitleCues(
  drafts: readonly SubtitleCueDraft[],
  compositionDurationInFrames: number,
  fps: number,
): Array<{ cueId: string; text: string; from: number; durationInFrames: number }> {
  const projected = drafts.map((draft) => ({ ...draft, durationInFrames: 0 }));
  for (let index = 0; index < projected.length; index += 1) {
    const cue = projected[index]!;
    const next = projected[index + 1];
    const ceiling = Math.min(
      compositionDurationInFrames,
      next ? next.from - 1 : Number.MAX_SAFE_INTEGER,
    );
    const minReadableFrames = usToFrames(
      Math.max(
        SUBTITLE_MIN_DURATION_US,
        Math.ceil((cue.text.length / SUBTITLE_READ_CHARS_PER_SEC) * MICROSECONDS_PER_SECOND),
      ),
      fps,
    );
    cue.durationInFrames = Math.max(
      1,
      Math.min(ceiling - cue.from, Math.max(cue.audioSpanFrames, minReadableFrames)),
    );
  }
  return projected.map(({ cueId, text, from, durationInFrames }) => ({
    cueId,
    text,
    from,
    durationInFrames,
  }));
}

export function projectEnvelopeForDuration(
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

export function projectHyperFramesOverlay(
  overlay: ChapterVideoCompositionInput["hyperFramesOverlay"],
  compositionDurationInFrames: number,
  fps: number,
): CompositionOverlayClipProps[] {
  if (!overlay || overlay.windows.length === 0) return [];
  const endUs = Math.max(...overlay.windows.map((window) => window.startUs + window.durationUs));
  const durationInFrames = clipDurationInFrames(endUs, fps);
  if (durationInFrames > compositionDurationInFrames) {
    throw new Error("HyperFrames overlay 时长超出 ChapterVideo composition");
  }
  return [{
    clipId: "hyperframes-overlay",
    src: overlay.src,
    from: 0,
    durationInFrames,
  }];
}

export function inspectChapterVideoSource(
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
  // flat-shot-mp4 projection deliberately has one clean MP4 visual clip and
  // no storyboardId. It still carries the accepted artifact fingerprint so
  // the final gate can bind the source without pretending it is 43 shots.
  const flatProjection = visualClips.length === 1
    && visualClips[0]?.source.kind === "storyboardVideo"
    && typeof visualClips[0]?.source.evidence?.storyboardId !== "string";
  if (flatProjection) {
    const clip = visualClips[0]!;
    const sourcePath = clip.source.path?.trim() ?? "";
    if (!path.isAbsolute(sourcePath)) {
      issues.push({ path: "visualClips[0].source.path", message: "flat-shot-mp4 必须绑定绝对 clean MP4 路径" });
    }
    if (!isSha256(clip.source.evidence?.sourceFingerprint)) {
      issues.push({ path: "visualClips[0].source.evidence.sourceFingerprint", message: "flat-shot-mp4 缺少 video-use artifact SHA-256" });
    }
    if (input.videoWorkflowGate) {
      if (input.videoWorkflowGate.mode !== "flat-shot-mp4") {
        issues.push({ path: "videoWorkflowGate.mode", message: "flat projection 必须绑定 flat-shot-mp4 gate" });
      } else {
        if (clip.source.evidence?.sourceFingerprint !== input.videoWorkflowGate.videoUseArtifactSha256) {
          issues.push({ path: "visualClips[0].source.evidence.sourceFingerprint", message: "flat clean MP4 未绑定当前 video-use artifact" });
        }
        if (!input.videoWorkflowGate.videoUseFlatShotMp4Path
          || !pathsEquivalentForComposition(sourcePath, input.videoWorkflowGate.videoUseFlatShotMp4Path)) {
          issues.push({ path: "visualClips[0].source.path", message: "flat clean MP4 路径与 video-use gate 不一致" });
        }
      }
    }
  }
  const requiredShotIds = new Set<string>();
  const manifestShotById = new Map(manifest.shots.map((shot) => [shot.shotId, shot]));
  for (const [index, clip] of visualClips.entries()) {
    if (flatProjection) continue;
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
    const requestedSourcePath = clip.source.path?.trim() ?? "";
    const resolvedCurrentSlotPath = input.currentShotSlotPaths?.[storyboardId] ?? slot.outputPath;
    const requestedProjectRelativePath = projectFileRelativePath(requestedSourcePath, input.plan.projectId);
    const matchesCurrentSlot = requestedSourcePath === slot.outputPath
      || requestedProjectRelativePath === slot.outputPath
      || pathsEquivalentForComposition(requestedSourcePath, resolvedCurrentSlotPath);
    const matchesAcceptedDerivedInput = !matchesCurrentSlot
      && input.videoWorkflowGate?.mode === "editable-edl"
      && clip.source.evidence?.sourceFingerprint === input.videoWorkflowGate.videoUseArtifactSha256
      && path.isAbsolute(requestedSourcePath)
      && input.videoWorkflowGate.videoUseDerivedInputs?.some((entry) =>
        path.resolve(entry.derivedPath) === path.resolve(requestedSourcePath),
      );
    // Identity construction runs before the final gate is available. Allow a
    // clearly marked absolute derived path to participate in the hash, while
    // the accepted gate below remains mandatory before any media is rendered.
    const provisionalDerivedInput = !matchesCurrentSlot
      && !input.videoWorkflowGate
      && path.isAbsolute(requestedSourcePath)
      && isSha256(clip.source.evidence?.sourceFingerprint);
    if (!matchesCurrentSlot && !matchesAcceptedDerivedInput && !provisionalDerivedInput) {
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
  if (!flatProjection) {
    for (const { index, shotId } of validShotSlots) {
      if (!requiredShotIds.has(shotId)) {
        issues.push({ path: `currentShotSlots[${index}]`, message: "current shot slot 不得包含章节未引用的额外 shot" });
      }
    }
  }
  const manifestRequired = new Set(manifest.requiredShotIds);
  if (!flatProjection && (manifestRequired.size !== requiredShotIds.size
    || [...requiredShotIds].some((shotId) => !manifestRequired.has(shotId)))) {
    issues.push({ path: "chapterManifest.requiredShotIds", message: "chapter manifest required shots 与编辑后的视觉片段不一致" });
  }
  for (const binding of manifest.sharedAudioBindings) {
    if (binding.renderScope !== "chapter" || (binding.role !== "bgm" && binding.role !== "ambience")) {
      issues.push({ path: `chapterManifest.sharedAudioBindings.${binding.bindingId}`, message: "ChapterVideo 共享音频只允许 chapter-scoped BGM/ambience/sfx" });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  if (flatProjection) return { success: true, value: [] };

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
  const transitionIssues = validateTransitionVoiceSafety(
    input.plan.transitions,
    visualClips,
    timingById,
    manifestShotById,
    visualTiming.fps,
    input.plan.clips.filter((clip) => clip.trackKind === "text"),
  );
  if (transitionIssues.length > 0) return { success: false, issues: transitionIssues };
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

function pathsEquivalentForComposition(left: string, right: string): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) => path.normalize(value.replace(/^\/private\/var(?:\/|$)/, "/var/"));
  return normalize(left) === normalize(right);
}

function projectFileRelativePath(sourcePath: string, projectId: string): string | null {
  try {
    const parsed = parseProjectFileUrl(sourcePath);
    return parsed?.projectId === projectId ? parsed.relativePath : null;
  } catch {
    return null;
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
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

/**
 * 章节转场安全门禁：shot MP4 内烧录语音（voice 绑定从头起播），转场重叠会把
 * 下一镜整体提前——重叠一旦越过上一镜语音尾，两镜语音就会在溶镜里同时播放
 * （拼接点"挤压感"的根源）。fail-closed：转场只允许吃上一镜语音结束后的静默尾。
 */
export function validateTransitionVoiceSafety(
  transitions: ReadonlyArray<{ fromClipId: string; toClipId: string; effectId: string }>,
  visualClips: ReadonlyArray<Pick<TimelineRenderClip, "id" | "trackKind" | "startUs" | "durationUs" | "trimStartUs" | "speed" | "source">>,
  timingById: ReadonlyMap<string, { from: number; durationInFrames: number }>,
  manifestShotById: ReadonlyMap<string, RemotionChapterManifestV2["shots"][number]>,
  fps: number,
  textClips: ReadonlyArray<Pick<TimelineRenderClip, "trackKind" | "startUs" | "durationUs" | "source">> = [],
): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  const clipById = new Map(visualClips.map((clip) => [clip.id, clip]));
  for (const [index, transition] of transitions.entries()) {
    if (transition.effectId === "cut") continue;
    const fromClip = clipById.get(transition.fromClipId);
    const toTiming = timingById.get(transition.toClipId);
    const fromTiming = timingById.get(transition.fromClipId);
    if (!fromClip || !fromTiming || !toTiming) continue;
    const storyboardId = fromClip.source.evidence?.storyboardId;
    const shot = typeof storyboardId === "string" ? manifestShotById.get(storyboardId) : undefined;
    if (!shot) continue;
    const sourceEndUs = fromClip.trimStartUs + fromClip.durationUs * fromClip.speed;
    let voiceBindingEndUs = -Infinity;
    for (const binding of shot.audioBindings) {
      if (binding.role !== "voice") continue;
      voiceBindingEndUs = Math.max(voiceBindingEndUs, Math.min(binding.shotStartUs + binding.durationUs, sourceEndUs));
    }
    if (voiceBindingEndUs === -Infinity) continue;
    // Whisper/alignment-backed text clips carry the sentence-level spoken end.
    // Prefer that evidence over the full WAV binding, whose trailing silence is
    // intentionally retained for shot padding. If no exact cue exists, keep the
    // conservative binding end (fail-closed).
    const alignedTextEndUs = textClips
      .filter((clip) => clip.trackKind === "text"
        && clip.source.evidence?.storyboardId === storyboardId
        && Number.isFinite(clip.startUs)
        && Number.isFinite(clip.durationUs)
        && clip.durationUs > 0)
      .reduce((latestEndUs, clip) => {
        const sourceRelativeEndUs = fromClip.trimStartUs
          + Math.max(0, (clip.startUs + clip.durationUs - fromClip.startUs) * fromClip.speed);
        return Math.max(latestEndUs, Math.min(sourceRelativeEndUs, sourceEndUs));
      }, -Infinity);
    const voiceEndUs = alignedTextEndUs === -Infinity
      ? voiceBindingEndUs
      : Math.min(voiceBindingEndUs, alignedTextEndUs);
    const voiceEndFrame = fromTiming.from
      + usToFrames((voiceEndUs - fromClip.trimStartUs) / fromClip.speed, fps);
    if (toTiming.from < voiceEndFrame - 1) {
      issues.push({
        path: `plan.transitions[${index}]`,
        message: `转场 ${transition.effectId} 重叠侵入上一镜语音区：下一镜提前到第 ${toTiming.from} 帧，上一镜语音到第 ${voiceEndFrame} 帧才结束——重叠只允许吃上一镜语音结束后的静默尾`,
      });
    }
  }
  return issues;
}

// 转场→音效语义映射（08-18-sfx-beat；Kenney CC0，assets/sfx/）。

export const TEXT_HYPERFRAMES_TEMPLATES = new Set(["title-card", "kinetic-caption"]);
