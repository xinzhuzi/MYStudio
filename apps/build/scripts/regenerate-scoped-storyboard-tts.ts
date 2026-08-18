import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { StoryboardItem } from "@/types/studio";
import {
  runStoryboardTtsGeneration,
  type StoryboardTtsRunnerDependencies,
} from "@/lib/studio/storyboard-tts-runner";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/constants";
import type { TtsGenerateResponse, VoiceProfile } from "@/types/tts";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { writeStudioWorkflowStore } from "@/electron/storage/studio-workflow-store-io";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
} from "../timeline/storage-paths";

type StoryboardTtsWriteback = Awaited<ReturnType<typeof runStoryboardTtsGeneration>>;

export interface ScopedTtsResult {
  storyboardId: string;
  writeback: StoryboardTtsWriteback;
}

interface TtsProfileRow {
  id: string;
  name: string;
  voice_type: "reference" | "preset";
  language: string;
  default_engine: VoiceProfile["defaultEngine"];
  default_model_size?: string | null;
  reference_audio_path?: string | null;
  reference_text?: string | null;
  preset_voice_id?: string | null;
  instruct?: string | null;
  created_at: number;
  updated_at: number;
}

interface TtsGenerationRow extends Record<string, unknown> {
  id: string;
  status: TtsGenerateResponse["status"];
  profile_id?: string;
}

interface WorkflowStoreRoot {
  version: number;
  state: {
    storyboards: StoryboardItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function parseScopedShotIds(value: string | undefined): string[] {
  if (value === undefined) throw new Error("MYSTUDIO_SHOT_IDS 必须显式提供");
  const shotIds = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (shotIds.length === 0) throw new Error("MYSTUDIO_SHOT_IDS 必须包含至少一个 shot ID");
  if (new Set(shotIds).size !== shotIds.length) {
    throw new Error("MYSTUDIO_SHOT_IDS 不得包含重复 shot ID");
  }
  return shotIds;
}

export function selectScopedStoryboards<T extends Pick<StoryboardItem, "id">>(
  storyboards: readonly T[],
  shotIds: readonly string[],
): T[] {
  const byId = new Map(storyboards.map((storyboard) => [storyboard.id, storyboard]));
  const unknown = shotIds.filter((shotId) => !byId.has(shotId));
  if (unknown.length > 0) {
    throw new Error(`MYSTUDIO_SHOT_IDS 包含当前 store 不存在的 shot: ${unknown.join(", ")}`);
  }
  return shotIds.map((shotId) => byId.get(shotId)!);
}

export function applyScopedTtsResults<T extends Pick<StoryboardItem, "id" | "outputVersion" | "shotAudioBindings">>(
  storyboards: readonly T[],
  results: readonly ScopedTtsResult[],
): T[] {
  const byId = new Map(results.map((result) => [result.storyboardId, result]));
  if (byId.size !== results.length) throw new Error("scoped TTS 结果不得包含重复 storyboardId");
  selectScopedStoryboards(storyboards, [...byId.keys()]);

  return storyboards.map((storyboard) => {
    const result = byId.get(storyboard.id);
    if (!result) return storyboard;
    const revision = Math.max(1, storyboard.outputVersion ?? 1);
    const { shotAudioBinding, ttsJob } = result.writeback;
    if (
      shotAudioBinding.role !== "voice"
      || shotAudioBinding.shotId !== storyboard.id
      || ttsJob.shotId !== storyboard.id
      || shotAudioBinding.shotRevision !== revision
      || ttsJob.shotRevision !== revision
    ) {
      throw new Error(`分镜 ${storyboard.id} scoped TTS revision/identity 不匹配`);
    }
    if (
      ttsJob.status !== "completed"
      || ttsJob.inputFingerprint !== shotAudioBinding.ttsInputFingerprint
    ) {
      throw new Error(`分镜 ${storyboard.id} scoped TTS fingerprint/completion 不匹配`);
    }
    const retainedBindings = storyboard.shotAudioBindings?.filter((binding) => binding.role !== "voice") ?? [];
    return {
      ...storyboard,
      audioRef: result.writeback.audioRef,
      shotAudioBindings: [...retainedBindings, shotAudioBinding],
      ttsJob,
      ttsGenerationId: result.writeback.generationId,
      ttsBackend: result.writeback.ttsBackend,
      ttsMocked: result.writeback.ttsMocked,
      ttsEmotionCapability: result.writeback.ttsEmotionCapability,
      ttsWarning: result.writeback.ttsWarning,
    };
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 必须显式提供`);
  return value;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseWorkflowStore(raw: string): WorkflowStoreRoot {
  const parsed = JSON.parse(raw) as Partial<WorkflowStoreRoot>;
  if (!parsed.state || !Array.isArray(parsed.state.storyboards)) {
    throw new Error("studio-workflow-store.json 缺少 state.storyboards 数组");
  }
  return parsed as WorkflowStoreRoot;
}

function profileFromRow(row: TtsProfileRow): VoiceProfile {
  return {
    id: row.id,
    name: row.name,
    type: row.voice_type,
    language: row.language,
    defaultEngine: row.default_engine,
    ...(row.default_model_size ? { defaultModelSize: row.default_model_size } : {}),
    ...(row.reference_audio_path ? { referenceAudioPath: row.reference_audio_path } : {}),
    ...(row.reference_text ? { referenceText: row.reference_text } : {}),
    ...(row.preset_voice_id ? { presetVoiceId: row.preset_voice_id } : {}),
    ...(row.instruct ? { instruct: row.instruct } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeGenerationResponse(row: TtsGenerationRow): TtsGenerateResponse {
  return {
    id: row.id,
    status: row.status,
    audioPath: stringValue(row.audioPath ?? row.audio_path),
    backend: stringValue(row.backend),
    mocked: booleanOrNumber(row.mocked),
    warning: stringValue(row.warning),
    error: stringValue(row.error),
    errorCode: stringValue(row.errorCode ?? row.error_code),
    retryable: booleanOrNumber(row.retryable),
    attempt: numberValue(row.attempt),
    inputFingerprint: stringValue(row.inputFingerprint ?? row.input_fingerprint),
    emotionCapability: emotionCapability(row.emotionCapability ?? row.emotion_capability),
    generationKind: (row.generationKind ?? row.generation_kind) === "storyboard-shot"
      ? "storyboard-shot"
      : undefined,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrNumber(value: unknown): boolean | number | undefined {
  return typeof value === "boolean" || typeof value === "number" ? value : undefined;
}

function emotionCapability(value: unknown): TtsGenerateResponse["emotionCapability"] {
  return value === "applied" || value === "metadata-only" || value === "unsupported" || value === "not-requested"
    ? value
    : undefined;
}

async function requestJson<T>(
  baseUrl: string,
  token: string,
  route: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-Manying-TTS-Token": token,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    throw new Error(`TTS ${init?.method ?? "GET"} ${route} 失败: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function createRunnerDependencies(input: {
  baseUrl: string;
  token: string;
  profile: VoiceProfile;
  audioService: RemotionChapterManifestService;
}): StoryboardTtsRunnerDependencies {
  return {
    startRuntime: async () => {
      const health = await fetch(`${input.baseUrl}/health`);
      return health.ok
        ? { success: true, status: { installed: true, running: true, port: Number(new URL(input.baseUrl).port), baseUrl: input.baseUrl } }
        : { success: false, error: `TTS health check failed: HTTP ${health.status}` };
    },
    ensureProfile: async (profile) => {
      if (profile.id !== input.profile.id) throw new Error(`TTS profile 身份漂移: ${profile.id}`);
    },
    submit: async (payload) => normalizeGenerationResponse(await requestJson<TtsGenerationRow>(
      input.baseUrl,
      input.token,
      "/generate",
      {
        method: "POST",
        body: {
          text: payload.text,
          profile_id: payload.profileId,
          engine: payload.engine,
          model_size: payload.modelSize,
          language: payload.language,
          seed: payload.seed,
          project_id: payload.projectId,
          chapter_id: payload.chapterId,
          shot_id: payload.shotId,
          shot_revision: payload.shotRevision,
          input_fingerprint: payload.inputFingerprint,
          reference_audio_sha256: payload.referenceAudioSha256,
          emotion: payload.emotion,
          voice_style: payload.voiceStyle,
          generation_kind: payload.generationKind,
          retry: payload.retry,
        },
      },
    )),
    getStatus: async (generationId) => normalizeGenerationResponse(await requestJson<TtsGenerationRow>(
      input.baseUrl,
      input.token,
      `/generate/${encodeURIComponent(generationId)}/status`,
    )),
    fetchAudio: async (generationId) => {
      const response = await fetch(`${input.baseUrl}/audio/${encodeURIComponent(generationId)}`, {
        headers: { "X-Manying-TTS-Token": input.token },
      });
      if (!response.ok) throw new Error(`TTS audio fetch 失败: HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    writeGeneratedAudio: (payload) => input.audioService.writeGeneratedShotAudio(payload),
    resolveReferenceAudioPath: async (audioPath) => {
      if (!path.isAbsolute(audioPath) || !fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) return null;
      return fs.realpathSync(audioPath);
    },
    hashReferenceAudio: async (audioPath) => sha256(fs.readFileSync(audioPath)),
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: Date.now,
  };
}

export async function runScopedStoryboardTtsRepair(): Promise<void> {
  const projectRoot = path.resolve(requiredEnv("MYSTUDIO_PROJECT_DIR"));
  const projectId = requiredEnv("MYSTUDIO_PROJECT_ID");
  const chapterId = requiredEnv("MYSTUDIO_CHAPTER_ID");
  const shotIds = parseScopedShotIds(process.env.MYSTUDIO_SHOT_IDS);
  const token = requiredEnv("MYSTUDIO_TTS_CONTROL_TOKEN");
  const baseUrl = process.env.MYSTUDIO_TTS_BASE_URL?.trim() || LOCAL_TTS_BASE_URL;
  const storePath = path.join(projectRoot, "studio-workflow-store.json");
  // 分片感知读取：分片布局优先，legacy 单文件兜底（raw 为 CAS 基准串）
  const initialSnapshot = readStudioWorkflowStoreState(projectRoot);
  if (!initialSnapshot) throw new Error(`studio-workflow store 不存在（分片/单文件均缺失）: ${storePath}`);
  const initialSha256 = sha256(initialSnapshot.raw);
  const initialStore = parseWorkflowStore(initialSnapshot.raw);
  const selected = selectScopedStoryboards(initialStore.state.storyboards, shotIds);
  const backupPath = path.join(projectRoot, "backups", "store", `studio-workflow-store.json.bak-scoped-tts-${Date.now()}`);
  fs.writeFileSync(backupPath, initialSnapshot.raw, { encoding: "utf8", flag: "wx" });

  const profileRows = await requestJson<TtsProfileRow[]>(baseUrl, token, "/profiles");
  const profilesById = new Map(profileRows.map((row) => [row.id, row]));
  const audioService = new RemotionChapterManifestService({
    projectRootForProject: (requestedProjectId) => {
      if (requestedProjectId !== projectId) throw new Error(`projectId 越界: ${requestedProjectId}`);
      return projectRoot;
    },
    probeMedia: async (filePath) => {
      const probe = await probeRenderedMedia(filePath);
      return {
        durationUs: Math.round(probe.duration * 1_000_000),
        streams: probe.streams,
      };
    },
  });
  const results: ScopedTtsResult[] = [];

  for (const storyboard of selected) {
    const generationId = storyboard.ttsJob?.generationId;
    if (storyboard.ttsJob?.status !== "completed" || !generationId) {
      throw new Error(`分镜 ${storyboard.id} 缺少可追溯的 completed TTS generationId`);
    }
    const previous = await requestJson<TtsGenerationRow>(
      baseUrl,
      token,
      `/generate/${encodeURIComponent(generationId)}/status`,
    );
    const profileId = stringValue(previous.profile_id);
    const profileRow = profileId ? profilesById.get(profileId) : undefined;
    if (!profileId || !profileRow) {
      throw new Error(`分镜 ${storyboard.id} 的历史 TTS profile 不存在: ${profileId ?? "missing"}`);
    }
    const profile = profileFromRow(profileRow);
    const writeback = await runStoryboardTtsGeneration({
      projectId,
      chapterId,
      storyboard,
      profile,
      dependencies: createRunnerDependencies({ baseUrl, token, profile, audioService }),
    });
    results.push({ storyboardId: storyboard.id, writeback });
  }

  const latestSnapshot = readStudioWorkflowStoreState(projectRoot);
  if (!latestSnapshot || sha256(latestSnapshot.raw) !== initialSha256) {
    throw new Error("TTS 生成期间 studio-workflow-store 已变化，拒绝覆盖");
  }
  const nextStore = parseWorkflowStore(latestSnapshot.raw);
  nextStore.state.storyboards = applyScopedTtsResults(nextStore.state.storyboards, results);
  // 写回走分片布局（stamp 换名 + manifest 最后换新；legacy 项目首次写回即迁移）
  const writeResult = writeStudioWorkflowStore(
    deriveStorageRoots(projectRoot).dataRoot,
    projectId,
    JSON.stringify({ state: nextStore.state, version: nextStore.version }),
  );
  process.stderr.write(`[scoped-tts] 分片写回 ${writeResult.shardNames.length} 片\n`);
  if (writeResult.legacyBackupPath) {
    process.stderr.write(`[scoped-tts] legacy 单文件已改名保留 → ${writeResult.legacyBackupPath}\n`);
  }
  // 写回后复核：重读合并串必须反映本次写回（CAS 闭环）
  const verifySnapshot = readStudioWorkflowStoreState(projectRoot);
  if (!verifySnapshot) throw new Error("studio-workflow store 写回后不可读");
  const finalSha256 = sha256(verifySnapshot.raw);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    projectId,
    chapterId,
    shotIds,
    backupPath,
    initialSha256,
    finalSha256,
    results: results.map(({ storyboardId, writeback }) => ({
      storyboardId,
      shotRevision: writeback.ttsJob.shotRevision,
      inputFingerprint: writeback.ttsJob.inputFingerprint,
      generationId: writeback.generationId,
      backend: writeback.ttsBackend,
      audioSha256: writeback.audioRef.contentSha256,
    })),
  }, null, 2)}\n`);
}

const isDirectExecution = process.env.MYSTUDIO_SCOPED_TTS_REPAIR === "1"
  || (process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false);
if (isDirectExecution) {
  void runScopedStoryboardTtsRepair().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
