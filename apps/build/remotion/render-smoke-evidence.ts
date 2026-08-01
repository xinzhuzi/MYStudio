import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LOUDNESS_MEASUREMENT_FILTER = "ebur128=peak=true";
export const DEFAULT_INTEGRATED_LOUDNESS_TOLERANCE_LU = 0.5;
export const DEFAULT_TRUE_PEAK_TOLERANCE_DB = 0.5;

export interface LoudnessMeasurementAcceptance {
  targetIntegratedLufs: number;
  integratedToleranceLu: number;
  targetTruePeakDbtp: number;
  truePeakToleranceDb: number;
  truePeakComparisonLimitDbfs: number;
  integratedWithinTolerance: boolean;
  truePeakWithinTolerance: boolean;
  passed: boolean;
}

export interface RenderedMediaLoudnessMeasurement {
  schemaVersion: 1;
  generatedAt: string;
  inputPath: string;
  command: { executable: "ffmpeg"; args: string[] };
  ffmpegVersionCommand: { executable: "ffmpeg"; args: ["-version"] };
  ffmpegVersion: string;
  filter: typeof LOUDNESS_MEASUREMENT_FILTER;
  integratedLufs: number;
  loudnessRangeLu: number;
  peakType: "true-peak";
  peakUnit: "dBFS";
  peakDbfs: number;
  rawLogPath: string;
  reportPath: string;
  acceptance?: LoudnessMeasurementAcceptance;
}

export type LoudnessMeasurementExec = (
  executable: string,
  args: string[],
  options: { encoding: "utf8"; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string;
  width?: number;
  height?: number;
  channels?: number;
  sample_rate?: number | string;
}

export interface RenderedMediaProbe {
  raw: { format?: { duration?: string }; streams?: ProbeStream[] };
  duration: number;
  width: number;
  height: number;
  streams: string[];
  videoCodec: string;
  audioCodec: string;
}

export interface RenderedAudioWindowEvidence {
  startUs: number;
  endUs: number;
  sampleRate: number;
  rms: number;
  frequencyPower: Record<string, number>;
}

export function selectRenderedVideoDuration(raw: RenderedMediaProbe["raw"]): number {
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  return Number(video?.duration || raw.format?.duration || 0);
}

export async function probeRenderedMedia(filePath: string): Promise<RenderedMediaProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,duration,width,height,channels,sample_rate",
    "-of", "json",
    filePath,
  ]);
  const raw = JSON.parse(stdout || "{}") as RenderedMediaProbe["raw"];
  const video = raw.streams?.find((stream) => stream.codec_type === "video");
  const audio = raw.streams?.find((stream) => stream.codec_type === "audio");
  return {
    raw,
    // AAC commonly carries encoder padding (for example 2.048s for a 2.0s
    // 60-frame video).  The frame-accurate duration contract is the video
    // stream; only fall back to the container duration when ffprobe cannot
    // provide it.
    duration: selectRenderedVideoDuration(raw),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    streams: (raw.streams ?? []).map((stream) => stream.codec_type ?? "").filter(Boolean),
    videoCodec: video?.codec_name ?? "",
    audioCodec: audio?.codec_name ?? "",
  };
}

/** Decode-only evidence helper. It never writes or transforms the input media. */
export async function analyzeRenderedAudioWindows(input: {
  filePath: string;
  windows: readonly { startUs: number; endUs: number }[];
  frequenciesHz: readonly number[];
}): Promise<RenderedAudioWindowEvidence[]> {
  const filePath = path.resolve(input.filePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`音频分析输入不存在或不是普通文件: ${filePath}`);
  }
  const sampleRate = 48_000;
  const stdout = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", filePath, "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "pipe:1"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (error, output) => error ? reject(error) : resolve(output),
    );
  });
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  return input.windows.map((window) => {
    if (!Number.isSafeInteger(window.startUs) || !Number.isSafeInteger(window.endUs) || window.startUs < 0 || window.endUs <= window.startUs) {
      throw new Error("音频分析窗口无效");
    }
    const start = Math.min(samples.length, Math.floor(window.startUs * sampleRate / 1_000_000));
    const end = Math.min(samples.length, Math.ceil(window.endUs * sampleRate / 1_000_000));
    if (end <= start) throw new Error("音频分析窗口没有解码样本");
    const windowSamples = samples.subarray(start, end);
    const frequencyPower: Record<string, number> = {};
    for (const frequency of input.frequenciesHz) {
      if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= sampleRate / 2) throw new Error("音频分析频率无效");
      frequencyPower[String(frequency)] = goertzelPower(windowSamples, frequency, sampleRate);
    }
    let sumSquares = 0;
    for (const sample of windowSamples) sumSquares += sample * sample;
    return {
      startUs: window.startUs,
      endUs: window.endUs,
      sampleRate,
      rms: Math.sqrt(sumSquares / windowSamples.length) / 32768,
      frequencyPower,
    };
  });
}

function goertzelPower(samples: Int16Array, frequency: number, sampleRate: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
  let previous = 0;
  let previous2 = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return Math.sqrt(Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2)) / samples.length;
}

export function buildLoudnessMeasurementArgs(filePath: string): string[] {
  if (!path.isAbsolute(filePath)) throw new Error("响度测量输入必须是绝对路径");
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-map",
    "0:a:0",
    "-filter:a",
    LOUDNESS_MEASUREMENT_FILTER,
    "-f",
    "null",
    "-",
  ];
}

export function parseEbur128Summary(stderr: string): Pick<
  RenderedMediaLoudnessMeasurement,
  "integratedLufs" | "loudnessRangeLu" | "peakType" | "peakUnit" | "peakDbfs"
> {
  const summaryIndex = stderr.lastIndexOf("Summary:");
  if (summaryIndex < 0) throw new Error("FFmpeg ebur128 输出缺少 Summary");
  const summary = stderr.slice(summaryIndex);
  const integrated = summary.match(/Integrated loudness:\s+I:\s+(-?\d+(?:\.\d+)?) LUFS/);
  const loudnessRange = summary.match(/Loudness range:\s+LRA:\s+(-?\d+(?:\.\d+)?) LU/);
  const truePeak = summary.match(/True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?) dBFS/);
  if (!integrated || !loudnessRange || !truePeak) {
    throw new Error("FFmpeg ebur128 Summary 缺少 integrated loudness、LRA 或 true peak");
  }
  return {
    integratedLufs: Number(integrated[1]),
    loudnessRangeLu: Number(loudnessRange[1]),
    peakType: "true-peak",
    peakUnit: "dBFS",
    peakDbfs: Number(truePeak[1]),
  };
}

export async function measureRenderedMediaLoudness(input: {
  filePath: string;
  rawLogPath: string;
  reportPath: string;
  target?: {
    integratedLufs: number;
    truePeakDbtp: number;
    integratedToleranceLu?: number;
    truePeakToleranceDb?: number;
  };
  exec?: LoudnessMeasurementExec;
}): Promise<RenderedMediaLoudnessMeasurement> {
  const filePath = path.resolve(input.filePath);
  const rawLogPath = path.resolve(input.rawLogPath);
  const reportPath = path.resolve(input.reportPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`响度测量输入不存在或不是普通文件: ${filePath}`);
  }
  const args = buildLoudnessMeasurementArgs(filePath);
  const execute = input.exec ?? (execFileAsync as unknown as LoudnessMeasurementExec);
  const versionResult = await execute("ffmpeg", ["-version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const ffmpegVersion = (versionResult.stdout || versionResult.stderr || "")
    .split(/\r?\n/, 1)[0]
    ?.trim();
  if (!ffmpegVersion) throw new Error("无法读取 FFmpeg 版本");
  const { stderr = "" } = await execute("ffmpeg", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  const values = parseEbur128Summary(stderr);
  const acceptance = input.target
    ? evaluateLoudnessMeasurement(values, input.target)
    : undefined;
  const report: RenderedMediaLoudnessMeasurement = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath: filePath,
    command: { executable: "ffmpeg", args },
    ffmpegVersionCommand: { executable: "ffmpeg", args: ["-version"] },
    ffmpegVersion,
    filter: LOUDNESS_MEASUREMENT_FILTER,
    ...values,
    rawLogPath,
    reportPath,
    acceptance,
  };
  fs.mkdirSync(path.dirname(rawLogPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(rawLogPath, stderr, "utf8");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (acceptance && !acceptance.passed) {
    throw new Error(
      `响度验收失败: integrated=${report.integratedLufs} LUFS, truePeak=${report.peakDbfs} ${report.peakUnit}`,
    );
  }
  return report;
}

export function evaluateLoudnessMeasurement(
  measurement: Pick<RenderedMediaLoudnessMeasurement, "integratedLufs" | "peakDbfs">,
  target: {
    integratedLufs: number;
    truePeakDbtp: number;
    integratedToleranceLu?: number;
    truePeakToleranceDb?: number;
  },
): LoudnessMeasurementAcceptance {
  const integratedToleranceLu = target.integratedToleranceLu
    ?? DEFAULT_INTEGRATED_LOUDNESS_TOLERANCE_LU;
  const truePeakToleranceDb = target.truePeakToleranceDb
    ?? DEFAULT_TRUE_PEAK_TOLERANCE_DB;
  for (const [label, value] of Object.entries({
    integratedLufs: target.integratedLufs,
    truePeakDbtp: target.truePeakDbtp,
    integratedToleranceLu,
    truePeakToleranceDb,
  })) {
    if (!Number.isFinite(value) || (label.endsWith("ToleranceLu") || label.endsWith("ToleranceDb")) && value < 0) {
      throw new Error(`响度验收参数无效: ${label}`);
    }
  }
  const truePeakComparisonLimitDbfs = target.truePeakDbtp + truePeakToleranceDb;
  const integratedWithinTolerance = Math.abs(
    measurement.integratedLufs - target.integratedLufs,
  ) <= integratedToleranceLu;
  const truePeakWithinTolerance = measurement.peakDbfs <= truePeakComparisonLimitDbfs;
  return {
    targetIntegratedLufs: target.integratedLufs,
    integratedToleranceLu,
    targetTruePeakDbtp: target.truePeakDbtp,
    truePeakToleranceDb,
    truePeakComparisonLimitDbfs,
    integratedWithinTolerance,
    truePeakWithinTolerance,
    passed: integratedWithinTolerance && truePeakWithinTolerance,
  };
}

export function assertRenderedMediaEvidence(input: {
  label: string;
  probe: RenderedMediaProbe;
  expectedDuration: number;
  fps: number;
  width: number;
  height: number;
}): void {
  const { label, probe, expectedDuration, fps, width, height } = input;
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new Error(`${label}时长无效: ${probe.duration}`);
  }
  if (Math.abs(probe.duration - expectedDuration) > 1 / fps) {
    throw new Error(`${label}时长误差超过一帧: actual=${probe.duration} expected=${expectedDuration}`);
  }
  if (probe.width !== width || probe.height !== height) {
    throw new Error(`${label}尺寸不匹配: actual=${probe.width}x${probe.height} expected=${width}x${height}`);
  }
  if (probe.videoCodec !== "h264" || probe.audioCodec !== "aac") {
    throw new Error(`${label}编解码器不匹配: video=${probe.videoCodec || "missing"} audio=${probe.audioCodec || "missing"}`);
  }
}

export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
