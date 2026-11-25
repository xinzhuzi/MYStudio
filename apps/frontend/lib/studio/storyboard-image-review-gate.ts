// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 分镜图人审硬门(1125 用户令「分镜图,必须人审的」「所有出视频的入口都拦」):
 * 未通过图片级人审(imageReview approved + 具名角色各只出现一次 + 内容哈希
 * 对账)的镜不得出视频——全章节、无章级豁免;VLM/自动结论永不计为批准。
 *
 * 本库是全部入口(H3 步/画布直开/Remotion/引擎快照/章验收)共用的单一判据
 * 真源;库保持纯函数(字节进),读盘管道留在调用点(comfyImageUrlToB64 /
 * readStoryboardImageB64)。与 visualReview 严格连续性契约分轨,互不放松。
 */
import type { StoryboardItem } from "@/types/studio-storyboard-types";
import { isValidSha256Hex, sha256FromBase64Image } from "./image-content-hash";

/** 门禁结构判定(同步):非空 issues=拦。无图镜不属本门(返回空)。 */
export function storyboardImageReviewIssues(
  storyboard: Pick<StoryboardItem, "id" | "mediaRef" | "imageReview">,
): string[] {
  const media = storyboard.mediaRef;
  if (media?.kind !== "image" || !media.path?.trim()) return [];
  const review = storyboard.imageReview;
  if (!review) {
    return [`镜头 ${storyboard.id} 的分镜图未通过人审(待审)——所有章节出视频前必须逐镜人审`];
  }
  if (review.status === "rejected") {
    const reason = review.reasons[0] ? `:${review.reasons[0]}` : "";
    return [`镜头 ${storyboard.id} 的分镜图已被人工驳回${reason}——修改图片后须重新人审`];
  }
  if (review.status !== "approved") return [`镜头 ${storyboard.id} 的分镜图未通过人审(待审)`];
  if (!review.singleAppearancePassed) {
    return [`镜头 ${storyboard.id} 的人审记录缺「具名角色各只出现一次」确认——须重新人审`];
  }
  if (!isValidSha256Hex(review.contentSha256)) {
    return [`镜头 ${storyboard.id} 的人审记录缺少图片内容指纹——须重新人审`];
  }
  return [];
}

/** 该镜当前是否被人审硬门放行(引擎快照 humanApproved 位/章验收计数共用)。 */
export function storyboardImageHumanApproved(
  storyboard: Pick<StoryboardItem, "id" | "mediaRef" | "imageReview">,
): boolean {
  return storyboardImageReviewIssues(storyboard).length === 0;
}

/** 发车前内容对账:对已批准镜,用实际字节哈希核对批准指纹;不符=图已被换,
 *  旧批准作废语义(拦)。返回追加 issues(结构门已过才调)。 */
export async function verifyStoryboardImageBytes(
  storyboard: Pick<StoryboardItem, "id" | "mediaRef" | "imageReview">,
  imageBase64: string,
): Promise<string[]> {
  if (storyboardImageReviewIssues(storyboard).length > 0) {
    return storyboardImageReviewIssues(storyboard);
  }
  const review = storyboard.imageReview!;
  let actual: string;
  try {
    actual = await sha256FromBase64Image(imageBase64);
  } catch {
    return [`镜头 ${storyboard.id} 图片内容指纹计算失败——无法核对是否仍为人审通过的原图`];
  }
  if (actual !== review.contentSha256) {
    return [`镜头 ${storyboard.id} 的图片内容与人审批准时不一致(图已被替换)——请重新人审后再出视频`];
  }
  return [];
}

/** 全章聚合断言(Remotion prepareChapterMedia 用):任一有图镜未过人审即抛,
 *  报错列出全部未审镜的 S 编号;全章节无豁免。 */
export function assertStoryboardImagesHumanReviewed(
  storyboards: Pick<StoryboardItem, "id" | "index" | "mediaRef" | "imageReview">[],
): void {
  const blocked = storyboards
    .filter((storyboard) => storyboardImageReviewIssues(storyboard).length > 0)
    .map((storyboard) => `S${String(storyboard.index).padStart(2, "0")}(${storyboard.id})`);
  if (blocked.length > 0) {
    throw new Error(
      `本章有 ${blocked.length} 镜分镜图未通过人审,禁止出视频(全章节硬门):${blocked.join("、")}` +
        "——请在工作台「人审」区逐镜看图通过后再发车",
    );
  }
}
