import { describe, expect, it, vi } from "vitest";
import {
  buildFamilyImageEntries,
  fetchFamilyImageEntries,
  mergeFamilyDisplayImages,
} from "./asset-family-images";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";

/** R4 聚显口径锁(10-19-script-asset-corridor-blank D1+D3):
 * 聚合键=batchMatch 同源候选全集(name 精确/LIKE/remark LIKE,由主进程
 * listAssetFamilyAssets 保证),排序=updatedAt 倒序(新图在前);
 * 场景/道具同口径。族聚仅显示层:非当前打开行的条目只读,不参与增删改。 */

function summary(overrides: Partial<StudioAssetSummary> & { id: string }): StudioAssetSummary {
  return {
    source: "manying-local",
    type: "role",
    name: "晏燎",
    ...overrides,
  } as StudioAssetSummary;
}

describe("buildFamilyImageEntries", () => {
  it("按传入族序(updatedAt 倒序)平铺主图+images[],跳过无图行", () => {
    const family = [
      summary({
        id: "a",
        name: "晏燎_练气期_3",
        filePath: "role/晏燎_练气期_3.png",
        previewUrl: "asset-file://role/晏燎_练气期_3.png",
      }),
      summary({
        id: "b",
        name: "晏燎",
        filePath: "role/晏燎.png",
        previewUrl: "asset-file://role/晏燎.png",
        images: [{ name: "变体一", filePath: "role/晏燎_变体一.png", url: "asset-file://role/晏燎_变体一.png" }],
      }),
      // remark 命中的族兄弟行:无任何图 → 不产出条目(聚显的是生成图)
      summary({ id: "c", name: "剑修甲", remark: "与晏燎同门" }),
    ];

    const entries = buildFamilyImageEntries(family);

    expect(entries.map((entry) => entry.filePath)).toEqual([
      "role/晏燎_练气期_3.png",
      "role/晏燎.png",
      "role/晏燎_变体一.png",
    ]);
    expect(entries.map((entry) => entry.assetId)).toEqual(["a", "b", "b"]);
    expect(entries[0]?.url).toBe("asset-file://role/晏燎_练气期_3.png");
  });

  it("跨行按 filePath 去重(先到先得=新行优先),thumbnailUrl 兜底主图 url", () => {
    const family = [
      summary({ id: "a", name: "晏燎_新", filePath: "role/shared.png", thumbnailUrl: "asset-file://thumb/shared.png" }),
      summary({ id: "b", name: "晏燎_旧", filePath: "role/shared.png", previewUrl: "asset-file://role/shared.png" }),
    ];

    const entries = buildFamilyImageEntries(family);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      assetId: "a",
      url: "asset-file://thumb/shared.png",
    });
  });
});

describe("mergeFamilyDisplayImages", () => {
  const ownMain: AssetImage = { name: "主图", filePath: "role/晏燎.png", url: "asset-file://role/晏燎.png" };

  it("family 未提供(undefined) → 仅本行图,全可编辑(旧弹窗行为不变)", () => {
    const display = mergeFamilyDisplayImages(undefined, [ownMain], "b");
    expect(display.map((entry) => entry.filePath)).toEqual(["role/晏燎.png"]);
    expect(display[0]).toMatchObject({ readOnly: false, removable: false });
  });

  it("稳态:展示=族序(updatedAt 倒序),本行条目可编辑、族兄弟只读", () => {
    const familyEntries = buildFamilyImageEntries([
      summary({ id: "a", name: "晏燎_练气期_3", filePath: "role/晏燎_练气期_3.png", previewUrl: "asset-file://role/晏燎_练气期_3.png" }),
      summary({ id: "b", name: "晏燎", filePath: "role/晏燎.png", previewUrl: "asset-file://role/晏燎.png" }),
    ]);

    const display = mergeFamilyDisplayImages(familyEntries, [ownMain], "b");

    expect(display.map((entry) => entry.filePath)).toEqual([
      "role/晏燎_练气期_3.png",
      "role/晏燎.png",
    ]);
    expect(display[0]?.readOnly).toBe(true);
    expect(display[1]?.readOnly).toBe(false);
    // 本行主图沿用 live 条目(名字保持「主图」),且不可删(与旧 index0 主图规则同义)
    expect(display[1]).toMatchObject({ name: "主图", removable: false });
  });

  it("本行多图在族序原位展示,附加图可删;族兄弟附加图只读", () => {
    const ownImages: AssetImage[] = [
      ownMain,
      { name: "变体一", filePath: "role/晏燎_变体一.png", url: "asset-file://role/晏燎_变体一.png" },
    ];
    const familyEntries = buildFamilyImageEntries([
      summary({
        id: "b",
        name: "晏燎",
        filePath: "role/晏燎.png",
        previewUrl: "asset-file://role/晏燎.png",
        images: [{ name: "变体一", filePath: "role/晏燎_变体一.png", url: "asset-file://role/晏燎_变体一.png" }],
      }),
      summary({ id: "a", name: "晏燎_旧", filePath: "role/晏燎_旧.png", previewUrl: "asset-file://role/晏燎_旧.png" }),
    ]);

    const display = mergeFamilyDisplayImages(familyEntries, ownImages, "b");

    expect(display.map((entry) => entry.filePath)).toEqual([
      "role/晏燎.png",
      "role/晏燎_变体一.png",
      "role/晏燎_旧.png",
    ]);
    expect(display.map((entry) => entry.readOnly)).toEqual([false, false, true]);
    expect(display.map((entry) => entry.removable)).toEqual([false, true, false]);
  });

  it("换主图后:新主图置顶(可编辑),族列表中被换掉的旧主图过滤", () => {
    const nextMain: AssetImage = { name: "主图", filePath: "role/晏燎_new.png", url: "asset-file://role/晏燎_new.png" };
    const familyEntries = buildFamilyImageEntries([
      summary({ id: "a", name: "晏燎_练气期_3", filePath: "role/晏燎_练气期_3.png", previewUrl: "asset-file://role/晏燎_练气期_3.png" }),
      summary({ id: "b", name: "晏燎", filePath: "role/晏燎.png", previewUrl: "asset-file://role/晏燎.png" }),
    ]);

    const display = mergeFamilyDisplayImages(familyEntries, [nextMain], "b");

    expect(display.map((entry) => entry.filePath)).toEqual([
      "role/晏燎_new.png",
      "role/晏燎_练气期_3.png",
    ]);
    expect(display[0]?.readOnly).toBe(false);
  });

  it("新增图后:新增条目置顶(live 新图=最新),本行族位条目原位保留", () => {
    const ownImages: AssetImage[] = [
      ownMain,
      { name: "新图", filePath: "role/晏燎_新图.png", url: "asset-file://role/晏燎_新图.png" },
    ];
    const familyEntries = buildFamilyImageEntries([
      summary({ id: "a", name: "晏燎_练气期_3", filePath: "role/晏燎_练气期_3.png", previewUrl: "asset-file://role/晏燎_练气期_3.png" }),
      summary({ id: "b", name: "晏燎", filePath: "role/晏燎.png", previewUrl: "asset-file://role/晏燎.png" }),
    ]);

    const display = mergeFamilyDisplayImages(familyEntries, ownImages, "b");

    expect(display.map((entry) => entry.filePath)).toEqual([
      "role/晏燎_新图.png",
      "role/晏燎_练气期_3.png",
      "role/晏燎.png",
    ]);
  });

  it("族为空数组 → 退化为本行图(兼容 App 家库无候选行的合成资产场景)", () => {
    const display = mergeFamilyDisplayImages([], [ownMain], "local-b");
    expect(display.map((entry) => entry.filePath)).toEqual(["role/晏燎.png"]);
    expect(display[0]?.readOnly).toBe(false);
  });
});

describe("fetchFamilyImageEntries", () => {
  it("桥缺席(旧 preload/非桌面) → undefined,弹窗回落本行图", async () => {
    await expect(fetchFamilyImageEntries(undefined, "role", "晏燎")).resolves.toBeUndefined();
    await expect(
      fetchFamilyImageEntries({ listFamily: undefined }, "role", "晏燎"),
    ).resolves.toBeUndefined();
  });

  it("查询失败 → undefined(聚显是增强,失败不阻断详情)", async () => {
    const listFamily = vi.fn().mockRejectedValue(new Error("IPC down"));
    await expect(
      fetchFamilyImageEntries({ listFamily }, "role", "晏燎"),
    ).resolves.toBeUndefined();
  });

  it("命中 → 透传主进程族序并平铺条目;type/name 原样入参", async () => {
    const listFamily = vi.fn().mockResolvedValue([
      summary({ id: "a", name: "晏燎_练气期_3", filePath: "role/晏燎_练气期_3.png", previewUrl: "asset-file://role/晏燎_练气期_3.png" }),
      summary({ id: "b", name: "晏燎", filePath: "role/晏燎.png", previewUrl: "asset-file://role/晏燎.png" }),
    ]);

    const entries = await fetchFamilyImageEntries({ listFamily }, "role", "晏燎");

    expect(listFamily).toHaveBeenCalledWith({ type: "role", name: "晏燎" });
    expect(entries?.map((entry) => entry.assetId)).toEqual(["a", "b"]);
  });

  it("主进程返回 null/空 → 空族(不 undefined),显示层退化为本行图", async () => {
    const listFamily = vi.fn().mockResolvedValue([]);
    await expect(
      fetchFamilyImageEntries({ listFamily }, "scene", "道口镇"),
    ).resolves.toEqual([]);
  });
});
