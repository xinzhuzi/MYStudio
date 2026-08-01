import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TimelineRenderPlan } from "@/types/editing";
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionMediaProbeStreamV1,
  RemotionRenderJobV1,
  RemotionRenderJobIdentityV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import {
  buildRemotionCurrentSlot,
  remotionCurrentSlotPaths,
  validateCurrentSlot,
} from "@/lib/studio/remotion/remotion-current-slot";
import {
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJobIdentity,
} from "@/lib/studio/remotion/remotion-render-validation";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  buildChapterVideoCompositionProps,
  mapEditedVoiceIntervals,
  type ChapterVideoCompositionResult,
} from "../composition/build-composition-props";
import { CHAPTER_VIDEO_COMPOSITION_ID } from "../composition/composition-id";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderBrowserProbe,
  type RemotionRenderUtilityOptions,
} from "./remotion-render-utility";
import { publishCurrentSlot } from "./remotion-shot-renderer";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import type { RemotionChapterManifestService } from "../manifest/remotion-chapter-manifest-service";
import {
  verifyRemotionAudioBindingSource,
  verifyRemotionProjectFileSource,
} from "../manifest/remotion-audio-source-verification";

const execFileAsync = promisify(execFile);

export interface RemotionChapterRendererOptions {
  workspaceRoot: string;
  workspaceRootForProject?: (projectId: string) => string;
  bundlePath: string;
  workerPath: string;
  cwd: string;
  binariesDirectory: string;
  remotionVersion: string;
  resolveSourcePath: (sourcePath: string) => string;
  projectRootForProject: (projectId: string) => string;
  chapterManifestService: Pick<RemotionChapterManifestService, "read">;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: RemotionRenderUtilityOptions["fork"];
  emitProgress: (progress: { jobId: string; stage: string; ratio: number; message?: string }) => void;
  probeMedia?: (filePath: string) => Promise<RemotionChapterProbe>;
}

export interface RemotionChapterRenderRequest {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  expectedJobId?: string;
}

export interface RemotionChapterProbe {
  duration: number;
  width: number;
  height: number;
  streams: RemotionMediaProbeStreamV1[];
  raw?: unknown;
}

export type RemotionChapterRenderResult =
  | { success: true; slot: RemotionCurrentSlotV1 }
  | { success: false; jobId: string; canceled: boolean; error: string };

export interface RemotionChapterRenderIdentity extends RemotionRenderJobIdentityV1 {
  jobId: string;
  target: Extract<RemotionRenderJobTarget, { kind: "chapter" }>;
}

export async function createRemotionChapterRenderIdentity(input: {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
}): Promise<RemotionChapterRenderIdentity> {
  const voiceIntervals = mapEditedVoiceIntervals(input);
  if (!voiceIntervals.success) {
    throw new Error(voiceIntervals.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
  }
  const renderSettingsHash = await sha256CanonicalJson(input.plan.renderSettings);
  const inputHash = await sha256CanonicalJson(jsonValueWithoutUndefined({
    schemaVersion: 1,
    target: "chapter",
    projectId: input.plan.projectId,
    chapterId: input.plan.episodeId,
    plan: {
      schemaVersion: input.plan.schemaVersion,
      projectId: input.plan.projectId,
      episodeId: input.plan.episodeId,
      editingProjectId: input.plan.editingProjectId,
      editingRevision: input.plan.editingRevision,
      sourceSnapshotHash: input.plan.sourceSnapshotHash,
      renderSettings: input.plan.renderSettings,
      clips: input.plan.clips,
      transitions: input.plan.transitions,
      effects: input.plan.effects,
    },
    chapterManifest: input.chapterManifest,
    mappedVoiceIntervals: voiceIntervals.value,
    shotSlots: [...input.currentShotSlots].sort(compareShotSlots).map((slot) => ({
      target: slot.target,
      job: {
        jobId: slot.job.jobId,
        inputHash: slot.job.inputHash,
        bundleContentHash: slot.job.bundleContentHash,
        renderSettingsHash: slot.job.renderSettingsHash,
      },
      evidence: {
        jobId: slot.evidence.jobId,
        inputHash: slot.evidence.inputHash,
        bundleContentHash: slot.evidence.bundleContentHash,
        renderSettingsHash: slot.evidence.renderSettingsHash,
        outputPath: slot.evidence.outputPath,
        outputSha256: slot.evidence.sha256,
      },
    })),
  }));
  const target = {
    kind: "chapter" as const,
    chapterId: input.plan.episodeId,
    editingProjectId: input.plan.editingProjectId,
    editingRevision: input.plan.editingRevision,
  };
  const identity = {
    projectId: input.plan.projectId,
    target,
    inputHash,
    bundleContentHash: input.bundleContentHash,
    renderSettingsHash,
  };
  return { ...identity, jobId: await createRemotionRenderJobId(identity) };
}

export async function createReadyRemotionChapterJob(input: {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  chapterManifest: RemotionChapterManifestV2;
  bundleContentHash: string;
  templateVersion: string;
  remotionVersion: string;
  now?: number;
}): Promise<RemotionRenderJobV1> {
  const identity = await createRemotionChapterRenderIdentity(input);
  return {
    schemaVersion: 1,
    ...identity,
    templateVersion: input.templateVersion,
    remotionVersion: input.remotionVersion,
    status: "ready",
    attempt: 0,
    progress: 0,
    createdAt: input.now ?? Date.now(),
  };
}

/** Direct ChapterVideo renderer. It never invokes FFmpeg for generation. */
export class RemotionChapterRenderer {
  private readonly mediaBridge = new MediaBridgeServer();
  private readonly utility: RemotionRenderUtilitySupervisor;
  private disposed = false;

  constructor(private readonly options: RemotionChapterRendererOptions) {
    if (!path.isAbsolute(options.workspaceRoot)) throw new Error("chapter workspaceRoot 必须是绝对路径");
    this.utility = new RemotionRenderUtilitySupervisor({
      workerPath: options.workerPath,
      cwd: options.cwd,
      probeBrowser: options.probeBrowser,
      fork: options.fork,
      emitProgress: options.emitProgress,
    });
  }

  async render(input: RemotionChapterRenderRequest): Promise<RemotionChapterRenderResult> {
    const planValidation = validateTimelineRenderPlan(input.plan);
    if (!planValidation.success) {
      return { success: false, jobId: "chapter:pending", canceled: false, error: planValidation.issues.map((issue) => issue.message).join("；") };
    }
    if (this.disposed) return { success: false, jobId: "chapter:pending", canceled: false, error: "Remotion chapter renderer 已关闭" };
    const plan = planValidation.value;
    let chapterManifest: RemotionChapterManifestV2;
    try {
      const current = await this.options.chapterManifestService.read(plan.projectId, plan.episodeId);
      if (!current) throw new Error("chapter_manifest_missing");
      chapterManifest = current;
      const sourceValidation = mapEditedVoiceIntervals({
        plan,
        currentShotSlots: input.currentShotSlots,
        chapterManifest,
      });
      if (!sourceValidation.success) {
        throw new Error(sourceValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      }
    } catch (error) {
      return {
        success: false,
        jobId: input.expectedJobId ?? "chapter:pending",
        canceled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const bundle = readBundle(this.options.bundlePath, this.options.remotionVersion);
    const identity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: input.currentShotSlots,
      chapterManifest,
      bundleContentHash: bundle.contentHash,
    });
    const { target, jobId } = identity;
    if (input.expectedJobId && input.expectedJobId !== jobId) {
      return {
        success: false,
        jobId: input.expectedJobId,
        canceled: false,
        error: "chapter manifest、voice intervals 或 shot evidence 已变化，render identity 失效",
      };
    }
    const workspaceRoot = this.options.workspaceRootForProject?.(identity.projectId) ?? this.options.workspaceRoot;
    const publicationId = crypto.randomUUID();
    const stagingDir = path.join(workspaceRoot, "staging", publicationId);
    const stagedOutputPath = path.join(stagingDir, "output.mp4");
    let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await this.mediaBridge.listen();
      session = this.mediaBridge.createSession();
      const visualClips = plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image");
      const mediaSources: MediaBridgeClipSource[] = [];
      for (const clip of visualClips) {
        const storyboardId = clip.source.evidence.storyboardId;
        const slot = input.currentShotSlots.find((candidate) => candidate.target.kind === "shot" && candidate.target.shotId === storyboardId);
        if (!slot || slot.target.kind !== "shot") throw new Error(`缺少当前 shot slot: ${storyboardId ?? clip.id}`);
        const sourcePath = this.options.resolveSourcePath(toProjectFileUrl(plan.projectId, slot.outputPath));
        const verified = await verifyRemotionProjectFileSource(
          sourcePath,
          workspaceRoot,
          slot.evidence.sha256,
          "shot_slot",
        );
        await assertReadableFile(verified.filePath, clip.id);
        mediaSources.push({ clipId: clip.id, absolutePath: verified.filePath });
      }
      for (const binding of chapterManifest.sharedAudioBindings) {
        const mediaId = chapterAudioMediaId(binding.bindingId);
        const { filePath: sourcePath } = await verifyRemotionAudioBindingSource(
          binding,
          this.options.projectRootForProject(plan.projectId),
        );
        await assertReadableFile(sourcePath, binding.bindingId);
        mediaSources.push({ clipId: mediaId, absolutePath: sourcePath });
      }
      const mediaUrlByClipId = buildMediaUrlMap(this.mediaBridge, session, mediaSources);
      const mediaUrlByBindingId = Object.fromEntries(
        chapterManifest.sharedAudioBindings.map((binding) => [
          binding.bindingId,
          mediaUrlByClipId[chapterAudioMediaId(binding.bindingId)],
        ]),
      );
      const projected: ChapterVideoCompositionResult = buildChapterVideoCompositionProps({
        plan,
        currentShotSlots: input.currentShotSlots,
        chapterManifest,
        mediaUrlByClipId,
        mediaUrlByBindingId,
      });
      if (!projected.success) throw new Error(projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      const render = await this.utility.render({
        target: "chapter",
        jobId,
        compositionProps: projected.value,
        compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
        bundlePath: this.options.bundlePath,
        outputPath: stagedOutputPath,
        remotionVersion: this.options.remotionVersion,
        binariesDirectory: this.options.binariesDirectory,
      });
      if (!render.success) {
        const quarantineError = await quarantineRemotionPartialOutput(stagedOutputPath);
        return {
          ...render,
          error: [render.error, quarantineError].filter(Boolean).join("; "),
        };
      }
      const probe = await (this.options.probeMedia ?? probeMedia)(stagedOutputPath);
      const stat = await fs.promises.stat(stagedOutputPath);
      const sha256 = await hashFile(stagedOutputPath);
      const startedAt = Date.now();
      const completedAt = Date.now();
      const currentPaths = remotionCurrentSlotPaths(target);
      const job: RemotionRenderJobV1 = {
        schemaVersion: 1,
        ...identity,
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
        ...identity,
        jobId,
        templateVersion: bundle.templateVersion,
        remotionVersion: bundle.remotionVersion,
        attempt: 1,
        compositionId: CHAPTER_VIDEO_COMPOSITION_ID,
        renderer: { requested: "remotion", actual: "remotion" },
        outputPath: currentPaths.outputPath,
        sizeBytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        sha256,
        width: probe.width,
        height: probe.height,
        durationUs: Math.round(probe.duration * 1_000_000),
        streams: probe.streams,
        inputManifestPath: `chapters/${plan.episodeId}.json`,
        renderPlanPath: `jobs/chapter/${plan.episodeId}/current-render-plan.json`,
        snapshotPath: `jobs/chapter/${plan.episodeId}/current-editing-project.json`,
        startedAt,
        completedAt,
      };
      const jobResult = await validateRemotionRenderJobIdentity(job);
      if (!jobResult.success) throw new Error(jobResult.issues.map((issue) => issue.message).join("；"));
      const evidenceResult = await validateRemotionEvidenceIdentity(evidence);
      if (!evidenceResult.success) throw new Error(evidenceResult.issues.map((issue) => issue.message).join("；"));
      const slot = buildRemotionCurrentSlot(plan.projectId, target, job, evidence, completedAt);
      const slotResult = validateCurrentSlot(slot);
      if (!slotResult.success) throw new Error(slotResult.issues.map((issue) => issue.message).join("；"));
      await fs.promises.mkdir(path.join(workspaceRoot, "jobs", "chapter", plan.episodeId), { recursive: true });
      await fs.promises.writeFile(path.join(workspaceRoot, evidence.renderPlanPath!), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      await fs.promises.writeFile(path.join(workspaceRoot, evidence.snapshotPath!), `${JSON.stringify(plan.editingProjectSnapshot, null, 2)}\n`, "utf8");
      await publishCurrentSlot(workspaceRoot, stagingDir, stagedOutputPath, slot);
      return { success: true, slot };
    } catch (error) {
      const quarantineError = await quarantineRemotionPartialOutput(stagedOutputPath);
      return {
        success: false,
        jobId,
        canceled: false,
        error: [error instanceof Error ? error.message : String(error), quarantineError].filter(Boolean).join("; "),
      };
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

async function assertReadableFile(filePath: string, clipId: string): Promise<void> {
  if (!path.isAbsolute(filePath)) throw new Error(`chapter 素材不是绝对路径: ${clipId}`);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`chapter 素材不可读或为空: ${clipId}`);
  await fs.promises.access(filePath, fs.constants.R_OK);
}

function chapterAudioMediaId(bindingId: string): string {
  return `chapter-audio:${bindingId}`;
}

function compareShotSlots(left: RemotionCurrentSlotV1, right: RemotionCurrentSlotV1): number {
  const leftShotId = left.target.kind === "shot" ? left.target.shotId : "";
  const rightShotId = right.target.kind === "shot" ? right.target.shotId : "";
  return leftShotId.localeCompare(rightShotId);
}

function jsonValueWithoutUndefined(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function readBundle(bundlePath: string, remotionVersion: string) {
  return assertBundleMatchesRuntime(
    JSON.parse(fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as unknown,
    remotionVersion,
  );
}

async function probeMedia(filePath: string): Promise<RemotionChapterProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,duration,width,height,channels,sample_rate",
    "-of", "json", filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout || "{}") as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string | number; width?: number; height?: number; channels?: number; sample_rate?: string | number }>;
  };
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  const audio = raw.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || video.codec_name !== "h264" || !audio || audio.codec_name !== "aac") throw new Error("ChapterVideo MP4 必须包含 h264 视频流和 aac 音频流");
  return {
    raw,
    duration: Number(video.duration ?? raw.format?.duration ?? 0),
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

function toProjectFileUrl(projectId: string, relativePath: string): string {
  return `project-file://${encodeURIComponent(projectId)}/${relativePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}
