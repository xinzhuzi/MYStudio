import { describe, expect, it } from "vitest";
import { buildWorkbenchAssetMediaMap } from "./WorkbenchTab";
import type { ContinuityAssetVersion } from "@/types/studio";

const approvedVersions: ContinuityAssetVersion[] = [
  {
    assetId: "char-1",
    versionId: "char-1:v2",
    assetKind: "character",
    label: "基础形象",
    referenceImagePaths: ["project-file://daojie/continuity/dugu-front.png"],
    structurallyComplete: true,
    contentFingerprint: "char-fp-v2",
    approved: true,
    approval: { status: "approved", reviewer: "human", reviewedAt: 20, evidencePaths: [], contentFingerprint: "approval-fp" },
    source: "test",
  },
  {
    assetId: "char-1",
    versionId: "char-1:v1",
    assetKind: "character",
    label: "旧基础形象",
    referenceImagePaths: ["project-file://daojie/continuity/dugu-old.png"],
    structurallyComplete: true,
    contentFingerprint: "char-fp-v1",
    approved: true,
    approval: { status: "approved", reviewer: "human", reviewedAt: 10, evidencePaths: [], contentFingerprint: "approval-fp" },
    source: "test",
  },
  {
    assetId: "char-no-media",
    versionId: "char-no-media:v1",
    assetKind: "character",
    label: "无图角色",
    referenceImagePaths: [],
    structurallyComplete: true,
    contentFingerprint: "char-no-media-fp",
    approved: true,
    approval: { status: "approved", reviewer: "human", reviewedAt: 10, evidencePaths: [], contentFingerprint: "approval-fp" },
    source: "test",
  },
];

describe("buildWorkbenchAssetMediaMap 衍生图过期判定(R1 锚比对)", () => {
  it("锚与父当前样子一致 → 不标过期", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-fresh",
              name: "战损",
              visualPrompt: "破衣",
              referenceImage: "project-file://daojie/assets/char-1-var.png",
              parentAnchor: {
                parentMediaPath: "project-file://daojie/assets/char-1.png",
                parentContinuityFingerprint: "char-fp-v2",
              },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      approvedVersions,
    );
    expect(entries["var-fresh"]?.stale).toBeUndefined();
  });

  it("父当前媒体路径与锚不一致 → 标过期", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-path-drift",
              name: "战损",
              visualPrompt: "破衣",
              referenceImage: "project-file://daojie/assets/char-1-var.png",
              parentAnchor: { parentMediaPath: "project-file://daojie/assets/char-1-old.png" },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1-new.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      approvedVersions,
    );
    expect(entries["var-path-drift"]?.stale).toBe(true);
  });

  it("路径一致但最新批准指纹漂移 → 标过期(取 reviewedAt 最新的批准版本)", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-fp-drift",
              name: "战损",
              visualPrompt: "破衣",
              referenceImage: "project-file://daojie/assets/char-1-var.png",
              parentAnchor: {
                parentMediaPath: "project-file://daojie/assets/char-1.png",
                // 锚存的是 v1 指纹;当前最新批准版本已是 v2
                parentContinuityFingerprint: "char-fp-v1",
              },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      approvedVersions,
    );
    expect(entries["var-fp-drift"]?.stale).toBe(true);
  });

  it("存量记录无锚 → 静默不标;锚存指纹但父无批准版本 → 不误报", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-legacy",
              name: "旧变体",
              visualPrompt: "legacy",
              referenceImage: "project-file://daojie/assets/char-1-legacy.png",
            },
            {
              id: "var-no-current-fp",
              name: "无批准版本",
              visualPrompt: "no-fp",
              referenceImage: "project-file://daojie/assets/char-1-nfp.png",
              parentAnchor: {
                parentMediaPath: "project-file://daojie/assets/char-1.png",
                parentContinuityFingerprint: "ghost-fp",
              },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      // 只传 char-no-media 的批准版本:char-1 当前无批准指纹 → 无漂移证据
      [approvedVersions[2]!],
    );
    expect(entries["var-legacy"]?.stale).toBeUndefined();
    expect(entries["var-no-current-fp"]?.stale).toBeUndefined();
  });

  it("场景与道具衍生记录同规则;父资产自身条目永不带 stale", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [],
      [
        {
          id: "scene-1",
          name: "义庄",
          location: "义庄",
          time: "夜",
          atmosphere: "阴冷",
          referenceImage: "project-file://daojie/assets/scene-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "scene-1-rain",
          name: "义庄夜雨",
          location: "义庄",
          time: "夜",
          atmosphere: "雨",
          parentSceneId: "scene-1",
          viewpointName: "夜雨视角",
          referenceImage: "project-file://daojie/assets/scene-1-rain.png",
          parentAnchor: { parentMediaPath: "project-file://daojie/assets/scene-1.png" },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "scene-1-fog",
          name: "义庄晨雾",
          location: "义庄",
          time: "晨",
          atmosphere: "雾",
          parentSceneId: "scene-1",
          viewpointName: "晨雾视角",
          referenceImage: "project-file://daojie/assets/scene-1-fog.png",
          parentAnchor: { parentMediaPath: "project-file://daojie/assets/scene-1-gone.png" },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          id: "prop-1",
          name: "木牌",
          description: "父道具",
          imageUrl: "project-file://daojie/assets/prop-1.png",
          folderId: null,
          createdAt: 1,
        },
        {
          id: "prop-1-crack",
          name: "裂纹木牌",
          description: "衍生",
          imageUrl: "project-file://daojie/assets/prop-1-crack.png",
          parentId: "prop-1",
          parentAnchor: { parentMediaPath: "project-file://daojie/assets/prop-1.png" },
          folderId: null,
          createdAt: 1,
        },
      ],
      [],
    );
    expect(entries["scene-1"]?.stale).toBeUndefined();
    expect(entries["scene-1-rain"]?.stale).toBeUndefined();
    expect(entries["scene-1-fog"]?.stale).toBe(true);
    expect(entries["prop-1"]?.stale).toBeUndefined();
    expect(entries["prop-1-crack"]?.stale).toBeUndefined();
  });
});

describe("buildWorkbenchAssetMediaMap 父图取最新版(二期 R2)", () => {
  it("data: URL 永不参与锚比对与锚显示优先级不受影响(08-27 路径裁定)", () => {
    const dataUrl = "data:image/png;base64,SGVsbG8=";
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-data",
          name: "无图角色",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "char-data-var",
              name: "旧姿",
              visualPrompt: "p",
              referenceImage: "project-file://daojie/assets/char-data-var.png",
              // 防御钉子:即便历史锚存了 data: 值(与父当前值全同),也不算路径命中
              parentAnchor: { parentMediaPath: dataUrl },
            },
          ],
          thumbnailUrl: dataUrl,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      [],
    );
    // 父卡显示不受过滤影响:有 data: 总比没图强(显示不落盘)
    expect(entries["char-data"]?.path).toBe(dataUrl);
    expect(entries["char-data-var"]?.stale).toBe(true);
  });

  it("一期锚(thumbnailUrl 值)在连续性版本出现后仍不误报过期(命中集合兼容,必须钉住)", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-legacy-anchor",
              name: "战损",
              visualPrompt: "破衣",
              referenceImage: "project-file://daojie/assets/char-1-var.png",
              // 一期写入的锚:当时父图首位是 thumbnailUrl
              parentAnchor: { parentMediaPath: "project-file://daojie/assets/char-1.png" },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      [
        // 二期上线后同一资产出现连续性版本:candidates[0] 切到连续性图
        {
          ...approvedVersions[0]!,
          referenceImagePaths: ["project-file://daojie/continuity/dugu-front.png"],
        },
      ],
    );
    expect(entries["var-legacy-anchor"]?.stale).toBeUndefined();
  });

  it("父卡显示取候选首位:连续性最新批准图优先于 legacy 缩略图", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      approvedVersions,
    );
    expect(entries["char-1"]?.path).toBe("project-file://daojie/continuity/dugu-front.png");
  });

  it("锚不在候选集合内(父图真的换了)仍报过期;父自身条目永不带 stale", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [
        {
          id: "char-1",
          name: "独孤剑尘",
          description: "",
          visualTraits: "",
          views: [],
          variations: [
            {
              id: "var-real-drift",
              name: "战损",
              visualPrompt: "破衣",
              referenceImage: "project-file://daojie/assets/char-1-var.png",
              parentAnchor: { parentMediaPath: "project-file://daojie/gone/old.png" },
            },
          ],
          thumbnailUrl: "project-file://daojie/assets/char-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [],
      [],
      approvedVersions,
    );
    expect(entries["var-real-drift"]?.stale).toBe(true);
    expect(entries["char-1"]?.stale).toBeUndefined();
  });

  it("场景父卡与道具父卡同样取连续性首图;视角变体自身取图链不变", () => {
    const entries = buildWorkbenchAssetMediaMap(
      [],
      [
        {
          id: "scene-1",
          name: "义庄",
          location: "义庄",
          time: "夜",
          atmosphere: "阴冷",
          referenceImage: "project-file://daojie/legacy/scene-1.png",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "scene-1-rain",
          name: "义庄夜雨",
          location: "义庄",
          time: "夜",
          atmosphere: "雨",
          parentSceneId: "scene-1",
          viewpointName: "夜雨视角",
          referenceImage: "project-file://daojie/assets/scene-1-rain.png",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          id: "prop-1",
          name: "木牌",
          description: "父道具",
          imageUrl: "project-file://daojie/legacy/prop-1.png",
          folderId: null,
          createdAt: 1,
        },
      ],
      [
        {
          ...approvedVersions[0]!,
          assetId: "scene-1",
          assetKind: "scene" as const,
          referenceImagePaths: ["project-file://daojie/continuity/scene-1.png"],
        },
        {
          ...approvedVersions[0]!,
          assetId: "prop-1",
          assetKind: "prop" as const,
          referenceImagePaths: ["project-file://daojie/continuity/prop-1.png"],
        },
      ],
    );
    expect(entries["scene-1"]?.path).toBe("project-file://daojie/continuity/scene-1.png");
    expect(entries["scene-1-rain"]?.path).toBe("project-file://daojie/assets/scene-1-rain.png");
    expect(entries["prop-1"]?.path).toBe("project-file://daojie/continuity/prop-1.png");
  });
});
