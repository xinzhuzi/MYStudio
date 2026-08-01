import { createRequire } from "node:module";
import path from "node:path";
import type { LogLevel } from "@remotion/renderer";
import type { RenderJob, RenderJobWithCleanup } from "@remotion/studio-shared";
import type { RemotionStudioInternalStartOptions } from "./remotion-studio-internals";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { TimelineRenderPlan } from "@/types/editing";

const require = createRequire(import.meta.url);

/**
 * The Studio server does not export QueueMethods from its package root. Keep
 * this small structural adapter local so the host does not depend on an
 * internal package path while preserving the native callback shape.
 */
type RemotionStudioQueueMethods = {
  removeJob: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
  addJob: (input: {
    job: RenderJobWithCleanup;
    entryPoint: string;
    remotionRoot: string;
    logLevel: LogLevel;
  }) => void;
};

export interface MinimalRemotionStudioStartOptionsInput {
  readonly appsRoot: string;
  readonly entryPoint: string;
  readonly publicDir?: string;
  readonly renderQueue?: {
    getRenderQueue: () => RenderJob[];
    queueMethods: RemotionStudioQueueMethods;
  };
}

export interface RemotionStudioChapterRenderContext {
  readonly projectId: string;
  readonly chapterId: string;
  readonly revision: number;
  readonly plan: TimelineRenderPlan;
  readonly currentShotSlots: readonly RemotionCurrentSlotV1[];
}

export interface RemotionStudioRenderQueueBridgeOptions {
  readonly getContext: () => RemotionStudioChapterRenderContext | undefined;
  readonly enqueueChapter: (input: {
    context: RemotionStudioChapterRenderContext;
    studioJobId: string;
  }) => Promise<{ accepted: boolean; job?: RemotionRenderJobV1; message?: string }>;
  readonly getJob: (jobId: string) => RemotionRenderJobV1 | undefined;
  readonly cancelJob: (jobId: string) => { success: boolean; canceled: boolean; error?: string };
}

/** Adapts Remotion Studio's native queue callbacks to MYStudio's durable queue. */
export class RemotionStudioRenderQueueBridge {
  private readonly jobs = new Map<string, RenderJob>();
  private readonly nativeToRemotion = new Map<string, string>();

  constructor(private readonly options: RemotionStudioRenderQueueBridgeOptions) {}

  getRenderQueue = (): RenderJob[] => {
    for (const [studioJobId, job] of this.jobs) {
      const remotionJobId = this.nativeToRemotion.get(studioJobId);
      if (remotionJobId) syncNativeJob(job, this.options.getJob(remotionJobId));
    }
    return [...this.jobs.values()];
  };

  queueMethods: RemotionStudioQueueMethods = {
    addJob: ({ job }) => {
      this.jobs.set(job.id, job);
      const context = this.options.getContext();
      if (!context) {
        markNativeJobFailed(job, "当前章节 Studio context 不可用");
        return;
      }
      if (job.compositionId !== "ChapterVideo") {
        markNativeJobFailed(job, "原生 Studio 只允许导出当前章 ChapterVideo");
        return;
      }
      if ([...this.jobs.values()].some((item) => item.id !== job.id && item.status !== "done")) {
        markNativeJobFailed(job, "当前章节已有一个活动 ChapterVideo render job");
        return;
      }
      void this.options.enqueueChapter({ context, studioJobId: job.id }).then((result) => {
        if (!result.accepted || !result.job) {
          markNativeJobFailed(job, result.message ?? "ChapterVideo render 被队列拒绝");
          return;
        }
        this.nativeToRemotion.set(job.id, result.job.jobId);
        syncNativeJob(job, result.job);
      }).catch((error: unknown) => {
        markNativeJobFailed(job, error instanceof Error ? error.message : String(error));
      });
    },
    cancelJob: (studioJobId) => {
      const job = this.jobs.get(studioJobId);
      const remotionJobId = this.nativeToRemotion.get(studioJobId);
      if (!job || !remotionJobId) return;
      const result = this.options.cancelJob(remotionJobId);
      if (!result.success) markNativeJobFailed(job, result.error ?? "ChapterVideo render 取消失败");
    },
    removeJob: (studioJobId) => {
      this.jobs.delete(studioJobId);
      this.nativeToRemotion.delete(studioJobId);
    },
  };
}

export function buildMinimalRemotionStudioStartOptions(
  input: MinimalRemotionStudioStartOptionsInput,
): RemotionStudioInternalStartOptions {
  if (!path.isAbsolute(input.appsRoot)) {
    throw new Error("appsRoot 必须是绝对路径");
  }
  if (!path.isAbsolute(input.entryPoint)) {
    throw new Error("entryPoint 必须是绝对路径");
  }
  const publicDir = input.publicDir ?? path.join(input.appsRoot, "public");
  return {
    entry: require.resolve("@remotion/studio/previewEntry"),
    userDefinedComponent: input.entryPoint,
    bundlerOverride: undefined,
    rspackOverride: undefined,
    webpackOverride: undefined,
    getCurrentInputProps: () => ({}),
    getEnvVariables: () => ({}),
    port: null,
    remotionRoot: input.appsRoot,
    publicDir,
    poll: null,
    staticHash: "/static-mystudio-probe",
    staticHashPrefix: "/static-",
    outputHash: "/outputs-mystudio-probe",
    outputHashPrefix: "/outputs-",
    logLevel: "error",
    getRenderQueue: input.renderQueue?.getRenderQueue ?? (() => []),
    getRenderDefaults: buildRenderDefaults,
    getNumberOfAudioTags: () => 0,
    queueMethods: input.renderQueue?.queueMethods ?? {
      addJob: () => undefined,
      cancelJob: () => undefined,
      removeJob: () => undefined,
    },
    gitSource: null,
    binariesDirectory: null,
    forceIPv4: true,
    getAudioLatencyHint: () => null,
    getPreviewSampleRate: () => null,
    enableCrossSiteIsolation: false,
    forceNew: true,
    rspack: false,
    getStudioRuntimeConfig: () => ({
      maxTimelineTracks: null,
      askAIEnabled: false,
      interactivityEnabled: true,
      keyboardShortcutsEnabled: true,
      bufferStateDelayInMilliseconds: null,
    }),
    configFile: null,
  };
}

function markNativeJobFailed(job: RenderJob, message: string): void {
  Object.assign(job, {
    status: "failed" as const,
    error: { message, stack: undefined },
  });
}

function syncNativeJob(job: RenderJob, remotionJob: RemotionRenderJobV1 | undefined): void {
  if (!remotionJob) return;
  if (remotionJob.status === "succeeded") {
    Object.assign(job, { status: "done" as const });
    return;
  }
  if (remotionJob.status === "failed" || remotionJob.status === "canceled" || remotionJob.status === "blocked") {
    markNativeJobFailed(job, remotionJob.error?.message ?? `Remotion job ${remotionJob.status}`);
    return;
  }
  if (remotionJob.status === "running" || remotionJob.status === "queued") {
    Object.assign(job, {
      status: "running" as const,
      progress: {
      message: "Remotion ChapterVideo 正在渲染",
      value: remotionJob.progress,
      rendering: null,
      stitching: null,
      downloads: [],
      bundling: null,
      browser: { progress: 0, doneIn: null, alreadyAvailable: true },
      copyingState: { bytes: 0, doneIn: null },
      artifactState: { received: [] },
      logs: [],
      },
    });
  }
}

function buildRenderDefaults() {
  return {
    jpegQuality: 80,
    scale: 1,
    logLevel: "error",
    codec: "h264",
    concurrency: 1,
    minConcurrency: 1,
    muted: false,
    maxConcurrency: 1,
    stillImageFormat: "png",
    videoImageFormat: "jpeg",
    audioCodec: "aac",
    enforceAudioTrack: false,
    proResProfile: null,
    x264Preset: "medium",
    gopSize: null,
    pixelFormat: "yuv420p",
    audioBitrate: null,
    videoBitrate: null,
    encodingBufferSize: null,
    encodingMaxRate: null,
    userAgent: null,
    everyNthFrame: 1,
    numberOfGifLoops: null,
    delayRenderTimeout: 30000,
    disableWebSecurity: false,
    openGlRenderer: null,
    ignoreCertificateErrors: false,
    mediaCacheSizeInBytes: null,
    offthreadVideoCacheSizeInBytes: null,
    offthreadVideoThreads: null,
    headless: true,
    colorSpace: "default",
    multiProcessOnLinux: true,
    darkMode: false,
    beepOnFinish: false,
    repro: false,
    forSeamlessAacConcatenation: false,
    metadata: null,
    hardwareAcceleration: "disable",
    chromeMode: "headless-shell",
    publicLicenseKey: null,
    outputLocation: null,
    sampleRate: 48000,
  };
}
