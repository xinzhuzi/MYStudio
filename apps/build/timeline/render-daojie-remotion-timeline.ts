import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { validateChapterVideoCompositionProps, validateCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { buildChapterVideoCompositionProps, buildCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { CHAPTER_VIDEO_COMPOSITION_ID, REMOTION_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { createTimelineRenderRecord } from "@/lib/studio/editing/chapter-editing-pipeline";
import { validateEditingProject, validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  deriveStorageRoots,
  resolveProjectDir,
  resolveTimelineSourcePath,
  resolveUserDataDir,
} from "./daojie-storage-paths";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  probeRenderedMedia,
} from "../remotion/render-smoke-evidence";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import {
  resolveRemotionCurrentSlotOutputPath,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";

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
  const remotionOnly = process.env.MYSTUDIO_DAOJIE_REMOTION_ONLY === "1";
  const currentShotSlots = remotionOnly ? loadCurrentShotSlots(plan.projectId, plan.episodeId) : [];
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest = readManifest(bundlePath);
  if (manifest.remotionVersion !== remotionVersion) throw new Error("Daojie Remotion bundle manifest 与运行时不一致");
  if (remotionOnly && !manifest.compositionIds.includes(CHAPTER_VIDEO_COMPOSITION_ID)) throw new Error("Daojie Remotion bundle 缺少 ChapterVideo composition");
  if (!remotionOnly && manifest.compositionId !== REMOTION_COMPOSITION_ID) throw new Error("兼容 Daojie Timeline bundle manifest 与运行时不一致");
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
  const runtimeDir = path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR || path.join(resolveUserDataDir(), "remotion-runtime"));
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
    const mediaSources = remotionOnly
      ? [
          ...plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image").map((clip) => {
            const storyboardId = clip.source.evidence.storyboardId;
            const slot = currentShotSlots.find((candidate) => candidate.target.kind === "shot" && candidate.target.shotId === storyboardId);
            if (!slot || slot.target.kind !== "shot") throw new Error(`缺少当前 shot slot: ${storyboardId || clip.id}`);
            return {
              clipId: clip.id,
              absolutePath: resolveRemotionCurrentSlotOutputPath(
                path.join(projectDir, "remotion"),
                slot,
              ),
            };
          }),
          ...plan.clips.filter((clip) => ["voice", "bgm", "sfx"].includes(clip.trackKind) && clip.source.path).map((clip) => ({
            clipId: clip.id,
            absolutePath: resolveTimelineSourcePath({ sourcePath: clip.source.path!, dataRoot: roots.dataRoot, mediaRoot: roots.mediaRoot }),
          })),
        ]
      : plan.clips.filter((clip) => clip.source.path).map((clip) => ({
          clipId: clip.id,
          absolutePath: resolveTimelineSourcePath({ sourcePath: clip.source.path!, dataRoot: roots.dataRoot, mediaRoot: roots.mediaRoot }),
        }));
    const mediaUrlByClipId = buildMediaUrlMap(mediaBridge, session, mediaSources);
      const chapterAudioClipIds = plan.clips.filter((clip) => ["voice", "bgm", "sfx"].includes(clip.trackKind)).map((clip) => clip.id);
      const props = remotionOnly
        ? (() => {
            const projected = buildChapterVideoCompositionProps({ plan, currentShotSlots, mediaUrlByClipId, chapterAudioClipIds });
            if (!projected.success) throw new Error(projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
            return projected.value;
          })()
        : buildCompositionProps(plan, mediaUrlByClipId);
      const propsValidation = remotionOnly ? validateChapterVideoCompositionProps(props) : validateCompositionProps(props);
      if (!propsValidation.success) throw new Error(propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const compositionId = remotionOnly ? CHAPTER_VIDEO_COMPOSITION_ID : REMOTION_COMPOSITION_ID;
      const rawPath = path.join(outputDir, "raw-remotion.mp4");
      const outputPath = path.join(outputDir, "output.mp4");
      const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
      const composition = await selectComposition({
      serveUrl: bundlePath,
      id: compositionId,
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
      // Remotion owns the final MP4. No FFmpeg concat, loudness pass, or second encode is allowed.
      await fs.promises.copyFile(rawPath, outputPath);
      const probe = await probeRenderedMedia(outputPath);
      const probePath = path.join(outputDir, "ffprobe.json");
      const filterGraphPath = path.join(outputDir, "filter-graph.txt");
      fs.writeFileSync(probePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
      // Remotion renders the complete composition natively; retain an explicit
      // artifact for the shared evidence contract without invoking FFmpeg.
      fs.writeFileSync(filterGraphPath, "none (Remotion-native composition; no FFmpeg filter graph)\n", "utf8");
      const expectedDuration = composition.durationInFrames / composition.fps;
      assertRenderedMediaEvidence({
      label: "Daojie Remotion",
      probe,
      expectedDuration,
      fps: composition.fps,
      width: plan.renderSettings.width,
      height: plan.renderSettings.height,
      });
      const editingProjectPath = path.join(artifactDir, "editing-project.json");
      const editingProjectValue = fs.existsSync(editingProjectPath)
        ? JSON.parse(fs.readFileSync(editingProjectPath, "utf8")) as unknown
        : undefined;
      const editingProject = editingProjectValue
        ? validateEditingProject(editingProjectValue)
        : undefined;
      if (editingProject && !editingProject.success) {
        throw new Error(editingProject.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      }
      const snapshotHash = editingProject?.success
        ? await hashFileSha256(editingProjectPath)
        : plan.sourceSnapshotHash;
      const evidence = {
        jobId: plan.jobId,
        path: outputPath,
        sizeBytes: fs.statSync(outputPath).size,
        mtimeMs: fs.statSync(outputPath).mtimeMs,
        sha256: await hashFileSha256(outputPath),
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        streams: probe.streams,
        snapshotHash,
        snapshotPath: editingProject?.success ? editingProjectPath : planPath,
        renderPlanPath: planPath,
        inputManifestPath: planPath,
        filterGraphPath,
        logPath: path.join(outputDir, "remotion-render.log"),
        ffprobePath: probePath,
        renderer: { requested: "remotion" as const, actual: "remotion" as const, version: remotionVersion, bundleVersion: manifest.contentHash },
      };
      fs.writeFileSync(evidence.logPath, "renderer=remotion\npostprocess=none\n", "utf8");
      const timelineRenderRecord = editingProject?.success
        ? createTimelineRenderRecord(editingProject.value, evidence, Date.now())
        : undefined;
      const timelineRenderRecordPath = path.join(artifactDir, "timeline-render-record.json");
      if (timelineRenderRecord && !timelineRenderRecord.success) {
        throw new Error(timelineRenderRecord.issues.map((issue) => issue.message).join("；"));
      }
      if (timelineRenderRecord?.success) {
        fs.writeFileSync(timelineRenderRecordPath, `${JSON.stringify(timelineRenderRecord.value, null, 2)}\n`, "utf8");
      }
      const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      renderer: { requested: "remotion", actual: "remotion", version: remotionVersion, bundleVersion: manifest.contentHash },
      audioPostProcess: null,
      ffmpegPostProcess: false,
      projectDir,
      artifactDir,
      outputPath,
      probePath,
      duration: probe.duration,
      expectedDuration,
      width: probe.width,
      height: probe.height,
      streams: probe.streams,
      sha256: evidence.sha256,
      evidence,
      timelineRenderRecord: timelineRenderRecord?.success ? timelineRenderRecord.value : undefined,
      timelineRenderRecordPath,
      progressHistoryPath: path.join(artifactDir, "progress-history.json"),
      runnerReportPath: path.join(outputDir, "report.json"),
      editingProject: editingProject?.success ? editingProject.value : undefined,
      sourceCounts: { clips: plan.clips.length },
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

async function resolveBrowser(): Promise<string> {
  const adapters = createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser);
  const result = await adapters.probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装，请先在设置页手动下载"); } });
  if (!result.executablePath || !path.isAbsolute(result.executablePath)) throw new Error("Remotion 浏览器探测未返回 executable path");
  return result.executablePath;
}

function loadCurrentShotSlots(projectId: string, episodeId: string): RemotionCurrentSlotV1[] {
  const reportPath = process.env.MYSTUDIO_DAOJIE_SHOT_REPORT
    || path.resolve(appsRoot, "output", "automation", "daojie-chapter001-shot-slots.json");
  if (!fs.existsSync(reportPath)) throw new Error(`Remotion shot slot report 不存在: ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  if (report.projectId !== projectId || report.chapterId !== episodeId || !Array.isArray(report.slots)) {
    throw new Error("Remotion shot slot report identity 不匹配");
  }
  return report.slots.map((value, index) => {
    const validation = validateCurrentSlot(value);
    if (!validation.success) throw new Error(`Remotion shot slot ${index} 无效: ${validation.issues.map((issue) => issue.message).join("；")}`);
    return validation.value;
  });
}

function readManifest(bundlePath: string): { remotionVersion: string; compositionId: string; compositionIds: string[]; contentHash: string } {
  const value = JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (typeof value.remotionVersion !== "string" || typeof value.compositionId !== "string" || !Array.isArray(value.compositionIds) || typeof value.contentHash !== "string") throw new Error("Remotion bundle manifest 无效");
  return {
    remotionVersion: value.remotionVersion,
    compositionId: value.compositionId,
    compositionIds: value.compositionIds.filter((item): item is string => typeof item === "string"),
    contentHash: value.contentHash,
  };
}

if (process.env.MYSTUDIO_DAOJIE_REMOTION_RUNNER === "1"
  || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  runDaojieRemotionTimeline().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
