/**
 * QC 报告落盘:remotion 工作区 `qc/chapters/{chapterId}/current.json`。
 * 原子写(tmp+rename),旧版挪 previous.json(单份,不做多代)。
 */

import fs from "node:fs";
import path from "node:path";
import type { ChapterQcReportV1 } from "./chapter-qc-types";

/** 与 artifact store 同款段校验:ASCII 安全字符,防路径逃逸。 */
function safeChapterSegment(chapterId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(chapterId)) {
    throw new Error(`chapterId 含非法字符: ${chapterId}`);
  }
  return chapterId;
}

export function chapterQcReportDir(workspaceRoot: string, chapterId: string): string {
  return path.join(workspaceRoot, "qc", "chapters", safeChapterSegment(chapterId));
}

export function chapterQcReportPath(workspaceRoot: string, chapterId: string): string {
  return path.join(chapterQcReportDir(workspaceRoot, chapterId), "current.json");
}

export async function readChapterQcReport(
  workspaceRoot: string,
  chapterId: string,
): Promise<ChapterQcReportV1 | null> {
  const filePath = chapterQcReportPath(workspaceRoot, chapterId);
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ChapterQcReportV1;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeChapterQcReport(
  workspaceRoot: string,
  chapterId: string,
  report: ChapterQcReportV1,
): Promise<void> {
  const dir = chapterQcReportDir(workspaceRoot, chapterId);
  await fs.promises.mkdir(dir, { recursive: true });
  const currentPath = path.join(dir, "current.json");
  const previousPath = path.join(dir, "previous.json");
  try {
    await fs.promises.rename(currentPath, previousPath);
  } catch {
    // 首次写或并发写,忽略
  }
  const tmpPath = path.join(dir, "current.json.tmp");
  await fs.promises.writeFile(tmpPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, currentPath);
}
