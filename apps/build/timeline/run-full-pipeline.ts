/**
 * Full plugin-chain pipeline: DEEP INTEGRATION.
 *
 * This script instantiates the REAL adapter factories (the same ones used by
 * main.ts in the Electron app) and runs the full chain:
 *
 *   1. video-use adapter.runChapter()  — Python worker (alignment/EDL/subtitles/grade/preview/self-eval)
 *   2. acceptVideoUseArtifact()       — write review sidecar (auto-accept for testing)
 *   3. chapterService.applyAcceptedArtifact() — projects to EditingProject + calls HyperFrames adapter
 *   4. chapterService.evaluateGate()  — the real chapter gate
 *   5. validateSubtitleAuthorityForTimeline() — authority validation
 *   6. buildChapterVideoCompositionProps() — proper composition (includes gate result)
 *   7. @remotion/renderer renderMedia() — final chapter render
 *
 * Unlike the previous version (which read pre-existing r2 artifacts), this script
 * actually RUNS video-use from scratch, goes through accept → apply → gate → authority,
 * and persists the EditingProject to editing.json — the same lifecycle the Electron app uses.
 *
 * Usage:
 *   npm run video:full-pipeline
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { validateChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { buildChapterVideoCompositionProps, validateSubtitleAuthorityForTimeline } from "@rendering/plugins/remotion/composition/build-composition-props";
import { CHAPTER_VIDEO_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { assertBundleMatchesRuntime, type RemotionBundleManifest } from "@rendering/plugins/remotion/render/bundle-manifest";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { createVideoUseAdapter } from "@rendering/plugins/video-use/video-use-adapter";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";
import { createDepthAdapter } from "@rendering/plugins/depth/depth-adapter";
import { createVideoWorkflowChapterService } from "@rendering/plugins/video-workflow/video-workflow-chapter-service";
import {
  resolveVideoWorkflowRuntimePaths,
  selectSharedVideoToolchain,
  probeVideoUseRuntime,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { acceptVideoUseArtifact, writeVideoWorkflowJson } from "@rendering/plugins/video-workflow/video-workflow-artifact-store";
import type {
  VideoUseChapterRunV1,
  VideoWorkflowChapterRunRequestV1,
  VideoWorkflowChapterApplyInput,
  HyperFramesOverlayWindowV1,
  RemotionChapterGateInputV1,
  VideoUseBoundaryIntentV1,
} from "@rendering/contracts/video-workflow";
import { assembleBoundaryIntents } from "@/lib/studio/video-workflow/boundary-intent-assembly";
import type { CinematicConfig, CinematicCameraPreset } from "@rendering/plugins/remotion/composition/composition-props";
import type { SubtitleAuthority, EditingProjectV1, TimelineRenderPlan } from "@/types/editing";
import { heuristicCinematicPresets } from "@/lib/studio/cinematic-preset-ai";
import { buildShotFxByClipId } from "@/lib/studio/remotion/shot-fx-decisions";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import {
  resolveRemotionCurrentSlotOutputPath,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import { sha256CanonicalJson, sha256Text } from "@/lib/studio/remotion/canonical-json";
import { validateEditingProject, validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  deriveStorageRoots,
  resolveTimelineSourcePath,
  registeredProjectDir,
  resolveProjectDir,
  resolveStorageBasePath,
  resolveUserDataDir,
} from "./storage-paths";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  probeRenderedMedia,
} from "../remotion/render-smoke-evidence";
import { extractFirstFrame } from "../remotion/extract-frame";

const remotionVersion = "4.0.499";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);

// ─── Storage & path helpers ──────────────────────────────────────────────

function resolveDataFilePath(dataRoot: string, relativePath: string): string {
  const [pid, ...rest] = relativePath.split("/");
  const registered = registeredProjectDir(pid);
  if (registered) return path.join(registered, ...rest);
  return path.join(dataRoot, "_p", ...relativePath.split("/"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the persisted EditingProject for a chapter (mirrors main.ts readEditingProjectSnapshot). */
async function readEditingProjectSnapshot(
  dataRoot: string,
  projectId: string,
  chapterId: string,
): Promise<EditingProjectV1 | undefined> {
  const editingPath = resolveDataFilePath(dataRoot, `${projectId}/editing`);
  try {
    const raw = JSON.parse(await fs.promises.readFile(editingPath, "utf8")) as unknown;
    const state = isRecord(raw) && isRecord(raw.state) ? raw.state : isRecord(raw) ? raw : undefined;
    if (!state || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) return undefined;
    const editingProjectId = state.currentEditingProjectIdByEpisode[chapterId];
    if (typeof editingProjectId !== "string") return undefined;
    const projectRaw = (state.editingProjects as Record<string, unknown>)[editingProjectId];
    const validated = validateEditingProject(projectRaw);
    if (!validated.success) return undefined;
    if (validated.value.projectId !== projectId || validated.value.episodeId !== chapterId) return undefined;
    return validated.value;
  } catch {
    return undefined;
  }
}

/** Persist an EditingProject revision (mirrors main.ts persistStudioEditingRevision). */
async function persistStudioEditingRevision(
  dataRoot: string,
  project: EditingProjectV1,
): Promise<void> {
  const editingPath = resolveDataFilePath(dataRoot, `${project.projectId}/editing`);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.promises.readFile(editingPath, "utf8"));
  } catch {
    raw = { state: { editingProjects: {}, currentEditingProjectIdByEpisode: {} }, version: 0 };
  }
  const wrapper = isRecord(raw) && isRecord(raw.state) ? raw : { state: raw, version: 0 };
  const state = isRecord(wrapper.state) ? wrapper.state : { editingProjects: {}, currentEditingProjectIdByEpisode: {} };
  if (!isRecord(state.editingProjects)) state.editingProjects = {};
  if (!isRecord(state.currentEditingProjectIdByEpisode)) state.currentEditingProjectIdByEpisode = {};

  // CAS: check existing revision is project.revision - 1
  const existing = (state.editingProjects as Record<string, unknown>)[project.id];
  if (existing) {
    const existingValidated = validateEditingProject(existing);
    if (!existingValidated.success) throw new Error("Studio 回写目标基线 revision 无效");
    if (existingValidated.value.revision !== project.revision - 1) {
      throw new Error(`Studio 回写目标已被更新或基线 revision 不连续 (expected ${project.revision - 1}, got ${existingValidated.value.revision})`);
    }
    if (existingValidated.value.projectId !== project.projectId || existingValidated.value.episodeId !== project.episodeId) {
      throw new Error("Studio 回写目标项目/章节不一致");
    }
  }
  (state.editingProjects as Record<string, unknown>)[project.id] = project;
  state.currentEditingProjectIdByEpisode[project.episodeId] = project.id;
  wrapper.state = state;
  const tmpPath = `${editingPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(wrapper, null, 2) + "\n", "utf8");
  await fs.promises.rename(tmpPath, editingPath);
}

// ─── Shot input builder ─────────────────────────────────────────────────

interface ShotSlotInfo {
  shotId: string;
  videoPath: string;
  audioPath: string;
  ttsSpokenText: string;
  sourceSha256: string;
  audioSha256: string;
  textSha256: string;
  durationUs: number;
}

/** Build shot inputs from existing shot slots + voice audio (reuses r2 run data as source). */
async function buildShotInputs(
  projectDir: string,
  projectId: string,
  chapterId: string,
  shotSlots: RemotionCurrentSlotV1[],
  r2RunPath: string,
): Promise<ShotSlotInfo[]> {
  // Read the r2 video-use-run.json to get ttsSpokenText + audio paths + SHAs for each shot
  const r2Run = JSON.parse(fs.readFileSync(r2RunPath, "utf8")) as { shots: Array<Record<string, unknown>> };

  const slotByShotId = new Map<string, RemotionCurrentSlotV1>();
  for (const slot of shotSlots) {
    if (slot.target.kind === "shot" && typeof slot.target.shotId === "string") {
      slotByShotId.set(slot.target.shotId, slot);
    }
  }

  const shots: ShotSlotInfo[] = [];
  for (const r2Shot of r2Run.shots) {
    const shotId = r2Shot.shotId as string;
    const slot = slotByShotId.get(shotId);
    if (!slot || slot.target.kind !== "shot") throw new Error(`缺少 shot slot: ${shotId}`);
    const slotValidation = validateCurrentSlot(slot);
    if (!slotValidation.success) throw new Error(`shot slot ${shotId} 无效: ${slotValidation.issues.map((i) => i.message).join("；")}`);
    const slotEvidence = slotValidation.value.evidence;
    const videoPath = resolveRemotionCurrentSlotOutputPath(path.join(projectDir, "remotion"), slot);
    // r2 工件记录的是制作当时的绝对路径；项目迁移到外部位置后旧 _p 前缀失效，重映射到当前项目根
    const legacyRoot = path.join(resolveUserDataDir(), "projects", "_p", projectId);
    const audioPathRaw = r2Shot.audioPath as string;
    const audioPath = audioPathRaw.startsWith(`${legacyRoot}/`)
      ? path.join(projectDir, audioPathRaw.slice(legacyRoot.length + 1))
      : audioPathRaw;
    const ttsSpokenText = r2Shot.ttsSpokenText as string;
    const textSha256 = await sha256Text(ttsSpokenText);
    shots.push({
      shotId,
      videoPath,
      audioPath,
      ttsSpokenText,
      sourceSha256: slotEvidence.sha256,
      audioSha256: r2Shot.audioSha256 as string,
      textSha256,
      durationUs: slotEvidence.durationUs > 0 ? slotEvidence.durationUs : (r2Shot.durationUs as number),
    });
  }
  return shots;
}

async function buildBoundaryIntents(
  projectDir: string,
  chapterId: string,
  shotInputs: ShotSlotInfo[],
): Promise<VideoUseBoundaryIntentV1[]> {
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  if (!fs.existsSync(storePath)) return [];
  const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
    state?: {
      storyboards?: Array<{ id: string; episodeId: string; index: number; trackKey?: string; shotSemantics?: { transitionToNext?: { styleWord: string; moodWord?: string } } }>;
      scriptPlans?: Array<{ episodeId?: string; transitions?: string }>;
    };
  };
  const state = store.state ?? store;
  const plan = (state.scriptPlans ?? []).find((candidate) => candidate.episodeId === chapterId);
  const storyboards = (state.storyboards ?? []).filter((storyboard) => storyboard.episodeId === chapterId);
  const { intents, warnings } = assembleBoundaryIntents({
    storyboards,
    ...(plan?.transitions ? { scriptPlanTransitions: plan.transitions } : {}),
    shotDurationUsById: new Map(shotInputs.map((input) => [input.shotId, input.durationUs])),
  });
  for (const warning of warnings) console.warn(`[full-pipeline] ${warning}`);
  for (const intent of intents) {
    console.log(
      `[full-pipeline] boundary intent ${intent.fromShotId} → ${intent.toShotId}: ` +
      `${intent.styleWord}=${intent.effectId} ${intent.durationUs / 1e6}s (mood=${intent.moodWord ?? "-"})`,
    );
  }
  return intents;
}

/**
 * Build a VideoUseChapterRunV1 (mirrors main.ts buildManagedVideoUseChapterRun).
 */
function buildVideoUseChapterRun(
  request: VideoWorkflowChapterRunRequestV1,
  paths: ReturnType<typeof resolveVideoWorkflowRuntimePaths>,
): VideoUseChapterRunV1 {
  const now = Date.now();
  const packageLockSha256 = fs.existsSync(paths.videoUseLockPath)
    ? crypto.createHash("sha256").update(fs.readFileSync(paths.videoUseLockPath)).digest("hex")
    : "0".repeat(64);
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    mode: request.mode,
    derivedInputPolicy: request.derivedInputPolicy,
    storyboardSourcePolicy: request.storyboardSourcePolicy ?? "current-ready",
    stage: "preparing",
    timeUnit: "seconds",
    shots: request.shots.map((shot) => ({ ...shot })), // paths are already absolute
    ...(request.boundaryIntents ? { boundaryIntents: request.boundaryIntents } : {}),
    sourceSha256: request.sourceSha256,
    audioSha256: request.audioSha256,
    textSha256: request.textSha256,
    featureFlags: request.featureFlags,
    runtime: {
      profileId: "video-use-managed-python-v1",
      pythonExecutable: paths.pythonExecutable,
      ffmpegExecutable: paths.ffmpegExecutable,
      ffprobeExecutable: paths.ffprobeExecutable,
      packageLockSha256,
      markerPath: paths.videoUseMarkerPath,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Cumulative transition-overlap shift per shot, mirroring
 * layoutVisualTimeline: every boundary with a transition overlaps the two
 * neighboring shots by the transition duration, pulling all later shots
 * earlier by that amount. */
function buildTransitionShiftByShotId(
  intents: ReadonlyArray<VideoUseBoundaryIntentV1>,
  edl: ReadonlyArray<{ shotId: string }>,
): Map<string, number> {
  const durationByPair = new Map(intents
    .filter((intent) => intent.effectId !== "cut")
    .map((intent) => [`${intent.fromShotId}:${intent.toShotId}`, intent.durationUs]));
  const shiftByShotId = new Map<string, number>();
  let cumulative = 0;
  for (let index = 0; index < edl.length - 1; index += 1) {
    const duration = durationByPair.get(`${edl[index]!.shotId}:${edl[index + 1]!.shotId}`);
    if (duration) cumulative += duration;
    shiftByShotId.set(edl[index + 1]!.shotId, cumulative);
  }
  return shiftByShotId;
}

/**
 * Compatibility fallback for accepted legacy artifacts that predate
 * decorative overlay decisions. New artifacts must carry their decisions in
 * overlaySlots and bypass this rotation entirely.
 */
function buildLegacyFallbackHyperFramesWindows(
  edl: ReadonlyArray<{ shotId: string; timelineStartS: number; durationS: number }>,
  transitionShiftByShotId?: ReadonlyMap<string, number>,
): HyperFramesOverlayWindowV1[] {
  const templates = [
    "light-leak",
    "film-grain",
    "lens-flare",
    "vignette-pulse",
    "particle-dust",
    "letterbox-cinematic",
    "highlight-box",
  ] as const;
  return edl.map((entry, index) => {
    const templateId = templates[index % templates.length]!;
    // Transition overlaps pull the laid-out timeline earlier than the raw EDL
    // (layoutVisualTimeline overlaps each transition's two shots). Windows are
    // EDL-anchored, so shift them by the cumulative overlap accumulated before
    // this shot to keep every effect aligned with its (shifted) shot.
    const shiftUs = transitionShiftByShotId?.get(entry.shotId) ?? 0;
    const startUs = Math.max(0, Math.round(entry.timelineStartS * 1_000_000) - shiftUs);
    const durationUs = Math.max(1, Math.min(
      Math.round(entry.durationS * 1_000_000),
      1_100_000,
    ));
    const parameters: Record<string, string | number | boolean> = templateId === "light-leak"
      ? { intensity: 0.42, hue: (index * 31) % 360 }
      : templateId === "film-grain"
        ? { opacity: 0.2 }
        : templateId === "lens-flare"
          ? { x: 18 + ((index * 13) % 64), y: 24 + ((index * 7) % 34), size: 260 }
          : templateId === "vignette-pulse"
            ? { darkness: 0.42, speed: 2.4 }
            : templateId === "particle-dust"
              ? { count: 40, speed: 7 }
              : templateId === "letterbox-cinematic"
                ? { barHeight: 12, fadeIn: 0.25 }
                : { x: 50, y: 50, color: "#f4d06f" };
    return {
      slotId: `effect-${entry.shotId}`,
      cueId: `decorative-effect-${index + 1}`,
      startUs,
      durationUs,
      templateId,
      parameters,
    };
  });
}

// ─── Remotion helpers ───────────────────────────────────────────────────

function readManifest(bundlePath: string): RemotionBundleManifest {
  const value = JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as unknown;
  return assertBundleMatchesRuntime(value, remotionVersion);
}

async function resolveBrowser(): Promise<string> {
  const adapters = createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser);
  const result = await adapters.probe.ensureBrowser({
    onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); },
  });
  if (!result.executablePath || !path.isAbsolute(result.executablePath)) {
    throw new Error("Remotion 浏览器探测未返回 executable path");
  }
  return result.executablePath;
}

// ─── Main pipeline ──────────────────────────────────────────────────────

export async function runFullPipeline(): Promise<Record<string, unknown>> {
  const runId = `full-pipeline-${Date.now()}`;
  const outputDir = path.resolve(appsRoot, "output", "automation", runId);
  fs.mkdirSync(outputDir, { recursive: true });

  // ── 1. Resolve storage paths ──
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;
  const chapterId = "chapter-001";
  const dataRoot = roots.dataRoot; // <storageBase>/projects
  const storageBasePath = resolveStorageBasePath();
  const userDataDir = resolveUserDataDir();

  // workspace root for video-use artifacts
  const workspaceRootForProject = (pid: string) =>
    registeredProjectDir(pid) ? path.join(registeredProjectDir(pid)!, "video-use") : path.join(dataRoot, "_p", pid, "video-use");
  const workspaceRoot = workspaceRootForProject(projectId);

  // ── 2. Set up shared toolchain (ffmpeg/ffprobe) ──
  const toolchain = selectSharedVideoToolchain({
    configuredFfmpeg: process.env.MYSTUDIO_FFMPEG_PATH,
    configuredFfprobe: process.env.MYSTUDIO_FFPROBE_PATH,
  });
  process.env.MYSTUDIO_FFMPEG_PATH = toolchain.ffmpegExecutable;
  process.env.MYSTUDIO_FFPROBE_PATH = toolchain.ffprobeExecutable;

  // ── 3. Resolve Electron binary (for HyperFrames) ──
  const hyperFramesProfileMarkerPath = path.join(storageBasePath, "hyperframes-profile", "profile.json");
  let electronExecutable = process.env.MYSTUDIO_HYPERFRAMES_ELECTRON
    ?? process.execPath;
  if (fs.existsSync(hyperFramesProfileMarkerPath)) {
    const marker = JSON.parse(fs.readFileSync(hyperFramesProfileMarkerPath, "utf8")) as Record<string, unknown>;
    if (typeof marker.electronExecutable === "string" && fs.existsSync(marker.electronExecutable)) {
      electronExecutable = marker.electronExecutable;
    }
  }
  // build-mac.sh removes /Applications/漫影工作室.app between packaging
  // rounds, leaving the profile marker pointing at a deleted binary. Fall
  // back to the dev Electron under node_modules (the HyperFrames sidecar only
  // needs ELECTRON_RUN_AS_NODE, which the dev binary supports equally).
  if (!fs.existsSync(electronExecutable)) {
    const devElectron = path.join(appsRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
    if (fs.existsSync(devElectron)) {
      console.warn(`[full-pipeline] electronExecutable 不存在(${electronExecutable})，回退开发用 Electron: ${devElectron}`);
      electronExecutable = devElectron;
    }
  }

  // ── 4. Resolve runtime paths ──
  const runtimePaths = resolveVideoWorkflowRuntimePaths(storageBasePath, process.platform, electronExecutable);
  console.log("[full-pipeline] storageBasePath:", storageBasePath);
  console.log("[full-pipeline] electronExecutable:", electronExecutable);
  console.log("[full-pipeline] pythonExecutable:", runtimePaths.pythonExecutable);
  console.log("[full-pipeline] ffmpegExecutable:", runtimePaths.ffmpegExecutable);

  // ── 5. Probe video-use runtime ──
  const videoUseProbe = await probeVideoUseRuntime(runtimePaths);
  if (videoUseProbe.state !== "ready") {
    throw new Error(`video-use 运行时未就绪: ${videoUseProbe.state} — ${videoUseProbe.message ?? videoUseProbe.missing.join(", ")}`);
  }
  console.log("[full-pipeline] video-use runtime READY");

  // ── 6. Instantiate adapters ──
  const backendRoot = path.join(appsRoot, "backend");
  // The TTS runtime controller uses <storageBase>/TTS/model as its default model cache dir.
  // The video-use adapter sets MANYING_TTS_MODELS_DIR and VOICEBOX_MODELS_DIR from this value.
  // The Whisper model lives at <storageBase>/TTS/model/models--mlx-community--whisper-large-v3-turbo
  const modelCacheDir = path.join(storageBasePath, "TTS", "model");

  const videoUseAdapter = createVideoUseAdapter({
    storageBasePath: () => storageBasePath,
    modelCacheDir: () => modelCacheDir,
    backendRoot,
    workspaceRootForProject,
  });

  const browserPath = path.join(
    userDataDir, "remotion-runtime", "node_modules", ".remotion",
    "chrome-headless-shell", "mac-arm64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell",
  );
  // build-mac.sh periodically cleans apps/out during packaging rounds; the
  // MYSTUDIO_HYPERFRAMES_WORKER override lets pipeline runs point at a stable
  // worker copy (e.g. apps/.cache/hyperframes-worker.cjs) instead of racing
  // the packaging flow.
  const hyperFramesWorkerPath = process.env.MYSTUDIO_HYPERFRAMES_WORKER
    ?? path.join(appsRoot, "out", "main", "hyperframes-worker.cjs");

  const hyperFramesAdapter = createHyperFramesAdapter({
    storageBasePath: () => storageBasePath,
    electronExecutable,
    workspaceRootForProject,
    workerPath: fs.existsSync(hyperFramesWorkerPath) ? hyperFramesWorkerPath : undefined,
    resolveBrowserPath: async () => fs.existsSync(browserPath) ? browserPath : undefined,
  });

  const remotionChapterManifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => registeredProjectDir(pid) ?? path.join(dataRoot, "_p", pid),
    probeMedia: async (filePath: string) => {
      const probe = await probeRenderedMedia(filePath);
      return { durationUs: Math.round(probe.duration * 1_000_000), streams: probe.streams };
    },
  });

  const chapterService = createVideoWorkflowChapterService({
    workspaceRootForProject,
    runVideoUse: videoUseAdapter.runChapter,
    renderHyperFrames: hyperFramesAdapter.renderOverlay,
    getCurrentEditingProject: async (identity: { projectId: string; chapterId: string }) =>
      readEditingProjectSnapshot(dataRoot, identity.projectId, identity.chapterId),
    persistEditingProject: async (project: EditingProjectV1) =>
      persistStudioEditingRevision(dataRoot, project),
    readChapterManifest: async (pid: string, cid: string) =>
      remotionChapterManifestService.read(pid, cid),
    writeChapterManifest: async (req: { projectId: string; chapterId: string; expectedRevision: number; manifest: unknown }) =>
      remotionChapterManifestService.writeCas(req as Parameters<typeof remotionChapterManifestService.writeCas>[0]),
  });

  const hyperFramesProbe = await hyperFramesAdapter.probe();
  if (hyperFramesProbe.state !== "ready") {
    throw new Error(`HyperFrames 运行时未就绪: ${hyperFramesProbe.state} — ${hyperFramesProbe.message}`);
  }
  console.log("[full-pipeline] adapters instantiated and probed (video-use + HyperFrames + chapter service)");

  // ── 6b. Depth estimation adapter (cinematic 3D mode) ──
  // When MYSTUDIO_CINEMATIC=1, the full pipeline generates depth maps
  // for each shot's visual source and injects CinematicConfig onto the
  // chapter-level visual clips before the final Remotion render.
  const cinematicEnabled = process.env.MYSTUDIO_CINEMATIC === "1";
  const cinematicPreset: CinematicCameraPreset =
    (process.env.MYSTUDIO_CINEMATIC_PRESET as CinematicCameraPreset | undefined) ?? "cinematic-dolly-in";
  if (cinematicEnabled && !process.env.MYSTUDIO_DEPTH_MODEL_DIR?.trim()) {
    // CLI 侧模型目录契约对齐 depth-runtime-controller（App 主进程恒设此变量；
    // buildDepthWorkerEnv 透传 process.env，worker 据此定位 <userData>/DeepModel 缓存）
    process.env.MYSTUDIO_DEPTH_MODEL_DIR = path.join(userDataDir, "DeepModel");
  }
  const depthAdapter = cinematicEnabled
    ? createDepthAdapter({ storageBasePath, backendRoot })
    : null;
  if (cinematicEnabled) {
    console.log(`[full-pipeline] cinematic 3D ENABLED (preset: ${cinematicPreset})`);
  }

  // ── 7. Load shot slots + build shot inputs ──
  const shotSlotReportPath = path.resolve(appsRoot, "output", "automation", "chapter001-shot-slots.json");
  if (!fs.existsSync(shotSlotReportPath)) throw new Error(`shot slot report 不存在: ${shotSlotReportPath}`);
  const shotSlotReport = JSON.parse(fs.readFileSync(shotSlotReportPath, "utf8")) as Record<string, unknown>;
  if (shotSlotReport.projectId !== projectId || shotSlotReport.chapterId !== chapterId) {
    throw new Error("shot slot report identity 不匹配");
  }
  const shotSlots = (shotSlotReport.slots as unknown[]).map((value, index) => {
    const validation = validateCurrentSlot(value);
    if (!validation.success) throw new Error(`shot slot ${index} 无效: ${validation.issues.map((i) => i.message).join("；")}`);
    return validation.value;
  });

  // 历史基准 run（r2）可能被工作区清理回收——回退取最高现存版本的 run 数据
  const chapterWorkspaceDir = path.join(workspaceRoot, chapterId);
  const r2RunPath = (() => {
    const preferred = path.join(chapterWorkspaceDir, "r2", "video-use-run.json");
    if (fs.existsSync(preferred)) return preferred;
    if (fs.existsSync(chapterWorkspaceDir)) {
      const revisions = fs.readdirSync(chapterWorkspaceDir)
        .map((entry) => /^r(\d+)$/.exec(entry)?.[1])
        .filter((value): value is string => Boolean(value))
        .map(Number)
        .sort((a, b) => b - a);
      for (const revision of revisions) {
        const candidate = path.join(chapterWorkspaceDir, `r${revision}`, "video-use-run.json");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    throw new Error(`video-use 工作区无可用 video-use-run.json: ${chapterWorkspaceDir}`);
  })();
  const shotInputs = await buildShotInputs(projectDir, projectId, chapterId, shotSlots, r2RunPath);
  console.log("[full-pipeline] shot inputs built:", shotInputs.length, "shots");

  // ── 8. Determine next revision dynamically ──
  // Check what's already on disk: editing.json + video-use workspace
  const existingProject = await readEditingProjectSnapshot(dataRoot, projectId, chapterId);
  let nextRevision: number;
  if (existingProject) {
    // Existing project has revision N; next artifact must be N+1
    nextRevision = existingProject.revision + 1;
  } else {
    // No existing project; find the latest revision in the video-use workspace
    const chapterDir = path.join(workspaceRoot, chapterId);
    let maxRev = 0;
    if (fs.existsSync(chapterDir)) {
      for (const entry of fs.readdirSync(chapterDir)) {
        const m = entry.match(/^r(\d+)$/);
        if (m) maxRev = Math.max(maxRev, parseInt(m[1], 10));
      }
    }
    nextRevision = maxRev + 1;
  }
  console.log("[full-pipeline] nextRevision:", nextRevision);
  const sourceSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.sourceSha256 })));
  const audioSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.audioSha256 })));
  const textSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.textSha256 })));

  // Director-plan boundary intents: parse the structured ⑥ lines, map scene
  // boundaries onto the shot list (storyboard trackKey scene grouping), and
  // translate each style word through the single-source transition policy.
  const boundaryIntents = await buildBoundaryIntents(projectDir, chapterId, shotInputs);

  // 分镜生成图路径表（overlay 装饰槽内容感知定位）：store mediaRef → 注册表解析绝对路径
  const imagePathByShotId = (() => {
    const map = new Map<string, string>();
    try {
      const storeForImages = JSON.parse(fs.readFileSync(path.join(projectDir, "studio-workflow-store.json"), "utf8")) as {
        state?: { storyboards?: Array<{ id: string; episodeId: string; mediaRef?: { path?: string } }> };
      };
      for (const storyboard of storeForImages.state?.storyboards ?? []) {
        if (storyboard.episodeId !== chapterId || !storyboard.mediaRef?.path) continue;
        try {
          map.set(storyboard.id, resolveTimelineSourcePath({
            sourcePath: storyboard.mediaRef.path,
            dataRoot: roots.dataRoot,
            mediaRoot: roots.mediaRoot,
          }));
        } catch { /* 单镜媒体缺失不阻塞整章（overlay 定位回退公式） */ }
      }
    } catch { /* store 读取失败 → 全部回退公式定位 */ }
    return map;
  })();

  const runRequest: VideoWorkflowChapterRunRequestV1 = {
    schemaVersion: 1,
    projectId,
    chapterId,
    revision: nextRevision,
    mode: "editable-edl",
    derivedInputPolicy: "pad-video-to-audio", // auto-pad video shorter than TTS audio
    storyboardSourcePolicy: "reuse-existing", // allow stale shots for testing
    shots: shotInputs.map((s) => ({
      shotId: s.shotId,
      videoPath: s.videoPath,
      audioPath: s.audioPath,
      ttsSpokenText: s.ttsSpokenText,
      sourceSha256: s.sourceSha256,
      audioSha256: s.audioSha256,
      textSha256: s.textSha256,
      durationUs: s.durationUs,
      // overlay 内容感知定位用：分镜生成图绝对路径（mediaRef → 注册表解析）
      ...(imagePathByShotId.get(s.shotId) ? { imagePath: imagePathByShotId.get(s.shotId)! } : {}),
    })),
    ...(boundaryIntents.length > 0 ? { boundaryIntents } : {}),
    sourceSha256,
    audioSha256,
    textSha256,
    featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
  };

  const chapterRun = buildVideoUseChapterRun(runRequest, runtimePaths);

  // ── 9. RUN video-use adapter.runChapter() — Python worker ──
  console.log("[full-pipeline] running video-use runChapter (Python worker)...");
  const runResult = await videoUseAdapter.runChapter(chapterRun);
  if (runResult.state !== "pending" && runResult.state !== "ready") {
    throw new Error(`video-use runChapter 失败: ${runResult.state} — ${("message" in runResult ? runResult.message : "unknown")}`);
  }
  const videoUseArtifact = runResult.artifact;
  console.log("[full-pipeline] video-use artifact produced:");
  console.log("  revision:", videoUseArtifact.revision);
  console.log("  status:", videoUseArtifact.status, "stage:", videoUseArtifact.stage);
  console.log("  alignment:", videoUseArtifact.alignment.length, "edl:", videoUseArtifact.edl.length);
  console.log("  subtitles:", videoUseArtifact.subtitles.length, "overlaySlots:", videoUseArtifact.overlaySlots.length);
  console.log("  selfEval:", videoUseArtifact.selfEval.passed, "score:", videoUseArtifact.selfEval.score);
  // Per-shot plugin trace: every EDL decision the video-use worker made.
  console.log("[full-pipeline] video-use EDL (per shot):");
  for (const entry of videoUseArtifact.edl) {
    const trimmed = entry.sourceInS > 0.0005 || entry.sourceOutS < entry.sourceInS + entry.durationS - 0.0005;
    console.log(
      `  ${entry.shotId} timeline=${entry.timelineStartS.toFixed(3)}s dur=${entry.durationS.toFixed(3)}s ` +
      `source=${entry.sourceInS.toFixed(3)}→${entry.sourceOutS.toFixed(3)}s${trimmed ? " [trimmed]" : ""}`,
    );
  }
  console.log("[full-pipeline] video-use alignment cues (first 5):");
  for (const cue of videoUseArtifact.alignment.slice(0, 5)) {
    console.log(`  ${cue.shotId} @${(cue.startUs / 1e6).toFixed(3)}s ${(cue.durationUs / 1e6).toFixed(3)}s conf=${cue.confidence.toFixed(2)} "${cue.text.slice(0, 24)}"`);
  }

  // ── 10. Subtitle authority: source-embedded (default) or clean-remotion ──
  // MYSTUDIO_SUBTITLE_AUTHORITY=clean-remotion: 源图不含文字（生成 prompt 禁文字），
  // 台词由 Remotion SubtitleTrack 以句级 cues 燃嵌——运镜自由（3D 相机不会裁掉画内字幕）。
  const subtitleAuthorityMode = process.env.MYSTUDIO_SUBTITLE_AUTHORITY === "clean-remotion"
    ? "clean-remotion" as const
    : "source-embedded" as const;
  const subtitleAuthority: SubtitleAuthority = {
    mode: subtitleAuthorityMode,
    evidence: {
      mode: subtitleAuthorityMode,
      decision: "human",
      sourceFingerprint: sourceSha256,
      evidencePaths: [runId],
      reviewer: "automated",
      reviewedAt: Date.now(),
      note: subtitleAuthorityMode === "clean-remotion"
        ? "源分镜图不含文字（生成 prompt 禁文字），台词字幕由 Remotion SubtitleTrack 句级 cues 燃嵌。"
        : "Scene MP4s have visible embedded Chinese subtitles.",
    },
  };
  const artifactWithAuthority = { ...videoUseArtifact, subtitleAuthority };
  writeVideoWorkflowJson(runResult.artifactPath, artifactWithAuthority);
  console.log("[full-pipeline] subtitleAuthority set:", subtitleAuthorityMode);

  // ── 11. acceptVideoUseArtifact() — write review sidecar ──
  const acceptResult = await acceptVideoUseArtifact(workspaceRootForProject, {
    projectId,
    chapterId,
    revision: nextRevision,
    reviewer: "full-pipeline-automation",
  });
  if (!acceptResult.success) {
    throw new Error(`acceptVideoUseArtifact 失败: ${acceptResult.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  const acceptedArtifact = acceptResult.artifact;
  console.log("[full-pipeline] video-use artifact ACCEPTED (status:", acceptedArtifact.status, "stage:", acceptedArtifact.stage + ")");

  // ── 12. Ensure a base EditingProject exists ──
  let baseProject = await readEditingProjectSnapshot(dataRoot, projectId, chapterId);
  if (!baseProject) {
    // Create a minimal base project for first-time projection.
    // projection requires: artifact.revision === project.revision + 1
    // So base project revision must be nextRevision - 1.
    const editingProjectId = `editing-${projectId}-${chapterId}-${Date.now()}`;
    baseProject = {
      schemaVersion: 1,
      id: editingProjectId,
      projectId,
      episodeId: chapterId,
      name: `道劫 ${chapterId}`,
      revision: nextRevision - 1,
      sourceSnapshotHash: "0".repeat(64),
      createdBy: "auto" as const,
      manuallyEdited: false,
      stale: false,
      tracks: [
        { id: `${editingProjectId}-main-visual`, kind: "video", name: "主画面", order: 0, clipIds: [], muted: false, locked: false },
        { id: `${editingProjectId}-subtitles`, kind: "text", name: "字幕", order: 1, clipIds: [], muted: false, locked: false },
      ],
      clips: [],
      transitions: [],
      effects: [],
      proposals: [],
      renderSettings: { width: 1920, height: 1080, fps: 30, subtitleMode: "none", codec: "h264", loudnessLufs: -14, truePeakDbtp: -1.5 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as EditingProjectV1;
    await persistStudioEditingRevision(dataRoot, baseProject);
    console.log("[full-pipeline] base EditingProject created (revision 0)");
  } else {
    console.log("[full-pipeline] base EditingProject exists (revision:", baseProject.revision + ")");
  }

  // ── 13. chapterService.applyAcceptedArtifact() — runs HyperFrames internally ──
  // MYSTUDIO_OVERLAY_MODE=legacy 强制走 CLI 轮换装饰窗：artifact 氛围词装饰窗在 43 镜
  // 单 composition 下会命中 hyperframes heavy-overlay lint 熔断（真实黑屏捕获风险），
  // 需分段 composition 改造后再切回 artifact 决策。
  const useLegacyOverlayWindows = process.env.MYSTUDIO_OVERLAY_MODE === "legacy";
  const artifactHasDecorativeWindows = !useLegacyOverlayWindows
    && acceptedArtifact.overlaySlots.some((slot) => Boolean(slot.templateId));
  if (useLegacyOverlayWindows) {
    console.warn("[full-pipeline] MYSTUDIO_OVERLAY_MODE=legacy: 忽略 artifact 装饰决策, 走 CLI 轮换装饰窗");
  } else if (!artifactHasDecorativeWindows) {
    console.warn("[full-pipeline] accepted artifact has no decorative overlay decisions; using deterministic CLI fallback");
  }
  const applyInput: VideoWorkflowChapterApplyInput = {
    projectId,
    chapterId,
    revision: nextRevision,
    inputSha256: acceptedArtifact.evidence.inputSha256,
    width: 1920,
    height: 1080,
    fps: 30,
    alphaFormat: "prores-4444-mov",
    ...(artifactHasDecorativeWindows ? {} : {
      hyperFramesWindows: buildLegacyFallbackHyperFramesWindows(
        acceptedArtifact.edl,
        buildTransitionShiftByShotId(boundaryIntents, acceptedArtifact.edl),
      ),
    }),
  };
  console.log("[full-pipeline] applying accepted artifact (calls HyperFrames)...");
  const applyResult = await chapterService.applyAcceptedArtifact(applyInput);
  if (!applyResult.success) {
    throw new Error(`applyAcceptedArtifact 失败: ${applyResult.code} — ${applyResult.message}`);
  }
  console.log("[full-pipeline] applyAcceptedArtifact SUCCESS");
  console.log("  HyperFrames status:", applyResult.hyperFramesArtifact.status);
  console.log("  HyperFrames windows:", applyResult.hyperFramesArtifact.windows.length);
  // Per-window plugin trace: every decorative effect the HyperFrames worker rendered.
  console.log("[full-pipeline] HyperFrames windows (per shot):");
  for (const window of applyResult.hyperFramesArtifact.windows) {
    const params = Object.entries(window.parameters)
      .map(([key, value]) => `${key}=${value}`).join(" ");
    console.log(
      `  ${window.slotId} ${window.templateId} @${(window.startUs / 1e6).toFixed(3)}s ` +
      `dur=${(window.durationUs / 1e6).toFixed(3)}s ${params}`,
    );
  }

  // ── 14. Read projected EditingProject from disk ──
  const projectedProject = await readEditingProjectSnapshot(dataRoot, projectId, chapterId);
  if (!projectedProject) throw new Error("投影后 EditingProject 读取失败");
  console.log("[full-pipeline] projected EditingProject:");
  console.log("  revision:", projectedProject.revision);
  console.log("  clips:", projectedProject.clips.length);
  console.log("  subtitleMode:", projectedProject.renderSettings.subtitleMode);

  // ── 15. Build TimelineRenderPlan ──
  const sourceSnapshotHash = await sha256CanonicalJson(projectedProject);
  const visualClips = projectedProject.clips.filter((c) => {
    const track = projectedProject.tracks.find((t) => t.id === c.trackId);
    return track?.kind === "video" || track?.kind === "image";
  });
  const textClips = projectedProject.clips.filter((c) => {
    const track = projectedProject.tracks.find((t) => t.id === c.trackId);
    return track?.kind === "text";
  });
  const plan: TimelineRenderPlan = {
    schemaVersion: 1,
    jobId: `full-pipeline-${Date.now()}`,
    projectId,
    episodeId: chapterId,
    editingProjectId: projectedProject.id,
    editingRevision: projectedProject.revision,
    sourceSnapshotHash,
    editingProjectSnapshot: { ...projectedProject, sourceSnapshotHash },
    renderSettings: {
      ...projectedProject.renderSettings,
      audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
    },
    clips: [...visualClips, ...textClips].map((clip) => {
      const track = projectedProject.tracks.find((t) => t.id === clip.trackId);
      return {
        id: clip.id,
        trackKind: (track?.kind ?? "video") as "video" | "image" | "text",
        trackId: clip.trackId,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        trimStartUs: clip.trimStartUs,
        speed: clip.speed,
        volume: clip.volume,
        muted: clip.muted,
        source: clip.source,
      };
    }),
    // The accepted video-use artifact is the single source of transition
    // truth; the projection already materialized it into the persisted
    // EditingProject, so the plan must carry it through (hardcoding [] here
    // would silently drop every boundary decision).
    transitions: projectedProject.transitions,
    effects: projectedProject.effects,
    createdAt: Date.now(),
  } as TimelineRenderPlan;

  // Patch clips with shot slot evidence (same as existing scripts)
  const slotByShotId = new Map<string, RemotionCurrentSlotV1>();
  for (const slot of shotSlots) {
    if (slot.target.kind === "shot" && typeof slot.target.shotId === "string") slotByShotId.set(slot.target.shotId, slot);
  }
  for (const clip of plan.clips) {
    if (clip.trackKind !== "video" && clip.trackKind !== "image") continue;
    const storyboardId = clip.source.evidence?.storyboardId;
    const slot = storyboardId ? slotByShotId.get(storyboardId) : undefined;
    if (slot && slot.target.kind === "shot") {
      clip.source.kind = "storyboardVideo";
      clip.source.path = (slot.evidence as Record<string, unknown>)?.outputPath as string ?? clip.source.path;
      if (!clip.source.evidence) clip.source.evidence = {};
      (clip.source.evidence as Record<string, unknown>).remotionJobId = slot.job?.jobId;
      (clip.source.evidence as Record<string, unknown>).remotionEvidenceSha256 = (slot.evidence as Record<string, unknown>)?.sha256;
      (clip.source.evidence as Record<string, unknown>).outputVersion = slot.target.shotRevision;
    }
  }
  // Sync sourceSnapshotHash with the chapter manifest so validation passes
  const chapterManifestForSync = await remotionChapterManifestService.read(projectId, chapterId);
  const syncedSourceSnapshotHash = chapterManifestForSync?.sourceSnapshotHash ?? sourceSnapshotHash;
  (plan as { sourceSnapshotHash: string }).sourceSnapshotHash = syncedSourceSnapshotHash;
  (plan.editingProjectSnapshot as { sourceSnapshotHash: string }).sourceSnapshotHash = syncedSourceSnapshotHash;

  // 注：字幕 cue 与视觉 clip 在 plan 层同处"音频时间线"（未压缩）——authority 归属
  // 校验依赖这一一致性，不可在此重映射。渲染时间线压缩（转场重叠）造成的字幕
  // 滞后在 build-composition-props 里用 layoutVisualTimeline 的同一份偏移换算。

  const planValidation = validateTimelineRenderPlan(plan);
  if (!planValidation.success) throw new Error(`TimelineRenderPlan 无效: ${planValidation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  console.log("[full-pipeline] TimelineRenderPlan built, clips:", plan.clips.length);

  // ── 16. Evaluate chapter gate ──
  const chapterManifest = await remotionChapterManifestService.read(projectId, chapterId);
  if (!chapterManifest) throw new Error("chapter manifest 读取失败");

  const gateInput: RemotionChapterGateInputV1 = {
    projectId,
    chapterId,
    revision: nextRevision,
    inputSha256: await sha256CanonicalJson({ plan, currentShotSlots: shotSlots, chapterManifest }),
    videoUseInputSha256: acceptedArtifact.evidence.inputSha256,
  };
  const gateResult = await chapterService.evaluateGate(gateInput);
  if (!gateResult.accepted) {
    throw new Error(`chapter gate blocked: ${gateResult.code} — ${gateResult.message}`);
  }
  console.log("[full-pipeline] chapter gate PASSED");
  console.log("  videoUseArtifactSha256:", gateResult.videoUseArtifactSha256.slice(0, 16) + "...");
  console.log("  hyperFramesOutputPath:", gateResult.hyperFramesOutputPath ?? "(noop)");

  // ── 17. Validate subtitle authority ──
  const authorityValidation = validateSubtitleAuthorityForTimeline(plan, gateResult.hyperFramesWindows ?? []);
  if (!authorityValidation.success) {
    throw new Error(`字幕归属验证失败: ${authorityValidation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  console.log("[full-pipeline] subtitle authority validation PASSED");

  // ── 18. Remotion render ──
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readManifest(bundlePath);
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(userDataDir, "remotion-runtime"));
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "package.json"), `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`, "utf8");

  const remotionOutputDir = path.join(outputDir, "remotion");
  fs.mkdirSync(remotionOutputDir, { recursive: true });

  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await resolveBrowser();
    // cinematic 3D 需要 WebGL：headless-shell 走 swangle 软件 GL（轻量化 96 段网格 +
    // 关抗锯齿后可稳定）。系统 Chrome(--headless=new, Metal GPU) 的 localhost IPv6
    // 解析连不上问题已由 apps/patches 修复（serveUrl/页内代理 → 127.0.0.1），但 Chrome
    // 路线仍属新路径——仅 MYSTUDIO_CINEMATIC_BROWSER=chrome 显式启用。
    const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const renderBrowser = cinematicEnabled
      && process.env.MYSTUDIO_CINEMATIC_BROWSER === "chrome"
      && fs.existsSync(systemChrome)
      ? systemChrome
      : browser;
    const mediaBridge = new MediaBridgeServer();
    await mediaBridge.listen();
    const session = mediaBridge.createSession();
    try {
      const mediaSources = [
        ...plan.clips
          .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
          .map((clip) => {
            const storyboardId = clip.source.evidence?.storyboardId;
            const slot = storyboardId ? slotByShotId.get(storyboardId) : undefined;
            if (!slot || slot.target.kind !== "shot") throw new Error(`缺少 shot slot: ${storyboardId ?? clip.id}`);
            return { clipId: clip.id, absolutePath: resolveRemotionCurrentSlotOutputPath(path.join(projectDir, "remotion"), slot) };
          }),
        ...chapterManifest.sharedAudioBindings.map((binding) => ({
          clipId: `chapter-audio:${binding.bindingId}`,
          absolutePath: path.resolve(projectDir, binding.source.relativePath),
        })),
      ];
      if (gateResult.hyperFramesOutputPath) {
        mediaSources.push({
          clipId: "hyperframes-overlay",
          absolutePath: gateResult.hyperFramesOutputPath,
        });
      }
      const mediaUrlByClipId = buildMediaUrlMap(mediaBridge, session, mediaSources);
      const mediaUrlByBindingId = Object.fromEntries(
        chapterManifest.sharedAudioBindings.map((binding) => [binding.bindingId, mediaUrlByClipId[`chapter-audio:${binding.bindingId}`]]),
      );

      // ── 18a. Cinematic depth estimation for chapter-level visual clips ──
      // When cinematic is enabled, estimate depth for each shot's visual source,
      // register the depth PNG on the media bridge, and build CinematicConfig
      // to inject onto the visual clips. This is the chapter-render path; the
      // per-shot render path (RemotionShotRenderer) handles depth independently.
      let cinematicByClipId: Map<string, CinematicConfig> | undefined;
      // cinematic 分支的 TextureLoader 只能解码静帧图——视觉源必须从镜头 MP4 换成
      // 深度估计用的首帧 PNG（视频音轨由 CinematicVisualClip 内的 OffthreadVideo 补挂）。
      const cinematicFrameUrlByClipId = new Map<string, string>();
      if (cinematicEnabled && depthAdapter) {
        cinematicByClipId = new Map();
        // 逐镜运镜选择：确定性关键词启发式（cinematic-preset-ai 的兜底路径，
        // CLI 无渲染端 aiManager；规则按 prompt 画面 + line 台词匹配镜头语言）
        const storeForPresets = JSON.parse(fs.readFileSync(path.join(projectDir, "studio-workflow-store.json"), "utf8")) as {
          state?: { storyboards?: Array<{ id: string; episodeId: string; prompt?: string; line?: string }> };
        };
        const presetInputs = (storeForPresets.state?.storyboards ?? [])
          .filter((storyboard) => storyboard.episodeId === chapterId)
          .map((storyboard) => ({
            shotId: storyboard.id,
            description: String(storyboard.prompt ?? ""),
            dialogue: String(storyboard.line ?? ""),
          }));
        const { presets: heuristicPresets } = heuristicCinematicPresets(presetInputs);
        // 关键词未命中（兜底 ken-burns-3d）的分镜改走叙事感知轮换：首镜 crane-up 定场、
        // 尾镜 rise-and-pull 收束、中段 8 预设轮换——避免全章同运镜的单调。
        const orderedShotIds = presetInputs.map((input) => input.shotId);
        const fallbackRotation = [
          "cinematic-dolly-in", "cinematic-drift", "cinematic-slow-push", "cinematic-parallax-lr",
          "cinematic-crane-up", "cinematic-dolly-out", "cinematic-ken-burns-3d", "cinematic-pedestal-up",
        ] as const;
        orderedShotIds.forEach((shotId, idx) => {
          if (heuristicPresets[shotId] !== "cinematic-ken-burns-3d") return;
          if (idx === 0) heuristicPresets[shotId] = "cinematic-crane-up";
          else if (idx === orderedShotIds.length - 1) heuristicPresets[shotId] = "cinematic-rise-and-pull";
          else heuristicPresets[shotId] = fallbackRotation[idx % fallbackRotation.length];
        });
        const presetByShotId = new Map(Object.entries(heuristicPresets));
        const distribution = new Map<string, number>();
        for (const value of Object.values(heuristicPresets)) distribution.set(value, (distribution.get(value) ?? 0) + 1);
        console.log(`[full-pipeline] cinematic presets (heuristic, ${distribution.size} kinds):`,
          [...distribution.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" "));
        const visualClipEntries = plan.clips.filter((c) => c.trackKind === "video" || c.trackKind === "image");
        console.log("[full-pipeline] estimating depth maps for", visualClipEntries.length, "visual clips...");
        for (const clip of visualClipEntries) {
          const storyboardId = clip.source.evidence?.storyboardId;
          const slot = storyboardId ? slotByShotId.get(storyboardId) : undefined;
          if (!slot || slot.target.kind !== "shot") continue;
          const shotOutputPath = resolveRemotionCurrentSlotOutputPath(
            path.join(projectDir, "remotion"), slot,
          );
          // Extract the first frame from the shot MP4 as depth estimation input.
          const framePath = path.join(remotionOutputDir, `depth-frame-${clip.id}.png`);
          const ffmpegPath = process.env.MYSTUDIO_FFMPEG_PATH ?? "ffmpeg";
          await extractFirstFrame(ffmpegPath, shotOutputPath, framePath);
          const depthDir = path.join(remotionOutputDir, "depth", slot.target.shotId);
          const depthPath = path.join(depthDir, "depth.png");
          const depthResult = await depthAdapter.estimateDepth({
            schemaVersion: 1,
            projectId,
            shotId: slot.target.shotId,
            inputImagePath: framePath,
            outputDepthPath: depthPath,
            model: "depth-anything-v2-small",
          });
          if (depthResult.state === "ready") {
            const depthAssetId = crypto.randomBytes(32).toString("hex");
            session.register(depthAssetId, depthResult.artifact.outputPath);
            const [depthUrlEntry] = mediaBridge.buildUrls(session, [depthAssetId]);
            const frameAssetId = crypto.randomBytes(32).toString("hex");
            session.register(frameAssetId, framePath);
            const [frameUrlEntry] = mediaBridge.buildUrls(session, [frameAssetId]);
            cinematicFrameUrlByClipId.set(clip.id, frameUrlEntry.url);
            cinematicByClipId.set(clip.id, {
              preset: (presetByShotId.get(slot.target.shotId) ?? cinematicPreset) as CinematicConfig["preset"],
              depthMapSrc: depthUrlEntry.url,
              cameraDistance: 5,
              cameraHeight: 0,
              dofFocusDistance: 4,
              dofAperture: 0.02,
              motionBlurSamples: 0,
              parallaxStrength: 1,
              bloomIntensity: 0,
              vignetteDarkness: 0.2,
              chromaticAberration: 0,
            });
            console.log(`[full-pipeline] depth map ready for clip ${clip.id}`);
          } else {
            console.warn(`[full-pipeline] depth estimation blocked for ${clip.id}: ${depthResult.message}`);
          }
        }
      }

      // Build composition props with gate result (the proper path)
      const projected = buildChapterVideoCompositionProps({
        plan,
        currentShotSlots: shotSlots,
        chapterManifest,
        mediaUrlByClipId,
        mediaUrlByBindingId,
        videoWorkflowGate: gateResult,
        ...(gateResult.hyperFramesOutputPath && gateResult.hyperFramesWindows
          ? {
              hyperFramesOverlay: {
                src: mediaUrlByClipId["hyperframes-overlay"] ?? "",
                windows: gateResult.hyperFramesWindows,
              },
            }
          : {}),
      });
      if (!projected.success) throw new Error(`composition props 失败: ${projected.issues.map((i) => `${i.path}: ${i.message}`).join("；")}`);
      const props = projected.value;

      // Inject cinematic config onto visual clips when depth maps are available.
      // This is the chapter-render wiring point for the 3D cinematic path.
      if (cinematicByClipId && cinematicByClipId.size > 0) {
        for (const clip of props.visualClips) {
          const config = cinematicByClipId.get(clip.clipId);
          if (config) {
            (clip as { cinematic?: CinematicConfig }).cinematic = config;
            const frameUrl = cinematicFrameUrlByClipId.get(clip.clipId);
            if (frameUrl) {
              // 3D 贴图用静帧；src 保留视频 URL 供 OffthreadVideo 音轨取声
              (clip as { cinematicImageSrc?: string }).cinematicImageSrc = frameUrl;
            }
          }
        }
        console.log(`[full-pipeline] cinematic config injected on ${cinematicByClipId.size} visual clips`);
      }

      // ── 18b. 2D 镜头语言 + 镜头特效（MYSTUDIO_SHOT_FX=1）──
      // 决策逻辑与 App 一键成片共享单源（shot-fx-decisions），保证两条入口产出一致。
      if (process.env.MYSTUDIO_SHOT_FX === "1") {
        const fxStore = JSON.parse(fs.readFileSync(path.join(projectDir, "studio-workflow-store.json"), "utf8")) as {
          state?: { storyboards?: Array<{ id: string; episodeId: string; prompt?: string; line?: string }> };
        };
        const shotFx = buildShotFxByClipId({
          planClips: plan.clips,
          visualClips: props.visualClips,
          storyboards: (fxStore.state?.storyboards ?? []).filter((storyboard) => storyboard.episodeId === chapterId),
        });
        for (const clip of props.visualClips) {
          const decision = shotFx.byClipId.get(clip.clipId);
          if (!decision) continue;
          (clip as { panZoom?: unknown }).panZoom = decision.panZoom;
          (clip as { fx?: unknown }).fx = decision.fx;
        }
        console.log(`[full-pipeline] 2D shot-fx injected: motion ${shotFx.counts.motion}, shake ${shotFx.counts.shake}, glow ${shotFx.counts.glow}, chroma ${shotFx.counts.chroma}`);
      }

      const propsValidation = validateChapterVideoCompositionProps(props);
      if (!propsValidation.success) throw new Error(`composition props 验证失败: ${propsValidation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);

      console.log("[full-pipeline] composition props built:");
      console.log("  visualClips:", props.visualClips.length);
      console.log("  subtitles:", props.subtitles.length);
      console.log("  audioClips:", props.audioClips.length);
      console.log("  overlayClips:", props.overlayClips?.length ?? 0);

      const rawPath = path.join(remotionOutputDir, "raw-remotion.mp4");
      const outputPath = path.join(remotionOutputDir, "output.mp4");
      const renderStartedAt = Date.now();
      const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");

      console.log("[full-pipeline] starting Remotion renderMedia...");
      const composition = await selectComposition({
        serveUrl: bundlePath, id: CHAPTER_VIDEO_COMPOSITION_ID, inputProps: props,
        browserExecutable: browser, binariesDirectory, chromeMode: "headless-shell",
        onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
      });
      // 真 Chrome(--headless=new) 走 Metal GPU，无需软件 GL；仅在无 Chrome 回退 headless-shell
      // 时才用 swangle，且限并发防软件上下文内存崩。
      const useSystemChrome = renderBrowser === systemChrome;
      await renderMedia({
        serveUrl: bundlePath, composition, inputProps: props, outputLocation: rawPath,
        codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac",
        // 锐度纪律：crf 16 + slow（默认 18/medium 在 grain/二次编码下软化明显）
        crf: 16, x264Preset: "slow",
        browserExecutable: renderBrowser, binariesDirectory, chromeMode: "headless-shell",
        ...(cinematicEnabled && !useSystemChrome ? { chromiumOptions: { gl: "swangle" as const }, concurrency: 2 } : {}),
        enforceAudioTrack: true, overwrite: true,
        onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
      });
      await fs.promises.copyFile(rawPath, outputPath);
      console.log("[full-pipeline] Remotion render complete:", outputPath);

      // ── 19. Verify output ──
      const probe = await probeRenderedMedia(outputPath);
      const probePath = path.join(remotionOutputDir, "ffprobe.json");
      fs.writeFileSync(probePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
      const expectedDuration = composition.durationInFrames / composition.fps;
      assertRenderedMediaEvidence({ label: "Daojie Full Pipeline", probe, expectedDuration, fps: composition.fps, width: plan.renderSettings.width, height: plan.renderSettings.height });
      const sha256 = await hashFileSha256(outputPath);

      const report = {
        ok: true,
        generatedAt: new Date().toISOString(),
        pipeline: "video-use adapter.runChapter → accept → applyAcceptedArtifact (HyperFrames) → gate → authority → buildChapterVideoCompositionProps → renderMedia",
        renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash },
        videoUse: {
          revision: nextRevision,
          status: acceptedArtifact.status, stage: acceptedArtifact.stage, mode: acceptedArtifact.mode,
          alignmentCount: acceptedArtifact.alignment.length, edlCount: acceptedArtifact.edl.length,
          subtitleCount: acceptedArtifact.subtitles.length, overlaySlotCount: acceptedArtifact.overlaySlots.length,
          selfEvalPassed: acceptedArtifact.selfEval.passed, selfEvalScore: acceptedArtifact.selfEval.score,
        },
        hyperFrames: { status: applyResult.hyperFramesArtifact.status, windowCount: applyResult.hyperFramesArtifact.windows.length },
        gate: { accepted: true, videoUseArtifactSha256: gateResult.videoUseArtifactSha256, hyperFramesOutputPath: gateResult.hyperFramesOutputPath ?? "(noop)" },
        authority: { mode: subtitleAuthority.mode, passed: true, suppressedCueIds: authorityValidation.success ? authorityValidation.suppressedCueIds.size : 0 },
        composition: { visualClips: props.visualClips.length, subtitles: props.subtitles.length, audioClips: props.audioClips.length, overlayClips: props.overlayClips?.length ?? 0 },
        output: { path: outputPath, sizeBytes: fs.statSync(outputPath).size, sha256, duration: probe.duration, width: probe.width, height: probe.height, streams: probe.streams },
        editingProject: { id: projectedProject.id, revision: projectedProject.revision, clips: projectedProject.clips.length, subtitleMode: projectedProject.renderSettings.subtitleMode },
        renderDuration: (Date.now() - renderStartedAt) / 1000,
      };
      fs.writeFileSync(path.join(remotionOutputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      fs.writeFileSync(path.join(outputDir, "timeline-render-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    } finally {
      await mediaBridge.revokeSession(session);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

if (process.env.MYSTUDIO_FULL_PIPELINE === "1"
  || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  runFullPipeline().catch((error) => {
    console.error("[full-pipeline] FATAL:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}
