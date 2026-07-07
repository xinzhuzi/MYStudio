/**
 * 漫影工作室独立资产存储 (SQLite 版)
 * 存储结构：{storageBasePath}/assets/assets.db + assets/files/{type}/
 */
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { AssetImage, StudioAssetKind, StudioAssetSummary } from "../types/studio-assets";
import { assetNameMatchesQuery } from "../lib/studio/asset-names";

const execFileAsync = promisify(execFile);
const SQLITE_BUSY_TIMEOUT_MS = 5000;
const SQLITE_LOCK_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000];

export interface StoredAssetImage {
  name: string;
  filePath: string;
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

function getAssetsDir() {
  return path.join(basePath, "assets");
}

function getDbPath() {
  return path.join(getAssetsDir(), "assets.db");
}

function getFilesDir() {
  return path.join(getAssetsDir(), "files");
}

function getThumbsDir() {
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
function getThumbUrl(filePath: string | undefined, type: string): string | undefined {
  if (!filePath) return undefined;
  if (!shouldCreateAssetThumbnail(type)) {
    const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
    return fs.existsSync(srcPath) ? `file://${srcPath}` : undefined;
  }
  const thumbPath = resolveAssetManagedPath(getThumbsDir(), filePath);
  if (fs.existsSync(thumbPath)) return `file://${thumbPath}`;
  // 异步生成缩略图（限流，不阻塞返回）
  const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
  if (!fs.existsSync(srcPath)) return undefined;
  const thumbDir = path.dirname(thumbPath);
  fs.mkdirSync(thumbDir, { recursive: true });
  enqueueThumb(srcPath, thumbPath);
  // 首次返回原图 URL，下次就有缩略图了
  return `file://${srcPath}`;
}

function resolveManagedAssetPathOrUndefined(relativePath: string | undefined) {
  if (!relativePath) return undefined;
  try {
    return resolveAssetManagedPath(getFilesDir(), relativePath);
  } catch {
    return undefined;
  }
}

// === SQLite helpers ===

function ensureDb() {
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

function runSqliteSync(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

async function runSqliteJson<T>(dbPath: string, query: string): Promise<T> {
  const { stdout } = await runSqliteJsonProcess(dbPath, query);
  const trimmed = stdout.trim();
  if (!trimmed) return [] as T;
  return JSON.parse(trimmed) as T;
}

function runSqliteExec(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
function escapeSqlLike(value: string): string {
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
function runSqliteExecSafe(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

function runSqliteJsonSync<T>(dbPath: string, query: string): T {
  const stdout = runSqliteSyncProcess(["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
    maxBuffer: 10 * 1024 * 1024,
  }).toString().trim();
  if (!stdout) return [] as T;
  return JSON.parse(stdout) as T;
}

function runSqliteInput(dbPath: string, sql: string, options: { maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  return runSqliteSyncProcess([dbPath], {
    ...options,
    input: `.timeout ${SQLITE_BUSY_TIMEOUT_MS}\n${sql}`,
  });
}

function runSqliteSyncProcess(args: string[], options: { input?: string; maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return execFileSync("sqlite3", args, options);
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
      return await execFileAsync("sqlite3", ["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
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

function isSqliteLockedError(error: unknown) {
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

export async function listAssets(type: StudioAssetKind, search?: string, offset = 0, limit = 60, category?: string): Promise<{ items: StudioAssetSummary[]; total: number }> {
  const dbPath = getDbPath();
  const where = `${buildAssetWhere(type, search, category)} AND (${buildUsableAssetSqlCondition()})`;

  const countResult = await runSqliteJson<{ cnt: number }[]>(dbPath, `SELECT count(*) as cnt FROM assets ${where};`);
  const total = countResult[0]?.cnt ?? 0;

  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT id, type, name, description, filePath, tags FROM assets ${where} ORDER BY rowid ASC LIMIT ${limit} OFFSET ${offset};`
  );

  const items: StudioAssetSummary[] = rows.map((row) => {
    const absPath = resolveManagedAssetPathOrUndefined(row.filePath);
    const previewUrl = absPath ? `file://${absPath}` : undefined;
    let tags: string[] = [];
    try { tags = row.tags ? JSON.parse(row.tags) : []; } catch { tags = []; }
    return {
      id: row.id,
      source: "manying-local" as const,
      type: row.type,
      name: row.name,
      description: row.description,
      tags,
      thumbnailUrl: absPath ? getThumbUrl(row.filePath, row.type) : undefined,
      previewUrl,
      filePath: row.filePath,
      sourcePath: absPath,
      state: "success",
    };
  });

  return { items, total };
}

function buildUsableAssetSqlCondition() {
  return [
    "TRIM(COALESCE(filePath,''))<>''",
    "TRIM(COALESCE(prompt,''))<>''",
    "TRIM(COALESCE(description,''))<>''",
    "TRIM(COALESCE(setting,''))<>''",
    "TRIM(COALESCE(remark,''))<>''",
    "COALESCE(images,'[]')<>'[]'",
  ].join(" OR ");
}

export async function getAsset(id: string): Promise<StudioAssetSummary | null> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`
  );
  if (!rows.length) return null;
  return rowToSummary(rows[0]);
}

export async function getAssetByName(type: StudioAssetKind, name: string): Promise<StudioAssetSummary | null> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT * FROM assets WHERE type='${escapeSql(type)}' AND ${buildAssetNameCandidateCondition(name)} LIMIT 50;`
  );
  const match = pickBestAssetNameMatch(rows, name)
    || pickBestAssetRow(rows.filter((row) => row.remark?.includes(name)));
  return match ? rowToSummary(match) : null;
}

export async function batchMatchAssets(type: StudioAssetKind, names: string[]): Promise<Map<string, StudioAssetSummary>> {
  const dbPath = getDbPath();
  const result = new Map<string, StudioAssetSummary>();
  if (!names.length) return result;

  const conditions = names.map(buildAssetNameCandidateCondition).join(' OR ');
  const query = `SELECT * FROM assets WHERE type='${escapeSql(type)}' AND (${conditions});`;
  const rows = await runSqliteJson<any[]>(dbPath, query);

  for (const name of names) {
    const match = pickBestAssetNameMatch(rows, name)
      || pickBestAssetRow(rows.filter((row) => row.remark?.includes(name)));
    if (match) {
      result.set(name, rowToSummary(match));
    }
  }
  return result;
}

function pickBestAssetNameMatch(rows: any[], name: string) {
  const matches = rows.filter((row) => assetNameMatchesQuery(row.name, name));
  if (!matches.length) return null;
  return pickBestAssetRow(matches);
}

function pickBestAssetRow(rows: any[]) {
  const usableRows = rows.filter(isUsableAssetRow);
  if (!usableRows.length) return null;
  return [...usableRows].sort((a, b) => assetCompletenessScore(b) - assetCompletenessScore(a))[0];
}

function assetCompletenessScore(row: any) {
  return (
    (hasStoredText(row.filePath) ? 100 : 0) +
    (assetImagesCount(row.images) > 0 ? 80 : 0) +
    (hasStoredText(row.prompt) ? 20 : 0) +
    (hasStoredText(row.description) ? 10 : 0) +
    (hasStoredText(row.setting) ? 5 : 0) +
    (hasStoredText(row.remark) ? 1 : 0)
  );
}

function isUsableAssetRow(row: any) {
  return assetCompletenessScore(row) > 0;
}

function hasStoredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assetImagesCount(value: string | undefined) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function updateAsset(id: string, updates: Partial<{ name: string; description: string; prompt: string; setting: string; remark: string; tags: string[] }>): StudioAssetSummary | null {
  const dbPath = getDbPath();
  const sets: string[] = [];
  if (updates.name !== undefined) sets.push(`name='${escapeSql(updates.name)}'`);
  if (updates.description !== undefined) sets.push(`description='${escapeSql(updates.description)}'`);
  if (updates.prompt !== undefined) sets.push(`prompt='${escapeSql(updates.prompt)}'`);
  if (updates.setting !== undefined) sets.push(`setting='${escapeSql(updates.setting)}'`);
  if (updates.remark !== undefined) sets.push(`remark='${escapeSql(updates.remark)}'`);
  if (updates.tags !== undefined) sets.push(`tags='${escapeSql(JSON.stringify(updates.tags))}'`);
  if (!sets.length) return null;
  sets.push(`updatedAt='${new Date().toISOString()}'`);
  runSqliteExecSafe(dbPath, `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(id)}';`);

  // 同步返回
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}

export function addAsset(input: {
  type: StudioAssetKind;
  name: string;
  description?: string;
  prompt?: string;
  setting?: string;
  remark?: string;
  tags?: string[];
  sourceFilePath?: string;
}): StudioAssetSummary {
  const dbPath = getDbPath();
  const now = new Date().toISOString();
  const exactRows = runSqliteJsonSync<any[]>(
    dbPath,
    `SELECT * FROM assets WHERE type='${escapeSql(input.type)}' AND name='${escapeSql(input.name || "")}' ORDER BY rowid ASC LIMIT 20;`,
  );
  if (exactRows.length) {
    const target = pickBestAssetRow(exactRows) ?? exactRows[0];
    backfillAssetFromLocalInput(target, input, now);
    const existing = getAssetSync(target.id);
    if (existing) return existing;
  }

  const id = randomUUID();
  let filePath = "";

  if (input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
    filePath = copyAssetSourceFile(input.type, id, input.sourceFilePath);
  }

  const tags = JSON.stringify(input.tags || []);
  runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(input.type)}','${escapeSql(input.name || "")}','${escapeSql(input.description || "")}','${escapeSql(input.prompt || "")}','${escapeSql(input.setting || "")}','${escapeSql(input.remark || "")}','${escapeSql(tags)}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);

  return getAssetSync(id)!;
}

export function deleteAsset(id: string): boolean {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT filePath, images FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  if (!rows.length) return false;

  const row = rows[0];
  if (row.filePath) {
    const fullPath = resolveAssetManagedPath(getFilesDir(), row.filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = resolveAssetManagedPath(getThumbsDir(), row.filePath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  try {
    const images = JSON.parse(row.images || "[]");
    for (const img of images) {
      const imgPath = resolveAssetManagedPath(getFilesDir(), img.filePath);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  } catch {}

  runSqliteExecSafe(dbPath, `DELETE FROM assets WHERE id='${escapeSql(id)}';`);
  return true;
}

// === 多图管理 ===

/** 更换素材主图 */
export function replaceAssetMainImage(assetId: string, sourceFilePath: string): StudioAssetSummary | null {
  if (!fs.existsSync(sourceFilePath)) return null;
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;
  const asset = rows[0];
  const ext = path.extname(sourceFilePath);
  const safeName = `${asset.name}`.replace(/[/\\:*?"<>|]/g, "_");
  const destName = `${safeName}_${Date.now()}${ext}`;
  const destPath = path.join(getFilesDir(), asset.type, destName);
  fs.copyFileSync(sourceFilePath, destPath);
  const newFilePath = `${asset.type}/${destName}`;
  const thumbDir = path.join(getThumbsDir(), asset.type);
  fs.mkdirSync(thumbDir, { recursive: true });
  execFile("sips", ["-z", "200", "200", destPath, "--out", path.join(thumbDir, destName)], () => {});
  const now = new Date().toISOString();
  runSqliteExecSafe(dbPath, `UPDATE assets SET filePath='${escapeSql(newFilePath)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);
  if (asset.filePath) {
    const oldPath = resolveAssetManagedPath(getFilesDir(), asset.filePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    const oldThumb = resolveAssetManagedPath(getThumbsDir(), asset.filePath);
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);
  }
  return getAssetSync(assetId);
}

export function addAssetImage(assetId: string, imageName: string, sourceFilePath: string): StudioAssetSummary | null {
  if (!fs.existsSync(sourceFilePath)) return null;
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;

  const asset = rows[0];
  const ext = path.extname(sourceFilePath);
  const safeName = `${asset.name}_${imageName}`.replace(/[/\\:*?"<>|]/g, "_");
  let destName = `${safeName}${ext}`;
  let destPath = path.join(getFilesDir(), asset.type, destName);
  if (fs.existsSync(destPath)) {
    destName = `${safeName}_${Date.now()}${ext}`;
    destPath = path.join(getFilesDir(), asset.type, destName);
  }
  fs.copyFileSync(sourceFilePath, destPath);

  const relPath = `${asset.type}/${destName}`;
  const images = JSON.parse(asset.images || "[]");
  images.push({ name: imageName, filePath: relPath });
  const now = new Date().toISOString();
  const imagesJson = JSON.stringify(images);
  runSqliteExecSafe(dbPath, `UPDATE assets SET images='${escapeSql(imagesJson)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);

  return getAssetSync(assetId);
}

export function removeAssetImage(assetId: string, imageFilePath: string): StudioAssetSummary | null {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;

  const asset = rows[0];
  const images: StoredAssetImage[] = JSON.parse(asset.images || "[]");
  const idx = images.findIndex((img) => img.filePath === imageFilePath);
  if (idx === -1) return null;

  const fullPath = resolveAssetManagedPath(getFilesDir(), imageFilePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  images.splice(idx, 1);

  const now = new Date().toISOString();
  runSqliteExecSafe(dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);
  return getAssetSync(assetId);
}

export function renameAssetImage(assetId: string, imageFilePath: string, newName: string): StudioAssetSummary | null {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;

  const asset = rows[0];
  const images: StoredAssetImage[] = JSON.parse(asset.images || "[]");
  const img = images.find((i) => i.filePath === imageFilePath);
  if (!img) return null;
  img.name = newName;

  const now = new Date().toISOString();
  runSqliteExecSafe(dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);
  return getAssetSync(assetId);
}

// === 从 Toonflow 导入 ===

export function importFromToonflow(toonflowItems: StudioAssetSummary[]): number {
  const dbPath = getDbPath();
  let changed = 0;
  const now = new Date().toISOString();

  for (const item of toonflowItems) {
    const existing = runSqliteJsonSync<any[]>(
      dbPath,
      `SELECT * FROM assets WHERE type='${escapeSql(item.type)}' AND name='${escapeSql(item.name)}' LIMIT 1;`,
    );
    if (existing.length) {
      if (backfillAssetFromToonflow(existing[0], item, now)) changed++;
      continue;
    }

    const id = randomUUID();
    let filePath = "";
    const sourceFile = item.sourcePath;
    if (sourceFile && fs.existsSync(sourceFile)) {
      filePath = copyAssetSourceFile(item.type, id, sourceFile);
    }

    runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(item.type)}','${escapeSql(item.name || "")}','${escapeSql(item.description || "")}','${escapeSql(item.prompt || "")}','${escapeSql(item.setting || "")}','${escapeSql(item.remark || "")}','${escapeSql(JSON.stringify(item.tags || []))}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);
    changed++;
  }
  return changed;
}

function backfillAssetFromToonflow(row: any, item: StudioAssetSummary, now: string) {
  const sets: string[] = [];

  if (!hasStoredText(row.description) && hasStoredText(item.description)) {
    sets.push(`description='${escapeSql(item.description)}'`);
  }
  if (!hasStoredText(row.prompt) && hasStoredText(item.prompt)) {
    sets.push(`prompt='${escapeSql(item.prompt)}'`);
  }
  if (!hasStoredText(row.setting) && hasStoredText(item.setting)) {
    sets.push(`setting='${escapeSql(item.setting)}'`);
  }
  if (!hasStoredText(row.remark) && hasStoredText(item.remark)) {
    sets.push(`remark='${escapeSql(item.remark)}'`);
  }
  if (assetTagsCount(row.tags) === 0 && item.tags?.length) {
    sets.push(`tags='${escapeSql(JSON.stringify(item.tags))}'`);
  }
  if (!hasStoredText(row.filePath) && item.sourcePath && fs.existsSync(item.sourcePath)) {
    const filePath = copyAssetSourceFile(row.type, row.id, item.sourcePath);
    sets.push(`filePath='${escapeSql(filePath)}'`);
  }

  if (!sets.length) return false;
  sets.push(`updatedAt='${now}'`);
  runSqliteExecSafe(getDbPath(), `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(row.id)}';`);
  return true;
}

function backfillAssetFromLocalInput(
  row: any,
  input: {
    type: StudioAssetKind;
    name: string;
    description?: string;
    prompt?: string;
    setting?: string;
    remark?: string;
    tags?: string[];
    sourceFilePath?: string;
  },
  now: string,
) {
  const sets: string[] = [];

  if (!hasStoredText(row.description) && hasStoredText(input.description)) {
    sets.push(`description='${escapeSql(input.description)}'`);
  }
  if (!hasStoredText(row.prompt) && hasStoredText(input.prompt)) {
    sets.push(`prompt='${escapeSql(input.prompt)}'`);
  }
  if (!hasStoredText(row.setting) && hasStoredText(input.setting)) {
    sets.push(`setting='${escapeSql(input.setting)}'`);
  }
  if (!hasStoredText(row.remark) && hasStoredText(input.remark)) {
    sets.push(`remark='${escapeSql(input.remark)}'`);
  }
  if (assetTagsCount(row.tags) === 0 && input.tags?.length) {
    sets.push(`tags='${escapeSql(JSON.stringify(input.tags))}'`);
  }
  if (!hasStoredText(row.filePath) && input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
    const filePath = copyAssetSourceFile(row.type, row.id, input.sourceFilePath);
    sets.push(`filePath='${escapeSql(filePath)}'`);
  }

  if (!sets.length) return false;
  sets.push(`updatedAt='${now}'`);
  runSqliteExecSafe(getDbPath(), `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(row.id)}';`);
  return true;
}

function copyAssetSourceFile(type: StudioAssetKind, id: string, sourceFile: string) {
  const ext = path.extname(sourceFile);
  const destDir = path.join(getFilesDir(), type);
  fs.mkdirSync(destDir, { recursive: true });
  let destName = `${id}${ext}`;
  let destPath = path.join(destDir, destName);
  if (fs.existsSync(destPath)) {
    destName = `${id}_${Date.now()}${ext}`;
    destPath = path.join(destDir, destName);
  }
  fs.copyFileSync(sourceFile, destPath);
  return `${type}/${destName}`;
}

function assetTagsCount(value: string | undefined) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// === 辅助 ===

function getAssetSync(id: string): StudioAssetSummary | null {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}

function rowToSummary(row: any): StudioAssetSummary {
  const absPath = resolveManagedAssetPathOrUndefined(row.filePath);
  const previewUrl = absPath ? `file://${absPath}` : undefined;
  let images: AssetImage[] | undefined;
  try {
    const parsed = JSON.parse(row.images || "[]");
    if (parsed.length) {
      images = parsed
        .map((img: any) => {
          const imagePath = resolveManagedAssetPathOrUndefined(img.filePath);
          if (!imagePath) return null;
          return {
            name: img.name,
            filePath: img.filePath,
            url: `file://${imagePath}`,
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
export function resetAssetsCache() {
  // no-op for SQLite version
}
