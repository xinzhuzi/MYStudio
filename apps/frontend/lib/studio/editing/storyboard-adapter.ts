import type {
  EditingClip,
  EditingClipSource,
  EditingProjectV1,
  EditingRenderSettings,
  EditingValidationIssue,
  EditingValidationResult,
} from "@/types/editing";
import { DEFAULT_EDITING_AUDIO_DUCKING } from "./audio-policy";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { validateRemotionCurrentSlot as validateCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import { validateEditingProject } from "./validation";
import {
  indexCandidateTrimStarts,
  indexSelectedCandidates,
  indexTracksByStoryboard,
} from "./storyboard-indexes";

const US_PER_SECOND = 1_000_000;
const VOICE_TAIL_PADDING_US = 200_000;

export interface BuildStoryboardEditingProjectInput {
  projectId: string;
  episodeId: string;
  editingProjectId: string;
  name?: string;
  sourceSnapshotHash: string;
  sourceRunId?: string;
  createdAt: number;
  aspectRatio?: string;
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  /** When provided, Remotion current shot slots are the only visual source. */
  remotionShotSlots?: RemotionCurrentSlotV1[];
  voiceDurationsUs?: Record<string, number>;
  voiceTailPaddingUs?: number;
  directorPlan?: ScriptPlan;
}

export interface EditingDirectorHints {
  transitions?: string;
  soundDirection?: string;
  storyboardSounds: Array<{ storyboardId: string; sound: string }>;
}

export type StoryboardEditingAdapterResult =
  | {
      success: true;
      project: EditingProjectV1;
      hints: EditingDirectorHints;
    }
  | {
      success: false;
      missingVisualStoryboardIds: string[];
      missingAudioStoryboardIds: string[];
      invalidDurationStoryboardIds: string[];
      invalidVoiceDurationStoryboardIds: string[];
      episodeMissing?: boolean;
    };

export interface LegacySimpleTimelineClip {
  id: string;
  mediaId: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
  duration: number;
  startTime: number;
}

export interface MigrateLegacySimpleTimelineInput {
  projectId: string;
  episodeId: string;
  editingProjectId: string;
  sourceSnapshotHash: string;
  sourceRunId?: string;
  createdAt: number;
  aspectRatio?: string;
  clips: LegacySimpleTimelineClip[];
}

interface StoryboardTiming {
  storyboard: StoryboardItem;
  baseDurationUs: number;
  voiceDurationUs?: number;
  durationUs: number;
  subtitle?: string;
}

interface VisualSelection {
  source: EditingClipSource;
  trimStartUs: number;
}

export function buildStoryboardEditingProject(
  input: BuildStoryboardEditingProjectInput,
): StoryboardEditingAdapterResult {
  const storyboards = input.storyboards
    .filter((item) => item.episodeId === input.episodeId)
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  const tracks = input.productionTracks.filter(
    (track) => track.episodeId === input.episodeId,
  );
  if (storyboards.length === 0) {
    return {
      success: false,
      missingVisualStoryboardIds: [],
      missingAudioStoryboardIds: [],
      invalidDurationStoryboardIds: [],
      invalidVoiceDurationStoryboardIds: [],
      episodeMissing: true,
    };
  }
  const trackByStoryboardId = indexTracksByStoryboard(tracks);
  const selectedCandidateByTrackId = indexSelectedCandidates(
    tracks,
    input.videoCandidates,
  );
  const baseDurationByStoryboardId = new Map<string, number>();
  const invalidDurationStoryboardIds: string[] = [];
  const invalidVoiceDurationStoryboardIds: string[] = [];

  for (const storyboard of storyboards) {
    const baseDurationUs = storyboardBaseDurationUs(storyboard);
    if (baseDurationUs === null) {
      invalidDurationStoryboardIds.push(storyboard.id);
    } else {
      baseDurationByStoryboardId.set(storyboard.id, baseDurationUs);
    }
    const voiceDurationUs = input.voiceDurationsUs?.[storyboard.id];
    if (voiceDurationUs !== undefined && !isPositiveSafeInteger(voiceDurationUs)) {
      invalidVoiceDurationStoryboardIds.push(storyboard.id);
    }
  }

  const candidateTrimStartByStoryboardId = indexCandidateTrimStarts(
    tracks,
    storyboards,
    baseDurationByStoryboardId,
  );
  const visualSelectionByStoryboardId = new Map<string, VisualSelection>();
  const missingVisualStoryboardIds: string[] = [];
  const missingAudioStoryboardIds: string[] = [];
  const remotionSlotByShotId = input.remotionShotSlots === undefined
    ? undefined
    : new Map(
        input.remotionShotSlots
          .map((slot) => [remotionShotId(slot), slot] as const)
          .filter((entry): entry is readonly [string, RemotionCurrentSlotV1] => Boolean(entry[0])),
      );

  for (const storyboard of storyboards) {
    const track = trackByStoryboardId.get(storyboard.id);
    const candidate = track
      ? selectedCandidateByTrackId.get(track.id)
      : undefined;
    const selection = selectVisualSource(
      storyboard,
      track,
      candidate,
      candidateTrimStartByStoryboardId.get(storyboard.id) ?? 0,
      remotionSlotByShotId?.get(storyboard.id),
      input.remotionShotSlots !== undefined,
      input.projectId,
      input.episodeId,
    );
    if (selection) visualSelectionByStoryboardId.set(storyboard.id, selection);
    else missingVisualStoryboardIds.push(storyboard.id);

    if (subtitleText(storyboard) && !isAudioRef(storyboard.audioRef)) {
      missingAudioStoryboardIds.push(storyboard.id);
    }
  }

  if (
    missingVisualStoryboardIds.length > 0
    || missingAudioStoryboardIds.length > 0
    || invalidDurationStoryboardIds.length > 0
    || invalidVoiceDurationStoryboardIds.length > 0
  ) {
    return {
      success: false,
      missingVisualStoryboardIds,
      missingAudioStoryboardIds,
      invalidDurationStoryboardIds,
      invalidVoiceDurationStoryboardIds,
    };
  }

  const timings = storyboards.map<StoryboardTiming>((storyboard) => {
    const baseDurationUs = baseDurationByStoryboardId.get(storyboard.id);
    if (baseDurationUs === undefined) {
      throw new Error(`分镜 ${storyboard.id} 通过 preflight 后缺少基础时长`);
    }
    const voiceDurationUs = input.voiceDurationsUs?.[storyboard.id];
    return {
      storyboard,
      baseDurationUs,
      voiceDurationUs,
      durationUs: voiceDurationUs && voiceDurationUs > baseDurationUs
        ? voiceDurationUs + (input.voiceTailPaddingUs ?? VOICE_TAIL_PADDING_US)
        : baseDurationUs,
      subtitle: subtitleText(storyboard),
    };
  });

  const mainTrackId = `${input.editingProjectId}-main-visual`;
  const voiceTrackId = `${input.editingProjectId}-voice`;
  const subtitleTrackId = `${input.editingProjectId}-subtitles`;
  const visualClips: EditingClip[] = [];
  const voiceClips: EditingClip[] = [];
  const subtitleClips: EditingClip[] = [];
  let startUs = 0;

  for (const timing of timings) {
    const { storyboard } = timing;
    const visual = visualSelectionByStoryboardId.get(storyboard.id);
    if (!visual) {
      throw new Error(`分镜 ${storyboard.id} 通过 preflight 后缺少画面来源`);
    }
    visualClips.push({
      id: `visual-${storyboard.id}`,
      trackId: mainTrackId,
      name: `分镜 ${storyboard.index}`,
      source: visual.source,
      startUs,
      durationUs: timing.durationUs,
      trimStartUs: visual.trimStartUs,
      speed: 1,
      volume: 0,
      muted: true,
    });

    if (isAudioRef(storyboard.audioRef)) {
      voiceClips.push({
        id: `voice-${storyboard.id}`,
        trackId: voiceTrackId,
        name: `口播 ${storyboard.index}`,
        source: {
          kind: "audio",
          path: storyboard.audioRef.path,
          evidence: storyboardEvidence(storyboard),
        },
        startUs,
        durationUs: timing.voiceDurationUs ?? timing.baseDurationUs,
        trimStartUs: 0,
        speed: 1,
        volume: 1,
        muted: false,
      });
    }

    if (timing.subtitle) {
      subtitleClips.push({
        id: `subtitle-${storyboard.id}`,
        trackId: subtitleTrackId,
        name: `字幕 ${storyboard.index}`,
        source: {
          kind: "text",
          text: timing.subtitle,
          evidence: storyboardEvidence(storyboard),
        },
        startUs,
        durationUs: timing.durationUs,
        trimStartUs: 0,
        speed: 1,
        volume: 0,
        muted: true,
      });
    }
    startUs += timing.durationUs;
  }

  const project: EditingProjectV1 = {
    schemaVersion: 1,
    id: input.editingProjectId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    name: input.name?.trim() || "自动剪辑草案 1",
    revision: 1,
    sourceSnapshotHash: input.sourceSnapshotHash,
    sourceRunId: input.sourceRunId,
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: renderSettings(input.aspectRatio),
    tracks: [
      editingTrack(mainTrackId, "video", "主画面", 0, visualClips),
      ...(voiceClips.length > 0
        ? [editingTrack(voiceTrackId, "voice", "逐镜口播", 1, voiceClips)]
        : []),
      ...(subtitleClips.length > 0
        ? [editingTrack(subtitleTrackId, "text", "字幕", 2, subtitleClips)]
        : []),
    ],
    clips: [...visualClips, ...voiceClips, ...subtitleClips],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };

  return {
    success: true,
    project,
    hints: directorHints(
      input.directorPlan?.episodeId === input.episodeId
        ? input.directorPlan
        : undefined,
      storyboards,
    ),
  };
}

export function migrateLegacySimpleTimeline(
  input: MigrateLegacySimpleTimelineInput,
): EditingValidationResult<EditingProjectV1> {
  const issues: EditingValidationIssue[] = [];
  if (input.clips.length === 0) {
    issues.push({
      code: "editing.legacy.empty",
      path: "$.clips",
      message: "旧时间线没有可迁移片段",
    });
  }
  for (const [index, clip] of input.clips.entries()) {
    const path = `$.clips[${index}]`;
    if (!clip.id.trim()) {
      issues.push({ code: "editing.legacy.id", path: `${path}.id`, message: "旧片段 ID 为空" });
    }
    if (!clip.mediaId.trim()) {
      issues.push({ code: "editing.legacy.media_id", path: `${path}.mediaId`, message: "旧片段素材 ID 为空" });
    }
    if (!clip.name.trim()) {
      issues.push({ code: "editing.legacy.name", path: `${path}.name`, message: "旧片段名称为空" });
    }
    if (!clip.url.trim()) {
      issues.push({ code: "editing.legacy.url", path: `${path}.url`, message: "旧片段路径为空" });
    }
    if (secondsToPositiveUs(clip.duration) === null) {
      issues.push({ code: "editing.legacy.duration", path: `${path}.duration`, message: "旧片段时长必须大于 0" });
    }
    if (secondsToNonNegativeUs(clip.startTime) === null) {
      issues.push({ code: "editing.legacy.start_time", path: `${path}.startTime`, message: "旧片段开始时间必须为非负有限数" });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  const trackId = `${input.editingProjectId}-legacy-main`;
  const ordered = [...input.clips].sort(
    (left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id),
  );
  const clips: EditingClip[] = ordered.map((clip) => {
    const startUs = secondsToNonNegativeUs(clip.startTime);
    const durationUs = secondsToPositiveUs(clip.duration);
    if (startUs === null || durationUs === null) {
      throw new Error(`旧片段 ${clip.id} 通过 preflight 后时间无效`);
    }
    return {
      id: clip.id,
      trackId,
      name: clip.name,
      source: {
        kind: "asset",
        path: clip.url,
        evidence: { mediaId: clip.mediaId },
      },
      startUs,
      durationUs,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
    };
  });
  const project: EditingProjectV1 = {
    schemaVersion: 1,
    id: input.editingProjectId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    name: "旧时间线迁移",
    revision: 1,
    sourceSnapshotHash: input.sourceSnapshotHash,
    sourceRunId: input.sourceRunId,
    createdBy: "manual",
    manuallyEdited: true,
    stale: false,
    renderSettings: renderSettings(input.aspectRatio),
    tracks: [editingTrack(trackId, "video", "旧时间线", 0, clips)],
    clips,
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return validateEditingProject(project);
}

function selectVisualSource(
  storyboard: StoryboardItem,
  track: ProductionTrack | undefined,
  candidate: VideoCandidate | undefined,
  candidateTrimStartUs: number,
  remotionSlot: RemotionCurrentSlotV1 | undefined,
  remotionOnly: boolean,
  projectId: string,
  episodeId: string,
): VisualSelection | null {
  if (storyboard.stale || storyboard.state !== "ready") {
    return null;
  }
  if (remotionOnly) {
    if (!remotionSlot || !isUsableRemotionShotSlot(remotionSlot, projectId, episodeId, storyboard)) {
      return null;
    }
    return {
      source: {
        kind: "storyboardVideo",
        path: remotionSlot.outputPath,
        evidence: {
          storyboardId: storyboard.id,
          sourceRunId: remotionSlot.job.jobId,
          sourceFingerprint: remotionSlot.job.inputHash,
          outputVersion: remotionSlot.target.kind === "shot" ? remotionSlot.target.shotRevision : undefined,
          mediaId: remotionSlot.evidence.sha256,
          remotionJobId: remotionSlot.job.jobId,
          remotionEvidenceSha256: remotionSlot.evidence.sha256,
          remotionInputHash: remotionSlot.job.inputHash,
          remotionBundleContentHash: remotionSlot.job.bundleContentHash,
        },
      },
      trimStartUs: 0,
    };
  }
  if (track && candidate?.filePath) {
    return {
      source: {
        kind: "videoCandidate",
        path: candidate.filePath,
        evidence: {
          storyboardId: storyboard.id,
          trackId: track.id,
          candidateId: candidate.id,
          sourceRunId: candidate.sourceRunId ?? track.sourceRunId,
          sourceFingerprint: candidate.sourceFingerprint,
          outputVersion: candidate.outputVersion,
        },
      },
      trimStartUs: candidateTrimStartUs,
    };
  }
  if (storyboard.mediaRef?.kind === "video" && storyboard.mediaRef.path) {
    return {
      source: {
        kind: "storyboardVideo",
        path: storyboard.mediaRef.path,
        evidence: storyboardEvidence(storyboard),
      },
      trimStartUs: 0,
    };
  }
  if (storyboard.mediaRef?.kind === "image" && storyboard.mediaRef.path) {
    return {
      source: {
        kind: "storyboardImage",
        path: storyboard.mediaRef.path,
        evidence: storyboardEvidence(storyboard),
      },
      trimStartUs: 0,
    };
  }
  return null;
}

function remotionShotId(slot: RemotionCurrentSlotV1): string | undefined {
  return slot.target.kind === "shot" ? slot.target.shotId : undefined;
}

function isUsableRemotionShotSlot(
  slot: RemotionCurrentSlotV1,
  projectId: string,
  episodeId: string,
  storyboard: StoryboardItem,
): boolean {
  if (slot.projectId !== projectId || slot.target.kind !== "shot"
    || slot.target.chapterId !== episodeId || slot.target.shotId !== storyboard.id
    || slot.target.shotRevision !== Math.max(1, storyboard.outputVersion ?? 1)) {
    return false;
  }
  const validation = validateCurrentSlot(slot);
  if (!validation.success) return false;
  return validation.value.job.status === "succeeded"
    && validation.value.evidence.compositionId === "StoryboardShot"
    && validation.value.evidence.renderer.requested === "remotion"
    && validation.value.evidence.renderer.actual === "remotion";
}

function storyboardBaseDurationUs(storyboard: StoryboardItem) {
  const seconds = Number(storyboard.durationTarget) > 0
    ? Number(storyboard.durationTarget)
    : Number(storyboard.duration);
  return secondsToPositiveUs(seconds);
}

function secondsToPositiveUs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const value = Math.round(seconds * US_PER_SECOND);
  return isPositiveSafeInteger(value) ? value : null;
}

function secondsToNonNegativeUs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const value = Math.round(seconds * US_PER_SECOND);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isAudioRef(value: StoryboardItem["audioRef"]): value is NonNullable<StoryboardItem["audioRef"]> {
  return value?.kind === "audio" && Boolean(value.path.trim());
}

function subtitleText(storyboard: StoryboardItem) {
  for (const value of [
    storyboard.ttsSpokenText,
    storyboard.line,
    storyboard.lines,
  ]) {
    const normalized = value?.trim();
    if (normalized && !/^(无|无台词|无对白)$/i.test(normalized)) return normalized;
    if (normalized) return undefined;
  }
  return undefined;
}

function storyboardEvidence(storyboard: StoryboardItem) {
  return {
    storyboardId: storyboard.id,
    sourceRunId: storyboard.sourceRunId,
    sourceFingerprint: storyboard.sourceFingerprint,
    outputVersion: storyboard.outputVersion,
  };
}

function editingTrack(
  id: string,
  kind: "video" | "voice" | "text",
  name: string,
  order: number,
  clips: EditingClip[],
) {
  return {
    id,
    kind,
    name,
    order,
    clipIds: clips.map((clip) => clip.id),
    muted: false,
    locked: false,
  } as const;
}

function renderSettings(aspectRatio: string | undefined): EditingRenderSettings {
  const landscape = aspectRatio?.trim() === "16:9";
  return {
    width: landscape ? 1920 : 1080,
    height: landscape ? 1080 : 1920,
    fps: 30,
    codec: "h264",
    subtitleMode: "burn-in",
    loudnessLufs: -14,
    truePeakDbtp: -1.5,
    audioDucking: { ...DEFAULT_EDITING_AUDIO_DUCKING },
  };
}

function directorHints(
  plan: ScriptPlan | undefined,
  storyboards: StoryboardItem[],
): EditingDirectorHints {
  const transitions = plan?.transitions.trim();
  const soundDirection = plan?.soundDirection.trim();
  return {
    ...(transitions ? { transitions } : {}),
    ...(soundDirection ? { soundDirection } : {}),
    storyboardSounds: storyboards.flatMap((storyboard) => {
      const sound = storyboard.sound?.trim();
      return sound ? [{ storyboardId: storyboard.id, sound }] : [];
    }),
  };
}
