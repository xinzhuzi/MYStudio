import fs from "node:fs";
import path from "node:path";
import type { AssetImage, StudioAssetSummary } from "../../types/studio-assets";
import { createAssetFileUrl } from "./storage-paths";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

/**
 * 资产库 sqlite 运行器族——init/路径族/exec-json 运行器/锁重试/escape/where 构建器/JSON 迁移/行映射。file-size-reduction zustand 专批拆出,体逐字保留。
 */
const execFileAsync = promisify(execFile);
const SQLITE_BUSY_TIMEOUT_MS = 5000;
const SQLITE_LOCK_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000];

export interface SqliteCliResolutionOptions {
  platform?: NodeJS.Platform;
  /** 打包应用的 resources 目录;未打包/node 环境下为 undefined */
  resourcesPath?: string;
  fileExists?: (filePath: string) => boolean;
}

/**
 * 解析资产库 SQLite CLI 可执行文件。
 * Windows 没有系统 sqlite3 命令(CI 的 ubuntu runner 与 macOS 自带,掩盖了该缺口),
 * 因此 Windows 安装包内捆绑 sqlite3.exe(extraResources:<resources>/sqlite3/),
 * 运行时优先使用;其余平台/开发模式回退 PATH 上的 sqlite3。
 * 参数可注入以便单测。
 */
export function resolveSqliteCli(options: SqliteCliResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const fileExists = options.fileExists ?? fs.existsSync;
  if (platform === "win32" && typeof resourcesPath === "string" && resourcesPath.length > 0) {
    const bundled = path.join(resourcesPath, "sqlite3", "sqlite3.exe");
    if (fileExists(bundled)) {
      return bundled;
    }
  }
  return "sqlite3";
}

/** 每次解析(含一次 existsSync,开销可忽略),避免模块级缓存与测试相互干扰。 */
function sqliteCliExecutable(): string {
  return resolveSqliteCli();
}

export interface StoredAssetImage {
  name: string;
  filePath: string;
}

interface AssetDbRow {
  id: string;
  type: StudioAssetSummary["type"];
  name: string;
  description?: string;
  prompt?: string;
  setting?: string;
  remark?: string;
  tags?: string;
  filePath?: string;
  images?: string;
}

let basePath: string = "";

export function initAssetsStorage(storageBasePath: string) {
  basePath = storageBasePath;
  const assetsDir = getAssetsDir();
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "role"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "scene"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "tool"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "clip"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "audio"), { recursive: true });
  ensureDb();
}

export function getAssetsDir() {
  return path.join(basePath, "assets");
}

export function getDbPath() {
  return path.join(getAssetsDir(), "assets.db");
}

export function getFilesDir() {
  return path.join(getAssetsDir(), "files");
}

export function getThumbsDir() {
  return path.join(getAssetsDir(), "thumbs");
}

export function resolveAssetManagedPath(root: string, relativePath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelativePath || normalizedRelativePath.includes("\0") || normalizedRelativePath.split("/").includes("..")) {
    throw new Error("Asset path escapes managed root");
  }
  const targetPath = path.resolve(normalizedRoot, normalizedRelativePath);
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Asset path escapes managed root");
  }
  return targetPath;
}

export function shouldCreateAssetThumbnail(type: string) {
  return type !== "audio" && type !== "clip";
}

/** 缩略图生成队列：限制并发，避免一次性 spawn 数千个 sips 进程导致主进程卡死 */
let thumbActive = 0;
const thumbQueue: Array<() => void> = [];
const thumbQueued = new Set<string>();
function pumpThumbQueue() {
  while (thumbActive < 4 && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    thumbActive++;
    job();
  }
}
function enqueueThumb(srcPath: string, thumbPath: string) {
  if (thumbQueued.has(thumbPath)) return;
  thumbQueued.add(thumbPath);
  thumbQueue.push(() => {
    execFile("sips", ["-z", "200", "200", srcPath, "--out", thumbPath], () => {
      thumbActive--;
      thumbQueued.delete(thumbPath);
      pumpThumbQueue();
    });
  });
  pumpThumbQueue();
}

/** 获取缩略图路径，不存在则异步生成 */
export function getThumbUrl(filePath: string | undefined, type: string): string | undefined {
  if (!filePath) return undefined;
  if (!shouldCreateAssetThumbnail(type)) {
    const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
    return fs.existsSync(srcPath) ? createAssetFileUrl(filePath) : undefined;
  }
  const thumbPath = resolveAssetManagedPath(getThumbsDir(), filePath);
  if (fs.existsSync(thumbPath)) return createAssetFileUrl(filePath, { thumb: true });
  // 异步生成缩略图（限流，不阻塞返回）
  const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
  if (!fs.existsSync(srcPath)) return undefined;
  const thumbDir = path.dirname(thumbPath);
  fs.mkdirSync(thumbDir, { recursive: true });
  enqueueThumb(srcPath, thumbPath);
  // 首次返回原图 URL，下次就有缩略图了
  return createAssetFileUrl(filePath);
}

export function resolveManagedAssetPathOrUndefined(relativePath: string | undefined) {
  if (!relativePath) return undefined;
  try {
    return resolveAssetManagedPath(getFilesDir(), relativePath);
  } catch {
    return undefined;
  }
}

// === SQLite helpers ===

export function ensureDb() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) return;
  // 创建表
  const schema = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  setting TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  filePath TEXT,
  images TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manying-local',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
`;
  runSqliteSync(dbPath, schema);

  // 如果旧 db.json 存在，自动迁移
  const jsonPath = path.join(getAssetsDir(), "db.json");
  if (fs.existsSync(jsonPath)) {
    migrateFromJson(jsonPath, dbPath);
  }
}

export function runSqliteSync(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

export async function runSqliteJson<T>(dbPath: string, query: string): Promise<T> {
  const { stdout } = await runSqliteJsonProcess(dbPath, query);
  const trimmed = stdout.trim();
  if (!trimmed) return [] as T;
  return JSON.parse(trimmed) as T;
}

export function runSqliteExec(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
export function escapeSqlLike(value: string): string {
  return escapeSql(value).replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** 构建 assets 查询的 WHERE 子句（按类型/搜索/分类标签过滤）。导出以便单测。 */
export function buildAssetWhere(type: string, search?: string, category?: string): string {
  const conds = [`type='${escapeSql(type)}'`];
  if (search) conds.push(`(name LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\' OR prompt LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\')`);
  if (category) conds.push(`tags LIKE '%"${escapeSql(category)}"%'`);
  return `WHERE ${conds.join(" AND ")}`;
}

export function buildAssetNameCandidateCondition(name: string): string {
  const exact = escapeSql(name);
  const like = escapeSqlLike(name);
  return `(name='${exact}' OR name LIKE '%${like}%' ESCAPE '\\' OR remark LIKE '%${like}%' ESCAPE '\\')`;
}

/** 执行可能包含长文本的 SQL */
export function runSqliteExecSafe(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

export function runSqliteJsonSync<T>(dbPath: string, query: string): T {
  const stdout = runSqliteSyncProcess(["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
    maxBuffer: 10 * 1024 * 1024,
  }).toString().trim();
  if (!stdout) return [] as T;
  return JSON.parse(stdout) as T;
}

export function runSqliteInput(dbPath: string, sql: string, options: { maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  return runSqliteSyncProcess([dbPath], {
    ...options,
    input: `.timeout ${SQLITE_BUSY_TIMEOUT_MS}\n${sql}`,
  });
}

export function runSqliteSyncProcess(args: string[], options: { input?: string; maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return execFileSync(sqliteCliExecutable(), args, options);
    } catch (error) {
      lastError = error;
      if (!isSqliteLockedError(error) || attempt === SQLITE_LOCK_RETRY_DELAYS_MS.length) break;
      sleepSync(SQLITE_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function runSqliteJsonProcess(dbPath: string, query: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await execFileAsync(sqliteCliExecutable(), ["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error) {
      lastError = error;
      if (!isSqliteLockedError(error) || attempt === SQLITE_LOCK_RETRY_DELAYS_MS.length) break;
      await sleep(SQLITE_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export function isSqliteLockedError(error: unknown) {
  const err = error as { message?: string; stderr?: Buffer | string };
  const text = `${err?.message || ""}\n${Buffer.isBuffer(err?.stderr) ? err.stderr.toString() : err?.stderr || ""}`;
  return /database is locked|SQLITE_BUSY|locked \(5\)/i.test(text);
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function migrateFromJson(jsonPath: string, dbPath: string) {
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    const assets = data.assets || [];
    if (!assets.length) return;

    // 批量插入
    const batchSize = 200;
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values = batch.map((a: any) => {
        const id = a.id || randomUUID();
        const tags = JSON.stringify(a.tags || []);
        const images = JSON.stringify(a.images || []);
        const now = a.createdAt || new Date().toISOString();
        return `('${escapeSql(id)}','${escapeSql(a.type || "")}','${escapeSql(a.name || "")}','${escapeSql(a.description || "")}','${escapeSql(a.prompt || "")}','${escapeSql(a.setting || "")}','${escapeSql(a.remark || "")}','${escapeSql(tags)}','${escapeSql(a.filePath || "")}','${escapeSql(images)}','${escapeSql(a.source || "manying-local")}','${escapeSql(now)}','${escapeSql(now)}')`;
      }).join(",\n");
      const sql = `INSERT OR IGNORE INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES\n${values};`;
      runSqliteExec(dbPath, sql);
    }

    // 迁移完成后重命名旧文件
    fs.renameSync(jsonPath, jsonPath + ".migrated");
  } catch (e) {
    console.error("migrateFromJson failed:", e);
  }
}

// === CRUD ===


export function rowToSummary(row: AssetDbRow): StudioAssetSummary {
  const absPath = resolveManagedAssetPathOrUndefined(row.filePath);
  const previewUrl = absPath ? createAssetFileUrl(row.filePath!) : undefined;
  let images: AssetImage[] | undefined;
  try {
    const parsed = JSON.parse(row.images || "[]");
    if (parsed.length) {
      images = parsed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((img: any) => {
          const imagePath = resolveManagedAssetPathOrUndefined(img.filePath);
          if (!imagePath) return null;
          return {
            name: img.name,
            filePath: img.filePath,
            url: createAssetFileUrl(img.filePath),
          };
        })
        .filter((img: AssetImage | null): img is AssetImage => Boolean(img));
    }
  } catch {}

  return {
    id: row.id,
    source: "manying-local",
    type: row.type,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    setting: row.setting,
    remark: row.remark,
    tags: (() => { try { return JSON.parse(row.tags || "[]"); } catch { return []; } })(),
    thumbnailUrl: absPath ? getThumbUrl(row.filePath, row.type) : undefined,
    previewUrl,
    filePath: row.filePath,
    sourcePath: absPath,
    state: "success",
    images,
  };
}

/** 清除缓存（用于测试或热重载） */
