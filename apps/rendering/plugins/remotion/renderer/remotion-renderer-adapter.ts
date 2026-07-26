import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  TimelineRenderCancelResult,
  TimelineRenderEvidence,
  TimelineRenderPlan,
  TimelineRenderProgress,
  TimelineRenderResult,
  TimelineAudioPostProcessEvidence,
  TimelineRendererEvidence,
} from "@/types/editing";
import type { TimelineRendererAdapter } from "@rendering/runtime/renderer-registry";
import {
  runTimelineAudioPostProcess,
  type TimelineAudioPostProcessExec,
} from "@rendering/runtime/ffmpeg/timeline-audio-postprocess";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import { REMOTION_COMPOSITION_ID } from "../composition/composition-id";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderBrowserProbe,
  type RemotionRenderUtilityOptions,
} from "./remotion-render-utility";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";

const execFileAsync = promisify(execFile);

export interface RemotionRendererAdapterOptions {
  renderRoot: string;
  bundlePath: string;
  workerPath: string;
  cwd: string;
  binariesDirectory: string;
  resolveSourcePath: (sourcePath: string) => string;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: RemotionRenderUtilityOptions["fork"];
  remotionVersion: string;
  emitProgress: (progress: TimelineRenderProgress) => void;
  runAudioPostProcess?: typeof runTimelineAudioPostProcess;
  postProcessExec?: TimelineAudioPostProcessExec;
  probeMedia?: (filePath: string) => Promise<RemotionMediaProbe>;
}

interface RemotionMediaProbe {
  raw: unknown;
  duration: number;
  width: number;
  height: number;
  streams: string[];
}

export interface RemotionRendererAdapter extends TimelineRendererAdapter {
  dispose: () => Promise<void>;
}

export function createRemotionRendererAdapter(
  options: RemotionRendererAdapterOptions,
): RemotionRendererAdapter {
  const mediaBridge = new MediaBridgeServer();
  const utility = new RemotionRenderUtilitySupervisor({
    workerPath: options.workerPath,
    cwd: options.cwd,
    probeBrowser: options.probeBrowser,
    fork: options.fork,
    emitProgress: (progress) => options.emitProgress({
      jobId: progress.jobId,
      stage: progress.stage,
      ratio: progress.ratio,
      message: progress.message,
    }),
  });

  return {
    id: "remotion",
    async render(plan, context) {
      return renderRemotionPlan(plan, context.renderer, options, mediaBridge, utility);
    },
    cancel: (jobId) => utility.cancel(jobId) as TimelineRenderCancelResult,
    async dispose() {
      utility.dispose();
      await mediaBridge.close();
    },
  };
}

async function renderRemotionPlan(
  plan: TimelineRenderPlan,
  renderer: TimelineRendererEvidence,
  options: RemotionRendererAdapterOptions,
  mediaBridge: MediaBridgeServer,
  utility: RemotionRenderUtilitySupervisor,
): Promise<TimelineRenderResult> {
  const jobDir = path.join(options.renderRoot, "timeline-jobs", `${safePathSegment(plan.jobId)}-${Date.now()}`);
  const rawOutputPath = path.join(jobDir, "raw-remotion.mp4");
  const outputPath = path.join(jobDir, "output.mp4");
  const postProcessLogPath = path.join(jobDir, "audio-postprocess.log");
  const resultPath = path.join(jobDir, "result.json");
  const snapshotPath = path.join(jobDir, "editing-project.json");
  const renderPlanPath = path.join(jobDir, "render-plan.json");
  const inputManifestPath = path.join(jobDir, "input-manifest.json");
  const ffprobePath = path.join(jobDir, "ffprobe.json");
  let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
  try {
    await fs.promises.mkdir(jobDir, { recursive: true });
    await fs.promises.writeFile(snapshotPath, stableJson(plan.editingProjectSnapshot), "utf8");
    await fs.promises.writeFile(renderPlanPath, stableJson(plan), "utf8");
    const mediaClips = plan.clips.filter((clip) => clip.source.kind !== "text" && clip.source.path);
    await mediaBridge.listen();
    session = mediaBridge.createSession();
    const mediaSources: MediaBridgeClipSource[] = [];
    const inputManifest = [] as Array<{ clipId: string; sourcePath: string; url: string }>;
    for (const clip of mediaClips) {
      const sourcePath = options.resolveSourcePath(clip.source.path!);
      if (!path.isAbsolute(sourcePath)) throw new Error(`片段素材不是绝对路径: ${clip.id}`);
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile() || stat.size <= 0) throw new Error(`片段素材不可读或为空: ${clip.id}`);
      fs.accessSync(sourcePath, fs.constants.R_OK);
      mediaSources.push({ clipId: clip.id, absolutePath: sourcePath });
      inputManifest.push({ clipId: clip.id, sourcePath, url: "[redacted]" });
    }
    const mediaUrlByClipId = buildMediaUrlMap(mediaBridge, session, mediaSources);
    await fs.promises.writeFile(inputManifestPath, stableJson(inputManifest), "utf8");
    const manifest = readBundleManifest(options.bundlePath, options.remotionVersion);
    const result = await utility.render({
      plan,
      bundlePath: options.bundlePath,
      outputPath: rawOutputPath,
      remotionVersion: options.remotionVersion,
      mediaUrlByClipId,
      binariesDirectory: options.binariesDirectory,
    });
    if (!result.success) {
      const quarantineError = await quarantineRemotionPartialOutput(rawOutputPath);
      const failure: TimelineRenderResult = {
        success: false,
        jobId: plan.jobId,
        canceled: result.canceled,
        error: [result.error, quarantineError].filter(Boolean).join("; "),
      };
      await fs.promises.writeFile(resultPath, stableJson(failure), "utf8");
      return failure;
    }
    options.emitProgress({
      jobId: plan.jobId,
      stage: "postprocessing",
      ratio: 0.94,
      message: "FFmpeg loudnorm 后处理",
    });
    const postProcess = options.runAudioPostProcess ?? runTimelineAudioPostProcess;
    const audioPostProcess = await postProcess(
      {
        rawInputPath: rawOutputPath,
        outputPath,
        logPath: postProcessLogPath,
        loudnessLufs: plan.renderSettings.loudnessLufs,
        truePeakDbtp: plan.renderSettings.truePeakDbtp,
      },
      options.postProcessExec,
    ) as TimelineAudioPostProcessEvidence;
    options.emitProgress({
      jobId: plan.jobId,
      stage: "probing",
      ratio: 0.97,
      message: "核验 Remotion 最终成片",
    });
    const probe = await (options.probeMedia ?? probeMedia)(outputPath);
    await fs.promises.writeFile(ffprobePath, stableJson(probe.raw), "utf8");
    const stat = await fs.promises.stat(outputPath);
    const evidence: TimelineRenderEvidence = {
      jobId: plan.jobId,
      path: outputPath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: await hashFile(outputPath),
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      streams: probe.streams,
      snapshotHash: crypto.createHash("sha256").update(stableJson(plan.editingProjectSnapshot)).digest("hex"),
      snapshotPath,
      renderPlanPath,
      inputManifestPath,
      logPath: postProcessLogPath,
      ffprobePath,
      renderer: { ...renderer, version: options.remotionVersion, bundleVersion: manifest.contentHash },
      audioPostProcess,
    };
    const success: TimelineRenderResult = { success: true, evidence };
    await fs.promises.writeFile(resultPath, stableJson(success), "utf8");
    options.emitProgress({
      jobId: plan.jobId,
      stage: "completed",
      ratio: 1,
      message: "Remotion 成片核验完成",
    });
    return success;
  } catch (error) {
    const quarantineErrors = await Promise.all([
      quarantineRemotionPartialOutput(rawOutputPath),
      quarantineRemotionPartialOutput(outputPath),
    ]);
    const message = [
      error instanceof Error ? error.message : String(error),
      ...quarantineErrors,
    ].filter(Boolean).join("; ");
    const failure: TimelineRenderResult = { success: false, jobId: plan.jobId, canceled: false, error: message };
    await fs.promises.writeFile(resultPath, stableJson(failure), "utf8").catch(() => undefined);
    return failure;
  } finally {
    if (session) await mediaBridge.revokeSession(session).catch(() => undefined);
  }
}

function readBundleManifest(bundlePath: string, remotionVersion: string): { contentHash: string } {
  const value = JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.remotionVersion !== remotionVersion || value.compositionId !== REMOTION_COMPOSITION_ID || typeof value.contentHash !== "string") {
    throw new Error("Remotion bundle manifest 与当前运行时版本或 composition 不一致");
  }
  return { contentHash: value.contentHash };
}

async function probeMedia(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout || "{}") as { format?: { duration?: string | number }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  return { raw, duration: Number(raw.format?.duration || 0), width: Number(video?.width || 0), height: Number(video?.height || 0), streams: (raw.streams ?? []).map((stream) => stream.codec_type ?? "").filter(Boolean) };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safePathSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || crypto.randomUUID();
}
