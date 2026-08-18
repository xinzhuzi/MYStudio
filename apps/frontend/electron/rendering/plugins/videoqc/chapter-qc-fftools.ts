/**
 * QC 链 ffmpeg/ffprobe 工具层:二进制解析(env 优先,PATH 兜底)、媒体探测、
 * 每镜代表帧提取。纯 spawn 封装,无模型依赖。
 *
 * 二进制解析与 video-workflow-runtime 的 selectSharedVideoToolchain 口径一致:
 * env `MYSTUDIO_FFPROBE_PATH` / `MYSTUDIO_FFMPEG_PATH` → PATH 兜底。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";

const execFileAsync = promisify(execFile);

export type QcCommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: QcCommandRunner = (file, args) =>
  execFileAsync(file, args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });

export function resolveQcFfTool(kind: "ffmpeg" | "ffprobe"): string {
  const envValue =
    kind === "ffprobe" ? process.env.MYSTUDIO_FFPROBE_PATH : process.env.MYSTUDIO_FFMPEG_PATH;
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : kind;
}

export interface QcMediaProbe {
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  bitrateBps?: number;
}

interface FfprobeStreamJson {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
}

interface FfprobeJson {
  streams?: FfprobeStreamJson[];
  format?: { duration?: string; bit_rate?: string };
}

function parseFrameRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(rate);
  if (!match) {
    const plain = Number(rate);
    return Number.isFinite(plain) && plain > 0 ? plain : undefined;
  }
  const denominator = Number(match[2]);
  if (!denominator) return undefined;
  const value = Number(match[1]) / denominator;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function qcProbeMedia(
  videoPath: string,
  runner: QcCommandRunner = defaultRunner,
): Promise<QcMediaProbe> {
  const { stdout } = await runner(resolveQcFfTool("ffprobe"), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(stdout) as FfprobeJson;
  } catch (error) {
    throw new Error(`ffprobe 输出无法解析: ${error instanceof Error ? error.message : String(error)}`);
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const durationS = Number(parsed.format?.duration);
  if (!video || !Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`ffprobe 未找到视频流或时长异常: ${videoPath}`);
  }
  return {
    durationS,
    width: video.width,
    height: video.height,
    fps: parseFrameRate(video.avg_frame_rate),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name,
    hasAudio: Boolean(audio),
    bitrateBps: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : undefined,
  };
}

export interface ExtractedShotKeyframe {
  shotId: string;
  ordinal: number;
  framePath: string;
}

export interface ExtractKeyframesOptions {
  videoPath: string;
  spans: ChapterQcShotSpan[];
  outDir: string;
  /** 代表帧宽度上限(L4 语义层 token 控制) */
  maxWidth?: number;
  runner?: QcCommandRunner;
}

/**
 * 每镜中点抽 1 帧到 outDir/shot-<ordinal>.jpg。失败单镜跳过并记录在返回的
 * errors 里(不整体失败——缺帧镜在 L4 里按 skipped 处理)。
 */
export async function extractShotKeyframes(
  options: ExtractKeyframesOptions,
): Promise<{ frames: ExtractedShotKeyframe[]; errors: Array<{ shotId: string; ordinal: number; error: string }> }> {
  const { videoPath, spans, outDir } = options;
  const maxWidth = options.maxWidth ?? 768;
  const runner = options.runner ?? defaultRunner;
  await fs.promises.mkdir(outDir, { recursive: true });
  const frames: ExtractedShotKeyframe[] = [];
  const errors: Array<{ shotId: string; ordinal: number; error: string }> = [];
  const tool = resolveQcFfTool("ffmpeg");
  for (const span of spans) {
    const midS = span.startS + span.durationS / 2;
    const framePath = path.join(outDir, `shot-${String(span.ordinal).padStart(3, "0")}.jpg`);
    try {
      await runner(tool, [
        "-y",
        "-ss",
        midS.toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${maxWidth},iw)':-2`,
        "-q:v",
        "3",
        framePath,
      ]);
      frames.push({ shotId: span.shotId, ordinal: span.ordinal, framePath });
    } catch (error) {
      errors.push({
        shotId: span.shotId,
        ordinal: span.ordinal,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { frames, errors };
}
