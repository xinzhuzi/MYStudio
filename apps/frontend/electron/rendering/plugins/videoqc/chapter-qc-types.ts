/**
 * 章节成片四层 QC 链——共享类型与错误码族(08-19-chapter-video-qc)。
 *
 * 错误码命名空间 `chapter-qc.<domain>.<detail>`,独立于字幕 authority 的
 * `subtitle.authority.*`(那是渲染前正确性门禁;本链是出片后体检)。
 */

export const CHAPTER_QC_SCHEMA_VERSION = 1;

export type ChapterQcLayerId = "structural" | "ffmpegScan" | "aesthetic" | "semantic";

export type ChapterQcSeverity = "blocker" | "warn" | "info";

export interface ChapterQcFindingV1 {
  /** 形如 `chapter-qc.<domain>.<detail>` 的稳定错误码 */
  code: string;
  layer: ChapterQcLayerId;
  severity: ChapterQcSeverity;
  /** 定位到镜(时间轴映射结果);结构性问题可无镜 */
  shotId?: string;
  /** 第几镜(1 起,人类可读) */
  shotOrdinal?: number;
  message: string;
  /** 原始证据:时间戳/分数/比对差值/探测器输出片段 */
  evidence: Record<string, unknown>;
}

export type ChapterQcLayerStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ChapterQcLayerResultV1 {
  status: ChapterQcLayerStatus;
  /** skipped 原因 / failed 摘要 / passed 附注 */
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
}

/** L3 观感层结果(缺模型/未跑时整个字段缺省或 layers.aesthetic=skipped) */
export interface ChapterQcAestheticResultV1 {
  /** ITU 归一总分 [0,1](DOVER fused) */
  fused: number;
  aesthetic: number;
  technical: number;
  baseline?: {
    seriesId: string;
    meanFused: number;
    sigma: number;
    sampleCount: number;
  };
  /** 整片分异常时的按镜切片重跑结果(粗到细定位) */
  slices?: Array<{ shotId: string; ordinal: number; fused: number }>;
  elapsedMs?: number;
}

/** L4 语义层结果(渲染端跑完回写) */
export interface ChapterQcSemanticResultV1 {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 使用的模型标识(provider/model,留审计) */
  model?: string;
  finishedAt: number;
}

export interface ChapterQcReportV1 {
  schemaVersion: typeof CHAPTER_QC_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  outputPath: string;
  outputSha256?: string;
  createdAt: number;
  /** 成片时长(秒)与镜数,报告头快照 */
  durationS?: number;
  shotCount?: number;
  layers: Record<ChapterQcLayerId, ChapterQcLayerResultV1>;
  findings: ChapterQcFindingV1[];
  summary: { blockers: number; warns: number; infos: number };
  /** L4 消费:每镜代表帧(project-file URL)+镜描述(无帧/无描述的镜 runner 跳过) */
  shots?: Array<{ shotId: string; ordinal: number; frameUrl: string; description?: string }>;
  aesthetic?: ChapterQcAestheticResultV1;
  semantic?: ChapterQcSemanticResultV1;
}

export function summarizeChapterQcFindings(findings: ChapterQcFindingV1[]): ChapterQcReportV1["summary"] {
  let blockers = 0;
  let warns = 0;
  let infos = 0;
  for (const finding of findings) {
    if (finding.severity === "blocker") blockers += 1;
    else if (finding.severity === "warn") warns += 1;
    else infos += 1;
  }
  return { blockers, warns, infos };
}
