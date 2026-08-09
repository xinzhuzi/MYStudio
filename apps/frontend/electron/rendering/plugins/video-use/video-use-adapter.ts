import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  validateVideoUseChapterArtifact,
  validateVideoUseChapterRun,
  type VideoUseChapterArtifactV1,
  type VideoUseChapterRunV1,
} from "@rendering/contracts/video-workflow";
import {
  buildSharedToolchainEnv,
  probeVideoUseRuntime,
  probeVideoWorkflowAlignmentRuntime,
  resolveVideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimeProbeResult,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";

const execFileAsync = promisify(execFile);

type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

function childProcessJson(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const stdout = (error as { stdout?: unknown }).stdout;
  if (typeof stdout !== "string" || stdout.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export type VideoUseAdapterResult =
  | { state: "pending" | "ready"; artifact: VideoUseChapterArtifactV1; artifactPath: string }
  | { state: "blocked" | "error"; code: string; message: string; artifactPath?: string };

export type VideoUseAlignmentResult =
  | { state: "ready"; alignmentPath: string; alignment: Record<string, unknown> }
  | { state: "blocked" | "error"; code: string; message: string; alignmentPath?: string };

export interface VideoUseAdapterOptions {
  storageBasePath: string | (() => string);
  modelCacheDir?: string | (() => string | undefined | Promise<string | undefined>);
  backendRoot: string;
  workerModule?: string;
  workspaceRootForProject: (projectId: string) => string;
  probeRuntime?: (paths: VideoWorkflowRuntimePaths) => Promise<VideoWorkflowRuntimeProbeResult>;
  probeAlignmentRuntime?: (paths: VideoWorkflowRuntimePaths) => Promise<VideoWorkflowRuntimeProbeResult>;
  execFile?: ExecFileLike;
  now?: () => number;
}

export interface VideoUseProbeResult {
  state: "ready" | "blocked" | "error";
  code?: string;
  message: string;
  runtime: VideoWorkflowRuntimeProbeResult;
}

function safeSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") throw new Error(`${field} 不能包含路径分隔符或目录跳转`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateRun(value: VideoUseChapterRunV1): void {
  const validated = validateVideoUseChapterRun(value);
  if (!validated.success) throw new Error(validated.issues.map((item) => `${item.path}: ${item.message}`).join("; "));
}

export function buildVideoUseWorkerArgs(options: {
  moduleName: string;
  inputPath: string;
  alignmentPath: string;
  outputPath: string;
  profilePath: string;
  ffmpegPath: string;
  ffprobePath: string;
}): string[] {
  return [
    "-m",
    options.moduleName,
    "--run",
    "--input",
    options.inputPath,
    "--alignment",
    options.alignmentPath,
    "--output",
    options.outputPath,
    "--profile",
    options.profilePath,
    "--ffmpeg",
    options.ffmpegPath,
    "--ffprobe",
    options.ffprobePath,
  ];
}

export function buildVideoUseAlignmentArgs(options: {
  moduleName: string;
  inputPath: string;
  outputPath: string;
  modelPath?: string;
  tokenizerPath?: string;
}): string[] {
  return [
    "-m",
    options.moduleName,
    "--align",
    "--input",
    options.inputPath,
    "--output",
    options.outputPath,
    ...(options.modelPath ? ["--alignment-model", options.modelPath] : []),
    ...(options.tokenizerPath ? ["--alignment-tokenizer", options.tokenizerPath] : []),
  ];
}

export function createVideoUseAdapter(options: VideoUseAdapterOptions) {
  const getPaths = () => resolveVideoWorkflowRuntimePaths(
    typeof options.storageBasePath === "function" ? options.storageBasePath() : options.storageBasePath,
  );
  const probeRuntime = options.probeRuntime ?? ((runtimePaths) => probeVideoUseRuntime(runtimePaths));
  const probeAlignmentRuntime = options.probeAlignmentRuntime ?? ((runtimePaths) => probeVideoWorkflowAlignmentRuntime(runtimePaths));
  const runFile = options.execFile ?? execFileAsync;
  const now = options.now ?? Date.now;
  const moduleName = options.workerModule ?? "video_use.worker";

  const resolveModelCacheDir = async (paths: VideoWorkflowRuntimePaths): Promise<string> => {
    const configured = typeof options.modelCacheDir === "function"
      ? await options.modelCacheDir()
      : options.modelCacheDir;
    const resolved = (configured ?? path.join(paths.storageBasePath, "tts-models")).trim();
    if (!path.isAbsolute(resolved)) throw new Error("TTS 模型缓存路径必须是绝对路径");
    return resolved;
  };

  const buildWorkerEnv = (paths: VideoWorkflowRuntimePaths, modelCacheDir: string): NodeJS.ProcessEnv => (
    buildSharedToolchainEnv(paths, {
      MANYING_TTS_MODELS_DIR: modelCacheDir,
      VOICEBOX_MODELS_DIR: modelCacheDir,
      MYSTUDIO_VIDEO_USE_UPSTREAM_ROOT: paths.videoUseUpstreamRoot,
      PYTHONPATH: [options.backendRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    })
  );

  async function probe(): Promise<VideoUseProbeResult> {
    const paths = getPaths();
    const runtime = await probeRuntime(paths);
    if (runtime.state !== "ready") return { state: "blocked", message: runtime.message ?? "共享运行时未就绪", runtime };
    try {
      const result = await runFile(paths.pythonExecutable, ["-m", moduleName, "--probe", "--profile", paths.videoUseMarkerPath], {
        cwd: options.backendRoot,
        env: buildSharedToolchainEnv(paths, {
          MYSTUDIO_VIDEO_USE_UPSTREAM_ROOT: paths.videoUseUpstreamRoot,
          PYTHONPATH: [options.backendRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        }),
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const parsed = JSON.parse(`${result.stdout ?? ""}`) as { status?: unknown; code?: unknown; message?: unknown };
      if (parsed.status !== "ready") return {
        state: "blocked",
        code: typeof parsed.code === "string" ? parsed.code : undefined,
        message: typeof parsed.message === "string" ? parsed.message : "video-use worker 未准备",
        runtime,
      };
      const modelCacheDir = await resolveModelCacheDir(paths);
      try {
        const alignmentProbe = await runFile(paths.pythonExecutable, ["-m", moduleName, "--probe-alignment"], {
          cwd: options.backendRoot,
          env: buildWorkerEnv(paths, modelCacheDir),
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        const alignmentPayload = JSON.parse(`${alignmentProbe.stdout ?? ""}`) as { status?: unknown; code?: unknown; message?: unknown };
        if (alignmentPayload.status !== "ready") {
          return {
            state: "blocked",
            code: typeof alignmentPayload.code === "string" ? alignmentPayload.code : undefined,
            message: typeof alignmentPayload.message === "string" ? alignmentPayload.message : "Whisper 对齐模型未准备",
            runtime,
          };
        }
      } catch (error) {
        const alignmentPayload = childProcessJson(error);
        return {
          state: "blocked",
          code: typeof alignmentPayload?.code === "string" ? alignmentPayload.code : undefined,
          message: typeof alignmentPayload?.message === "string" ? alignmentPayload.message : `Whisper 对齐模型探针失败: ${errorMessage(error)}`,
          runtime,
        };
      }
      return { state: "ready", message: "video-use worker 已准备", runtime };
    } catch (error) {
      const parsed = childProcessJson(error);
      if (parsed?.status === "needs-upstream" || parsed?.status === "blocked") {
        return {
          state: "blocked",
          code: typeof parsed.code === "string" ? parsed.code : undefined,
          message: typeof parsed.message === "string" ? parsed.message : "video-use worker 未准备",
          runtime,
        };
      }
      return { state: "error", message: `video-use worker 探针失败: ${errorMessage(error)}`, runtime };
    }
  }

  async function runChapter(run: VideoUseChapterRunV1): Promise<VideoUseAdapterResult> {
    const paths = getPaths();
    try {
      validateRun(run);
      safeSegment(run.projectId, "projectId");
      safeSegment(run.chapterId, "chapterId");
    } catch (error) {
      return { state: "blocked", code: "invalid-input", message: errorMessage(error) };
    }
    const workspaceRoot = options.workspaceRootForProject(run.projectId);
    const revisionDir = path.join(workspaceRoot, safeSegment(run.chapterId, "chapterId"), `r${run.revision}`);
    const inputPath = path.join(revisionDir, "video-use-run.json");
    const alignmentPath = path.join(revisionDir, "alignment.json");
    const artifactPath = path.join(revisionDir, "video-use-artifact.json");
    try {
      fs.mkdirSync(revisionDir, { recursive: true });
      fs.writeFileSync(inputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
      const modelCacheDir = await resolveModelCacheDir(paths);
      const alignmentRuntime = await probeAlignmentRuntime(paths);
      if (alignmentRuntime.state !== "ready") {
        return { state: "blocked", code: "alignment-runtime-not-ready", message: alignmentRuntime.message ?? "原文对齐运行时未就绪", artifactPath: alignmentPath };
      }
      const alignment = await runAlignment(inputPath, alignmentPath, paths, modelCacheDir);
      if (alignment.state !== "ready") return alignment;
      const runtime = await probeRuntime(paths);
      if (runtime.state !== "ready") return { state: "blocked", code: "runtime-not-ready", message: runtime.message ?? "共享运行时未就绪", artifactPath };
      await runFile(paths.pythonExecutable, buildVideoUseWorkerArgs({
        moduleName,
        inputPath,
        alignmentPath,
        outputPath: artifactPath,
        profilePath: paths.videoUseMarkerPath,
        ffmpegPath: paths.ffmpegExecutable,
        ffprobePath: paths.ffprobeExecutable,
      }), {
        cwd: options.backendRoot,
        env: buildWorkerEnv(paths, modelCacheDir),
        timeout: 30 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
      const validated = validateVideoUseChapterArtifact(parsed);
      if (!validated.success) return { state: "blocked", code: "artifact-invalid", message: validated.issues.map((item) => `${item.path}: ${item.message}`).join("; "), artifactPath };
      if (validated.value.status === "blocked") return { state: "blocked", code: "artifact-blocked", message: "video-use worker 返回 blocked artifact", artifactPath };
      if (validated.value.status === "pending" && validated.value.stage !== "awaiting-review") {
        return { state: "blocked", code: "artifact-not-reviewable", message: "video-use worker 未返回 awaiting-review/pending artifact", artifactPath };
      }
      if (validated.value.status === "accepted" && validated.value.stage !== "ready") {
        return { state: "blocked", code: "artifact-not-accepted", message: "video-use accepted artifact 必须处于 ready", artifactPath };
      }
      return { state: validated.value.status === "accepted" ? "ready" : "pending", artifact: validated.value, artifactPath };
    } catch (error) {
      const parsed = childProcessJson(error);
      if (typeof parsed?.code === "string") {
        return {
          state: "blocked",
          code: parsed.code,
          message: typeof parsed.message === "string" ? parsed.message : "video-use worker blocked",
          artifactPath,
        };
      }
      return { state: "blocked", code: "worker-failed", message: `video-use worker 执行失败: ${errorMessage(error)}`, artifactPath };
    }
  }

  async function runAlignment(
    inputPath: string,
    alignmentPath: string,
    paths: VideoWorkflowRuntimePaths,
    modelCacheDir: string,
  ): Promise<VideoUseAlignmentResult> {
    try {
      await runFile(paths.pythonExecutable, buildVideoUseAlignmentArgs({
        moduleName,
        inputPath,
        outputPath: alignmentPath,
      }), {
        cwd: options.backendRoot,
        env: buildWorkerEnv(paths, modelCacheDir),
        timeout: 30 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      if (fs.existsSync(alignmentPath)) {
        try {
          const failed = JSON.parse(fs.readFileSync(alignmentPath, "utf8")) as { status?: unknown; code?: unknown; message?: unknown };
          return {
            state: "blocked",
            code: typeof failed.code === "string" ? failed.code : "alignment-failed",
            message: typeof failed.message === "string" ? failed.message : `原文对齐失败: ${errorMessage(error)}`,
            alignmentPath,
          };
        } catch {
          // Fall through to the process error so malformed output cannot pass.
        }
      }
      return { state: "blocked", code: "alignment-worker-failed", message: `原文对齐 worker 执行失败: ${errorMessage(error)}`, alignmentPath };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(alignmentPath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || (parsed as { status?: unknown }).status !== "ready") {
        return { state: "blocked", code: "alignment-artifact-not-ready", message: "原文对齐没有返回 ready artifact", alignmentPath };
      }
      return { state: "ready", alignmentPath, alignment: parsed as Record<string, unknown> };
    } catch (error) {
      return { state: "blocked", code: "alignment-artifact-invalid", message: `原文对齐 artifact 无效: ${errorMessage(error)}`, alignmentPath };
    }
  }

  return { get paths() { return getPaths(); }, probe, runAlignment, runChapter, now };
}
