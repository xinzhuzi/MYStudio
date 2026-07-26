import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TimelineAudioPostProcessInput {
  rawInputPath: string;
  outputPath: string;
  logPath: string;
  loudnessLufs: number;
  truePeakDbtp: number;
}

export interface TimelineAudioPostProcessEvidence {
  engine: "ffmpeg";
  loudnessLufs: number;
  truePeakDbtp: number;
  logPath: string;
}

export type TimelineAudioPostProcessExec = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function runTimelineAudioPostProcess(
  input: TimelineAudioPostProcessInput,
  execCommand: TimelineAudioPostProcessExec = defaultExec,
): Promise<TimelineAudioPostProcessEvidence> {
  assertAbsolutePath(input.rawInputPath, "Remotion 原始输出");
  assertAbsolutePath(input.outputPath, "Remotion 最终输出");
  assertAbsolutePath(input.logPath, "Remotion 后处理日志");
  if (!Number.isFinite(input.loudnessLufs) || !Number.isFinite(input.truePeakDbtp)) {
    throw new Error("音频后处理目标必须是有限数值");
  }
  const loudnormFilter = `loudnorm=I=${decimal(input.loudnessLufs)}:TP=${decimal(input.truePeakDbtp)}:LRA=11`;
  let result: { stdout: string; stderr: string };
  let logPrefix = "";
  try {
    result = await execCommand("ffmpeg", buildPostProcessArgs(input, loudnormFilter));
  } catch (error) {
    const loudnormDiagnostic = formatExecDiagnostic(error);
    if (!isLoudnormNonFiniteFailure(loudnormDiagnostic)) {
      await fs.promises.writeFile(input.logPath, loudnormDiagnostic, "utf8");
      throw error;
    }

    const fallbackMarker = "[mystudio] loudnorm produced non-finite near-silence samples; fallback=anull";
    try {
      result = await execCommand("ffmpeg", buildPostProcessArgs(input, "anull"));
      logPrefix = [fallbackMarker, loudnormDiagnostic].filter(Boolean).join("\n");
    } catch (fallbackError) {
      await fs.promises.writeFile(
        input.logPath,
        [fallbackMarker, loudnormDiagnostic, formatExecDiagnostic(fallbackError)].filter(Boolean).join("\n"),
        "utf8",
      );
      throw fallbackError;
    }
  }
  await fs.promises.writeFile(
    input.logPath,
    [logPrefix, result.stdout, result.stderr].filter(Boolean).join("\n"),
    "utf8",
  );
  const stat = await fs.promises.stat(input.outputPath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("音频后处理未生成非空最终 MP4");
  }
  return {
    engine: "ffmpeg",
    loudnessLufs: input.loudnessLufs,
    truePeakDbtp: input.truePeakDbtp,
    logPath: input.logPath,
  };
}

function buildPostProcessArgs(input: TimelineAudioPostProcessInput, audioFilter: string): string[] {
  return [
    "-i", input.rawInputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-af", audioFilter,
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    "-y", input.outputPath,
  ];
}

function formatExecDiagnostic(error: unknown): string {
  const diagnostic = error as { stdout?: unknown; stderr?: unknown };
  return [diagnostic.stdout, diagnostic.stderr, error instanceof Error ? error.message : String(error)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function isLoudnormNonFiniteFailure(diagnostic: string): boolean {
  return diagnostic.includes("NaN/+-Inf");
}

async function defaultExec(file: string, args: readonly string[]) {
  return execFileAsync(file, [...args], { maxBuffer: 50 * 1024 * 1024 });
}

function assertAbsolutePath(value: string, label: string): void {
  if (!path.isAbsolute(value)) throw new Error(`${label}路径必须是绝对路径`);
}

function decimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
