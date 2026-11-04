/**
 * L2 ffmpeg 逐帧扫描层:黑场/卡帧/死寂/响度 + 语音挤压(实际侧)+ 音画同步
 * + 逐帧信号统计(运动/曝光/切换/清晰度)。
 * 全部 finding 经 L1 时间轴映射归镜;黑场判定场景感知(整镜暗不告警,
 * 防道劫暗戏误伤——08-19-chapter-video-qc L2 design)。
 *
 * 逐帧统计(1030 单镜分析门口径,见 docs/comfyui-kb/分镜H3视频产线.md §九.六)
 * 一律 severity=info:**阈值先记不判**——本层只把数字落到报告里攒基线,
 * 未攒够样本前任何一条都不构成闸门。
 *
 * 语音段口径(1031 吸收件②):Silero VAD 到位时吃 VAD 段;VAD 不可用才退回
 * silencedetect 补集——BGM 大声时 -35dB 全程不触发,补集会退化成不报,
 * 退化原因恒写进 notes,三态板把 speech-integrity 记 unverified(不许静默当通过)。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import { SHOT_STATIC_RATIO_LIMIT } from "./chapter-qc-types";
import type { ChapterQcFindingV1, ChapterQcScanSignalsV1 } from "./chapter-qc-types";
import { resolveQcFfTool, type QcCommandRunner } from "./chapter-qc-fftools";
import {
  parseBlackSegments,
  parseBlurMean,
  parseFrameMetrics,
  parseFreezeSegments,
  parseLoudness,
  parseSilenceSegments,
  speechSegmentsFromSilences,
  summarizeClarity,
  summarizeCuts,
  summarizeExposure,
  summarizeMotion,
  type FrameMetricPoint,
} from "./parse-ffmpeg-probe";
import { mapRangeToShot, type ChapterQcShotSpan } from "./chapter-qc-timeline";

export interface ChapterQcFfmpegScanInput {
  videoPath: string;
  spans: ChapterQcShotSpan[];
  /** L1 探测到的总时长(秒);缺省时静音补集按未知时长退化 */
  durationS?: number;
  /** L1 探测到的视频帧率;缺省按 24fps 估总帧数定抽帧步长 */
  fps?: number;
  /** 计划旁白总时长(秒);>0 才跑语音挤压实际侧 */
  plannedVoiceS?: number;
  /** 每镜取首 cue 做音画同步抽查 */
  cues?: VideoUseSubtitleCueV1[];
  /** 暗戏白名单(整镜暗属预期,完全 suppress) */
  darkShotIds?: string[];
  /** Silero VAD 语音段(chapter-qc-vad 出数);缺省=退回 silencedetect 补集口径 */
  vadSpeech?: { segments: Array<{ startS: number; endS: number }>; model?: string };
  /** VAD 不可用的原因(落 notes,让「退化」看得见) */
  vadReason?: string;
  runner?: QcCommandRunner;
}

export interface ChapterQcFfmpegScanResult {
  findings: ChapterQcFindingV1[];
  /** 逐镜/逐片实测台账(与报告 `scanSignals` 同一形状,单一真源在 chapter-qc-types) */
  raw: ChapterQcScanSignalsV1;
  notes: string[];
  /**
   * 逐帧采样点(未落报告,只在内存里传递)。
   * L4 代表帧择帧吃这份数——同一次 ffmpeg 趟出两套结论,不另开一趟。
   */
  framePoints: FrameMetricPoint[];
}

/** 整镜暗的覆盖度阈值:黑段覆盖某镜 ≥85% 视为整镜暗。 */
const FULL_SHOT_COVERAGE = 0.85;
/** 音画同步容忍窗(秒)。 */
const CUE_SYNC_TOLERANCE_S = 0.3;
/** 响度 sanity 窗(LUFS);v1 不做目标响度,只报离群。 */
const LOUDNESS_RANGE: readonly [number, number] = [-30, -10];

/** 逐帧 metadata 最多打印多少个采样点(控 maxBuffer:4000 点 ≈ 7MB)。 */
const FRAME_STATS_PRINT_LIMIT = 4000;
/** TI 低于此值视作静止帧(与 shot_signal_probe_1030.py 同口径)。 */
const STATIC_TI_GUARD = 0.5;
/** 采样点太少时比例数字没意义,少于这个数不出镜级结论。 */
const MIN_SHOT_SAMPLE_POINTS = 3;
/** 静止帧占比超此值记一条伪动态线索(不判);同一条线也是逐镜判定门的绝对病线——共用 types 层那份,不许两处各写各的。 */
const STATIC_RATIO_NOTE = SHOT_STATIC_RATIO_LIMIT;
/** 亮度窗(8bit YAVG),暗/爆帧占比超半数才记。择帧剔近黑/过曝共用此窗(chapter-qc-frame-select)。 */
export const EXPOSURE_LOW_YAVG = 20;
export const EXPOSURE_HIGH_YAVG = 245;
/** scdet 切换分:≥8 视作硬切,≥4 视作软切(实测 H3 单镜 max≈1.7)。 */
const HARD_CUT_SCORE = 8;
const SOFT_CUT_SCORE = 4;
/** blurdetect 均值(越大越糊):基线 H3 480P=4.72 / 成片=5.18,超此值记一条。 */
const BLUR_MEAN_NOTE = 8;
/** 镜边界内缩窗(秒):落在窗内的切换属镜间切,不算镜内意外切换。 */
const CUT_BOUNDARY_MARGIN_S = 0.5;

export async function runFfmpegScanLayer(input: ChapterQcFfmpegScanInput): Promise<ChapterQcFfmpegScanResult> {
  const findings: ChapterQcFindingV1[] = [];
  const notes: string[] = [];
  const darkShotIds = new Set(input.darkShotIds ?? []);
  const sampleStep = computeSampleStep(input.durationS, input.fps);
  const { stdout: silenced } = await runProbe(input, sampleStep);

  const totalDurationS = input.durationS ?? Number.NaN;
  const blacks = parseBlackSegments(silenced);
  const freezes = parseFreezeSegments(silenced, totalDurationS);
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

  // ---- 语音段口径(VAD 优先,silencedetect 补集兜底)----
  // 带 BGM 成片里 silencedetect(-35dB) 看不见语音间隙(1031 实测差 50.09s),
  // 挤压与音画同步两条子项会静默退化成不报;Silero VAD 到位时直接吃它的段。
  const vadSegments = input.vadSpeech && input.vadSpeech.segments.length > 0 ? input.vadSpeech.segments : undefined;
  const speech = vadSegments
    ?? (Number.isFinite(totalDurationS) ? speechSegmentsFromSilences(silences, totalDurationS) : []);
  // 补集口径只在真看见死寂段时可用:一段死寂都没有 = BGM 掩盖,补集等于全片,拿去比计划只会自欺
  const complementUsable = silences.length > 0 && Number.isFinite(totalDurationS);
  const speechUsable = vadSegments ? vadSegments.length > 0 : complementUsable;
  const speechSource = vadSegments ? "silero-vad" : complementUsable ? "silencedetect-complement" : undefined;
  const speechSeconds = speech.length > 0
    ? speech.reduce((sum, segment) => sum + (segment.endS - segment.startS), 0)
    : undefined;
  if (vadSegments) {
    notes.push(`语音段口径=Silero VAD(${vadSegments.length} 段,模型 ${input.vadSpeech?.model ?? "silero-vad"})`);
  } else if (input.vadReason) {
    notes.push(`语音段口径=silencedetect 补集(VAD 不可用:${input.vadReason})`);
  }
  if (!vadSegments && !Number.isFinite(totalDurationS)) {
    notes.push("no-duration: 语音补集/挤压实际侧跳过");
  }

  // ---- 语音挤压(实际侧)----
  if (input.plannedVoiceS && input.plannedVoiceS > 0 && speechUsable && speechSeconds !== undefined) {
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
          ...(speechSource ? { speechSource } : {}),
        },
      });
    }
  }

  // ---- 音画同步(每镜首 cue 抽查)----
  if (input.cues && input.cues.length > 0 && speechUsable) {
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

  const frameStats = collectFrameStatFindings(silenced, input, sampleStep);
  findings.push(...frameStats.findings);

  // ---- 逐镜语音台账(骨干②的实测侧)----
  // 只记「这一镜的时间窗里落在语音段上的秒数」,不判:哪一镜该有台词由分镜声明说,
  // 这里只回答「成片这一镜到底有没有声音」。
  const shotSpeech = input.spans.map((span) => ({
    shotId: span.shotId,
    ordinal: span.ordinal,
    speechSeconds: round3(
      speech.reduce(
        (sum, segment) => sum + Math.max(0, Math.min(span.endS, segment.endS) - Math.max(span.startS, segment.startS)),
        0,
      ),
    ),
  }));

  return {
    findings,
    raw: {
      blacks: blacks.length,
      freezes: freezes.length,
      silences: silences.length,
      loudnessInputI: loudness?.inputI,
      speechSeconds: speechSeconds !== undefined ? round3(speechSeconds) : undefined,
      blurMean: frameStats.blurMean !== undefined ? round3(frameStats.blurMean) : undefined,
      frameSampleCount: frameStats.sampleCount,
      frameSampleStep: sampleStep,
      speechSource,
      shotMotion: frameStats.shotMotion,
      shotSpeech,
    },
    notes,
    framePoints: frameStats.points,
  };
}

async function runProbe(input: ChapterQcFfmpegScanInput, sampleStep: number): Promise<{ stdout: string; stderr: string }> {
  const runner = input.runner ?? scanRunner(scanTimeoutMsFor(input.durationS ?? 0));
  const result = await runner(resolveQcFfTool("ffmpeg"), [
    "-hide_banner",
    "-nostats",
    "-i",
    input.videoPath,
    "-vf",
    buildScanFilterGraph(sampleStep),
    "-af",
    "silencedetect=noise=-35dB:d=0.8,loudnorm=print_format=json",
    "-f",
    "null",
    "-",
  ]);
  // ffmpeg 的探测输出全部走 stderr;stdout 恒空,这里统一从 stderr 解析
  return { stdout: result.stderr || result.stdout, stderr: "" };
}

/**
 * 抽帧步长:总帧数超过打印上限时按 select 等间隔采样,单镜片(≤ 上限)恒 1=逐帧。
 * `select` 放在所有全帧分析件之后、`metadata=print` 之前——drop 的只是打印,
 * siti/scdet/signalstats/blurdetect/blackdetect/freezedetect 仍吃全帧。
 */
export function computeSampleStep(durationS: number | undefined, fps: number | undefined): number {
  if (!Number.isFinite(durationS ?? Number.NaN) || (durationS as number) <= 0) return 1;
  const frames = (durationS as number) * (Number.isFinite(fps ?? Number.NaN) && (fps as number) > 0 ? (fps as number) : 24);
  return Math.max(1, Math.ceil(frames / FRAME_STATS_PRINT_LIMIT));
}

export function buildScanFilterGraph(sampleStep: number): string {
  const parts = [
    "blackdetect=d=0.08:pix_th=0.10",
    "freezedetect=n=-60dB:d=0.5",
    "blurdetect",
    "siti",
    "scdet",
    "signalstats",
  ];
  if (sampleStep > 1) parts.push(`select='not(mod(n\\,${sampleStep}))'`);
  parts.push("metadata=print");
  return parts.join(",");
}

function pointsWithinSpan(points: readonly FrameMetricPoint[], span: ChapterQcShotSpan): FrameMetricPoint[] {
  return points.filter((point) => point.tS >= span.startS && point.tS < span.endS);
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * 逐帧统计 → 全片一条汇总(info)+ 离群镜各一条线索(info)。
 * 数字全落 evidence,供攒基线;判据本批不启用。
 * 顺带产出**逐镜运动台账**:每镜一行,不管有没有越记录线都记 —— 因为「没出 static-heavy
 * 那条 finding」从来不等于「这一镜测过没问题」(采样点不足直接 continue),骨干②的逐镜判定
 * 必须拿得到覆盖与缺口,不能靠 finding 的缺席反推。
 */
function collectFrameStatFindings(
  stderr: string,
  input: ChapterQcFfmpegScanInput,
  sampleStep: number,
): {
  findings: ChapterQcFindingV1[];
  blurMean?: number;
  sampleCount: number;
  points: FrameMetricPoint[];
  shotMotion: ChapterQcScanSignalsV1["shotMotion"];
} {
  const findings: ChapterQcFindingV1[] = [];
  const shotMotion: NonNullable<ChapterQcScanSignalsV1["shotMotion"]> = [];
  const points = parseFrameMetrics(stderr);
  const blurMean = parseBlurMean(stderr);
  if (points.length === 0) return { findings, blurMean, sampleCount: 0, points: [], shotMotion };

  const whole = summarizeMotion(points, STATIC_TI_GUARD);
  const exposure = summarizeExposure(points, EXPOSURE_LOW_YAVG, EXPOSURE_HIGH_YAVG);
  const cuts = summarizeCuts(points, HARD_CUT_SCORE, SOFT_CUT_SCORE);
  const clarity = summarizeClarity(points);
  findings.push({
    code: "chapter-qc.motion.summary",
    layer: "ffmpegScan",
    severity: "info",
    message: `逐帧信号统计:TI 均值 ${whole?.tiMean.toFixed(2) ?? "NA"} / 静止帧占比 ${
      whole ? `${(whole.staticFrameRatio * 100).toFixed(1)}%` : "NA"
    } / blur ${clarity?.blurMean.toFixed(2) ?? blurMean?.toFixed(2) ?? "NA"} / scdet max ${
      cuts?.scoreMax.toFixed(1) ?? "NA"
    }(采样步长 ${sampleStep},只记录不判)`,
    evidence: {
      sampleStep,
      samplePoints: points.length,
      tiMean: whole ? round3(whole.tiMean) : undefined,
      tiP95: whole ? round3(whole.tiP95) : undefined,
      tiMax: whole ? round3(whole.tiMax) : undefined,
      siMean: whole && Number.isFinite(whole.siMean) ? round3(whole.siMean) : undefined,
      staticFrameRatio: whole ? round3(whole.staticFrameRatio) : undefined,
      tiSampleCount: whole?.tiSampleCount,
      yavgMin: exposure ? round3(exposure.yavgMin) : undefined,
      yavgMax: exposure ? round3(exposure.yavgMax) : undefined,
      yavgMean: exposure ? round3(exposure.yavgMean) : undefined,
      satavgMax: exposure && Number.isFinite(exposure.satavgMax) ? round3(exposure.satavgMax) : undefined,
      blurMean: clarity ? round3(clarity.blurMean) : blurMean !== undefined ? round3(blurMean) : undefined,
      blurP95: clarity ? round3(clarity.blurP95) : undefined,
      blurMax: clarity ? round3(clarity.blurMax) : undefined,
      blurMeanWhole: blurMean !== undefined ? round3(blurMean) : undefined,
      scdetMax: cuts ? round3(cuts.scoreMax) : undefined,
      hardCutCount: cuts?.hardCutCount,
      softCutCount: cuts?.softCutCount,
    },
  });

  if (blurMean !== undefined && blurMean > BLUR_MEAN_NOTE) {
    findings.push({
      code: "chapter-qc.blur.mean-high",
      layer: "ffmpegScan",
      severity: "info",
      message: `全片清晰度均值 ${blurMean.toFixed(2)} 高于记录线 ${BLUR_MEAN_NOTE}(越大越糊;记录不判)`,
      evidence: { blurMean: round3(blurMean), noteThreshold: BLUR_MEAN_NOTE },
    });
  }

  for (const span of input.spans) {
    const shotPoints = pointsWithinSpan(points, span);
    if (shotPoints.length < MIN_SHOT_SAMPLE_POINTS) continue;
    const motion = summarizeMotion(shotPoints, STATIC_TI_GUARD);
    if (motion) {
      shotMotion.push({
        shotId: span.shotId,
        ordinal: span.ordinal,
        sampleCount: motion.tiSampleCount,
        tiMean: round3(motion.tiMean),
        staticFrameRatio: round3(motion.staticFrameRatio),
      });
    }
    if (motion && motion.staticFrameRatio > STATIC_RATIO_NOTE) {
      findings.push({
        code: "chapter-qc.motion.static-heavy",
        layer: "ffmpegScan",
        severity: "info",
        shotId: span.shotId,
        shotOrdinal: span.ordinal,
        message: `第 ${span.ordinal} 镜静止帧占比 ${(motion.staticFrameRatio * 100).toFixed(1)}%(TI 均值 ${
          motion.tiMean.toFixed(2)
        }),疑似伪动态/静态图放大(记录不判)`,
        evidence: {
          staticFrameRatio: round3(motion.staticFrameRatio),
          tiMean: round3(motion.tiMean),
          tiP95: round3(motion.tiP95),
          sampleCount: motion.tiSampleCount,
        },
      });
    }
    const shotExposure = summarizeExposure(shotPoints, EXPOSURE_LOW_YAVG, EXPOSURE_HIGH_YAVG);
    if (shotExposure && (shotExposure.darkFrameRatio > 0.5 || shotExposure.blownFrameRatio > 0.5)) {
      const blown = shotExposure.blownFrameRatio > 0.5;
      findings.push({
        code: blown ? "chapter-qc.exposure.blown-heavy" : "chapter-qc.exposure.dark-heavy",
        layer: "ffmpegScan",
        severity: "info",
        shotId: span.shotId,
        shotOrdinal: span.ordinal,
        message: `第 ${span.ordinal} 镜${blown ? "过曝" : "欠曝"}帧占比过半(YAVG ${shotExposure.yavgMean.toFixed(
          1,
        )};记录不判)`,
        evidence: {
          darkFrameRatio: round3(shotExposure.darkFrameRatio),
          blownFrameRatio: round3(shotExposure.blownFrameRatio),
          yavgMean: round3(shotExposure.yavgMean),
        },
      });
    }
    const shotClarity = summarizeClarity(shotPoints);
    if (shotClarity && shotClarity.blurMean > BLUR_MEAN_NOTE) {
      findings.push({
        code: "chapter-qc.blur.shot-blurry",
        layer: "ffmpegScan",
        severity: "info",
        shotId: span.shotId,
        shotOrdinal: span.ordinal,
        message: `第 ${span.ordinal} 镜清晰度均值 ${shotClarity.blurMean.toFixed(2)} 高于记录线 ${BLUR_MEAN_NOTE}(越大越糊;记录不判)`,
        evidence: {
          blurMean: round3(shotClarity.blurMean),
          blurP95: round3(shotClarity.blurP95),
          blurMax: round3(shotClarity.blurMax),
          sampleCount: shotClarity.blurSampleCount,
        },
      });
    }
    const interior = shotPoints.filter(
      (point) => point.tS > span.startS + CUT_BOUNDARY_MARGIN_S && point.tS < span.endS - CUT_BOUNDARY_MARGIN_S,
    );
    const interiorCuts = summarizeCuts(interior, HARD_CUT_SCORE, SOFT_CUT_SCORE);
    if (interiorCuts && interiorCuts.softCutCount > 0) {
      findings.push({
        code: "chapter-qc.cut.unplanned",
        layer: "ffmpegScan",
        severity: "info",
        shotId: span.shotId,
        shotOrdinal: span.ordinal,
        message: `第 ${span.ordinal} 镜镜内出现 ${interiorCuts.softCutCount} 个软切以上信号(max ${
          interiorCuts.scoreMax.toFixed(1)
        };采样口径为下界,记录不判)`,
        evidence: {
          scdetMax: round3(interiorCuts.scoreMax),
          hardCutCount: interiorCuts.hardCutCount,
          softCutCount: interiorCuts.softCutCount,
          sampleStep,
        },
      });
    }
  }
  return { findings, blurMean, sampleCount: points.length, points, shotMotion };
}

const execFileAsync = promisify(execFile);

/**
 * L2 一趟的超时(毫秒),按时长放宽。
 * 本机实测:1920×1080/30fps/197.12s 成片跑全帧分析链(blackdetect+freezedetect+
 * blurdetect+siti+scdet+signalstats,select 抽打印)用时 391s ≈ 2× 实时。
 * 固定 180s 会把 90s 以上的整章**一律误杀**成扫描失败(且失败长得像工具坏了),
 * 故按 4× 实时 + 120s 底留余量;短片仍走 180s 下限。
 */
export function scanTimeoutMsFor(durationS: number): number {
  const scaled = Number.isFinite(durationS) && durationS > 0 ? durationS * 4_000 + 120_000 : 0;
  return Math.max(180_000, Math.round(scaled));
}

function scanRunner(timeoutMs: number): QcCommandRunner {
  return (file, args) => execFileAsync(file, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
}
