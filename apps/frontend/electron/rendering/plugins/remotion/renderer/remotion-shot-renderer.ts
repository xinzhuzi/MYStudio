import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionMediaProbeStreamV1,
  RemotionRenderJobV1,
  RemotionShotDefinitionV1,
} from "@/types/remotion-workspace";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import {
  projectStoryboardShotCompositionProps,
  validateRemotionShotPlan,
} from "@/lib/studio/remotion/shot-plan";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import {
  remotionCurrentSlotPaths,
  buildRemotionCurrentSlot,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import {
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJobIdentity,
} from "@/lib/studio/remotion/remotion-render-validation";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderBrowserProbe,
  type RemotionRenderUtilityOptions,
} from "./remotion-render-utility";

const execFileAsync = promisify(execFile);

export interface RemotionShotRendererOptions {
  workspaceRoot: string;
  workspaceRootForProject?: (projectId: string) => string;
  bundlePath: string;
  workerPath: string;
  cwd: string;
  binariesDirectory: string;
  remotionVersion: string;
  resolveSourcePath: (sourcePath: string) => string;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: RemotionRenderUtilityOptions["fork"];
  emitProgress: (progress: { jobId: string; stage: string; ratio: number; message?: string }) => void;
  probeMedia?: (filePath: string) => Promise<RemotionShotProbe>;
}

export interface RemotionShotProbe {
  duration: number;
  width: number;
  height: number;
  streams: RemotionMediaProbeStreamV1[];
  raw?: unknown;
}

export interface RemotionShotProbeRaw {
  format?: { duration?: string | number };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    duration?: string | number;
    width?: number;
    height?: number;
    channels?: number;
    sample_rate?: string | number;
  }>;
}

export function selectRemotionShotVideoDuration(raw: RemotionShotProbeRaw): number {
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  return Number(video?.duration ?? raw.format?.duration ?? 0);
}

export type RemotionShotRenderResult =
  | { success: true; slot: RemotionCurrentSlotV1 }
  | { success: false; jobId: string; canceled: boolean; error: string };

/**
 * The S1 shot path: project-relative plan -> capability URLs -> Remotion
 * StoryboardShot -> staged MP4/evidence -> one current slot.  It never invokes
 * FFmpeg for generation or post-processing; ffprobe is read-only validation.
 */
export class RemotionShotRenderer {
  private readonly mediaBridge = new MediaBridgeServer();
  private readonly utility: RemotionRenderUtilitySupervisor;
  private disposed = false;

  constructor(private readonly options: RemotionShotRendererOptions) {
    if (!path.isAbsolute(options.workspaceRoot)) throw new Error("Remotion shot workspaceRoot 必须是绝对路径");
    this.utility = new RemotionRenderUtilitySupervisor({
      workerPath: options.workerPath,
      cwd: options.cwd,
      probeBrowser: options.probeBrowser,
      fork: options.fork,
      emitProgress: options.emitProgress,
    });
  }

  async render(plan: RemotionShotPlanV1): Promise<RemotionShotRenderResult> {
    const validated = await validateRemotionShotPlan(plan);
    const fallbackJobId = `shot:pending`;
    if (!validated.success) {
      return { success: false, jobId: fallbackJobId, canceled: false, error: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") };
    }
    if (this.disposed) return { success: false, jobId: fallbackJobId, canceled: false, error: "Remotion shot renderer 已关闭" };

    const bundle = readBundle(this.options.bundlePath, this.options.remotionVersion);
    const target = {
      kind: "shot" as const,
      chapterId: validated.value.chapterId,
      shotId: validated.value.shot.shotId,
      shotRevision: validated.value.shot.revision,
    };
    const renderSettingsHash = await sha256CanonicalJson(validated.value.renderSettings);
    const identity = {
      projectId: validated.value.projectId,
      target,
      inputHash: validated.value.inputHash,
      bundleContentHash: bundle.contentHash,
      renderSettingsHash,
    };
    const jobId = await createRemotionRenderJobId(identity);
    const workspaceRoot = this.options.workspaceRootForProject?.(identity.projectId) ?? this.options.workspaceRoot;
    const publicationId = crypto.randomUUID();
    const currentPaths = remotionCurrentSlotPaths(target);
    const stagingDir = path.join(workspaceRoot, "staging", publicationId);
    const stagedOutputPath = path.join(stagingDir, "output.mp4");
    let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await this.mediaBridge.listen();
      session = this.mediaBridge.createSession();
      const references = collectReferences(validated.value.shot);
      const sources: MediaBridgeClipSource[] = references.map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: this.options.resolveSourcePath(toProjectFileUrl(reference.projectId, reference.relativePath)),
      }));
      const urlByReference = buildMediaUrlMap(this.mediaBridge, session, sources);
      const projection = projectStoryboardShotCompositionProps(validated.value, (reference) => {
        const url = urlByReference[referenceKey(reference)];
        if (!url) throw new Error(`shot 素材 capability 缺失: ${reference.relativePath}`);
        return url;
      });
      if (!projection.success) throw new Error(projection.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const render = await this.utility.render({
        target: "shot",
        jobId,
        shotPlan: validated.value,
        compositionProps: projection.value,
        compositionId: "StoryboardShot",
        bundlePath: this.options.bundlePath,
        outputPath: stagedOutputPath,
        remotionVersion: this.options.remotionVersion,
        binariesDirectory: this.options.binariesDirectory,
      });
      if (!render.success) return render;

      const probe = await (this.options.probeMedia ?? probeMedia)(stagedOutputPath);
      const stagedStat = await fs.promises.stat(stagedOutputPath);
      const sha256 = await hashFile(stagedOutputPath);
      const startedAt = Date.now();
      const completedAt = Date.now();
      const job: RemotionRenderJobV1 = {
        schemaVersion: 1,
        jobId,
        projectId: identity.projectId,
        target,
        inputHash: identity.inputHash,
        bundleContentHash: identity.bundleContentHash,
        renderSettingsHash,
        templateVersion: bundle.templateVersion,
        remotionVersion: bundle.remotionVersion,
        status: "succeeded",
        attempt: 1,
        progress: 1,
        createdAt: startedAt,
        startedAt,
        completedAt,
        outputPath: currentPaths.outputPath,
        evidencePath: currentPaths.evidencePath,
      };
      const evidence: RemotionEvidenceV1 = {
        schemaVersion: 1,
        jobId,
        projectId: identity.projectId,
        target,
        inputHash: identity.inputHash,
        bundleContentHash: identity.bundleContentHash,
        renderSettingsHash,
        templateVersion: bundle.templateVersion,
        remotionVersion: bundle.remotionVersion,
        attempt: 1,
        compositionId: "StoryboardShot",
        renderer: { requested: "remotion", actual: "remotion" },
        outputPath: currentPaths.outputPath,
        sizeBytes: stagedStat.size,
        mtimeMs: Math.floor(stagedStat.mtimeMs),
        sha256,
        width: probe.width,
        height: probe.height,
        durationUs: Math.round(probe.duration * 1_000_000),
        streams: probe.streams,
        inputManifestPath: `chapters/${validated.value.chapterId}.json`,
        startedAt,
        completedAt,
      };
      const jobValidation = await validateRemotionRenderJobIdentity(job);
      if (!jobValidation.success) throw new Error(jobValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const evidenceValidation = await validateRemotionEvidenceIdentity(evidence);
      if (!evidenceValidation.success) throw new Error(evidenceValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const slot = buildRemotionCurrentSlot(identity.projectId, target, job, evidence, completedAt);
      const slotValidation = validateCurrentSlot(slot);
      if (!slotValidation.success) throw new Error(slotValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      await publishCurrentSlot(workspaceRoot, stagingDir, stagedOutputPath, slot);
      return { success: true, slot };
    } catch (error) {
      return { success: false, jobId, canceled: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (session) await this.mediaBridge.revokeSession(session).catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.utility.dispose();
    await this.mediaBridge.close();
  }

  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string } {
    return this.utility.cancel(jobId);
  }
}

export async function publishCurrentSlot(
  workspaceRoot: string,
  stagingDir: string,
  stagedOutputPath: string,
  slot: RemotionCurrentSlotV1,
): Promise<void> {
  const currentOutput = path.join(workspaceRoot, slot.outputPath);
  const currentJob = path.join(workspaceRoot, slot.jobPath);
  const currentEvidence = path.join(workspaceRoot, slot.evidencePath);
  const stagedJob = path.join(stagingDir, "job.json");
  const stagedEvidence = path.join(stagingDir, "evidence.json");
  const previousDir = path.join(stagingDir, "previous");
  await fs.promises.writeFile(stagedJob, `${JSON.stringify(slot.job, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(stagedEvidence, `${JSON.stringify(slot.evidence, null, 2)}\n`, "utf8");
  await fs.promises.mkdir(path.dirname(currentOutput), { recursive: true });
  await fs.promises.mkdir(path.dirname(currentJob), { recursive: true });
  await fs.promises.mkdir(path.dirname(currentEvidence), { recursive: true });
  await fs.promises.mkdir(previousDir, { recursive: true });
  const files = [
    { current: currentOutput, staged: stagedOutputPath, backup: path.join(previousDir, "output.mp4") },
    { current: currentJob, staged: stagedJob, backup: path.join(previousDir, "job.json") },
    { current: currentEvidence, staged: stagedEvidence, backup: path.join(previousDir, "evidence.json") },
  ];
  const previous = files.filter(({ current }) => fs.existsSync(current));
  try {
    for (const file of previous) await fs.promises.rename(file.current, file.backup);
    for (const file of files) await fs.promises.rename(file.staged, file.current);
  } catch (error) {
    for (const file of files) {
      if (fs.existsSync(file.current)) await fs.promises.rm(file.current, { force: true }).catch(() => undefined);
    }
    for (const file of previous) {
      if (fs.existsSync(file.backup)) await fs.promises.rename(file.backup, file.current).catch(() => undefined);
    }
    throw error;
  }
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
}

function collectReferences(shot: RemotionShotDefinitionV1) {
  const references = [
    shot.visualSource,
    ...shot.audioBindings.flatMap((binding) => binding.renderScope === "shot" ? [binding.source] : []),
  ];
  return [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()];
}

function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string {
  return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
}

function toProjectFileUrl(projectId: string, relativePath: string): string {
  return `project-file://${encodeURIComponent(projectId)}/${relativePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function readBundle(bundlePath: string, remotionVersion: string) {
  return assertBundleMatchesRuntime(
    JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as unknown,
    remotionVersion,
  );
}

async function probeMedia(filePath: string): Promise<RemotionShotProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,duration,width,height,channels,sample_rate",
    "-of", "json", filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout || "{}") as RemotionShotProbeRaw;
  const streams = raw.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video || video.codec_name !== "h264" || !audio || audio.codec_name !== "aac") {
    throw new Error("shot MP4 必须包含 h264 视频流和 aac 音频流");
  }
  return {
    raw,
    duration: selectRemotionShotVideoDuration(raw),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    streams: [
      { kind: "video", codec: "h264", width: Number(video.width ?? 0), height: Number(video.height ?? 0) },
      { kind: "audio", codec: "aac", channels: Number(audio.channels ?? 0), sampleRate: Number(audio.sample_rate ?? 0) },
    ],
  };
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
