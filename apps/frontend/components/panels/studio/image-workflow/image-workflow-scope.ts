import type { ImageWorkflowGraph, ImageWorkflowOpenContext } from "@/types/studio";

/**
 * 图片工作流画布的作用域裁定(08-30 用户裁定:上下文强隔离):
 * - storyboard:从分镜进入(分镜面板卡片/切换器)——画布只属于分镜域,
 *   只展示本章分镜,不提供新建。
 * - library:非分镜入口(工作流 tab 直进/资产卡片)——只展示资产/自由
 *   工作流,不展示分镜;分镜的浏览一律回分镜面板。
 */
export type ImageWorkflowScope = "storyboard" | "library";

export function resolveImageWorkflowScope(
  initialAssetContext?: ImageWorkflowOpenContext,
): ImageWorkflowScope {
  return initialAssetContext?.target.kind === "storyboard" ? "storyboard" : "library";
}

/** 非分镜域可选的流:资产/素材/自由(分镜流一律不在 library 域列出) */
export function libraryImageWorkflows(imageWorkflows: ImageWorkflowGraph[]): ImageWorkflowGraph[] {
  return imageWorkflows.filter((graph) => graph.target.kind !== "storyboard");
}
