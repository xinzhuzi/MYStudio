import { describe, expect, it } from "vitest";
import { synthesizeAssetSummaryFromRow, type AssetRow } from "./script-asset-generation-model";

/** 同源兜底(2026-10-13):App 家库两查落空时用项目库资产合成只读摘要,
 *  保证卡片缩略图与弹窗主图同源(getRowImage 与合成摘要的取图口径一致)。 */
describe("synthesizeAssetSummaryFromRow", () => {
  it("character 行:取 thumbnailUrl(与卡片 getRowImage 同源),id 加 local- 前缀", () => {
    const row = {
      id: "row-1",
      name: "断臂散修",
      type: "character",
      asset: {
        name: "断臂散修",
        description: "断去一臂的贫苦散修",
        visualTraits: "水墨国风……",
        thumbnailUrl: "project-file://p1/workflow-images/assets/character/a.png",
        views: [{ viewType: "front", imageUrl: "project-file://p1/workflow-images/assets/character/b.png" }],
      },
    } as unknown as AssetRow;
    const summary = synthesizeAssetSummaryFromRow(row);
    expect(summary).toMatchObject({
      id: "local-row-1",
      source: "manying-local",
      type: "role",
      name: "断臂散修",
      thumbnailUrl: "project-file://p1/workflow-images/assets/character/a.png",
      previewUrl: "project-file://p1/workflow-images/assets/character/a.png",
      prompt: "水墨国风……",
    });
  });

  it("thumbnailUrl 缺席时回落 views[0](与 getRowImage 的回落序一致)", () => {
    const row = {
      id: "row-2",
      name: "角色乙",
      type: "character",
      asset: { views: [{ viewType: "front", imageUrl: "project-file://p1/b.png" }] },
    } as unknown as AssetRow;
    expect(synthesizeAssetSummaryFromRow(row)?.thumbnailUrl).toBe("project-file://p1/b.png");
  });

  it("项目库资产无任何图 → 返回 null(维持「资产未找到」流程)", () => {
    const row = {
      id: "row-3",
      name: "角色丙",
      type: "character",
      asset: { name: "角色丙" },
    } as unknown as AssetRow;
    expect(synthesizeAssetSummaryFromRow(row)).toBeNull();
  });
});
