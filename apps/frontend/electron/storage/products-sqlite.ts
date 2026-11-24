/**
 * B2 产品目录 SQLite 存储——products 表与 assets 表同库(assets.db),
 * 路径走 getDbPath() 配置解析链,禁硬编码。
 * 复用 assets-sqlite.ts 的运行器族(runSqliteJson/runSqliteExec/escapeSql)。
 */
import type { Product, ProductExportRecord } from "../../types/product";
import {
  escapeSql,
  getDbPath,
  runSqliteExec,
  runSqliteJson,
  runSqliteJsonSync,
} from "./assets-sqlite";

const PRODUCTS_TABLE = "products";

interface ProductDbRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  detail: string;
  coverImage: string;
  links: string;
  tags: string;
  projectIds: string;
  brandProfile: string;
  promotion: string;
  createdAt: number;
  updatedAt: number;
}

function rowToProduct(row: ProductDbRow): Product {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    detail: row.detail ?? "",
    coverImage: row.coverImage ?? "",
    links: safeJsonParse(row.links, []),
    tags: safeJsonParse(row.tags, []),
    projectIds: safeJsonParse(row.projectIds, []),
    brandProfile: safeJsonParse(row.brandProfile, { primaryColor: "", tone: [], forbiddenWords: [] }),
    promotion: safeJsonParse(row.promotion, { defaultTags: [], utm: { campaign: "" }, ctaType: "learn_more" }),
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
 * 幂等建表——存量 assets.db 缺 products 表时自动补建;已有则零操作。
 * 1123:改为按库路径缓存 + handler 期调用(注册期 basePath 为空不能建表)。
 */
let ensuredDbPath: string | null = null;
export function ensureProductsTable(): void {
  const dbPath = getDbPath();
  if (ensuredDbPath === dbPath) return;
  const rows = runSqliteJsonSync<Array<{ name: string }>>(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${PRODUCTS_TABLE}';`,
  );
  if (!rows.some((row) => row.name === PRODUCTS_TABLE)) {
    runSqliteExec(dbPath, `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  coverImage TEXT DEFAULT '',
  links TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  projectIds TEXT DEFAULT '[]',
  brandProfile TEXT DEFAULT '{}',
  promotion TEXT DEFAULT '{}',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
`);
  }
  ensuredDbPath = dbPath;
}

export async function listProducts(): Promise<Product[]> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<ProductDbRow[]>(
    dbPath,
    `SELECT * FROM products ORDER BY updatedAt DESC;`,
  );
  return rows.map(rowToProduct);
}

export async function getProduct(id: string): Promise<Product | null> {
  const dbPath = getDbPath();
  const rows = await runSqliteJson<ProductDbRow[]>(
    dbPath,
    `SELECT * FROM products WHERE id='${escapeSql(id)}' LIMIT 1;`,
  );
  return rows.length > 0 ? rowToProduct(rows[0]) : null;
}

export async function upsertProduct(product: Product): Promise<void> {
  const dbPath = getDbPath();
  const now = Date.now();
  const createdAt = product.createdAt || now;
  const updatedAt = now;

  // 检查 slug 冲突:不同 id 但同 slug 会导致数据丢失,先查后报
  const slugConflict = await runSqliteJson<ProductDbRow[]>(
    dbPath,
    `SELECT id FROM products WHERE slug='${escapeSql(product.slug)}' AND id!='${escapeSql(product.id)}' LIMIT 1;`,
  );
  if (slugConflict.length > 0) {
    throw new Error(`产品标识 "${product.slug}" 已被其他产品使用,请更换后重试`);
  }

  runSqliteExec(dbPath, `
INSERT OR REPLACE INTO products (id, name, slug, description, detail, coverImage, links, tags, projectIds, brandProfile, promotion, createdAt, updatedAt)
VALUES (
  '${escapeSql(product.id)}',
  '${escapeSql(product.name)}',
  '${escapeSql(product.slug)}',
  '${escapeSql(product.description)}',
  '${escapeSql(product.detail)}',
  '${escapeSql(product.coverImage)}',
  '${escapeSql(JSON.stringify(product.links))}',
  '${escapeSql(JSON.stringify(product.tags))}',
  '${escapeSql(JSON.stringify(product.projectIds))}',
  '${escapeSql(JSON.stringify(product.brandProfile))}',
  '${escapeSql(JSON.stringify(product.promotion))}',
  ${createdAt},
  ${updatedAt}
);
`);
}

export async function deleteProduct(id: string): Promise<void> {
  const dbPath = getDbPath();
  runSqliteExec(dbPath, `DELETE FROM products WHERE id='${escapeSql(id)}';`);
}

/** 导出 products.json 契约(design.md §Phase A 数据源)——与落地页共享格式。 */
export async function exportProductsJson(): Promise<ProductExportRecord[]> {
  const products = await listProducts();
  return products.map((product): ProductExportRecord => ({
    slug: product.slug,
    name: product.name,
    description: product.description,
    detail: product.detail,
    coverImage: product.coverImage,
    links: product.links,
    tags: product.tags,
    promotion: product.promotion,
  }));
}
