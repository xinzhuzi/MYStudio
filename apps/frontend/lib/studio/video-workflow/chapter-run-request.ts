import { buildProjectFileUrl } from "@/lib/artifacts/ref-preview-loader";
import { sha256CanonicalJson, sha256Text } from "@/lib/studio/remotion/canonical-json";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import type { VideoWorkflowChapterRunRequestV1 } from "@rendering/contracts/video-workflow-ipc";
import type { VideoUseDerivedInputPolicy } from "@rendering/contracts/video-workflow";

export interface BuildVideoWorkflowChapterRunInput {
  projectId: string;
  chapterId: string;
  revision: number;
  mode?: VideoWorkflowChapterRunRequestV1["mode"];
  derivedInputPolicy?: VideoUseDerivedInputPolicy;
  storyboards: StoryboardItem[];
  remotionShotSlots: RemotionCurrentSlotV1[];
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

  const shots = await Promise.all(storyboards.map(async (storyboard) => {
    const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
    const slot = input.remotionShotSlots.find((candidate) => candidate.target.kind === "shot"
      && candidate.target.chapterId === input.chapterId
      && candidate.target.shotId === storyboard.id
      && candidate.target.shotRevision === shotRevision
      && candidate.job.status === "succeeded");
    if (!slot || slot.target.kind !== "shot") throw new Error(`分镜 ${storyboard.id} 缺少当前 Remotion MP4`);
    const voice = storyboard.shotAudioBindings?.find((binding) => binding.role === "voice");
    const audioPath = storyboard.audioRef?.path ?? (voice ? buildProjectFileUrl(input.projectId, voice.source.relativePath) : "");
    const audioSha256 = storyboard.audioRef?.contentSha256 ?? voice?.source.contentSha256;
    if (!audioPath || !audioSha256) throw new Error(`分镜 ${storyboard.id} 缺少本地 TTS 音频绑定`);
    const ttsSpokenText = storyboard.ttsSpokenText?.trim() ?? "";
    if (!ttsSpokenText) throw new Error(`分镜 ${storyboard.id} 缺少 ttsSpokenText`);
    const durationUs = slot.evidence.durationUs > 0
      ? slot.evidence.durationUs
      : Math.round((storyboard.durationTarget ?? storyboard.duration) * 1_000_000);
    if (!Number.isSafeInteger(durationUs) || durationUs <= 0) throw new Error(`分镜 ${storyboard.id} 时长无效`);
    return {
      shotId: storyboard.id,
      videoPath: buildProjectFileUrl(input.projectId, `remotion/${slot.outputPath}`),
      audioPath,
      ttsSpokenText,
      sourceSha256: slot.evidence.sha256,
      audioSha256,
      textSha256: await sha256Text(ttsSpokenText),
      durationUs,
    };
  }));

  return {
    schemaVersion: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    revision: input.revision,
    mode: input.mode ?? "editable-edl",
    ...(input.derivedInputPolicy ? { derivedInputPolicy: input.derivedInputPolicy } : {}),
    shots,
    sourceSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.sourceSha256 }))),
    audioSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.audioSha256 }))),
    textSha256: await sha256CanonicalJson(shots.map((shot) => ({ shotId: shot.shotId, sha256: shot.textSha256 }))),
    featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
  };
}
