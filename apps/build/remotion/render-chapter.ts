import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { PNG } from "pngjs";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { projectStoryboardShotCompositionProps } from "@/lib/studio/remotion/shot-plan";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionAudioBindingFingerprint, createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { buildRemotionCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";
import type { TimelineRenderPlan } from "@/types/editing";
import type {
  RemotionChapterManifestV2,
  RemotionChapterAudioBindingV2,
  RemotionCurrentSlotV1,
  RemotionShotDefinitionV2,
} from "@/types/remotion-workspace";
import { buildChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { validateChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { CHAPTER_VIDEO_COMPOSITION_ID, STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { assertBundleMatchesRuntime } from "@rendering/plugins/remotion/render/bundle-manifest";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { analyzeRenderedAudioWindows, assertRenderedMediaEvidence, hashFileSha256, probeRenderedMedia } from "./render-smoke-evidence";
import { resolveRemotionRuntimeDir } from "../timeline/storage-paths";

const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const remotionVersion = "4.0.499";

export interface ChapterSmokeReport {
  ok: true;
  generatedAt: string;
  renderer: { requested: "remotion"; actual: "remotion"; version: string; bundleVersion: string };
  compositionId: typeof CHAPTER_VIDEO_COMPOSITION_ID;
  shotCount: number;
  shotOutputs: string[];
  outputPath: string;
  duration: number;
  width: number;
  height: number;
  streams: string[];
  sha256: string;
  ffmpegPostProcess: false;
  audioWindows: Awaited<ReturnType<typeof analyzeRenderedAudioWindows>>;
  chapterSharedAudioRoles: string[];
}

export function parseChapterSmokeShotCount(rawValue = process.env.MYSTUDIO_REMOTION_CHAPTER_SHOTS): number {
  const value = rawValue === undefined || rawValue.trim() === "" ? 2 : Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("MYSTUDIO_REMOTION_CHAPTER_SHOTS 必须是大于等于 1 的安全整数");
  }
  return value;
}

/** Real multi-shot gate: shot MP4s and the chapter MP4 are all renderMedia outputs. */
export async function runChapterSmoke(): Promise<ChapterSmokeReport> {
  const outputRoot = path.resolve(process.env.MYSTUDIO_REMOTION_CHAPTER_DIR || path.join(appsRoot, "output", "automation", "remotion-chapter"));
  await fs.promises.mkdir(outputRoot, { recursive: true });
  const assets = await createFixtureImages(path.join(outputRoot, "assets"), parseChapterSmokeShotCount());
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = assertBundleMatchesRuntime(
    JSON.parse(await fs.promises.readFile(path.join(bundlePath, "manifest.json"), "utf8")),
    remotionVersion,
  );
  const runtimeDir = path.resolve(resolveRemotionRuntimeDir());
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(path.join(runtimeDir, "package.json"), `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`, "utf8");
  const previousCwd = process.cwd();
  const reportPath = process.env.MYSTUDIO_REMOTION_CHAPTER_REPORT
    ? path.resolve(previousCwd, process.env.MYSTUDIO_REMOTION_CHAPTER_REPORT)
    : path.join(outputRoot, "report.json");
  process.chdir(runtimeDir);
  try {
  const configuredBrowserPath = process.env.MYSTUDIO_REMOTION_BROWSER_EXECUTABLE;
  const browser = configuredBrowserPath
    ? { executablePath: await assertBrowserExecutable(configuredBrowserPath) }
    : await createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser)
      .probe.ensureBrowser({ onDownload: () => { throw new Error("ChapterVideo smoke 禁止隐式下载 Headless Shell"); } });
  if (!browser.executablePath || !path.isAbsolute(browser.executablePath)) throw new Error("Remotion 浏览器探测未返回 executable path");
  const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
  const projectId = "remotion-chapter-fixture";
  const chapterId = "chapter-fixture";
  const shotOutputs: string[] = [];
  const shotSlots: RemotionCurrentSlotV1[] = [];
  const shotPlans: RemotionShotPlanV1[] = [];
  const shotBridge = new MediaBridgeServer();
  await shotBridge.listen();
  const shotSession = shotBridge.createSession();
  try {
    for (const [index, imagePath] of assets.images.entries()) {
      const shotPlan = await makeShotPlan(projectId, chapterId, index, imagePath, assets.voices[index]!);
      shotPlans.push(shotPlan);
      const sourceKey = referenceKey(shotPlan.shot.visualSource);
      const urls = buildMediaUrlMap(shotBridge, shotSession, [{ clipId: sourceKey, absolutePath: imagePath }, ...shotPlan.shot.audioBindings.map((b) => ({ clipId: referenceKey(b.source), absolutePath: assets.voices[index]! }))]);
      const projected = projectStoryboardShotCompositionProps(shotPlan, (reference) => {
        const url = urls[referenceKey(reference)];
        if (!url) throw new Error(`shot capability 缺失: ${reference.relativePath}`);
        return url;
      });
      if (!projected.success) throw new Error(projected.issues.map((issue) => issue.message).join("；"));
      const composition = await selectComposition({
        serveUrl: bundlePath,
        id: STORYBOARD_SHOT_COMPOSITION_ID,
        inputProps: projected.value,
        browserExecutable: browser.executablePath,
        binariesDirectory,
        chromeMode: "headless-shell",
        onBrowserDownload: () => { throw new Error("ChapterVideo smoke 禁止隐式下载 Headless Shell"); },
      });
      const outputPath = path.join(outputRoot, `shot-${String(index + 1).padStart(3, "0")}.mp4`);
      await renderMedia({
        serveUrl: bundlePath,
        composition,
        inputProps: projected.value,
        outputLocation: outputPath,
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        browserExecutable: browser.executablePath,
        binariesDirectory,
        chromeMode: "headless-shell",
        enforceAudioTrack: true,
        overwrite: true,
        onBrowserDownload: () => { throw new Error("ChapterVideo smoke 禁止隐式下载 Headless Shell"); },
      });
      shotOutputs.push(outputPath);
      shotSlots.push(await makeShotSlot(shotPlan, outputPath, String(manifest.contentHash)));
    }
  } finally {
    await shotBridge.revokeSession(shotSession);
  }

  const chapterPlan = makeChapterPlan(projectId, chapterId, shotSlots);
    const chapterManifest = await makeChapterManifest(chapterPlan, shotPlans, assets);
  const chapterBridge = new MediaBridgeServer();
  await chapterBridge.listen();
  const chapterSession = chapterBridge.createSession();
  try {
    const chapterUrls = buildMediaUrlMap(chapterBridge, chapterSession, [...shotSlots.map((slot, index) => ({ clipId: `visual-shot-${String(index + 1).padStart(3, "0")}`, absolutePath: shotOutputs[index]! })), ...chapterManifest.sharedAudioBindings.map((b) => ({ clipId: b.bindingId, absolutePath: b.source.relativePath.endsWith("bgm.wav") ? assets.bgm : assets.ambience }))]);
    const propsResult = buildChapterVideoCompositionProps({
      plan: chapterPlan,
      currentShotSlots: shotSlots,
      chapterManifest,
      mediaUrlByClipId: chapterUrls,
      mediaUrlByBindingId: Object.fromEntries(chapterManifest.sharedAudioBindings.map((b) => [b.bindingId, chapterUrls[b.bindingId]])),
    });
    if (!propsResult.success) throw new Error(propsResult.issues.map((issue) => issue.message).join("；"));
    const propsValidation = validateChapterVideoCompositionProps(propsResult.value);
    if (!propsValidation.success) throw new Error(propsValidation.issues.map((issue) => issue.message).join("；"));
    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: CHAPTER_VIDEO_COMPOSITION_ID,
      inputProps: propsResult.value,
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      onBrowserDownload: () => { throw new Error("ChapterVideo smoke 禁止隐式下载 Headless Shell"); },
    });
    const outputPath = path.join(outputRoot, "chapter.mp4");
    await renderMedia({
      serveUrl: bundlePath,
      composition,
      inputProps: propsResult.value,
      outputLocation: outputPath,
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      enforceAudioTrack: true,
      overwrite: true,
      onBrowserDownload: () => { throw new Error("ChapterVideo smoke 禁止隐式下载 Headless Shell"); },
    });
    const probe = await probeRenderedMedia(outputPath);
    assertRenderedMediaEvidence({ label: "ChapterVideo", probe, expectedDuration: composition.durationInFrames / composition.fps, fps: composition.fps, width: chapterPlan.renderSettings.width, height: chapterPlan.renderSettings.height });
    const audioWindows = await analyzeRenderedAudioWindows({
      filePath: outputPath,
      windows: shotSlots.map((_slot, index) => ({ startUs: index * 1_000_000, endUs: index * 1_000_000 + 400_000 })),
      frequenciesHz: [110, 220, ...shotSlots.map((_slot, index) => 440 + index * 110)],
    });
    const report: ChapterSmokeReport = {
      ok: true,
      generatedAt: new Date().toISOString(),
      renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: String(manifest.contentHash) },
      compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
      shotCount: shotSlots.length,
      shotOutputs,
      outputPath,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      streams: probe.streams,
      sha256: await hashFileSha256(outputPath),
      ffmpegPostProcess: false,
      audioWindows,
      chapterSharedAudioRoles: chapterManifest.sharedAudioBindings.map((binding) => binding.role),
    };
    await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    await chapterBridge.revokeSession(chapterSession);
  }
  } finally {
    process.chdir(previousCwd);
  }
}

async function assertBrowserExecutable(browserPath: string): Promise<string> {
  if (!path.isAbsolute(browserPath)) throw new Error("MYSTUDIO_REMOTION_BROWSER_EXECUTABLE 必须是绝对路径");
  const stat = await fs.promises.stat(browserPath).catch(() => undefined);
  if (!stat?.isFile()) throw new Error("MYSTUDIO_REMOTION_BROWSER_EXECUTABLE 不是可读文件");
  await fs.promises.access(browserPath, fs.constants.X_OK);
  return browserPath;
}

async function makeShotPlan(projectId: string, chapterId: string, index: number, imagePath: string, voicePath: string): Promise<RemotionShotPlanV1> {
  const contentSha256 = await hashFileSha256(imagePath);
  const voiceHash = await hashFileSha256(voicePath);
  const voiceBinding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `voice-${index + 1}`,
    bindingFingerprint: "0".repeat(64),
    renderScope: "shot",
    projectId,
    chapterId,
    shotId: `shot-${String(index + 1).padStart(3, "0")}`,
    shotRevision: 1,
    role: "voice",
    source: { kind: "project-file", projectId, relativePath: `remotion/audio/${chapterId}/shots/shot-${String(index + 1).padStart(3, "0")}/voice/voice-${index + 1}.wav`, contentSha256: voiceHash, provenance: { sourceKind: "generated", sourceId: "chapter-smoke", sourceVersion: "1" } },
    sourceFingerprint: voiceHash,
    sourceDurationUs: 1_000_000,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: 1_000_000,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
    ttsInputFingerprint: await sha256CanonicalJson({ projectId, chapterId, shotId: `shot-${index + 1}`, text: `chapter smoke voice ${index + 1}`, profile: "fixture" }),
  };
  voiceBinding.bindingFingerprint = await createRemotionAudioBindingFingerprint(voiceBinding);
  const shot: RemotionShotDefinitionV2 = {
    shotId: `shot-${String(index + 1).padStart(3, "0")}`,
    storyboardId: `shot-${String(index + 1).padStart(3, "0")}`,
    index,
    revision: 1,
    sourceFingerprint: contentSha256,
    durationUs: 1_000_000,
    visualSource: { kind: "project-file", projectId, relativePath: `fixture/shot-${index + 1}.png`, contentSha256, provenance: { sourceKind: "generated", sourceId: "chapter-smoke", sourceVersion: "1" } },
    audioBindings: [voiceBinding],
    motion: { kind: "pan-zoom", fromScale: 1, toScale: 1.04, originX: 0.5, originY: 0.5 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  };
  const renderSettings = { width: 1080, height: 1920, fps: 30, codec: "h264" as const, subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5 };
  const hashInput = { schemaVersion: 1 as const, target: "shot" as const, projectId, chapterId, renderSettings, visualKind: "image" as const, shot };
  return { schemaVersion: 1, target: "shot", projectId, chapterId, chapterRevision: 1, sourceSnapshotHash: "a".repeat(64), renderSettings, visualKind: "image", shot, inputHash: await sha256CanonicalJson(hashInput) };
}

async function makeShotSlot(plan: RemotionShotPlanV1, outputPath: string, bundleContentHash: string): Promise<RemotionCurrentSlotV1> {
  const renderSettingsHash = await sha256CanonicalJson(plan.renderSettings);
  const target = { kind: "shot" as const, chapterId: plan.chapterId, shotId: plan.shot.shotId, shotRevision: plan.shot.revision };
  const identity = { projectId: plan.projectId, target, inputHash: plan.inputHash, bundleContentHash, renderSettingsHash };
  const jobId = await createRemotionRenderJobId(identity);
  const outputRelativePath = `outputs/shots/${plan.chapterId}/${plan.shot.shotId}/current.mp4`;
  const evidence = { schemaVersion: 1 as const, ...identity, jobId, templateVersion: "1.0.0", remotionVersion, attempt: 1, compositionId: STORYBOARD_SHOT_COMPOSITION_ID, renderer: { requested: "remotion" as const, actual: "remotion" as const }, outputPath: outputRelativePath, sizeBytes: fs.statSync(outputPath).size, mtimeMs: Math.floor(fs.statSync(outputPath).mtimeMs), sha256: await hashFileSha256(outputPath), width: 1080, height: 1920, durationUs: plan.shot.durationUs, streams: [{ kind: "video" as const, codec: "h264" as const, width: 1080, height: 1920 }, { kind: "audio" as const, codec: "aac" as const, channels: 2, sampleRate: 48_000 }], inputManifestPath: `chapters/${plan.chapterId}.json`, startedAt: 1, completedAt: 2 };
  const job = { schemaVersion: 1 as const, ...identity, jobId, templateVersion: "1.0.0", remotionVersion, status: "succeeded" as const, attempt: 1, progress: 1, createdAt: 1, startedAt: 1, completedAt: 2, outputPath: outputRelativePath, evidencePath: `evidence/shots/${plan.chapterId}/${plan.shot.shotId}/current.json` };
  return buildRemotionCurrentSlot(plan.projectId, target, job, evidence, 2);
}

function makeChapterPlan(projectId: string, chapterId: string, slots: readonly RemotionCurrentSlotV1[]): TimelineRenderPlan {
  const renderSettings = { width: 1080, height: 1920, fps: 30, codec: "h264" as const, subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5, audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 } };
  return {
    schemaVersion: 1,
    jobId: "chapter-smoke",
    projectId,
    episodeId: chapterId,
    editingProjectId: "editing-chapter-smoke",
    editingRevision: 1,
    sourceSnapshotHash: "b".repeat(64),
    editingProjectSnapshot: {} as TimelineRenderPlan["editingProjectSnapshot"],
    renderSettings,
    clips: slots.map((slot, index) => {
      if (slot.target.kind !== "shot") throw new Error("shot slot expected");
      return { id: `visual-${slot.target.shotId}`, trackId: "visual", trackKind: "video" as const, source: { kind: "storyboardVideo" as const, path: slot.outputPath, evidence: { storyboardId: slot.target.shotId, remotionJobId: slot.job.jobId, remotionEvidenceSha256: slot.evidence.sha256, outputVersion: slot.target.shotRevision } }, startUs: index * 1_000_000, durationUs: 1_000_000, trimStartUs: 0, speed: 1, volume: 0, muted: true };
    }),
    transitions: [],
    effects: [],
    createdAt: 1,
  };
}

async function makeChapterManifest(
  plan: TimelineRenderPlan,
  shotPlans: readonly RemotionShotPlanV1[],
  assets: { bgm: string; ambience: string },
): Promise<RemotionChapterManifestV2> {
  const timestamp = 1;
  const manifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId: plan.projectId,
    chapterId: plan.episodeId,
    revision: 1,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: shotPlans.map((shotPlan) => shotPlan.shot.shotId),
    sharedAudioBindings: await Promise.all([
      ["bgm", assets.bgm, "bgm", true, 200_000, 300_000],
      ["ambience", assets.ambience, "ambience", false, 100_000, 200_000],
    ].map(async ([id, file, role, duckingEnabled, fadeInUs, fadeOutUs]) => {
      const hash = await hashFileSha256(file);
      const binding: RemotionChapterAudioBindingV2 = {
        schemaVersion: 2,
        bindingId: id,
        bindingFingerprint: "0".repeat(64),
        projectId: plan.projectId,
        chapterId: plan.episodeId,
        source: { kind: "project-file", projectId: plan.projectId, relativePath: `remotion/audio/${plan.episodeId}/shared/${role}/${id}.wav`, contentSha256: hash, provenance: { sourceKind: "generated", sourceId: "chapter-smoke", sourceVersion: "1" } },
        sourceFingerprint: hash,
        sourceDurationUs: 2_000_000,
        sourceStartUs: 0,
        durationUs: 2_000_000,
        volume: 0.25,
        fadeInUs,
        fadeOutUs,
        envelope: [{ timeUs: 0, gain: 1 }, { timeUs: 2_000_000, gain: 1 }],
        renderScope: "chapter",
        role: role as "bgm" | "ambience",
        chapterStartUs: 0,
        ducking: { enabled: duckingEnabled, reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
      };
      binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
      return binding;
    })),
    shots: shotPlans.map((shotPlan) => shotPlan.shot),
    renderSettings: plan.renderSettings,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(manifest);
  return manifest;
}

async function createFixtureImages(root: string, shotCount: number): Promise<{ images: string[]; voices: string[]; bgm: string; ambience: string }> {
  await fs.promises.mkdir(root, { recursive: true });
  const colors = Array.from({ length: shotCount }, (_value, index) => [
    (30 + index * 37) % 220,
    (55 + index * 29) % 220,
    (90 + index * 47) % 220,
  ]);
  const output: string[] = [];
  const voices: string[] = [];
  for (const [index, color] of colors.entries()) {
    const imagePath = path.join(root, `shot-${index + 1}.png`);
    const png = new PNG({ width: 270, height: 480 });
    for (let offset = 0; offset < png.data.length; offset += 4) {
      png.data[offset] = color[0]!;
      png.data[offset + 1] = color[1]!;
      png.data[offset + 2] = color[2]!;
      png.data[offset + 3] = 255;
    }
    await fs.promises.writeFile(imagePath, PNG.sync.write(png));
    output.push(imagePath);
    const voice = path.join(root, `voice-${index + 1}.wav`); await writeSineWav(voice, 1, 440 + index * 110); voices.push(voice);
  }
  const bgm = path.join(root, "bgm.wav"); const ambience = path.join(root, "ambience.wav"); await writeSineWav(bgm, 2, 220); await writeSineWav(ambience, 2, 110); return { images: output, voices, bgm, ambience };
}

async function writeSineWav(file: string, seconds: number, frequency: number): Promise<void> {
  const rate = 48_000; const samples = rate * seconds; const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 7000), i * 2);
  const h = Buffer.alloc(44); h.write("RIFF"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40); await fs.promises.writeFile(file, Buffer.concat([h, data]));
}

function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string {
  return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
}

if (process.env.MYSTUDIO_REMOTION_CHAPTER === "1") {
  runChapterSmoke().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
