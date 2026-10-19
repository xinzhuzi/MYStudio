import { execFile } from "node:child_process";
import {
  getDbPath, getFilesDir, runSqliteExecSafe,
  assetDisplayName, assetFamilyFolderKey, escapeSql, usesAssetNameFolder,
} from "./assets-sqlite";
import { getAssetSync } from "./assets-queries";
import { rowToSummary, runSqliteJsonSync, getThumbsDir, getAssetsDir } from "./assets-sqlite";
import { pickBestAssetRow, hasStoredText } from "./assets-queries";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StudioAssetKind, StudioAssetSummary } from "../../types/studio-assets";
import { StoredAssetImage, resolveAssetManagedPath } from "./assets-sqlite";
import {
  rewriteAssetRefsInStoreTree,
  type AssetFileRefMapping,
} from "./asset-name-folder-migration";

/**
 * R5 改名联动(design §4):type∈三类 且新旧安全名不同 → 本行引用的全部文件
 * (filePath 与 images[] 元素)逐文件挪入新名夹(files+thumbs 双树;非整夹 rename,
 * 同名兄弟天然隔离);挪动映射并入既有 sets 单条 UPDATE;持久化 asset-file://
 * 引用按映射定向改写(只扫 image-workflows 分片,manifest 在场索引)。
 * 文件缺失不阻断(仅 console.warn);目标在场(异源件)不覆盖,DB 该文件保持旧路径。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function planRenameFolderMove(row: any, newFolder: string): {
  mapping: AssetFileRefMapping;
  filePath?: string;
  imagesJson?: string;
  executedMoves: Array<[string, string]>;
} {
  const executedMoves: Array<[string, string]> = [];
  const type = String(row.type ?? "");
  const mapping: AssetFileRefMapping = new Map();
  const filesDir = getFilesDir();
  const thumbsDir = getThumbsDir();
  const relPaths: string[] = [];
  if (typeof row.filePath === "string" && row.filePath) relPaths.push(row.filePath);
  if (typeof row.images === "string" && row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) {
        for (const img of parsed) {
          if (img && typeof img === "object" && typeof (img as { filePath?: unknown }).filePath === "string") {
            relPaths.push((img as { filePath: string }).filePath);
          }
        }
      }
    } catch {}
  }

  let newFilePath: string | undefined;
  for (const rel of relPaths) {
    if (rel.split("/")[0] !== type) continue; // 域外/异态路径不动
    const fileName = rel.slice(rel.lastIndexOf("/") + 1);
    const targetRel = `${type}/${newFolder}/${fileName}`;
    if (targetRel === rel) continue;
    const src = path.join(filesDir, rel);
    const dst = path.join(filesDir, targetRel);
    const srcIn = fs.existsSync(src);
    const dstIn = fs.existsSync(dst);
    if (srcIn && dstIn) {
      console.warn(`[assets] 改名挪动跳过(目标在场,防覆盖异源件):${rel} → ${targetRel}`);
      continue; // DB 该文件保持旧路径
    }
    if (!srcIn && !dstIn) {
      console.warn(`[assets] 改名挪动:文件缺失不阻断:${rel}`);
    } else if (srcIn) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      executedMoves.push([dst, src]);
    } // srcIn 缺+dstIn 在=上轮已挪(中断续跑),照常改写 DB
    const thumbSrc = path.join(thumbsDir, rel);
    const thumbDst = path.join(thumbsDir, targetRel);
    if (fs.existsSync(thumbSrc) && !fs.existsSync(thumbDst)) {
      fs.mkdirSync(path.dirname(thumbDst), { recursive: true });
      fs.renameSync(thumbSrc, thumbDst);
      executedMoves.push([thumbDst, thumbSrc]);
    }
    mapping.set(rel, targetRel);
    if (rel === row.filePath) newFilePath = targetRel;
  }

  let imagesJson: string | undefined;
  if (typeof row.images === "string" && row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) {
        let changed = false;
        for (const img of parsed) {
          if (img && typeof img === "object" && typeof (img as { filePath?: unknown }).filePath === "string") {
            const target = mapping.get((img as { filePath: string }).filePath);
            if (target) {
              (img as { filePath: string }).filePath = target;
              changed = true;
            }
          }
        }
        if (changed) imagesJson = JSON.stringify(parsed);
      }
    } catch {}
  }
  return { mapping, filePath: newFilePath, imagesJson, executedMoves };
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

  // R5 改名联动:前置读行(旧名/类型/文件清单),挪动映射并入本条 UPDATE
  let renameMapping: AssetFileRefMapping | null = null;
  let renameMoves: Array<[string, string]> | null = null;
  if (updates.name !== undefined) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentRows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
    const current = currentRows[0] ?? null;
    if (current && typeof updates.name === "string" && updates.name !== current.name && usesAssetNameFolder(current.type)) {
      const oldFolder = assetFamilyFolderKey(String(current.name ?? ""));
      const newFolder = assetFamilyFolderKey(updates.name);
      if (oldFolder !== newFolder) {
        const move = planRenameFolderMove(current, newFolder);
        if (move.filePath !== undefined) sets.push(`filePath='${escapeSql(move.filePath)}'`);
        if (move.imagesJson !== undefined) sets.push(`images='${escapeSql(move.imagesJson)}'`);
        renameMapping = move.mapping;
        renameMoves = move.executedMoves;
      }
    }
  }

  sets.push(`updatedAt='${new Date().toISOString()}'`);
  // L1(10-19 修复批):UPDATE 失败回滚已挪文件(双树)再抛——收口「文件先挪/DB 后写」
  // 崩溃窗(此前 UPDATE 抛错后盘新库旧断链无自愈)。
  try {
    runSqliteExecSafe(dbPath, `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(id)}';`);
  } catch (error) {
    for (const [from, to] of [...(renameMoves ?? [])].reverse()) {
      try {
        if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
      } catch { /* 回滚 best-effort */ }
    }
    throw error;
  }

  // F1(10-19 修复批):持久化引用改写面=全 store 树(旧实现只扫 image-workflows
  // 分片,characters.json 缩略/分镜 keyframes 的 asset-file:// 会静默断链)。
  if (renameMapping && renameMapping.size > 0) {
    try {
      const projectRoot = path.resolve(getAssetsDir(), "..", "..");
      rewriteAssetRefsInStoreTree(projectRoot, renameMapping);
    } catch (error) {
      console.warn(`[assets] 改名后持久化引用改写失败(不影响改名结果):${String(error)}`);
    }
  }

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
    filePath = copyAssetSourceFile(input.type, id, input.sourceFilePath, input.name);
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
  const safeName = assetDisplayName(asset.name).replace(/[/\\:*?"<>|]/g, "_");
  const destName = `${safeName}_${Date.now()}${ext}`;
  // R1 名夹层:role/scene/tool 落 files/<type>/<sanitize(name)>/,thumbs 同构;clip/audio 平铺
  const subDir = usesAssetNameFolder(asset.type)
    ? `${asset.type}/${assetFamilyFolderKey(String(asset.name ?? ""))}`
    : asset.type;
  const destPath = path.join(getFilesDir(), subDir, destName);
  // L1 按需 mkdir 补刀(10-19):无图资产的行级夹此前不存在,copyFileSync 直接 ENOENT
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourceFilePath, destPath);
  const newFilePath = `${subDir}/${destName}`;
  // 10-19 用户裁定「必须是并存」:换主图=旧主图收编进 images[] 作历史版本,
  // 永不物理删除(图生图/一键生成/更换主图三路共用此函数,一处改全家受益);
  // 旧主图文件与缩略图留在原位,由 images[] 引用——也根治了「行级指针与 images[]
  // 断链」家族病(replace 只写行级不进 images[] 的旧设计)。
  const prevImages: StoredAssetImage[] = JSON.parse(asset.images || "[]");
  let archivedImages = prevImages;
  if (asset.filePath && !prevImages.some((img) => img.filePath === asset.filePath)) {
    // 10-19 用户追令:废「主图」名号——存档名=原文件名(去扩展名),不再造「·旧主图」
    const oldBase = asset.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || assetDisplayName(asset.name);
    let archiveName = oldBase;
    let suffix = 2;
    while (prevImages.some((img) => img.name === archiveName) || archivedImages.some((img) => img.name === archiveName)) {
      archiveName = `${oldBase}_${suffix}`;
      suffix += 1;
    }
    archivedImages = [...prevImages, { name: archiveName, filePath: asset.filePath }];
  }
  const thumbDir = path.join(getThumbsDir(), subDir);
  fs.mkdirSync(thumbDir, { recursive: true });
  execFile("sips", ["-z", "200", "200", destPath, "--out", path.join(thumbDir, destName)], () => {});
  const now = new Date().toISOString();
  runSqliteExecSafe(
    dbPath,
    `UPDATE assets SET filePath='${escapeSql(newFilePath)}', images='${escapeSql(JSON.stringify(archivedImages))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`,
  );
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
  // 用户令(10-19):多图文件名禁双名前缀——图名已以「资产名_」开头或等于资产名时
  // 不再重复拼接(历史双前缀件=旧缺陷残迹,盘面按 md5 分类另走 orphan 清理)。
  const trimmedImageName = `${imageName}`.trim();
  const displayBase = assetDisplayName(asset.name);
  const joinedName =
    trimmedImageName === asset.name || trimmedImageName.startsWith(`${asset.name}_`)
      ? assetDisplayName(trimmedImageName)
      : `${displayBase}_${trimmedImageName}`;
  const safeName = joinedName.replace(/[/\\:*?"<>|]/g, "_");
  // R1 名夹层:role/scene/tool 落 files/<type>/<sanitize(name)>/;clip/audio 平铺
  const subDir = usesAssetNameFolder(asset.type)
    ? `${asset.type}/${assetFamilyFolderKey(String(asset.name ?? ""))}`
    : asset.type;
  let destName = `${safeName}${ext}`;
  let destPath = path.join(getFilesDir(), subDir, destName);
  if (fs.existsSync(destPath)) {
    destName = `${safeName}_${Date.now()}${ext}`;
    destPath = path.join(getFilesDir(), subDir, destName);
  }
  fs.copyFileSync(sourceFilePath, destPath);

  const relPath = `${subDir}/${destName}`;
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
  // 10-19 缩略图善后:主图被删后行级指针顺位晋 images[0](列表缩略图/预览均从行级
  // filePath 派生,清空即落占位图标=用户报障);晋位图无缩略图则按 add/replace 同款
  // sips 200×200 补一张。images[] 也空才真清空(资产回落文字壳)。
  const promoteMainIfDeleted = (remaining: StoredAssetImage[], removedPath: string): string => {
    if (asset.filePath && asset.filePath !== removedPath) return asset.filePath;
    const next = remaining[0]?.filePath ?? "";
    if (next) {
      const thumb = resolveAssetManagedPath(getThumbsDir(), next);
      if (!fs.existsSync(thumb)) {
        const src = resolveAssetManagedPath(getFilesDir(), next);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(thumb), { recursive: true });
          execFile("sips", ["-z", "200", "200", src, "--out", thumb], () => {});
        }
      }
    }
    return next;
  };
  const images: StoredAssetImage[] = JSON.parse(asset.images || "[]");
  const idx = images.findIndex((img) => img.filePath === imageFilePath);
  if (idx === -1) {
    // 10-19 主图可删补刀:replaceAssetMainImage 只写行级 filePath 不入 images[],
    // 生成/一键生成/图生图写回的主图在 images[] 删除路径上断链(旧「不能删主图」
    // 闸挡着从未暴露)。回退:命中的是行级主图 → 删实体与缩略图,行级指针顺位
    // 晋 images[0](有则顶图,无则清空回落文字壳),images[] 不动。
    if (asset.filePath && asset.filePath === imageFilePath) {
      const mainFile = resolveAssetManagedPath(getFilesDir(), asset.filePath);
      if (fs.existsSync(mainFile)) fs.unlinkSync(mainFile);
      const mainThumb = resolveAssetManagedPath(getThumbsDir(), asset.filePath);
      if (fs.existsSync(mainThumb)) fs.unlinkSync(mainThumb);
      const promoted = promoteMainIfDeleted(images, imageFilePath);
      const now = new Date().toISOString();
      runSqliteExecSafe(
        dbPath,
        `UPDATE assets SET filePath='${escapeSql(promoted)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`,
      );
      return getAssetSync(assetId);
    }
    return null;
  }

  const fullPath = resolveAssetManagedPath(getFilesDir(), imageFilePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  images.splice(idx, 1);

  // 10-19 缩略图善后(images[] 命中路径同款):被删的恰是行级主图时,行级指针
  // 顺位晋剩余 images[0],防列表缩略图落占位/悬空指已删文件。
  const promotedMain = promoteMainIfDeleted(images, imageFilePath);
  const now = new Date().toISOString();
  runSqliteExecSafe(dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', filePath='${escapeSql(promotedMain)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);
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
      filePath = copyAssetSourceFile(item.type, id, sourceFile, item.name);
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
    const filePath = copyAssetSourceFile(row.type, row.id, item.sourcePath, row.name ?? item.name);
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
    const filePath = copyAssetSourceFile(row.type, row.id, input.sourceFilePath, row.name ?? input.name);
    sets.push(`filePath='${escapeSql(filePath)}'`);
  }

  if (!sets.length) return false;
  sets.push(`updatedAt='${now}'`);
  runSqliteExecSafe(getDbPath(), `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(row.id)}';`);
  return true;
}

/** R1 名夹层:role/scene/tool 落 files/<type>/<sanitize(assetName)>/,clip/audio 维持平铺。文件名承载唯一性不改。 */
function copyAssetSourceFile(type: StudioAssetKind, id: string, sourceFile: string, assetName: string) {
  const ext = path.extname(sourceFile);
  const subDir = usesAssetNameFolder(type) ? `${type}/${assetFamilyFolderKey(assetName)}` : type;
  const destDir = path.join(getFilesDir(), subDir);
  fs.mkdirSync(destDir, { recursive: true });
  let destName = `${id}${ext}`;
  let destPath = path.join(destDir, destName);
  if (fs.existsSync(destPath)) {
    destName = `${id}_${Date.now()}${ext}`;
    destPath = path.join(destDir, destName);
  }
  fs.copyFileSync(sourceFile, destPath);
  return `${subDir}/${destName}`;
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


export type { StoredAssetImage } from "./assets-sqlite";
export { buildAssetNameCandidateCondition, buildAssetWhere, initAssetsStorage, resolveAssetManagedPath, shouldCreateAssetThumbnail } from "./assets-sqlite";
export { batchMatchAssets, getAsset, getAssetByName, listAssetFamilyAssets, listAssets, readAssetImageDataUrl, resetAssetsCache } from "./assets-queries";
