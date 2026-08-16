import type {
  ContinuityAssetVersion,
  StoryboardItem,
  StoryboardTtsJobV1,
} from "@/types/studio";
import type { TtsEmotionCapability, TtsSpeakerId, VoiceProfile } from "@/types/tts";
import type {
  RemotionRenderJobV1,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
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
  | "awaiting-review"
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
    shotAudioBinding: RemotionShotAudioBindingV2;
    ttsJob: StoryboardTtsJobV1;
    generationId?: string;
    ttsBackend?: string;
    ttsMocked?: false;
    ttsEmotionCapability?: TtsEmotionCapability;
    ttsWarning?: string;
  }>;
  writeStoryboardAudio: (
    storyboardId: string,
    result: Awaited<ReturnType<ChapterAutoVideoDependencies["generateAudio"]>>,
  ) => void;
  ttsConcurrency?: number;
  isTtsCanceled?: (storyboardId: string) => boolean;
  enqueueRemotionShots: (input: {
    projectId: string;
    chapterId: string;
    storyboards: StoryboardItem[];
    allStoryboards?: StoryboardItem[];
  }) => Promise<RemotionShotQueueSubmission>;
  runVideoUseChapter?: (
    input: RunVideoUseChapterInput,
  ) => Promise<VideoUseChapterPreviewResult>;
  onVideoUseReviewRequired?: () => void;
}

export interface RemotionShotQueueSubmission {
  jobs: RemotionRenderJobV1[];
  blockedShotIds: string[];
  chapterJobId?: string;
}

export interface VideoUseChapterPreviewResult {
  state: "pending" | "ready" | "blocked";
  revision: number;
  inputSha256?: string;
}

export interface RunVideoUseChapterInput {
  projectId: string;
  chapterId: string;
  storyboards: StoryboardItem[];
  submission: RemotionShotQueueSubmission;
}

export interface ChapterAutoVideoResult {
  storyboards: number;
  remotionJobs?: RemotionRenderJobV1[];
  blockedShotIds?: string[];
  queueStatus?: "queued" | "awaiting-review" | "blocked";
  chapterJobId?: string;
  videoUseState?: VideoUseChapterPreviewResult["state"];
  videoUseRevision?: number;
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
  expectedIdentity?: { sourceId: string; revision: number },
): TtsSpeakerId[] {
  const episodeStoryboards = storyboards
    .filter((item) => item.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);
  if (episodeStoryboards.length === 0) {
    throw new Error(`${episodeId} 没有可用于成片的动态分镜`);
  }
  const speakerIds = new Set<TtsSpeakerId>();
  for (const storyboard of episodeStoryboards) {
    if (expectedIdentity && storyboard.sourceId !== undefined && storyboard.sourceId !== expectedIdentity.sourceId) {
      throw new Error(`分镜 ${storyboard.id} sourceId 与期望不一致: ${storyboard.sourceId}/${expectedIdentity.sourceId}`);
    }
    if (expectedIdentity && storyboard.revision !== undefined && storyboard.revision !== expectedIdentity.revision) {
      throw new Error(`分镜 ${storyboard.id} revision 与期望不一致: ${storyboard.revision}/${expectedIdentity.revision}`);
    }
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
  blockedShotIds: string[];
  ttsErrors: Record<string, string>;
}

export async function prepareChapterMedia({
  projectId,
  episodeId,
  expectedIdentity,
  dependencies,
  onStatus,
}: {
  projectId: string;
  episodeId: string;
  expectedIdentity?: { sourceId: string; revision: number };
  dependencies: ChapterAutoVideoDependencies;
  onStatus?: (status: ChapterAutoVideoStatus) => void;
}): Promise<PreparedChapterMedia> {
  emit(onStatus, { stage: "planning", detail: "复用或生成导演计划与动态分镜" });
  await dependencies.ensurePlanning();

  emit(onStatus, { stage: "voiceover", detail: "校验逐镜口播与 canonical speaker" });
  let storyboards = dependencies.loadStoryboards();
  const speakerIds = auditVoiceoverStoryboards(storyboards, episodeId, expectedIdentity);
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
  const concurrency = validateTtsConcurrency(dependencies.ttsConcurrency ?? 2);
  const ttsErrors: Record<string, string> = {};
  await runBoundedShotTasks(storyboards, concurrency, async (storyboard) => {
    if (dependencies.isTtsCanceled?.(storyboard.id)) {
      ttsErrors[storyboard.id] = "逐镜 TTS 已取消";
      return;
    }
    const profile = profiles[storyboard.speakerId!];
    try {
      const generated = await dependencies.generateAudio(storyboard, profile);
      if (!generated.audioRef?.path) {
        throw new Error(`分镜 ${storyboard.id} TTS 未返回真实音频路径`);
      }
      if (dependencies.isTtsCanceled?.(storyboard.id)) {
        ttsErrors[storyboard.id] = "逐镜 TTS 已取消";
        return;
      }
      dependencies.writeStoryboardAudio(storyboard.id, generated);
    } catch (error) {
      ttsErrors[storyboard.id] = error instanceof Error ? error.message : String(error);
      // 一键成片阻塞的可观测性：逐镜 TTS 失败原因此前只进内存映射，UI 仅显示镜号
      // 列表——出问题时无从定位（实测 CDP/诊断均无痕）。打点到 console.error。
      console.error("[chapter-auto-video] 逐镜 TTS 失败", storyboard.id, ttsErrors[storyboard.id]);
    }
  });

  storyboards = dependencies
    .loadStoryboards()
    .filter((item) => item.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);
  for (const storyboard of storyboards) {
    if (ttsErrors[storyboard.id]) continue;
    const bindingError = await validateCanonicalVoiceWriteback(
      projectId,
      episodeId,
      storyboard,
      dependencies.resolveMediaPath,
    );
    if (bindingError) {
      ttsErrors[storyboard.id] = bindingError;
      console.error("[chapter-auto-video] 回写校验失败", storyboard.id, bindingError);
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

  const blockedShotIds = storyboards
    .filter((storyboard) => Boolean(ttsErrors[storyboard.id]))
    .map((storyboard) => storyboard.id);
  if (blockedShotIds.length > 0) {
    console.error("[chapter-auto-video] prepare 完成但存在阻塞镜", JSON.stringify(
      Object.fromEntries(blockedShotIds.map((id) => [id, ttsErrors[id]])),
    ));
  } else {
    console.error("[chapter-auto-video] prepare 完成, 零阻塞, ttsErrors =", JSON.stringify(ttsErrors));
  }
  emit(onStatus, {
    stage: "tts",
    detail: blockedShotIds.length > 0
      ? `逐镜 TTS 完成，${blockedShotIds.length} 镜失败或取消；其他分镜继续`
      : `逐镜 TTS 完成，并发上限 ${concurrency}`,
  });
  return { storyboards, blockedShotIds, ttsErrors };
}

export async function runChapterAutoVideo({
  projectId,
  episodeId,
  expectedIdentity,
  dependencies,
  onStatus,
}: {
  projectId?: string;
  episodeId: string;
  expectedIdentity?: { sourceId: string; revision: number };
  dependencies: ChapterAutoVideoDependencies;
  onStatus?: (status: ChapterAutoVideoStatus) => void;
}): Promise<ChapterAutoVideoResult> {
  try {
    console.error("[chapter-auto-video] runChapterAutoVideo 进入, projectId =", projectId);
    if (!projectId) throw new Error("Remotion 自动成片缺少 projectId");
    const prepared = await prepareChapterMedia({
      projectId,
      episodeId,
      expectedIdentity,
      dependencies,
      onStatus,
    });

    const { storyboards } = prepared;
    if (prepared.blockedShotIds.length > 0) {
      const detail = `Remotion 分镜存在阻塞：${prepared.blockedShotIds.join("、")}；整章停止入队`;
      emit(onStatus, { stage: "blocked", detail });
      return {
        storyboards: storyboards.length,
        remotionJobs: [],
        blockedShotIds: prepared.blockedShotIds,
        queueStatus: "blocked",
      };
    }
    const renderableStoryboards = storyboards;
    emit(onStatus, {
      stage: "render",
      detail: `提交 ${renderableStoryboards.length} 个 Remotion 分镜任务`,
    });
    const submission = renderableStoryboards.length > 0
      ? await dependencies.enqueueRemotionShots({
        projectId,
        chapterId: episodeId,
        storyboards: renderableStoryboards,
        allStoryboards: storyboards,
      })
      : { jobs: [], blockedShotIds: [] };
    const blockedShotIds = [...new Set(submission.blockedShotIds)];
    if (blockedShotIds.length === 0 && dependencies.runVideoUseChapter) {
      emit(onStatus, {
        stage: "probing",
        detail: "等待全部 Remotion StoryboardShot MP4 完成后运行 video-use preview",
      });
      const preview = await dependencies.runVideoUseChapter({
        projectId,
        chapterId: episodeId,
        storyboards,
        submission,
      });
      if (preview.state === "blocked") {
        emit(onStatus, {
          stage: "blocked",
          detail: "video-use preview 被阻塞，整章暂停",
        });
        return {
          storyboards: storyboards.length,
          remotionJobs: submission.jobs,
          blockedShotIds: [],
          chapterJobId: submission.chapterJobId,
          queueStatus: "blocked",
          videoUseState: preview.state,
          videoUseRevision: preview.revision,
        };
      }
      dependencies.onVideoUseReviewRequired?.();
      emit(onStatus, {
        stage: "awaiting-review",
        detail: `video-use preview 已生成 revision ${preview.revision}，等待用户确认后继续正式合成`,
      });
      return {
        storyboards: storyboards.length,
        remotionJobs: submission.jobs,
        blockedShotIds: [],
        chapterJobId: submission.chapterJobId,
        queueStatus: "awaiting-review",
        videoUseState: "pending",
        videoUseRevision: preview.revision,
      };
    }
    const queueStatus = blockedShotIds.length > 0 ? "blocked" : "queued";
    emit(onStatus, {
      stage: queueStatus,
      detail: queueStatus === "blocked"
        ? `Remotion 分镜存在阻塞：${blockedShotIds.join("、")}`
        : `已提交 ${submission.jobs.length} 个 Remotion 分镜任务，等待章节合成`,
    });
    return {
      storyboards: storyboards.length,
      remotionJobs: submission.jobs,
      blockedShotIds,
      chapterJobId: submission.chapterJobId,
      queueStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(onStatus, { stage: "failed", detail: "第一章自动成片失败", error: message });
    throw error;
  }
}

export class ChapterTtsCancellationController {
  private readonly canceledShotIds = new Set<string>();
  private canceledAll = false;

  cancelShot(storyboardId: string): void {
    this.canceledShotIds.add(storyboardId);
  }

  cancelAll(): void {
    this.canceledAll = true;
  }

  isCanceled(storyboardId: string): boolean {
    return this.canceledAll || this.canceledShotIds.has(storyboardId);
  }
}

function validateTtsConcurrency(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("TTS 并发必须是 1–4 的整数");
  }
  return value;
}

async function runBoundedShotTasks<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await operation(items[index]);
    }
  });
  await Promise.all(workers);
}

async function validateCanonicalVoiceWriteback(
  projectId: string,
  chapterId: string,
  storyboard: StoryboardItem,
  resolveMediaPath: (mediaPath: string) => Promise<string | null>,
): Promise<string | undefined> {
  const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
  const voiceBindings = storyboard.shotAudioBindings?.filter((binding) => binding.role === "voice") ?? [];
  if (voiceBindings.length !== 1) return `分镜 ${storyboard.id} 必须有且仅有一个 canonical voice binding`;
  const binding = voiceBindings[0];
  if (binding.projectId !== projectId || binding.chapterId !== chapterId
    || binding.shotId !== storyboard.id || binding.shotRevision !== shotRevision) {
    return `分镜 ${storyboard.id} voice binding 身份或 revision 不匹配`;
  }
  if (!storyboard.ttsJob || storyboard.ttsJob.status !== "completed"
    || storyboard.ttsJob.inputFingerprint !== binding.ttsInputFingerprint
    || storyboard.ttsJob.shotRevision !== shotRevision) {
    return `分镜 ${storyboard.id} TTS job 与 voice binding fingerprint/revision 不匹配`;
  }
  const audioRef = storyboard.audioRef;
  if (!audioRef?.path || audioRef.contentSha256 !== binding.sourceFingerprint) {
    return `分镜 ${storyboard.id} audioRef 与 canonical voice binding 不一致`;
  }
  if (!(await resolveMediaPath(audioRef.path))) return `分镜 ${storyboard.id} 缺少可读真实音频`;
  return undefined;
}
