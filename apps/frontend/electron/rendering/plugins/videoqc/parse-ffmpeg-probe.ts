/**
 * ffmpeg 探测输出解析器(纯函数,单测友好)。
 * 覆盖 blackdetect / freezedetect / silencedetect 的 stderr 行格式与
 * loudnorm 的 print_format=json 尾块。
 */

export interface BlackSegment {
  startS: number;
  endS: number;
  durationS: number;
}

export interface FreezeSegment {
  startS: number;
  endS: number;
  durationS: number;
}

export interface SilenceSegment {
  startS: number;
  endS: number;
  durationS: number;
}

export interface LoudnessMeasurement {
  /** 综合响度 LUFS */
  inputI: number;
  /** 真峰值 dBTP */
  inputTp: number;
  /** 响度范围 LU */
  inputLra: number;
}

const BLACK_LINE = /black_start:\s*(\d+(?:\.\d+)?)\s+black_end:\s*(\d+(?:\.\d+)?)\s+black_duration:\s*(\d+(?:\.\d+)?)/;
const FREEZE_LINE = /freeze_start:\s*(\d+(?:\.\d+)?)\s+freeze_duration:\s*(\d+(?:\.\d+)?)\s+freeze_end:\s*(\d+(?:\.\d+)?)/;
const SILENCE_START_LINE = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
const SILENCE_END_LINE = /silence_end:\s*(\d+(?:\.\d+)?).*?silence_duration:\s*(\d+(?:\.\d+)?)/;

export function parseBlackSegments(stderr: string): BlackSegment[] {
  const segments: BlackSegment[] = [];
  for (const line of stderr.split("\n")) {
    const match = BLACK_LINE.exec(line);
    if (match) {
      segments.push({
        startS: Number(match[1]),
        endS: Number(match[2]),
        durationS: Number(match[3]),
      });
    }
  }
  return segments;
}

export function parseFreezeSegments(stderr: string): FreezeSegment[] {
  const segments: FreezeSegment[] = [];
  for (const line of stderr.split("\n")) {
    const match = FREEZE_LINE.exec(line);
    if (match) {
      segments.push({
        startS: Number(match[1]),
        durationS: Number(match[2]),
        endS: Number(match[3]),
      });
    }
  }
  return segments;
}

/**
 * silencedetect 输出是事件流(start 一行,end 一行);未闭合的尾部 start
 * (视频在静音中结束)以 Infinity end 记,交由调用方按总时长截断。
 */
export function parseSilenceSegments(stderr: string, totalDurationS: number): SilenceSegment[] {
  const segments: SilenceSegment[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const startMatch = SILENCE_START_LINE.exec(line);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = SILENCE_END_LINE.exec(line);
    if (endMatch && pendingStart !== null) {
      const endS = Number(endMatch[1]);
      const durationS = Number(endMatch[2]);
      segments.push({ startS: Math.max(0, pendingStart), endS, durationS });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) {
    const endS = totalDurationS;
    segments.push({ startS: Math.max(0, pendingStart), endS, durationS: Math.max(0, endS - pendingStart) });
  }
  return segments;
}

/** loudnorm 的 json 打在 [Parsed_loudnorm_*] 标记行之后;取最后一个完整 JSON 块。 */
export function parseLoudness(stderr: string): LoudnessMeasurement | undefined {
  const marker = stderr.lastIndexOf("[Parsed_loudnorm_");
  if (marker < 0) return undefined;
  const jsonStart = stderr.indexOf("{", marker);
  if (jsonStart < 0) return undefined;
  const jsonEnd = stderr.indexOf("}", jsonStart);
  if (jsonEnd < 0) return undefined;
  try {
    const parsed = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    const inputI = Number(parsed.input_i);
    const inputTp = Number(parsed.input_tp);
    const inputLra = Number(parsed.input_lra);
    if (![inputI, inputTp, inputLra].every((value) => Number.isFinite(value))) return undefined;
    return { inputI, inputTp, inputLra };
  } catch {
    return undefined;
  }
}

/** 静音补集=语音段(夹在 [0, totalDurationS] 内)。 */
export function speechSegmentsFromSilences(
  silences: SilenceSegment[],
  totalDurationS: number,
): Array<{ startS: number; endS: number }> {
  const speech: Array<{ startS: number; endS: number }> = [];
  let cursor = 0;
  const ordered = [...silences].sort((left, right) => left.startS - right.startS);
  for (const silence of ordered) {
    const start = Math.max(0, silence.startS);
    const end = Math.min(totalDurationS, silence.endS);
    if (start > cursor + 0.001) speech.push({ startS: cursor, endS: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < totalDurationS - 0.001) speech.push({ startS: cursor, endS: totalDurationS });
  return speech;
}
