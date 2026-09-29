import { describe, expect, it } from "vitest";
import type { ContinuityAssetVersion, StoryboardItem } from "@/types/studio";
import {
  approvedVisualReview,
  approvedVisualReviewIssues,
  auditVisualContinuity,
  assertVisualContinuityApproved,
  buildContinuityPrompt,
  continuityAssetApprovalFingerprint,
  continuityAssetContentFingerprint,
  createHumanContinuityAssetApproval,
  createHumanVisualReview,
  createVlmVisualReview,
  isContinuityAssetVersionApproved,
  markContinuityDependentsStale,
  normalizeContinuityAssetVersion,
  storyboardContinuityStateIssues,
  storyboardShotSemanticsFingerprint,
  storyboardPrimarySceneIssues,
  visualContinuityFingerprint,
  visualReviewInputFingerprint,
} from "./visual-continuity";

function continuityAssetVersion(
  assetKind: ContinuityAssetVersion["assetKind"],
  assetId: string,
  versionId: string,
  sceneViewpointId = "dock:reverse",
): ContinuityAssetVersion {
  const referenceImagePaths = assetKind === "character"
    ? [`/${assetId}-front.png`, `/${assetId}-three-quarter.png`, `/${assetId}-side.png`]
    : [`/${assetId}.png`];
  const reviewEvidencePaths = referenceImagePaths.map((_path, index) => `/reviews/${assetId}-${index + 1}_thumb.png`);
  return normalizeContinuityAssetVersion({
    assetId,
    versionId,
    assetKind,
    label: versionId,
    referenceImagePaths,
    reviewEvidencePaths,
    reviewEvidenceSha256: reviewEvidencePaths.map(() => "a".repeat(64)),
    reviewEvidenceVerifiedAt: 1,
    referenceViewTypes: assetKind === "character" ? ["front", "three-quarter", "side"] : undefined,
    identityAnchors: assetKind === "character"
      ? { faceShape: "清瘦长脸", uniqueMarks: ["银白长发"], hairStyle: "半束高髻" }
      : undefined,
    negativePrompt: assetKind === "character" ? { avoid: ["黑发"] } : undefined,
    wardrobeVersion: assetKind === "character" ? "grey-town" : undefined,
    sceneViewpointId: assetKind === "scene" ? sceneViewpointId : undefined,
    spatialLayout: assetKind === "scene" ? "河岸、栈桥与仓棚位置固定" : undefined,
    lightingDesign: assetKind === "scene" ? "冷青晨雾" : undefined,
    colorPalette: assetKind === "scene" ? "墨青灰蓝" : undefined,
    structurallyComplete: true,
    contentFingerprint: "",
    approved: true,
    source: "test-bible",
  });
}

function approvedAssetVersion(
  assetKind: ContinuityAssetVersion["assetKind"],
  assetId: string,
  versionId: string,
  sceneViewpointId?: string,
) {
  const version = continuityAssetVersion(assetKind, assetId, versionId, sceneViewpointId);
  return createHumanContinuityAssetApproval(
    version,
    {
      status: "approved",
      evidencePaths: version.reviewEvidencePaths!,
      reviewedAt: 10,
    },
  );
}

function storyboardAssetVersions() {
  return [
    approvedAssetVersion("character", "character:dugu", "dugu:base"),
    approvedAssetVersion("scene", "scene:dock", "dock:morning", "dock:reverse"),
  ];
}

function storyboard(index: number): StoryboardItem {
  const item: StoryboardItem = {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: "dock",
    trackId: "",
    duration: 4,
    prompt: `镜头 ${index}`,
    videoDesc: `镜头 ${index}`,
    assetIds: ["character:dugu", "scene:dock"],
    mediaRef: { kind: "image", path: `/frames/sb-${index}.png` },
    state: "ready",
    shotSemantics: {
      sceneViewpointId: "dock:reverse",
      personFree: false,
      visibleCharacters: [{
        name: "独孤剑尘",
        position: "中前",
        orientation: "3/4朝右",
        actionIn: "迈步",
        actionOut: "继续前行",
      }],
      visibleProps: [],
      actionIn: index > 1 ? "承接前镜步伐" : "苦力队列前行",
      actionOut: "人物向右离画",
    },
    orderedReferenceManifest: [
      { order: 2, assetId: "scene:dock", assetKind: "scene", versionId: "dock:morning", imagePath: "/dock.png", referenceRole: "scene-viewpoint", sceneViewpointId: "dock:reverse" },
      { order: 1, assetId: "character:dugu", assetKind: "character", versionId: "dugu:base", imagePath: "/dugu.png", referenceRole: "canonical" },
    ],
    continuityState: {
      groupId: "dock-1",
      previousStoryboardId: index > 1 ? `sb-${index - 1}` : undefined,
      sceneVersionId: "dock:morning",
      sceneViewpointId: "dock:reverse",
      lighting: "冷青晨雾",
      palette: "墨青灰蓝",
      actionIn: index > 1 ? "承接前镜步伐" : "苦力队列前行",
      actionOut: "人物向右离画",
      characters: [{ characterId: "dugu", versionId: "dugu:base", position: "中前", orientation: "3/4朝右", actionIn: "迈步", actionOut: "继续前行" }],
      sourceSemanticsFingerprint: "",
      inputFingerprint: "",
    },
  };
  const versions = storyboardAssetVersions();
  item.orderedReferenceManifest = item.orderedReferenceManifest?.map((reference) => {
    const version = versions.find((entry) => entry.assetId === reference.assetId && entry.versionId === reference.versionId);
    return {
      ...reference,
      contentFingerprint: version?.contentFingerprint,
      approvalFingerprint: version?.approvalFingerprint,
      approved: version?.approved,
    };
  });
  item.continuityState!.sourceSemanticsFingerprint = storyboardShotSemanticsFingerprint(item.shotSemantics);
  item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
  item.visualReview = approvedVisualReview({
    reviewedAt: 1,
    evidencePaths: [`/frames/sb-${index}.png`],
    characterChecks: [{ characterId: "dugu", passed: true }],
    sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
    propChecks: [],
    transitionChecks: index > 1 ? [{ previousStoryboardId: `sb-${index - 1}`, passed: true }] : [],
    textWatermarkCheck: { passed: true },
    inputFingerprint: visualReviewInputFingerprint(item),
  });
  return item;
}

describe("storyboard visual continuity", () => {
  it("invalidates continuity and human review when only shot semantics change", () => {
    const item = storyboard(1);
    item.shotSemantics = {
      ...item.shotSemantics!,
      visibleCharacters: [{
        ...item.shotSemantics!.visibleCharacters[0]!,
        actionOut: "停在画面右侧回望",
      }],
    };

    expect(storyboardContinuityStateIssues(item)).toMatchObject([
      { code: "continuity.stale" },
    ]);
    expect(approvedVisualReviewIssues(item, item.visualReview, storyboardAssetVersions())).toMatchObject([
      { code: "continuity.stale" },
    ]);
  });

  it("does not treat structural completeness or an automated reviewer as asset approval", () => {
    const structural = continuityAssetVersion("character", "character:dugu", "dugu:base");
    expect(structural).toMatchObject({ structurallyComplete: true, approved: false });
    expect(isContinuityAssetVersionApproved(structural)).toBe(false);

    const automated = normalizeContinuityAssetVersion({
      ...structural,
      approval: {
        status: "approved",
        reviewer: "automated",
        reviewedAt: 10,
        evidencePaths: ["/reviews/automated.png"],
        contentFingerprint: structural.contentFingerprint,
      },
      approvalFingerprint: "automated-cannot-approve",
    });
    expect(automated.approved).toBe(false);
  });

  it("invalidates human asset approval when canonical content changes", () => {
    const approved = approvedAssetVersion("character", "character:dugu", "dugu:base");
    expect(isContinuityAssetVersionApproved(approved)).toBe(true);

    const changed = normalizeContinuityAssetVersion({
      ...approved,
      referenceImagePaths: ["/character:dugu-v2.png"],
    });
    expect(changed.contentFingerprint).not.toBe(continuityAssetContentFingerprint(approved));
    expect(changed.approved).toBe(false);
    expect(isContinuityAssetVersionApproved(changed)).toBe(false);
  });

  it("invalidates human asset approval when bytes change at the same reference path", () => {
    const structural = normalizeContinuityAssetVersion({
      ...continuityAssetVersion("prop", "prop:scroll", "scroll:base"),
      referenceImageSha256: ["a".repeat(64)],
    });
    const approved = createHumanContinuityAssetApproval(structural, {
      status: "approved",
      reviewedAt: 10,
      evidencePaths: structural.reviewEvidencePaths!,
    });
    const changed = normalizeContinuityAssetVersion({
      ...approved,
      referenceImageSha256: ["b".repeat(64)],
    });

    expect(approved.referenceImagePaths).toEqual(changed.referenceImagePaths);
    expect(changed.contentFingerprint).not.toBe(approved.contentFingerprint);
    expect(changed.approved).toBe(false);
  });

  it("does not trust persisted approval evidence outside the registered safe thumbnails", () => {
    const structural = continuityAssetVersion("prop", "prop:scroll", "scroll:base");
    const approval = {
      status: "approved" as const,
      reviewer: "human" as const,
      reviewedAt: 10,
      evidencePaths: ["/reviews/unregistered_thumb.png"],
      contentFingerprint: structural.contentFingerprint,
    };
    const forged = normalizeContinuityAssetVersion({
      ...structural,
      approval,
      approvalFingerprint: continuityAssetApprovalFingerprint(structural, approval),
    });

    expect(forged.reviewEvidencePaths).not.toEqual(approval.evidencePaths);
    expect(forged.approved).toBe(false);
    expect(isContinuityAssetVersionApproved(forged)).toBe(false);
  });

  it("requires one matching primary scene plus approved assets, prop and text checks", () => {
    const item = storyboard(1);
    item.continuityState!.characters = [];
    item.orderedReferenceManifest = [
      {
        order: 1,
        assetId: "scene:dock",
        assetKind: "scene",
        versionId: "dock:morning",
        imagePath: "/dock.png",
        referenceRole: "scene-viewpoint",
        sceneViewpointId: "dock:reverse",
      },
      {
        order: 2,
        assetId: "scene:school",
        assetKind: "scene",
        versionId: "school:window",
        imagePath: "/school.png",
        referenceRole: "secondary-scene",
        sceneViewpointId: "school:window",
      },
      {
        order: 3,
        assetId: "prop:sword-wrap",
        assetKind: "prop",
        versionId: "sword-wrap:intact",
        imagePath: "/sword-wrap.png",
        referenceRole: "prop-state",
      },
    ];
    item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
    item.visualReview = approvedVisualReview({
      ...item.visualReview,
      characterChecks: [],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [{ assetId: "prop:sword-wrap", versionId: "sword-wrap:intact", passed: true }],
      textWatermarkCheck: { passed: true },
      inputFingerprint: visualReviewInputFingerprint(item),
    });
    const versions = [
      approvedAssetVersion("scene", "scene:dock", "dock:morning", "dock:reverse"),
      approvedAssetVersion("scene", "scene:school", "school:window", "school:window"),
      approvedAssetVersion("prop", "prop:sword-wrap", "sword-wrap:intact"),
    ];
    item.orderedReferenceManifest = item.orderedReferenceManifest.map((reference) => {
      const version = versions.find((entry) => entry.assetId === reference.assetId && entry.versionId === reference.versionId);
      return {
        ...reference,
        contentFingerprint: version?.contentFingerprint,
        approvalFingerprint: version?.approvalFingerprint,
        approved: version?.approved,
      };
    });
    item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
    item.visualReview!.inputFingerprint = visualReviewInputFingerprint(item);

    expect(assertVisualContinuityApproved([item], versions)).toMatchObject({ ok: true, approved: 1 });

    item.orderedReferenceManifest[1]!.referenceRole = "scene-viewpoint";
    item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
    item.visualReview!.inputFingerprint = visualReviewInputFingerprint(item);
    expect(() => assertVisualContinuityApproved([item], versions)).toThrow("主场景");
    expect(auditVisualContinuity([item], versions).issues.filter((issue) => issue.code === "scene.primary"))
      .toHaveLength(1);
    expect(() => createHumanVisualReview(item, {
      status: "approved",
      reasons: [],
      characterChecks: [],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [{ assetId: "prop:sword-wrap", versionId: "sword-wrap:intact", passed: true }],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      evidencePaths: ["/frames/sb-1.png"],
      reviewedAt: 20,
    }, versions)).toThrow("主场景");
  });

  it("locks chapter-001 shots 23-24 to the inn room primary scene and school secondary scene", () => {
    const innRoomAssetId = "scene_1780296482373_ndts8if";
    const innRoomVersionId = `${innRoomAssetId}:inn-room-window-axis:v1`;
    const schoolAssetId = "scene_1780296482374_jew094y";
    const schoolVersionId = `${schoolAssetId}:inn-room-window-axis:v1`;
    const items = [storyboard(23), storyboard(24)];

    for (const item of items) {
      item.id = `sb-chapter-001-${String(item.index).padStart(3, "0")}`;
      item.continuityState!.sceneVersionId = innRoomVersionId;
      item.continuityState!.sceneViewpointId = "inn-room-window-axis";
      item.orderedReferenceManifest = [
        {
          order: 1,
          assetId: innRoomAssetId,
          assetKind: "scene",
          versionId: innRoomVersionId,
          referenceRole: "scene-viewpoint",
          sceneViewpointId: "inn-room-window-axis",
        },
        {
          order: 2,
          assetId: schoolAssetId,
          assetKind: "scene",
          versionId: schoolVersionId,
          referenceRole: "secondary-scene",
          sceneViewpointId: "inn-room-window-axis",
        },
      ];
      expect(storyboardPrimarySceneIssues(item)).toEqual([]);

      item.orderedReferenceManifest[1]!.referenceRole = "scene-viewpoint";
      expect(storyboardPrimarySceneIssues(item)).toEqual([
        expect.objectContaining({ code: "scene.primary" }),
      ]);
    }
  });

  it("uses ordered approved versions and continuity state as the final gate", () => {
    const items = [storyboard(1), storyboard(2)];
    expect(assertVisualContinuityApproved(items, storyboardAssetVersions())).toMatchObject({ ok: true, approved: 2 });
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("承接上一镜sb-1");
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("【出镜人数锁】本镜出镜角色总数：1");
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("禁止重复、克隆或因多视图参考新增人物");
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("前景、中景、远景和背景合计只能出现上述 1 个角色实例");
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("不得出现路人、工人、剪影、倒影或模糊人影");
  });

  it("marks all downstream shots in the same group stale", () => {
    const items = [storyboard(1), storyboard(2), storyboard(3)];
    const next = markContinuityDependentsStale(items, "sb-1", 99);
    expect(next[0]?.stale).not.toBe(true);
    expect(next[1]).toMatchObject({ stale: true, staleSince: 99, visualReview: { status: "pending" } });
    expect(next[2]?.stale).toBe(true);
    expect(() => assertVisualContinuityApproved(next)).toThrow("视觉连续性未通过");
  });

  it("marks downstream shots by storyboard index without reordering storage", () => {
    const items = [storyboard(3), storyboard(1), storyboard(2)];
    const next = markContinuityDependentsStale(items, "sb-1", 99);

    expect(next.map((item) => item.id)).toEqual(["sb-3", "sb-1", "sb-2"]);
    expect(next.find((item) => item.id === "sb-1")?.stale).not.toBe(true);
    expect(next.find((item) => item.id === "sb-2")?.stale).toBe(true);
    expect(next.find((item) => item.id === "sb-3")?.stale).toBe(true);
  });

  it("rejects missing versions, invalid order, stale fingerprints and rejected review", () => {
    const invalid = storyboard(1);
    invalid.orderedReferenceManifest![0]!.versionId = undefined;
    invalid.orderedReferenceManifest![1]!.order = 4;
    invalid.visualReview = approvedVisualReview({ status: "rejected", reasons: ["人物换脸"] });
    expect(() => assertVisualContinuityApproved([invalid])).toThrow("视觉连续性未通过");
  });

  it("rejects automated, evidence-free, incomplete and stale approvals", () => {
    const automated = storyboard(1);
    automated.visualReview = approvedVisualReview({
      ...automated.visualReview,
      reviewer: "automated",
    });
    expect(assertVisualContinuityApproved.bind(null, [automated])).toThrow("人工审核");

    const evidenceFree = storyboard(1);
    evidenceFree.visualReview = approvedVisualReview({
      ...evidenceFree.visualReview,
      evidencePaths: [],
    });
    expect(assertVisualContinuityApproved.bind(null, [evidenceFree])).toThrow("审核证据");

    const incomplete = storyboard(2);
    incomplete.visualReview = approvedVisualReview({
      ...incomplete.visualReview,
      transitionChecks: [],
    });
    expect(assertVisualContinuityApproved.bind(null, [incomplete])).toThrow("相邻镜头");

    const staleApproval = storyboard(1);
    staleApproval.prompt = "审核后修改过的提示词";
    expect(assertVisualContinuityApproved.bind(null, [staleApproval])).toThrow("审核输入已变化");

    const wrongEvidence = storyboard(1);
    wrongEvidence.visualReview = approvedVisualReview({
      ...wrongEvidence.visualReview,
      evidencePaths: ["/reviews/not-the-current-frame.png"],
    });
    expect(assertVisualContinuityApproved.bind(null, [wrongEvidence])).toThrow("精确绑定当前画面");
  });

  it("rejects a new human approval when the continuity input fingerprint is stale", () => {
    const item = storyboard(1);
    item.visualReview = undefined;
    item.continuityState!.inputFingerprint = "stale-continuity-fingerprint";

    expect(() => createHumanVisualReview(item, {
      status: "approved",
      reasons: [],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      evidencePaths: ["/frames/sb-1.png"],
      reviewedAt: 99,
    }, storyboardAssetVersions())).toThrow("连续性输入指纹已失效");
  });

  it("constructs approved human reviews only from complete current evidence", () => {
    const item = storyboard(2);
    item.visualReview = undefined;
    const review = createHumanVisualReview(item, {
      status: "approved",
      reasons: [],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [],
      transitionChecks: [{ previousStoryboardId: "sb-1", passed: true }],
      textWatermarkCheck: { passed: true },
      evidencePaths: ["/frames/sb-2.png"],
      reviewedAt: 99,
    }, storyboardAssetVersions());

    expect(review).toMatchObject({
      status: "approved",
      reviewer: "human",
      reviewedAt: 99,
      inputFingerprint: visualReviewInputFingerprint(item),
    });
  });

  it("maps an accepted VLM artifact to a pending, non-human review", () => {
    const item = storyboard(1);
    const review = createVlmVisualReview(item, {
      schemaVersion: 1,
      projectId: "project-1",
      shotId: item.id,
      status: "accepted",
      model: "qwen3-vl-test",
      checks: {
        character_ok: true,
        costume_ok: true,
        scene_ok: true,
        prop_ok: true,
        text_watermark_ok: true,
      },
      reasons: ["角色 dugu 一致"],
      inferenceMs: 12,
      inputSha256: "a".repeat(64),
      generatedAt: 123,
    }, "/reviews/vlm-artifact.json");

    expect(review).toMatchObject({
      status: "pending",
      reviewer: "vlm",
      reviewedAt: 123,
      evidencePaths: ["/reviews/vlm-artifact.json"],
      inputFingerprint: visualReviewInputFingerprint(item),
    });
    expect(approvedVisualReviewIssues(item, review)).toEqual([]);
  });

  it("does not persist a blocked VLM artifact as a visual review", () => {
    const item = storyboard(1);
    expect(createVlmVisualReview(item, {
      schemaVersion: 1,
      projectId: "project-1",
      shotId: item.id,
      status: "blocked",
      model: "",
      checks: {},
      reasons: [],
      inferenceMs: 0,
      inputSha256: "",
      code: "model-not-downloaded",
      generatedAt: 123,
    })).toBeUndefined();
  });

  it("accepts one persisted review image when generated media is unavailable", () => {
    const item = storyboard(1);
    item.mediaRef = undefined;
    item.visualReview = undefined;

    const review = createHumanVisualReview(item, {
      status: "approved",
      reasons: [],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      evidencePaths: ["/reviews/sb-1-reviewed.png"],
      reviewedAt: 100,
    }, storyboardAssetVersions());

    expect(review).toMatchObject({
      status: "approved",
      reviewer: "human",
      evidencePaths: ["/reviews/sb-1-reviewed.png"],
      inputFingerprint: visualReviewInputFingerprint(item),
    });
  });
});

describe("storyboardAxisIssues 轴线三态机检(跨镜连续性规范 §四)", () => {
  /** 在 storyboard 工厂基础上改写画面站位/动机/图证,并重烘三级指纹保持账目自洽。 */
  function axisPair(
    previousPosition: string,
    currentPosition: string,
    overrides: {
      currentActionIn?: string;
      currentCameraMove?: string;
      previousMediaRefNone?: boolean;
    } = {},
  ): [StoryboardItem, StoryboardItem] {
    const previous = storyboard(1);
    const current = storyboard(2);
    const rebake = (item: StoryboardItem) => {
      item.continuityState!.sourceSemanticsFingerprint = storyboardShotSemanticsFingerprint(item.shotSemantics);
      item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
      item.visualReview!.inputFingerprint = visualReviewInputFingerprint(item);
    };
    for (const [item, position] of [[previous, previousPosition], [current, currentPosition]] as const) {
      item.shotSemantics!.visibleCharacters[0]!.position = position;
      item.continuityState!.characters[0]!.position = position;
    }
    if (overrides.currentActionIn) {
      current.shotSemantics!.visibleCharacters[0]!.actionIn = overrides.currentActionIn;
      current.continuityState!.characters[0]!.actionIn = overrides.currentActionIn;
    }
    if (overrides.currentCameraMove) current.shotSemantics!.cameraMove = overrides.currentCameraMove;
    if (overrides.previousMediaRefNone) previous.mediaRef = undefined;
    rebake(previous);
    rebake(current);
    return [previous, current];
  }

  function axisIssuesOf(storyboards: StoryboardItem[]) {
    return auditVisualContinuity(storyboards, storyboardAssetVersions())
      .issues.filter((issue) => issue.code === "axis.crossing" || issue.code === "axis.unconfirmed");
  }

  it("态①:左右互换但 actionIn 给出转身衔接动作 → 零 axis issue", () => {
    const [previous, current] = axisPair("左前", "右前", { currentActionIn: "转身面向书案" });
    expect(axisIssuesOf([previous, current])).toEqual([]);
  });

  it("态②:左右互换且无任何换轴动机证据 → 恰一条 axis.crossing", () => {
    const [previous, current] = axisPair("左前", "右前");
    const issues = axisIssuesOf([previous, current]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ storyboardId: "sb-2", code: "axis.crossing" });
    expect(issues[0]!.message).toContain("越轴");
  });

  it("态③:互换但前镜缺图证(mediaRef 与 keyframes 均缺)→ axis.unconfirmed 且 message 点名缺证", () => {
    const [previous, current] = axisPair("左前", "右前", { previousMediaRefNone: true });
    const issues = axisIssuesOf([previous, current]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ storyboardId: "sb-2", code: "axis.unconfirmed" });
    expect(issues[0]!.message).toContain("缺上一镜 sb-1 图证");
  });

  it("态③:互换但前镜 position 写「还在原处」不属 9 站位词表 → axis.unconfirmed", () => {
    const [previous, current] = axisPair("还在原处", "右前");
    const issues = axisIssuesOf([previous, current]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ storyboardId: "sb-2", code: "axis.unconfirmed" });
    expect(issues[0]!.message).toContain("站位");
    expect(issues[0]!.message).toContain("词表");
  });

  it("P1 验收:画面左右互换由换机位运镜(环绕)justify → 不得误报", () => {
    const [previous, current] = axisPair("左前", "右前", { currentCameraMove: "环绕" });
    expect(axisIssuesOf([previous, current])).toEqual([]);
  });

  it("链断(previousStoryboardId 指向不存在镜)不查轴,由既有 continuity.previous 兜链", () => {
    const current = storyboard(2);
    current.continuityState!.previousStoryboardId = "sb-404";
    const audit = auditVisualContinuity([current]);
    expect(audit.issues.filter((issue) => issue.code === "continuity.previous")).toHaveLength(1);
    expect(audit.issues.filter((issue) => issue.code.startsWith("axis."))).toEqual([]);
  });

  it("显式空镜(personFree)与无共享角色不构成互动轴 → 不发码", () => {
    const [, current] = axisPair("左前", "右前");
    const personFreeCurrent = { ...current };
    personFreeCurrent.shotSemantics = { ...current.shotSemantics!, personFree: true };
    expect(axisIssuesOf([axisPair("左前", "右前")[0], personFreeCurrent])).toEqual([]);

    const [emptyPrevious, swappedCurrent] = axisPair("左前", "右前");
    emptyPrevious.shotSemantics!.personFree = true;
    emptyPrevious.shotSemantics!.visibleCharacters = [];
    emptyPrevious.continuityState!.characters = [];
    emptyPrevious.continuityState!.sourceSemanticsFingerprint = storyboardShotSemanticsFingerprint(emptyPrevious.shotSemantics);
    emptyPrevious.continuityState!.inputFingerprint = visualContinuityFingerprint(emptyPrevious);
    emptyPrevious.visualReview!.inputFingerprint = visualReviewInputFingerprint(emptyPrevious);
    expect(axisIssuesOf([emptyPrevious, swappedCurrent])).toEqual([]);
  });

  it("回归护栏:既有标准 fixture(position 恒「中前」无互换)经 audit 零新增 axis issue", () => {
    const items = [storyboard(1), storyboard(2), storyboard(3)];
    const audit = auditVisualContinuity(items, storyboardAssetVersions());
    expect(audit.issues.filter((issue) => issue.code.startsWith("axis."))).toEqual([]);
    expect(audit).toMatchObject({ ok: true, approved: 3 });
  });
});
