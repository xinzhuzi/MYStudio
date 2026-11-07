// Chapter QC IPC — QC 报告读取/手动重跑/L4 语义、AC4 视觉预审、人工复核回写与逐行打标金标 + 报告更新事件广播。
// 通道字面量(契约测试扫描);语义回写做 schema 校验(渲染端不可信输入)。

import { ipcMain, type BrowserWindow } from "electron";

import {
  summarizeChapterQcFindings,
  type ChapterQcReportV1,
  type ChapterQcFindingV1,
} from "@rendering/plugins/videoqc/chapter-qc-types";
import { applyChapterQcRequirements } from "@rendering/plugins/videoqc/chapter-qc-verdicts";
import type { runChapterQc, ChapterQcOrchestratorDeps } from "@rendering/plugins/videoqc/chapter-qc-orchestrator";

export interface RegisterChapterQcIpcOptions {
  deps: ChapterQcOrchestratorDeps;
  runQc: typeof runChapterQc;
  getWindow: () => BrowserWindow | null;
}

export interface ChapterQcIpc {
  dispose: () => void;
}

export const CHAPTER_QC_REPORT_EVENT = "chapter-qc-report-updated";

interface SemanticSubmitPayload {
  projectId?: unknown;
  chapterId?: unknown;
  model?: unknown;
  stats?: unknown;
  findings?: unknown;
}

interface VisionPreflightSubmitPayload extends SemanticSubmitPayload {
  expectedCreatedAt?: unknown;
}

/** 人工复核回写:渲染端只报「看没看完/听没听完/谁签的」,三态判定恒在主进程派生。 */
interface HumanReviewSubmitPayload {
  projectId?: unknown;
  chapterId?: unknown;
  expectedCreatedAt?: unknown;
  fullWatched?: unknown;
  audioListened?: unknown;
  reviewer?: unknown;
  notes?: unknown;
}

/** 打标金标:渲染端只报「这行盯的问题这片子到底有没有」,机器判定由主进程从报告抄。 */
interface CalibrationCaseSubmitPayload {
  projectId?: unknown;
  chapterId?: unknown;
  expectedCreatedAt?: unknown;
  requirementId?: unknown;
  label?: unknown;
  note?: unknown;
}

function readPreflightStats(value: unknown): { checked: number; passed: number; failed: number; skipped: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["checked", "passed", "failed", "skipped"] as const;
  if (!keys.every((key) => Number.isInteger(record[key]) && Number(record[key]) >= 0)) return null;
  return {
    checked: Number(record.checked),
    passed: Number(record.passed),
    failed: Number(record.failed),
    skipped: Number(record.skipped),
  };
}

function readIdentity(value: unknown): { projectId?: string; chapterId?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as { projectId?: unknown; chapterId?: unknown };
  const identity: { projectId?: string; chapterId?: string } = {};
  if (typeof record.projectId === "string" && record.projectId) identity.projectId = record.projectId;
  if (typeof record.chapterId === "string" && record.chapterId) identity.chapterId = record.chapterId;
  return identity;
}

export function registerChapterQcIpcHandlers(options: RegisterChapterQcIpcOptions): ChapterQcIpc {
  const { deps, runQc, getWindow } = options;

  function broadcast(projectId: string, chapterId: string): void {
    const window = getWindow();
    try {
      window?.webContents.send(CHAPTER_QC_REPORT_EVENT, { projectId, chapterId });
    } catch {
      // 窗口可能已销毁
    }
  }

  ipcMain.handle("chapter-qc-get-report", async (_event, payload: unknown) => {
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) return null;
    const request = identity as { projectId: string; chapterId: string };
    const { readReport } = await import("@rendering/plugins/videoqc/chapter-qc-orchestrator");
    return readReport(deps, request);
  });

  ipcMain.handle("chapter-qc-run", async (_event, payload: unknown) => {
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) {
      return { success: false, message: "projectId/chapterId 必填" };
    }
    const request = identity as { projectId: string; chapterId: string };
    const outputPath = typeof (payload as { outputPath?: unknown })?.outputPath === "string"
      ? (payload as { outputPath: string }).outputPath
      : undefined;
    const report = await runQc(deps, { ...request, ...(outputPath ? { outputPath } : {}) });
    if (!report) return { success: false, message: "成片不存在或 QC 无法启动" };
    broadcast(request.projectId, request.chapterId);
    return { success: true, report };
  });

  ipcMain.handle("chapter-qc-submit-semantic", async (_event, payload: unknown): Promise<{ success: boolean; message?: string }> => {
    const submit = payload as SemanticSubmitPayload;
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) {
      return { success: false, message: "projectId/chapterId 必填" };
    }
    const request = identity as { projectId: string; chapterId: string };
    if (typeof submit.findings !== "object" || submit.findings === null || !Array.isArray(submit.findings)) {
      return { success: false, message: "findings 必须是数组" };
    }
    const { readReport } = await import("@rendering/plugins/videoqc/chapter-qc-orchestrator");
    const report: ChapterQcReportV1 | null = await readReport(deps, request);
    if (!report) return { success: false, message: "QC 报告不存在,无法回写语义层" };

    const stats = (typeof submit.stats === "object" && submit.stats !== null ? submit.stats : {}) as Record<string, unknown>;
    const semanticFindings: ChapterQcFindingV1[] = [];
    for (const raw of submit.findings as unknown[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const finding = raw as Record<string, unknown>;
      if (typeof finding.code !== "string" || typeof finding.message !== "string") continue;
      semanticFindings.push({
        code: finding.code,
        layer: "semantic" as const,
        severity: finding.severity === "blocker" || finding.severity === "warn" ? finding.severity : "info",
        ...(typeof finding.shotId === "string" ? { shotId: finding.shotId } : {}),
        ...(typeof finding.shotOrdinal === "number" ? { shotOrdinal: finding.shotOrdinal } : {}),
        message: finding.message,
        evidence: (typeof finding.evidence === "object" && finding.evidence !== null
          ? finding.evidence
          : {}) as Record<string, unknown>,
      });
    }

    report.semantic = {
      checked: typeof stats.checked === "number" ? stats.checked : 0,
      passed: typeof stats.passed === "number" ? stats.passed : 0,
      failed: typeof stats.failed === "number" ? stats.failed : 0,
      skipped: typeof stats.skipped === "number" ? stats.skipped : 0,
      ...(typeof submit.model === "string" ? { model: submit.model } : {}),
      finishedAt: Date.now(),
    };
    report.findings = [...report.findings.filter((finding) => finding.layer !== "semantic"), ...semanticFindings];
    report.summary = {
      blockers: report.findings.filter((f) => f.severity === "blocker").length,
      warns: report.findings.filter((f) => f.severity === "warn").length,
      infos: report.findings.filter((f) => f.severity === "info").length,
    };
    report.layers.semantic = { status: semanticFindings.some((f) => f.severity === "blocker") ? "failed" : "passed", finishedAt: Date.now() };
    applyChapterQcRequirements(report);

    const { writeChapterQcReport } = await import("@rendering/plugins/videoqc/chapter-qc-report-store");
    await writeChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId, report);
    broadcast(identity.projectId, identity.chapterId);
    return { success: true };
  });

  ipcMain.handle("chapter-qc-submit-vision-preflight", async (_event, payload: unknown): Promise<{ success: boolean; message?: string }> => {
    const submit = payload as VisionPreflightSubmitPayload;
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) {
      return { success: false, message: "projectId/chapterId 必填" };
    }
    if (typeof submit.expectedCreatedAt !== "number" || !Number.isFinite(submit.expectedCreatedAt)) {
      return { success: false, message: "expectedCreatedAt 必填" };
    }
    const stats = readPreflightStats(submit.stats);
    if (!stats) return { success: false, message: "stats 必须是非负整数" };
    if (stats.checked !== stats.passed + stats.failed) {
      return { success: false, message: "stats 计数不一致" };
    }
    if (!Array.isArray(submit.findings)) return { success: false, message: "findings 必须是数组" };

    const request = identity as { projectId: string; chapterId: string };
    const { readReport } = await import("@rendering/plugins/videoqc/chapter-qc-orchestrator");
    const report: ChapterQcReportV1 | null = await readReport(deps, request);
    if (!report?.vision) return { success: false, message: "QC 视觉物料不存在,无法回写预审" };
    if (report.createdAt !== submit.expectedCreatedAt) {
      return { success: false, message: "QC 报告已更新,请重新预审" };
    }

    const preflightFindings: ChapterQcFindingV1[] = [];
    for (const raw of submit.findings) {
      if (typeof raw !== "object" || raw === null) continue;
      const finding = raw as Record<string, unknown>;
      if (typeof finding.code !== "string" || !finding.code.startsWith("chapter-qc.vision.preflight.")) continue;
      if (typeof finding.message !== "string" || !finding.message.trim()) continue;
      preflightFindings.push({
        code: finding.code,
        layer: "vision",
        severity: finding.severity === "blocker" || finding.severity === "warn" ? finding.severity : "info",
        ...(typeof finding.shotId === "string" ? { shotId: finding.shotId } : {}),
        ...(typeof finding.shotOrdinal === "number" ? { shotOrdinal: finding.shotOrdinal } : {}),
        message: finding.message,
        evidence: {
          ...(typeof finding.evidence === "object" && finding.evidence !== null
            ? finding.evidence as Record<string, unknown>
            : {}),
          source: "vision-preflight",
        },
      });
    }

    report.vision.preflight = {
      ...stats,
      ...(typeof submit.model === "string" ? { model: submit.model } : {}),
      finishedAt: Date.now(),
    };
    report.findings = [
      ...report.findings.filter((finding) =>
        !(finding.layer === "vision" && finding.evidence?.source === "vision-preflight")),
      ...preflightFindings,
    ];
    report.summary = summarizeChapterQcFindings(report.findings);
    applyChapterQcRequirements(report);

    const { writeChapterQcReport } = await import("@rendering/plugins/videoqc/chapter-qc-report-store");
    await writeChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId, report);
    broadcast(identity.projectId, identity.chapterId);
    return { success: true };
  });

  ipcMain.handle("chapter-qc-submit-human-review", async (_event, payload: unknown): Promise<{ success: boolean; message?: string }> => {
    const submit = payload as HumanReviewSubmitPayload;
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) {
      return { success: false, message: "projectId/chapterId 必填" };
    }
    if (typeof submit.expectedCreatedAt !== "number" || !Number.isFinite(submit.expectedCreatedAt)) {
      return { success: false, message: "expectedCreatedAt 必填" };
    }
    const reviewer = typeof submit.reviewer === "string" ? submit.reviewer.trim() : "";
    if (!reviewer || reviewer.length > 80) return { success: false, message: "复核人必填(≤80 字)" };
    if (typeof submit.fullWatched !== "boolean" || typeof submit.audioListened !== "boolean") {
      return { success: false, message: "fullWatched/audioListened 必须是布尔" };
    }
    const notes = typeof submit.notes === "string" ? submit.notes.trim().slice(0, 500) : "";

    const request = identity as { projectId: string; chapterId: string };
    const { readReport } = await import("@rendering/plugins/videoqc/chapter-qc-orchestrator");
    const report: ChapterQcReportV1 | null = await readReport(deps, request);
    if (!report) return { success: false, message: "QC 报告不存在,无法回写人工复核" };
    if (report.createdAt !== submit.expectedCreatedAt) {
      return { success: false, message: "QC 报告已更新(片子或分层结果重跑过),请重新看一遍再确认" };
    }

    report.humanReview = {
      fullWatched: submit.fullWatched,
      audioListened: submit.audioListened,
      reviewer,
      at: Date.now(),
      ...(notes ? { notes } : {}),
    };
    applyChapterQcRequirements(report);

    const { writeChapterQcReport } = await import("@rendering/plugins/videoqc/chapter-qc-report-store");
    await writeChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId, report);
    broadcast(identity.projectId, identity.chapterId);
    return { success: true };
  });

  ipcMain.handle("chapter-qc-submit-calibration-case", async (_event, payload: unknown): Promise<{ success: boolean; message?: string }> => {
    const submit = payload as CalibrationCaseSubmitPayload;
    const identity = readIdentity(payload);
    if (!identity.projectId || !identity.chapterId) {
      return { success: false, message: "projectId/chapterId 必填" };
    }
    if (typeof submit.expectedCreatedAt !== "number" || !Number.isFinite(submit.expectedCreatedAt)) {
      return { success: false, message: "expectedCreatedAt 必填" };
    }
    const requirementId = typeof submit.requirementId === "string" ? submit.requirementId.trim() : "";
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(requirementId)) return { success: false, message: "requirementId 非法" };
    if (submit.label !== "red" && submit.label !== "green") {
      return { success: false, message: "label 只能是 red(真有问题)/ green(没问题)" };
    }
    const note = typeof submit.note === "string" ? submit.note.trim().slice(0, 300) : "";

    const request = identity as { projectId: string; chapterId: string };
    const { readReport } = await import("@rendering/plugins/videoqc/chapter-qc-orchestrator");
    const report: ChapterQcReportV1 | null = await readReport(deps, request);
    if (!report) return { success: false, message: "QC 报告不存在,无法记录金标" };
    if (report.createdAt !== submit.expectedCreatedAt) {
      return { success: false, message: "QC 报告已更新,请按当前这一版重新打标" };
    }
    // 金标的机器那半边只从报告抄:渲染端上报的 verdict 不可信,也不是这一轮看板说的话。
    const row = report.requirements?.find((item) => item.requirementId === requirementId);
    if (!row) return { success: false, message: `这份报告没有「${requirementId}」这一行,请先重跑 QC` };
    if (typeof report.outputSha256 !== "string" || !report.outputSha256) {
      return { success: false, message: "报告没有成片哈希,金标无法锚定到片子上,请重跑 QC" };
    }
    if (!report.calibration) {
      return { success: false, message: "这份报告早于标定骨干(无标定块),请重跑 QC 后再打标" };
    }

    const { calibrationCaseId, readCalibrationStore, scoreCalibrationSet, upsertCalibrationCase, writeCalibrationStore } =
      await import("@rendering/plugins/videoqc/chapter-qc-calibration");
    const workspaceRoot = deps.remotionWorkspaceRootForProject(identity.projectId);
    const at = Date.now();
    try {
      const next = upsertCalibrationCase(readCalibrationStore(workspaceRoot, report.calibration.seriesId), {
        caseId: calibrationCaseId(report.outputSha256, requirementId),
        videoSha256: report.outputSha256,
        requirementId,
        label: submit.label,
        verdict: row.verdict,
        at,
        note,
      });
      writeCalibrationStore(workspaceRoot, next);
      report.calibration = {
        ...report.calibration,
        caseCount: next.cases.length,
        caseScores: scoreCalibrationSet(next.cases, (item) => item.verdict),
      };
    } catch (error) {
      return { success: false, message: `标定库写入失败,本轮未记录金标:${error instanceof Error ? error.message : String(error)}` };
    }
    applyChapterQcRequirements(report);

    const { writeChapterQcReport } = await import("@rendering/plugins/videoqc/chapter-qc-report-store");
    await writeChapterQcReport(workspaceRoot, identity.chapterId, report);
    broadcast(identity.projectId, identity.chapterId);
    return { success: true };
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("chapter-qc-get-report");
      ipcMain.removeHandler("chapter-qc-run");
      ipcMain.removeHandler("chapter-qc-submit-semantic");
      ipcMain.removeHandler("chapter-qc-submit-vision-preflight");
      ipcMain.removeHandler("chapter-qc-submit-human-review");
      ipcMain.removeHandler("chapter-qc-submit-calibration-case");
    },
  };
}
