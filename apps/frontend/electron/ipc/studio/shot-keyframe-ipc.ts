// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 单镜截帧 IPC(09-15 teman-absorption P1a):
 * - `shot-keyframe-extract`:主进程 ffmpeg 从单镜视频抽帧(当前帧/均匀采样),
 *   帧图写项目数据区(project-file:// 受管 URL 返回),引擎 userdata 零写入。
 * - `shot-video-probe`:ffprobe 元数据(时长/帧率/帧数),供 A/B 对比器判定
 *   帧对齐模式(仅双源 frame_count 已知且相同时启用帧对齐)。
 *
 * 二进制解析与 videoqc 链(chapter-qc-fftools)同口径:
 * env `MYSTUDIO_FFMPEG_PATH` / `MYSTUDIO_FFPROBE_PATH`(main.ts 启动时注入共享
 * 工具链)→ 裸名兜底 PATH 查找。抽帧参数沿用 QC 链同款
 * `-ss <t> -frames:v 1 -vf scale=min(768,iw):-2 -q:v 3`。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import {
  createProjectFileUrl,
  parseProjectFileUrl,
  resolveProjectScopedFilePath,
} from "../../storage/storage-paths";

const execFileAsync = promisify(execFile);

export const SHOT_KEYFRAME_EXTRACT_CHANNEL = "shot-keyframe-extract";
export const SHOT_VIDEO_PROBE_CHANNEL = "shot-video-probe";

/** 自动抽帧档位(PRD AC2:3/5/9 帧均匀采样) */
export type ShotKeyframeSampleCount = 3 | 5 | 9;

export interface ShotKeyframeExtractRequestV1 {
  schemaVersion: 1;
  projectId: string;
  /** 单镜视频(project-file:// 受管 URL;主进程侧遏制解析,绝收绝对路径) */
  videoUrl: string;
  /** 帧图输出目录(项目根相对,如 media/storyboard-keyframes/<章>/<镜>) */
  relativeOutDir: string;
  /** 帧文件名词干(镜 id 净化产物) */
  fileStem: string;
  mode:
    | { kind: "single"; timestampS: number }
    | { kind: "uniform"; count: ShotKeyframeSampleCount };
  /** 帧宽上限(默认 768,与 QC 代表帧同口径) */
  maxWidth?: number;
}

export interface ShotKeyframeExtractedFrameV1 {
  /** project-file:// 受管 URL(可直接入 keyframes mediaRef) */
  url: string;
  /** 抽帧时刻(秒;均匀采样含 0=首帧) */
  timestampS: number;
}

export interface ShotKeyframeExtractReplyV1 {
  schemaVersion: 1;
  success: boolean;
  message?: string;
  /** 探测到的视频时长(秒);renderer 侧合并 keyframes 的时长上限用 */
  durationS?: number;
  frames: ShotKeyframeExtractedFrameV1[];
}

export interface ShotVideoProbeRequestV1 {
  schemaVersion: 1;
  projectId: string;
  videoUrl: string;
}

export interface ShotVideoProbeReplyV1 {
  schemaVersion: 1;
  success: boolean;
  message?: string;
  durationS?: number;
  fps?: number;
  frameCount?: number;
  /** true=容器未带帧数,frame_count 按 duration×fps 估算(对比器须示「估」) */
  frameCountEstimated?: boolean;
  width?: number;
  height?: number;
}

export type ShotKeyframeCommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: ShotKeyframeCommandRunner = (file, args) =>
  execFileAsync(file, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });

function resolveShotFfTool(kind: "ffmpeg" | "ffprobe"): string {
  const envValue =
    kind === "ffprobe" ? process.env.MYSTUDIO_FFPROBE_PATH : process.env.MYSTUDIO_FFMPEG_PATH;
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : kind;
}

/**
 * 均匀采样时刻:count 帧铺满 [0, duration],含首帧(t=0,回接首帧语义)。
 * 末帧内缩 min(50ms, 1%时长)——恰在 EOF 的 -ss 常拿不到帧。
 */
export function sampleUniformTimestamps(durationS: number, count: number): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [];
  const safeCount = Math.max(1, Math.round(count));
  if (safeCount === 1) return [0];
  const tailGuard = Math.min(0.05, durationS * 0.01);
  const last = Math.max(0, durationS - tailGuard);
  return Array.from(
    { length: safeCount },
    (_, index) => (index === safeCount - 1 ? last : (durationS * index) / (safeCount - 1)),
  );
}

interface FfprobeStreamJson {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  nb_frames?: string | number;
}

interface FfprobeJson {
  streams?: FfprobeStreamJson[];
  format?: { duration?: string | number };
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

export interface ShotVideoMetadata {
  durationS: number;
  fps?: number;
  frameCount?: number;
  frameCountEstimated?: boolean;
  width?: number;
  height?: number;
}

export async function probeShotVideo(
  videoPath: string,
  runner: ShotKeyframeCommandRunner = defaultRunner,
): Promise<ShotVideoMetadata> {
  const { stdout } = await runner(resolveShotFfTool("ffprobe"), [
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
  const durationS = Number(parsed.format?.duration);
  if (!video || !Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`ffprobe 未找到视频流或时长异常: ${videoPath}`);
  }
  const fps = parseFrameRate(video.avg_frame_rate);
  const nbFrames = Number(video.nb_frames);
  let frameCount: number | undefined;
  let frameCountEstimated: boolean | undefined;
  if (Number.isFinite(nbFrames) && nbFrames > 0) {
    frameCount = Math.round(nbFrames);
  } else if (fps) {
    frameCount = Math.max(1, Math.round(durationS * fps));
    frameCountEstimated = true;
  }
  return { durationS, fps, frameCount, frameCountEstimated, width: video.width, height: video.height };
}

function isSafeRelativeDir(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value)) return false;
  return value.split("/").every((segment) => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9\u4e00-\u9fa5._-]+$/.test(segment));
}

function isSafeFileStem(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value);
}

function clampMaxWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 768;
  return Math.min(2048, Math.max(128, Math.round(value)));
}

export interface RegisterShotKeyframeIpcOptions {
  getDataDir: () => string;
  runner?: ShotKeyframeCommandRunner;
}

export interface ShotKeyframeIpc {
  dispose: () => void;
}

function baseReply(): { schemaVersion: 1 } {
  return { schemaVersion: 1 };
}

/**
 * 抽帧核心(导出供测试直调):解析请求→探时长→按模式定时刻→逐帧 ffmpeg。
 * 单帧失败不整体失败(逐帧 errors 聚合,全部失败才 success=false)。
 */
export async function extractShotKeyframeFrames(
  request: ShotKeyframeExtractRequestV1,
  deps: { getDataDir: () => string; runner?: ShotKeyframeCommandRunner },
): Promise<ShotKeyframeExtractReplyV1> {
  const invalid = (message: string): ShotKeyframeExtractReplyV1 => ({
    ...baseReply(),
    success: false,
    message,
    frames: [],
  });
  if (request.schemaVersion !== 1) return invalid("抽帧请求版本不识别");
  if (typeof request.projectId !== "string" || !request.projectId.trim()) return invalid("projectId 缺失");
  if (typeof request.videoUrl !== "string" || !request.videoUrl.startsWith("project-file://")) {
    return invalid("视频地址必须是项目内文件(project-file://)");
  }
  if (!isSafeRelativeDir(request.relativeOutDir)) return invalid("帧输出目录不合法");
  if (!isSafeFileStem(request.fileStem)) return invalid("帧文件名词干不合法");
  const runner = deps.runner ?? defaultRunner;
  const parsedUrl = parseProjectFileUrl(request.videoUrl);
  if (!parsedUrl || parsedUrl.projectId !== request.projectId) return invalid("视频地址与项目不匹配");
  let videoPath: string;
  try {
    videoPath = resolveProjectScopedFilePath(deps.getDataDir(), request.projectId, parsedUrl.relativePath);
  } catch {
    return invalid("视频地址解析失败(路径越界或不属于本项目)");
  }
  if (!fs.existsSync(videoPath)) return invalid("视频文件不存在或已被移动");
  let metadata: ShotVideoMetadata;
  try {
    metadata = await probeShotVideo(videoPath, runner);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
  let timestamps: number[];
  if (request.mode.kind === "single") {
    const t = request.mode.timestampS;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return invalid("抽帧时刻非法");
    timestamps = [Math.min(t, Math.max(0, metadata.durationS - 0.05))];
  } else {
    const count = request.mode.count;
    if (count !== 3 && count !== 5 && count !== 9) return invalid("自动抽帧档位只支持 3/5/9");
    timestamps = sampleUniformTimestamps(metadata.durationS, count);
  }
  const maxWidth = clampMaxWidth(request.maxWidth);
  const outDirPath = resolveProjectScopedFilePath(
    deps.getDataDir(),
    request.projectId,
    request.relativeOutDir,
  );
  await fs.promises.mkdir(outDirPath, { recursive: true });
  const tool = resolveShotFfTool("ffmpeg");
  const frames: ShotKeyframeExtractedFrameV1[] = [];
  const errors: string[] = [];
  for (const [index, timestampS] of timestamps.entries()) {
    const filename = `${request.fileStem}-${String(index + 1).padStart(2, "0")}-${Math.round(timestampS * 1000)}ms.jpg`;
    const relativePath = `${request.relativeOutDir}/${filename}`;
    const framePath = path.join(outDirPath, filename);
    try {
      await runner(tool, [
        "-y",
        "-ss",
        timestampS.toFixed(3),
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
      if (!fs.existsSync(framePath)) throw new Error("ffmpeg 未产出帧文件");
      frames.push({ url: createProjectFileUrl(request.projectId, relativePath), timestampS });
    } catch (error) {
      errors.push(`第 ${index + 1} 帧: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (frames.length === 0) {
    return { ...baseReply(), success: false, message: errors.join(";") || "抽帧失败", frames: [] };
  }
  return {
    ...baseReply(),
    success: true,
    ...(errors.length ? { message: errors.join(";") } : {}),
    durationS: metadata.durationS,
    frames,
  };
}

export function registerShotKeyframeIpcHandlers(options: RegisterShotKeyframeIpcOptions): ShotKeyframeIpc {
  const deps = { getDataDir: options.getDataDir, runner: options.runner };
  ipcMain.handle(SHOT_KEYFRAME_EXTRACT_CHANNEL, async (_event, payload: unknown) => {
    try {
      return await extractShotKeyframeFrames(payload as ShotKeyframeExtractRequestV1, deps);
    } catch (error) {
      return {
        schemaVersion: 1 as const,
        success: false,
        message: error instanceof Error ? error.message : String(error),
        frames: [],
      };
    }
  });
  ipcMain.handle(SHOT_VIDEO_PROBE_CHANNEL, async (_event, payload: unknown) => {
    const request = payload as ShotVideoProbeRequestV1;
    const fail = (message: string): ShotVideoProbeReplyV1 => ({ schemaVersion: 1, success: false, message });
    try {
      if (request?.schemaVersion !== 1) return fail("探测请求版本不识别");
      if (typeof request.projectId !== "string" || !request.projectId.trim()) return fail("projectId 缺失");
      if (typeof request.videoUrl !== "string" || !request.videoUrl.startsWith("project-file://")) {
        return fail("视频地址必须是项目内文件(project-file://)");
      }
      const parsedUrl = parseProjectFileUrl(request.videoUrl);
      if (!parsedUrl || parsedUrl.projectId !== request.projectId) return fail("视频地址与项目不匹配");
      const videoPath = resolveProjectScopedFilePath(deps.getDataDir(), request.projectId, parsedUrl.relativePath);
      if (!fs.existsSync(videoPath)) return fail("视频文件不存在或已被移动");
      const metadata = await probeShotVideo(videoPath, deps.runner);
      return {
        schemaVersion: 1,
        success: true,
        durationS: metadata.durationS,
        ...(metadata.fps !== undefined ? { fps: metadata.fps } : {}),
        ...(metadata.frameCount !== undefined ? { frameCount: metadata.frameCount, frameCountEstimated: metadata.frameCountEstimated } : {}),
        ...(metadata.width !== undefined ? { width: metadata.width } : {}),
        ...(metadata.height !== undefined ? { height: metadata.height } : {}),
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
  return {
    dispose() {
      ipcMain.removeHandler(SHOT_KEYFRAME_EXTRACT_CHANNEL);
      ipcMain.removeHandler(SHOT_VIDEO_PROBE_CHANNEL);
    },
  };
}
