/**
 * ffmpeg 探测输出解析器(纯函数,单测友好)。
 * 覆盖 blackdetect / freezedetect / silencedetect 的 stderr 行格式与
 * loudnorm 的 print_format=json 尾块,以及 siti / scdet / signalstats /
 * blurdetect 的逐帧 metadata=print 序列(1030 单镜分析门)。
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

/**
 * freezedetect 是事件流,而且三个值分三行打(实测 1031:`freeze_start` / `freeze_duration` /
 * `freeze_end` 各占一行,且 `[freezedetect]` 自身日志与 `metadata=print` 各打一遍),
 * 按"单行三值"匹配恒不命中——卡帧门就此长期哑火。这里逐行取事件、同一事件的双写手只认第一条,
 * 收尾靠 `freeze_end`;整片冻死只在片尾留 `freeze_start`(ffmpeg 不打结束的 freeze_end),
 * 故未闭合的尾部 start 按总时长截断,否则最严重的那一类伪动态反而读成"无冻结"。
 */
const FREEZE_EVENT_LINE = /lavfi\.freezedetect\.(freeze_start|freeze_end)[=:]\s*(-?\d+(?:\.\d+)?)/;

export function parseFreezeSegments(stderr: string, totalDurationS: number): FreezeSegment[] {
  const segments: FreezeSegment[] = [];
  let pendingStart: number | null = null;
  let pendingEnd: number | null = null;
  for (const line of stderr.split("\n")) {
    const match = FREEZE_EVENT_LINE.exec(line);
    if (!match) continue;
    const value = Number(match[2]);
    if (match[1] === "freeze_start") {
      // 同一次冻结被 freezedetect 与 metadata=print 各打一行:已有未闭合 start 时不另开一段
      if (pendingStart === null) pendingStart = value;
      continue;
    }
    if (pendingStart !== null && pendingEnd === null) pendingEnd = value;
    if (pendingStart !== null && pendingEnd !== null) {
      segments.push({ startS: pendingStart, endS: pendingEnd, durationS: Math.max(0, pendingEnd - pendingStart) });
      pendingStart = null;
      pendingEnd = null;
    }
  }
  if (pendingStart !== null && Number.isFinite(totalDurationS) && pendingStart < totalDurationS) {
    segments.push({ startS: pendingStart, endS: totalDurationS, durationS: totalDurationS - pendingStart });
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

/**
 * 逐帧 metadata=print 的一个采样点。
 * 真实行形如(`file=-` 时无日志前缀,走 stderr 时带 `[Parsed_metadata_N @ 0x..] `
 * 前缀,两种都吃):
 *   frame:1    pts:512     pts_time:0.0416667
 *   lavfi.siti.si=54.67
 *   lavfi.siti.ti=4.13
 * 每个 `frame:` 头开一个点,其后到下一个头之间的 lavfi 键归属该点。
 */
export interface FrameMetricPoint {
  frameIndex: number;
  tS: number;
  /** siti 时间信息(帧间运动量);首帧恒 0(siti 无前帧可比) */
  ti?: number;
  si?: number;
  /** scdet 场景切换分 */
  scdScore?: number;
  /** signalstats 8bit 亮度均值 */
  yavg?: number;
  satavg?: number;
  /** blurdetect 每帧清晰度分(越大越糊;链上 blurdetect 在 metadata 之前时才有) */
  blur?: number;
}

const FRAME_HEADER_LINE = /frame:(\d+)\s+pts:\S+\s+pts_time:(-?\d+(?:\.\d+)?)/;
const FRAME_METRIC_LINE = /lavfi\.(siti|scd|signalstats|blur)\.?([A-Za-z]*)\s*[=:](-?\d+(?:\.\d+)?)/;

export function parseFrameMetrics(stderr: string): FrameMetricPoint[] {
  const points: FrameMetricPoint[] = [];
  let current: FrameMetricPoint | null = null;
  const flush = () => {
    if (current) {
      points.push(current);
      current = null;
    }
  };
  for (const line of stderr.split("\n")) {
    const header = FRAME_HEADER_LINE.exec(line);
    if (header) {
      flush();
      current = { frameIndex: Number(header[1]), tS: Number(header[2]) };
      continue;
    }
    if (!current) continue;
    const metric = FRAME_METRIC_LINE.exec(line);
    if (!metric) continue;
    const value = Number(metric[3]);
    if (!Number.isFinite(value)) continue;
    const [, family, key] = metric;
    if (family === "blur") current.blur = value;
    else if (family === "siti") {
      if (key === "ti") current.ti = value;
      else if (key === "si") current.si = value;
    } else if (family === "scd") {
      if (key === "score") current.scdScore = value;
    } else if (key === "YAVG") current.yavg = value;
    else if (key === "SATAVG") current.satavg = value;
  }
  flush();
  return points;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 最近秩法(与 shot_signal_probe_1030.py 同口径:排序后取 floor(n*p))。 */
function nearestRank(values: readonly number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[Math.max(0, index)];
}

export interface MotionStatsSummary {
  /** 参与 TI 统计的帧数(已剔除首帧) */
  tiSampleCount: number;
  tiMean: number;
  tiP95: number;
  tiMax: number;
  siMean: number;
  /** TI < staticTiGuard 的帧占比——伪动态(画面在动但内容不动)主判据 */
  staticFrameRatio: number;
}

/**
 * TI 序列统计。首帧 TI 恒 0 属探测器性质而非画面性质,必须剔除后再算,
 * 否则每支片都白送一个"静止帧"。
 */
export function summarizeMotion(
  points: readonly FrameMetricPoint[],
  staticTiGuard: number,
): MotionStatsSummary | undefined {
  const ti = points.filter((point) => point.frameIndex !== 0 && point.ti !== undefined).map((point) => point.ti as number);
  if (ti.length === 0) return undefined;
  const si = points.filter((point) => point.si !== undefined).map((point) => point.si as number);
  const still = ti.filter((value) => value < staticTiGuard).length;
  return {
    tiSampleCount: ti.length,
    tiMean: mean(ti),
    tiP95: nearestRank(ti, 0.95),
    tiMax: Math.max(...ti),
    siMean: si.length > 0 ? mean(si) : Number.NaN,
    staticFrameRatio: still / ti.length,
  };
}

export interface ExposureStatsSummary {
  yavgSampleCount: number;
  yavgMin: number;
  yavgMax: number;
  yavgMean: number;
  /** 饱和度均值峰值——色彩被抹平(糊成灰)的旁证 */
  satavgMax: number;
  darkFrameRatio: number;
  blownFrameRatio: number;
}

export function summarizeExposure(
  points: readonly FrameMetricPoint[],
  lowYavg: number,
  highYavg: number,
): ExposureStatsSummary | undefined {
  const y = points.filter((point) => point.yavg !== undefined).map((point) => point.yavg as number);
  if (y.length === 0) return undefined;
  const sat = points.filter((point) => point.satavg !== undefined).map((point) => point.satavg as number);
  return {
    yavgSampleCount: y.length,
    yavgMin: Math.min(...y),
    yavgMax: Math.max(...y),
    yavgMean: mean(y),
    satavgMax: sat.length > 0 ? Math.max(...sat) : Number.NaN,
    darkFrameRatio: y.filter((value) => value < lowYavg).length / y.length,
    blownFrameRatio: y.filter((value) => value > highYavg).length / y.length,
  };
}

export interface ClarityStatsSummary {
  blurSampleCount: number;
  blurMean: number;
  blurP95: number;
  blurMax: number;
}

/** blurdetect 逐帧分统计(越大越糊);无 lavfi.blur(链里没挂 blurdetect)时 undefined。 */
export function summarizeClarity(points: readonly FrameMetricPoint[]): ClarityStatsSummary | undefined {
  const blur = points.filter((point) => point.blur !== undefined).map((point) => point.blur as number);
  if (blur.length === 0) return undefined;
  return {
    blurSampleCount: blur.length,
    blurMean: mean(blur),
    blurP95: nearestRank(blur, 0.95),
    blurMax: Math.max(...blur),
  };
}

export interface CutStatsSummary {
  scoreMax: number;
  /** scd.score ≥ hardCutScore 的采样点数 */
  hardCutCount: number;
  /** scd.score ≥ softCutScore 的采样点数(含硬切) */
  softCutCount: number;
}

/**
 * scdet 切换分统计。注意它是**采样点**计数:select 抽帧后一步长可能跨过
 * 一次真切换,所以计数是下界,不能用来断言"没有切"。
 */
export function summarizeCuts(
  points: readonly FrameMetricPoint[],
  hardCutScore: number,
  softCutScore: number,
): CutStatsSummary | undefined {
  const score = points.filter((point) => point.scdScore !== undefined).map((point) => point.scdScore as number);
  if (score.length === 0) return undefined;
  return {
    scoreMax: Math.max(...score),
    hardCutCount: score.filter((value) => value >= hardCutScore).length,
    softCutCount: score.filter((value) => value >= softCutScore).length,
  };
}

const BLUR_MEAN_LINE = /blur mean:\s*(\d+(?:\.\d+)?)/;

/** blurdetect 收尾打的清晰度均值(全片单值);越低越糊。 */
export function parseBlurMean(stderr: string): number | undefined {
  const match = BLUR_MEAN_LINE.exec(stderr);
  return match ? Number(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// 全参考比对(两条流配对:重出前后 / 480P-vs-960P 同镜)
// ---------------------------------------------------------------------------

const VMAF_LINE = /VMAF score:\s*(\d+(?:\.\d+)?)/;
const SSIM_LINE =
  /SSIM Y:(\d+(?:\.\d+)?)\s*\(([-\d.]+)\)\s*U:(\d+(?:\.\d+)?)\s*\(([-\d.]+)\)\s*V:(\d+(?:\.\d+)?)\s*\(([-\d.]+)\)\s*All:(\d+(?:\.\d+)?)\s*\(([-\d.]+)\)/;
const PSNR_LINE = /PSNR y:(\d+(?:\.\d+)?)\s*u:(\d+(?:\.\d+)?)\s*v:(\d+(?:\.\d+)?)\s*average:(\d+(?:\.\d+)?)\s*min:(\d+(?:\.\d+)?)\s*max:(\d+(?:\.\d+)?)/;

/**
 * libvmaf 收尾分(0–100,越大越接近基准)。
 * 注意实测同一支片自比 = 99.58 而非 100(VMAF 自身的天花板抖动),
 * 所以「完全一致」的判据不能写成 `=== 100`。
 */
export function parseVmafScore(stderr: string): number | undefined {
  const match = VMAF_LINE.exec(stderr);
  return match ? Number(match[1]) : undefined;
}

export interface SsimSummary {
  y: number;
  u: number;
  v: number;
  all: number;
  /** All 的 dB 形式(括号里的第二个数) */
  allDb: number;
}

/** ssim 收尾行:`SSIM Y:0.665837 (4.760414) U:… V:… All:0.763297 (6.257956)`。 */
export function parseSsimSummary(stderr: string): SsimSummary | undefined {
  const match = SSIM_LINE.exec(stderr);
  if (!match) return undefined;
  const values = [match[1], match[3], match[5], match[7], match[8]].map(Number);
  if (!values.every((value) => Number.isFinite(value))) return undefined;
  const [y, u, v, all, allDb] = values;
  return { y, u, v, all, allDb };
}

export interface PsnrSummary {
  y: number;
  u: number;
  v: number;
  average: number;
  min: number;
  max: number;
}

/** psnr 收尾行(dB,越大越接近基准;`inf` 解析失败按缺省处理)。 */
export function parsePsnrSummary(stderr: string): PsnrSummary | undefined {
  const match = PSNR_LINE.exec(stderr);
  if (!match) return undefined;
  const values = match.slice(1).map(Number);
  if (!values.every((value) => Number.isFinite(value))) return undefined;
  const [y, u, v, average, min, max] = values;
  return { y, u, v, average, min, max };
}
