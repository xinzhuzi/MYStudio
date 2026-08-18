/**
 * L1 结构比对层:渲染产物 vs 计划数据的确定性比对(毫秒~秒级)。
 * 产出 finding(不抛错——QC 是体检不是门禁,渲染交付不受本层影响)。
 */

import type { VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import type { ChapterQcFindingV1 } from "./chapter-qc-types";
import { qcProbeMedia, type QcCommandRunner, type QcMediaProbe } from "./chapter-qc-fftools";
import { diffSubtitlesAgainstScript } from "./chapter-qc-text-diff";
import type { ChapterQcShotSpan } from "./chapter-qc-timeline";

export interface ChapterQcStructuralInput {
  videoPath: string;
  /** EDL 映射出的镜区间表;空=无 EDL(降级:只跑探测类子项) */
  spans: ChapterQcShotSpan[];
  cues: VideoUseSubtitleCueV1[];
  /** 剧本真源(latestWork(scriptDraft) 的文本);缺省=跳过字幕 diff */
  scriptText?: string;
  /** 计划旁白总时长(Σ shotAudioBindings[role=voice].sourceDurationUs,µs) */
  plannedVoiceDurationUs?: number;
  /** 渲染设置期望(缺省=不比对分辨率) */
  expectedWidth?: number;
  expectedHeight?: number;
  runner?: QcCommandRunner;
}

export interface ChapterQcStructuralResult {
  findings: ChapterQcFindingV1[];
  probe?: QcMediaProbe;
  notes: string[];
}

/** 时长比对容忍:1 帧(30fps 假设)+ 50ms 探测噪声。 */
const DURATION_TOLERANCE_S = 1 / 30 + 0.05;

export async function runStructuralLayer(input: ChapterQcStructuralInput): Promise<ChapterQcStructuralResult> {
  const findings: ChapterQcFindingV1[] = [];
  const notes: string[] = [];

  let probe: QcMediaProbe;
  try {
    probe = await qcProbeMedia(input.videoPath, input.runner);
  } catch (error) {
    findings.push({
      code: "chapter-qc.probe.failed",
      layer: "structural",
      severity: "blocker",
      message: `ffprobe 探测失败: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { videoPath: input.videoPath },
    });
    return { findings, notes };
  }

  // 音轨
  if (!probe.hasAudio) {
    findings.push({
      code: "chapter-qc.audio.missing-track",
      layer: "structural",
      severity: "blocker",
      message: "成片没有音轨",
      evidence: { streams: "video-only" },
    });
  }

  // 编解码(渲染时 probeMedia 已把非 h264/aac 挡为失败;此处兜底记录)
  if (probe.videoCodec && probe.videoCodec !== "h264") {
    findings.push({
      code: "chapter-qc.video.codec",
      layer: "structural",
      severity: "warn",
      message: `视频编码非 h264: ${probe.videoCodec}`,
      evidence: { videoCodec: probe.videoCodec },
    });
  }
  if (probe.hasAudio && probe.audioCodec && probe.audioCodec !== "aac") {
    findings.push({
      code: "chapter-qc.audio.codec",
      layer: "structural",
      severity: "warn",
      message: `音频编码非 aac: ${probe.audioCodec}`,
      evidence: { audioCodec: probe.audioCodec },
    });
  }

  // 分辨率(有期望才比)
  if (input.expectedWidth && probe.width && probe.width !== input.expectedWidth) {
    findings.push({
      code: "chapter-qc.video.resolution-mismatch",
      layer: "structural",
      severity: "warn",
      message: `分辨率宽度与渲染设置不符: 期望 ${input.expectedWidth},实际 ${probe.width}`,
      evidence: { expected: input.expectedWidth, actual: probe.width },
    });
  }
  if (input.expectedHeight && probe.height && probe.height !== input.expectedHeight) {
    findings.push({
      code: "chapter-qc.video.resolution-mismatch",
      layer: "structural",
      severity: "warn",
      message: `分辨率高度与渲染设置不符: 期望 ${input.expectedHeight},实际 ${probe.height}`,
      evidence: { expected: input.expectedHeight, actual: probe.height },
    });
  }

  // 时长截断/超长(需 EDL)
  if (input.spans.length === 0) {
    notes.push("no-edl: 时间轴类子项跳过(老章节无 video-use 工件)");
  } else {
    const plannedS = input.spans[input.spans.length - 1].endS;
    const deltaS = probe.durationS - plannedS;
    if (deltaS < -DURATION_TOLERANCE_S) {
      findings.push({
        code: "chapter-qc.duration.truncated",
        layer: "structural",
        severity: "blocker",
        message: `成片时长疑似截断: 计划 ${plannedS.toFixed(2)}s,实际 ${probe.durationS.toFixed(2)}s(短 ${(-deltaS).toFixed(2)}s)`,
        evidence: { plannedS: Number(plannedS.toFixed(3)), actualS: Number(probe.durationS.toFixed(3)) },
      });
    } else if (deltaS > DURATION_TOLERANCE_S * 4) {
      findings.push({
        code: "chapter-qc.duration.overlong",
        layer: "structural",
        severity: "warn",
        message: `成片比计划长 ${deltaS.toFixed(2)}s(计划 ${plannedS.toFixed(2)}s)`,
        evidence: { plannedS: Number(plannedS.toFixed(3)), actualS: Number(probe.durationS.toFixed(3)) },
      });
    }
  }

  // 语音挤压(计划侧信号):计划旁白比容器还长 → 语音必然被压/裁
  if (input.plannedVoiceDurationUs && input.plannedVoiceDurationUs > 0) {
    const plannedVoiceS = input.plannedVoiceDurationUs / 1e6;
    const ratio = plannedVoiceS / probe.durationS;
    if (ratio > 1.02) {
      findings.push({
        code: "chapter-qc.audio.speech-compressed-planned",
        layer: "structural",
        severity: "warn",
        message: `计划旁白总时长(${plannedVoiceS.toFixed(2)}s)超过成片时长(${probe.durationS.toFixed(2)}s) ${((ratio - 1) * 100).toFixed(1)}%,疑似语音挤压`,
        evidence: { plannedVoiceS: Number(plannedVoiceS.toFixed(3)), actualS: Number(probe.durationS.toFixed(3)) },
      });
    }
  }

  // 字幕文本 diff
  const subtitleFindings = diffSubtitlesAgainstScript(input.cues, input.scriptText);
  if (subtitleFindings === null) {
    notes.push("no-script-draft: 字幕文本 diff 跳过");
  } else {
    for (const item of subtitleFindings) {
      findings.push({
        code: item.code,
        layer: "structural",
        severity: item.code === "chapter-qc.subtitle.text-mismatch" ? "warn" : "info",
        shotId: item.shotId,
        message: item.message,
        evidence: item.evidence,
      });
    }
  }

  return { findings, probe, notes };
}
