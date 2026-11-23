/**
 * 成片 QC 体检单的本地接口与标签常量(1123 归位役自 `ChapterQcReportCard.tsx` 拆出)。
 * 这五个接口是渲染端对 `window.chapterQc` 桥报告结构的本地视角;三态口径总注释见组件文件头。
 */

import type {
  ChapterQcDimensionCategory,
  ChapterQcEvaluatorKind,
} from "@rendering/plugins/videoqc/chapter-qc-types";
import type {
  VisionPreflightDecisionInput,
  VisionPreflightFrameInput,
} from "@/lib/studio/qc/vision-preflight-runner";

export interface ChapterQcFinding {
  code: string;
  layer: string;
  severity: "blocker" | "warn" | "info";
  shotId?: string;
  shotOrdinal?: number;
  message: string;
}

export interface ChapterQcRequirement {
  requirementId: string;
  label: string;
  verdict: "pass" | "fail" | "unverified";
  evidenceCodes: string[];
  missing?: string[];
  note?: string;
  category?: ChapterQcDimensionCategory;
  evaluator?: ChapterQcEvaluatorKind;
  weight?: number;
  failingShotOrdinals?: number[];
}

export interface ChapterQcHumanReview {
  fullWatched: boolean;
  audioListened: boolean;
  reviewer: string;
  at: number;
  notes?: string;
}

export interface ChapterQcReport {
  schemaVersion: number;
  projectId: string;
  chapterId: string;
  createdAt: number;
  durationS?: number;
  shotCount?: number;
  layers: Record<string, { status: string; reason?: string }>;
  findings: ChapterQcFinding[];
  summary: { blockers: number; warns: number; infos: number };
  /** 本轮取证口径与退化留痕(编排器写;三态板说不出「证据是怎么来的」,靠这几条) */
  notes?: string[];
  shots?: Array<{ shotId: string; ordinal: number; frameUrl: string; description?: string }>;
  semantic?: { checked: number; passed: number; failed: number; skipped: number; model?: string };
  vision?: {
    frameCount: number;
    frames: VisionPreflightFrameInput[];
    decisions: VisionPreflightDecisionInput[];
    densityChecked: number;
    frameErrors: number;
    preflight?: {
      checked: number;
      passed: number;
      failed: number;
      skipped: number;
      model?: string;
      finishedAt: number;
    };
  };
  requirements?: ChapterQcRequirement[];
  /** 骨干③:加权维度分(pass 才计分;不影响放行口径) */
  dimensionScore?: { score: number; weightTotal: number; weightPassed: number; deducted: Array<{ requirementId: string; weight: number; reason: "unverified" | "fail" }> };
  /** 骨干⓪:供给完整性自检 */
  supplyChecks?: { checks: Array<{ checkId: string; label: string; verdict: "ok" | "gap" | "blocked"; detail?: string }>; gaps: number; blocked: number };
  /** 骨干②:逐镜期望断言集 */
  expectations?: {
    shots: Array<{ shotId: string; ordinal: number; assertions: Record<string, string> }>;
    coverage: Array<{ key: string; expected: number; forbidden: number; unknown: number }>;
  };
  /** 骨干③:参与本轮判定的信号基线 + 打标金标逐行召回账 */
  calibration?: {
    seriesId: string;
    caseCount: number;
    baselines: Array<{ signalId: string; mean: number; sigma: number; sampleCount: number; seriesSampleCount?: number }>;
    caseScores?: Array<{ requirementId: string; greenTotal: number; greenPassed: number; redTotal: number; redCaught: number }>;
  };
  humanReview?: ChapterQcHumanReview;
}

export interface ChapterQcBridge {
  getReport: (payload: { projectId: string; chapterId: string }) => Promise<ChapterQcReport | null>;
  run: (payload: { projectId: string; chapterId: string }) => Promise<{ success: boolean; message?: string; report?: ChapterQcReport }>;
  submitSemantic: (payload: {
    projectId: string;
    chapterId: string;
    model?: string;
    stats: { checked: number; passed: number; failed: number; skipped: number };
    findings: unknown[];
  }) => Promise<{ success: boolean; message?: string }>;
  submitVisionPreflight: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    model?: string;
    stats: { checked: number; passed: number; failed: number; skipped: number };
    findings: unknown[];
  }) => Promise<{ success: boolean; message?: string }>;
  /** 人工复核回写:勾选只看主进程派生三态,不在渲染端算 verdict。 */
  submitHumanReview?: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    fullWatched: boolean;
    audioListened: boolean;
    reviewer: string;
    notes?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  /**
   * 逐行打标金标:渲染端只答「这行盯的问题,这片子里到底有没有」(red/green)。
   * 机器判定那半边由主进程从这份报告抄,所以这里不上报 verdict——渲染端说的不算。
   */
  submitCalibrationCase?: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    requirementId: string;
    label: "red" | "green";
    note?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  onReportUpdated: (listener: (payload: { projectId: string; chapterId: string }) => void) => () => void;
}

export const LAYER_LABELS: Array<{ id: string; label: string }> = [
  { id: "structural", label: "结构比对" },
  { id: "ffmpegScan", label: "逐帧扫描" },
  { id: "aesthetic", label: "观感评分" },
  { id: "semantic", label: "语义核对" },
];
