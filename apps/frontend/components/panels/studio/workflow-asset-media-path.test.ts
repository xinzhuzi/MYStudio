import { describe, expect, it } from "vitest";
import type { ContinuityAssetVersion } from "@/types/studio";
import { resolveAssetCurrentMediaPaths } from "./workflow-asset-media-path";

function approvedVersion(
  assetId: string,
  referenceImagePaths: string[],
  reviewedAt = 20,
): ContinuityAssetVersion {
  return {
    assetId,
    versionId: `${assetId}:v1`,
    assetKind: "character",
    label: "基础形象",
    referenceImagePaths,
    structurallyComplete: true,
    contentFingerprint: `${assetId}-fp`,
    approved: true,
    approval: { status: "approved", reviewer: "human", reviewedAt, evidencePaths: [], contentFingerprint: "approval-fp" },
    source: "test",
  };
}

describe("resolveAssetCurrentMediaPaths(二期 R2 共享取图)", () => {
  it("角色:连续性最新批准首图优先,legacy thumbnailUrl 随后", () => {
    const candidates = resolveAssetCurrentMediaPaths({
      kind: "character",
      character: {
        id: "char-1",
        name: "独孤剑尘",
        description: "",
        visualTraits: "",
        views: [],
        variations: [],
        thumbnailUrl: "/legacy/thumb.png",
        createdAt: 1,
        updatedAt: 1,
      },
      latestApprovedVersion: approvedVersion("char-1", ["/continuity/front.png"]),
    });
    expect(candidates).toEqual(["/continuity/front.png", "/legacy/thumb.png"]);
  });

  it("角色 legacy 链:thumbnailUrl → views 首张有图 → referenceImages[0]", () => {
    const base = {
      id: "char-x",
      name: "x",
      description: "",
      visualTraits: "",
      variations: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(resolveAssetCurrentMediaPaths({
      kind: "character",
      character: { ...base, views: [], thumbnailUrl: "/t.png" },
    })).toEqual(["/t.png"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "character",
      character: {
        ...base,
        views: [
          { viewType: "front", imageUrl: "", generatedAt: 1 },
          { viewType: "side", imageUrl: "/v-side.png", generatedAt: 1 },
        ],
      },
    })).toEqual(["/v-side.png"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "character",
      character: { ...base, views: [], referenceImages: ["/ref-0.png", "/ref-1.png"] },
    })).toEqual(["/ref-0.png"]);
  });

  it("场景 legacy 链:referenceImage → base64 → contactSheet(空白跳过)", () => {
    const base = { id: "scene-1", name: "义庄", location: "", time: "", atmosphere: "", createdAt: 1, updatedAt: 1 };
    expect(resolveAssetCurrentMediaPaths({
      kind: "scene",
      scene: { ...base, referenceImage: "/r.png", referenceImageBase64: "data:b64" },
    })).toEqual(["/r.png"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "scene",
      scene: { ...base, referenceImageBase64: "data:b64", contactSheetImage: "  " },
    })).toEqual(["data:b64"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "scene",
      scene: { ...base, contactSheetImage: "/sheet.png" },
    })).toEqual(["/sheet.png"]);
  });

  it("场景:连续性版本出现后首图优先于 legacy 参考图", () => {
    const candidates = resolveAssetCurrentMediaPaths({
      kind: "scene",
      scene: {
        id: "scene-1",
        name: "义庄",
        location: "",
        time: "",
        atmosphere: "",
        referenceImage: "/legacy/scene.png",
        createdAt: 1,
        updatedAt: 1,
      },
      latestApprovedVersion: { ...approvedVersion("scene-1", ["/continuity/scene.png"]), assetKind: "scene" },
    });
    expect(candidates).toEqual(["/continuity/scene.png", "/legacy/scene.png"]);
  });

  it("道具:无连续性版本时 imageUrl 原样;有版本时版本首图优先", () => {
    expect(resolveAssetCurrentMediaPaths({
      kind: "prop",
      prop: { id: "prop-1", name: "木牌", description: "", imageUrl: "/prop.png", folderId: null, createdAt: 1 },
    })).toEqual(["/prop.png"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "prop",
      prop: { id: "prop-1", name: "木牌", description: "", imageUrl: "/prop.png", folderId: null, createdAt: 1 },
      latestApprovedVersion: { ...approvedVersion("prop-1", ["/continuity/prop.png"]), assetKind: "prop" },
    })).toEqual(["/continuity/prop.png", "/prop.png"]);
  });

  it("去重:连续性首图与 legacy 首位同值时只保留一个", () => {
    const candidates = resolveAssetCurrentMediaPaths({
      kind: "character",
      character: {
        id: "char-1",
        name: "独孤剑尘",
        description: "",
        visualTraits: "",
        views: [],
        variations: [],
        thumbnailUrl: "/same.png",
        createdAt: 1,
        updatedAt: 1,
      },
      latestApprovedVersion: approvedVersion("char-1", ["/same.png"]),
    });
    expect(candidates).toEqual(["/same.png"]);
  });

  it("连续性版本 referenceImagePaths 为空 → 纯 legacy 回退;全空 → 空数组", () => {
    expect(resolveAssetCurrentMediaPaths({
      kind: "character",
      character: {
        id: "char-1",
        name: "独孤剑尘",
        description: "",
        visualTraits: "",
        views: [],
        variations: [],
        thumbnailUrl: "/legacy/thumb.png",
        createdAt: 1,
        updatedAt: 1,
      },
      latestApprovedVersion: approvedVersion("char-1", []),
    })).toEqual(["/legacy/thumb.png"]);
    expect(resolveAssetCurrentMediaPaths({
      kind: "character",
      character: {
        id: "char-2",
        name: "无图角色",
        description: "",
        visualTraits: "",
        views: [],
        variations: [],
        createdAt: 1,
        updatedAt: 1,
      },
    })).toEqual([]);
  });
});
