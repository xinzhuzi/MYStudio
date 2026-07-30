import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { validateStoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { validateRemotionShotPlan, projectStoryboardShotCompositionProps, type RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { hashFileSha256, probeRenderedMedia, assertRenderedMediaEvidence } from "./render-smoke-evidence";

const execFileAsync = promisify(execFile);
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const remotionVersion = "4.0.499";

export interface ShotSmokeReport {
  ok: true;
  generatedAt: string;
  renderer: { requested: "remotion"; actual: "remotion"; version: string; bundleVersion: string };
  outputPath: string;
  duration: number;
  width: number;
  height: number;
  streams: string[];
  sha256: string;
}

export async function runShotSmoke(): Promise<ShotSmokeReport> {
  const outputRoot = path.resolve(process.env.MYSTUDIO_REMOTION_SHOT_DIR || path.join(appsRoot, "output", "automation", "remotion-shot"));
  await fs.promises.mkdir(outputRoot, { recursive: true });
  const assets = await createShotFixtureAssets(path.join(outputRoot, "assets"));
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = JSON.parse(await fs.promises.readFile(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (manifest.remotionVersion !== remotionVersion || manifest.compositionIds instanceof Array === false || !manifest.compositionIds.includes(STORYBOARD_SHOT_COMPOSITION_ID)) {
    throw new Error("StoryboardShot bundle manifest 与运行时不一致");
  }
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(os.homedir(), "Library", "Application Support", "漫影工作室", "remotion-runtime"));
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`,
    "utf8",
  );
  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browserAdapters = createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser);
    const browser = await browserAdapters.probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); } });
    if (!browser.executablePath || !path.isAbsolute(browser.executablePath)) throw new Error("Remotion 浏览器探测未返回 executable path");

    const plan = await createPlan(assets);
    const bridge = new MediaBridgeServer();
    await bridge.listen();
    const session = bridge.createSession();
    try {
      const refs = [plan.shot.visualSource, ...plan.shot.audioBindings.flatMap((binding) => binding.renderScope === "shot" ? [binding.source] : [])];
      const uniqueRefs = [...new Map(refs.map((reference) => [referenceKey(reference), reference])).values()];
      const urls = buildMediaUrlMap(bridge, session, uniqueRefs.map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: reference.relativePath === "fixture/shot.png" ? assets.image : assets.voice,
      })));
      const projected = projectStoryboardShotCompositionProps(plan, (reference) => {
        const url = urls[referenceKey(reference)];
        if (!url) throw new Error(`缺少 shot capability: ${reference.relativePath}`);
        return url;
      });
      if (!projected.success) throw new Error(projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const propsValidation = validateStoryboardShotCompositionProps(projected.value);
      if (!propsValidation.success) throw new Error(propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const composition = await selectComposition({
        serveUrl: bundlePath,
        id: STORYBOARD_SHOT_COMPOSITION_ID,
        inputProps: projected.value,
        browserExecutable: browser.executablePath,
        binariesDirectory: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64"),
        chromeMode: "headless-shell",
        onBrowserDownload: () => { throw new Error("shot smoke 禁止隐式下载 Headless Shell"); },
      });
      const outputPath = path.join(outputRoot, "shot.mp4");
      await renderMedia({
        serveUrl: bundlePath,
        composition,
        inputProps: projected.value,
        outputLocation: outputPath,
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        browserExecutable: browser.executablePath,
        binariesDirectory: path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64"),
        chromeMode: "headless-shell",
        enforceAudioTrack: true,
        overwrite: true,
        onBrowserDownload: () => { throw new Error("shot smoke 禁止隐式下载 Headless Shell"); },
      });
      const probe = await probeRenderedMedia(outputPath);
      assertRenderedMediaEvidence({ label: "StoryboardShot", probe, expectedDuration: composition.durationInFrames / composition.fps, fps: composition.fps, width: plan.renderSettings.width, height: plan.renderSettings.height });
      const report: ShotSmokeReport = {
        ok: true,
        generatedAt: new Date().toISOString(),
        renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: String(manifest.contentHash) },
        outputPath,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        streams: probe.streams,
        sha256: await hashFileSha256(outputPath),
      };
      const reportPath = path.resolve(process.env.MYSTUDIO_REMOTION_SHOT_REPORT || path.join(outputRoot, "report.json"));
      await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    } finally {
      await bridge.revokeSession(session);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

async function createPlan(assets: { image: string; voice: string }): Promise<RemotionShotPlanV1> {
  const projectId = "remotion-shot-fixture";
  const chapterId = "chapter-fixture";
  const imageHash = await hashFileSha256(assets.image);
  const voiceHash = await hashFileSha256(assets.voice);
  const shot = {
    shotId: "shot-fixture",
    storyboardId: "storyboard-fixture",
    index: 0,
    revision: 1,
    sourceFingerprint: imageHash,
    durationUs: 2_000_000,
    visualSource: { kind: "project-file" as const, projectId, relativePath: "fixture/shot.png", contentSha256: imageHash, provenance: { sourceKind: "generated" as const, sourceId: "fixture", sourceVersion: "1" } },
    subtitleText: "Remotion shot smoke",
    audioBindings: [{ renderScope: "shot" as const, role: "voice" as const, source: { kind: "project-file" as const, projectId, relativePath: "fixture/voice.wav", contentSha256: voiceHash, provenance: { sourceKind: "generated" as const, sourceId: "fixture", sourceVersion: "1" } }, sourceStartUs: 0, shotStartUs: 0, durationUs: 2_000_000, volume: 1 }],
    motion: { kind: "pan-zoom" as const, fromScale: 1, toScale: 1.04, originX: 0.5, originY: 0.5 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  };
  const renderSettings = { width: 1080, height: 1920, fps: 30, codec: "h264" as const, subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5 };
  const hashInput = { schemaVersion: 1 as const, target: "shot" as const, projectId, chapterId, renderSettings, visualKind: "image" as const, shot, sharedAudioTracks: [] };
  return { schemaVersion: 1, target: "shot", projectId, chapterId, chapterRevision: 1, sourceSnapshotHash: "a".repeat(64), renderSettings, visualKind: "image", shot, sharedAudioTracks: [], inputHash: await sha256CanonicalJson(hashInput) };
}

async function createShotFixtureAssets(root: string): Promise<{ image: string; voice: string }> {
  await fs.promises.mkdir(root, { recursive: true });
  const image = path.join(root, "shot.png");
  const voice = path.join(root, "voice.wav");
  await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", "color=c=#27344a:s=540x960", "-frames:v", "1", "-y", image], { maxBuffer: 10 * 1024 * 1024 });
  await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-y", voice], { maxBuffer: 10 * 1024 * 1024 });
  return { image, voice };
}

function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string {
  return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
}

if (process.env.MYSTUDIO_REMOTION_SHOT === "1") {
  runShotSmoke().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
