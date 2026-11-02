/**
 * 章节成片四层 QC 链——共享类型与错误码族(08-19-chapter-video-qc)。
 *
 * 错误码命名空间 `chapter-qc.<domain>.<detail>`,独立于字幕 authority 的
 * `subtitle.authority.*`(那是渲染前正确性门禁;本链是出片后体检)。
 */

export const CHAPTER_QC_SCHEMA_VERSION = 1;

export type ChapterQcLayerId = "structural" | "ffmpegScan" | "aesthetic" | "semantic" | "vision";

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

/** L5 视觉审计帧物料种类:镜中/边界前/转场中/边界后 */
export type ChapterQcVisionFrameKind = "mid" | "pre" | "blend" | "post";

export interface ChapterQcVisionFrameTaskV1 {
  shotId: string;
  ordinal: number;
  kind: ChapterQcVisionFrameKind;
  /** 成片时间轴上的秒(压缩口径,与帧内容一致) */
  tS: number;
  frameUrl: string;
}

export interface ChapterQcVisionDecisionV1 {
  shotId: string;
  ordinal: number;
  description?: string;
  effects: Array<{ effectId: string; template?: string }>;
  outgoingTransition?: {
    toShotId: string;
    toOrdinal: number;
    effectId: string;
    durationS: number;
  };
}

export interface ChapterQcVisionPreflightResultV1 {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  model?: string;
  finishedAt: number;
}

/**
 * L5 视觉审计层(08-22-video-use-vision-release R2)。
 * 确定性部分主进程即时跑:转场密度闸(08-22 裁定:连续 5 边界禁同款)。
 * 模型判读部分:主进程只产帧物料(frames),渲染端 runner 按清单调图像理解
 * 模型(L4 semantic 同款 pending 语义),跑完回写 findings。
 */
export interface ChapterQcVisionResultV1 {
  frameCount: number;
  frames: ChapterQcVisionFrameTaskV1[];
  /** 确认前预审的最小 EDL/转场/装饰决策上下文。 */
  decisions: ChapterQcVisionDecisionV1[];
  /** 密度闸检查的转场数(0=无转场) */
  densityChecked: number;
  /** 帧提取失败数(单帧跳过不整体失败) */
  frameErrors: number;
  /** 渲染端图片理解预审回写；缺省=尚未运行或无 binding。 */
  preflight?: ChapterQcVisionPreflightResultV1;
}

/**
 * 三态验收(1030 单镜分析门口径):`unverified` 永不计为通过。
 * pass=客观信号越限为零;fail=任一客观门越限;unverified=层没跑到/物料缺/阈值未标定/
 * 缺人工复核——「查不出来」不得冒充「查过没问题」。
 */
export type ChapterQcRequirementVerdict = "pass" | "fail" | "unverified";

export interface ChapterQcRequirementV1 {
  /** 稳定需求 id,UI 与回执按此对账 */
  requirementId: string;
  label: string;
  verdict: ChapterQcRequirementVerdict;
  /** 本条盯的 finding code(unverified 时为期望但拿不到的证据) */
  watchedCodes: string[];
  /** 实际命中的 finding code(pass 恒空) */
  evidenceCodes: string[];
  /** 缺什么证据(仅 unverified;逐条写明,便于直接列待办) */
  missing?: string[];
  /** 数字回执:已记录的均值/占比等,不改变 verdict */
  note?: string;
}

/**
 * L2 实测台账(1030 三态验收需要):区分「测到了且没越限」和「压根没测出来」。
 * 缺这一份数,响度/语音一类需求只能恒判 unverified——那正是本板要防的假绿。
 */
export interface ChapterQcScanSignalsV1 {
  blacks: number;
  freezes: number;
  silences: number;
  /** loudnorm 未出数时缺省(=响度这条测不了,不许当通过) */
  loudnessInputI?: number;
  /** 语音补集秒数(无时长口径时缺省) */
  speechSeconds?: number;
  /** 语音段口径:VAD 到位= silero-vad;否则 silencedetect 补集(带 BGM 会退化) */
  speechSource?: "silero-vad" | "silencedetect-complement";
  /** blurdetect 全片均值(越大越糊) */
  blurMean?: number;
  frameSampleCount?: number;
  frameSampleStep: number;
}

/**
 * 人工复核回写(1031 吸收件 C 组补齐):三态板里 pass 的第二半。
 * 机器全绿不顶替人眼——`fullWatched`/`audioListened` 必须分列,只勾一个不算看全片;
 * `reviewer` 必填,匿名确认不留证据(与 L4/L5 回写留 model 同一口径)。
 * 重跑 QC 会重建报告,本字段随之清空——片子换了就得重看。
 */
export interface ChapterQcHumanReviewV1 {
  /** 人眼全速看完全片(非抽帧、非倍速) */
  fullWatched: boolean;
  /** 人耳听完全轨 */
  audioListened: boolean;
  reviewer: string;
  /** 复核时刻 */
  at: number;
  /** 复核备注(看到了什么、仍存什么疑) */
  notes?: string;
}

/**
 * 人工复核回写(1031 补 C 组缺口)。
 * pass 的第二半不是「层都绿了」,而是「有人全速看过、有人耳听过」——
 * 所以两问必须分列勾选,且署名留痕;缺省(未提交)= 无证据,三态板记 unverified。
 * 重跑 QC 会重建报告,本字段随之清空:片子或口径变了,上一次签字不再算数。
 */
export interface ChapterQcHumanReviewV1 {
  /** 人眼全速看完全片(非抽帧、非倍速) */
  fullWatched: boolean;
  /** 人耳听完全轨 */
  audioListened: boolean;
  /** 复核人署名,留审计(不接受匿名放行) */
  reviewer: string;
  /** 复核时刻 */
  at: number;
  /** 复核人备注(看到的问题、听出的问题);IPC 侧截 500 字 */
  notes?: string;
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
  vision?: ChapterQcVisionResultV1;
  /** 三态需求板(由五层结果派生,任何层回写后整体重算;缺省=旧报告未带) */
  requirements?: ChapterQcRequirementV1[];
  /** L2 实测台账,供需求板区分「没越限」与「没测出来」 */
  scanSignals?: ChapterQcScanSignalsV1;
  /** 人工复核回写(缺省=尚未复核;重跑 QC 即失效) */
  humanReview?: ChapterQcHumanReviewV1;
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
