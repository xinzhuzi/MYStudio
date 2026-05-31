export type TtsEngine =
  | "qwen"
  | "qwen_custom_voice"
  | "luxtts"
  | "chatterbox"
  | "chatterbox_turbo"
  | "tada"
  | "kokoro"
  | "whisper"
  | "sensevoice";

export type TtsModelPurpose = "voiceClone" | "presetVoice" | "longAudio" | "stt";

export type TtsSpeakerId = "narrator" | `character:${string}`;

export type SceneVoiceLineStatus = "idle" | "queued" | "generating" | "completed" | "failed";

export interface SceneVoiceLine {
  sceneId: number;
  speakerId: TtsSpeakerId;
  text: string;
  profileId?: string;
  engine: TtsEngine;
  modelSize?: string;
  status: SceneVoiceLineStatus;
  generationId?: string;
  audioLocalPath?: string;
  audioMaterialId?: string;
  audioFilePath?: string;
  ttsBackend?: string;
  mocked?: boolean;
  warning?: string;
  error?: string;
  updatedAt: number;
}

export interface ProjectVoiceBinding {
  speakerId: TtsSpeakerId;
  profileId: string;
  defaultEngine?: TtsEngine;
  defaultModelSize?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  type: "reference" | "preset";
  language: string;
  defaultEngine: TtsEngine;
  defaultModelSize?: string;
  referenceAudioPath?: string;
  referenceText?: string;
  presetVoiceId?: string;
  instruct?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TtsModelDefinition {
  modelName: string;
  displayName: string;
  engine: TtsEngine;
  hfRepoId: string;
  modelSize?: string;
  sizeMb: number;
  languages: string[];
  purpose: TtsModelPurpose;
  description: string;
  supportsInstruct?: boolean;
}

export interface TtsModelGroup {
  id: TtsModelPurpose;
  title: string;
  description: string;
  models: TtsModelDefinition[];
}

export interface BackendModelStatus {
  model_name: string;
  display_name?: string;
  hf_repo_id?: string;
  downloaded: boolean;
  downloading: boolean;
  loaded: boolean;
  size_mb?: number | null;
  model_cache_dir?: string | null;
  model_repo_path?: string | null;
}

export interface TtsModelCacheInfo {
  path: string;
  download_path?: string;
  scan_paths?: string[];
}

export interface TtsModelRow extends TtsModelDefinition {
  downloaded: boolean;
  downloading: boolean;
  loaded: boolean;
  sizeMb: number;
  backendDisplayName?: string;
  backendRepoId?: string;
  modelCacheDir?: string;
  modelRepoPath?: string;
}

export interface TtsRuntimeStatus {
  installed: boolean;
  running: boolean;
  managed?: boolean;
  port: number;
  baseUrl: string;
  setupStage?: TtsRuntimeSetupStage;
  setupMessage?: string;
  setupProgress?: number;
  cacheDir?: string;
  modelCacheDir?: string;
  defaultModelCacheDir?: string;
  systemModelCacheDir?: string;
  pythonRuntimeDir?: string;
  pid?: number;
  error?: string;
}

export interface TtsRuntimeConfig {
  pythonRuntimeUrl?: string;
  defaultPythonRuntimeUrl?: string;
  pythonRuntimeDir?: string;
  installedItems?: TtsRuntimeInstalledItem[];
}

export interface TtsRuntimeInstalledItem {
  label: string;
  detail: string;
  status: "pending" | "installed" | "skipped" | "failed";
}

export type TtsRuntimeSetupStage =
  | "idle"
  | "checking"
  | "downloading-python"
  | "extracting-python"
  | "installing-deps"
  | "starting-backend"
  | "ready"
  | "failed";

export interface TtsRuntimeCommandResult {
  success: boolean;
  status?: TtsRuntimeStatus;
  error?: string;
}

export interface TtsGenerateRequest {
  text: string;
  profileId: string;
  engine: TtsEngine;
  modelSize?: string;
  language?: string;
  seed?: number;
}

export interface TtsGenerateResponse {
  id: string;
  status: SceneVoiceLineStatus | "loading_model";
  audioUrl?: string;
  audioPath?: string;
  backend?: string;
  mocked?: boolean | number;
  warning?: string;
  error?: string;
}

export interface TtsActiveTask {
  task_id: string;
  model_name?: string;
  profile_id?: string;
  text?: string;
  status: string;
  error?: string;
}

export interface TtsActiveTasksResponse {
  downloads: TtsActiveTask[];
  generations: TtsActiveTask[];
}
