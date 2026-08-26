import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import os from "node:os";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { projectStoryboardShotCompositionProps } from "@/lib/studio/remotion/shot-plan";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import {
  buildRemotionCurrentSlot,
  remotionCurrentSlotPaths,
} from "@/lib/studio/remotion/remotion-current-slot";
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionMediaProbeStreamV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";
import type { StoryboardItem, StoryboardMediaRef } from "@/types/studio";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { assertBundleMatchesRuntime, type RemotionBundleManifest } from "@rendering/plugins/remotion/render/bundle-manifest";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { publishCurrentSlot } from "@rendering/plugins/remotion/renderer/remotion-shot-renderer";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  probeRenderedMedia,
} from "./render-smoke-evidence";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
  resolveTimelineSourcePath,
  resolveUserDataDir,
} from "../timeline/storage-paths";

const remotionVersion = "4.0.499";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const chapterId = process.env.MYSTUDIO_CHAPTER_ID || "chapter-001";

type JsonRecord = Record<string, unknown>;

export interface ShotSlotReport {
  ok: true;
  renderer: { requested: "remotion"; actual: "remotion"; version: string; bundleVersion: string };
  projectId: string;
  chapterId: string;
  shotCount: number;
  sourceSnapshotHash: string;
  chapterManifestPath: string;
  slots: RemotionCurrentSlotV1[];
  /** MYSTUDIO_INKWASH_LAYER=1 时的帧源替换证据（S4 试点）：缺省为空数组。 */
  sourceSwaps?: Array<{ storyboardId: string; from: string; to: string }>;
}

export function selectShotIdsForRun(
  availableShotIds: readonly string[],
  rawShotIds: string | undefined,
): string[] {
  if (rawShotIds === undefined) return [...availableShotIds];
  const requested = rawShotIds.split(",").map((value) => value.trim());
  if (requested.length === 0 || requested.some((value) => value.length === 0)) {
    throw new Error("MYSTUDIO_SHOT_IDS 必须是逗号分隔的非空 shot ID");
  }
  if (new Set(requested).size !== requested.length) {
    throw new Error("MYSTUDIO_SHOT_IDS 不得包含重复 shot ID");
  }
  const available = new Set(availableShotIds);
  const unknown = requested.filter((shotId) => !available.has(shotId));
  if (unknown.length > 0) {
    throw new Error(`MYSTUDIO_SHOT_IDS 包含当前章节不存在的 shot: ${unknown.join(", ")}`);
  }
  const selected = new Set(requested);
  return availableShotIds.filter((shotId) => selected.has(shotId));
}

export function selectPlanIssuesForShotIds<T extends { path: string }>(
  issues: readonly T[],
  shotIds: readonly string[],
): T[] {
  const shotPrefixes = shotIds.map((shotId) => `shots.${shotId}.`);
  return issues.filter((issue) => (
    !issue.path.startsWith("shots.")
    || shotPrefixes.some((prefix) => issue.path.startsWith(prefix))
  ));
}

export function mergeSelectedShotDefinitions<T extends { shotId: string }>(input: {
  availableShotIds: readonly string[];
  selectedShots: readonly T[];
  currentShots: readonly T[];
  scoped: boolean;
}): T[] {
  if (!input.scoped) return [...input.selectedShots];
  const selectedById = new Map(input.selectedShots.map((shot) => [shot.shotId, shot]));
  const currentById = new Map(input.currentShots.map((shot) => [shot.shotId, shot]));
  return input.availableShotIds.map((shotId) => {
    const selected = selectedById.get(shotId);
    if (selected) return selected;
    const current = currentById.get(shotId);
    if (!current) throw new Error(`定点渲染缺少未选镜头的现有 manifest: ${shotId}`);
    return current;
  });
}

/**
 * Compile the persisted chapter material into M independent StoryboardShot
 * jobs. This bridge is the CLI equivalent of the Electron shot queue: it
 * writes only Remotion current slots and never creates a legacy candidate or
 * invokes FFmpeg for generation/post-processing.
 */
export async function runRemotionShotSlots(): Promise<ShotSlotReport> {
  const projectDir = resolveProjectDir();
  const { projectId, dataRoot } = deriveStorageRoots(projectDir);
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  const storeSnapshot = readStudioWorkflowStoreState(projectDir);
  if (!storeSnapshot) throw new Error(`studio-workflow store 不存在（分片/单文件均缺失）: ${storePath}`);
  // requireState 校验信封形状 {state:{storyboards[]}}——必须传整个快照,
  // 传 .state 会变双层读取恒败(分片 reader 契约回归,2026-08-26 实证)
  const state = requireState(storeSnapshot, storePath);
  const storyboards = state.storyboards
    .filter((value) => isRecord(value) && value.episodeId === chapterId)
    .map((value) => normalizeStoryboard(value as StoryboardItem, projectDir, dataRoot, projectId))
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  if (storyboards.length === 0) throw new Error(`未找到可渲染分镜: ${projectId}/${chapterId}`);
  const selectedShotIds = selectShotIdsForRun(
    storyboards.map((storyboard) => storyboard.id),
    process.env.MYSTUDIO_SHOT_IDS,
  );
  const selectedShotIdSet = new Set(selectedShotIds);

  const renderSettings = { ...DEFAULT_REMOTION_RENDER_SETTINGS };
  const chapterManifestService = new RemotionChapterManifestService({
    projectRootForProject: (candidateProjectId) => {
      if (candidateProjectId !== projectId) throw new Error("Chapter manifest project identity 不一致");
      return projectDir;
    },
    probeMedia: async (filePath) => {
      const probe = await probeRenderedMedia(filePath);
      return {
        durationUs: Math.round(probe.duration * 1_000_000),
        streams: probe.streams,
      };
    },
  });
  const currentChapterManifest = await chapterManifestService.read(projectId, chapterId);
  const nextChapterRevision = (currentChapterManifest?.revision ?? 0) + 1;
  const plans = await buildRemotionShotPlans({
    projectId,
    chapterId,
    chapterRevision: nextChapterRevision,
    renderSettings,
    storyboards,
    requireHumanApproval: process.env.MYSTUDIO_REQUIRE_HUMAN_APPROVAL !== "0",
    continuityPolicy: (process.env.MYSTUDIO_CONTINUITY_POLICY as "required" | "if-present" | "skip") || "if-present",
  });
  const selectedBlockedShotIds = plans.success
    ? []
    : plans.blockedShotIds.filter((shotId) => selectedShotIdSet.has(shotId));
  if ((!plans.success && process.env.MYSTUDIO_SHOT_IDS === undefined)
    || selectedBlockedShotIds.length > 0) {
    const reportedIssues = process.env.MYSTUDIO_SHOT_IDS === undefined
      ? plans.issues
      : selectPlanIssuesForShotIds(plans.issues, selectedShotIds);
    throw new Error(`Remotion shot plan blocked: ${reportedIssues.map((issue) => `${issue.path}: ${issue.message}`).join("；")}`);
  }
  const selectedPlans = plans.plans.filter((plan) => selectedShotIdSet.has(plan.shot.shotId));
  if (selectedPlans.length !== selectedShotIds.length) {
    throw new Error(`定点渲染计划不完整: expected=${selectedShotIds.length} actual=${selectedPlans.length}`);
  }

  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readBundleManifest(bundlePath);
  const workspaceRoot = path.join(projectDir, "remotion");
  await fs.promises.mkdir(workspaceRoot, { recursive: true });
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(resolveUserDataDir(), "remotion-runtime"));
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(path.join(runtimeDir, "package.json"), `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`, "utf8");
  const now = Date.now();
  const manifestShots = mergeSelectedShotDefinitions({
    availableShotIds: storyboards.map((storyboard) => storyboard.id),
    selectedShots: selectedPlans.map((plan) => plan.shot),
    currentShots: currentChapterManifest?.shots ?? [],
    scoped: process.env.MYSTUDIO_SHOT_IDS !== undefined,
  });
  const chapterManifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId,
    chapterId,
    revision: nextChapterRevision,
    sourceSnapshotHash: plans.sourceSnapshotHash,
    requiredShotIds: storyboards.map((storyboard) => storyboard.id),
    sharedAudioBindings: currentChapterManifest?.sharedAudioBindings ?? [],
    shots: manifestShots,
    renderSettings,
    createdAt: currentChapterManifest?.createdAt ?? now,
    updatedAt: now,
  };
  chapterManifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(chapterManifest);
  const chapterManifestPath = path.join(workspaceRoot, "chapters", `${chapterId}.json`);
  await chapterManifestService.writeCas({
    projectId,
    chapterId,
    expectedRevision: currentChapterManifest?.revision ?? 0,
    manifest: chapterManifest,
  });

  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  const bridge = new MediaBridgeServer();
  await bridge.listen();
  const session = bridge.createSession();
  const slots: RemotionCurrentSlotV1[] = [];
  try {
    const browser = await createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser)
      .probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); } });
    const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
    for (const plan of selectedPlans) {
      const references = [plan.shot.visualSource, ...plan.shot.audioBindings.map((binding) => binding.source)];
      const sources = [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()].map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: resolveTimelineSourcePath({
          sourcePath: buildProjectFileUrl(reference.projectId, reference.relativePath),
          dataRoot,
          mediaRoot: deriveStorageRoots(projectDir).mediaRoot,
        }),
      }));
      const urls = buildMediaUrlMap(bridge, session, sources);
      const props = projectStoryboardShotCompositionProps(plan, (reference) => {
        const url = urls[referenceKey(reference)];
        if (!url) throw new Error(`shot capability 缺失: ${reference.relativePath}`);
        return url;
      });
      if (!props.success) throw new Error(props.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      const target = { kind: "shot" as const, chapterId, shotId: plan.shot.shotId, shotRevision: plan.shot.revision };
      const renderSettingsHash = await sha256CanonicalJson(renderSettings);
      const identity = { projectId, target, inputHash: plan.inputHash, bundleContentHash: manifest.contentHash, renderSettingsHash };
      const jobId = await createRemotionRenderJobId(identity);
      const stagingDir = path.join(workspaceRoot, "staging", crypto.randomUUID());
      const stagedOutputPath = path.join(stagingDir, "output.mp4");
      await fs.promises.mkdir(stagingDir, { recursive: true });
      const composition = await selectComposition({ serveUrl: bundlePath, id: STORYBOARD_SHOT_COMPOSITION_ID, inputProps: props.value, browserExecutable: browser.executablePath, binariesDirectory, chromeMode: "headless-shell", onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } });
      await renderMedia({ serveUrl: bundlePath, composition, inputProps: props.value, outputLocation: stagedOutputPath, codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac", browserExecutable: browser.executablePath, binariesDirectory, chromeMode: "headless-shell", enforceAudioTrack: true, overwrite: true, onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } });
      const probe = await probeRenderedMedia(stagedOutputPath);
      assertRenderedMediaEvidence({ label: `StoryboardShot ${plan.shot.shotId}`, probe, expectedDuration: composition.durationInFrames / composition.fps, fps: renderSettings.fps, width: renderSettings.width, height: renderSettings.height });
      const stat = await fs.promises.stat(stagedOutputPath);
      const paths = remotionCurrentSlotPaths(target);
      const now = Date.now();
      const evidence: RemotionEvidenceV1 = {
        schemaVersion: 1, ...identity, jobId, templateVersion: manifest.templateVersion, remotionVersion,
        attempt: 1, compositionId: STORYBOARD_SHOT_COMPOSITION_ID,
        renderer: { requested: "remotion", actual: "remotion" }, outputPath: paths.outputPath,
        sizeBytes: stat.size, mtimeMs: Math.floor(stat.mtimeMs), sha256: await hashFileSha256(stagedOutputPath),
        width: probe.width, height: probe.height, durationUs: Math.round(probe.duration * 1_000_000), streams: toRemotionEvidenceStreams(probe),
        inputManifestPath: `chapters/${chapterId}.json`, startedAt: now, completedAt: now,
      };
      const job: RemotionRenderJobV1 = {
        schemaVersion: 1, ...identity, jobId, templateVersion: manifest.templateVersion, remotionVersion,
        status: "succeeded", attempt: 1, progress: 1, createdAt: now, startedAt: now, completedAt: now,
        outputPath: paths.outputPath, evidencePath: paths.evidencePath,
      };
      const slot = buildRemotionCurrentSlot(projectId, target, job, evidence, now);
      await publishCurrentSlot(workspaceRoot, stagingDir, stagedOutputPath, slot);
      slots.push(slot);
    }
  } finally {
    await bridge.revokeSession(session).catch(() => undefined);
    await bridge.close().catch(() => undefined);
    process.chdir(previousCwd);
  }
  const report: ShotSlotReport = { ok: true, renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash }, projectId, chapterId, shotCount: slots.length, sourceSnapshotHash: plans.sourceSnapshotHash, chapterManifestPath, slots , sourceSwaps: inkwashSourceSwaps };
  const reportPath = path.resolve(process.env.MYSTUDIO_SHOT_REPORT || path.join(appsRoot, "output", "automation", "chapter001-shot-slots.json"));
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function readJson(filePath: string): unknown { return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown; }

function toRemotionEvidenceStreams(probe: Awaited<ReturnType<typeof probeRenderedMedia>>): RemotionMediaProbeStreamV1[] {
  if (probe.videoCodec !== "h264" || probe.audioCodec !== "aac") {
    throw new Error(`StoryboardShot 输出编解码器不符合 Remotion 合同: ${probe.videoCodec}/${probe.audioCodec}`);
  }
  const rawStreams = probe.raw.streams ?? [];
  const video = rawStreams.find((stream) => stream.codec_type === "video");
  const audio = rawStreams.find((stream) => stream.codec_type === "audio");
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);
  const channels = Number(audio?.channels ?? 0);
  const sampleRate = Number(audio?.sample_rate ?? 0);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("StoryboardShot ffprobe 缺少有效视频尺寸");
  }
  if (!Number.isSafeInteger(channels) || channels <= 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("StoryboardShot ffprobe 缺少有效音频声道或采样率");
  }
  return [
    { kind: "video", codec: "h264", width, height },
    { kind: "audio", codec: "aac", channels, sampleRate },
  ];
}

function requireState(value: unknown, source: string): JsonRecord & { storyboards: unknown[] } {
  if (!isRecord(value) || !isRecord(value.state) || !Array.isArray(value.state.storyboards)) throw new Error(`${source} 缺少 state.storyboards`);
  return value.state as JsonRecord & { storyboards: unknown[] };
}
function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
const inkwashSourceSwaps: Array<{ storyboardId: string; from: string; to: string }> = [];

/**
 * S4 水墨像素层试点：MYSTUDIO_INKWASH_LAYER=1 时把分镜帧源替换为预处理帧。
 * 替换必须显式留痕（swaps 进报告 + 控制台日志），且帧必须位于项目目录内
 * （normalizeMediaRef 的媒体边界校验会拒绝项目外路径）。
 */
function resolveInkwashFrame(storyboard: StoryboardItem): string | undefined {
  if (process.env.MYSTUDIO_INKWASH_LAYER !== "1") return undefined;
  const framesDir = process.env.MYSTUDIO_INKWASH_FRAMES_DIR?.trim();
  if (!framesDir) throw new Error("MYSTUDIO_INKWASH_LAYER=1 需要同时设置 MYSTUDIO_INKWASH_FRAMES_DIR（预处理帧目录）");
  const match = /-([0-9]{3})$/.exec(storyboard.id);
  if (!match) return undefined;
  const frame = path.join(framesDir, `shot-${match[1]}.png`);
  if (!fs.existsSync(frame)) throw new Error(`水墨试点帧缺失: ${frame}`);
  return frame;
}

function normalizeStoryboard(storyboard: StoryboardItem, projectDir: string, dataRoot: string, projectId: string): StoryboardItem {
  const inkwashFrame = resolveInkwashFrame(storyboard);
  if (inkwashFrame && storyboard.mediaRef?.path) {
    inkwashSourceSwaps.push({ storyboardId: storyboard.id, from: storyboard.mediaRef.path, to: inkwashFrame });
    console.log(`[inkwash] sourceSwap ${storyboard.id} -> ${inkwashFrame}`);
  }
  const media = inkwashFrame && storyboard.mediaRef
    ? { ...storyboard.mediaRef, path: inkwashFrame, contentSha256: undefined }
    : storyboard.mediaRef;
  return { ...storyboard, mediaRef: normalizeMediaRef(media, projectDir, dataRoot, projectId), audioRef: storyboard.audioRef ? normalizeMediaRef(storyboard.audioRef, projectDir, dataRoot, projectId) : storyboard.audioRef };
}

function normalizeMediaRef(media: StoryboardMediaRef | undefined, projectDir: string, dataRoot: string, projectId: string): StoryboardMediaRef {
  if (!media?.path) throw new Error("分镜媒体引用为空");
  const absolute = resolveTimelineSourcePath({ sourcePath: media.path, dataRoot, mediaRoot: deriveStorageRoots(projectDir).mediaRoot });
  const relative = path.relative(projectDir, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`分镜媒体必须位于当前项目: ${media.path}`);
  return { ...media, path: buildProjectFileUrl(projectId, relative), contentSha256: media.contentSha256 || crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
}
function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string { return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`; }
function readBundleManifest(bundlePath: string): RemotionBundleManifest {
  return assertBundleMatchesRuntime(readJson(path.join(bundlePath, "manifest.json")), remotionVersion);
}

if (process.env.MYSTUDIO_SHOT_SLOTS === "1") {
  runRemotionShotSlots().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
}
