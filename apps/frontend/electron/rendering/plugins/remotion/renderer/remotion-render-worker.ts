import fs from "node:fs";
import { detectSystemChrome } from "../render-hw-mode";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoConfig } from "remotion/no-react";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import {
  validateTimelineRenderPlan,
} from "@/lib/studio/editing/validation";
import {
  validateCompositionProps,
  validateChapterVideoCompositionProps,
  validateStoryboardShotCompositionProps,
} from "../composition/composition-props-validation";
import type { StoryboardShotCompositionProps, ChapterVideoCompositionProps } from "../composition/composition-props";
import { buildCompositionProps, validateSubtitleAuthorityForTimeline } from "../composition/build-composition-props";
import {
  LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
  STORYBOARD_SHOT_COMPOSITION_ID,
} from "../composition/composition-id";
import { CHAPTER_VIDEO_COMPOSITION_ID } from "../composition/composition-id";
import { assertBundleMatchesRuntime } from "../render/bundle-manifest";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";
import { validateRemotionShotPlan } from "@/lib/studio/remotion/shot-plan";

type RemotionRendererApi = {
  makeCancelSignal: typeof import("@remotion/renderer").makeCancelSignal;
  renderMedia: typeof import("@remotion/renderer").renderMedia;
  selectComposition: typeof import("@remotion/renderer").selectComposition;
};

interface RemotionRendererApiLoaderOptions {
  resourcesPath?: string;
  workerFilePath?: string;
  fileExists?: (filePath: string) => boolean;
  createRuntimeRequire?: typeof createRequire;
  fallbackRequire?: NodeJS.Require;
}

const requireFromWorker = createRequire(import.meta.url);

export function loadRemotionRendererApi(
  options: RemotionRendererApiLoaderOptions = {},
): RemotionRendererApi {
  const workerFilePath = options.workerFilePath ?? fileURLToPath(import.meta.url);
  const resourcesPaths = [...new Set([
    options.resourcesPath ?? process.resourcesPath,
    resolvePackagedResourcesPath(workerFilePath),
  ].filter((value): value is string => Boolean(value)))];
  const fileExists = options.fileExists ?? fs.existsSync;
  const createRuntimeRequire = options.createRuntimeRequire ?? createRequire;
  for (const resourcesPath of resourcesPaths) {
    const appAsarPath = path.join(resourcesPath, "app.asar");
    if (fileExists(appAsarPath)) {
      const requireFromAppAsar = createRuntimeRequire(path.join(appAsarPath, "package.json"));
      return requireFromAppAsar("@remotion/renderer") as RemotionRendererApi;
    }
  }
  if (isPackagedWorkerPath(workerFilePath)) {
    throw new Error(`packaged Remotion worker cannot resolve app.asar: ${workerFilePath}`);
  }
  return (options.fallbackRequire ?? requireFromWorker)("@remotion/renderer") as RemotionRendererApi;
}

function resolvePackagedResourcesPath(workerFilePath: string): string | undefined {
  const marker = `${path.sep}app.asar.unpacked${path.sep}`;
  const markerIndex = path.resolve(workerFilePath).lastIndexOf(marker);
  return markerIndex >= 0 ? path.resolve(workerFilePath).slice(0, markerIndex) : undefined;
}

function isPackagedWorkerPath(workerFilePath: string): boolean {
  return path.resolve(workerFilePath).includes(`${path.sep}app.asar.unpacked${path.sep}`);
}

interface RemotionRenderInputBase {
  /** D3 硬件加速渲染开关（render-hw-mode.ts；严禁进 plan.renderSettings——M2）。 */
  hardwareRendering?: boolean;
  bundlePath: string;
  outputPath: string;
  browserExecutable: string;
  remotionVersion: string;
  binariesDirectory?: string;
}

export interface RemotionTimelineRenderInput extends RemotionRenderInputBase {
  plan: TimelineRenderPlan;
  mediaUrlByClipId: Readonly<Record<string, string>>;
  compositionId?: typeof LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID;
}

export interface RemotionShotRenderInput extends RemotionRenderInputBase {
  target: "shot";
  jobId: string;
  shotPlan: RemotionShotPlanV1;
  compositionProps: StoryboardShotCompositionProps;
  compositionId: typeof STORYBOARD_SHOT_COMPOSITION_ID;
}

export interface RemotionChapterRenderInput extends RemotionRenderInputBase {
  target: "chapter";
  jobId: string;
  compositionProps: ChapterVideoCompositionProps;
  compositionId: typeof CHAPTER_VIDEO_COMPOSITION_ID;
  /**
   * 章内场景分段渲染（按场分段导出）：闭区间帧范围，与整章渲染共用同一
   * bundle/compositionProps，仅裁渲染帧窗口。缺省=整章渲染。
   */
  frameRange?: readonly [number, number];
}

export type RemotionRenderInput = RemotionTimelineRenderInput | RemotionShotRenderInput | RemotionChapterRenderInput;

export interface RemotionRenderProgress {
  jobId: string;
  stage: "validating" | "preparing" | "rendering" | "canceled" | "failed";
  ratio: number;
  message?: string;
}

export type RemotionRenderWorkerResult =
  | {
      success: true;
      jobId: string;
      outputPath: string;
      composition: VideoConfig;
    }
  | {
      success: false;
      jobId: string;
      canceled: boolean;
      error: string;
    };

interface ActiveRender {
  cancel: () => void;
  cancelRequested: boolean;
}

export interface RemotionRenderWorkerOptions {
  emitProgress: (progress: RemotionRenderProgress) => void;
  api?: RemotionRendererApi;
  fileExists?: (filePath: string) => boolean;
}

export class RemotionRenderWorker {
  private readonly active = new Map<string, ActiveRender>();
  private readonly api: NonNullable<RemotionRenderWorkerOptions["api"]>;
  private readonly fileExists: (filePath: string) => boolean;

  constructor(private readonly options: RemotionRenderWorkerOptions) {
    this.api = options.api ?? loadRemotionRendererApi();
    this.fileExists = options.fileExists ?? fs.existsSync;
  }

  async render(input: RemotionRenderInput): Promise<RemotionRenderWorkerResult> {
    const fallbackJobId = readJobId(input);
    let jobId = fallbackJobId;
    let compositionId: string = LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID;
    let compositionProps: Record<string, unknown>;
    if ("shotPlan" in input) {
      const shotPlanValidation = await validateRemotionShotPlan(input.shotPlan);
      if (!shotPlanValidation.success) {
        return this.fail(
          jobId,
          shotPlanValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
          false,
        );
      }
      const propsValidation = validateStoryboardShotCompositionProps(input.compositionProps);
      if (!propsValidation.success) {
        return this.fail(
          jobId,
          propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
          false,
        );
      }
      compositionId = STORYBOARD_SHOT_COMPOSITION_ID;
      compositionProps = propsValidation.value;
    } else if ("target" in input && input.target === "chapter") {
      const propsValidation = validateChapterVideoCompositionProps(input.compositionProps);
      if (!propsValidation.success) {
        return this.fail(jobId, propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"), false);
      }
      const frameRangeValidation = validateChapterFrameRange(input.frameRange);
      if (!frameRangeValidation.success) {
        return this.fail(jobId, frameRangeValidation.error, false);
      }
      compositionId = CHAPTER_VIDEO_COMPOSITION_ID;
      compositionProps = propsValidation.value;
    } else {
      const planValidation = validateTimelineRenderPlan(input.plan);
      if (!planValidation.success) {
        return this.fail(
          jobId,
          planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
          false,
        );
      }
      jobId = planValidation.value.jobId;
      const subtitleAuthorityValidation = validateSubtitleAuthorityForTimeline(planValidation.value);
      if (!subtitleAuthorityValidation.success) {
        return this.fail(jobId, subtitleAuthorityValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"), false);
      }
      compositionProps = buildCompositionProps(planValidation.value, input.mediaUrlByClipId);
      const propsValidation = validateCompositionProps(compositionProps);
      if (!propsValidation.success) {
        return this.fail(
          jobId,
          propsValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
          false,
        );
      }
    }
    if (this.active.has(jobId)) {
      return this.fail(jobId, `渲染任务正在运行: ${jobId}`, false);
    }

    try {
      assertAbsolutePath(input.bundlePath, "固定 bundle");
      assertAbsolutePath(input.outputPath, "渲染输出");
      if (!input.browserExecutable || !path.isAbsolute(input.browserExecutable)) {
        throw new Error("Remotion 导出需要已安装的绝对 Headless Shell 路径");
      }
      if (!this.fileExists(input.bundlePath)) {
        throw new Error(`固定 Remotion bundle 不存在: ${input.bundlePath}`);
      }
      assertBundleManifest(input.bundlePath, input.remotionVersion);
      this.emit(jobId, "validating", 0, "Remotion 渲染计划校验通过");
      const outputParent = path.dirname(input.outputPath);
      await fs.promises.mkdir(outputParent, { recursive: true });
      const cancelState = this.api.makeCancelSignal();
      this.active.set(jobId, {
        cancel: cancelState.cancel,
        cancelRequested: false,
      });
      this.emit(jobId, "preparing", 0.04, "加载固定 Remotion bundle");

      const composition = await this.api.selectComposition({
        serveUrl: input.bundlePath,
        id: compositionId,
        inputProps: compositionProps,
        browserExecutable: input.browserExecutable,
        binariesDirectory: input.binariesDirectory,
        chromeMode: "headless-shell",
        onBrowserDownload: () => {
          throw new Error("Remotion 导出禁止隐式下载 Headless Shell");
        },
      });
      const frameRange = "target" in input && input.target === "chapter" ? input.frameRange : undefined;
      if (frameRange && frameRange[1] >= composition.durationInFrames) {
        return this.fail(
          jobId,
          `chapter 场景分段帧区间越界：[${frameRange[0]}, ${frameRange[1]}] / ${composition.durationInFrames}`,
          false,
        );
      }
      this.emit(jobId, "rendering", 0.08, "Remotion 渲染中");
      await this.api.renderMedia({
        serveUrl: input.bundlePath,
        composition,
        inputProps: compositionProps,
        outputLocation: input.outputPath,
        ...(frameRange ? { frameRange: [frameRange[0], frameRange[1]] as [number, number] } : {}),
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        timeoutInMilliseconds: 300_000,
        browserExecutable: (input.hardwareRendering ? detectSystemChrome() : null) ?? input.browserExecutable,
        binariesDirectory: input.binariesDirectory,
        chromeMode: "headless-shell",
        // 硬件加速分支（系统 Chrome+真 GPU）不传 swangle；默认分支传——GL 转场 WebGL
        // 的软渲硬前置（0c7fee6 实证：不传则 ANGLE Vulkan BindToCurrentSequence 失败）。
        ...(input.hardwareRendering && detectSystemChrome() ? {} : { chromiumOptions: { gl: "swangle" as const } }),
        enforceAudioTrack: true,
        overwrite: true,
        cancelSignal: cancelState.cancelSignal,
        onBrowserDownload: () => {
          throw new Error("Remotion 导出禁止隐式下载 Headless Shell");
        },
        onProgress: (progress) => {
          const innerRatio = Number.isFinite(progress.progress)
            ? Math.max(0, Math.min(1, progress.progress))
            : 0;
          this.emit(
            jobId,
            "rendering",
            Math.min(0.94, 0.08 + innerRatio * 0.86),
          );
        },
      });
      if (!this.fileExists(input.outputPath)) {
        throw new Error("Remotion 渲染未生成 MP4 输出");
      }
      const outputStat = fs.statSync(input.outputPath);
      if (!outputStat.isFile() || outputStat.size <= 0) {
        throw new Error("Remotion 渲染输出不是非空普通文件");
      }
      return {
        success: true,
        jobId,
        outputPath: input.outputPath,
        composition,
      };
    } catch (error) {
      const active = this.active.get(jobId);
      const canceled = active?.cancelRequested === true || isRemotionCancelError(error);
      const quarantineError = await quarantineRemotionPartialOutput(input.outputPath);
      const message = [
        error instanceof Error ? error.message : String(error),
        quarantineError,
      ].filter(Boolean).join("; ");
      return this.fail(
        jobId,
        canceled ? `Remotion 渲染已取消: ${jobId}` : message,
        canceled,
      );
    } finally {
      this.active.delete(jobId);
    }
  }

  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string } {
    const normalized = typeof jobId === "string" ? jobId.trim() : "";
    if (!normalized) {
      return { success: false, jobId: "unknown", canceled: false, error: "渲染任务 ID 不能为空" };
    }
    const active = this.active.get(normalized);
    if (!active) {
      return { success: false, jobId: normalized, canceled: false, error: `未找到运行中的渲染任务: ${normalized}` };
    }
    active.cancelRequested = true;
    active.cancel();
    return { success: true, jobId: normalized, canceled: true };
  }

  private fail(jobId: string, error: string, canceled: boolean): RemotionRenderWorkerResult {
    this.emit(jobId, canceled ? "canceled" : "failed", 0, error);
    return { success: false, jobId, canceled, error };
  }

  private emit(
    jobId: string,
    stage: RemotionRenderProgress["stage"],
    ratio: number,
    message?: string,
  ): void {
    this.options.emitProgress({ jobId, stage, ratio, message });
  }
}

function assertAbsolutePath(value: string, label: string): void {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label}必须是绝对路径`);
  }
}

function assertBundleManifest(bundlePath: string, expectedVersion: string): void {
  const manifestPath = path.join(bundlePath, "manifest.json");
  assertBundleMatchesRuntime(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown,
    expectedVersion,
  );
}

function isRemotionCancelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("renderMedia() got cancelled");
}

function readJobId(input: unknown): string {
  if (!input || typeof input !== "object") return "unknown";
  const record = input as { jobId?: unknown; plan?: { jobId?: unknown } };
  const value = record.jobId ?? record.plan?.jobId;
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function validateChapterFrameRange(
  frameRange: readonly [number, number] | undefined,
): { success: true } | { success: false; error: string } {
  if (frameRange === undefined) return { success: true };
  const [start, end] = frameRange;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
    return { success: false, error: `chapter 场景分段帧区间非法：[${start}, ${end}]` };
  }
  return { success: true };
}
