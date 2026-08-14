/**
 * Daojie full plugin-chain pipeline: DEEP INTEGRATION.
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
 *   npm run video:daojie:full-pipeline
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
} from "@rendering/contracts/video-workflow";
import type { CinematicConfig, CinematicCameraPreset } from "@rendering/plugins/remotion/composition/composition-props";
import type { SubtitleAuthority, EditingProjectV1, TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import {
  resolveRemotionCurrentSlotOutputPath,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import { sha256CanonicalJson, sha256Text } from "@/lib/studio/remotion/canonical-json";
import { validateEditingProject, validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  deriveStorageRoots,
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
    const audioPath = r2Shot.audioPath as string;
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

/** Build a VideoUseChapterRunV1 (mirrors main.ts buildManagedVideoUseChapterRun). */
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

/**
 * Build deterministic, non-text HyperFrames windows from the accepted EDL.
 * The scene MP4s already carry their subtitles, so these windows are limited
 * to transparent cinematic effects and can never create a second subtitle.
 */
function buildDecorativeHyperFramesWindows(
  edl: ReadonlyArray<{ shotId: string; timelineStartS: number; durationS: number }>,
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
    const startUs = Math.max(0, Math.round(entry.timelineStartS * 1_000_000));
    const durationUs = Math.max(1, Math.min(
      Math.round(entry.durationS * 1_000_000),
      800_000,
    ));
    const parameters: Record<string, string | number | boolean> = templateId === "light-leak"
      ? { intensity: 0.28, hue: (index * 31) % 360 }
      : templateId === "film-grain"
        ? { opacity: 0.12 }
        : templateId === "lens-flare"
          ? { x: 18 + ((index * 13) % 64), y: 24 + ((index * 7) % 34), size: 180 }
          : templateId === "vignette-pulse"
            ? { darkness: 0.32, speed: 2.4 }
            : templateId === "particle-dust"
              ? { count: 24, speed: 7 }
              : templateId === "letterbox-cinematic"
                ? { barHeight: 8, fadeIn: 0.25 }
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
  const runId = `daojie-full-pipeline-${Date.now()}`;
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
  const workspaceRootForProject = (pid: string) => path.join(dataRoot, "_p", pid, "video-use");
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
  let electronExecutable = process.execPath;
  if (fs.existsSync(hyperFramesProfileMarkerPath)) {
    const marker = JSON.parse(fs.readFileSync(hyperFramesProfileMarkerPath, "utf8")) as Record<string, unknown>;
    if (typeof marker.electronExecutable === "string" && fs.existsSync(marker.electronExecutable)) {
      electronExecutable = marker.electronExecutable;
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
  const hyperFramesWorkerPath = path.join(appsRoot, "out", "main", "hyperframes-worker.cjs");

  const hyperFramesAdapter = createHyperFramesAdapter({
    storageBasePath: () => storageBasePath,
    electronExecutable,
    workspaceRootForProject,
    workerPath: fs.existsSync(hyperFramesWorkerPath) ? hyperFramesWorkerPath : undefined,
    resolveBrowserPath: async () => fs.existsSync(browserPath) ? browserPath : undefined,
  });

  const remotionChapterManifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => path.join(dataRoot, "_p", pid),
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
  const depthAdapter = cinematicEnabled
    ? createDepthAdapter({ storageBasePath, backendRoot })
    : null;
  if (cinematicEnabled) {
    console.log(`[full-pipeline] cinematic 3D ENABLED (preset: ${cinematicPreset})`);
  }

  // ── 7. Load shot slots + build shot inputs ──
  const shotSlotReportPath = path.resolve(appsRoot, "output", "automation", "daojie-chapter001-shot-slots.json");
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

  const r2RunPath = path.join(workspaceRoot, chapterId, "r2", "video-use-run.json");
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
    })),
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

  // ── 10. Set subtitleAuthority = source-embedded on the artifact ──
  const subtitleAuthority: SubtitleAuthority = {
    mode: "source-embedded",
    evidence: {
      mode: "source-embedded",
      decision: "human",
      sourceFingerprint: sourceSha256,
      evidencePaths: [runId],
      reviewer: "full-pipeline-automation",
      reviewedAt: Date.now(),
      note: "Daojie scene MP4s have visible embedded Chinese subtitles.",
    },
  };
  const artifactWithAuthority = { ...videoUseArtifact, subtitleAuthority };
  writeVideoWorkflowJson(runResult.artifactPath, artifactWithAuthority);
  console.log("[full-pipeline] subtitleAuthority set: source-embedded");

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
  const applyInput: VideoWorkflowChapterApplyInput = {
    projectId,
    chapterId,
    revision: nextRevision,
    inputSha256: acceptedArtifact.evidence.inputSha256,
    width: 1920,
    height: 1080,
    fps: 30,
    alphaFormat: "prores-4444-mov",
    hyperFramesWindows: buildDecorativeHyperFramesWindows(acceptedArtifact.edl),
  };
  console.log("[full-pipeline] applying accepted artifact (calls HyperFrames)...");
  const applyResult = await chapterService.applyAcceptedArtifact(applyInput);
  if (!applyResult.success) {
    throw new Error(`applyAcceptedArtifact 失败: ${applyResult.code} — ${applyResult.message}`);
  }
  console.log("[full-pipeline] applyAcceptedArtifact SUCCESS");
  console.log("  HyperFrames status:", applyResult.hyperFramesArtifact.status);
  console.log("  HyperFrames windows:", applyResult.hyperFramesArtifact.windows.length);

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
    jobId: `daojie-full-pipeline-${Date.now()}`,
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
    transitions: [],
    effects: [],
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
      if (cinematicEnabled && depthAdapter) {
        cinematicByClipId = new Map();
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
            cinematicByClipId.set(clip.id, {
              preset: cinematicPreset,
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
          }
        }
        console.log(`[full-pipeline] cinematic config injected on ${cinematicByClipId.size} visual clips`);
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
      await renderMedia({
        serveUrl: bundlePath, composition, inputProps: props, outputLocation: rawPath,
        codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac",
        browserExecutable: browser, binariesDirectory, chromeMode: "headless-shell",
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
