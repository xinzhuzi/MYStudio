/**
 * B5 推广模板 SQLite 存储——promotion_templates 表与 products 表同库(assets.db),
 * 路径走 getDbPath() 配置解析链,禁硬编码。
 * 复用 assets-sqlite.ts 的运行器族(runSqliteJson/runSqliteExec/escapeSql)。
 */
import type { PromotionTemplate } from "../../types/promotion-template";
import {
  escapeSql,
  getDbPath,
  runSqliteExec,
  runSqliteJson,
  runSqliteJsonSync,
} from "./assets-sqlite";

const TEMPLATES_TABLE = "promotion_templates";

interface TemplateDbRow {
  id: string;
  productId: string;
  name: string;
  platform: string;
  titleTemplate: string;
  bodyTemplate: string;
  defaultTags: string;
  mediaSlots: number;
  createdAt: number;
  updatedAt: number;
}

function rowToTemplate(row: TemplateDbRow): PromotionTemplate {
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    platform: row.platform as PromotionTemplate["platform"],
    titleTemplate: row.titleTemplate ?? "",
    bodyTemplate: row.bodyTemplate ?? "",
    defaultTags: safeJsonParse(row.defaultTags, []),
    mediaSlots: row.mediaSlots ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * 幂等建表——存量 assets.db 缺 promotion_templates 表时自动补建;已有则零操作。
 * 1123:改为按库路径缓存 + handler 期调用(注册期 basePath 为空不能建表)。
 */
let ensuredDbPath: string | null = null;
export function ensureTemplatesTable(): void {
  const dbPath = getDbPath();
  if (ensuredDbPath === dbPath) return;
  const rows = runSqliteJsonSync<Array<{ name: string }>>(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${TEMPLATES_TABLE}';`,
  );
  if (!rows.some((row) => row.name === TEMPLATES_TABLE)) {
    runSqliteExec(dbPath, `
CREATE TABLE IF NOT EXISTS promotion_templates (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  titleTemplate TEXT DEFAULT '',
  bodyTemplate TEXT DEFAULT '',
  defaultTags TEXT DEFAULT '[]',
  mediaSlots INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_product ON promotion_templates(productId);
CREATE INDEX IF NOT EXISTS idx_templates_platform ON promotion_templates(platform);
`);
  }
  ensuredDbPath = dbPath;
}

export async function listTemplates(): Promise<PromotionTemplate[]> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<TemplateDbRow[]>(
    dbPath,
    `SELECT * FROM promotion_templates ORDER BY updatedAt DESC;`,
  );
  return rows.map(rowToTemplate);
}

export async function listTemplatesByProduct(productId: string): Promise<PromotionTemplate[]> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<TemplateDbRow[]>(
    dbPath,
    `SELECT * FROM promotion_templates WHERE productId='${escapeSql(productId)}' ORDER BY updatedAt DESC;`,
  );
  return rows.map(rowToTemplate);
}

export async function getTemplate(id: string): Promise<PromotionTemplate | null> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<TemplateDbRow[]>(
    dbPath,
    `SELECT * FROM promotion_templates WHERE id='${escapeSql(id)}' LIMIT 1;`,
  );
  return rows.length > 0 ? rowToTemplate(rows[0]) : null;
}

export async function upsertTemplate(template: PromotionTemplate): Promise<void> {
  const dbPath = getDbPath();
  const now = Date.now();
  const createdAt = template.createdAt || now;
  const updatedAt = now;

  runSqliteExec(dbPath, `
INSERT OR REPLACE INTO promotion_templates (id, productId, name, platform, titleTemplate, bodyTemplate, defaultTags, mediaSlots, createdAt, updatedAt)
VALUES (
  '${escapeSql(template.id)}',
  '${escapeSql(template.productId)}',
  '${escapeSql(template.name)}',
  '${escapeSql(template.platform)}',
  '${escapeSql(template.titleTemplate)}',
  '${escapeSql(template.bodyTemplate)}',
  '${escapeSql(JSON.stringify(template.defaultTags))}',
  ${template.mediaSlots},
  ${createdAt},
  ${updatedAt}
);
`);
}

export async function deleteTemplate(id: string): Promise<void> {
  const dbPath = getDbPath();
  runSqliteExec(dbPath, `DELETE FROM promotion_templates WHERE id='${escapeSql(id)}';`);
}

export async function deleteTemplatesByProduct(productId: string): Promise<void> {
  const dbPath = getDbPath();
  runSqliteExec(dbPath, `DELETE FROM promotion_templates WHERE productId='${escapeSql(productId)}';`);
}
