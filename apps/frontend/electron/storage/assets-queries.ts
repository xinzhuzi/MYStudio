import fs from "node:fs";
import {
  getDbPath, runSqliteJson, runSqliteJsonSync, resolveManagedAssetPathOrUndefined,
  getThumbUrl, escapeSql,
} from "./assets-sqlite";
import path from "node:path";
import { assetNameMatchesQuery } from "../../lib/studio/asset-names";
import type { StudioAssetKind, StudioAssetSummary } from "../../types/studio-assets";
import { createAssetFileUrl } from "./storage-paths";
import { buildAssetNameCandidateCondition, buildAssetWhere, rowToSummary } from "./assets-sqlite";

/**
 * 资产库查询与读族——listAssets/getAsset/getAssetByName/batchMatchAssets/匹配打分/thumbnail 读/缓存重置。file-size-reduction zustand 专批拆出,体逐字保留。
 */
export async function listAssets(type: StudioAssetKind, search?: string, offset = 0, limit = 60, category?: string): Promise<{ items: StudioAssetSummary[]; total: number }> {
  const dbPath = getDbPath();
  const where = `${buildAssetWhere(type, search, category)} AND (${buildUsableAssetSqlCondition()})`;

  const countResult = await runSqliteJson<{ cnt: number }[]>(dbPath, `SELECT count(*) as cnt FROM assets ${where};`);
  const total = countResult[0]?.cnt ?? 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT id, type, name, description, filePath, tags FROM assets ${where} ORDER BY rowid ASC LIMIT ${limit} OFFSET ${offset};`
  );

  const items: StudioAssetSummary[] = rows.map((row) => {
    const absPath = resolveManagedAssetPathOrUndefined(row.filePath);
    // 08-24 路径裁定:桥响应中会被持久化进 store 的字段一律虚拟
    // asset-file://(sourcePath 为瞬态主进程消费字段,保持绝对)
    const previewUrl = absPath ? createAssetFileUrl(row.filePath) : undefined;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await runSqliteJson<any[]>(dbPath,
    `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`
  );
  if (!rows.length) return null;
  return rowToSummary(rows[0]);
}

export async function getAssetByName(type: StudioAssetKind, name: string): Promise<StudioAssetSummary | null> {
  const dbPath = getDbPath();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await runSqliteJson<any[]>(dbPath, query);

  for (const name of names) {
    const exact = pickBestAssetNameMatch(rows, name);
    if (exact) {
      result.set(name, rowToSummary(exact));
      continue;
    }
    // remark 模糊兜底(人名/场景串型防线 08-24): 仅在唯一命中时采用——
    // 多命中静默择优会把「道口镇街巷」这类查询串到 remark 都提过的多个
    // 场景资产上;宁缺勿错,未挂参考由画面过滤/补挂链兜住
    const fuzzy = rows.filter((row) => row.remark?.includes(name));
    const usable = fuzzy.filter(isUsableAssetRow);
    if (usable.length === 1) {
      result.set(name, rowToSummary(usable[0]));
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBestAssetNameMatch(rows: any[], name: string) {
  const matches = rows.filter((row) => assetNameMatchesQuery(row.name, name));
  if (!matches.length) return null;
  return pickBestAssetRow(matches);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickBestAssetRow(rows: any[]) {
  const usableRows = rows.filter(isUsableAssetRow);
  if (!usableRows.length) return null;
  return [...usableRows].sort((a, b) => assetCompletenessScore(b) - assetCompletenessScore(a))[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isUsableAssetRow(row: any) {
  return assetCompletenessScore(row) > 0;
}

export function hasStoredText(value: unknown): value is string {
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


export function readAssetImageDataUrl(id: string): string | null {
  const dbPath = getDbPath();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  if (!rows.length) return null;
  const absPath = resolveManagedAssetPathOrUndefined(rows[0].filePath);
  if (!absPath || !fs.existsSync(absPath)) return null;
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

export function getAssetSync(id: string): StudioAssetSummary | null {
  const dbPath = getDbPath();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = runSqliteJsonSync<any[]>(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

export function resetAssetsCache() {
  // no-op for SQLite version
}
