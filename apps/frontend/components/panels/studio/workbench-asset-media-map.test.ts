import { describe, expect, it } from "vitest";
import { buildWorkbenchAssetMediaMap } from "./WorkbenchTab";
import type { ContinuityAssetVersion } from "@/types/studio";

const approvedVersions: ContinuityAssetVersion[] = [
  {
    assetId: "char-1",
    versionId: "char-1:v2",
    assetKind: "character",
    label: "基础形象",
    referenceImagePaths: ["/dugu/front.png"],
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
    referenceImagePaths: ["/dugu/old.png"],
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
              referenceImage: "/assets/char-1-var.png",
              parentAnchor: {
                parentMediaPath: "/assets/char-1.png",
                parentContinuityFingerprint: "char-fp-v2",
              },
            },
          ],
          thumbnailUrl: "/assets/char-1.png",
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
              referenceImage: "/assets/char-1-var.png",
              parentAnchor: { parentMediaPath: "/assets/char-1-old.png" },
            },
          ],
          thumbnailUrl: "/assets/char-1-new.png",
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
              referenceImage: "/assets/char-1-var.png",
              parentAnchor: {
                parentMediaPath: "/assets/char-1.png",
                // 锚存的是 v1 指纹;当前最新批准版本已是 v2
                parentContinuityFingerprint: "char-fp-v1",
              },
            },
          ],
          thumbnailUrl: "/assets/char-1.png",
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
              referenceImage: "/assets/char-1-legacy.png",
            },
            {
              id: "var-no-current-fp",
              name: "无批准版本",
              visualPrompt: "no-fp",
              referenceImage: "/assets/char-1-nfp.png",
              parentAnchor: {
                parentMediaPath: "/assets/char-1.png",
                parentContinuityFingerprint: "ghost-fp",
              },
            },
          ],
          thumbnailUrl: "/assets/char-1.png",
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
          referenceImage: "/assets/scene-1.png",
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
          referenceImage: "/assets/scene-1-rain.png",
          parentAnchor: { parentMediaPath: "/assets/scene-1.png" },
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
          referenceImage: "/assets/scene-1-fog.png",
          parentAnchor: { parentMediaPath: "/assets/scene-1-gone.png" },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          id: "prop-1",
          name: "木牌",
          description: "父道具",
          imageUrl: "/assets/prop-1.png",
          folderId: null,
          createdAt: 1,
        },
        {
          id: "prop-1-crack",
          name: "裂纹木牌",
          description: "衍生",
          imageUrl: "/assets/prop-1-crack.png",
          parentId: "prop-1",
          parentAnchor: { parentMediaPath: "/assets/prop-1.png" },
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
