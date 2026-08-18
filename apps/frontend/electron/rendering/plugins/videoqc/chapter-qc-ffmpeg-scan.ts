/**
 * L2 ffmpeg 逐帧扫描层:黑场/卡帧/死寂/响度 + 语音挤压(实际侧)+ 音画同步。
 * 全部 finding 经 L1 时间轴映射归镜;黑场判定场景感知(整镜暗不告警,
 * 防道劫暗戏误伤——08-19-chapter-video-qc L2 design)。
 *
 * 已知局限(接受):BGM 大声时 silencedetect(-35dB)可能全程不触发,
 * 语音挤压/音画同步子项自动退化为不报;L1 的计划侧挤压信号兜底。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import type { ChapterQcFindingV1 } from "./chapter-qc-types";
import { resolveQcFfTool, type QcCommandRunner } from "./chapter-qc-fftools";
import {
  parseBlackSegments,
  parseFreezeSegments,
  parseLoudness,
  parseSilenceSegments,
  speechSegmentsFromSilences,
} from "./parse-ffmpeg-probe";
import { mapRangeToShot, type ChapterQcShotSpan } from "./chapter-qc-timeline";

export interface ChapterQcFfmpegScanInput {
  videoPath: string;
  spans: ChapterQcShotSpan[];
  /** L1 探测到的总时长(秒);缺省时静音补集按未知时长退化 */
  durationS?: number;
  /** 计划旁白总时长(秒);>0 才跑语音挤压实际侧 */
  plannedVoiceS?: number;
  /** 每镜取首 cue 做音画同步抽查 */
  cues?: VideoUseSubtitleCueV1[];
  /** 暗戏白名单(整镜暗属预期,完全 suppress) */
  darkShotIds?: string[];
  runner?: QcCommandRunner;
}

export interface ChapterQcFfmpegScanResult {
  findings: ChapterQcFindingV1[];
  raw: {
    blacks: number;
    freezes: number;
    silences: number;
    loudnessInputI?: number;
    speechSeconds?: number;
  };
  notes: string[];
}

/** 整镜暗的覆盖度阈值:黑段覆盖某镜 ≥85% 视为整镜暗。 */
const FULL_SHOT_COVERAGE = 0.85;
/** 音画同步容忍窗(秒)。 */
const CUE_SYNC_TOLERANCE_S = 0.3;
/** 响度 sanity 窗(LUFS);v1 不做目标响度,只报离群。 */
const LOUDNESS_RANGE: readonly [number, number] = [-30, -10];

export async function runFfmpegScanLayer(input: ChapterQcFfmpegScanInput): Promise<ChapterQcFfmpegScanResult> {
  const findings: ChapterQcFindingV1[] = [];
  const notes: string[] = [];
  const darkShotIds = new Set(input.darkShotIds ?? []);
  const { stdout: silenced } = await runProbe(input);

  const totalDurationS = input.durationS ?? Number.NaN;
  const blacks = parseBlackSegments(silenced);
  const freezes = parseFreezeSegments(silenced);
  const silences = Number.isFinite(totalDurationS) ? parseSilenceSegments(silenced, totalDurationS) : [];
  const loudness = parseLoudness(silenced);

  // ---- 黑场(场景感知) ----
  for (const black of blacks) {
    const span = mapRangeToShot(input.spans, black.startS, black.endS);
    if (!span) {
      findings.push({
        code: "chapter-qc.black.out-of-timeline",
        layer: "ffmpegScan",
        severity: "warn",
        message: `黑场段时间轴外: [${black.startS.toFixed(2)}, ${black.endS.toFixed(2)}]`,
        evidence: { startS: black.startS, endS: black.endS },
      });
      continue;
    }
    const overlap = Math.min(span.endS, black.endS) - Math.max(span.startS, black.startS);
    const coverage = overlap / Math.max(span.durationS, 0.001);
    if (coverage >= FULL_SHOT_COVERAGE) {
      if (darkShotIds.has(span.shotId)) continue; // 剧情暗戏:整镜暗属预期
      findings.push({
        code: "chapter-qc.black.full-shot",
        layer: "ffmpegScan",
        severity: "info",
        shotId: span.shotId,
        shotOrdinal: span.ordinal,
        message: `第 ${span.ordinal} 镜整镜偏暗(记录,不告警;如属剧情暗戏可入白名单)`,
        evidence: { startS: Number(black.startS.toFixed(3)), coverage: Number(coverage.toFixed(3)) },
      });
      continue;
    }
    // 短促黑段或跨镜黑段:异常
    const crossingSpans = input.spans.filter(
      (candidate) => Math.min(candidate.endS, black.endS) - Math.max(candidate.startS, black.startS) > 0.1,
    );
    findings.push({
      code: "chapter-qc.black.segment",
      layer: "ffmpegScan",
      severity: "warn",
      shotId: span.shotId,
      shotOrdinal: span.ordinal,
      message: `异常黑段 ${black.durationS.toFixed(2)}s${crossingSpans.length > 1 ? "(跨镜边界)" : ""}`,
      evidence: {
        startS: Number(black.startS.toFixed(3)),
        durationS: Number(black.durationS.toFixed(3)),
        crossingShotCount: crossingSpans.length,
      },
    });
  }

  // ---- 卡帧 ----
  for (const freeze of freezes) {
    const span = mapRangeToShot(input.spans, freeze.startS, freeze.endS);
    findings.push({
      code: "chapter-qc.freeze.segment",
      layer: "ffmpegScan",
      severity: "warn",
      shotId: span?.shotId,
      shotOrdinal: span?.ordinal,
      message: `画面冻结 ${freeze.durationS.toFixed(2)}s`,
      evidence: { startS: Number(freeze.startS.toFixed(3)), durationS: Number(freeze.durationS.toFixed(3)) },
    });
  }

  // ---- 死寂 ----
  for (const silence of silences) {
    if (silence.durationS < 0.8) continue;
    const span = mapRangeToShot(input.spans, silence.startS, silence.endS);
    findings.push({
      code: "chapter-qc.silence.segment",
      layer: "ffmpegScan",
      severity: "warn",
      shotId: span?.shotId,
      shotOrdinal: span?.ordinal,
      message: `音轨死寂 ${silence.durationS.toFixed(2)}s`,
      evidence: { startS: Number(silence.startS.toFixed(3)), durationS: Number(silence.durationS.toFixed(3)) },
    });
  }

  // ---- 响度 sanity ----
  if (loudness) {
    if (loudness.inputI < LOUDNESS_RANGE[0] || loudness.inputI > LOUDNESS_RANGE[1]) {
      findings.push({
        code: "chapter-qc.audio.loudness-out-of-range",
        layer: "ffmpegScan",
        severity: "warn",
        message: `整体响度 ${loudness.inputI.toFixed(1)} LUFS 超出 sanity 窗 [${LOUDNESS_RANGE[0]}, ${LOUDNESS_RANGE[1]}]`,
        evidence: { inputI: loudness.inputI, inputTp: loudness.inputTp, inputLra: loudness.inputLra },
      });
    }
  }

  // ---- 语音挤压(实际侧) ----
  let speechSeconds: number | undefined;
  if (Number.isFinite(totalDurationS)) {
    const speech = speechSegmentsFromSilences(silences, totalDurationS);
    speechSeconds = speech.reduce((sum, segment) => sum + (segment.endS - segment.startS), 0);
    if (input.plannedVoiceS && input.plannedVoiceS > 0 && silences.length > 0) {
      const ratio = speechSeconds / input.plannedVoiceS;
      if (ratio < 0.98) {
        findings.push({
          code: "chapter-qc.audio.speech-compressed",
          layer: "ffmpegScan",
          severity: "warn",
          message: `实际语音 ${speechSeconds.toFixed(2)}s 比计划旁白 ${input.plannedVoiceS.toFixed(2)}s 少 ${((1 - ratio) * 100).toFixed(1)}%,疑似语音被挤压/裁切`,
          evidence: {
            speechSeconds: Number(speechSeconds.toFixed(3)),
            plannedVoiceS: Number(input.plannedVoiceS.toFixed(3)),
          },
        });
      }
    }
  } else {
    notes.push("no-duration: 语音补集/挤压实际侧跳过");
  }

  // ---- 音画同步(每镜首 cue 抽查) ----
  if (input.cues && input.cues.length > 0 && Number.isFinite(totalDurationS) && silences.length > 0) {
    const speech = speechSegmentsFromSilences(silences, totalDurationS);
    const firstCueByShot = new Map<string, VideoUseSubtitleCueV1>();
    for (const cue of [...input.cues].sort((left, right) => left.startUs - right.startUs)) {
      if (!firstCueByShot.has(cue.shotId)) firstCueByShot.set(cue.shotId, cue);
    }
    for (const cue of firstCueByShot.values()) {
      const cueStartS = cue.startUs / 1e6;
      const span = input.spans.find((candidate) => candidate.shotId === cue.shotId);
      if (!span) continue;
      // 该镜窗口内的首个语音起点
      const onset = speech.find(
        (segment) => segment.endS > span.startS + 0.05 && segment.startS < span.endS,
      );
      if (!onset) continue;
      const onsetInShot = Math.max(onset.startS, span.startS) - span.startS;
      const cueInShot = cueStartS - span.startS;
      const deltaS = onsetInShot - cueInShot;
      if (Math.abs(deltaS) > CUE_SYNC_TOLERANCE_S) {
        findings.push({
          code: "chapter-qc.audio.cue-offset",
          layer: "ffmpegScan",
          severity: "warn",
          shotId: cue.shotId,
          shotOrdinal: span.ordinal,
          message: `第 ${span.ordinal} 镜语音起点与字幕起点偏移 ${deltaS > 0 ? "+" : ""}${deltaS.toFixed(2)}s`,
          evidence: {
            cueId: cue.cueId,
            deltaS: Number(deltaS.toFixed(3)),
            toleranceS: CUE_SYNC_TOLERANCE_S,
          },
        });
      }
    }
  } else if (!input.cues || input.cues.length === 0) {
    notes.push("no-cues: 音画同步跳过");
  }

  return {
    findings,
    raw: {
      blacks: blacks.length,
      freezes: freezes.length,
      silences: silences.length,
      loudnessInputI: loudness?.inputI,
      speechSeconds: speechSeconds !== undefined ? Number(speechSeconds.toFixed(3)) : undefined,
    },
    notes,
  };
}

async function runProbe(input: ChapterQcFfmpegScanInput): Promise<{ stdout: string; stderr: string }> {
  const runner = input.runner ?? defaultRunner;
  const result = await runner(resolveQcFfTool("ffmpeg"), [
    "-hide_banner",
    "-nostats",
    "-i",
    input.videoPath,
    "-vf",
    "blackdetect=d=0.08:pix_th=0.10,freezedetect=n=-60dB:d=0.5",
    "-af",
    "silencedetect=noise=-35dB:d=0.8,loudnorm=print_format=json",
    "-f",
    "null",
    "-",
  ]);
  // ffmpeg 的探测输出全部走 stderr;stdout 恒空,这里统一从 stderr 解析
  return { stdout: result.stderr || result.stdout, stderr: "" };
}

const execFileAsync = promisify(execFile);

const defaultRunner: QcCommandRunner = (file, args) =>
  execFileAsync(file, args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
