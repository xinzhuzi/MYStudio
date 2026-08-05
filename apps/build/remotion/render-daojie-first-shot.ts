import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import {
  validateStoryboardShotCompositionProps,
} from "@rendering/plugins/remotion/composition/composition-props-validation";
import type { StoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props";
import {
  createRemotionEnsureBrowserAdapters,
  type RemotionEnsureBrowser,
} from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  measureRenderedMediaLoudness,
  probeRenderedMedia,
} from "./render-smoke-evidence";

const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const remotionVersion = "4.0.499";
const projectId = "49dce4c1-64b1-42de-85c2-9f266698aec0";
const chapterId = "chapter-001";
const shotId = "sb-chapter-001-001";
const shotIndex = 1;
const durationTarget = 4.2;
const fps = 30;
const width = 1080;
const height = 1920;
const projectRoot = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0";
const runtimeDir = "/Users/zhengbingjin/Library/Application Support/漫影工作室/remotion-runtime";
const sourceStorePath = path.join(projectRoot, "studio-workflow-store.json");
const scriptPath = path.join(projectRoot, "script.json");
const imagePath = path.join(projectRoot, "exports/chapter-001/toonflow_frames/shot-001.png");
const audioPath = path.join(projectRoot, "exports/chapter-001/toonflow_audio/shot-001.wav");
const bundlePath = path.join(appsRoot, ".cache", "remotion-bundle");
const outputRoot = path.join(appsRoot, "output", "automation", "remotion-daojie-chapter001-shot001");
const outputPath = path.join(outputRoot, "output.mp4");
const sourceSnapshotPath = path.join(outputRoot, "source-snapshot.json");
const ffprobePath = path.join(outputRoot, "ffprobe.json");
const loudnessLogPath = path.join(outputRoot, "loudness-measurement.log");
const loudnessReportPath = path.join(outputRoot, "loudness-measurement.json");
const reportPath = path.join(outputRoot, "report.json");

export interface DaojieFirstShotSource {
  projectId: string;
  chapterId: string;
  shotId: string;
  index: number;
  sourceStorePath: string;
  scriptPath: string;
  sourceStoreSha256: string;
  scriptSha256: string;
  imagePath: string;
  imageSha256: string;
  audioPath: string;
  audioSha256: string;
  subtitle: string;
  prompt: string;
  durationTarget: number;
  state: string;
  stale: true;
  staleReason: string;
  visualReview: Record<string, unknown>;
}

export interface FirstShotMediaUrls {
  visual: string;
  voice: string;
}

export interface DaojieFirstShotReport {
  ok: true;
  generatedAt: string;
  verificationAt: string;
  renderStartedAt: string;
  renderCompletedAt: string;
  projectWriteback: false;
  source: DaojieFirstShotSource;
  gate: {
    state: string;
    stale: true;
    staleReason: string;
    visualReview: Record<string, unknown>;
  };
  renderer: {
    requested: "remotion";
    actual: "remotion";
    version: string;
    bundleVersion: string;
  };
  compositionId: typeof STORYBOARD_SHOT_COMPOSITION_ID;
  bundle: {
    manifestPath: string;
    manifestMtimeMs: number;
    schemaVersion: number;
    templateId: string;
    templateVersion: string;
    remotionVersion: string;
    compositionIds: string[];
    compositionId: string;
    contentHash: string;
  };
  outputPath: string;
  reportPath: string;
  sourceSnapshotPath: string;
  ffprobePath: string;
  duration: number;
  expectedDuration: number;
  width: number;
  height: number;
  fps: number;
  streams: string[];
  codecs: { video: string; audio: string };
  sha256: string;
  outputSizeBytes: number;
  outputMtimeMs: number;
  ffprobeMtimeMs: number;
  loudnessReportMtimeMs: number;
  loudnessMeasurement: Awaited<ReturnType<typeof measureRenderedMediaLoudness>>;
}

export async function loadFirstShotSource(): Promise<DaojieFirstShotSource> {
  const [store, script] = await Promise.all([
    readJsonRecord(sourceStorePath),
    readJsonRecord(scriptPath),
  ]);
  const state = requireRecord(store.state, `${sourceStorePath}.state`);
  const storyboards = requireArray(state.storyboards, `${sourceStorePath}.state.storyboards`);
  const storyboard = storyboards.find((value) => isRecord(value) && value.id === shotId);
  if (!isRecord(storyboard)) throw new Error(`未找到首镜 storyboard: ${projectId}/${chapterId}/${shotId}`);
  const shots = requireArray(script.shots, `${scriptPath}.shots`);
  const shot = shots.find((value) => isRecord(value) && value.id === shotId);
  if (!isRecord(shot)) throw new Error(`未找到首镜 script shot: ${projectId}/${chapterId}/${shotId}`);

  assertIdentity(storyboard, "storyboard");
  assertIdentity(shot, "script shot");
  if (storyboard.state !== "ready" || shot.state !== "ready") {
    throw new Error("首镜必须处于 ready 状态才能生成预览");
  }
  if (storyboard.stale !== true) throw new Error("首镜 stale 状态已变化，拒绝使用非当前预览输入");
  const visualReview = requireRecord(storyboard.visualReview, "storyboard.visualReview");
  if (visualReview.status !== "pending") throw new Error("首镜 visualReview 状态已变化，拒绝使用非当前预览输入");

  const persistedImagePath = requireString(requireRecord(storyboard.mediaRef, "storyboard.mediaRef").path, "storyboard.mediaRef.path");
  const persistedAudioPath = requireString(requireRecord(shot.audioRef, "script shot.audioRef").path, "script shot.audioRef.path");
  if (persistedImagePath !== imagePath || persistedAudioPath !== audioPath) {
    throw new Error("首镜媒体路径不是锁定的 shot-001.png/shot-001.wav");
  }
  const prompt = requireString(shot.prompt, "script shot.prompt");
  if (prompt !== requireString(storyboard.prompt, "storyboard.prompt")) throw new Error("首镜 prompt 在 store/script 中不一致");
  const subtitle = requireString(shot.ttsSpokenText, "script shot.ttsSpokenText");
  if (subtitle !== requireString(shot.line, "script shot.line")) throw new Error("首镜字幕在 script.json 中不一致");
  if (subtitle !== requireString(storyboard.ttsSpokenText, "storyboard.ttsSpokenText")) throw new Error("首镜字幕在 store/script 中不一致");
  if (requireNumber(shot.durationTarget, "script shot.durationTarget") !== durationTarget) throw new Error("首镜 durationTarget 不是 4.2 秒");
  if (requireNumber(storyboard.durationTarget, "storyboard.durationTarget") !== durationTarget) throw new Error("store 首镜 durationTarget 不是 4.2 秒");

  for (const [label, filePath] of [["图像", imagePath], ["旁白", audioPath]] as const) {
    const stat = await fs.promises.stat(filePath).catch(() => undefined);
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`首镜${label}不存在或为空: ${filePath}`);
  }
  const [sourceStoreSha256, scriptSha256, imageSha256, audioSha256] = await Promise.all([
    hashFileSha256(sourceStorePath),
    hashFileSha256(scriptPath),
    hashFileSha256(imagePath),
    hashFileSha256(audioPath),
  ]);
  return {
    projectId,
    chapterId,
    shotId,
    index: shotIndex,
    sourceStorePath,
    scriptPath,
    sourceStoreSha256,
    scriptSha256,
    imagePath,
    imageSha256,
    audioPath,
    audioSha256,
    subtitle,
    prompt,
    durationTarget,
    state: "ready",
    stale: true,
    staleReason: requireString(storyboard.staleReason, "storyboard.staleReason"),
    visualReview,
  };
}

export function buildFirstShotCompositionProps(
  source: DaojieFirstShotSource,
  mediaUrls: FirstShotMediaUrls,
): StoryboardShotCompositionProps {
  const durationInFrames = Math.round(source.durationTarget * fps);
  const props: StoryboardShotCompositionProps = {
    target: "shot",
    projectId: source.projectId,
    chapterId: source.chapterId,
    shotId: source.shotId,
    shotRevision: 1,
    width,
    height,
    fps,
    durationInFrames,
    visualClips: [{
      clipId: source.shotId,
      kind: "image",
      src: mediaUrls.visual,
      from: 0,
      durationInFrames,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }],
    transitions: [],
    audioClips: [{
      clipId: `voice:${source.shotId}`,
      kind: "voice",
      src: mediaUrls.voice,
      from: 0,
      durationInFrames,
      volume: 1,
      renderScope: "shot",
    }],
    subtitles: [{
      cueId: `${source.shotId}:subtitle`,
      text: source.subtitle,
      from: 0,
      durationInFrames,
    }],
  };
  const validation = validateStoryboardShotCompositionProps(props);
  if (!validation.success) {
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return validation.value;
}

export async function runDaojieFirstShot(): Promise<DaojieFirstShotReport> {
  const source = await loadFirstShotSource();
  await fs.promises.mkdir(outputRoot, { recursive: true });
  await fs.promises.writeFile(sourceSnapshotPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...source,
    projectWriteback: false,
  }, null, 2)}\n`, "utf8");
  const bundle = readBundleManifest();
  const runtimeStat = await fs.promises.stat(runtimeDir).catch(() => undefined);
  if (!runtimeStat?.isDirectory()) throw new Error(`Remotion runtime 目录不存在: ${runtimeDir}`);
  const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
  const compositorPackage = path.join(binariesDirectory, "package.json");
  if (!(await fs.promises.stat(compositorPackage).catch(() => undefined))?.isFile()) {
    throw new Error(`Remotion compositor 不存在: ${compositorPackage}`);
  }

  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  const bridge = new MediaBridgeServer();
  let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
  try {
    const browser = await createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser)
      .probe.ensureBrowser({ onDownload: () => { throw new Error("首镜预览禁止下载 Headless Shell"); } });
    if (!browser.executablePath || !path.isAbsolute(browser.executablePath)) throw new Error("Headless Shell executable path 无效");
    const browserStat = await fs.promises.stat(browser.executablePath).catch(() => undefined);
    if (!browserStat?.isFile()) throw new Error(`Headless Shell executable 不存在: ${browser.executablePath}`);
    await fs.promises.access(browser.executablePath, fs.constants.X_OK);

    await bridge.listen();
    session = bridge.createSession();
    const urls = buildMediaUrlMap(bridge, session, [
      { clipId: `visual:${source.shotId}`, absolutePath: source.imagePath },
      { clipId: `voice:${source.shotId}`, absolutePath: source.audioPath },
    ]);
    const props = buildFirstShotCompositionProps(source, {
      visual: urls[`visual:${source.shotId}`]!,
      voice: urls[`voice:${source.shotId}`]!,
    });
    const renderStartedAt = new Date().toISOString();
    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: STORYBOARD_SHOT_COMPOSITION_ID,
      inputProps: props,
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      onBrowserDownload: () => { throw new Error("首镜预览 selectComposition 禁止下载 Headless Shell"); },
    });
    await renderMedia({
      serveUrl: bundlePath,
      composition,
      inputProps: props,
      outputLocation: outputPath,
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      enforceAudioTrack: true,
      overwrite: true,
      onBrowserDownload: () => { throw new Error("首镜预览 renderMedia 禁止下载 Headless Shell"); },
    });
    const renderCompletedAt = new Date().toISOString();
    const outputStat = await fs.promises.stat(outputPath).catch(() => undefined);
    if (!outputStat?.isFile() || outputStat.size <= 0) throw new Error(`首镜 MP4 不存在或为空: ${outputPath}`);
    const probe = await probeRenderedMedia(outputPath);
    assertRenderedMediaEvidence({
      label: `StoryboardShot ${source.shotId}`,
      probe,
      expectedDuration: durationTarget,
      fps,
      width,
      height,
    });
    await fs.promises.writeFile(ffprobePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
    const ffprobeStat = await fs.promises.stat(ffprobePath);
    const loudnessMeasurement = await measureRenderedMediaLoudness({
      filePath: outputPath,
      rawLogPath: loudnessLogPath,
      reportPath: loudnessReportPath,
    });
    const loudnessReportStat = await fs.promises.stat(loudnessReportPath);
    const outputSha256 = await hashFileSha256(outputPath);
    const generatedAt = new Date().toISOString();
    const verificationAt = new Date().toISOString();
    const report: DaojieFirstShotReport = {
      ok: true,
      generatedAt,
      verificationAt,
      renderStartedAt,
      renderCompletedAt,
      projectWriteback: false,
      source,
      gate: {
        state: source.state,
        stale: true,
        staleReason: source.staleReason,
        visualReview: source.visualReview,
      },
      renderer: {
        requested: "remotion",
        actual: "remotion",
        version: remotionVersion,
        bundleVersion: bundle.contentHash,
      },
      compositionId: STORYBOARD_SHOT_COMPOSITION_ID,
      bundle,
      outputPath,
      reportPath,
      sourceSnapshotPath,
      ffprobePath,
      duration: probe.duration,
      expectedDuration: durationTarget,
      width: probe.width,
      height: probe.height,
      fps,
      streams: probe.streams,
      codecs: { video: probe.videoCodec, audio: probe.audioCodec },
      sha256: outputSha256,
      outputSizeBytes: outputStat.size,
      outputMtimeMs: outputStat.mtimeMs,
      ffprobeMtimeMs: ffprobeStat.mtimeMs,
      loudnessReportMtimeMs: loudnessReportStat.mtimeMs,
      loudnessMeasurement,
    };
    await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    if (session) await bridge.revokeSession(session).catch(() => undefined);
    else await bridge.close().catch(() => undefined);
    process.chdir(previousCwd);
  }
}

function readBundleManifest(): DaojieFirstShotReport["bundle"] {
  const manifestPath = path.join(bundlePath, "manifest.json");
  const manifestStat = fs.statSync(manifestPath);
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const compositionIds = Array.isArray(value.compositionIds)
    ? value.compositionIds.filter((item): item is string => typeof item === "string")
    : [];
  if (value.schemaVersion !== 2 || value.templateId !== "mystudio-remotion-v1" || value.templateVersion !== "1.0.0"
    || value.remotionVersion !== remotionVersion || value.compositionId !== "DaojieTimeline"
    || !["StoryboardShot", "ChapterVideo", "DaojieTimeline"].every((id) => compositionIds.includes(id))
    || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error("Remotion bundle manifest 与固定首镜预览合同不一致");
  }
  return {
    manifestPath,
    manifestMtimeMs: manifestStat.mtimeMs,
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion,
    compositionIds,
    compositionId: "DaojieTimeline",
    contentHash: value.contentHash,
  };
}

function assertIdentity(value: Record<string, unknown>, label: string): void {
  if (value.episodeId !== chapterId || value.id !== shotId || value.index !== shotIndex) {
    throw new Error(`${label} 身份不匹配: 需要 ${chapterId}/${shotId}/index=${shotIndex}`);
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
  return requireRecord(value, filePath);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.env.MYSTUDIO_DAOJIE_FIRST_SHOT === "1") {
  runDaojieFirstShot()
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
