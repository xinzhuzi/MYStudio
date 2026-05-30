import { describe, expect, it } from "vitest";
import { buildAssetWhere } from "./studio-assets-storage";

describe("buildAssetWhere", () => {
  it("只按类型过滤", () => {
    expect(buildAssetWhere("tool")).toBe("WHERE type='tool'");
  });

  it("按类型 + 分类标签过滤", () => {
    expect(buildAssetWhere("tool", undefined, "法宝")).toBe(`WHERE type='tool' AND tags LIKE '%"法宝"%'`);
  });

  it("分类标签带闭合引号，避免 丹药 误匹配 丹药配方", () => {
    const where = buildAssetWhere("tool", undefined, "丹药");
    // 模式必须是 "丹药"（含闭合引号），这样 ["丹药配方"] 不会被命中
    expect(where).toContain(`tags LIKE '%"丹药"%'`);
    const pattern = `"丹药"`;
    expect(`["丹药","人间界"]`.includes(pattern)).toBe(true);   // 丹药命中
    expect(`["丹药配方","人间界"]`.includes(pattern)).toBe(false); // 丹药配方不被误命中
  });

  it("同时按搜索 + 分类过滤", () => {
    const where = buildAssetWhere("tool", "剑", "法宝");
    expect(where).toBe(`WHERE type='tool' AND (name LIKE '%剑%' OR prompt LIKE '%剑%') AND tags LIKE '%"法宝"%'`);
  });

  it("转义单引号防注入", () => {
    expect(buildAssetWhere("tool", "a'b")).toContain("a''b");
  });
});
