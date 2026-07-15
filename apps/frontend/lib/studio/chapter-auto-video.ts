import type {
  EditingProjectV1,
  TimelineRenderEvidence,
} from "@/types/editing";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";
import { assertVisualContinuityApproved } from "./visual-continuity";

export type ChapterAutoVideoStage =
  | "idle"
  | "planning"
  | "voiceover"
  | "binding"
  | "tts"
  | "media"
  | "render"
  | "editing"
  | "rendering"
  | "probing"
  | "completed"
  | "failed";

export interface ChapterAutoVideoStatus {
  stage: ChapterAutoVideoStage;
  detail: string;
  finalPath?: string;
  error?: string;
}

export interface ChapterAutoVideoDependencies {
  ensurePlanning: () => Promise<void>;
  loadStoryboards: () => StoryboardItem[];
  ensureFixedVoiceProfiles: (
    storyboards: StoryboardItem[],
  ) => Promise<Record<TtsSpeakerId, VoiceProfile>>;
  resolveMediaPath: (mediaPath: string) => Promise<string | null>;
  generateAudio: (
    storyboard: StoryboardItem,
    profile: VoiceProfile,
  ) => Promise<{
    audioRef: StoryboardItem["audioRef"];
    generationId?: string;
    ttsBackend?: string;
    ttsMocked?: false;
    ttsWarning?: string;
  }>;
  writeStoryboardAudio: (
    storyboardId: string,
    result: Awaited<ReturnType<ChapterAutoVideoDependencies["generateAudio"]>>,
  ) => void;
  rebuildTracks: () => void;
  loadTracks: () => ProductionTrack[];
  loadCandidates: () => VideoCandidate[];
  renderTrack: (
    track: ProductionTrack,
    storyboards: StoryboardItem[],
  ) => Promise<VideoCandidate>;
  createEditingProject: (
    storyboards: StoryboardItem[],
    candidates: VideoCandidate[],
  ) => Promise<EditingProjectV1>;
  renderEditingProject: (
    project: EditingProjectV1,
  ) => Promise<TimelineRenderEvidence>;
  writeFinalEvidence: (
    project: EditingProjectV1,
    evidence: TimelineRenderEvidence,
  ) => void;
}

function emit(
  onStatus: ((status: ChapterAutoVideoStatus) => void) | undefined,
  status: ChapterAutoVideoStatus,
) {
  onStatus?.(status);
}

function auditVoiceoverStoryboards(
  storyboards: StoryboardItem[],
  episodeId: string,
): TtsSpeakerId[] {
  const episodeStoryboards = storyboards
    .filter((item) => item.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);
  if (episodeStoryboards.length === 0) {
    throw new Error(`${episodeId} 没有可用于成片的动态分镜`);
  }
  const speakerIds = new Set<TtsSpeakerId>();
  for (const storyboard of episodeStoryboards) {
    for (const field of [
      "speaker",
      "speakerId",
      "line",
      "ttsSpokenText",
      "voiceStyle",
    ] as const) {
      if (!String(storyboard[field] ?? "").trim()) {
        throw new Error(`分镜 ${storyboard.id} 缺少 ${field}`);
      }
    }
    if (!(Number(storyboard.durationTarget) > 0)) {
      throw new Error(`分镜 ${storyboard.id} durationTarget 必须大于 0`);
    }
    if (storyboard.requiresFixedVoice !== true) {
      throw new Error(`分镜 ${storyboard.id} requiresFixedVoice 必须为 true`);
    }
    speakerIds.add(storyboard.speakerId!);
  }
  return [...speakerIds].sort();
}

export interface PreparedChapterMedia {
  storyboards: StoryboardItem[];
}

export async function prepareChapterMedia({
  episodeId,
  dependencies,
  onStatus,
}: {
  episodeId: string;
  dependencies: ChapterAutoVideoDependencies;
  onStatus?: (status: ChapterAutoVideoStatus) => void;
}): Promise<PreparedChapterMedia> {
  emit(onStatus, { stage: "planning", detail: "复用或生成导演计划与动态分镜" });
  await dependencies.ensurePlanning();

  emit(onStatus, { stage: "voiceover", detail: "校验逐镜口播与 canonical speaker" });
  let storyboards = dependencies.loadStoryboards();
  const speakerIds = auditVoiceoverStoryboards(storyboards, episodeId);
  storyboards = storyboards
    .filter((item) => item.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);

  emit(onStatus, { stage: "binding", detail: "复用固定音色并只补缺失 binding" });
  const profiles = await dependencies.ensureFixedVoiceProfiles(storyboards);
  for (const speakerId of speakerIds) {
    if (!profiles[speakerId]) {
      throw new Error(`speaker ${speakerId} 缺少固定 voice profile`);
    }
  }

  emit(onStatus, { stage: "tts", detail: "生成或复用逐镜真实 TTS" });
  for (const storyboard of storyboards) {
    const existingAudioPath = storyboard.audioRef?.path;
    if (
      existingAudioPath
      && (await dependencies.resolveMediaPath(existingAudioPath))
    ) {
      continue;
    }
    const profile = profiles[storyboard.speakerId!];
    const generated = await dependencies.generateAudio(storyboard, profile);
    if (!generated.audioRef?.path) {
      throw new Error(`分镜 ${storyboard.id} TTS 未返回真实音频路径`);
    }
    dependencies.writeStoryboardAudio(storyboard.id, generated);
  }

  storyboards = dependencies
    .loadStoryboards()
    .filter((item) => item.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);
  for (const storyboard of storyboards) {
    if (
      !storyboard.audioRef?.path
      || !(await dependencies.resolveMediaPath(storyboard.audioRef.path))
    ) {
      throw new Error(`分镜 ${storyboard.id} 缺少可读真实音频`);
    }
  }

  emit(onStatus, { stage: "media", detail: "校验全部分镜画面媒体" });
  assertVisualContinuityApproved(storyboards);
  for (const storyboard of storyboards) {
    if (
      !storyboard.mediaRef?.path
      || !(await dependencies.resolveMediaPath(storyboard.mediaRef.path))
    ) {
      throw new Error(`分镜 ${storyboard.id} 缺少可读分镜图，已停止成片`);
    }
  }

  return { storyboards };
}

export async function runChapterAutoVideo({
  episodeId,
  dependencies,
  onStatus,
}: {
  episodeId: string;
  dependencies: ChapterAutoVideoDependencies;
  onStatus?: (status: ChapterAutoVideoStatus) => void;
}) {
  try {
    const { storyboards } = await prepareChapterMedia({
      episodeId,
      dependencies,
      onStatus,
    });

    dependencies.rebuildTracks();
    const tracks = dependencies
      .loadTracks()
      .filter((track) => track.episodeId === episodeId);
    if (tracks.length === 0) throw new Error(`${episodeId} 没有可渲染生产轨道`);

    emit(onStatus, { stage: "render", detail: `渲染 ${tracks.length} 条生产轨道` });
    const candidates: VideoCandidate[] = [];
    for (const track of tracks) {
      const existing = dependencies
        .loadCandidates()
        .find(
          (candidate) =>
            candidate.id === track.selectedVideoId
            && candidate.state === "ready"
            && candidate.filePath,
        );
      if (
        existing?.filePath
        && (await dependencies.resolveMediaPath(existing.filePath))
      ) {
        candidates.push(existing);
        continue;
      }
      candidates.push(await dependencies.renderTrack(track, storyboards));
    }

    emit(onStatus, { stage: "editing", detail: "创建或复用 EditingProject 自动剪辑草案" });
    const project = await dependencies.createEditingProject(
      storyboards,
      candidates,
    );
    emit(onStatus, { stage: "rendering", detail: "编译时间线并执行最终成片" });
    const evidence = await dependencies.renderEditingProject(project);
    emit(onStatus, { stage: "probing", detail: "核验时间线快照、媒体流与哈希证据" });
    dependencies.writeFinalEvidence(project, evidence);
    const result = {
      finalPath: evidence.path,
      evidence,
      editingProjectId: project.id,
      editingRevision: project.revision,
      storyboards: storyboards.length,
    };
    emit(onStatus, {
      stage: "completed",
      detail: "第一章自动成片完成",
      finalPath: evidence.path,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(onStatus, { stage: "failed", detail: "第一章自动成片失败", error: message });
    throw error;
  }
}
