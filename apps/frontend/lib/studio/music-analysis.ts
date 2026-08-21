// AI 参照曲解析(技能资产:assets/minimax/musical-dna/SKILL.md)。
// 链路:主进程守卫读音频字节 → 渲染层 Web Audio 解码 → 确定性信号特征
// (BPM/响度/亮度/声道宽度/12 段能量轨迹)→ 云端 LLM 按技能六维度出风格 DNA;
// 【风格短语】段可一键回填生成描述(music-caption 的 {{BRIEF}} 入口)。
import skillText from "@/assets/minimax/musical-dna/SKILL.md?raw";

/** 结构化 AudioBuffer 形状(测试可用纯 Float32Array 伪造,不依赖浏览器)。 */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioFeatures {
  durationS: number;
  sampleRate: number;
  channels: number;
  /** 整体 RMS 响度(dBFS,截 -60)。 */
  loudnessDb: number;
  peakDb: number;
  /** 平均过零率(0..1,频谱亮度代理:越高越亮/越尖锐)。 */
  brightness: number;
  /** 声道分离度(0=同相单声道质感,1=极端分离);单声道为 null。 */
  stereoWidth: number | null;
  bpm: number | null;
  /** BPM 自相关峰值/均值比(≥2 高置信,否则中)。 */
  bpmConfidence: number | null;
  /** 12 段归一化能量轨迹(0=全曲最弱,1=最强;dB 域归一,贴合响度感知)。 */
  energyProfile: number[];
}

const ANALYSIS_TARGET_SR = 11025;
const ENERGY_SEGMENTS = 12;

/** 解码音频字节(Web Audio 全格式:mp3/flac/m4a/aac/ogg/wav)。 */
export async function decodeAudioFileBytes(bytes: Uint8Array): Promise<AudioBufferLike> {
  const ctx = new AudioContext();
  try {
    // decodeAudioData 会 detach 传入的 ArrayBuffer,先拷贝隔离 IPC 产物。
    const copy = bytes.slice().buffer as ArrayBuffer;
    return await ctx.decodeAudioData(copy);
  } finally {
    void ctx.close();
  }
}

/** 全曲确定性特征提取:纯函数,无外部依赖。 */
export function extractAudioFeatures(buffer: AudioBufferLike): AudioFeatures {
  const { numberOfChannels: chCount, length, sampleRate: sr } = buffer;

  let peak = 0;
  let sumSquares = 0;
  for (let c = 0; c < chCount; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const v = data[i]!;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sumSquares += v * v;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, length * chCount));
  const loudnessDb = clamp(20 * Math.log10(rms + 1e-9), -60, 0);
  const peakDb = clamp(20 * Math.log10(peak + 1e-9), -60, 0);

  const mono = downmixMono(buffer);
  const factor = Math.max(1, Math.round(sr / ANALYSIS_TARGET_SR));
  const decimated = decimate(mono, factor);
  const decSr = sr / factor;

  const brightness = zeroCrossingRate(decimated);
  const { bpm, confidence } = estimateBpm(decimated, decSr);
  const energyProfile = segmentEnergyProfile(mono, ENERGY_SEGMENTS);
  const stereoWidth = chCount >= 2 ? stereoSeparation(buffer.getChannelData(0), buffer.getChannelData(1)) : null;

  return {
    durationS: length / sr,
    sampleRate: sr,
    channels: chCount,
    loudnessDb,
    peakDb,
    brightness,
    stereoWidth,
    bpm,
    bpmConfidence: bpm == null ? null : confidence,
    energyProfile,
  };
}

function downmixMono(buffer: AudioBufferLike): Float32Array {
  const { numberOfChannels: chCount, length } = buffer;
  if (chCount === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(length);
  for (let c = 0; c < chCount; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / chCount;
  }
  return mono;
}

function decimate(input: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return input;
  const outLength = Math.floor(input.length / factor);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += input[i * factor + k]!;
    out[i]! = sum / factor;
  }
  return out;
}

function zeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1]! >= 0) !== (samples[i]! >= 0)) crossings++;
  }
  return crossings / (samples.length - 1);
}

/**
 * 能量起振(onset novelty)自相关测 BPM:
 * 短时能量(256 样本窗 ≈ 23ms,hop 128)的正差分序列,在 60-180 BPM 周期内自相关,
 * 峰值折八度回 [65,145];峰值/均值比 < 1.25 判不可靠 → null。
 */
function estimateBpm(samples: Float32Array, sr: number): { bpm: number | null; confidence: number } {
  const win = 256;
  const hop = 128;
  const frameCount = Math.floor((samples.length - win) / hop);
  if (frameCount < 64) return { bpm: null, confidence: 0 };

  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const base = f * hop;
    for (let k = 0; k < win; k++) {
      const v = samples[base + k]!;
      sum += v * v;
    }
    energy[f]! = sum / win;
  }

  // novelty = 正差分;再减去滑动均值锐化周期峰(≈ 节拍重拍)。
  const novelty = new Float32Array(frameCount);
  let noveltySum = 0;
  for (let f = 1; f < frameCount; f++) {
    novelty[f]! = Math.max(0, energy[f]! - energy[f - 1]!);
    noveltySum += novelty[f]!;
  }
  const noveltyMean = noveltySum / (frameCount - 1);
  if (noveltyMean < 1e-7) return { bpm: null, confidence: 0 };

  const hopSec = hop / sr;
  const lagMin = Math.max(2, Math.ceil((60 / 180) / hopSec));
  const lagMax = Math.floor((60 / 60) / hopSec);
  if (lagMax <= lagMin || lagMax >= frameCount - 1) return { bpm: null, confidence: 0 };

  let bestLag = -1;
  let bestScore = -1;
  let scoreSum = 0;
  let scoreCount = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    for (let f = 1; f < frameCount - lag; f++) acc += novelty[f]! * novelty[f + lag]!;
    const score = acc / (frameCount - lag);
    scoreSum += score;
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const meanScore = scoreSum / Math.max(1, scoreCount);
  const confidence = bestScore / Math.max(meanScore, 1e-12);
  if (bestLag < 0 || confidence < 1.25) return { bpm: null, confidence };

  let bpm = 60 / (bestLag * hopSec);
  while (bpm < 65) bpm *= 2;
  while (bpm > 145) bpm /= 2;
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

function segmentEnergyProfile(mono: Float32Array, segments: number): number[] {
  const segLength = Math.floor(mono.length / segments);
  if (segLength < 1) return new Array<number>(segments).fill(0);
  const dbs: number[] = [];
  for (let s = 0; s < segments; s++) {
    let sum = 0;
    const base = s * segLength;
    for (let i = 0; i < segLength; i++) {
      const v = mono[base + i]!;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / segLength);
    dbs.push(clamp(20 * Math.log10(rms + 1e-9), -60, 0));
  }
  const min = Math.min(...dbs);
  const max = Math.max(...dbs);
  const range = max - min;
  return dbs.map((db) => (range < 1e-6 ? 0.5 : (db - min) / range));
}

function stereoSeparation(left: Float32Array, right: Float32Array): number {
  const stride = Math.max(1, Math.floor(left.length / 200000));
  let n = 0;
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  for (let i = 0; i < left.length; i += stride) {
    const l = left[i]!;
    const r = right[i]!;
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
    n++;
  }
  if (n === 0) return 0;
  const denom = Math.sqrt(sumLL * sumRR);
  const correlation = denom < 1e-12 ? 1 : clamp(sumLR / denom, -1, 1);
  return clamp(1 - correlation, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface MusicAnalysisInput {
  fileName: string;
  features: AudioFeatures;
  notes?: string;
}

export interface AnalysisMessages {
  system: string;
  user: string;
}

/** 构造 LLM 消息:系统消息嵌技能全文(单源:资产包 SKILL.md)+ 中文输出契约;用户消息给实测数据。 */
export function buildAnalysisMessages(input: MusicAnalysisInput): AnalysisMessages {
  const f = input.features;
  const system = [
    "你是资深音乐风格分析师。严格按下列技能规范(Musical DNA 六维度框架)工作:",
    "<skill>",
    skillText.trim(),
    "</skill>",
    "",
    "用户会给你一首音频的客观测量数据。你听不到音频,只能依据测量数据、文件名与用户备注推断:",
    "- 测量数据(BPM/响度/亮度/声道宽度/分段能量轨迹/时长)是事实;每条推断标注〔推断〕,与〔实测〕区分。",
    "- 数据不足以判断的维度明确写「数据不足以判断」,禁止编造具体艺术家、歌曲名或乐器配置细节。",
    "- 遵守技能伦理铁律:只描述技法特征,禁止点名任何艺术家/乐队(「说怎么做,不说像谁」)。",
    "",
    "输出中文 Markdown,固定结构:",
    "## 一句话 DNA",
    "(一句话概括这首曲子的风格身份)",
    "## 六维度解析",
    "(节奏根基/和声架构/乐器技法/制作美学/流派融合/能量架构 各 2-4 句)",
    "## 能量轨迹读数",
    "(把分段能量轨迹翻译成段落起伏叙事:前奏-推进-高潮-回落等)",
    "## 【风格短语】",
    "(一行英文逗号分隔短语,可直接用作 AI 音乐生成的风格描述;对齐技能 Extractable Prompt Elements)",
  ].join("\n");

  const bpmText = f.bpm == null
    ? "未能可靠检测(信号平缓或非节拍型)"
    : `${f.bpm} BPM(置信度${(f.bpmConfidence ?? 0) >= 2 ? "高" : "中"})`;
  const user = [
    `文件名:${input.fileName}`,
    `时长:${f.durationS.toFixed(1)} 秒 | 采样率:${f.sampleRate} Hz | 声道:${f.channels}`,
    `实测 BPM:${bpmText}`,
    `整体响度(RMS):${f.loudnessDb.toFixed(1)} dBFS | 峰值:${f.peakDb.toFixed(1)} dBFS`,
    `频谱亮度(过零率):${f.brightness.toFixed(3)}(越高越亮/越尖锐)`,
    f.stereoWidth != null
      ? `声道分离度:${f.stereoWidth.toFixed(2)}(0=单声道同相质感,1=极端分离)`
      : "声道分离度:—(单声道)",
    `分段能量轨迹(${f.energyProfile.length} 段,0=全曲最弱 1=最强):${f.energyProfile.map((v) => v.toFixed(2)).join(" ")}`,
    input.notes?.trim() ? `用户备注:${input.notes.trim()}` : "",
  ].filter(Boolean).join("\n");

  return { system, user };
}

/** 剥掉模型偶尔包的 Markdown 代码栅栏。 */
export function parseAnalysisDraft(raw: string): string {
  return raw
    .replace(/^\s*```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/, "")
    .trim();
}

/**
 * 提取【风格短语】段(填入生成描述用);无该段时回退「一句话 DNA」行。
 * 返回 null 表示两者都不可用。
 */
export function extractStylePhrases(analysis: string): string | null {
  const section = analysis.match(/【风格短语】\s*([\s\S]*?)(?=\n#{1,3}\s|\n【|$)/);
  if (section?.[1]) {
    const phrases = section[1]
      .split(/[\n,，]+/)
      .map((line) => line.replace(/^[\s>*-]+|[\s.*]+$/g, "").trim())
      .filter(Boolean)
      .join(", ");
    if (phrases) return phrases;
  }
  const dnaLine = analysis.match(/##\s*一句话\s*DNA\s*\n+\s*(.+)/);
  return dnaLine?.[1]?.trim() ?? null;
}
