import type { ImageWorkflowGraph, ImageWorkflowOpenContext } from "@/types/studio";

/**
 * 图片工作流画布的作用域裁定(08-30 用户裁定:上下文强隔离+默认分镜):
 * - storyboard(默认):无上下文直进(工作流 tab)或从分镜进入——画布默认
 *   就是分镜节点图,只展示本章分镜,不提供新建。
 * - library:资产入口(资产卡片)——只展示资产/自由工作流,不展示分镜。
 */
export type ImageWorkflowScope = "storyboard" | "library";

export function resolveImageWorkflowScope(
  initialAssetContext?: ImageWorkflowOpenContext,
): ImageWorkflowScope {
  return initialAssetContext?.target.kind === "asset" || initialAssetContext?.target.kind === "material"
    ? "library"
    : "storyboard";
}

/** 非分镜域可选的流:资产/素材/自由(分镜流一律不在 library 域列出) */
export function libraryImageWorkflows(imageWorkflows: ImageWorkflowGraph[]): ImageWorkflowGraph[] {
  return imageWorkflows.filter((graph) => graph.target.kind !== "storyboard");
}
