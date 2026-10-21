/**
 * 全书提取进度台账(C1 Step 5;design §6 / D13 / D18 / D25 / D26)。
 *
 * 家=`store/extraction/extraction-run.json`(**不在 studio-workflow/ 内**——该目录
 * 根层非 manifest 文件每次保存被孤儿清理删,storage-project-sharded.ts:390-396;
 * D18 轮3 定谳)。写通道=项目相对路径 writeText + move(tmp→正式 的原子写)。
 *
 * D25:App 启动时任何非 paused/done 状态(含 quota_wait、running)一律置 paused,
 * resumeAt 保留展示——由调用方在启动路径调 normalizeLedgerForStartup。
 * D26:每章记 resolved model,与 run 顶层不一致=模型漂移(findModelDrift)。
 *
 * 纯逻辑+注入 LedgerStorage;生产桥=createElectronLedgerStorage(键约定同
 * novel-mirrors:_p/{projectId}/ 前缀,见 source-bible.ts:28)。
 */

import { chapterIdFromNumber } from "@/lib/studio/entity-extraction-input";

/** 台账家(D18):studio-workflow/ 之外的兄弟目录,不受分片库孤儿清理管辖。 */
export const EXTRACTION_LEDGER_RELATIVE_PATH = "store/extraction/extraction-run.json";

export type ExtractionRunStatus = "running" | "paused" | "quota_wait" | "done";
export type LedgerChapterState = "pending" | "running" | "success" | "failed" | "skipped";

export interface LedgerChapterEntry {
  state: LedgerChapterState;
  /** 输入指纹(sha 截 16 位;design §2),success+指纹未变 → 续跑跳过(R2)。 */
  fingerprint?: string;
  /** 本章实际 resolve 的模型(D26 模型漂移守卫真源)。 */
  model?: string;
  attempts?: number;
  error?: string | null;
  ms?: number;
  tokensIn?: number;
  tokensOut?: number;
  at?: string;
}

export interface ExtractionRunLedger {
  version: 1;
  runId: string;
  /** run 顶层模型(D9 全书统一;每章 resolved model 与之比对)。 */
  model: string;
  range: [number, number];
  status: ExtractionRunStatus;
  /** quota_wait 时的额度窗口重置时刻(epoch ms);其余 null。 */
  resumeAt: number | null;
  chapters: Record<string, LedgerChapterEntry>;
}

/** 台账 IO 通道(测试注入;生产=createElectronLedgerStorage)。 */
export interface LedgerStorage {
  readText(relativePath: string): Promise<string | null>;
  writeText(relativePath: string, value: string): Promise<void>;
  move(fromRelative: string, toRelative: string): Promise<void>;
}

export interface CreateExtractionLedgerInit {
  runId: string;
  model: string;
  range: [number, number];
}

/** 新建台账:range 内逐章预填 pending(章号补零同 createChapterId,≥1000 四位)。 */
export function createExtractionLedger(init: CreateExtractionLedgerInit): ExtractionRunLedger {
  const chapters: Record<string, LedgerChapterEntry> = {};
  for (let n = init.range[0]; n <= init.range[1]; n += 1) {
    chapters[chapterIdFromNumber(n)] = { state: "pending" };
  }
  return {
    version: 1,
    runId: init.runId,
    model: init.model,
    range: [init.range[0], init.range[1]],
    status: "paused",
    resumeAt: null,
    chapters,
  };
}

/** 确定性序列化:章 key 字典序固定,重复写盘字节稳定。 */
export function serializeLedger(ledger: ExtractionRunLedger): string {
  const chapters: Record<string, LedgerChapterEntry> = {};
  for (const key of Object.keys(ledger.chapters).sort()) {
    chapters[key] = ledger.chapters[key]!;
  }
  return JSON.stringify({ ...ledger, chapters });
}

/** 宽容解析:非法 JSON/空串 → null(缺失台账=新起 run,不抛)。 */
export function parseLedgerJson(raw: string): ExtractionRunLedger | null {
  try {
    const parsed = JSON.parse(raw) as ExtractionRunLedger;
    if (!parsed || typeof parsed !== "object" || !parsed.chapters) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** D25 启动收口:任何非 paused/done 状态一律置 paused;resumeAt 原样保留(过时则点继续即跑)。 */
export function normalizeLedgerForStartup(ledger: ExtractionRunLedger): ExtractionRunLedger {
  if (ledger.status === "paused" || ledger.status === "done") return ledger;
  return { ...ledger, status: "paused" };
}

/** 逐章记账(不可变更新):state/fingerprint/resolved model/error/ms/token/at 由调用方给全。 */
export function recordChapter(
  ledger: ExtractionRunLedger,
  chapterId: string,
  patch: Partial<LedgerChapterEntry>,
): ExtractionRunLedger {
  const existing = ledger.chapters[chapterId] ?? { state: "pending" as const };
  return {
    ...ledger,
    chapters: {
      ...ledger.chapters,
      [chapterId]: { ...existing, ...patch },
    },
  };
}

/** R2 续跑跳过:已 success 且指纹未变 → true(该章零调用)。 */
export function shouldSkipChapter(
  ledger: ExtractionRunLedger,
  chapterId: string,
  fingerprint: string,
): boolean {
  const entry = ledger.chapters[chapterId];
  if (!entry || entry.state !== "success") return false;
  return entry.fingerprint === fingerprint;
}

/** D26 模型漂移:任一章 resolved model ≠ run 顶层 → 报首个漂移章;全一致 null。 */
export function findModelDrift(
  ledger: ExtractionRunLedger,
): { chapterId: string; model: string } | null {
  for (const chapterId of Object.keys(ledger.chapters).sort()) {
    const entry = ledger.chapters[chapterId]!;
    if (entry.model && entry.model !== ledger.model) {
      return { chapterId, model: entry.model };
    }
  }
  return null;
}

/** 原子写:先写 `<home>.tmp` 再 move 到正式位(项目文件系统的 rename 语义)。 */
export async function writeLedgerAtomically(
  storage: LedgerStorage,
  ledger: ExtractionRunLedger,
): Promise<void> {
  const tmp = `${EXTRACTION_LEDGER_RELATIVE_PATH}.tmp`;
  await storage.writeText(tmp, serializeLedger(ledger));
  await storage.move(tmp, EXTRACTION_LEDGER_RELATIVE_PATH);
}

/** 读台账:缺失/损坏 → null。 */
export async function readLedger(storage: LedgerStorage): Promise<ExtractionRunLedger | null> {
  const raw = await storage.readText(EXTRACTION_LEDGER_RELATIVE_PATH);
  if (raw === null) return null;
  return parseLedgerJson(raw);
}

/** electronAPI.projectFiles 的结构类型(避免直依赖 window,测试可注入 vi.fn)。 */
export interface ProjectFilesBridge {
  readText: (payload: { projectId: string; relativePath: string }) => Promise<{
    success: boolean;
    text?: string;
    error?: string;
  }>;
  writeText: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
  move: (payload: { projectId: string; fromRelative: string; toRelative: string; replaceExisting?: boolean }) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

/** 生产桥:readText/move 走 {projectId, relativePath};writeText 走 `_p/{projectId}/` 键
 * (novel-mirrors 同族通道,主进程解析到项目根目录)。失败抛错由调用方处置。 */
export function createElectronLedgerStorage(
  projectId: string,
  bridge: ProjectFilesBridge,
): LedgerStorage {
  return {
    async readText(relativePath) {
      const result = await bridge.readText({ projectId, relativePath });
      if (!result.success) return null;
      return result.text ?? null;
    },
    async writeText(relativePath, value) {
      const result = await bridge.writeText(`_p/${projectId}/${relativePath}`, value);
      if (!result.success) throw new Error(result.error ?? `writeText failed: ${relativePath}`);
    },
    async move(fromRelative, toRelative) {
      const result = await bridge.move({ projectId, fromRelative, toRelative, replaceExisting: true });
      if (!result.success) throw new Error(result.error ?? `move failed: ${fromRelative}`);
    },
  };
}
