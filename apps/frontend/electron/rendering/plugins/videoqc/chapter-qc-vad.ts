/**
 * VAD 语音口径接线(1030 吸收件②:Silero VAD 顶掉 silencedetect 的静默退化)。
 *
 * 出数真源在 `apps/backend/speech_vad/worker.py`;本件只做「找解释器 → 跑一趟 → 收 JSON」。
 * silero-vad 缺位(托管 Python 还没跑过「开始配置」)/ 跑挂 ≠ 语音没问题:`available=false` 带一句原因,
 * L2 退回 silencedetect 补集,三态板把 speech-integrity 记 unverified(§九.六 反过度声称③)。
 *
 * 实测口径(/tmp/finalfix_output.mp4 197.12s 带 BGM 成片):VAD 语音 146.08s/48 段,
 * silencedetect -35dB 只看见 0.95s 死寂(反推「语音」196.17s)——50.09s 的差就是被 BGM 吃掉的语音窗。
 * 本机耗时 1.3s(197s 片,CPU torch;冷缓存首趟 5.8s),对整章 QC 属可接受增量。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveVideoQcRuntimePaths } from "./video-qc-runtime";

const execFileAsync = promisify(execFile);

export interface ChapterQcVadSegment {
  startS: number;
  endS: number;
}

export interface ChapterQcVadOutcome {
  /** false = 无 VAD 证据(silero-vad 缺位/跑挂),调用方须按「查不出」处理 */
  available: boolean;
  segments: ChapterQcVadSegment[];
  speechSeconds?: number;
  durationS?: number;
  /** silero-vad@6.2.3 之类,留审计 */
  model?: string;
  reason?: string;
}

export interface ChapterQcVadInput {
  videoPath: string;
  pythonExecutable: string;
  /** apps/backend(PYTHONPATH 与 cwd) */
  backendRoot: string;
  threshold?: number;
  timeoutMs?: number;
  runner?: VadCommandRunner;
}

export type VadCommandRunner = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/** VAD 判定阈;0.35 档实测只多 4.7s 语音,取官方缺省 0.5。 */
export const VAD_CONF_THRESHOLD = 0.5;
/** 197s 片实跑 5.8s;留足冷启 torch + 长章余量。 */
const VAD_TIMEOUT_MS = 180_000;

/**
 * VAD 解释器 = managed Python(与 video_qc 同一支,设置页 `requirements.txt` 装 silero-vad)。
 * 不为 VAD 建 venv:仓规 apps/backend/README.md 只认一条应用内 pip 路径,手搓 profile 装机上没有。
 * 没跑过「开始配置」→ silero-vad 缺位 → 这里照常返回可执行文件路径,由 worker 回 needs-runtime,
 * 上层落 unverified(见 runChapterQcVad 的失败语义),不静默补装。
 */
export function resolveVadPythonExecutable(
  storageBasePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolveVideoQcRuntimePaths(storageBasePath, platform).pythonExecutable;
}

const defaultRunner: VadCommandRunner = (file, args, options) =>
  execFileAsync(file, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    maxBuffer: 16 * 1024 * 1024,
  });

interface VadWorkerPayload {
  status?: string;
  code?: string;
  message?: string;
  durationS?: number;
  model?: string;
  speechSeconds?: number;
  segments?: Array<{ startS?: unknown; endS?: unknown }>;
}

function readSegments(payload: VadWorkerPayload): ChapterQcVadSegment[] {
  if (!Array.isArray(payload.segments)) return [];
  const segments: ChapterQcVadSegment[] = [];
  for (const raw of payload.segments) {
    const startS = Number(raw?.startS);
    const endS = Number(raw?.endS);
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) continue;
    segments.push({ startS, endS });
  }
  return segments.sort((left, right) => left.startS - right.startS);
}

/** worker 恒打一行 JSON(stdout 末条非空行);解析失败按「无证据」处理。 */
export function parseVadWorkerJson(stdout: string): VadWorkerPayload | null {
  const line = stdout
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line) as VadWorkerPayload;
  } catch {
    return null;
  }
}

export async function runChapterQcVad(input: ChapterQcVadInput): Promise<ChapterQcVadOutcome> {
  const runner = input.runner ?? defaultRunner;
  const threshold = input.threshold ?? VAD_CONF_THRESHOLD;
  try {
    const { stdout } = await runner(
      input.pythonExecutable,
      ["-m", "speech_vad.worker", "--video", input.videoPath, "--threshold", String(threshold), "--json"],
      {
        cwd: input.backendRoot,
        env: { ...process.env, PYTHONPATH: input.backendRoot },
        timeout: input.timeoutMs ?? VAD_TIMEOUT_MS,
      },
    );
    const payload = parseVadWorkerJson(stdout);
    if (!payload) return { available: false, segments: [], reason: "VAD worker 输出无法解析" };
    if (payload.status !== "ok") {
      return {
        available: false,
        segments: [],
        reason: `VAD ${payload.status ?? "unknown"}${payload.code ? `(${payload.code})` : ""}`,
      };
    }
    const segments = readSegments(payload);
    if (segments.length === 0) {
      return {
        available: false,
        segments: [],
        reason: "VAD 出段为 0(无人声或全部短于 min_speech_duration_ms)",
      };
    }
    return {
      available: true,
      segments,
      speechSeconds: Number.isFinite(payload.speechSeconds) ? payload.speechSeconds : undefined,
      ...(Number.isFinite(payload.durationS) ? { durationS: payload.durationS } : {}),
      ...(payload.model ? { model: payload.model } : {}),
    };
  } catch (error) {
    return {
      available: false,
      segments: [],
      reason: `VAD 调用异常: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
