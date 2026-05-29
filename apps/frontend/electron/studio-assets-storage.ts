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

const execFileAsync = promisify(execFile);

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

/** 获取缩略图路径，不存在则异步生成 */
function getThumbUrl(filePath: string | undefined, type: string): string | undefined {
  if (!filePath) return undefined;
  const thumbPath = path.join(getThumbsDir(), filePath);
  if (fs.existsSync(thumbPath)) return `file://${thumbPath}`;
  // 异步生成缩略图（不阻塞返回）
  const srcPath = path.join(getFilesDir(), filePath);
  if (!fs.existsSync(srcPath)) return undefined;
  const thumbDir = path.dirname(thumbPath);
  fs.mkdirSync(thumbDir, { recursive: true });
  execFile("sips", ["-z", "200", "200", srcPath, "--out", thumbPath], () => {});
  // 首次返回原图 URL，下次就有缩略图了
  return `file://${srcPath}`;
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
  execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024 });
}

async function runSqliteJson<T>(dbPath: string, query: string): Promise<T> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, query], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [] as T;
  return JSON.parse(trimmed) as T;
}

function runSqliteExec(dbPath: string, sql: string) {
  execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024 });
}

function escapeSql(value: string): string {
  // 转义单引号，并将换行替换为 char(10) 拼接方式不可行，
  // 所以用 replace 保留换行（sqlite3 stdin 模式支持多行字符串）
  return value.replace(/'/g, "''");
}

/** 执行可能包含长文本的 SQL */
function runSqliteExecSafe(dbPath: string, sql: string) {
  const { execFileSync } = require("node:child_process");
  execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

function runSqliteJsonSync<T>(dbPath: string, query: string): T {
  const stdout = execFileSync("sqlite3", ["-json", dbPath, query], { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
  if (!stdout) return [] as T;
  return JSON.parse(stdout) as T;
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

export async function listAssets(type: StudioAssetKind, search?: string, offset = 0, limit = 60): Promise<{ items: StudioAssetSummary[]; total: number }> {
  const dbPath = getDbPath();
  const where = search
    ? `WHERE type='${escapeSql(type)}' AND (name LIKE '%${escapeSql(search)}%' OR prompt LIKE '%${escapeSql(search)}%')`
    : `WHERE type='${escapeSql(type)}'`;

  const countResult = await runSqliteJson<{ cnt: number }[]>(dbPath, `SELECT count(*) as cnt FROM assets ${where};`);
  const total = countResult[0]?.cnt ?? 0;

  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT id, type, name, filePath FROM assets ${where} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset};`
  );

  const items: StudioAssetSummary[] = rows.map((row) => {
    const absPath = row.filePath ? path.join(getFilesDir(), row.filePath) : undefined;
    const previewUrl = absPath ? `file://${absPath}` : undefined;
    return {
      id: row.id,
      source: "manying-local" as const,
      type: row.type,
      name: row.name,
      thumbnailUrl: getThumbUrl(row.filePath, row.type),
      previewUrl,
      filePath: row.filePath,
      sourcePath: absPath,
      state: "success",
    };
  });

  return { items, total };
}

export async function getAsset(id: string): Promise<StudioAssetSummary | null> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`
  );
  if (!rows.length) return null;
  return rowToSummary(rows[0]);
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
  const id = randomUUID();
  let filePath = "";

  if (input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
    const ext = path.extname(input.sourceFilePath);
    const destName = `${id}${ext}`;
    const destPath = path.join(getFilesDir(), input.type, destName);
    fs.copyFileSync(input.sourceFilePath, destPath);
    filePath = `${input.type}/${destName}`;
  }

  const now = new Date().toISOString();
  const tags = JSON.stringify(input.tags || []);
  runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(input.type)}','${escapeSql(input.name || "")}','${escapeSql(input.description || "")}','${escapeSql(input.prompt || "")}','${escapeSql(input.setting || "")}','${escapeSql(input.remark || "")}','${escapeSql(tags)}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);

  const absPath = filePath ? path.join(getFilesDir(), filePath) : undefined;
  return {
    id,
    source: "manying-local",
    type: input.type,
    name: input.name,
    thumbnailUrl: absPath ? `file://${absPath}` : undefined,
    previewUrl: absPath ? `file://${absPath}` : undefined,
    filePath,
    sourcePath: absPath,
    state: "success",
  };
}

export function deleteAsset(id: string): boolean {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT filePath, images FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  if (!rows.length) return false;

  const row = rows[0];
  if (row.filePath) {
    const fullPath = path.join(getFilesDir(), row.filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = path.join(getThumbsDir(), row.filePath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  try {
    const images = JSON.parse(row.images || "[]");
    for (const img of images) {
      const imgPath = path.join(getFilesDir(), img.filePath);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  } catch {}

  const { execFileSync } = require("node:child_process");
  execFileSync("sqlite3", [dbPath, `DELETE FROM assets WHERE id='${escapeSql(id)}';`], { maxBuffer: 1024 * 1024 });
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
  if (asset.filePath) {
    const oldPath = path.join(getFilesDir(), asset.filePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    const oldThumb = path.join(getThumbsDir(), asset.filePath);
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);
  }
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
  const { execFileSync } = require("node:child_process");
  execFileSync("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(imagesJson)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });

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

  const fullPath = path.join(getFilesDir(), imageFilePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  images.splice(idx, 1);

  const now = new Date().toISOString();
  const { execFileSync: _exec } = require("node:child_process"); _exec("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });
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
  const { execFileSync: _exec } = require("node:child_process"); _exec("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });
  return getAssetSync(assetId);
}

// === 从 Toonflow 导入 ===

export function importFromToonflow(toonflowItems: StudioAssetSummary[]): number {
  const dbPath = getDbPath();
  let imported = 0;
  const now = new Date().toISOString();

  for (const item of toonflowItems) {
    // 检查是否已存在
    const existing = runSqliteJsonSync<any[]>(dbPath, `SELECT id FROM assets WHERE type='${escapeSql(item.type)}' AND name='${escapeSql(item.name)}' LIMIT 1;`);
    if (existing.length) continue;

    const id = randomUUID();
    let filePath = "";
    const sourceFile = item.sourcePath;
    if (sourceFile && fs.existsSync(sourceFile)) {
      const ext = path.extname(sourceFile);
      const destName = `${id}${ext}`;
      const destDir = path.join(getFilesDir(), item.type);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(sourceFile, path.join(destDir, destName));
      filePath = `${item.type}/${destName}`;
    }

    runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(item.type)}','${escapeSql(item.name || "")}','${escapeSql(item.description || "")}','${escapeSql(item.prompt || "")}','${escapeSql(item.setting || "")}','${escapeSql(item.remark || "")}','${escapeSql(JSON.stringify(item.tags || []))}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);
    imported++;
  }
  return imported;
}

// === 辅助 ===

function getAssetSync(id: string): StudioAssetSummary | null {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}

function rowToSummary(row: any): StudioAssetSummary {
  const absPath = row.filePath ? path.join(getFilesDir(), row.filePath) : undefined;
  const previewUrl = absPath ? `file://${absPath}` : undefined;
  let images: AssetImage[] | undefined;
  try {
    const parsed = JSON.parse(row.images || "[]");
    if (parsed.length) {
      images = parsed.map((img: any) => ({
        name: img.name,
        filePath: img.filePath,
        url: `file://${path.join(getFilesDir(), img.filePath)}`,
      }));
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
    thumbnailUrl: previewUrl,
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
