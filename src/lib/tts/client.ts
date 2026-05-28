import type {
  BackendModelStatus,
  TtsActiveTasksResponse,
  TtsGenerateRequest,
  TtsGenerateResponse,
  TtsModelCacheInfo,
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

export function stopTtsRuntime(): Promise<TtsRuntimeCommandResult> {
  return assertTtsRuntime().stop();
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
  return request<VoiceProfile>("POST", "/profiles", payload);
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
  const baseUrl = await getTtsBaseUrl();
  const response = await fetch(`${baseUrl}/audio/${encodeURIComponent(generationId)}`);
  if (!response.ok) {
    throw new Error(`音频下载失败 (${response.status})`);
  }
  return response.arrayBuffer();
}

export async function subscribeModelProgress(
  modelName: string,
  onProgress: (event: unknown) => void,
  onError?: (error: Event) => void,
) {
  const baseUrl = await getTtsBaseUrl();
  const source = new EventSource(`${baseUrl}/models/progress/${encodeURIComponent(modelName)}`);
  source.onmessage = (event) => {
    try {
      onProgress(JSON.parse(event.data));
    } catch {
      onProgress(event.data);
    }
  };
  if (onError) source.onerror = onError;
  return () => source.close();
}
