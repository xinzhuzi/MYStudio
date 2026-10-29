import { assertStoryboardSpeech } from "./chapter-voiceover";
import { composeOrderedSpeechAudio } from "./storyboard-speech-wav";
import type { TtsSpeakerId } from "@/types/tts";
import { aiManager } from "@/lib/ai/ai-manager";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import { externalNarratorSpokenText } from "@/lib/assist/image-studio/h3-shot-prompt";
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

/** 10-11 R3b(判据收紧):本镜合成文本。H3 镜(mediaRef video=烧录音频在位)
 * =外挂旁白派生值(角色台词烧在镜内);静图产线镜=全文照旧——外挂 TTS 是
 * 其唯一音频来源,拆行会丢角色台词(R4 静图产线全链现状不动)。指纹与 submit
 * 同源:静图镜指纹回到全文口径,存量复用不破。 */
function ttsSpokenTextForGeneration(storyboard: StoryboardItem): string {
  const fullSpokenText = storyboard.ttsSpokenText ?? "";
  if (storyboard.mediaRef?.kind !== "video") return fullSpokenText.trim();
  return externalNarratorSpokenText(storyboard.lines, fullSpokenText).trim();
}

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
  composeAudioBytes?: (parts: ArrayBuffer[]) => Promise<ArrayBuffer>;
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
  profiles?: Partial<Record<TtsSpeakerId, VoiceProfile>>;
  referenceAudioSha256BySpeaker?: Partial<Record<TtsSpeakerId, string>>;
  utteranceProfiles?: VoiceProfile[];
  utteranceReferenceSha256s?: (string | undefined)[];
}): Promise<string> {
  const shotRevision = Math.max(1, input.storyboard.outputVersion ?? 1);
  const seed = 41001 + input.storyboard.index;
  return sha256CanonicalJson({
    ...(input.storyboard.speechUtterances?.length && input.storyboard.mediaRef?.kind !== "video" ? {
      compositionPolicy: "ordered-mono-pcm16-same-rate-v1",
      utterances: input.storyboard.speechUtterances.map((part, index) => {
        const profile = input.utteranceProfiles?.[index] ?? input.profiles?.[part.speakerId] ?? (part.speakerId === input.storyboard.speakerId ? input.profile : undefined);
        if (!profile) throw new Error(`speaker ${part.speakerId} 缺少固定 voice profile`);
        return { ...part, profile: { id: profile.id, type: profile.type, language: profile.language, engine: profile.defaultEngine,
          modelSize: profile.defaultModelSize ?? null, presetVoiceId: profile.presetVoiceId ?? null,
          referenceText: profile.referenceText ?? null, instruct: profile.instruct ?? null,
          referenceAudioSha256: input.utteranceReferenceSha256s?.[index] ?? input.referenceAudioSha256BySpeaker?.[part.speakerId] ?? input.referenceAudioSha256 ?? null } };
      }),
    } : {}),
    schemaVersion: 2,
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.storyboard.id,
    shotRevision,
    // 10-11 R3b 派生不存储:指纹锚「实际合成什么」——与 submit 同源
    // (H3 镜=旁白派生文本;静图镜=全文,存量复用不破)。
    text: ttsSpokenTextForGeneration(input.storyboard),
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
  profiles,
  utteranceProfiles,
  dependencies = defaultDependencies(),
  isCanceled = () => false,
  onJob,
}: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  profile: VoiceProfile;
  profiles?: Partial<Record<TtsSpeakerId, VoiceProfile>>;
  utteranceProfiles?: VoiceProfile[];
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
  if (storyboard.mediaRef?.kind !== "video") assertStoryboardSpeech(storyboard);
  if (storyboard.speechUtterances?.length && storyboard.mediaRef?.kind !== "video") {
    return runOrderedSpeech({ projectId, chapterId, storyboard, profile, profiles, utteranceProfiles, dependencies, isCanceled, onJob });
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
            // 10-11 R3b:合成文本与指纹同源(H3 镜=旁白派生值;静图产线镜=
            // 全文,R4 回归锁)。纯对白 H3 镜由 chapter-auto-video 前置守卫
            // 跳过,不触达本提交。
            text: ttsSpokenTextForGeneration(storyboard),
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
            retry: attempt > 1 || existingJob?.retryRequested === true,
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

async function runOrderedSpeech(input: {
  projectId: string; chapterId: string; storyboard: StoryboardItem; profile: VoiceProfile;
  profiles?: Partial<Record<TtsSpeakerId, VoiceProfile>>;
  utteranceProfiles?: VoiceProfile[];
  dependencies: StoryboardTtsRunnerDependencies; isCanceled: () => boolean;
  onJob?: (job: StoryboardTtsJobV1) => void | Promise<void>;
}): Promise<Awaited<ReturnType<typeof runStoryboardTtsGeneration>>> {
  const { projectId, chapterId, storyboard, dependencies: deps, isCanceled, onJob } = input;
  const utterances = storyboard.speechUtterances ?? [];
  const profiles: Partial<Record<TtsSpeakerId, VoiceProfile>> = { [storyboard.speakerId!]: input.profile, ...input.profiles };
  if (input.utteranceProfiles && input.utteranceProfiles.length !== utterances.length) throw new Error("逐句 voice profile 数量不匹配");
  const selectedProfiles = utterances.map((part, index) => input.utteranceProfiles?.[index] ?? profiles[part.speakerId]);
  // Validate the complete set before runtime, profile registration or submission.
  for (let index = 0; index < utterances.length; index++) {
    const part = utterances[index];
    const profile = selectedProfiles[index];
    if (!profile || !profiles[part.speakerId]) throw new Error(`speaker ${part.speakerId} 缺少固定 voice profile`);
    const error = validateVoiceProfileForGeneration(profile);
    if (error) throw new Error(`固定音色不可用: ${error}`);
  }
  throwIfCanceled(isCanceled);
  const hashes: (string | undefined)[] = [];
  for (let index = 0; index < utterances.length; index++) {
    const profile = selectedProfiles[index]!;
    if (profile.referenceAudioPath) {
      const path = await deps.resolveReferenceAudioPath(profile.referenceAudioPath);
      throwIfCanceled(isCanceled);
      if (!path) throw new Error(`固定音色文件不可读: ${profile.referenceAudioPath}`);
      hashes[index] = await deps.hashReferenceAudio(path);
      throwIfCanceled(isCanceled);
    }
  }
  const inputFingerprint = await createStoryboardTtsInputFingerprint({ ...input, profiles, utteranceReferenceSha256s: hashes });
  const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
  const prior = storyboard.ttsJob;
  const existing = prior?.inputFingerprint === inputFingerprint && prior.projectId === projectId && prior.chapterId === chapterId && prior.shotId === storyboard.id && prior.shotRevision === shotRevision ? prior : undefined;
  const bindings = storyboard.shotAudioBindings?.filter(b => b.role === "voice" && b.ttsInputFingerprint === inputFingerprint && b.shotRevision === shotRevision) ?? [];
  if (existing?.status === "completed" && bindings.length) {
    if (bindings.length !== 1) throw new Error("completed TTS job 必须有且仅有一个 canonical voice binding");
    const binding = bindings[0];
    const validation = validateRemotionShotAudioBindingV2(binding, { projectId, chapterId, shotId: storyboard.id, shotRevision, shotDurationUs: binding.durationUs });
    if (!validation.success || !(await validateRemotionAudioBindingFingerprint(binding)).success) throw new Error("completed TTS voice binding 身份或 fingerprint 不匹配");
    return completedResult(existing, binding, storyboard);
  }
  if (existing && ["failed", "canceled"].includes(existing.status) && !existing.retryRequested) throw new Error("TTS 已失败或取消，必须显式重试");
  const fingerprints = await Promise.all(utterances.map((part, index) => sha256CanonicalJson({ aggregate: inputFingerprint, index, ...part })));
  const segments = utterances.map((_, i) => {
    const previous = existing?.segments?.[i];
    return previous?.inputFingerprint === fingerprints[i] ? { ...previous } : { inputFingerprint: fingerprints[i], status: "queued" as const, attempt: 0 };
  });
  let job: StoryboardTtsJobV1 = { schemaVersion: 1, projectId, chapterId, shotId: storyboard.id, shotRevision, inputFingerprint,
    status: "queued", attempt: 0, createdAt: existing?.createdAt ?? deps.now(), updatedAt: deps.now(), segments };
  const save = async () => { job = { ...job, segments: segments.map(s => ({ ...s })), updatedAt: deps.now() }; await persistJob(job, onJob); };
  await save();
  // Include persisted work before startup or replay of an earlier completed part.
  const pendingGenerationIds = new Set(segments.filter(s => s.status === "queued" || s.status === "generating")
    .flatMap(s => s.generationId ? [s.generationId] : []));
  try {
    throwIfCanceled(isCanceled);
    const runtime = await deps.startRuntime();
    throwIfCanceled(isCanceled);
    if (!runtime.success) throw terminal(runtime.error || "TTS 后端启动失败", "runtime_start_failed");
    const audio: ArrayBuffer[] = [];
    for (let i = 0; i < utterances.length; i++) {
      const part = utterances[i]; const profile = selectedProfiles[i]!; const segment = segments[i];
      const first = segment.status === "completed" ? 0 : existing?.retryRequested ? 1 : Math.max(1, segment.attempt);
      for (let attempt = first; attempt <= DEFAULT_STORYBOARD_TTS_MAX_ATTEMPTS; attempt++) {
        try {
          throwIfCanceled(isCanceled);
          let completed: TtsGenerateResponse;
          if (segment.generationId && (segment.status === "completed" || segment.status === "generating" || segment.status === "queued")) {
            completed = await waitForCompletedGeneration(segment.generationId, deps, isCanceled);
          } else {
            segment.status = "generating"; segment.attempt = attempt;
            job = { ...job, status: "generating", attempt, retryRequested: false }; await save();
            await deps.ensureProfile(profile);
            throwIfCanceled(isCanceled);
            const generated = await deps.submit({ text: part.text, profileId: profile.id, engine: profile.defaultEngine,
              modelSize: profile.defaultModelSize, language: profile.language, seed: 41001 + storyboard.index + i,
              projectId, chapterId, shotId: storyboard.id, shotRevision, inputFingerprint: segment.inputFingerprint,
              referenceAudioSha256: hashes[i], emotion: storyboard.emotion?.trim(), voiceStyle: storyboard.voiceStyle?.trim(),
              generationKind: "storyboard-shot", retry: attempt > 1 || existing?.retryRequested === true });
            segment.generationId = generated.id; pendingGenerationIds.add(generated.id); job.generationId = generated.id; await save();
            throwIfCanceled(isCanceled);
            if (generated.status === "failed") throwGenerationFailure(generated);
            completed = generated.status === "completed" ? generated : await waitForCompletedGeneration(generated.id, deps, isCanceled);
          }
          const backend = String(completed.backend || "").trim();
          if (isMocked(completed.mocked)) throw terminal("TTS 返回 mock 音频", "mock_audio");
          if (!backend || /mock|fallback|system-voice|silent/i.test(backend)) throw terminal("TTS backend 非真实生成", "backend_invalid");
          if (!completed.audioPath && !completed.audioUrl) throw terminal("生成完成但没有音频路径", "audio_path_missing");
          const bytes = await deps.fetchAudio(segment.generationId!); throwIfCanceled(isCanceled);
          if (!bytes.byteLength) throw terminal("生成音频为空", "audio_empty");
          segment.status = "completed"; segment.backend = backend;
          segment.emotionCapability = completed.emotionCapability ?? "metadata-only"; segment.warning = completed.warning;
          pendingGenerationIds.delete(segment.generationId!);
          await save(); audio.push(bytes); break;
        } catch (error) {
          if (segment.status !== "completed") segment.status = error instanceof StoryboardTtsCanceledError ? "canceled" : "failed";
          await save();
          if (!(error instanceof StoryboardTtsCanceledError) && isRetryableTtsError(error) && attempt > 0 && attempt < DEFAULT_STORYBOARD_TTS_MAX_ATTEMPTS) continue;
          throw error;
        }
      }
    }
    throwIfCanceled(isCanceled);
    const bytes = audio.length === 1 ? audio[0] : await (deps.composeAudioBytes ?? composeOrderedSpeechAudio)(audio);
    throwIfCanceled(isCanceled);
    if (!bytes.byteLength) throw terminal("合并声音为空", "audio_empty");
    const imported = await deps.writeGeneratedAudio({ projectId, chapterId, shotId: storyboard.id, role: "voice", extension: "wav", bytes });
    throwIfCanceled(isCanceled);
    if (!Number.isSafeInteger(imported.durationUs) || imported.durationUs <= 0) throw terminal("合并声音实测时长无效", "duration_invalid");
    const binding = await createStoryboardVoiceBinding({ projectId, chapterId, storyboard, shotRevision, inputFingerprint, imported });
    const generationId = segments[segments.length - 1].generationId!;
    job = { ...job, status: "completed", generationId, emotionCapability: segments.every(s => s.emotionCapability === "applied") ? "applied" : "metadata-only" };
    await save();
    return { audioRef: createStoryboardAudioRefFromBinding(binding), shotAudioBinding: binding, ttsJob: job, generationId,
      ttsBackend: [...new Set(segments.map(s => s.backend))].join("+"), ttsMocked: false,
      ttsEmotionCapability: job.emotionCapability ?? "metadata-only", ttsWarning: segments.map(s => s.warning).filter(Boolean).join("; ") || undefined };
  } catch (error) {
    const canceled = error instanceof StoryboardTtsCanceledError || isCanceled();
    if (canceled) {
      // Local cancellation is not proof that the backend stopped. Attempt every ID
      // independently, retaining IDs and completed parts for explicit retry/reuse.
      await Promise.allSettled([...pendingGenerationIds].map(async id => deps.cancelGeneration?.(id)));
      for (const segment of segments) {
        if (segment.status === "queued" || segment.status === "generating"
          || (segment.status !== "completed" && segment.generationId && pendingGenerationIds.has(segment.generationId))) segment.status = "canceled";
      }
    }
    job = { ...job, status: canceled ? "canceled" : "failed", cancelRequested: canceled, errorCode: canceled ? "user_canceled" : ttsErrorCode(error), errorMessage: error instanceof Error ? error.message : String(error) };
    if (canceled && pendingGenerationIds.size) job.errorMessage += "；后端取消仅尽力请求，未确认远端停止";
    await save(); throw error;
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
