import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAssetsStorage } from "./assets-sqlite";
import { ensureProductsTable, getProduct, listProducts, upsertProduct } from "./products-sqlite";
import type { Product } from "../../types/product";

let tempAssetRoot: string | undefined;

/** 与 studio-assets-storage.test.ts 同一范式：临时资产根 + 真 sqlite3，不碰用户资产库。 */
function initTempProductsDb() {
  tempAssetRoot = mkdtempSync(join(tmpdir(), "mystudio-products-test-"));
  initAssetsStorage(tempAssetRoot);
  ensureProductsTable();
}

afterEach(() => {
  if (tempAssetRoot) {
    rmSync(tempAssetRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    tempAssetRoot = undefined;
  }
});

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "漫影工作室",
    slug: "manying-studio",
    description: "一句话描述",
    detail: "# 详情\n\n正文",
    coverImage: "",
    links: [{ label: "官网", url: "https://example.com", platform: "web" }],
    tags: ["视频", "创作"],
    projectIds: ["project-1"],
    brandProfile: { primaryColor: "", tone: [], forbiddenWords: [] },
    promotion: { defaultTags: ["漫剧"], utm: { campaign: "autumn" }, ctaType: "learn_more" },
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
    ...overrides,
  };
}

/** upsertProduct 把 updatedAt 改写成写入时刻，其余字段应与写入值逐一相等。 */
function expectReadBack(read: Product | null, source: Product) {
  expect(read).not.toBeNull();
  expect(read).toEqual({ ...source, updatedAt: read!.updatedAt });
  expect(read!.createdAt).toBe(source.createdAt);
  expect(read!.brandProfile.primaryColor).toBe(source.brandProfile.primaryColor);
  expect(read!.brandProfile.tone).toEqual(source.brandProfile.tone);
  expect(read!.brandProfile.forbiddenWords).toEqual(source.brandProfile.forbiddenWords);
}

describe("products 表的 brandProfile 往返", () => {
  it("brandProfile 留空与有值各一条产品，listProducts 与 getProduct 读回后深度相等", async () => {
    initTempProductsDb();
    const empty = makeProduct({ id: "product-empty", slug: "empty", name: "留空" });
    const filled = makeProduct({
      id: "product-filled",
      slug: "filled",
      name: "有值",
      brandProfile: { primaryColor: "#336699", tone: ["轻松", "克制"], forbiddenWords: ["最", "第一"] },
    });
    await upsertProduct(empty);
    await upsertProduct(filled);

    const listed = (await listProducts()).sort((left, right) => left.id.localeCompare(right.id));
    expect(listed.map((product) => product.id)).toEqual(["product-empty", "product-filled"]);
    for (const source of [empty, filled]) {
      expectReadBack(listed.find((product) => product.id === source.id) ?? null, source);
      expectReadBack(await getProduct(source.id), source);
    }
  });

  it("语气词里带单引号和中文时原样往返", async () => {
    initTempProductsDb();
    const product = makeProduct({
      brandProfile: {
        primaryColor: "#a1b2c3",
        tone: ["it's 轻松", "「古风」", "说\u201c你好\u201d", '带"双引号'],
        forbiddenWords: ["O'Neil 的禁词"],
      },
    });
    await upsertProduct(product);

    expectReadBack(await getProduct(product.id), product);
    expectReadBack((await listProducts())[0] ?? null, product);
  });
});
