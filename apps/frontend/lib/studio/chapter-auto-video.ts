import type {
  ContinuityAssetVersion,
  StoryboardItem,
} from "@/types/studio";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
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
  | "queued"
  | "blocked"
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
  loadContinuityAssetVersions: () => ContinuityAssetVersion[];
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
  enqueueRemotionShots: (input: {
    projectId: string;
    chapterId: string;
    storyboards: StoryboardItem[];
  }) => Promise<RemotionShotQueueSubmission>;
}

export interface RemotionShotQueueSubmission {
  jobs: RemotionRenderJobV1[];
  blockedShotIds: string[];
  chapterJobId?: string;
}

export interface ChapterAutoVideoResult {
  storyboards: number;
  remotionJobs?: RemotionRenderJobV1[];
  blockedShotIds?: string[];
  queueStatus?: "queued" | "blocked";
  chapterJobId?: string;
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
  assertVisualContinuityApproved(
    storyboards,
    dependencies.loadContinuityAssetVersions(),
  );

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
  projectId,
  episodeId,
  dependencies,
  onStatus,
}: {
  projectId?: string;
  episodeId: string;
  dependencies: ChapterAutoVideoDependencies;
  onStatus?: (status: ChapterAutoVideoStatus) => void;
}): Promise<ChapterAutoVideoResult> {
  try {
    const { storyboards } = await prepareChapterMedia({
      episodeId,
      dependencies,
      onStatus,
    });

    if (!projectId) throw new Error("Remotion 自动成片缺少 projectId");
    emit(onStatus, { stage: "render", detail: `提交 ${storyboards.length} 个 Remotion 分镜任务` });
    const submission = await dependencies.enqueueRemotionShots({
      projectId,
      chapterId: episodeId,
      storyboards,
    });
    const queueStatus = submission.blockedShotIds.length > 0 ? "blocked" : "queued";
    emit(onStatus, {
      stage: queueStatus,
      detail: queueStatus === "blocked"
        ? `Remotion 分镜存在阻塞：${submission.blockedShotIds.join("、")}`
        : `已提交 ${submission.jobs.length} 个 Remotion 分镜任务，等待章节合成`,
    });
    return {
      storyboards: storyboards.length,
      remotionJobs: submission.jobs,
      blockedShotIds: submission.blockedShotIds,
      chapterJobId: submission.chapterJobId,
      queueStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(onStatus, { stage: "failed", detail: "第一章自动成片失败", error: message });
    throw error;
  }
}
