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
  RemotionShotDefinitionV2,
} from "@/types/remotion-workspace";
import type {
  DepthEstimationArtifactV1,
  DepthEstimationRequestV1,
} from "@rendering/contracts/depth-workflow";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import {
  projectStoryboardShotCompositionProps,
  validateRemotionShotPlan,
} from "@/lib/studio/remotion/shot-plan";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
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
import type { CinematicCameraPreset, StoryboardShotCompositionProps } from "../composition/composition-props";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import {
  verifyRemotionAudioBindingSource,
  verifyRemotionProjectFileSource,
} from "../manifest/remotion-audio-source-verification";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderBrowserProbe,
  type RemotionRenderUtilityOptions,
} from "./remotion-render-utility";

/**
 * Optional depth-estimation adapter. When a validated shot plan contains a
 * cinematic config, the renderer calls `estimateDepth()` before projecting
 * composition props, then injects a `CinematicConfig` onto the visual clip so
 * `CinematicVisualClip` (@remotion/three) renders the image in 3D with a
 * depth-displaced plane and animated camera.
 *
 * Depth is a pure render-time artifact, while the persisted cinematic preset
 * and strengths stay in the shot plan so changing them invalidates the plan
 * hash. A cinematic plan without a usable depth adapter fails closed; a plain
 * image plan never calls the sidecar.
 */
export interface DepthAdapterLike {
  estimateDepth(request: DepthEstimationRequestV1): Promise<
    | { state: "ready"; artifact: DepthEstimationArtifactV1 }
    | { state: "blocked"; code: string; message: string }
  >;
}

const execFileAsync = promisify(execFile);

export interface RemotionShotRendererOptions {
  workspaceRoot: string;
  workspaceRootForProject?: (projectId: string) => string;
  projectRootForProject: (projectId: string) => string;
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
  /** Optional depth adapter. When present + visualKind=image, enables 3D cinematic mode. */
  depthAdapter?: DepthAdapterLike;
  /**
   * Cinematic preset used when depth is available. A getter keeps it live
   * (user/AI-changeable from settings) and receives the shotId so auto mode
   * can resolve per-shot AI-selected presets.
   */
  cinematicPreset?: CinematicCameraPreset | ((shotId: string) => CinematicCameraPreset);
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
    const currentDepthMapPath = path.posix.join(path.posix.dirname(currentPaths.outputPath), "current.depth.png");
    const stagingDir = path.join(workspaceRoot, "staging", publicationId);
    const stagedOutputPath = path.join(stagingDir, "output.mp4");
    let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
    let stagedDepthPath: string | undefined;
    let cinematicEvidence: RemotionEvidenceV1["cinematic"];
    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await this.mediaBridge.listen();
      session = this.mediaBridge.createSession();
      const sources = await collectVerifiedSources(
        validated.value.shot,
        this.options.projectRootForProject(identity.projectId),
        this.options.resolveSourcePath,
      );

      // --- Cinematic depth estimation (render-time consumption) ---
      // When depthAdapter is present and the visual is an image, estimate depth,
      // register the depth PNG on the media bridge, and inject a CinematicConfig
      // onto the projected visual clip. This is the wiring point that connects
      // the depth sidecar → @remotion/three CinematicVisualClip.
      let depthMapSrc: string | undefined;
      if (validated.value.cinematic) {
        if (!this.options.depthAdapter) {
          throw new Error("cinematic 深度运行时不可用: depth-adapter-missing");
        }
        const visualSource = sources.find((source) => source.clipId === referenceKey(validated.value.shot.visualSource));
        if (!visualSource) throw new Error("cinematic 深度输入素材缺失: visual-source-missing");
        const depthDir = path.join(stagingDir, "depth");
        const depthPath = path.join(depthDir, "depth.png");
        const depthResult = await this.options.depthAdapter.estimateDepth({
          schemaVersion: 1,
          projectId: identity.projectId,
          shotId: validated.value.shot.shotId,
          inputImagePath: visualSource.absolutePath,
          outputDepthPath: depthPath,
          model: "depth-anything-v2-small",
        });
        if (depthResult.state !== "ready") {
          throw new Error(`cinematic 深度估计被阻塞 [${depthResult.code}]: ${depthResult.message}`);
        }
        const artifact = depthResult.artifact;
        if (artifact.status !== "accepted"
          || artifact.projectId !== identity.projectId
          || artifact.shotId !== validated.value.shot.shotId
          || artifact.model !== "depth-anything-v2-small") {
          throw new Error("cinematic 深度估计 artifact 身份不一致");
        }
        if (!path.isAbsolute(artifact.outputPath)
          || path.resolve(artifact.outputPath) !== path.resolve(depthPath)
          || !fs.existsSync(artifact.outputPath)) {
          throw new Error("cinematic 深度估计返回了不存在的绝对输出路径");
        }
        if (artifact.inputSha256 !== validated.value.shot.visualSource.contentSha256) {
          throw new Error("cinematic 深度估计输入 SHA 与 shot visual source 不一致");
        }
        const actualDepthSha256 = await hashFile(artifact.outputPath);
        if (actualDepthSha256 !== artifact.outputSha256) {
          throw new Error("cinematic 深度估计输出 SHA 与磁盘字节不一致");
        }
        stagedDepthPath = artifact.outputPath;
        cinematicEvidence = {
          schemaVersion: 1,
          preset: validated.value.cinematic.preset,
          model: artifact.model,
          inputSha256: artifact.inputSha256,
          outputSha256: artifact.outputSha256,
          depthMapPath: currentDepthMapPath,
          width: artifact.width,
          height: artifact.height,
        };
        const depthAssetId = crypto.randomBytes(32).toString("hex");
        session.register(depthAssetId, artifact.outputPath);
        const [depthUrlEntry] = this.mediaBridge.buildUrls(session, [depthAssetId]);
        depthMapSrc = depthUrlEntry.url;
      }

      const urlByReference = buildMediaUrlMap(this.mediaBridge, session, sources);
      const projection = projectStoryboardShotCompositionProps(validated.value, (reference) => {
        const url = urlByReference[referenceKey(reference)];
        if (!url) throw new Error(`shot 素材 capability 缺失: ${reference.relativePath}`);
        return url;
      }, depthMapSrc);
      if (!projection.success) throw new Error(projection.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const compositionProps: StoryboardShotCompositionProps = projection.value;
      const render = await this.utility.render({
        target: "shot",
        jobId,
        shotPlan: validated.value,
        compositionProps,
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
        ...(cinematicEvidence ? { cinematic: cinematicEvidence } : {}),
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
      await publishCurrentSlot(workspaceRoot, stagingDir, stagedOutputPath, slot, {
        currentRelativePath: currentDepthMapPath,
        stagedPath: stagedDepthPath,
      });
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

export interface RemotionShotDepthPublication {
  currentRelativePath: string;
  stagedPath?: string;
}

export async function publishCurrentSlot(
  workspaceRoot: string,
  stagingDir: string,
  stagedOutputPath: string,
  slot: RemotionCurrentSlotV1,
  depthPublication?: RemotionShotDepthPublication,
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
  const promotedFiles = [
    { current: currentOutput, staged: stagedOutputPath, backup: path.join(previousDir, "output.mp4") },
    { current: currentJob, staged: stagedJob, backup: path.join(previousDir, "job.json") },
    { current: currentEvidence, staged: stagedEvidence, backup: path.join(previousDir, "evidence.json") },
  ];
  const depthCurrent = depthPublication
    ? path.join(workspaceRoot, depthPublication.currentRelativePath)
    : undefined;
  if (depthCurrent) await fs.promises.mkdir(path.dirname(depthCurrent), { recursive: true });
  if (depthCurrent && depthPublication?.stagedPath) {
    promotedFiles.push({
      current: depthCurrent,
      staged: depthPublication.stagedPath,
      backup: path.join(previousDir, "depth.png"),
    });
  }
  const replacementFiles = depthCurrent && !depthPublication?.stagedPath
    ? [...promotedFiles, { current: depthCurrent, staged: "", backup: path.join(previousDir, "depth.png") }]
    : promotedFiles;
  const previous = replacementFiles.filter(({ current }) => fs.existsSync(current));
  try {
    for (const file of previous) await fs.promises.rename(file.current, file.backup);
    for (const file of promotedFiles) await fs.promises.rename(file.staged, file.current);
  } catch (error) {
    for (const file of promotedFiles) {
      if (fs.existsSync(file.current)) await fs.promises.rm(file.current, { force: true }).catch(() => undefined);
    }
    for (const file of previous) {
      if (fs.existsSync(file.backup)) await fs.promises.rename(file.backup, file.current).catch(() => undefined);
    }
    throw error;
  }
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
}

async function collectVerifiedSources(
  shot: RemotionShotDefinitionV2,
  projectRoot: string,
  resolveSourcePath: (sourcePath: string) => string,
): Promise<MediaBridgeClipSource[]> {
  const sources = new Map<string, MediaBridgeClipSource>();
  const visualSourcePath = resolveSourcePath(buildProjectFileUrl(
    shot.visualSource.projectId,
    shot.visualSource.relativePath,
  ));
  const verifiedVisualSource = await verifyRemotionProjectFileSource(
    visualSourcePath,
    projectRoot,
    shot.visualSource.contentSha256,
    "visual_source",
  );
  sources.set(referenceKey(shot.visualSource), {
    clipId: referenceKey(shot.visualSource),
    absolutePath: verifiedVisualSource.filePath,
  });
  // M2:关键帧逐个校验入桥(帧1通常 ≡ visualSource,referenceKey 天然去重)
  for (const [index, frame] of (shot.keyframes ?? []).entries()) {
    const framePath = resolveSourcePath(buildProjectFileUrl(
      frame.source.projectId,
      frame.source.relativePath,
    ));
    const verified = await verifyRemotionProjectFileSource(
      framePath,
      projectRoot,
      frame.source.contentSha256,
      `keyframe_${index}`,
    );
    sources.set(referenceKey(frame.source), {
      clipId: referenceKey(frame.source),
      absolutePath: verified.filePath,
    });
  }
  for (const binding of shot.audioBindings) {
    const verified = await verifyRemotionAudioBindingSource(binding, projectRoot);
    sources.set(referenceKey(binding.source), {
      clipId: referenceKey(binding.source),
      absolutePath: verified.filePath,
    });
  }
  return [...sources.values()];
}

function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string {
  return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
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
