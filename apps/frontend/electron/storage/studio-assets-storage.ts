import { execFile } from "node:child_process";
import {
  getDbPath, getFilesDir, runSqliteExecSafe,
  escapeSql,
} from "./assets-sqlite";
import { getAssetSync } from "./assets-queries";
import { rowToSummary, runSqliteJsonSync, getThumbsDir } from "./assets-sqlite";
import { pickBestAssetRow, hasStoredText } from "./assets-queries";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StudioAssetKind, StudioAssetSummary } from "../../types/studio-assets";
import { StoredAssetImage, resolveAssetManagedPath } from "./assets-sqlite";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (input.type === "audio") {
    try {
      if (!input.sourceFilePath || !fs.statSync(input.sourceFilePath).isFile()) {
        throw new Error("invalid audio source");
      }
    } catch {
      throw new Error("音频文件不存在或无法读取");
    }
  }

  const dbPath = getDbPath();
  const now = new Date().toISOString();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** 资产主图 dataURL(分镜参考图挂载等渲染层消费;无图/解析失败返回 null)。 */


export { StoredAssetImage, buildAssetNameCandidateCondition, buildAssetWhere, initAssetsStorage, resolveAssetManagedPath, rowToSummary, shouldCreateAssetThumbnail } from "./assets-sqlite";
export { batchMatchAssets, getAsset, getAssetByName, listAssets, readAssetImageDataUrl, resetAssetsCache } from "./assets-queries";
