import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { validateStoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { validateRemotionShotPlan, projectStoryboardShotCompositionProps, type RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionAudioBindingFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type { RemotionShotAudioBindingV2 } from "@/types/remotion-workspace";
import { analyzeRenderedAudioWindows, hashFileSha256, probeRenderedMedia, assertRenderedMediaEvidence } from "./render-smoke-evidence";

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
  audioWindows: Awaited<ReturnType<typeof analyzeRenderedAudioWindows>>;
  shotAudioRoles: string[];
  chapterSharedAudioBindings: number;
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
      const refs = [plan.shot.visualSource, ...plan.shot.audioBindings.map((binding) => binding.source)];
      const uniqueRefs = [...new Map(refs.map((reference) => [referenceKey(reference), reference])).values()];
      const audioPathByReference = new Map(plan.shot.audioBindings.map((binding) => [referenceKey(binding.source), binding.source.relativePath.endsWith("sfx.wav") ? assets.sfx : assets.voice]));
      const urls = buildMediaUrlMap(bridge, session, uniqueRefs.map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: reference.relativePath === "fixture/shot.png" ? assets.image : audioPathByReference.get(referenceKey(reference))!,
      })));
      const planValidation = await validateRemotionShotPlan(plan);
      if (!planValidation.success) throw new Error(planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
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
      const audioWindows = await analyzeRenderedAudioWindows({
        filePath: outputPath,
        windows: [{ startUs: 0, endUs: 700_000 }, { startUs: 1_000_000, endUs: 1_600_000 }],
        frequenciesHz: [440, 880],
      });
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
        audioWindows,
        shotAudioRoles: plan.shot.audioBindings.map((binding) => binding.role),
        chapterSharedAudioBindings: 0,
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

async function createPlan(assets: { image: string; voice: string; sfx: string }): Promise<RemotionShotPlanV1> {
  const projectId = "remotion-shot-fixture";
  const chapterId = "chapter-fixture";
  const imageHash = await hashFileSha256(assets.image);
  const voiceHash = await hashFileSha256(assets.voice);
  const sfxHash = await hashFileSha256(assets.sfx);
  const ttsInputFingerprint = await sha256CanonicalJson({ projectId, chapterId, shotId: "shot-fixture", text: "Remotion shot smoke", profile: "fixture" });
  const voiceBinding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: "voice:shot-fixture",
    bindingFingerprint: "0".repeat(64),
    renderScope: "shot",
    projectId,
    chapterId,
    shotId: "shot-fixture",
    shotRevision: 1,
    role: "voice",
    source: { kind: "project-file", projectId, relativePath: "remotion/audio/chapter-fixture/shots/shot-fixture/voice/voice.wav", contentSha256: voiceHash, provenance: { sourceKind: "generated", sourceId: "fixture-voice", sourceVersion: "1" } },
    sourceFingerprint: voiceHash,
    sourceDurationUs: 2_000_000,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: 2_000_000,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
    ttsInputFingerprint,
  };
  voiceBinding.bindingFingerprint = await createRemotionAudioBindingFingerprint(voiceBinding);
  const sfxBinding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: "sfx:shot-fixture",
    bindingFingerprint: "0".repeat(64),
    renderScope: "shot",
    projectId,
    chapterId,
    shotId: "shot-fixture",
    shotRevision: 1,
    role: "sfx",
    source: { kind: "project-file", projectId, relativePath: "remotion/audio/chapter-fixture/shots/shot-fixture/sfx/sfx.wav", contentSha256: sfxHash, provenance: { sourceKind: "generated", sourceId: "fixture-sfx", sourceVersion: "1" } },
    sourceFingerprint: sfxHash,
    sourceDurationUs: 600_000,
    sourceStartUs: 0,
    shotStartUs: 1_000_000,
    durationUs: 600_000,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
  };
  sfxBinding.bindingFingerprint = await createRemotionAudioBindingFingerprint(sfxBinding);
  const shot = {
    shotId: "shot-fixture",
    storyboardId: "storyboard-fixture",
    index: 0,
    revision: 1,
    sourceFingerprint: imageHash,
    durationUs: 2_000_000,
    visualSource: { kind: "project-file" as const, projectId, relativePath: "fixture/shot.png", contentSha256: imageHash, provenance: { sourceKind: "generated" as const, sourceId: "fixture", sourceVersion: "1" } },
    subtitleText: "Remotion shot smoke",
    audioBindings: [voiceBinding, sfxBinding],
    motion: { kind: "pan-zoom" as const, fromScale: 1, toScale: 1.04, originX: 0.5, originY: 0.5 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  };
  const renderSettings = { width: 1080, height: 1920, fps: 30, codec: "h264" as const, subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5 };
  const hashInput = { schemaVersion: 1 as const, target: "shot" as const, projectId, chapterId, renderSettings, visualKind: "image" as const, shot };
  return { schemaVersion: 1, target: "shot", projectId, chapterId, chapterRevision: 1, sourceSnapshotHash: "a".repeat(64), renderSettings, visualKind: "image", shot, inputHash: await sha256CanonicalJson(hashInput) };
}

async function createShotFixtureAssets(root: string): Promise<{ image: string; voice: string; sfx: string }> {
  await fs.promises.mkdir(root, { recursive: true });
  const image = path.join(root, "shot.png");
  const voice = path.join(root, "voice.wav");
  const sfx = path.join(root, "sfx.wav");
  const png = new PNG({ width: 540, height: 960 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 39; png.data[i + 1] = 52; png.data[i + 2] = 74; png.data[i + 3] = 255; }
  await fs.promises.writeFile(image, PNG.sync.write(png));
  await writeSineWav(voice, 2, 440);
  await writeSineWav(sfx, 0.6, 880);
  return { image, voice, sfx };
}

async function writeSineWav(file: string, seconds: number, frequency: number): Promise<void> {
  const rate = 48_000; const samples = rate * seconds; const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 10_000), i * 2);
  const header = Buffer.alloc(44); header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  await fs.promises.writeFile(file, Buffer.concat([header, data]));
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
