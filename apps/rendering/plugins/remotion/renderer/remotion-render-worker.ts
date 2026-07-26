import fs from "node:fs";
import path from "node:path";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type { VideoConfig } from "remotion/no-react";
import type { TimelineRenderPlan } from "@/types/editing";
import {
  validateTimelineRenderPlan,
} from "@/lib/studio/editing/validation";
import {
  validateCompositionProps,
} from "../composition/composition-props-validation";
import { buildCompositionProps } from "../composition/build-composition-props";
import { REMOTION_COMPOSITION_ID } from "../composition/composition-id";
import { quarantineRemotionPartialOutput } from "./remotion-render-output";

const BUNDLE_MANIFEST_SCHEMA_VERSION = 1;

export interface RemotionRenderInput {
  plan: TimelineRenderPlan;
  bundlePath: string;
  outputPath: string;
  browserExecutable: string;
  remotionVersion: string;
  mediaUrlByClipId: Readonly<Record<string, string>>;
  binariesDirectory?: string;
}

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
  api?: {
    selectComposition: typeof selectComposition;
    renderMedia: typeof renderMedia;
    makeCancelSignal: typeof makeCancelSignal;
  };
  fileExists?: (filePath: string) => boolean;
}

export class RemotionRenderWorker {
  private readonly active = new Map<string, ActiveRender>();
  private readonly api: NonNullable<RemotionRenderWorkerOptions["api"]>;
  private readonly fileExists: (filePath: string) => boolean;

  constructor(private readonly options: RemotionRenderWorkerOptions) {
    this.api = options.api ?? { selectComposition, renderMedia, makeCancelSignal };
    this.fileExists = options.fileExists ?? fs.existsSync;
  }

  async render(input: RemotionRenderInput): Promise<RemotionRenderWorkerResult> {
    const fallbackJobId = readJobId(input?.plan);
    const planValidation = validateTimelineRenderPlan(input?.plan);
    if (!planValidation.success) {
      return this.fail(
        fallbackJobId,
        planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        false,
      );
    }
    const plan = planValidation.value;
    if (this.active.has(plan.jobId)) {
      return this.fail(plan.jobId, `渲染任务正在运行: ${plan.jobId}`, false);
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
      const compositionProps = buildCompositionProps(plan, input.mediaUrlByClipId);
      const propsValidation = validateCompositionProps(compositionProps);
      if (!propsValidation.success) {
        throw new Error(
          propsValidation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; "),
        );
      }

      this.emit(plan.jobId, "validating", 0, "Remotion 渲染计划校验通过");
      const outputParent = path.dirname(input.outputPath);
      await fs.promises.mkdir(outputParent, { recursive: true });
      const cancelState = this.api.makeCancelSignal();
      this.active.set(plan.jobId, {
        cancel: cancelState.cancel,
        cancelRequested: false,
      });
      this.emit(plan.jobId, "preparing", 0.04, "加载固定 Remotion bundle");

      const composition = await this.api.selectComposition({
        serveUrl: input.bundlePath,
        id: REMOTION_COMPOSITION_ID,
        inputProps: compositionProps,
        browserExecutable: input.browserExecutable,
        binariesDirectory: input.binariesDirectory,
        chromeMode: "headless-shell",
        onBrowserDownload: () => {
          throw new Error("Remotion 导出禁止隐式下载 Headless Shell");
        },
      });
      this.emit(plan.jobId, "rendering", 0.08, "Remotion 渲染中");
      await this.api.renderMedia({
        serveUrl: input.bundlePath,
        composition,
        inputProps: compositionProps,
        outputLocation: input.outputPath,
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        browserExecutable: input.browserExecutable,
        binariesDirectory: input.binariesDirectory,
        chromeMode: "headless-shell",
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
            plan.jobId,
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
        jobId: plan.jobId,
        outputPath: input.outputPath,
        composition,
      };
    } catch (error) {
      const active = this.active.get(plan.jobId);
      const canceled = active?.cancelRequested === true || isRemotionCancelError(error);
      const quarantineError = await quarantineRemotionPartialOutput(input.outputPath);
      const message = [
        error instanceof Error ? error.message : String(error),
        quarantineError,
      ].filter(Boolean).join("; ");
      return this.fail(
        plan.jobId,
        canceled ? `Remotion 渲染已取消: ${plan.jobId}` : message,
        canceled,
      );
    } finally {
      this.active.delete(plan.jobId);
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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.schemaVersion !== BUNDLE_MANIFEST_SCHEMA_VERSION
    || manifest.remotionVersion !== expectedVersion
    || manifest.compositionId !== REMOTION_COMPOSITION_ID
    || typeof manifest.contentHash !== "string") {
    throw new Error("Remotion bundle manifest 与当前运行时版本或 composition 不一致");
  }
}

function isRemotionCancelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("renderMedia() got cancelled");
}

function readJobId(plan: unknown): string {
  if (!plan || typeof plan !== "object") return "unknown";
  const value = (plan as { jobId?: unknown }).jobId;
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}
