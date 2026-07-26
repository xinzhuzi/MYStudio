import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import type { TimelineRenderClip, TimelineRenderPlan } from "@/types/editing";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { validateCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { buildCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { REMOTION_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { runTimelineAudioPostProcess } from "@rendering/runtime/ffmpeg/timeline-audio-postprocess";
import { layoutVisualTimeline, MICROSECONDS_PER_SECOND } from "@rendering/plugins/remotion/composition/timing";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  measureRenderedMediaLoudness,
  probeRenderedMedia,
  type RenderedMediaLoudnessMeasurement,
} from "./render-smoke-evidence";

const execFileAsync = promisify(execFile);
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const remotionVersion = "4.0.499";

export interface FiveShotReport {
  ok: true;
  generatedAt: string;
  renderer: { requested: "remotion"; actual: "remotion"; version: string; bundleVersion: string };
  audioPostProcess: { engine: "ffmpeg"; loudnessLufs: number; truePeakDbtp: number; logPath: string };
  loudnessMeasurement: RenderedMediaLoudnessMeasurement;
  outputPath: string;
  reportPath: string;
  duration: number;
  expectedDuration: number;
  width: number;
  height: number;
  streams: string[];
  sha256: string;
}

export function buildFiveShotPlan(assetPaths: readonly string[]): TimelineRenderPlan {
  if (assetPaths.length !== 8) throw new Error("five-shot fixture 需要 5 个画面与 3 个音频素材");
  const fps = 30;
  const visualKinds = ["storyboardImage", "storyboardImage", "storyboardVideo", "storyboardImage", "storyboardImage"] as const;
  const visualClips: TimelineRenderClip[] = visualKinds.map((kind, index) => ({
    id: `shot-${index + 1}`,
    trackId: "visual",
    trackKind: kind === "storyboardImage" ? "image" : "video",
    source: { kind, path: assetPaths[index], evidence: { storyboardId: `sb-${index + 1}` } },
    startUs: index * 1_200_000,
    durationUs: 1_200_000,
    trimStartUs: 0,
    speed: index === 1 ? 1.1 : 1,
    volume: 0,
    muted: true,
  }));
  const transitions = [
    transition("shot-1", "shot-2", "fade"),
    transition("shot-2", "shot-3", "crossfade"),
    transition("shot-3", "shot-4", "flash"),
    transition("shot-4", "shot-5", "blackout"),
  ];
  const visualDurationFrames = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    transitions,
    fps,
  ).durationInFrames;
  const visualDurationUs = Math.round((visualDurationFrames / fps) * MICROSECONDS_PER_SECOND);
  const audioClips: TimelineRenderClip[] = [
    audioClip("voice", assetPaths[5]!, 0, visualDurationUs),
    audioClip("bgm", assetPaths[6]!, 0, visualDurationUs),
    audioClip("sfx", assetPaths[7]!, 2_400_000, 1_000_000),
  ];
  const subtitle: TimelineRenderClip = {
    id: "subtitle-1",
    trackId: "subtitle",
    trackKind: "text",
    source: { kind: "text", text: "五镜 Remotion 真实渲染验收", evidence: { sourceFingerprint: "five-shot" } },
    startUs: 200_000,
    durationUs: 2_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  };
  return {
    schemaVersion: 1,
    jobId: "remotion-five-shot",
    projectId: "remotion-fixture",
    episodeId: "fixture-episode",
    editingProjectId: "editing-remotion-fixture",
    editingRevision: 1,
    sourceSnapshotHash: "a".repeat(64),
    editingProjectSnapshot: {} as TimelineRenderPlan["editingProjectSnapshot"],
    renderSettings: {
      width: 1080,
      height: 1920,
      fps,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
      audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
    },
    clips: [...visualClips, ...audioClips, subtitle],
    transitions,
    effects: [{
      id: "pan-zoom-1",
      effectId: "panZoom",
      targetClipId: "shot-1",
      startUs: 0,
      durationUs: 1_200_000,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
      enabled: true,
    }],
    createdAt: Date.now(),
  };
}

export async function runFiveShotSmoke(): Promise<FiveShotReport> {
  const outputRoot = path.resolve(process.env.MYSTUDIO_REMOTION_FIXTURE_DIR || path.join(appsRoot, "output", "automation", "remotion-five-shot"));
  fs.mkdirSync(outputRoot, { recursive: true });
  const assets = await createFixtureAssets(path.join(outputRoot, "assets"));
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readBundleManifest(bundlePath);
  if (manifest.remotionVersion !== remotionVersion || manifest.compositionId !== REMOTION_COMPOSITION_ID) {
    throw new Error("Remotion five-shot bundle manifest 与运行时不一致");
  }
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(os.homedir(), "Library", "Application Support", "漫影工作室", "remotion-runtime"));
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`,
    "utf8",
  );
  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await resolveBrowser();
    const plan = buildFiveShotPlan(assets);
    const mediaBridge = new MediaBridgeServer();
    await mediaBridge.listen();
    const session = mediaBridge.createSession();
    try {
      const mediaUrlByClipId = buildMediaUrlMap(
        mediaBridge,
        session,
        plan.clips
          .filter((clip) => clip.source.path)
          .map((clip) => ({ clipId: clip.id, absolutePath: clip.source.path! })),
      );
      const compositionProps = buildCompositionProps(plan, mediaUrlByClipId);
      const propsValidation = validateCompositionProps(compositionProps);
      if (!propsValidation.success) throw new Error(propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const rawPath = path.join(outputRoot, "raw-remotion.mp4");
      const outputPath = path.join(outputRoot, "output.mp4");
      const postProcessLogPath = path.join(outputRoot, "audio-postprocess.log");
      const composition = await selectComposition({
        serveUrl: bundlePath,
        id: REMOTION_COMPOSITION_ID,
        inputProps: compositionProps,
        browserExecutable: browser,
        binariesDirectory: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64"),
        chromeMode: "headless-shell",
        onBrowserDownload: () => { throw new Error("five-shot 禁止隐式下载 Headless Shell"); },
      });
      await renderMedia({
        serveUrl: bundlePath,
        composition,
        inputProps: compositionProps,
        outputLocation: rawPath,
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        browserExecutable: browser,
        binariesDirectory: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64"),
        chromeMode: "headless-shell",
        enforceAudioTrack: true,
        overwrite: true,
        onBrowserDownload: () => { throw new Error("five-shot 禁止隐式下载 Headless Shell"); },
      });
      const audioPostProcess = await runTimelineAudioPostProcess({
        rawInputPath: rawPath,
        outputPath,
        logPath: postProcessLogPath,
        loudnessLufs: plan.renderSettings.loudnessLufs,
        truePeakDbtp: plan.renderSettings.truePeakDbtp,
      });
      const probePath = path.join(outputRoot, "ffprobe.json");
      const probe = await probeRenderedMedia(outputPath);
      fs.writeFileSync(probePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
      const expectedDuration = composition.durationInFrames / composition.fps;
      assertRenderedMediaEvidence({
        label: "五镜",
        probe,
        expectedDuration,
        fps: composition.fps,
        width: plan.renderSettings.width,
        height: plan.renderSettings.height,
      });
      const loudnessMeasurement = await measureRenderedMediaLoudness({
        filePath: outputPath,
        rawLogPath: path.join(outputRoot, "loudness-measurement.log"),
        reportPath: path.join(outputRoot, "loudness-measurement.json"),
        target: {
          integratedLufs: plan.renderSettings.loudnessLufs,
          truePeakDbtp: plan.renderSettings.truePeakDbtp,
        },
      });
      const reportPath = path.resolve(process.env.MYSTUDIO_REMOTION_FIXTURE_REPORT || path.join(outputRoot, "report.json"));
      const report: FiveShotReport = {
        ok: true,
        generatedAt: new Date().toISOString(),
        renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash },
        audioPostProcess,
        loudnessMeasurement,
        outputPath,
        reportPath,
        duration: probe.duration,
        expectedDuration,
        width: probe.width,
        height: probe.height,
        streams: probe.streams,
        sha256: await hashFileSha256(outputPath),
      };
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    } finally {
      await mediaBridge.revokeSession(session);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

function audioClip(kind: "voice" | "bgm" | "sfx", sourcePath: string, startUs: number, durationUs: number): TimelineRenderClip {
  return {
    id: `${kind}-1`, trackId: kind, trackKind: kind,
    source: { kind: "audio", path: sourcePath, evidence: { mediaId: `${kind}-fixture` } },
    startUs, durationUs, trimStartUs: 0, speed: 1, volume: kind === "bgm" ? 0.25 : 0.8, muted: false,
  };
}

function transition(fromClipId: string, toClipId: string, effectId: "fade" | "crossfade" | "flash" | "blackout") {
  return { id: `${fromClipId}-${toClipId}`, fromClipId, toClipId, effectId, durationUs: 180_000, params: {} };
}

export async function createFixtureAssets(assetRoot: string): Promise<string[]> {
  fs.mkdirSync(assetRoot, { recursive: true });
  const colors = ["#12233f", "#6f2b3d", "#234f39", "#57412a"];
  const images: string[] = [];
  for (const [index, color] of colors.entries()) {
    const output = path.join(assetRoot, `shot-${index + 1}.png`);
    await run("ffmpeg", ["-f", "lavfi", "-i", `color=c=${color}:s=540x960`, "-frames:v", "1", "-y", output]);
    images.push(output);
  }
  const video = path.join(assetRoot, "shot-3.mp4");
  await run("ffmpeg", ["-f", "lavfi", "-i", "testsrc2=s=540x960:r=30", "-t", "1.2", "-pix_fmt", "yuv420p", "-y", video]);
  images.splice(2, 0, video);
  const audio: string[] = [];
  for (const [index, frequency] of [440, 220, 880].entries()) {
    const output = path.join(assetRoot, `${["voice", "bgm", "sfx"][index]}.wav`);
    await run("ffmpeg", ["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`, "-t", "6", "-y", output]);
    audio.push(output);
  }
  return [...images, ...audio];
}

async function resolveBrowser(): Promise<string> {
  const adapters = createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser);
  const result = await adapters.probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); } });
  if (!result.executablePath || !path.isAbsolute(result.executablePath)) throw new Error("Remotion 浏览器探测未返回 executable path");
  return result.executablePath;
}

function readBundleManifest(bundlePath: string): { remotionVersion: string; compositionId: string; contentHash: string } {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (typeof manifest.remotionVersion !== "string" || typeof manifest.compositionId !== "string" || typeof manifest.contentHash !== "string") throw new Error("Remotion bundle manifest 无效");
  return { remotionVersion: manifest.remotionVersion, compositionId: manifest.compositionId, contentHash: manifest.contentHash };
}

async function run(file: string, args: readonly string[]) {
  await execFileAsync(file, [...args], { maxBuffer: 50 * 1024 * 1024 });
}

if (process.env.MYSTUDIO_REMOTION_FIVE_SHOT === "1"
  || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  runFiveShotSmoke().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
