import { buildProjectFileUrl } from "@/lib/artifacts/ref-preview-loader";
import { sha256CanonicalJson, sha256Text } from "@/lib/studio/remotion/canonical-json";
import { validateRemotionCurrentSlot as validateCurrentSlot } from "@/lib/studio/remotion/remotion-slot-validation";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import { assembleBoundaryIntents } from "@/lib/studio/video-workflow/boundary-intent-assembly";
import type { VideoWorkflowChapterRunRequestV1 } from "@rendering/contracts/video-workflow-ipc";
import type { VideoUseDerivedInputPolicy, VideoUseStoryboardSourcePolicy } from "@rendering/contracts/video-workflow";

export interface BuildVideoWorkflowChapterRunInput {
  projectId: string;
  chapterId: string;
  revision: number;
  mode?: VideoWorkflowChapterRunRequestV1["mode"];
  derivedInputPolicy?: VideoUseDerivedInputPolicy;
  storyboardSourcePolicy?: VideoUseStoryboardSourcePolicy;
  storyboards: StoryboardItem[];
  remotionShotSlots: RemotionCurrentSlotV1[];
  /** Director-plan ⑥ section text; scene-level transition intents fallback
   * behind the per-shot storyboard semantics (see boundary-intent-assembly). */
  scriptPlanTransitions?: string;
}

/**
 * A video-use revision may only consume the same ready storyboard snapshot
 * that is eligible to become an EditingProject after review.
 */
export function isStoryboardReadyForVideoWorkflow(
  storyboard: StoryboardItem,
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
): boolean {
  return storyboard.state === "ready" && (storyboardSourcePolicy === "reuse-existing" || !storyboard.stale);
}

export function videoWorkflowStoryboardBlocker(
  storyboards: StoryboardItem[],
  chapterId: string,
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
): string | undefined {
  const blocker = storyboards
    .filter((storyboard) => storyboard.episodeId === chapterId)
    .find((storyboard) => !isStoryboardReadyForVideoWorkflow(storyboard, storyboardSourcePolicy));
  if (!blocker) return undefined;
  if (blocker.stale && storyboardSourcePolicy !== "reuse-existing") {
    return `分镜 ${blocker.id} 已过期：${blocker.staleReason || "上游素材或连续性已变化"}；请重新生成当前 Remotion StoryboardShot`;
  }
  return `分镜 ${blocker.id} 当前状态为 ${blocker.state || "unknown"}，尚不能运行 video-use`;
}

/**
 * Builds the renderer-safe request for the main-process video-use boundary.
 * Paths remain project-file URLs here; the main process resolves and verifies
 * them against the configured project root before spawning Python.
 */
export async function buildVideoWorkflowChapterRunRequest(
  input: BuildVideoWorkflowChapterRunInput,
): Promise<VideoWorkflowChapterRunRequestV1> {
  if (!input.projectId.trim()) throw new Error("video-use 请求缺少 projectId");
  if (!input.chapterId.trim()) throw new Error("video-use 请求缺少 chapterId");
  if (!Number.isInteger(input.revision) || input.revision <= 0) throw new Error("video-use 请求 revision 必须是正整数");
  const storyboards = input.storyboards
    .filter((storyboard) => storyboard.episodeId === input.chapterId)
    .slice()
    .sort((left, right) => left.index - right.index);
  if (storyboards.length === 0) throw new Error("当前章节没有可执行的 StoryboardShot");
  const storyboardSourcePolicy = input.storyboardSourcePolicy ?? "current-ready";
  const storyboardBlocker = videoWorkflowStoryboardBlocker(storyboards, input.chapterId, storyboardSourcePolicy);
  if (storyboardBlocker) throw new Error(storyboardBlocker);

  const shots = await Promise.all(storyboards.map(async (storyboard) => {
    const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
    const slot = input.remotionShotSlots.find((candidate) => candidate.target.kind === "shot"
      && candidate.target.chapterId === input.chapterId
      && candidate.target.shotId === storyboard.id
      && candidate.target.shotRevision === shotRevision
      && candidate.job.status === "succeeded");
    if (!slot || slot.target.kind !== "shot") throw new Error(`分镜 ${storyboard.id} 缺少当前 Remotion MP4`);
    const slotValidation = validateCurrentSlot(slot);
    if (!slotValidation.success) {
      throw new Error(`分镜 ${storyboard.id} 的 Remotion current slot 无效：${slotValidation.issues.map((issue) => issue.message).join("；")}`);
    }
    if (slotValidation.value.evidence.compositionId !== "StoryboardShot"
      || slotValidation.value.evidence.renderer.requested !== "remotion"
      || slotValidation.value.evidence.renderer.actual !== "remotion") {
      throw new Error(`分镜 ${storyboard.id} 的 current slot 不是成功的 Remotion StoryboardShot`);
    }
    const voice = storyboard.shotAudioBindings?.find((binding) => binding.role === "voice");
    const audioPath = storyboard.audioRef?.path ?? (voice ? buildProjectFileUrl(input.projectId, voice.source.relativePath) : "");
    const audioSha256 = storyboard.audioRef?.contentSha256 ?? voice?.source.contentSha256;
    if (!audioPath || !audioSha256) throw new Error(`分镜 ${storyboard.id} 缺少本地 TTS 音频绑定`);
    const ttsSpokenText = storyboard.ttsSpokenText?.trim() ?? "";
    if (!ttsSpokenText) throw new Error(`分镜 ${storyboard.id} 缺少 ttsSpokenText`);
    const durationUs = slotValidation.value.evidence.durationUs > 0
      ? slotValidation.value.evidence.durationUs
      : Math.round((storyboard.durationTarget ?? storyboard.duration) * 1_000_000);
    if (!Number.isSafeInteger(durationUs) || durationUs <= 0) throw new Error(`分镜 ${storyboard.id} 时长无效`);
    return {
      shotId: storyboard.id,
      videoPath: buildProjectFileUrl(input.projectId, `remotion/${slot.outputPath}`),
      audioPath,
      ttsSpokenText,
      sourceSha256: slotValidation.value.evidence.sha256,
      audioSha256,
      textSha256: await sha256Text(ttsSpokenText),
      durationUs,
    };
  }));

  // Transition decisions ride the real chapter run: per-shot storyboard
  // semantics first, director-plan scene lines behind, hard cut otherwise.
  const { intents: boundaryIntents, warnings: boundaryWarnings } = assembleBoundaryIntents({
    storyboards,
    ...(input.scriptPlanTransitions ? { scriptPlanTransitions: input.scriptPlanTransitions } : {}),
    shotDurationUsById: new Map(shots.map((shot) => [shot.shotId, shot.durationUs])),
  });
  for (const warning of boundaryWarnings) console.warn(`[video-use 请求] ${warning}`);

  return {
    schemaVersion: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    revision: input.revision,
    mode: input.mode ?? "editable-edl",
    ...(input.derivedInputPolicy ? { derivedInputPolicy: input.derivedInputPolicy } : {}),
    storyboardSourcePolicy,
    shots,
    ...(boundaryIntents.length > 0 ? { boundaryIntents } : {}),
    sourceSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.sourceSha256 }))),
    audioSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.audioSha256 }))),
    textSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.textSha256 }))),
    featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
  };
}
