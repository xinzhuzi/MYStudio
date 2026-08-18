// Chapter QC IPC — QC 报告读取/手动重跑/L4 语义回写 + 报告更新事件广播。
// 通道字面量(契约测试扫描);语义回写做 schema 校验(渲染端不可信输入)。

import { ipcMain, type BrowserWindow } from "electron";

import type { ChapterQcReportV1, ChapterQcFindingV1 } from "@rendering/plugins/videoqc/chapter-qc-types";
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

    const { writeChapterQcReport } = await import("@rendering/plugins/videoqc/chapter-qc-report-store");
    await writeChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId, report);
    broadcast(identity.projectId, identity.chapterId);
    return { success: true };
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("chapter-qc-get-report");
      ipcMain.removeHandler("chapter-qc-run");
      ipcMain.removeHandler("chapter-qc-submit-semantic");
    },
  };
}
