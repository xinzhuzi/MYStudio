import { aiManager } from "@/lib/ai/ai-manager";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import {
  ensureBackendVoiceProfile,
  cancelGeneration,
  fetchGenerationAudio,
  getGenerationStatus,
  startTtsRuntime,
} from "@/lib/tts/client";
import { validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import type {
  StoryboardItem,
  StoryboardMediaRef,
  StoryboardTtsJobV1,
} from "@/types/studio";
import type {
  RemotionImportedAudioV2,
} from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import type { RemotionShotAudioBindingV2 } from "@/types/remotion-workspace";
import type {
  TtsEmotionCapability,
  TtsGenerateRequest,
  TtsGenerateResponse,
  TtsRuntimeCommandResult,
  VoiceProfile,
} from "@/types/tts";
import { sha256CanonicalJson } from "./remotion/canonical-json";
import {
  createRemotionAudioBindingFingerprint,
  validateRemotionAudioBindingFingerprint,
} from "./remotion/remotion-audio-fingerprint";
import { validateRemotionShotAudioBindingV2 } from "./remotion/remotion-manifest-validation";

export const DEFAULT_STORYBOARD_TTS_MAX_ATTEMPTS = 3;

export class StoryboardTtsCanceledError extends Error {
  constructor() {
    super("逐镜 TTS 已取消");
    this.name = "StoryboardTtsCanceledError";
  }
}

class StoryboardTtsOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StoryboardTtsOperationError";
  }
}

export interface StoryboardTtsRunnerDependencies {
  startRuntime: () => Promise<TtsRuntimeCommandResult>;
  ensureProfile: (profile: VoiceProfile) => Promise<unknown>;
  submit: (payload: TtsGenerateRequest) => Promise<TtsGenerateResponse>;
  getStatus: (generationId: string) => Promise<TtsGenerateResponse>;
  cancelGeneration?: (generationId: string) => Promise<TtsGenerateResponse>;
  fetchAudio: (generationId: string) => Promise<ArrayBuffer>;
  writeGeneratedAudio: (payload: {
    projectId: string;
    chapterId: string;
    shotId: string;
    role: "voice";
    extension: "wav";
    bytes: ArrayBuffer;
  }) => Promise<RemotionImportedAudioV2>;
  resolveReferenceAudioPath: (audioPath: string) => Promise<string | null>;
  hashReferenceAudio: (resolvedAudioPath: string) => Promise<string>;
  delay: (ms: number) => Promise<void>;
  now: () => number;
}

function defaultDependencies(): StoryboardTtsRunnerDependencies {
  const ttsRuntime = getTtsRuntimeBridge();
  if (!ttsRuntime?.resolveReferenceAudioPath) {
    throw new Error("固定音色文件校验接口仅在桌面应用中可用");
  }
  const audioBridge = window.remotionChapterManifest;
  if (!audioBridge?.writeGeneratedShotAudio) {
    throw new Error("Remotion 项目音频写入接口仅在桌面应用中可用");
  }
  const probeMedia = window.studioRenderer?.probeMedia;
  if (!probeMedia) throw new Error("参考音频 SHA 校验接口仅在桌面应用中可用");
  return {
    startRuntime: startTtsRuntime,
    ensureProfile: ensureBackendVoiceProfile,
    submit: (payload) => aiManager.tts(payload),
    getStatus: getGenerationStatus,
    cancelGeneration,
    fetchAudio: fetchGenerationAudio,
    writeGeneratedAudio: (payload) => audioBridge.writeGeneratedShotAudio(payload),
    resolveReferenceAudioPath: (audioPath) =>
      ttsRuntime.resolveReferenceAudioPath(audioPath),
    hashReferenceAudio: async (resolvedAudioPath) => {
      const evidence = await probeMedia(resolvedAudioPath);
      if (!/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error("参考音频 SHA-256 无效");
      return evidence.sha256;
    },
    delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    now: Date.now,
  };
}

function generationError(result: TtsGenerateResponse) {
  return result.error || "口播生成失败";
}

function throwGenerationFailure(result: TtsGenerateResponse): never {
  throw new StoryboardTtsOperationError(
    generationError(result),
    result.errorCode || "generation_failed",
    isRetryableFlag(result.retryable),
  );
}

function isMocked(value: boolean | number | undefined) {
  return typeof value === "number" ? value === 1 : value === true;
}

async function waitForCompletedGeneration(
  generationId: string,
  dependencies: StoryboardTtsRunnerDependencies,
  isCanceled: () => boolean,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    throwIfCanceled(isCanceled);
    const status = await dependencies.getStatus(generationId);
    throwIfCanceled(isCanceled);
    if (status.status === "completed") return status;
    if (status.status === "failed") throwGenerationFailure(status);
    await dependencies.delay(1000);
  }
  throw new StoryboardTtsOperationError("口播生成超时", "timeout", true);
}

export async function createStoryboardTtsInputFingerprint(input: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  profile: VoiceProfile;
  referenceAudioSha256?: string;
}): Promise<string> {
  const shotRevision = Math.max(1, input.storyboard.outputVersion ?? 1);
  const seed = 41001 + input.storyboard.index;
  return sha256CanonicalJson({
    schemaVersion: 2,
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.storyboard.id,
    shotRevision,
    text: input.storyboard.ttsSpokenText?.trim() ?? "",
    emotion: input.storyboard.emotion?.trim() ?? null,
    voiceStyle: input.storyboard.voiceStyle?.trim() ?? null,
    speakerId: input.storyboard.speakerId ?? "",
    profile: {
      id: input.profile.id,
      type: input.profile.type,
      language: input.profile.language,
      engine: input.profile.defaultEngine,
      modelSize: input.profile.defaultModelSize ?? null,
      presetVoiceId: input.profile.presetVoiceId ?? null,
      referenceText: input.profile.referenceText ?? null,
      instruct: input.profile.instruct ?? null,
      referenceAudioSha256: input.referenceAudioSha256 ?? null,
    },
    seed,
  });
}

export async function runStoryboardTtsGeneration({
  projectId,
  chapterId,
  storyboard,
  profile,
  dependencies = defaultDependencies(),
  isCanceled = () => false,
  onJob,
}: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  profile: VoiceProfile;
  dependencies?: StoryboardTtsRunnerDependencies;
  isCanceled?: () => boolean;
  onJob?: (job: StoryboardTtsJobV1) => void | Promise<void>;
}): Promise<{
  audioRef: StoryboardMediaRef;
  shotAudioBinding: RemotionShotAudioBindingV2;
  ttsJob: StoryboardTtsJobV1;
  generationId: string;
  ttsBackend: string;
  ttsMocked: false;
  ttsEmotionCapability: TtsEmotionCapability;
  ttsWarning?: string;
}> {
  const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
  if (!storyboard.speakerId?.trim()) {
    throw new Error(`分镜 ${storyboard.id} 缺少 canonical speakerId`);
  }
  if (!storyboard.ttsSpokenText?.trim()) {
    throw new Error(`分镜 ${storyboard.id} 口播文本为空`);
  }
  if (storyboard.requiresFixedVoice !== true) {
    throw new Error(`分镜 ${storyboard.id} 未要求固定音色`);
  }
  const validationError = validateVoiceProfileForGeneration(profile);
  if (validationError) {
    throw new Error(`分镜 ${storyboard.id} 固定音色不可用: ${validationError}`);
  }
  throwIfCanceled(isCanceled);
  let referenceAudioSha256: string | undefined;
  if (profile.referenceAudioPath) {
    const resolved = await dependencies.resolveReferenceAudioPath(profile.referenceAudioPath);
    throwIfCanceled(isCanceled);
    if (!resolved) {
      throw new Error(`分镜 ${storyboard.id} 固定音色文件不可读: ${profile.referenceAudioPath}`);
    }
    referenceAudioSha256 = await dependencies.hashReferenceAudio(resolved);
    throwIfCanceled(isCanceled);
  }

  const inputFingerprint = await createStoryboardTtsInputFingerprint({
    projectId,
    chapterId,
    storyboard,
    profile,
    referenceAudioSha256,
  });
  const existingJob = storyboard.ttsJob?.inputFingerprint === inputFingerprint
    && storyboard.ttsJob.projectId === projectId
    && storyboard.ttsJob.chapterId === chapterId
    && storyboard.ttsJob.shotId === storyboard.id
    && storyboard.ttsJob.shotRevision === shotRevision
    ? storyboard.ttsJob
    : undefined;
  const existingBindings = storyboard.shotAudioBindings?.filter(
    (binding) => binding.role === "voice"
      && binding.ttsInputFingerprint === inputFingerprint
      && binding.shotRevision === shotRevision,
  ) ?? [];
  if (existingJob?.status === "completed" && existingBindings.length > 0) {
    if (existingBindings.length !== 1) {
      throw new Error(`分镜 ${storyboard.id} completed TTS job 必须有且仅有一个 canonical voice binding`);
    }
    const existingBinding = existingBindings[0];
    const bindingValidation = validateRemotionShotAudioBindingV2(existingBinding, {
      projectId,
      chapterId,
      shotId: storyboard.id,
      shotRevision,
      shotDurationUs: Math.max(1, existingBinding.shotStartUs + existingBinding.durationUs),
    });
    const fingerprintValidation = await validateRemotionAudioBindingFingerprint(existingBinding);
    if (!bindingValidation.success || !fingerprintValidation.success) {
      throw new Error(`分镜 ${storyboard.id} completed TTS voice binding 身份或 fingerprint 不匹配`);
    }
    return completedResult(existingJob, existingBinding, storyboard);
  }
  if (["failed", "canceled"].includes(existingJob?.status ?? "") && existingJob?.retryRequested !== true) {
    throw new Error(`分镜 ${storyboard.id} TTS 已${existingJob?.status === "failed" ? "失败" : "取消"}，必须显式重试`);
  }

  const createdAt = existingJob?.createdAt ?? dependencies.now();
  let job: StoryboardTtsJobV1 = {
    schemaVersion: 1,
    projectId,
    chapterId,
    shotId: storyboard.id,
    shotRevision,
    inputFingerprint,
    status: "queued",
    attempt: Math.max(0, existingJob?.attempt ?? 0),
    ...(existingJob?.generationId ? { generationId: existingJob.generationId } : {}),
    createdAt,
    updatedAt: dependencies.now(),
  };
  await persistJob(job, onJob);

  try {
    throwIfCanceled(isCanceled);
    const runtime = await dependencies.startRuntime();
    throwIfCanceled(isCanceled);
    if (!runtime.success) throw terminal(runtime.error || "TTS 后端启动失败", "runtime_start_failed");
    await dependencies.ensureProfile(profile);
    throwIfCanceled(isCanceled);

    let resumeGenerationId = existingJob?.status === "generating" || existingJob?.status === "queued"
      ? existingJob.generationId
      : undefined;
    // An explicit retry starts a new logical run. Keep its attempt budget bounded
    // to DEFAULT_STORYBOARD_TTS_MAX_ATTEMPTS instead of carrying the prior run's
    // terminal attempt into the automatic retry loop.
    const firstAttempt = existingJob?.retryRequested === true
      ? 1
      : Math.max(1, existingJob?.attempt ?? 1);
    const remainingAttempts = Math.max(0, DEFAULT_STORYBOARD_TTS_MAX_ATTEMPTS - firstAttempt + 1);
    let lastRetryableError: unknown;
    for (let offset = 0; offset < remainingAttempts; offset += 1) {
      const attempt = firstAttempt + offset;
      job = {
        ...job,
        status: "generating",
        attempt,
        retryRequested: false,
        cancelRequested: false,
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: dependencies.now(),
      };
      await persistJob(job, onJob);
      try {
        let generationId = resumeGenerationId;
        resumeGenerationId = undefined;
        let completed: TtsGenerateResponse;
        if (generationId) {
          completed = await waitForCompletedGeneration(generationId, dependencies, isCanceled);
        } else {
          throwIfCanceled(isCanceled);
          const generation = await dependencies.submit({
            text: storyboard.ttsSpokenText.trim(),
            profileId: profile.id,
            engine: profile.defaultEngine,
            modelSize: profile.defaultModelSize,
            language: profile.language,
            seed: 41001 + storyboard.index,
            projectId,
            chapterId,
            shotId: storyboard.id,
            shotRevision,
            inputFingerprint,
            referenceAudioSha256,
            emotion: storyboard.emotion?.trim(),
            voiceStyle: storyboard.voiceStyle?.trim(),
            generationKind: "storyboard-shot",
            retry: attempt > 1,
          });
          generationId = generation.id;
          job = { ...job, generationId, updatedAt: dependencies.now() };
          await persistJob(job, onJob);
          throwIfCanceled(isCanceled);
          if (generation.status === "failed") throwGenerationFailure(generation);
          completed = generation.status === "completed"
            ? generation
            : await waitForCompletedGeneration(generationId, dependencies, isCanceled);
        }
        if (isMocked(completed.mocked)) throw terminal(`分镜 ${storyboard.id} TTS 返回 mock 音频`, "mock_audio");
        const backend = String(completed.backend || "").trim();
        if (!backend || /mock|fallback|system-voice|silent/i.test(backend)) {
          throw terminal(`分镜 ${storyboard.id} TTS backend 非真实生成: ${backend || "missing"}`, "backend_invalid");
        }
        if (!completed.audioPath && !completed.audioUrl) {
          throw terminal(`分镜 ${storyboard.id} 生成完成但没有音频路径`, "audio_path_missing");
        }
        throwIfCanceled(isCanceled);
        const bytes = await dependencies.fetchAudio(generationId);
        throwIfCanceled(isCanceled);
        if (!(bytes.byteLength > 0)) throw terminal(`分镜 ${storyboard.id} 生成音频为空`, "audio_empty");
        const imported = await dependencies.writeGeneratedAudio({
          projectId,
          chapterId,
          shotId: storyboard.id,
          role: "voice",
          extension: "wav",
          bytes,
        });
        throwIfCanceled(isCanceled);
        const binding = await createStoryboardVoiceBinding({
          projectId,
          chapterId,
          storyboard,
          shotRevision,
          inputFingerprint,
          imported,
        });
        job = {
          ...job,
          status: "completed",
          generationId,
          emotionCapability: completed.emotionCapability ?? "metadata-only",
          updatedAt: dependencies.now(),
        };
        await persistJob(job, onJob);
        return {
          audioRef: createStoryboardAudioRefFromBinding(binding),
          shotAudioBinding: binding,
          ttsJob: job,
          generationId,
          ttsBackend: backend,
          ttsMocked: false,
          ttsEmotionCapability: completed.emotionCapability ?? "metadata-only",
          ttsWarning: completed.warning,
        };
      } catch (error) {
        if (error instanceof StoryboardTtsCanceledError) throw error;
        if (isRetryableTtsError(error) && offset + 1 < remainingAttempts) {
          lastRetryableError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastRetryableError ?? terminal("逐镜 TTS 重试耗尽", "retry_exhausted");
  } catch (error) {
    const canceled = error instanceof StoryboardTtsCanceledError || isCanceled();
    if (canceled && job.generationId && dependencies.cancelGeneration) {
      await dependencies.cancelGeneration(job.generationId).catch(() => undefined);
    }
    job = {
      ...job,
      status: canceled ? "canceled" : "failed",
      cancelRequested: canceled,
      errorCode: canceled ? "user_canceled" : ttsErrorCode(error),
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: dependencies.now(),
    };
    await persistJob(job, onJob);
    throw error;
  }
}

export function isRetryableTtsError(error: unknown): boolean {
  if (error instanceof StoryboardTtsOperationError) return error.retryable;
  if (!error || typeof error !== "object") return false;
  const value = error as { retryable?: unknown; status?: unknown; code?: unknown };
  if (value.retryable === true) return true;
  if (typeof value.status === "number") {
    return value.status === 408 || value.status === 429 || value.status >= 500;
  }
  return ["network", "timeout", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(String(value.code ?? ""));
}

function terminal(message: string, code: string): StoryboardTtsOperationError {
  return new StoryboardTtsOperationError(message, code, false);
}

function throwIfCanceled(isCanceled: () => boolean): void {
  if (isCanceled()) throw new StoryboardTtsCanceledError();
}

function isRetryableFlag(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

function ttsErrorCode(error: unknown): string {
  if (error instanceof StoryboardTtsOperationError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "tts_failed";
}

async function persistJob(
  job: StoryboardTtsJobV1,
  onJob: ((job: StoryboardTtsJobV1) => void | Promise<void>) | undefined,
): Promise<void> {
  await onJob?.(job);
}

export async function createStoryboardVoiceBinding(input: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  shotRevision: number;
  inputFingerprint: string;
  imported: RemotionImportedAudioV2;
}): Promise<RemotionShotAudioBindingV2> {
  const binding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `voice:${input.storyboard.id}:${input.inputFingerprint}`,
    bindingFingerprint: "0".repeat(64),
    renderScope: "shot",
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.storyboard.id,
    shotRevision: input.shotRevision,
    role: "voice",
    source: input.imported.source,
    sourceFingerprint: input.imported.source.contentSha256,
    sourceDurationUs: input.imported.durationUs,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: input.imported.durationUs,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
    ttsInputFingerprint: input.inputFingerprint,
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

export function createStoryboardAudioRefFromBinding(binding: RemotionShotAudioBindingV2): StoryboardMediaRef {
  return {
    kind: "audio",
    path: buildProjectFileUrl(binding.projectId, binding.source.relativePath),
    contentSha256: binding.source.contentSha256,
  };
}

function completedResult(
  job: StoryboardTtsJobV1,
  binding: RemotionShotAudioBindingV2,
  storyboard: StoryboardItem,
) {
  if (!job.generationId) throw new Error(`分镜 ${storyboard.id} completed TTS job 缺少 generationId`);
  return {
    audioRef: createStoryboardAudioRefFromBinding(binding),
    shotAudioBinding: binding,
    ttsJob: job,
    generationId: job.generationId,
    ttsBackend: storyboard.ttsBackend || "reused",
    ttsMocked: false as const,
    ttsEmotionCapability: job.emotionCapability ?? "metadata-only",
    ttsWarning: storyboard.ttsWarning,
  };
}
