import { aiManager } from "@/lib/ai/ai-manager";
import {
  ensureBackendVoiceProfile,
  fetchGenerationAudio,
  getGenerationStatus,
  startTtsRuntime,
} from "@/lib/tts/client";
import { validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";
import type { StoryboardItem, StoryboardMediaRef } from "@/types/studio";
import type {
  TtsGenerateRequest,
  TtsGenerateResponse,
  TtsRuntimeCommandResult,
  VoiceProfile,
} from "@/types/tts";

interface SavedAudioMaterial {
  success: boolean;
  localPath?: string;
  filePath?: string;
  error?: string;
}

export interface StoryboardTtsRunnerDependencies {
  startRuntime: () => Promise<TtsRuntimeCommandResult>;
  ensureProfile: (profile: VoiceProfile) => Promise<unknown>;
  submit: (payload: TtsGenerateRequest) => Promise<TtsGenerateResponse>;
  getStatus: (generationId: string) => Promise<TtsGenerateResponse>;
  fetchAudio: (generationId: string) => Promise<ArrayBuffer>;
  saveMaterial: (payload: {
    name: string;
    bytes: ArrayBuffer;
  }) => Promise<SavedAudioMaterial>;
  resolveReferenceAudioPath: (audioPath: string) => Promise<string | null>;
  delay: (ms: number) => Promise<void>;
}

function defaultDependencies(): StoryboardTtsRunnerDependencies {
  if (!window.studioAssets?.saveMaterial) {
    throw new Error("素材保存接口仅在桌面应用中可用");
  }
  if (!window.ttsRuntime?.resolveReferenceAudioPath) {
    throw new Error("固定音色文件校验接口仅在桌面应用中可用");
  }
  return {
    startRuntime: startTtsRuntime,
    ensureProfile: ensureBackendVoiceProfile,
    submit: (payload) => aiManager.tts(payload),
    getStatus: getGenerationStatus,
    fetchAudio: fetchGenerationAudio,
    saveMaterial: (payload) => window.studioAssets!.saveMaterial(payload),
    resolveReferenceAudioPath: (audioPath) =>
      window.ttsRuntime!.resolveReferenceAudioPath(audioPath),
    delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  };
}

function generationError(result: TtsGenerateResponse) {
  return result.error || "口播生成失败";
}

function isMocked(value: boolean | number | undefined) {
  return typeof value === "number" ? value === 1 : value === true;
}

async function waitForCompletedGeneration(
  generationId: string,
  dependencies: StoryboardTtsRunnerDependencies,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await dependencies.getStatus(generationId);
    if (status.status === "completed") return status;
    if (status.status === "failed") throw new Error(generationError(status));
    await dependencies.delay(1000);
  }
  throw new Error("口播生成超时");
}

export async function runStoryboardTtsGeneration({
  storyboard,
  profile,
  dependencies = defaultDependencies(),
}: {
  storyboard: StoryboardItem;
  profile: VoiceProfile;
  dependencies?: StoryboardTtsRunnerDependencies;
}): Promise<{
  audioRef: StoryboardMediaRef;
  generationId: string;
  ttsBackend: string;
  ttsMocked: false;
  ttsWarning?: string;
}> {
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
  if (
    profile.referenceAudioPath
    && !(await dependencies.resolveReferenceAudioPath(profile.referenceAudioPath))
  ) {
    throw new Error(
      `分镜 ${storyboard.id} 固定音色文件不可读: ${profile.referenceAudioPath}`,
    );
  }

  const runtime = await dependencies.startRuntime();
  if (!runtime.success) {
    throw new Error(runtime.error || "TTS 后端启动失败");
  }
  await dependencies.ensureProfile(profile);
  const generation = await dependencies.submit({
    text: storyboard.ttsSpokenText.trim(),
    profileId: profile.id,
    engine: profile.defaultEngine,
    modelSize: profile.defaultModelSize,
    language: profile.language,
    seed: 41001 + storyboard.index,
  });
  const completed = await waitForCompletedGeneration(
    generation.id,
    dependencies,
  );
  if (isMocked(completed.mocked)) {
    throw new Error(`分镜 ${storyboard.id} TTS 返回 mock 音频`);
  }
  const backend = String(completed.backend || "").trim();
  if (!backend || /mock|fallback|system-voice|silent/i.test(backend)) {
    throw new Error(`分镜 ${storyboard.id} TTS backend 非真实生成: ${backend || "missing"}`);
  }
  if (!completed.audioPath && !completed.audioUrl) {
    throw new Error(`分镜 ${storyboard.id} 生成完成但没有音频路径`);
  }
  const bytes = await dependencies.fetchAudio(generation.id);
  if (!(bytes.byteLength > 0)) {
    throw new Error(`分镜 ${storyboard.id} 生成音频为空`);
  }
  const material = await dependencies.saveMaterial({
    name: `${storyboard.id}-voice-${Date.now()}.wav`,
    bytes,
  });
  const audioPath = material.filePath || material.localPath;
  if (!material.success || !audioPath) {
    throw new Error(material.error || `分镜 ${storyboard.id} 保存音频素材失败`);
  }

  return {
    audioRef: { kind: "audio", path: audioPath },
    generationId: generation.id,
    ttsBackend: backend,
    ttsMocked: false,
    ttsWarning: completed.warning,
  };
}
