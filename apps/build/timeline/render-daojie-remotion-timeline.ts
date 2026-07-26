import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { validateCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { buildCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { REMOTION_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { runTimelineAudioPostProcess } from "@rendering/runtime/ffmpeg/timeline-audio-postprocess";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import { deriveStorageRoots, resolveTimelineSourcePath } from "./render-daojie-editing-timeline";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  measureRenderedMediaLoudness,
  probeRenderedMedia,
} from "../remotion/render-smoke-evidence";

const remotionVersion = "4.0.499";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);

export async function runDaojieRemotionTimeline(): Promise<Record<string, unknown>> {
  const artifactDir = path.resolve(process.env.MYSTUDIO_DAOJIE_TIMELINE_ARTIFACT_DIR || path.join(appsRoot, "output", "automation", "daojie-chapter001-timeline"));
  const planPath = path.join(artifactDir, "timeline-render-plan.json");
  if (!fs.existsSync(planPath)) throw new Error(`缺少当前 Daojie TimelineRenderPlan，请先生成: ${planPath}`);
  const planValue = JSON.parse(fs.readFileSync(planPath, "utf8")) as unknown;
  const planValidation = validateTimelineRenderPlan(planValue);
  if (!planValidation.success) throw new Error(planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  const plan = planValidation.value;
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readManifest(bundlePath);
  if (manifest.remotionVersion !== remotionVersion || manifest.compositionId !== REMOTION_COMPOSITION_ID) throw new Error("Daojie Remotion bundle manifest 与运行时不一致");
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
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
    const outputDir = path.join(artifactDir, "remotion");
    fs.mkdirSync(outputDir, { recursive: true });
    const mediaBridge = new MediaBridgeServer();
    await mediaBridge.listen();
    const session = mediaBridge.createSession();
    try {
      const browser = await resolveBrowser();
    const mediaUrlByClipId = buildMediaUrlMap(
      mediaBridge,
      session,
      plan.clips
        .filter((clip) => clip.source.path)
        .map((clip) => ({
          clipId: clip.id,
          absolutePath: resolveTimelineSourcePath({
            sourcePath: clip.source.path!,
            dataRoot: roots.dataRoot,
            mediaRoot: roots.mediaRoot,
          }),
        })),
    );
      const props = buildCompositionProps(plan, mediaUrlByClipId);
      const propsValidation = validateCompositionProps(props);
      if (!propsValidation.success) throw new Error(propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const rawPath = path.join(outputDir, "raw-remotion.mp4");
      const outputPath = path.join(outputDir, "output.mp4");
      const postProcessLogPath = path.join(outputDir, "audio-postprocess.log");
      const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
      const composition = await selectComposition({
      serveUrl: bundlePath,
      id: REMOTION_COMPOSITION_ID,
      inputProps: props,
      browserExecutable: browser,
      binariesDirectory,
      chromeMode: "headless-shell",
      onBrowserDownload: () => { throw new Error("Daojie Remotion 入口禁止隐式下载 Headless Shell"); },
      });
      await renderMedia({
      serveUrl: bundlePath,
      composition,
      inputProps: props,
      outputLocation: rawPath,
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      browserExecutable: browser,
      binariesDirectory,
      chromeMode: "headless-shell",
      enforceAudioTrack: true,
      overwrite: true,
      onBrowserDownload: () => { throw new Error("Daojie Remotion 入口禁止隐式下载 Headless Shell"); },
      });
      const audioPostProcess = await runTimelineAudioPostProcess({
      rawInputPath: rawPath,
      outputPath,
      logPath: postProcessLogPath,
      loudnessLufs: plan.renderSettings.loudnessLufs,
      truePeakDbtp: plan.renderSettings.truePeakDbtp,
      });
      const probe = await probeRenderedMedia(outputPath);
      const probePath = path.join(outputDir, "ffprobe.json");
      fs.writeFileSync(probePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
      const expectedDuration = composition.durationInFrames / composition.fps;
      assertRenderedMediaEvidence({
      label: "Daojie Remotion",
      probe,
      expectedDuration,
      fps: composition.fps,
      width: plan.renderSettings.width,
      height: plan.renderSettings.height,
      });
      const loudnessMeasurement = await measureRenderedMediaLoudness({
      filePath: outputPath,
      rawLogPath: path.join(outputDir, "loudness-measurement.log"),
      reportPath: path.join(outputDir, "loudness-measurement.json"),
      target: {
      integratedLufs: plan.renderSettings.loudnessLufs,
      truePeakDbtp: plan.renderSettings.truePeakDbtp,
      },
      });
      const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash },
      audioPostProcess,
      loudnessMeasurement,
      projectDir,
      artifactDir,
      outputPath,
      probePath,
      duration: probe.duration,
      expectedDuration,
      width: probe.width,
      height: probe.height,
      streams: probe.streams,
      sha256: await hashFileSha256(outputPath),
      };
      fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    } finally {
      await mediaBridge.revokeSession(session);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

function resolveProjectDir(): string {
  if (process.env.MYSTUDIO_DAOJIE_PROJECT_DIR?.trim()) return path.resolve(process.env.MYSTUDIO_DAOJIE_PROJECT_DIR);
  return path.join(os.homedir(), "Library", "Application Support", "漫影工作室", "projects", "_p", "49dce4c1-64b1-42de-85c2-9f266698aec0");
}

async function resolveBrowser(): Promise<string> {
  const adapters = createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser);
  const result = await adapters.probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); } });
  if (!result.executablePath || !path.isAbsolute(result.executablePath)) throw new Error("Remotion 浏览器探测未返回 executable path");
  return result.executablePath;
}

function readManifest(bundlePath: string): { remotionVersion: string; compositionId: string; contentHash: string } {
  const value = JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (typeof value.remotionVersion !== "string" || typeof value.compositionId !== "string" || typeof value.contentHash !== "string") throw new Error("Remotion bundle manifest 无效");
  return { remotionVersion: value.remotionVersion, compositionId: value.compositionId, contentHash: value.contentHash };
}

if (process.env.MYSTUDIO_DAOJIE_REMOTION_RUNNER === "1"
  || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  runDaojieRemotionTimeline().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
