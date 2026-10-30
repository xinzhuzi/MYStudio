/**
 * Full plugin-chain pipeline: DEEP INTEGRATION.
 *
 * This script instantiates the REAL adapter factories (the same ones used by
 * main.ts in the Electron app) and runs the full chain:
 *
 *   1. video-use adapter.runChapter()  — Python worker (alignment/EDL/subtitles/grade/preview/self-eval)
 *   2. acceptVideoUseArtifact()       — consume externally supplied source-bound review
 *   3. chapterService.applyAcceptedArtifact() — projects to EditingProject + calls HyperFrames adapter
 *   4. chapterService.evaluateGate()  — the real chapter gate
 *   5. validateSubtitleAuthorityForTimeline() — authority validation
 *   6. buildChapterVideoCompositionProps() — proper composition (includes gate result)
 *   7. @remotion/renderer renderMedia() — final chapter render
 *
 * Unlike the previous version (which read pre-existing r2 artifacts), this script
 * actually RUNS video-use from scratch, goes through accept → apply → gate → authority,
 * and, only after external review, persists the EditingProject to editing.json — the same lifecycle the Electron app uses.
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
import { ttsModelCacheDir } from "@/electron/storage/model-dirs";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";
import { createVideoWorkflowChapterService } from "@rendering/plugins/video-workflow/video-workflow-chapter-service";
import {
  resolveVideoWorkflowRuntimePaths,
  selectSharedVideoToolchain,
  probeVideoUseRuntime,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { acceptVideoUseArtifact, writeVideoWorkflowJson } from "@rendering/plugins/video-workflow/video-workflow-artifact-store";
import type {
  VideoUseChapterRunV1,
  HyperFramesOverlayWindowV1,
  RemotionChapterGateInputV1,
  VideoUseBoundaryIntentV1,
} from "@rendering/contracts/video-workflow";
import type { VideoWorkflowChapterRunRequestV1 } from "@rendering/contracts/video-workflow-ipc";
import type { VideoWorkflowChapterApplyInput } from "@rendering/plugins/video-workflow/video-workflow-chapter-service";
import { assertStoryboardSpeech, type VoiceoverCharacterIdentity } from "@/lib/studio/chapter-voiceover";
import { assembleBoundaryIntents } from "@/lib/studio/video-workflow/boundary-intent-assembly";
import type { EditingProjectV1, TimelineRenderPlan } from "@/types/editing";
import { mergeShotFxEditingEffects } from "@/lib/studio/remotion/shot-fx-decisions";
import { assertCliDuration, requireSourceHash, validatePipelineReview } from "./run-full-pipeline-inputs";
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { createCliTtsFingerprint } from "./cli-tts-fingerprint";
import { validateRemotionAudioBindingFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { runTimelineAudioPostProcess } from "@rendering/runtime/ffmpeg/timeline-audio-postprocess";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import type { StoryboardItem } from "@/types/studio";
import type { PersistedTtsState } from "@/stores/tts/tts-store";
import { validateVideoUseChapterArtifact } from "@rendering/contracts/video-workflow";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import {
  readRemotionCurrentShotSlotsFromWorkspace,
  resolveRemotionCurrentSlotOutputPath,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import { sha256CanonicalJson, sha256Text } from "@/lib/studio/remotion/canonical-json";
import { validateEditingProject, validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import { resolveStoreFilePathAny } from "@/electron/storage/project-store-layout";
import {
  deriveStorageRoots,
  resolveTimelineSourcePath,
  registeredProjectDir,
  resolveProjectDir,
  resolveStorageBasePath,
  resolveUserDataDir,
  readStudioWorkflowStoreState,
} from "./storage-paths";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  probeRenderedMedia,
} from "../remotion/render-smoke-evidence";
import { buildFullPipelineRunEvidence } from "./full-pipeline-run-evidence";
import { acceptFinalAudio } from "../remotion/final-audio-acceptance";
// CLI 管线对齐 Electron 渲染路径的响度后处理(W1-1029 实弹:raw 混音 -16.3LUFS/-1.1TP
// 直撞响度门;单遍动态 loudnorm 双指标仍偏,改两遍法 linear 收敛,见 renderMedia 后调用点)。
import { execFile } from "node:child_process";
// W0 剧本检查门·副门(10-29 script-rootcure-clearance design §2.3):阶段 7 后接线。
import { runScriptPrecheckGate, scriptPrecheckInputsProjection } from "./script-precheck";
import { isDaojieAdaptation } from "@/lib/studio/daojie-generation-audit";
import { DAOJIE_STRICT_DURATION_SECONDS, GENERIC_DURATION_SECONDS } from "@/lib/studio/daojie-duration-policy";
import { extractScriptVoiceLines } from "@/lib/studio/script-draft-metrics";

const remotionVersion = "4.0.534";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);

// ─── Storage & path helpers ──────────────────────────────────────────────

function resolveDataFilePath(dataRoot: string, relativePath: string): string {
  const [pid, ...rest] = relativePath.split("/");
  const registered = registeredProjectDir(pid);
  if (registered) {
    if (rest.length === 1 && rest[0] === "editing") {
      return resolveFullPipelineEditingStorePath(registered);
    }
    return path.join(registered, ...rest);
  }
  return path.join(dataRoot, "_p", ...relativePath.split("/"));
}

export function resolveFullPipelineEditingStorePath(projectRoot: string): string {
  return resolveStoreFilePathAny(projectRoot, ["editing.json"]);
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
  (state.currentEditingProjectIdByEpisode as Record<string, unknown>)[project.episodeId] = project.id;
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
  overlayTemplateId?: string;
  durationUs: number;
}

/** Build exclusively from current persisted source, canonical voice and current render lineage. */
export async function buildShotInputs(
  projectDir: string, projectId: string, chapterId: string, shotSlots: RemotionCurrentSlotV1[],
): Promise<ShotSlotInfo[]> {
  const store = readStudioWorkflowStoreState(projectDir);
  if (!store || !Array.isArray(store.state.storyboards)) throw new Error("缺少当前 storyboards");
  const storyboards = (store.state.storyboards as StoryboardItem[]).filter(s => s.episodeId === chapterId)
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  assertCliDuration(store.state, chapterId, storyboards);
  if (!storyboards.length || new Set(storyboards.map(s => s.id)).size !== storyboards.length
    || shotSlots.length !== storyboards.length || new Set(shotSlots.map(s => s.target.kind === "shot" ? s.target.shotId : "")).size !== shotSlots.length) throw new Error("缺失/重复 current shots/slots");
  const roots = deriveStorageRoots(projectDir);
  const resolveMedia = (mediaPath: string) => {
    // asset-file:// 角色参考音走素材库(export-cli-narrator-input 同根)——
    // resolveTimelineSourcePath 只认 project-file/绝对路径,角色档指纹链会炸。
    if (mediaPath.startsWith("asset-file://")) {
      return path.join(projectDir, "store", "assets", "files", decodeURIComponent(mediaPath.replace("asset-file://", "")));
    }
    return resolveTimelineSourcePath({ sourcePath: mediaPath, dataRoot: roots.dataRoot, mediaRoot: roots.mediaRoot });
  };
  const normalizeRef = (ref: NonNullable<StoryboardItem["audioRef"]>) => {
    const absolute = resolveMedia(ref.path);
    const relative = path.relative(projectDir, absolute).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("媒体逃逸当前项目");
    requireSourceHash(ref.contentSha256);
    return { ...ref, path: buildProjectFileUrl(projectId, relative) };
  };
  const manifestService = new RemotionChapterManifestService({ projectRootForProject: () => projectDir, probeMedia: async file => { const p = await probeRenderedMedia(file); return { durationUs: Math.round(p.duration * 1_000_000), streams: p.streams }; } });
  const manifest = await manifestService.read(projectId, chapterId);
  if (!manifest || JSON.stringify(manifest.requiredShotIds) !== JSON.stringify(storyboards.map(s => s.id))) throw new Error("当前 chapter manifest shot lineage 不一致");
  requireSourceHash(manifest.sourceSnapshotHash);
  const normalized = storyboards.map(s => ({ ...s, mediaRef: s.mediaRef ? normalizeRef(s.mediaRef) : undefined, audioRef: s.audioRef ? normalizeRef(s.audioRef) : undefined }));
  // continuityPolicy 与 render-shot-slots.ts:167 同契约(env 可调,默认 if-present)——
  // 存量章节 store 无 continuityState(W1 1029 实证:ch1 全 19 镜从未携带),
  // required 默认会把存量数据整体拒之门外;严格档走 MYSTUDIO_CONTINUITY_POLICY=required。
  const plans = await buildRemotionShotPlans({ projectId, chapterId, chapterRevision: manifest.revision, renderSettings: manifest.renderSettings, storyboards: normalized,
    continuityPolicy: (process.env.MYSTUDIO_CONTINUITY_POLICY as "required" | "if-present" | "skip") || "if-present" });
  if (!plans.success || plans.sourceSnapshotHash !== manifest.sourceSnapshotHash) throw new Error("当前 storyboard/manifest source 或 render plan 已过期");
  const ttsRaw = JSON.parse(fs.readFileSync(resolveStoreFilePathAny(projectDir, ["tts.json"]), "utf8")) as { state: PersistedTtsState };
  const tts = ttsRaw.state;
  const shots: ShotSlotInfo[] = [];
  for (const sb of normalized) {
    const characters = (store.state.entityExtractions as Array<{ episodeId: string; characters: VoiceoverCharacterIdentity[] }> | undefined)?.find(batch => batch.episodeId === chapterId)?.characters ?? [];
    assertStoryboardSpeech(sb, characters);
    const slot = shotSlots.find(s => s.target.kind === "shot" && s.target.shotId === sb.id);
    const plan = plans.plans.find(p => p.shot.shotId === sb.id);
    if (!slot || !plan || slot.projectId !== projectId || slot.target.kind !== "shot" || slot.target.chapterId !== chapterId
      || slot.target.shotRevision !== (sb.outputVersion ?? 1) || slot.job.inputHash !== plan.inputHash) throw new Error(`current slot lineage 过期: ${sb.id}`);
    const validation = validateCurrentSlot(slot);
    if (!validation.success) throw new Error(`current slot 无效: ${sb.id}`);
    const chapter = (store.state.novelChapters as Array<{ id: string; sourceId?: string; revision?: number }> | undefined)?.find(c => c.id === chapterId);
    if (!chapter || sb.sourceId !== (chapter.sourceId ?? chapterId) || !Number.isSafeInteger(sb.revision)
      || (sb.revision ?? 0) <= 0 || sb.revision !== (chapter.revision ?? 1)) throw new Error(`缺少或过期 source identity: ${sb.id}`);
    const voices = sb.shotAudioBindings?.filter(b => b.role === "voice") ?? [];
    if (voices.length !== 1) throw new Error(`必须有一条 canonical voice: ${sb.id}`);
    const voice = voices[0];
    const job = sb.ttsJob;
    if (voice.schemaVersion !== 2 || voice.projectId !== projectId || voice.chapterId !== chapterId || voice.shotId !== sb.id
      || voice.shotRevision !== (sb.outputVersion ?? 1) || !job || job.status !== "completed" || job.projectId !== projectId
      || job.chapterId !== chapterId || job.shotId !== sb.id || job.shotRevision !== voice.shotRevision
      || job.inputFingerprint !== voice.ttsInputFingerprint || !sb.audioRef || sb.audioRef.contentSha256 !== voice.sourceFingerprint
      || voice.sourceFingerprint !== voice.source.contentSha256 || voice.source.projectId !== projectId) throw new Error(`voice/job/audioRef identity 不一致: ${sb.id}`);
    requireSourceHash(job.inputFingerprint); requireSourceHash(voice.sourceFingerprint);
    if (!(await validateRemotionAudioBindingFingerprint(voice)).success) throw new Error(`voice binding fingerprint 不一致: ${sb.id}`);
    const currentTts = await createCliTtsFingerprint({ state: store.state, tts, storyboard: sb, projectId, chapterId, resolveMedia });
    if (currentTts.fingerprint !== job.inputFingerprint) throw new Error(`current TTS text/profile fingerprint 已过期: ${sb.id}`);
    const videoPath = resolveRemotionCurrentSlotOutputPath(path.join(projectDir, "remotion"), slot);
    const audioPath = resolveMedia(sb.audioRef.path);
    const bindingPath = resolveMedia(buildProjectFileUrl(projectId, voice.source.relativePath));
    if (path.resolve(bindingPath) !== path.resolve(audioPath) || await hashFileSha256(audioPath) !== voice.sourceFingerprint
      || await hashFileSha256(videoPath) !== slot.evidence.sha256) throw new Error(`on-disk audio/video SHA 不一致: ${sb.id}`);
    requireSourceHash(slot.evidence.sha256);
    const ttsSpokenText = sb.ttsSpokenText;
    if (!ttsSpokenText?.trim()) throw new Error(`缺少 current spoken text: ${sb.id}`);
    shots.push({ shotId: sb.id, videoPath, audioPath, ttsSpokenText, sourceSha256: slot.evidence.sha256,
      audioSha256: voice.sourceFingerprint, textSha256: await sha256Text(ttsSpokenText), durationUs: slot.evidence.durationUs,
      ...(sb.shotFx?.registryOverlay ? { overlayTemplateId: sb.shotFx.registryOverlay } : {}) });
  }
  assertCliDuration(store.state, chapterId, storyboards, false, shots.reduce((sum, shot) => sum + shot.durationUs, 0));
  return shots;
}

async function buildBoundaryIntents(
  projectDir: string,
  chapterId: string,
  shotInputs: ShotSlotInfo[],
): Promise<VideoUseBoundaryIntentV1[]> {
  const store = readStudioWorkflowStoreState(projectDir);
  if (!store) return [];
  const state = store.state as {
    storyboards?: Array<{ id: string; episodeId: string; index: number; trackKey?: string; shotSemantics?: { transitionToNext?: { styleWord: string; moodWord?: string } } }>;
    scriptPlans?: Array<{ episodeId?: string; transitions?: string }>;
  };
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
  const chapterId = process.env.MYSTUDIO_CHAPTER_ID || "chapter-001";
  const initialShotInputs = await buildShotInputs(projectDir, projectId, chapterId, await readRemotionCurrentShotSlotsFromWorkspace(path.join(projectDir, "remotion"), projectId, chapterId));
  const liveState = readStudioWorkflowStoreState(projectDir)!.state;
  const liveShots = (liveState.storyboards as StoryboardItem[]).filter(s => s.episodeId === chapterId);
  const externalReview = process.env.MYSTUDIO_PIPELINE_REVIEW ? JSON.parse(fs.readFileSync(process.env.MYSTUDIO_PIPELINE_REVIEW, "utf8")) as Record<string, unknown> : undefined;
  const dataRoot = roots.dataRoot; // <storageBase>/projects
  const storageBasePath = resolveStorageBasePath();
  const userDataDir = resolveUserDataDir();

  // workspace root for video-use artifacts
  const workspaceRootForProject = (pid: string) =>
    registeredProjectDir(pid) ? path.join(registeredProjectDir(pid)!, "video-use") : path.join(dataRoot, "_p", pid, "video-use");
  // HyperFrames 独立工作区根（08-18）：video-use 同级 hyperframes/
  const hyperFramesWorkspaceRootForProject = (pid: string) =>
    registeredProjectDir(pid) ? path.join(registeredProjectDir(pid)!, "hyperframes") : path.join(dataRoot, "_p", pid, "hyperframes");
  const workspaceRoot = workspaceRootForProject(projectId);

  // ── 2. Set up shared toolchain (ffmpeg/ffprobe) ──
  const toolchain = selectSharedVideoToolchain({
    configuredFfmpeg: process.env.MYSTUDIO_FFMPEG_PATH,
    configuredFfprobe: process.env.MYSTUDIO_FFPROBE_PATH,
    bundledFfmpeg: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64", "ffmpeg"),
    bundledFfprobe: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64", "ffprobe"),
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
  // The TTS runtime controller uses <storageBase>/model/TTS as its default model cache dir.
  // The video-use adapter sets MANYING_TTS_MODELS_DIR and VOICEBOX_MODELS_DIR from this value.
  // The Whisper model lives at <storageBase>/model/TTS/models--mlx-community--whisper-large-v3-turbo
  const modelCacheDir = ttsModelCacheDir(storageBasePath);

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
  // 08-22 深审修:worker 侧 HY CLI 找不到浏览器会静默退 1(无 stderr 无产物);
  // 显式落进 process.env,与 generate-accepted-hyperframes.ts 同款保险
  // (resolveBrowserPath 回调之外的 env 兜底链才能吃到)。
  if (fs.existsSync(browserPath)) process.env.HYPERFRAMES_BROWSER_PATH = browserPath;
  // build-mac.sh periodically cleans apps/out during packaging rounds; the
  // MYSTUDIO_HYPERFRAMES_WORKER override lets pipeline runs point at a stable
  // worker copy (e.g. apps/.cache/hyperframes-worker.cjs) instead of racing
  // the packaging flow.
  const hyperFramesWorkerPath = process.env.MYSTUDIO_HYPERFRAMES_WORKER
    ?? path.join(appsRoot, "out", "main", "hyperframes-worker.cjs");

  const hyperFramesAdapter = createHyperFramesAdapter({
    storageBasePath: () => storageBasePath,
    electronExecutable,
    workspaceRootForProject: hyperFramesWorkspaceRootForProject,
    workerPath: fs.existsSync(hyperFramesWorkerPath) ? hyperFramesWorkerPath : undefined,
    // hy:* registry 模板依赖目录(与装机应用同源;python 侧经 process.env 同名透传)
    registryDepsDir: process.env.MYSTUDIO_REGISTRY_DEPS_DIR?.trim()
      ?? path.join(storageBasePath, "hyperframes-registry-deps"),
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

  // ── 6b. Cinematic 3D 已退役(09-10 用户裁定:depth 域随 MiniMax 视频/音频路线淘汰) ──
  // MYSTUDIO_CINEMATIC 不再生效;cinematicEnabled 恒 false 以最小化下游改动。
  const cinematicEnabled = false as const;

  // ── 7. Load shot slots + build shot inputs ──
  // Historical automation reports are evidence only. Re-read the production
  // job/evidence/output triplets so later revisions cannot consume stale slots.
  const remotionWorkspaceRoot = path.join(projectDir, "remotion");
  const shotSlots = await readRemotionCurrentShotSlotsFromWorkspace(remotionWorkspaceRoot, projectId, chapterId);
  if (shotSlots.length === 0) {
    throw new Error(`current shot slots 不存在: ${remotionWorkspaceRoot}`);
  }

  const shotInputs = initialShotInputs;
  console.log("[full-pipeline] shot inputs built:", shotInputs.length, "shots");

  // ── 7b. W0 剧本检查门·副门(design §2.3) ──
  // 时点=结构探测(stage 7)之后、任何成功 evidence 写档之前(首个成功写档在
  // writeVideoWorkflowJson(runResult.artifactPath))。只读不修复;RED 时门内先落
  // passed:false 回执再 throw,整条管线停(六步范式③)。判定真源跨域 import 前端
  // @/lib/studio/script-precheck(先例=本文件 :54 boundary-intent-assembly)。
  const precheckSourceChapter = (liveState.novelChapters as Array<{ id: string; sourceText?: string }> | undefined)
    ?.find((chapter) => chapter.id === chapterId);
  const precheckSourceText = precheckSourceChapter?.sourceText ?? "";
  const precheckStrict = isDaojieAdaptation(
    (liveState.workflowConfig as { directorManualId?: string } | undefined)?.directorManualId,
    precheckSourceText,
  );
  // 剧本台词真源:本章最新 scriptDraft 草稿(与 resolveScriptTextForEpisode 同式
  // updatedAt 取新),缺草稿回落章 sourceText。
  const precheckScriptText = ((liveState.agentWorkData as Array<{ key?: string; episodeId?: string; data?: string; updatedAt?: number }> | undefined) ?? [])
    .filter((entry) => entry.key === "scriptDraft" && entry.episodeId === chapterId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0]?.data
    ?? precheckSourceText;
  const scriptPrecheck = await runScriptPrecheckGate({
    automationDir: outputDir,
    projectId,
    chapterId,
    shots: shotInputs,
    storeStoryboards: liveShots,
    durationCapSeconds: precheckStrict ? DAOJIE_STRICT_DURATION_SECONDS : GENERIC_DURATION_SECONDS,
    scriptVoiceLines: extractScriptVoiceLines(precheckScriptText),
    ...(precheckStrict ? { sourceText: precheckSourceText } : {}),
  });
  // 范式⑤:调用方独立重哈希对拍(镜像 :1220-1221 final-audio 同款)——门内 inputs
  // 投影哈希与管线现值重算一致才放行,防 evidence 与实际输入脱钩。
  const scriptPrecheckRehash = await sha256CanonicalJson(scriptPrecheckInputsProjection(shotInputs));
  if (scriptPrecheckRehash !== scriptPrecheck.inputsSha256) {
    throw new Error("script-precheck-inputs-changed-before-evidence");
  }
  console.log(`[full-pipeline] script precheck gate PASSED (yellow ${scriptPrecheck.yellow.length}, pending ${scriptPrecheck.pendingCount})`);


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
  if (externalReview) {
    if (!Number.isSafeInteger(externalReview.revision) || Number(externalReview.revision) <= 0) throw new Error("review revision 无效");
    const expectedReviewRevision = existingProject ? existingProject.revision + 1 : nextRevision - 1;
    if (externalReview.revision !== expectedReviewRevision) throw new Error("review revision 已过期或不是当前 pending revision");
    nextRevision = Number(externalReview.revision);
  }
  const sourceSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.sourceSha256 })));
  const audioSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.audioSha256 })));
  const textSha256 = await sha256CanonicalJson(shotInputs.map((s) => ({ shotId: s.shotId, sha256: s.textSha256 })));

  // Director-plan boundary intents: parse the structured ⑥ lines, map scene
  // boundaries onto the shot list (storyboard trackKey scene grouping), and
  // translate each style word through the single-source transition policy.
  const boundaryIntents = await buildBoundaryIntents(projectDir, chapterId, shotInputs);

  // hy:* registry 渲染验证注入(MYSTUDIO_HY_PROOF_MOODS=1):道劫存量分镜尚无
  // moodWord 数据源(vision 层未在此项目流转),注入跨大类 mood 词让 python
  // _build_overlay_slots 走 registry 分支——effect/duration 均为真实值。
  if (process.env.MYSTUDIO_HY_PROOF_MOODS === "1") {
    const proofMoods = ["战斗", "雪", "回忆", "星", "科技", "文字"];
    const injected = boundaryIntents.length > 0 ? boundaryIntents.slice(0, proofMoods.length) : [];
    if (boundaryIntents.length > 0) {
      injected.forEach((intent, i) => { intent.moodWord = proofMoods[i % proofMoods.length]; });
    } else {
      const ids = shotInputs.map((s) => s.shotId);
      const step = Math.max(1, Math.floor(ids.length / (proofMoods.length + 1)));
      for (let i = 0; i < proofMoods.length; i++) {
        const from = ids[(i + 1) * step - 1];
        const to = ids[(i + 1) * step];
        if (from && to && from !== to) {
          injected.push({ fromShotId: from, toShotId: to, effectId: "crossfade", durationUs: 500_000, styleWord: "crossfade", moodWord: proofMoods[i] });
        }
      }
      boundaryIntents.push(...injected);
    }
    console.log(`[full-pipeline] HY proof moods injected: ${injected.map((i) => `${i.fromShotId}→${i.toShotId}:${i.moodWord}`).join(", ")}`);
  }

  // 转场语音钳制(MYSTUDIO_HY_PROOF_MOODS 同门):按上一轮 artifact 的 EDL+字幕
  // cue 把 intent 重叠收紧到"上一镜语音结束后的静默尾"内——组合 props 门的
  // 语音挤压规则要求数据侧合规;python EDL 合并无 cue 钳制属独立缺口(留档)。
  if (process.env.MYSTUDIO_HY_PROOF_MOODS === "1" && boundaryIntents.length > 0) {
    const prevArtifactPath = (() => {
      const root = path.join(workspaceRoot, chapterId);
      if (!fs.existsSync(root)) return null;
      const revs = fs.readdirSync(root).map((e) => e.match(/^r(\d+)$/)).filter(Boolean)
        .map((m) => Number(m![1])).sort((a, b) => b - a);
      for (const rev of revs) {
        const c = path.join(root, `r${rev}`, "video-use-artifact.json");
        if (fs.existsSync(c)) return c;
      }
      return null;
    })();
    if (prevArtifactPath) {
      const prev = JSON.parse(fs.readFileSync(prevArtifactPath, "utf8")) as {
        edl?: { ranges?: Array<{ source: string; start: number; end: number }> };
        subtitles?: Array<{ shotId: string; startUs: number; durationUs: number }>;
      };
      const shotEnd = new Map<string, number>();
      for (const r of prev.edl?.ranges ?? []) shotEnd.set(String(r.source), Math.round(r.end * 1_000_000));
      const lastSpeechEnd = new Map<string, number>();
      for (const c of prev.subtitles ?? []) {
        const end = c.startUs + c.durationUs;
        lastSpeechEnd.set(c.shotId, Math.max(lastSpeechEnd.get(c.shotId) ?? 0, end));
      }
      const guardUs = Math.round(2_000_000 / 30); // 留 2 帧安全余量
      let clamped = 0, dropped = 0;
      for (let i = boundaryIntents.length - 1; i >= 0; i--) {
        const intent = boundaryIntents[i]!;
        const end = shotEnd.get(intent.fromShotId);
        const speech = lastSpeechEnd.get(intent.fromShotId);
        if (end === undefined) continue;
        const tailUs = end - (speech ?? 0) - guardUs;
        if (tailUs < 200_000) { boundaryIntents.splice(i, 1); dropped++; continue; } // 静默尾不足→硬切
        if (intent.durationUs > tailUs) { intent.durationUs = tailUs; clamped++; }
      }
      console.log(`[full-pipeline] transitions clamped=${clamped} dropped=${dropped} (speech-tail rule, from ${path.basename(path.dirname(prevArtifactPath))})`);
    }
  }

  // 分镜生成图路径表（overlay 装饰槽内容感知定位）：store mediaRef → 注册表解析绝对路径
  const imagePathByShotId = (() => {
    const map = new Map<string, string>();
    try {
      const storeForImages = readStudioWorkflowStoreState(projectDir);
      const imageStoryboards = (storeForImages?.state.storyboards ?? []) as Array<{ id: string; episodeId: string; mediaRef?: { path?: string } }>;
      for (const storyboard of imageStoryboards) {
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
    storyboardSourcePolicy: "current-ready",
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
  const runResult = externalReview
    ? (() => {
      const artifactPath = path.join(workspaceRoot, chapterId, `r${nextRevision}`, "video-use-artifact.json");
      const parsed = validateVideoUseChapterArtifact(JSON.parse(fs.readFileSync(artifactPath, "utf8")));
      if (!parsed.success) throw new Error("待审核 artifact 无效");
      return { state: "pending" as const, artifact: parsed.value, artifactPath };
    })()
    : await videoUseAdapter.runChapter(chapterRun);
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

  assertCliDuration(liveState, chapterId, liveShots, false, Math.round(Math.max(...videoUseArtifact.edl.map(e => e.timelineStartS + e.durationS)) * 1_000_000));
  if (!externalReview) {
    const pending = { ok: false, state: "awaiting-review", artifactPath: runResult.artifactPath, projectId, chapterId, revision: nextRevision, sourceSha256, audioSha256, textSha256, artifactSha256: videoUseArtifact.evidence.artifactSha256 };
    process.stdout.write(`${JSON.stringify(pending, null, 2)}\n`);
    return pending;
  }
  if (videoUseArtifact.sourceSha256 !== sourceSha256 || videoUseArtifact.audioSha256 !== audioSha256 || videoUseArtifact.textSha256 !== textSha256) throw new Error("pending artifact 与 current shots 不一致");
  requireSourceHash(externalReview.artifactFileSha256);
  if (await hashFileSha256(runResult.artifactPath) !== externalReview.artifactFileSha256) throw new Error("review artifact 文件 SHA 不一致");
  const freshInputs = await buildShotInputs(projectDir, projectId, chapterId, await readRemotionCurrentShotSlotsFromWorkspace(remotionWorkspaceRoot, projectId, chapterId));
  if (JSON.stringify(freshInputs) !== JSON.stringify(shotInputs)) throw new Error("审核期间 current source/slots 已变化");
  const review = await validatePipelineReview(externalReview, videoUseArtifact);
  const subtitleAuthority = review.subtitleAuthority;
  writeVideoWorkflowJson(runResult.artifactPath, { ...videoUseArtifact, subtitleAuthority });
  const acceptResult = await acceptVideoUseArtifact(workspaceRootForProject, {
    projectId, chapterId, revision: nextRevision, reviewer: review.reviewer, timestamp: review.timestamp,
  }, review.timestamp);
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
      sourceSnapshotHash: sourceSha256,
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
      clip.source.path = slot.evidence.outputPath ?? clip.source.path;
      if (!clip.source.evidence) clip.source.evidence = {};
      (clip.source.evidence as Record<string, unknown>).remotionJobId = slot.job?.jobId;
      (clip.source.evidence as Record<string, unknown>).remotionEvidenceSha256 = slot.evidence.sha256;
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

  // ── 15b. 2D 镜头语言 + 镜头特效走 plan.effects 正门（与 App 一键成片共享
  // 决策单源 mergeShotFxEditingEffects，保证两条入口产出一致）。store 缺失时
  // 仅规则轮换运镜；MYSTUDIO_SHOT_FX=0 可显式关闭。
  // 字幕音效类别表（08-19）：分镜 shotFx.sfx（MYSTUDIO_SHOT_FX=0 时为空表零派生）
  const sfxCategoryByStoryboardId: Record<string, string> = {};
  if (process.env.MYSTUDIO_SHOT_FX !== "0") {
    // 章节统一色调/字幕音效（08-19）：workflowConfig 同源——钉死色卡全章覆盖
    // grade，subtitleSfxEnabled 注水 plan.renderSettings 供合成端消费。
    let chapterGrade: { lutId: string; blend: number } | undefined;
    const shotFxStoryboards = (() => {
      try {
        const fxStore = readStudioWorkflowStoreState(projectDir);
        const fxStoryboards = (fxStore?.state.storyboards ?? []) as Array<{ id: string; episodeId: string; prompt?: string; line?: string; shotFx?: { motion?: unknown; sfx?: string } }>;
        const workflowConfig = fxStore?.state.workflowConfig as
          | { chapterGrade?: { lutId?: unknown; blend?: unknown }; subtitleSfxEnabled?: unknown }
          | undefined;
        if (workflowConfig?.chapterGrade && typeof workflowConfig.chapterGrade.lutId === "string") {
          // 08-21 裁定：blend 透传 store 配置（0..1 合法域），代码不设审美上限；
          // 「压低调色」由项目 store 不配 chapterGrade（AI 逐镜默认不调色）实现。
          const blendRaw = Number(workflowConfig.chapterGrade.blend ?? 0.05);
          chapterGrade = {
            lutId: workflowConfig.chapterGrade.lutId,
            blend: Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.05,
          };
        }
        if (workflowConfig?.subtitleSfxEnabled === true) {
          plan.renderSettings = { ...plan.renderSettings, subtitleSfxEnabled: true };
        }
        return fxStoryboards.filter((storyboard) => storyboard.episodeId === chapterId);
      } catch { return [] }
    })();
    for (const storyboard of shotFxStoryboards) {
      if (typeof storyboard.shotFx?.sfx === "string") {
        sfxCategoryByStoryboardId[storyboard.id] = storyboard.shotFx.sfx;
      }
    }
    const shotFx = mergeShotFxEditingEffects(plan.effects, {
      planClips: plan.clips,
      storyboards: shotFxStoryboards,
      ...(chapterGrade ? { chapterGrade } : {}),
    });
    plan.effects = shotFx.effects;
    console.log(`[full-pipeline] 2D shot-fx effects merged: motion ${shotFx.counts.motion}, shake ${shotFx.counts.shake}, glow ${shotFx.counts.glow}, chroma ${shotFx.counts.chroma}`);
  }

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
    // 1028 提速通道:MYSTUDIO_RENDER_CHROME=chrome 时用系统 Chrome(Metal GPU 合成,字幕/GL 滤镜帧耗大降),
    // 与 cinematicEnabled 解耦——cinematic 3D 仍退役,这只是渲染器选择。
    const renderBrowser = (
      (cinematicEnabled && process.env.MYSTUDIO_CINEMATIC_BROWSER === "chrome")
      || process.env.MYSTUDIO_RENDER_CHROME === "chrome"
    ) && fs.existsSync(systemChrome)
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

      // 章节级效果资产（08-19 章节色调/字幕音效）：LUT+sfx 注册进会话——
      // grade 效果 fail-closed 需要 lutUrlById；sfx 供字幕驱动派生。
      const effectAssetsDir = path.join(appsRoot, "frontend/assets");
      const lutUrlById: Record<string, string> = {};
      const sfxUrlById: Record<string, string> = {};
      {
        const lutsDir = path.join(effectAssetsDir, "luts");
        if (fs.existsSync(lutsDir)) {
          const files = fs.readdirSync(lutsDir).filter((f) => f.endsWith(".png"));
          for (const f of files) mediaSources.push({ clipId: `lut-${f}`, absolutePath: path.join(lutsDir, f) });
        }
        const sfxDir = path.join(effectAssetsDir, "sfx");
        if (fs.existsSync(sfxDir)) {
          const files = fs.readdirSync(sfxDir).filter((f) => f.endsWith(".ogg"));
          for (const f of files) mediaSources.push({ clipId: `sfx-${f}`, absolutePath: path.join(sfxDir, f) });
        }
      }
      const mediaUrlByClipId = buildMediaUrlMap(mediaBridge, session, mediaSources);
      const mediaUrlByBindingId = Object.fromEntries(
        chapterManifest.sharedAudioBindings.map((binding) => [binding.bindingId, mediaUrlByClipId[`chapter-audio:${binding.bindingId}`]]),
      );
      {
        const lutsDir = path.join(effectAssetsDir, "luts");
        if (fs.existsSync(lutsDir)) {
          for (const f of fs.readdirSync(lutsDir).filter((entry) => entry.endsWith(".png"))) {
            lutUrlById[f.slice(0, -4)] = mediaUrlByClipId[`lut-${f}`];
          }
        }
        const sfxDir = path.join(effectAssetsDir, "sfx");
        if (fs.existsSync(sfxDir)) {
          for (const f of fs.readdirSync(sfxDir).filter((entry) => entry.endsWith(".ogg"))) {
            sfxUrlById[f.slice(0, -4)] = mediaUrlByClipId[`sfx-${f}`];
          }
        }
      }

      // Build composition props with gate result (the proper path)
      const buildPropsOnce = (): ReturnType<typeof buildChapterVideoCompositionProps> => buildChapterVideoCompositionProps({
        plan,
        currentShotSlots: shotSlots,
        chapterManifest,
        mediaUrlByClipId,
        mediaUrlByBindingId,
        lutUrlById,
        ...(plan.renderSettings.subtitleSfxEnabled === true
          ? { sfxUrlById, sfxCategoryByStoryboardId }
          : {}),
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
      // 语音挤压收敛(MYSTUDIO_HY_PROOF_MOODS):python EDL 统一 1s 重叠未按 cue
      // 钳制(独立缺口留档);渲前就地收敛——越界转场时长减半,静默尾不足回落硬切。
      let projected = buildPropsOnce();
      if (process.env.MYSTUDIO_HY_PROOF_MOODS === "1") {
        for (let attempt = 0; attempt < 6 && !projected.success; attempt++) {
          const violating = [...new Set(projected.issues
            .filter((i) => i.message.includes("重叠侵入上一镜语音区"))
            .map((i) => Number(/^plan\.transitions\[(\d+)\]/.exec(i.path)?.[1]))
            .filter((n) => Number.isInteger(n) && plan.transitions[n] !== undefined))].sort((a, b) => b - a);
          if (violating.length === 0) break;
          for (const idx of violating) {
            const tr = plan.transitions[idx]!;
            if (tr.durationUs <= 160_000) {
              plan.transitions.splice(idx, 1);
              console.log(`[full-pipeline] transition ${tr.effectId}@${idx} 静默尾不足→硬切(语音挤压收敛)`);
            } else {
              tr.durationUs = Math.floor(tr.durationUs / 2);
            }
          }
          projected = buildPropsOnce();
        }
      }
      if (!projected.success) throw new Error(`composition props 失败: ${projected.issues.map((i) => `${i.path}: ${i.message}`).join("；")}`);
      const props = projected.value;

      // Cinematic 注入已随 depth 退役移除(09-10)。
      // 2D 镜头语言/特效已前置到 15b：plan.effects 正门（build-composition-props
      // 消费），不再渲染时直注合成 props。

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

      // W0 §2.4 响度边车转正:渲染起点→evidence 写档尾(连同 report 收尾)包 catch——
      // 区间内任何 throw(含响度门本体,其代码一字不动)先用内存现值补写五件套
      // sidecar+失败回执再原样上抛。成功路径零改动(缩进保持原样,不重排)。
      const failureSidecarContext = {
        outputDir,
        remotionOutputDir,
        projectId,
        chapterId,
        nextRevision,
        plan,
        projectedProject,
        shotSlots,
        chapterManifest,
        gateInput,
        acceptedArtifact,
        bundleManifest: manifest,
        renderStartedAt,
        outputPath,
      };
      let renderExpectedDurationS: number | undefined;
      try {
      console.log("[full-pipeline] starting Remotion renderMedia...");
      const composition = await selectComposition({
        serveUrl: bundlePath, id: CHAPTER_VIDEO_COMPOSITION_ID, inputProps: props,
        browserExecutable: browser, binariesDirectory, chromeMode: "headless-shell",
        onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
      });
      assertCliDuration(liveState, chapterId, liveShots, false, Math.round(composition.durationInFrames / composition.fps * 1_000_000));
      // 真 Chrome(--headless=new) 走 Metal GPU，无需软件 GL；仅在无 Chrome 回退 headless-shell
      // 时才用 swangle，且限并发防软件上下文内存崩。
      const useSystemChrome = renderBrowser === systemChrome;
      await renderMedia({
        serveUrl: bundlePath, composition, inputProps: props, outputLocation: rawPath,
        codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac",
        // 锐度纪律：crf 16 + slow（默认 18/medium 在 grain/二次编码下软化明显）
        // 1028 提速通道:MYSTUDIO_RENDER_X264=medium 时降为 medium(编码段约省一半,crf16 下视觉无损)
        crf: 16, x264Preset: process.env.MYSTUDIO_RENDER_X264 === "medium" ? "medium" as const : "slow" as const,
        browserExecutable: renderBrowser, binariesDirectory, chromeMode: "headless-shell",
        // GL transitions/grade also run when cinematic depth is disabled. The
        // default Headless Shell ANGLE/Vulkan path cannot create a WebGL
        // context on this host; keep the same SwiftShader route as the
        // renderer worker. Explicit system-Chrome runs retain their Metal GL.
        ...(!useSystemChrome ? { chromiumOptions: { gl: "swangle" as const }, concurrency: 2 } : {}),
        enforceAudioTrack: true, overwrite: true,
        onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
      });
      // 响度后处理两级链(1048 混音实测收敛):
      // ①单遍动态 loudnorm 到目标(模块同 Electron 渲染路径);
      // ②实测残余微调——动态模式 I/TP 双偏(W1-1029 实弹 -13.5/-1.3 vs 目标 -14±0.5/≤-1.5),
      //   按 ebur128 实测算 trim=max(I 超出量, TP 超出量),volume 线性回压至双达标;
      //   若压 I 会跌破容差下沿则如实上抛(混音 PLR 超限,须回混音层修,不静默糊弄)。
      await runTimelineAudioPostProcess({
        rawInputPath: rawPath,
        outputPath,
        logPath: path.join(remotionOutputDir, "audio-postprocess.log"),
        loudnessLufs: plan.renderSettings.loudnessLufs,
        truePeakDbtp: plan.renderSettings.truePeakDbtp,
      });
      const measureEbur128 = (filePath: string) => new Promise<{ integrated: number; peak: number }>((resolve, reject) => {
        execFile("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-map", "0:a:0",
          "-af", "ebur128=peak=true", "-f", "null", "-"],
          { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
            if (error && !stderr) return reject(error);
            const text = String(stderr);
            const iMatch = [...text.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)].pop();
            const pMatch = [...text.matchAll(/Peak:\s+(-?[0-9.]+) dBFS/g)].pop();
            if (!iMatch || !pMatch) return reject(new Error("ebur128 摘要缺失"));
            resolve({ integrated: Number(iMatch[1]), peak: Number(pMatch[1]) });
          });
      });
      const postLog: string[] = [];
      const loudnormResult = await measureEbur128(outputPath);
      postLog.push(`[mystudio] loudnorm result: I=${loudnormResult.integrated} LUFS, Peak=${loudnormResult.peak} dBFS`);
      const capI = loudnormResult.integrated - (plan.renderSettings.loudnessLufs + 0.5);
      const capTP = loudnormResult.peak - (plan.renderSettings.truePeakDbtp + 1e-6);
      const trimDb = Math.max(0, capI, capTP);
      if (trimDb > 0.01) {
        if (loudnormResult.integrated - trimDb < plan.renderSettings.loudnessLufs - 0.5 - 1e-6) {
          throw new Error(`混音 PLR 超限,loudnorm 后无法同时满足 I/TP 容差(I=${loudnormResult.integrated}, TP=${loudnormResult.peak})——须回混音层修`);
        }
        const trimmedPath = path.join(remotionOutputDir, ".loudnorm-trim.mp4");
        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", ["-i", outputPath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy",
            // 1030 响度链定谳(r1-findings「响度链新定谳」):AAC 金属瞬态解码过冲可达 +1dB,
            // 单次 volume 线性压不死 TP;1028/1030 两役实证 alimiter=limit=0.794:level=false
            // 一步双绿(TP=-1.6/I=-13.7),trim 预编码段内挂,防管线原生重渲 TP 门复发。
            "-af", `volume=-${trimDb.toFixed(3)}dB,alimiter=limit=0.794:level=false`, "-c:a", "aac", "-ar", "48000", "-b:a", "192k",
            // 1030 勘正:同 timeline-audio-postprocess——-shortest 会按 AAC 帧网格非确定性
            // 截视频尾帧,时长门以视频流为准,保帧优先(音频尾短 10ms 无感)。
            "-movflags", "+faststart", "-y", trimmedPath],
            { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, _stderr) => {
              if (error) return reject(error);
              resolve();
            });
        });
        fs.renameSync(trimmedPath, outputPath);
        const trimmedResult = await measureEbur128(outputPath);
        postLog.push(`[mystudio] trim -${trimDb.toFixed(3)}dB result: I=${trimmedResult.integrated} LUFS, Peak=${trimmedResult.peak} dBFS`);
      } else {
        postLog.push("[mystudio] no trim needed");
      }
      fs.appendFileSync(path.join(remotionOutputDir, "audio-postprocess.log"), postLog.join("\n") + "\n", "utf8");
      console.log("[full-pipeline] Remotion render complete:", outputPath);

      // ── 19. Verify output ──
      const probe = await probeRenderedMedia(outputPath);
      const probePath = path.join(remotionOutputDir, "ffprobe.json");
      fs.writeFileSync(probePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
      const expectedDuration = composition.durationInFrames / composition.fps;
      renderExpectedDurationS = expectedDuration;
      assertRenderedMediaEvidence({ label: "Daojie Full Pipeline", probe, expectedDuration, fps: composition.fps, width: plan.renderSettings.width, height: plan.renderSettings.height });
      // Structural probing is insufficient: accept the final encoded audio before success evidence.
      const finalAudioAcceptance = await acceptFinalAudio({
        filePath: outputPath,
        renderSettings: plan.renderSettings,
        rawLogPath: path.join(remotionOutputDir, "final-audio-ebur128.log"),
        reportPath: path.join(remotionOutputDir, "final-audio-acceptance.json"),
      });
      const sha256 = await hashFileSha256(outputPath);
      if (sha256 !== finalAudioAcceptance.output.sha256) throw new Error("final-audio-file-changed-before-evidence");
      const outputStat = fs.statSync(outputPath);
      const inputManifestPath = path.join(outputDir, "input-manifest.json");
      const timelineRenderPlanPath = path.join(outputDir, "timeline-render-plan.json");
      const editingSnapshotPath = path.join(outputDir, "editing-project.json");
      const chapterEvidencePath = path.join(remotionOutputDir, "chapter-video-evidence.json");
      const finalQcExpectedPath = path.join(outputDir, "final-output-qc-expected.json");
      writeVideoWorkflowJson(inputManifestPath, {
        schemaVersion: 1,
        projectId,
        chapterId,
        revision: nextRevision,
        gateInput,
        chapterManifest,
        currentShotSlots: shotSlots,
      });
      writeVideoWorkflowJson(timelineRenderPlanPath, plan);
      writeVideoWorkflowJson(editingSnapshotPath, projectedProject);
      const runEvidence = await buildFullPipelineRunEvidence({
        projectId,
        chapterId,
        editingProjectId: projectedProject.id,
        editingRevision: projectedProject.revision,
        mode: acceptedArtifact.mode,
        renderInputSha256: gateInput.inputSha256,
        videoUseInputSha256: acceptedArtifact.evidence.inputSha256,
        bundleContentHash: manifest.contentHash,
        templateVersion: manifest.templateVersion,
        remotionVersion,
        renderSettings: plan.renderSettings,
        expectedDurationS: expectedDuration,
        runRoot: outputDir,
        outputPath,
        inputManifestPath,
        renderPlanPath: timelineRenderPlanPath,
        snapshotPath: editingSnapshotPath,
        outputSizeBytes: outputStat.size,
        outputMtimeMs: outputStat.mtimeMs,
        outputSha256: sha256,
        probe,
        startedAt: renderStartedAt,
        completedAt: Date.now(),
      });
      writeVideoWorkflowJson(chapterEvidencePath, runEvidence.evidence);
      writeVideoWorkflowJson(finalQcExpectedPath, runEvidence.expected);

      const report = {
        ok: true,
        generatedAt: new Date().toISOString(),
        pipeline: "video-use adapter.runChapter → accept → applyAcceptedArtifact (HyperFrames) → gate → authority → buildChapterVideoCompositionProps → renderMedia",
        renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash },
        videoUse: {
          artifactPath: applyResult.videoUseArtifactPath,
          revision: nextRevision,
          status: acceptedArtifact.status, stage: acceptedArtifact.stage, mode: acceptedArtifact.mode,
          alignmentCount: acceptedArtifact.alignment.length, edlCount: acceptedArtifact.edl.length,
          subtitleCount: acceptedArtifact.subtitles.length, overlaySlotCount: acceptedArtifact.overlaySlots.length,
          selfEvalPassed: acceptedArtifact.selfEval.passed, selfEvalScore: acceptedArtifact.selfEval.score,
        },
        hyperFrames: { artifactPath: applyResult.hyperFramesArtifactPath, status: applyResult.hyperFramesArtifact.status, windowCount: applyResult.hyperFramesArtifact.windows.length },
        gate: { accepted: true, videoUseArtifactSha256: gateResult.videoUseArtifactSha256, hyperFramesOutputPath: gateResult.hyperFramesOutputPath ?? "(noop)" },
        authority: { mode: subtitleAuthority.mode, passed: true, suppressedCueIds: authorityValidation.success ? authorityValidation.suppressedCueIds.size : 0 },
        composition: { visualClips: props.visualClips.length, subtitles: props.subtitles.length, audioClips: props.audioClips.length, overlayClips: props.overlayClips?.length ?? 0 },
        output: { path: outputPath, sizeBytes: outputStat.size, sha256, duration: probe.duration, width: probe.width, height: probe.height, streams: probe.streams },
        finalAudioAcceptance,
        // 范式⑥:副门回执并入 report(design §2.3)。
        scriptPrecheck: { passed: true, inputsSha256: scriptPrecheck.inputsSha256, receiptPath: scriptPrecheck.receiptPath, yellowCount: scriptPrecheck.yellow.length, pendingCount: scriptPrecheck.pendingCount },
        evidence: {
          inputManifestPath,
          timelineRenderPlanPath,
          editingSnapshotPath,
          chapterEvidencePath,
          finalQcExpectedPath,
          chapterJobId: runEvidence.evidence.jobId,
        },
        editingProject: { id: projectedProject.id, revision: projectedProject.revision, clips: projectedProject.clips.length, subtitleMode: projectedProject.renderSettings.subtitleMode },
        renderDuration: (Date.now() - renderStartedAt) / 1000,
      };
      fs.writeFileSync(path.join(remotionOutputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
      } catch (renderPipelineError) {
        // §2.4:失败先补写 sidecar 再上抛(响度门本体与成功路径代码一字不动)。
        await writeFailureSidecars({
          ...failureSidecarContext,
          expectedDurationS: renderExpectedDurationS,
          triggerError: renderPipelineError,
        });
        throw renderPipelineError;
      }
    } finally {
      await mediaBridge.revokeSession(session);
    }
  } finally {
    process.chdir(previousCwd);
  }
}


// ─── W0 §2.4 响度边车转正:失败路径 sidecar 补写 ─────────────────────────
// 欠账机制:sidecar 五件套全部在 acceptFinalAudio 之后写(成功路径 :1245-1288 段),
// 之前任何 throw(响度门/渲染/probe)都让五件全缺——rebuild_chapter_sidecars.ts 只能
// 事后人工复刻。转正:渲染起点→evidence 写档尾包 catch,用内存现值补写同名五件套
// + 失败回执 pipeline-failure-sidecars.json。只写 evidence,不改任何产物。
async function writeFailureSidecars(context: {
  outputDir: string;
  remotionOutputDir: string;
  projectId: string;
  chapterId: string;
  nextRevision: number;
  plan: TimelineRenderPlan;
  projectedProject: EditingProjectV1;
  shotSlots: RemotionCurrentSlotV1[];
  chapterManifest: unknown;
  gateInput: RemotionChapterGateInputV1;
  acceptedArtifact: { mode: string; status: string; stage: string; evidence: { inputSha256: string } };
  bundleManifest: RemotionBundleManifest;
  renderStartedAt: number;
  outputPath: string;
  expectedDurationS?: number;
  triggerError: unknown;
}): Promise<void> {
  // 路径算式同成功路径(:1244-1248 段)。
  const inputManifestPath = path.join(context.outputDir, "input-manifest.json");
  const timelineRenderPlanPath = path.join(context.outputDir, "timeline-render-plan.json");
  const editingSnapshotPath = path.join(context.outputDir, "editing-project.json");
  const chapterEvidencePath = path.join(context.remotionOutputDir, "chapter-video-evidence.json");
  const finalQcExpectedPath = path.join(context.outputDir, "final-output-qc-expected.json");
  const failureReceiptPath = path.join(context.outputDir, "pipeline-failure-sidecars.json");
  try {
    writeVideoWorkflowJson(inputManifestPath, {
      schemaVersion: 1,
      projectId: context.projectId,
      chapterId: context.chapterId,
      revision: context.nextRevision,
      gateInput: context.gateInput,
      chapterManifest: context.chapterManifest,
      currentShotSlots: context.shotSlots,
    });
    writeVideoWorkflowJson(timelineRenderPlanPath, context.plan);
    writeVideoWorkflowJson(editingSnapshotPath, context.projectedProject);
    // output 未产出(渲染中途死)→跳过需 output 的两件,回执记 outputAbsent: true
    // (不伪造 sha);output 在但 evidence 构建抛(如流不全)→同样跳过并留痕。
    let outputAbsent = true;
    if (fs.existsSync(context.outputPath) && fs.statSync(context.outputPath).size > 0) {
      try {
        const sha256 = await hashFileSha256(context.outputPath);
        const outputStat = fs.statSync(context.outputPath);
        const probe = await probeRenderedMedia(context.outputPath);
        const runEvidence = await buildFullPipelineRunEvidence({
          projectId: context.projectId,
          chapterId: context.chapterId,
          editingProjectId: context.projectedProject.id,
          editingRevision: context.projectedProject.revision,
          mode: context.acceptedArtifact.mode,
          renderInputSha256: context.gateInput.inputSha256,
          videoUseInputSha256: context.acceptedArtifact.evidence.inputSha256,
          bundleContentHash: context.bundleManifest.contentHash,
          templateVersion: context.bundleManifest.templateVersion,
          remotionVersion,
          renderSettings: context.plan.renderSettings,
          expectedDurationS: context.expectedDurationS ?? probe.duration,
          runRoot: context.outputDir,
          outputPath: context.outputPath,
          inputManifestPath,
          renderPlanPath: timelineRenderPlanPath,
          snapshotPath: editingSnapshotPath,
          outputSizeBytes: outputStat.size,
          outputMtimeMs: outputStat.mtimeMs,
          outputSha256: sha256,
          probe,
          startedAt: context.renderStartedAt,
          completedAt: Date.now(),
        });
        writeVideoWorkflowJson(chapterEvidencePath, runEvidence.evidence);
        writeVideoWorkflowJson(finalQcExpectedPath, runEvidence.expected);
        outputAbsent = false;
      } catch (evidenceError) {
        console.error("[full-pipeline] failure sidecar run-evidence skipped:", evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
      }
    }
    // RUN_REVISION 指纹转正(rebuild_chapter_sidecars.ts 的 env 指纹在管线内的等价物):
    // 失败边车绑定 acceptedArtifact.status/stage(阶段 11 产物)与 nextRevision(阶段 8)
    // 身份——无需 env;startedAt 用 renderStartedAt 现值(比 rebuild 的目录 birthtime 估算更真)。
    writeVideoWorkflowJson(failureReceiptPath, {
      schemaVersion: 1,
      triggerError: context.triggerError instanceof Error ? context.triggerError.message : String(context.triggerError),
      degraded: true,
      writtenAt: new Date().toISOString(),
      nextRevision: context.nextRevision,
      videoUseStatus: context.acceptedArtifact.status,
      videoUseStage: context.acceptedArtifact.stage,
      ...(outputAbsent ? { outputAbsent: true } : {}),
      sidecars: { inputManifestPath, timelineRenderPlanPath, editingSnapshotPath, chapterEvidencePath, finalQcExpectedPath },
    });
    console.error(`[full-pipeline] failure sidecars written: ${failureReceiptPath}${outputAbsent ? " (outputAbsent)" : ""}`);
  } catch (sidecarError) {
    // 内层自护:只留痕,不掩盖原始错误。
    console.error("[full-pipeline] writeFailureSidecars failed:", sidecarError instanceof Error ? sidecarError.message : String(sidecarError));
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
