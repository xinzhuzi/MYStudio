import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type {
  TimelineRenderCancelResult,
  TimelineRenderEvidence,
  TimelineRenderPlan,
  TimelineRenderProgress,
  TimelineRenderResult,
} from "../types/editing";
import { validateTimelineRenderPlan } from "../lib/studio/editing/validation";
import {
  buildTimelineFfmpegCommand,
  buildTimelineSubtitleSrt,
} from "./timeline-ffmpeg-command";

const execFileAsync = promisify(execFile);

interface ActiveTimelineRenderJob {
  child: ChildProcess;
  cancelRequested: boolean;
}

export interface TimelineRenderRuntimeOptions {
  renderRoot: string;
  resolveSourcePath: (sourcePath: string) => string;
  emitProgress: (progress: TimelineRenderProgress) => void;
  now?: () => number;
}

export interface TimelineRenderRuntime {
  render: (plan: unknown) => Promise<TimelineRenderResult>;
  cancel: (jobId: string) => TimelineRenderCancelResult;
}

export function createTimelineRenderRuntime(
  options: TimelineRenderRuntimeOptions,
): TimelineRenderRuntime {
  const activeJobs = new Map<string, ActiveTimelineRenderJob>();
  const now = options.now ?? Date.now;

  return {
    async render(planValue) {
      const validation = validateTimelineRenderPlan(planValue);
      const fallbackJobId = readJobId(planValue);
      if (!validation.success) {
        const error = validation.issues
          .map((item) => `${item.path}: ${item.message}`)
          .join("; ");
        emit(options, fallbackJobId, "failed", 0, error);
        return { success: false, jobId: fallbackJobId, canceled: false, error };
      }

      const plan = validation.value;
      if (activeJobs.has(plan.jobId)) {
        const error = `渲染任务正在运行: ${plan.jobId}`;
        emit(options, plan.jobId, "failed", 0, error);
        return { success: false, jobId: plan.jobId, canceled: false, error };
      }

      emit(options, plan.jobId, "validating", 0, "时间线校验通过");
      const jobDir = path.join(
        options.renderRoot,
        "timeline-jobs",
        `${safePathSegment(plan.jobId)}-${now()}`,
      );
      const outputPath = path.join(jobDir, "output.mp4");
      const snapshotPath = path.join(jobDir, "editing-project.json");
      const renderPlanPath = path.join(jobDir, "render-plan.json");
      const inputManifestPath = path.join(jobDir, "input-manifest.json");
      const filterGraphPath = path.join(jobDir, "filter-graph.txt");
      const logPath = path.join(jobDir, "ffmpeg-stderr.log");
      const ffprobePath = path.join(jobDir, "ffprobe.json");
      const resultPath = path.join(jobDir, "result.json");

      try {
        await fs.promises.mkdir(jobDir, { recursive: true });
        await assertExecutable("ffmpeg");
        await assertExecutable("ffprobe");
        emit(options, plan.jobId, "preparing", 0.04, "解析素材与写入渲染证据");

        const resolvedInputs = resolvePlanInputs(plan, options.resolveSourcePath);
        const subtitleText = buildTimelineSubtitleSrt(plan);
        const subtitlePath = subtitleText
          ? path.join(jobDir, "subtitles.srt")
          : undefined;
        if (subtitlePath) await fs.promises.writeFile(subtitlePath, subtitleText, "utf8");

        const command = buildTimelineFfmpegCommand({
          plan,
          resolvedInputs,
          outputPath,
          subtitlePath,
        });
        const snapshotJson = stableJson(plan.editingProjectSnapshot);
        const renderPlanJson = stableJson(plan);
        const inputManifest = command.inputManifest.map((item) => ({
          ...item,
          evidence: plan.clips.find((clip) => clip.id === item.clipId)?.source.evidence ?? {},
        }));
        await Promise.all([
          fs.promises.writeFile(snapshotPath, snapshotJson, "utf8"),
          fs.promises.writeFile(renderPlanPath, renderPlanJson, "utf8"),
          fs.promises.writeFile(inputManifestPath, stableJson(inputManifest), "utf8"),
          fs.promises.writeFile(filterGraphPath, command.filterGraph, "utf8"),
        ]);

        const stderr = await runFfmpeg({
          jobId: plan.jobId,
          args: command.args,
          totalDurationUs: command.totalDurationUs,
          activeJobs,
          emitProgress: (progress) => options.emitProgress(progress),
        });
        await fs.promises.writeFile(logPath, stderr, "utf8");

        emit(options, plan.jobId, "probing", 0.96, "核验成片媒体流与哈希");
        const probe = await probeMedia(outputPath);
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
          snapshotHash: crypto.createHash("sha256").update(snapshotJson).digest("hex"),
          snapshotPath,
          renderPlanPath,
          inputManifestPath,
          filterGraphPath,
          logPath,
          ffprobePath,
        };
        const result: TimelineRenderResult = { success: true, evidence };
        await fs.promises.writeFile(resultPath, stableJson(result), "utf8");
        emit(options, plan.jobId, "completed", 1, "时间线渲染完成");
        return result;
      } catch (error) {
        const canceled = activeJobs.get(plan.jobId)?.cancelRequested === true
          || isCanceledError(error);
        const message = error instanceof Error ? error.message : String(error);
        const result: TimelineRenderResult = {
          success: false,
          jobId: plan.jobId,
          canceled,
          error: canceled ? `渲染已取消: ${plan.jobId}` : message,
        };
        await fs.promises.mkdir(jobDir, { recursive: true }).catch(() => undefined);
        await fs.promises.writeFile(resultPath, stableJson(result), "utf8").catch(() => undefined);
        emit(
          options,
          plan.jobId,
          canceled ? "canceled" : "failed",
          0,
          result.error,
        );
        return result;
      } finally {
        activeJobs.delete(plan.jobId);
      }
    },

    cancel(jobId) {
      const normalized = typeof jobId === "string" ? jobId.trim() : "";
      if (!normalized) {
        return { success: false, jobId: "unknown", canceled: false, error: "渲染任务 ID 不能为空" };
      }
      const active = activeJobs.get(normalized);
      if (!active) {
        return { success: false, jobId: normalized, canceled: false, error: `未找到运行中的渲染任务: ${normalized}` };
      }
      active.cancelRequested = true;
      const canceled = active.child.kill("SIGTERM");
      return { success: true, jobId: normalized, canceled };
    },
  };
}

function resolvePlanInputs(
  plan: TimelineRenderPlan,
  resolveSourcePath: (sourcePath: string) => string,
) {
  return plan.clips
    .filter((clip) => clip.source.kind !== "text" && clip.source.path)
    .map((clip) => {
      const sourcePath = resolveSourcePath(clip.source.path!);
      if (!path.isAbsolute(sourcePath)) {
        throw new Error(`片段素材不是绝对路径: ${clip.id}`);
      }
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile() || stat.size <= 0) {
        throw new Error(`片段素材不可读或为空: ${clip.id}`);
      }
      fs.accessSync(sourcePath, fs.constants.R_OK);
      return { clipId: clip.id, sourcePath };
    });
}

async function runFfmpeg(input: {
  jobId: string;
  args: string[];
  totalDurationUs: number;
  activeJobs: Map<string, ActiveTimelineRenderJob>;
  emitProgress: (progress: TimelineRenderProgress) => void;
}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("ffmpeg", input.args, { stdio: ["ignore", "pipe", "pipe"] });
    const active: ActiveTimelineRenderJob = { child, cancelRequested: false };
    input.activeJobs.set(input.jobId, active);
    let stdoutBuffer = "";
    let stderr = "";
    input.emitProgress({ jobId: input.jobId, stage: "rendering", ratio: 0.08, message: "FFmpeg 渲染中" });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^(?:out_time_us|out_time_ms)=(\d+)$/.exec(line.trim());
        if (!match) continue;
        const currentUs = Number(match[1]);
        const ratio = Math.min(0.94, 0.08 + (currentUs / input.totalDurationUs) * 0.86);
        input.emitProgress({ jobId: input.jobId, stage: "rendering", ratio });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (active.cancelRequested) {
        const error = new Error(`timeline-render-canceled:${input.jobId}`);
        error.name = "TimelineRenderCanceledError";
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(new Error(`FFmpeg 渲染失败(code=${code}, signal=${signal ?? "none"}): ${lastLogLine(stderr)}`));
        return;
      }
      resolve(stderr);
    });
  });
}

async function probeMedia(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout || "{}") as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  return {
    raw,
    duration: Number(raw.format?.duration || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    streams: (raw.streams ?? []).map((stream) => stream.codec_type ?? "").filter(Boolean),
  };
}

async function hashFile(filePath: string) {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function assertExecutable(command: "ffmpeg" | "ffprobe") {
  try {
    await execFileAsync(command, ["-version"], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(`未找到本地 ${command}，请先安装并确保命令行可访问`);
  }
}

function emit(
  options: TimelineRenderRuntimeOptions,
  jobId: string,
  stage: TimelineRenderProgress["stage"],
  ratio: number,
  message?: string,
) {
  options.emitProgress({ jobId, stage, ratio, message });
}

function safePathSegment(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  return normalized || crypto.randomUUID();
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJobId(value: unknown) {
  if (!value || typeof value !== "object") return "unknown";
  const jobId = (value as { jobId?: unknown }).jobId;
  return typeof jobId === "string" && jobId.trim() ? jobId.trim() : "unknown";
}

function isCanceledError(error: unknown) {
  return error instanceof Error && error.name === "TimelineRenderCanceledError";
}

function lastLogLine(value: string) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-30).join(" | ") || "无错误日志";
}
