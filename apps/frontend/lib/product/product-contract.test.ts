import { describe, expect, it } from "vitest";
import type { Product, ProductCtaType } from "@/types/product";
import { isProduct, isProductCtaType } from "./__fixtures__/product-contract";

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

const filledBrandProfile: Product["brandProfile"] = {
  primaryColor: "#336699",
  tone: ["轻松", "克制"],
  forbiddenWords: ["最", "第一"],
};

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** 故意构造类型不合法的值。守卫的入参是 unknown，这里的断言只为绕过夹具的字面量类型检查。 */
const invalid = <T>(value: unknown): T => value as T;

describe("isProduct", () => {
  it("接受与 Product 类型对齐的产品", () => {
    expect(isProduct(makeProduct())).toBe(true);
    expect(isProduct(makeProduct({ brandProfile: filledBrandProfile }))).toBe(true);
    expect(isProduct(null)).toBe(false);
    expect(isProduct(undefined)).toBe(false);
    expect(isProduct([])).toBe(false);
    expect(isProduct("product")).toBe(false);
  });

  it("拒绝缺 brandProfile 的对象", () => {
    expect(isProduct(withoutKey(makeProduct(), "brandProfile"))).toBe(false);
  });

  it("拒绝 ctaType 越界的对象", () => {
    const promotion = { defaultTags: [], utm: { campaign: "" }, ctaType: invalid<ProductCtaType>("buy_now") };
    expect(isProduct(makeProduct({ promotion }))).toBe(false);
  });

  it("拒绝 tone 不是数组的对象", () => {
    const brandProfile = { primaryColor: "", tone: invalid<string[]>("轻松"), forbiddenWords: [] };
    expect(isProduct(makeProduct({ brandProfile }))).toBe(false);
  });

  it("拒绝 createdAt 不是数字的对象", () => {
    expect(isProduct(makeProduct({ createdAt: invalid<number>("1700000000000") }))).toBe(false);
  });

  it("拒绝 brandProfile 缺键的对象：products 表该列默认值 '{}' 读回的就是这种形状", () => {
    expect(isProduct({ ...makeProduct(), brandProfile: {} })).toBe(false);
  });

  it("拒绝键集与 Product 不一致的对象：少一个键或多一个键", () => {
    expect(isProduct(withoutKey(makeProduct(), "projectIds"))).toBe(false);
    expect(isProduct({ ...makeProduct(), extra: "不在契约里的键" })).toBe(false);
  });
});

describe("isProductCtaType", () => {
  it.each<ProductCtaType>(["access", "read", "download", "learn_more", "community"])("接受契约取值 %s", (ctaType) => {
    expect(isProductCtaType(ctaType)).toBe(true);
  });

  it("拒绝契约之外的值", () => {
    expect(isProductCtaType("buy_now")).toBe(false);
    expect(isProductCtaType("")).toBe(false);
    expect(isProductCtaType(1)).toBe(false);
    expect(isProductCtaType(undefined)).toBe(false);
  });
});
