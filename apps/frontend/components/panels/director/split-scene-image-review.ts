// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 导演域(SplitScene/S 类组)分镜图人审判定(1125 硬门):
 * approved 记录在位才放行出视频;图片一变经 updateSplitSceneImage/级联自动回待审。
 * S 类组视频由组内场景图合成 → 组门=组内每张场景图均过审。
 */
import type { SplitScene } from "@/stores/director/director-store";

export function splitSceneImageReviewApproved(
  scene: Pick<SplitScene, "imageReview"> | undefined,
): boolean {
  return scene?.imageReview?.status === "approved";
}

export function splitSceneImageReviewIssue(
  scene: Pick<SplitScene, "id" | "imageReview"> | undefined,
): string | null {
  if (!scene) return null;
  if (splitSceneImageReviewApproved(scene)) return null;
  if (scene.imageReview?.status === "rejected") {
    const reason = scene.imageReview.reasons[0] ? `:${scene.imageReview.reasons[0]}` : "";
    return `场景 ${scene.id + 1} 的分镜图已被人工驳回${reason}——重新生成或重审后再出视频`;
  }
  return `场景 ${scene.id + 1} 的分镜图未通过人审——请先在卡片上通过人审`;
}
