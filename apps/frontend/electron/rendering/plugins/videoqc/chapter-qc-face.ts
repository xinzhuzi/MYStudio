/**
 * 人脸可判读度接线(1102 吸收件①)。
 *
 * 出数真源在 `apps/backend/face_qc/worker.py`(YuNet 跑在托管 Python 的 OpenCV 上);
 * 本件只做「找解释器 → 跑一趟 → 收 JSON」,形状照 chapter-qc-vad.ts。
 *
 * 这条门**只声明证据质量,不判内容**:1102 在 ch1_h3_matrix_1029(二维国风,50 支)标定——
 *   正对照 messi5.jpg 检出 score 0.894;负对照品牌 logo 0 脸;
 *   真产出 faceRecall p10=0.1 / p50=0.9;零检出 3 支经亲检分别是靴子特写、背面行走、侧脸,
 *   全是合理内容。同批 43 张真脸 noseOverEye 自然区间 0.28–1.02。
 *   同章双分辨率对照(24 帧):1080P 出片 50 脸全可辨(中位短边 71.1px,readableRatio 1.0),
 *   608×352 出片 51 脸仅 18 可辨(中位短边 22.1px,readableRatio 0.353)——变量只有分辨率。
 * 所以「检不到脸」不能 fail,几何比值也不能 fail;能站住的只有「检到的脸够不够大、够不够判」。
 * 五官错位/手指/口型的判定住在 L5 多模态预审(vision-preflight),不住这里。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ChapterQcFaceSignalsV1, ChapterQcFindingV1 } from "./chapter-qc-types";

const execFileAsync = promisify(execFile);

/** 可检出的脸里至少这么多比例达到可辨尺寸,人脸维才算「有自动证据」。 */
export const FACE_READABLE_MIN_RATIO = 0.5;

/** 每章均匀采样帧数;24 帧实测 ≈2s,再密对覆盖率没有分辨力增益。 */
export const FACE_SAMPLE_FRAMES = 24;

const FACE_TIMEOUT_MS = 180_000;

export interface ChapterQcFaceInput {
  videoPath: string;
  pythonExecutable: string;
  /** apps/backend(PYTHONPATH 与 cwd) */
  backendRoot: string;
  samples?: number;
  timeoutMs?: number;
  runner?: FaceCommandRunner;
}

export type FaceCommandRunner = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: FaceCommandRunner = (file, args, options) =>
  execFileAsync(file, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    maxBuffer: 16 * 1024 * 1024,
  });

/** 只认真数字:worker 对「算不出来」发 null(零脸章的 readableRatio 就是 null),而 Number(null)===0 会把缺失读成 0。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** worker 恒打一行 JSON(stdout 末条非空行);解析失败按「无证据」处理。 */
export function parseFaceWorkerJson(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readFaceSignals(payload: Record<string, unknown>): ChapterQcFaceSignalsV1 {
  const framesRead = finiteNumber(payload.framesRead) ?? 0;
  return {
    framesRead,
    framesWithFace: finiteNumber(payload.framesWithFace) ?? 0,
    ...(finiteNumber(payload.coverage) !== undefined ? { coverage: finiteNumber(payload.coverage) } : {}),
    faceCount: finiteNumber(payload.faceCount) ?? 0,
    readableFaceCount: finiteNumber(payload.readableFaceCount) ?? 0,
    ...(finiteNumber(payload.readableRatio) !== undefined ? { readableRatio: finiteNumber(payload.readableRatio) } : {}),
    minReadableFacePx: finiteNumber(payload.minReadableFacePx) ?? 24,
    ...(finiteNumber(payload.medianFaceShortSidePx) !== undefined
      ? { medianFaceShortSidePx: finiteNumber(payload.medianFaceShortSidePx) } : {}),
    ...(finiteNumber(payload.maxFaceScore) !== undefined ? { maxFaceScore: finiteNumber(payload.maxFaceScore) } : {}),
    ...(finiteNumber(payload.driftDistanceP50) !== undefined
      ? { driftDistanceP50: finiteNumber(payload.driftDistanceP50) } : {}),
    ...(finiteNumber(payload.driftDistanceP95) !== undefined
      ? { driftDistanceP95: finiteNumber(payload.driftDistanceP95) } : {}),
    driftPairs: finiteNumber(payload.driftPairs) ?? 0,
    ...(typeof payload.model === "string" ? { model: payload.model } : {}),
    // [1103 Phase 1] Parse new geometry fields
    ...(finiteNumber(payload.geometryAspectP50) !== undefined
      ? { geometryAspectP50: finiteNumber(payload.geometryAspectP50) } : {}),
    ...(finiteNumber(payload.geometryAspectP95) !== undefined
      ? { geometryAspectP95: finiteNumber(payload.geometryAspectP95) } : {}),
    ...(finiteNumber(payload.geometryAnomalyFlags) !== undefined
      ? { geometryAnomalyFlags: finiteNumber(payload.geometryAnomalyFlags) } : {}),
  };
}

export async function runChapterQcFace(input: ChapterQcFaceInput): Promise<{
  available: boolean;
  signals?: ChapterQcFaceSignalsV1;
  reason?: string;
}> {
  const runner = input.runner ?? defaultRunner;
  try {
    const { stdout } = await runner(
      input.pythonExecutable,
      ["-m", "face_qc.worker", "--video", input.videoPath, "--samples", String(input.samples ?? FACE_SAMPLE_FRAMES), "--json"],
      {
        cwd: input.backendRoot,
        env: { ...process.env, PYTHONPATH: input.backendRoot },
        timeout: input.timeoutMs ?? FACE_TIMEOUT_MS,
      },
    );
    const payload = parseFaceWorkerJson(stdout);
    if (!payload) return { available: false, reason: "人脸 worker 输出无法解析" };
    if (payload.status !== "ok") {
      const code = typeof payload.code === "string" ? payload.code : "unknown";
      return { available: false, reason: `人脸 ${payload.status ?? "unknown"}(${code})` };
    }
    const signals = readFaceSignals(payload);
    if (signals.framesRead === 0) {
      return { available: false, signals, reason: "人脸采样帧 0 帧可读(视频打不开或时长为 0)" };
    }
    return { available: true, signals };
  } catch (error) {
    return { available: false, reason: `人脸调用异常: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 人脸证据 → finding(一条 info 汇总 + 一条 warn 不可判声明)。
 * 不可判声明只在「检到了脸但都太小」时出:零检出是合理内容(背面/靴子特写已亲检),
 * 不该在体检单上喊狼来了。
 */
export function buildFaceFindings(signals: ChapterQcFaceSignalsV1): ChapterQcFindingV1[] {
  const findings: ChapterQcFindingV1[] = [{
    code: "chapter-qc.face.summary",
    layer: "vision",
    severity: "info",
    message: `人脸检出 ${signals.framesWithFace}/${signals.framesRead} 帧(覆盖率 ${signals.coverage ?? "NA"}),`
      + `共 ${signals.faceCount} 张,可辨 ${signals.readableFaceCount} 张,中位短边 ${signals.medianFaceShortSidePx ?? "NA"}px`
      + `;跨帧表观距离 p50 ${signals.driftDistanceP50 ?? "NA"} / p95 ${signals.driftDistanceP95 ?? "NA"}(未标定,只记账)`,
    evidence: { ...signals },
  }];
  const unreadable = signals.faceCount > 0 && (signals.readableRatio ?? 0) < FACE_READABLE_MIN_RATIO;
  if (unreadable) {
    findings.push({
      code: "chapter-qc.face.unreadable",
      layer: "vision",
      severity: "warn",
      message: `检出的脸 ${((signals.readableRatio ?? 0) * 100).toFixed(0)}% 达到可辨尺寸(线 ${FACE_READABLE_MIN_RATIO * 100}%),`
        + "五官/手指崩坏无法自动判——须提分辨率出片或交多模态预审",
      evidence: { readableRatio: signals.readableRatio ?? 0, minReadableFacePx: signals.minReadableFacePx },
    });
  }
  return findings;
}
