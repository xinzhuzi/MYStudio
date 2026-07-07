import fs from "node:fs";
import path from "node:path";
import type {
  DiagnosticsLogClearResult,
  DiagnosticsLogEntry,
  DiagnosticsLogEntryInput,
  DiagnosticsLogExportResult,
  DiagnosticsLogInfo,
  DiagnosticsLogLevel,
  DiagnosticsLogQuery,
  DiagnosticsLogQueryResult,
} from "../types/diagnostics";
import { sanitizeDiagnosticsData, sanitizeDiagnosticsError } from "../lib/diagnostics/sanitize";

const LEVEL_SCORE: Record<DiagnosticsLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface DiagnosticsLogServiceOptions {
  rootDir: string;
  retentionDays?: number;
  maxFileBytes?: number;
  now?: () => Date;
}

export interface DiagnosticsLogService {
  write: (entry: DiagnosticsLogEntryInput) => Promise<DiagnosticsLogEntry>;
  query: (query?: DiagnosticsLogQuery) => Promise<DiagnosticsLogQueryResult>;
  getInfo: () => Promise<DiagnosticsLogInfo>;
  exportBundle: () => Promise<DiagnosticsLogExportResult>;
  clear: () => Promise<DiagnosticsLogClearResult>;
  getDirectory: () => string;
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDiagnosticsFile(name: string) {
  return /^diagnostics-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(name);
}

async function listDiagnosticsFiles(rootDir: string) {
  ensureDir(rootDir);
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const files: DiagnosticsLogInfo["files"] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isDiagnosticsFile(entry.name)) continue;
    const filePath = path.join(rootDir, entry.name);
    const stat = await fs.promises.stat(filePath);
    files.push({
      name: entry.name,
      path: filePath,
      size: stat.size,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function parseLine(line: string): DiagnosticsLogEntry | null {
  try {
    const parsed = JSON.parse(line) as DiagnosticsLogEntry;
    if (!parsed.timestamp || !parsed.level || !parsed.category || !parsed.message) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildEntry(input: DiagnosticsLogEntryInput, now: Date): DiagnosticsLogEntry {
  return {
    timestamp: now.toISOString(),
    level: input.level ?? "info",
    category: input.category,
    operationId: input.operationId,
    requestId: input.requestId,
    message: input.message,
    context: input.context ? sanitizeDiagnosticsData(input.context) as Record<string, unknown> : undefined,
    durationMs: input.durationMs,
    error: input.error ? sanitizeDiagnosticsError(input.error) : undefined,
  };
}

function matchesQuery(entry: DiagnosticsLogEntry, query: DiagnosticsLogQuery) {
  if (query.since && entry.timestamp < query.since) return false;
  if (query.until && entry.timestamp > query.until) return false;
  if (query.level && entry.level !== query.level) return false;
  if (query.minLevel && LEVEL_SCORE[entry.level] < LEVEL_SCORE[query.minLevel]) return false;
  if (query.categories?.length && !query.categories.includes(entry.category)) return false;
  if (query.operationId && entry.operationId !== query.operationId) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  return true;
}

export function createDiagnosticsLogService(options: DiagnosticsLogServiceOptions): DiagnosticsLogService {
  const rootDir = options.rootDir;
  const retentionDays = options.retentionDays ?? 30;
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  const now = options.now ?? (() => new Date());

  async function cleanupOldFiles(referenceDate: Date) {
    const cutoff = referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await listDiagnosticsFiles(rootDir);
    await Promise.all(files.map(async (file) => {
      const match = file.name.match(/^diagnostics-(\d{4}-\d{2}-\d{2})/);
      const fileTime = match ? new Date(`${match[1]}T00:00:00.000Z`).getTime() : 0;
      if (fileTime && fileTime < cutoff) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }
    }));
  }

  async function resolveWritePath(date: Date) {
    ensureDir(rootDir);
    const day = formatDay(date);
    let filePath = path.join(rootDir, `diagnostics-${day}.jsonl`);
    if (!fs.existsSync(filePath)) return filePath;
    const stat = await fs.promises.stat(filePath);
    if (stat.size < maxFileBytes) return filePath;
    for (let index = 1; index < 1000; index += 1) {
      filePath = path.join(rootDir, `diagnostics-${day}-${index}.jsonl`);
      if (!fs.existsSync(filePath)) return filePath;
      const rotatedStat = await fs.promises.stat(filePath);
      if (rotatedStat.size < maxFileBytes) return filePath;
    }
    return filePath;
  }

  return {
    async write(input) {
      const current = now();
      await cleanupOldFiles(current);
      const entry = buildEntry(input, current);
      const filePath = await resolveWritePath(current);
      await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
      return entry;
    },

    async query(query = {}) {
      const files = await listDiagnosticsFiles(rootDir);
      const entries: DiagnosticsLogEntry[] = [];
      for (const file of files) {
        const raw = await fs.promises.readFile(file.path, "utf8").catch(() => "");
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const entry = parseLine(line);
          if (entry && matchesQuery(entry, query)) entries.push(entry);
        }
      }
      entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const limit = query.limit ?? 500;
      return {
        entries: entries.slice(Math.max(0, entries.length - limit)),
        total: entries.length,
      };
    },

    async getInfo() {
      const files = await listDiagnosticsFiles(rootDir);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const since = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString();
      const recent = await this.query({ since, minLevel: "warn", limit: 10_000 });
      return {
        directory: rootDir,
        totalBytes,
        fileCount: files.length,
        recentWarnCount: recent.entries.filter((entry) => entry.level === "warn").length,
        recentErrorCount: recent.entries.filter((entry) => entry.level === "error").length,
        retentionDays,
        files,
      };
    },

    async exportBundle() {
      try {
        ensureDir(rootDir);
        const current = now();
        const filePath = path.join(rootDir, `diagnostics-bundle-${formatDay(current)}-${current.getTime()}.json`);
        const info = await this.getInfo();
        const entries = await this.query({ limit: 50_000 });
        await fs.promises.writeFile(filePath, JSON.stringify({ exportedAt: current.toISOString(), info, entries: entries.entries }, null, 2), "utf8");
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    },

    async clear() {
      try {
        const files = await listDiagnosticsFiles(rootDir);
        let removedFiles = 0;
        for (const file of files) {
          await fs.promises.unlink(file.path).catch(() => undefined);
          removedFiles += 1;
        }
        return { success: true, removedFiles };
      } catch (error) {
        return { success: false, removedFiles: 0, error: getErrorMessage(error) };
      }
    },

    getDirectory() {
      ensureDir(rootDir);
      return rootDir;
    },
  };
}
