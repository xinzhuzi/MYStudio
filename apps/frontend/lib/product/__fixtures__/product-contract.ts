/**
 * B2 产品目录运行时契约守卫——只给测试和契约对拍用，不接进任何运行时路径
 * （IPC、store、界面）。
 *
 * 不接运行时的原因：products 表 brandProfile 列的默认值是 '{}'，这种行经
 * rowToProduct 读出的是缺键对象（见 electron/storage/products-sqlite.ts），
 * 严格的守卫会判它不过。从界面保存的产品不会出现这种行，
 * 没必要为此在运行时引入一个新的拒绝点。
 *
 * 住在 __fixtures__/ 的原因：本模块只有测试引用，放在生产源码位置会被架构分层门禁
 * （apps/build/scripts/arch_layer_gate.mjs）判为「新增不可达文件」；该门禁对测试支撑目录
 * 明文豁免。安放方式同 lib/artifacts/__fixtures__/fixture-builders.ts。
 */
import type { Product, ProductCtaType } from "@/types/product";

/** Product 的全部键。satisfies 保证清单里没有 Product 之外的键。 */
const PRODUCT_KEYS = [
  "id",
  "name",
  "slug",
  "description",
  "detail",
  "coverImage",
  "links",
  "tags",
  "projectIds",
  "brandProfile",
  "promotion",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Product)[];

type ProductKey = (typeof PRODUCT_KEYS)[number];

/** ProductCtaType 的全部取值。satisfies 保证清单里没有契约之外的值。 */
const PRODUCT_CTA_TYPES = ["access", "read", "download", "learn_more", "community"] as const satisfies readonly ProductCtaType[];

/**
 * 编译期断言，运行时不存在：Product 的每个键都在 PRODUCT_KEYS 里，
 * ProductCtaType 的每个取值都在 PRODUCT_CTA_TYPES 里。
 * 类型将来加了键或取值而清单没跟上时，默认类型实参变成 false、违反约束，typecheck 变红。
 */
export type ProductContractListsMatch<
  Match extends true = [Exclude<keyof Product, ProductKey>] extends [never]
    ? [Exclude<ProductCtaType, (typeof PRODUCT_CTA_TYPES)[number]>] extends [never]
      ? true
      : false
    : false,
> = Match;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBrandProfile(value: unknown): boolean {
  return isRecord(value)
    && typeof value.primaryColor === "string"
    && isStringArray(value.tone)
    && isStringArray(value.forbiddenWords);
}

function isProductLink(value: unknown): boolean {
  return isRecord(value)
    && typeof value.label === "string"
    && typeof value.url === "string"
    && typeof value.platform === "string";
}

function isProductPromotion(value: unknown): boolean {
  return isRecord(value)
    && isStringArray(value.defaultTags)
    && isRecord(value.utm)
    && typeof value.utm.campaign === "string"
    && isProductCtaType(value.ctaType);
}

export function isProductCtaType(value: unknown): value is ProductCtaType {
  return typeof value === "string" && (PRODUCT_CTA_TYPES as readonly string[]).includes(value);
}

/** 严格守卫：键集与 Product 完全一致（不缺不多），且每个字段的形状与类型对齐。 */
export function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== PRODUCT_KEYS.length) return false;
  if (!(PRODUCT_KEYS as readonly string[]).every((key) => keys.includes(key))) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.slug === "string"
    && typeof value.description === "string"
    && typeof value.detail === "string"
    && typeof value.coverImage === "string"
    && Array.isArray(value.links)
    && value.links.every(isProductLink)
    && isStringArray(value.tags)
    && isStringArray(value.projectIds)
    && isBrandProfile(value.brandProfile)
    && isProductPromotion(value.promotion)
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number";
}
