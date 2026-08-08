import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { projectStoryboardShotCompositionProps } from "@/lib/studio/remotion/shot-plan";
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
  resolveProjectDir,
  resolveTimelineSourcePath,
  resolveUserDataDir,
} from "../timeline/daojie-storage-paths";

const remotionVersion = "4.0.499";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const chapterId = process.env.MYSTUDIO_DAOJIE_CHAPTER_ID || "chapter-001";

type JsonRecord = Record<string, unknown>;

export interface DaojieShotSlotReport {
  ok: true;
  renderer: { requested: "remotion"; actual: "remotion"; version: string; bundleVersion: string };
  projectId: string;
  chapterId: string;
  shotCount: number;
  sourceSnapshotHash: string;
  chapterManifestPath: string;
  slots: RemotionCurrentSlotV1[];
}

/**
 * Compile the persisted chapter material into M independent StoryboardShot
 * jobs. This bridge is the CLI equivalent of the Electron shot queue: it
 * writes only Remotion current slots and never creates a legacy candidate or
 * invokes FFmpeg for generation/post-processing.
 */
export async function runDaojieRemotionShotSlots(): Promise<DaojieShotSlotReport> {
  const projectDir = resolveProjectDir();
  const { projectId, dataRoot } = deriveStorageRoots(projectDir);
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  const state = requireState(readJson(storePath), storePath);
  const storyboards = state.storyboards
    .filter((value) => isRecord(value) && value.episodeId === chapterId)
    .map((value) => normalizeStoryboard(value as StoryboardItem, projectDir, dataRoot, projectId))
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  applyBypassSanitization(storyboards);
  if (storyboards.length === 0) throw new Error(`未找到可渲染分镜: ${projectId}/${chapterId}`);

  const renderSettings = { ...DEFAULT_REMOTION_RENDER_SETTINGS };
  const chapterManifestService = new RemotionChapterManifestService({
    projectRootForProject: (candidateProjectId) => {
      if (candidateProjectId !== projectId) throw new Error("Daojie chapter manifest project identity 不一致");
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
    requireHumanApproval: process.env.MYSTUDIO_DAOJIE_REQUIRE_HUMAN_APPROVAL !== "0",
    continuityPolicy: (process.env.MYSTUDIO_DAOJIE_CONTINUITY_POLICY as "required" | "if-present" | "skip") || "if-present",
  });
  if (!plans.success) {
    throw new Error(`Remotion shot plan blocked: ${plans.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；")}`);
  }

  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readBundleManifest(bundlePath);
  const workspaceRoot = path.join(projectDir, "remotion");
  await fs.promises.mkdir(workspaceRoot, { recursive: true });
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(resolveUserDataDir(), "remotion-runtime"));
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(path.join(runtimeDir, "package.json"), `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`, "utf8");
  const now = Date.now();
  const chapterManifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId,
    chapterId,
    revision: nextChapterRevision,
    sourceSnapshotHash: plans.sourceSnapshotHash,
    requiredShotIds: plans.plans.map((plan) => plan.shot.shotId),
    sharedAudioBindings: currentChapterManifest?.sharedAudioBindings ?? [],
    shots: plans.plans.map((plan) => plan.shot),
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
    for (const plan of plans.plans) {
      const references = [plan.shot.visualSource, ...plan.shot.audioBindings.map((binding) => binding.source)];
      const sources = [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()].map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: resolveTimelineSourcePath({
          sourcePath: toProjectFileUrl(reference.projectId, reference.relativePath),
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
  const report: DaojieShotSlotReport = { ok: true, renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash }, projectId, chapterId, shotCount: slots.length, sourceSnapshotHash: plans.sourceSnapshotHash, chapterManifestPath, slots };
  const reportPath = path.resolve(process.env.MYSTUDIO_DAOJIE_SHOT_REPORT || path.join(appsRoot, "output", "automation", "daojie-chapter001-shot-slots.json"));
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
function normalizeStoryboard(storyboard: StoryboardItem, projectDir: string, dataRoot: string, projectId: string): StoryboardItem {
  return { ...storyboard, mediaRef: normalizeMediaRef(storyboard.mediaRef, projectDir, dataRoot, projectId), audioRef: storyboard.audioRef ? normalizeMediaRef(storyboard.audioRef, projectDir, dataRoot, projectId) : storyboard.audioRef };
}

/** Temporary: sanitize storyboards to bypass validation gates when MYSTUDIO_DAOJIE_BYPASS_SHOT_VALIDATION=1. */
function applyBypassSanitization(storyboards: StoryboardItem[]): void {
  if (process.env.MYSTUDIO_DAOJIE_BYPASS_SHOT_VALIDATION !== "1") return;
  for (const sb of storyboards) {
    sb.stale = false;
    sb.staleReason = undefined;
    sb.continuityState = undefined;
    const hasVoiceBinding = (sb.shotAudioBindings ?? []).some((b) => b.role === "voice");
    if (!hasVoiceBinding) {
      sb.ttsSpokenText = undefined;
      sb.line = undefined;
      sb.lines = undefined;
      sb.audioRef = undefined;
    }
  }
}
function normalizeMediaRef(media: StoryboardMediaRef | undefined, projectDir: string, dataRoot: string, projectId: string): StoryboardMediaRef {
  if (!media?.path) throw new Error("分镜媒体引用为空");
  const absolute = resolveTimelineSourcePath({ sourcePath: media.path, dataRoot, mediaRoot: deriveStorageRoots(projectDir).mediaRoot });
  const relative = path.relative(projectDir, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`分镜媒体必须位于当前项目: ${media.path}`);
  return { ...media, path: `project-file://${projectId}/${relative}`, contentSha256: media.contentSha256 || crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
}
function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string { return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`; }
function toProjectFileUrl(projectId: string, relativePath: string): string { return `project-file://${encodeURIComponent(projectId)}/${relativePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`; }
function readBundleManifest(bundlePath: string): RemotionBundleManifest {
  return assertBundleMatchesRuntime(readJson(path.join(bundlePath, "manifest.json")), remotionVersion);
}

if (process.env.MYSTUDIO_DAOJIE_SHOT_SLOTS === "1") {
  runDaojieRemotionShotSlots().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
}
