import type {
  BackendModelStatus,
  TtsActiveTasksResponse,
  TtsGenerateRequest,
  TtsGenerateResponse,
  TtsModelCacheInfo,
  TtsRuntimeConfig,
  TtsRuntimeCommandResult,
  TtsRuntimeStatus,
  VoiceProfile,
} from "@/types/tts";

export { LOCAL_TTS_BASE_URL } from "./constants";

export interface ModelStatusResponse {
  models: BackendModelStatus[];
}

function assertTtsRuntime() {
  if (typeof window === "undefined" || !window.ttsRuntime) {
    throw new Error("本地 TTS 仅在桌面应用中可用");
  }
  return window.ttsRuntime;
}

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return assertTtsRuntime().request({ method, path, body }) as Promise<T>;
}

export function getTtsRuntimeStatus(): Promise<TtsRuntimeStatus> {
  return assertTtsRuntime().status();
}

export function startTtsRuntime(): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().start();
}

export function setupTtsRuntime(): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().setup();
}

export function stopTtsRuntime(): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().stop();
}

export function getTtsRuntimeConfig(): Promise<TtsRuntimeConfig> {
  return assertTtsRuntime().getConfig();
}

export function setTtsRuntimeConfig(config: Partial<TtsRuntimeConfig>): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().setConfig(config);
}

export function setTtsModelCacheDir(dirPath: string): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().setModelCacheDir(dirPath);
}

export function getModelStatus(): Promise<ModelStatusResponse> {
  return request<ModelStatusResponse>("GET", "/models/status");
}

export function getModelCacheDir(): Promise<TtsModelCacheInfo> {
  return request<TtsModelCacheInfo>("GET", "/models/cache-dir");
}

export function downloadModel(modelName: string) {
  return request<{ message: string }>("POST", "/models/download", { model_name: modelName });
}

export function cancelModelDownload(modelName: string) {
  return request<{ message: string }>("POST", "/models/download/cancel", { model_name: modelName });
}

export function deleteModel(modelName: string) {
  return request<{ message: string }>("DELETE", `/models/${encodeURIComponent(modelName)}`);
}

export function unloadModel(modelName: string) {
  return request<{ message: string }>("POST", `/models/${encodeURIComponent(modelName)}/unload`);
}

export function getActiveTasks(): Promise<TtsActiveTasksResponse> {
  return request<TtsActiveTasksResponse>("GET", "/tasks/active");
}

export function listVoiceProfiles(): Promise<VoiceProfile[]> {
  return request<VoiceProfile[]>("GET", "/profiles");
}

export function createBackendVoiceProfile(payload: Partial<VoiceProfile>) {
  // Map frontend camelCase to backend snake_case
  const body: Record<string, unknown> = {
    name: payload.id ?? payload.name,
    language: payload.language ?? "zh",
    voice_type: payload.type === "reference" ? "cloned" : (payload.type ?? "cloned"),
    default_engine: payload.defaultEngine,
  };
  if (payload.type === "preset" || payload.type === undefined) {
    if (payload.presetVoiceId) {
      body.preset_engine = payload.defaultEngine ?? "qwen_custom_voice";
      body.preset_voice_id = payload.presetVoiceId;
    }
  }
  return request<VoiceProfile>("POST", "/profiles", body);
}

/** Upload an audio sample to a backend voice profile (for cloning). */
export async function uploadProfileSample(
  backendProfileId: string,
  audioFilePath: string,
  referenceText?: string,
): Promise<unknown> {
  return assertTtsRuntime().requestFormData({
    path: `/profiles/${encodeURIComponent(backendProfileId)}/samples`,
    audioFilePath,
    referenceText,
  });
}

/** List backend profiles and find one by name. */
export async function findBackendProfileByName(name: string): Promise<VoiceProfile | undefined> {
  const profiles = await listVoiceProfiles();
  return profiles.find((p) => p.name === name);
}

export function generateSpeech(payload: TtsGenerateRequest): Promise<TtsGenerateResponse> {
  return request<TtsGenerateResponse>("POST", "/generate", {
    text: payload.text,
    profile_id: payload.profileId,
    engine: payload.engine,
    model_size: payload.modelSize,
    language: payload.language,
    seed: payload.seed,
  });
}

export function getGenerationStatus(generationId: string): Promise<TtsGenerateResponse> {
  return request<TtsGenerateResponse>("GET", `/generate/${encodeURIComponent(generationId)}/status`);
}

export async function getTtsBaseUrl() {
  const status = await getTtsRuntimeStatus();
  return status.baseUrl;
}

export async function fetchGenerationAudio(generationId: string): Promise<ArrayBuffer> {
  const result = await assertTtsRuntime().requestBytes({
    method: "GET",
    path: `/audio/${encodeURIComponent(generationId)}`,
  });
  return result.data;
}

export async function subscribeModelProgress(
  modelName: string,
  onProgress: (event: unknown) => void,
  onError?: (error: Event) => void,
) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (cancelled) return;
    try {
      const response = await request<{ model_name: string; status: string; error?: string }>("GET", `/models/progress-json/${encodeURIComponent(modelName)}`);
      onProgress(response);
      if (response.status === "complete" || response.status === "error" || response.status === "idle") return;
      timer = setTimeout(poll, 500);
    } catch (error) {
      onError?.(error instanceof Event ? error : new Event("error"));
    }
  };
  await poll();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
