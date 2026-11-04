/**
 * 全参考比对子层(1030 单镜分析门 · 吸收件③)。
 *
 * 用途:同一个镜的两支片配对比分——重出前后(是不是越改越差)、
 * 0.2 草稿档 vs 0.98 正式档(草稿门放行的是不是同一件东西)。
 * 零新依赖:libvmaf / ssim / psnr 三个比对滤镜本机 ffmpeg 7.1.1 已内建。
 *
 * 口径钉死三件事:
 * 1. 比对滤镜要求两条流同尺寸同帧率,尺寸/帧率不一致时把**待检流**拉到基准
 *    规格再比(基准侧不动),并把 `scaled` 记进结果——缩放本身会压分,不可当零影响;
 * 2. 同一支片自比 VMAF 实测 99.58 而非 100,所以「一致」不能用 `=== 100`;
 * 3. 全参考只能答「这两支像不像」,答不了「这一支好不好」——好不好的门在无参考侧
 *    (siti/blur/DOVER),两条都不许互相顶替。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { qcProbeMedia, resolveQcFfTool, type QcCommandRunner } from "./chapter-qc-fftools";
import {
  parsePsnrSummary,
  parseSsimSummary,
  parseVmafScore,
  type PsnrSummary,
  type SsimSummary,
} from "./parse-ffmpeg-probe";

const execFileAsync = promisify(execFile);

export type FullRefMetric = "vmaf" | "ssim" | "psnr";

export interface FullRefGeometry {
  reference: { width?: number; height?: number; fps?: number; durationS: number };
  distorted: { width?: number; height?: number; fps?: number; durationS: number };
  /** 待检流是否被重采样到基准规格(尺寸或帧率不一致即为 true) */
  scaled: boolean;
}

export interface FullRefScores {
  vmaf?: number;
  ssim?: SsimSummary;
  psnr?: PsnrSummary;
}

export interface FullRefComparison {
  scores: FullRefScores;
  geometry: FullRefGeometry;
  metrics: FullRefMetric[];
  elapsedMs: number;
  /** 单指标探测失败的原因(不阻断其余指标) */
  errors: Partial<Record<FullRefMetric, string>>;
}

export interface CompareFullReferenceInput {
  referencePath: string;
  distortedPath: string;
  /** 缺省三件全跑 */
  metrics?: readonly FullRefMetric[];
  runner?: QcCommandRunner;
}

/** 比对是双全解码重活,单件 5–9s 镜约 1s,成片级要放宽。 */
const FULL_REF_TIMEOUT_MS = 600_000;

const fullRefRunner: QcCommandRunner = (file, args) =>
  execFileAsync(file, args, { timeout: FULL_REF_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });

const COMPARE_FILTER: Record<FullRefMetric, string> = {
  vmaf: "libvmaf",
  ssim: "ssim",
  psnr: "psnr",
};

/**
 * filter_complex 图:待检流需要时先重采样,基准流恒不动。
 * 已对齐时直连 `[0:v][1:v]<filter>`,不插无谓的 scale(缩放本身会压分)。
 */
export function buildFullRefGraph(
  metric: FullRefMetric,
  align: { width: number; height: number; fps?: number } | undefined,
): string {
  const filter = COMPARE_FILTER[metric];
  if (!align) return `[0:v][1:v]${filter}`;
  const chain = [`scale=${align.width}:${align.height}:flags=bicubic`];
  if (align.fps) chain.push(`fps=${align.fps}`);
  return `[1:v]${chain.join(",")}[d];[0:v][d]${filter}`;
}

function needsAlignment(
  reference: { width?: number; height?: number; fps?: number },
  distorted: { width?: number; height?: number; fps?: number },
): { width: number; height: number; fps?: number } | undefined {
  if (!reference.width || !reference.height || !distorted.width || !distorted.height) return undefined;
  const sizeDiffers = reference.width !== distorted.width || reference.height !== distorted.height;
  const referenceFps = Number.isFinite(reference.fps ?? Number.NaN) ? reference.fps : undefined;
  const fpsDiffers =
    referenceFps !== undefined &&
    Number.isFinite(distorted.fps ?? Number.NaN) &&
    Math.abs((distorted.fps as number) - referenceFps) > 0.01;
  if (!sizeDiffers && !fpsDiffers) return undefined;
  return { width: reference.width, height: reference.height, ...(fpsDiffers ? { fps: referenceFps } : {}) };
}

export async function compareFullReferencePair(
  input: CompareFullReferenceInput,
): Promise<FullRefComparison> {
  const runner = input.runner ?? fullRefRunner;
  const metrics = [...(input.metrics ?? (["vmaf", "ssim", "psnr"] as const))];
  const startedAt = Date.now();
  const tool = resolveQcFfTool("ffmpeg");
  const [reference, distorted] = await Promise.all([
    qcProbeMedia(input.referencePath, runner),
    qcProbeMedia(input.distortedPath, runner),
  ]);
  const align = needsAlignment(reference, distorted);

  const scores: FullRefScores = {};
  const errors: FullRefComparison["errors"] = {};
  for (const metric of metrics) {
    try {
      const { stderr } = await runner(tool, [
        "-hide_banner",
        "-nostats",
        "-i",
        input.referencePath,
        "-i",
        input.distortedPath,
        "-filter_complex",
        buildFullRefGraph(metric, align),
        "-an",
        "-f",
        "null",
        "-",
      ]);
      if (metric === "vmaf") scores.vmaf = parseVmafScore(stderr);
      else if (metric === "ssim") scores.ssim = parseSsimSummary(stderr);
      else scores.psnr = parsePsnrSummary(stderr);
      if ((metric === "vmaf" && scores.vmaf === undefined) || (metric === "ssim" && !scores.ssim) || (metric === "psnr" && !scores.psnr)) {
        errors[metric] = "unparsed-output";
      }
    } catch (error) {
      errors[metric] = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    scores,
    geometry: {
      reference: { width: reference.width, height: reference.height, fps: reference.fps, durationS: reference.durationS },
      distorted: { width: distorted.width, height: distorted.height, fps: distorted.fps, durationS: distorted.durationS },
      scaled: Boolean(align),
    },
    metrics,
    elapsedMs: Date.now() - startedAt,
    errors,
  };
}
