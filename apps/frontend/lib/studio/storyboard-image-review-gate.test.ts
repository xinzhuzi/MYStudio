// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import { sha256FromBase64Image } from "@/lib/studio/image-content-hash";
import {
  assertStoryboardImagesHumanReviewed,
  storyboardImageHumanApproved,
  storyboardImageReviewIssues,
  verifyStoryboardImageBytes,
} from "@/lib/studio/storyboard-image-review-gate";
import type { StoryboardItem } from "@/types/studio";

const IMAGE_B64 = "aGVsbG8=";
const IMAGE_SHA = await sha256FromBase64Image(IMAGE_B64);

function shot(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-chapter-001-3",
    episodeId: "chapter-001",
    index: 3,
    trackKey: "track-3",
    trackId: "",
    duration: 5,
    prompt: "",
    videoDesc: "",
    assetIds: [],
    state: "ready",
    mediaRef: { kind: "image", path: "project-file://p1/workflow-images/a.png" },
    ...overrides,
  } as StoryboardItem;
}

describe("storyboardImageReviewIssues(分镜图人审硬门)", () => {
  it("无图镜不属本门(返回空,不拦文字镜)", () => {
    expect(storyboardImageReviewIssues(shot({ mediaRef: undefined }))).toEqual([]);
    expect(storyboardImageReviewIssues(shot({ mediaRef: { kind: "video", path: "v.mp4" } }))).toEqual([]);
    expect(storyboardImageReviewIssues(shot({ mediaRef: { kind: "image", path: "  " } }))).toEqual([]);
  });

  it("无记录=待审(拦,文案含镜 id)", () => {
    const issues = storyboardImageReviewIssues(shot());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("sb-chapter-001-3");
    expect(issues[0]).toContain("未通过人审");
  });

  it("已驳回=拦并带原因", () => {
    const issues = storyboardImageReviewIssues(shot({
      imageReview: { status: "rejected", reviewedAt: 1, reasons: ["主角画了两个"], singleAppearancePassed: false, contentSha256: IMAGE_SHA },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("驳回");
    expect(issues[0]).toContain("主角画了两个");
  });

  it("批准但缺「具名角色各只出现一次」确认=拦", () => {
    const issues = storyboardImageReviewIssues(shot({
      imageReview: { status: "approved", reviewedAt: 1, reasons: [], singleAppearancePassed: false, contentSha256: IMAGE_SHA },
    }));
    expect(issues.join()).toContain("具名角色各只出现一次");
  });

  it("批准但内容指纹缺失/非法=拦", () => {
    const issues = storyboardImageReviewIssues(shot({
      imageReview: { status: "approved", reviewedAt: 1, reasons: [], singleAppearancePassed: true, contentSha256: "nothex" },
    }));
    expect(issues.join()).toContain("内容指纹");
  });

  it("批准+勾选+合法指纹=放行", () => {
    const storyboard = shot({
      imageReview: { status: "approved", reviewedAt: 1, reasons: [], singleAppearancePassed: true, contentSha256: IMAGE_SHA },
    });
    expect(storyboardImageReviewIssues(storyboard)).toEqual([]);
    expect(storyboardImageHumanApproved(storyboard)).toBe(true);
  });
});

describe("verifyStoryboardImageBytes(发车前内容对账)", () => {
  const approved = shot({
    imageReview: { status: "approved", reviewedAt: 1, reasons: [], singleAppearancePassed: true, contentSha256: IMAGE_SHA },
  });

  it("字节与批准指纹一致=放行", async () => {
    await expect(verifyStoryboardImageBytes(approved, IMAGE_B64)).resolves.toEqual([]);
  });

  it("同路径内容被换(哈希不符)=拦", async () => {
    const issues = await verifyStoryboardImageBytes(approved, "b3RoZXI=");
    expect(issues.join()).toContain("不一致");
    expect(issues.join()).toContain("重新人审");
  });

  it("未审镜直接复述结构门 issues(不读字节)", async () => {
    const issues = await verifyStoryboardImageBytes(shot(), IMAGE_B64);
    expect(issues.join()).toContain("未通过人审");
  });

  it("字节不可解码=拦(不误放)", async () => {
    const issues = await verifyStoryboardImageBytes(approved, "%%%bad%%%");
    expect(issues.join()).toContain("指纹计算失败");
  });
});

describe("assertStoryboardImagesHumanReviewed(全章聚合断言)", () => {
  const approved = shot({
    index: 1,
    id: "sb-chapter-001-1",
    imageReview: { status: "approved", reviewedAt: 1, reasons: [], singleAppearancePassed: true, contentSha256: IMAGE_SHA },
  });

  it("全审+无图镜=通过", () => {
    expect(() => assertStoryboardImagesHumanReviewed([
      approved,
      shot({ index: 2, id: "sb-chapter-001-2", mediaRef: undefined }),
    ])).not.toThrow();
  });

  it("任一未审即抛并列出 S 编号(全章节无豁免)", () => {
    expect(() => assertStoryboardImagesHumanReviewed([
      approved,
      shot({ index: 2, id: "sb-chapter-001-2" }),
      shot({ index: 19, id: "sb-chapter-001-19" }),
    ])).toThrow(/2 镜分镜图未通过人审.*S02.*S19/s);
  });
});
