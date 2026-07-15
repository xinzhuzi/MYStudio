import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  approvedVisualReview,
  assertVisualContinuityApproved,
  buildContinuityPrompt,
  createHumanVisualReview,
  markContinuityDependentsStale,
  visualContinuityFingerprint,
  visualReviewInputFingerprint,
} from "./visual-continuity";

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
    state: "ready",
    orderedReferenceManifest: [
      { order: 2, assetId: "scene:dock", versionId: "dock:morning", imagePath: "/dock.png", referenceRole: "scene-viewpoint", approved: true },
      { order: 1, assetId: "character:dugu", versionId: "dugu:base", imagePath: "/dugu.png", referenceRole: "canonical", approved: true },
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
      inputFingerprint: "",
    },
  };
  item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
  item.visualReview = approvedVisualReview({
    reviewedAt: 1,
    evidencePaths: ["/reviews/sb.png"],
    characterChecks: [{ characterId: "dugu", passed: true }],
    sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
    transitionChecks: index > 1 ? [{ previousStoryboardId: `sb-${index - 1}`, passed: true }] : [],
    inputFingerprint: visualReviewInputFingerprint(item),
  });
  return item;
}

describe("storyboard visual continuity", () => {
  it("uses ordered approved versions and continuity state as the final gate", () => {
    const items = [storyboard(1), storyboard(2)];
    expect(assertVisualContinuityApproved(items)).toMatchObject({ ok: true, approved: 2 });
    expect(buildContinuityPrompt(items[1]!.continuityState!)).toContain("承接上一镜sb-1");
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
  });

  it("constructs approved human reviews only from complete current evidence", () => {
    const item = storyboard(2);
    item.visualReview = undefined;
    const review = createHumanVisualReview(item, {
      status: "approved",
      reasons: [],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      transitionChecks: [{ previousStoryboardId: "sb-1", passed: true }],
      evidencePaths: ["/reviews/sb-2.png"],
      reviewedAt: 99,
    });

    expect(review).toMatchObject({
      status: "approved",
      reviewer: "human",
      reviewedAt: 99,
      inputFingerprint: visualReviewInputFingerprint(item),
    });
  });
});
