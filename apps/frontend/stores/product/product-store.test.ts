import { beforeEach, describe, expect, it } from "vitest";
import { useProductStore } from "./product-store";
import type { Product } from "@/types/product";

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: `产品-${id}`,
    slug: `product-${id}`,
    description: "描述",
    detail: "详情",
    coverImage: "",
    links: [],
    tags: [],
    projectIds: [],
    brandProfile: { primaryColor: "#000000", tone: [], forbiddenWords: [] },
    promotion: { defaultTags: [], utm: { campaign: "launch" }, ctaType: "access" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  useProductStore.setState({ products: [], loading: false });
});

describe("useProductStore actions", () => {
  it("replaces the whole catalog with setProducts", () => {
    useProductStore.getState().setProducts([product("p1"), product("p2")]);
    expect(useProductStore.getState().products.map((item) => item.id)).toEqual(["p1", "p2"]);

    useProductStore.getState().setProducts([product("p3")]);
    expect(useProductStore.getState().products.map((item) => item.id)).toEqual(["p3"]);
  });

  it("appends a new product with upsertProduct", () => {
    useProductStore.getState().setProducts([product("p1")]);
    useProductStore.getState().upsertProduct(product("p2"));
    expect(useProductStore.getState().products.map((item) => item.id)).toEqual(["p1", "p2"]);
  });

  it("replaces an existing product in place of its id", () => {
    useProductStore.getState().setProducts([product("p1"), product("p2")]);
    const revised = product("p1", { name: "产品-p1-改" });
    useProductStore.getState().upsertProduct(revised);

    const state = useProductStore.getState();
    expect(state.products).toHaveLength(2);
    expect(state.products.map((item) => item.id)).toEqual(["p2", "p1"]); // 旧的移除,新对象追加到尾部
    expect(state.products[1]).toBe(revised); // 存的是传入对象本身
  });

  it("removes only the targeted product with removeProduct", () => {
    useProductStore.getState().setProducts([product("p1"), product("p2"), product("p3")]);
    useProductStore.getState().removeProduct("p2");
    expect(useProductStore.getState().products.map((item) => item.id)).toEqual(["p1", "p3"]);
    useProductStore.getState().removeProduct("missing");
    expect(useProductStore.getState().products.map((item) => item.id)).toEqual(["p1", "p3"]);
  });

  it("tracks the loading flag with setLoading", () => {
    useProductStore.getState().setLoading(true);
    expect(useProductStore.getState().loading).toBe(true);
    useProductStore.getState().setLoading(false);
    expect(useProductStore.getState().loading).toBe(false);
  });
});
