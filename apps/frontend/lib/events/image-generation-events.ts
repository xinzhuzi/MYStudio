// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 生图失败事件契约(09-03 用户裁定:失败提示弹窗化,不放节点卡)。
 * 编排层(画布生成 hook)失败时经 eventBus 广播;画布视图挂载的
 * GenerationFailedDialog 按 surface 过滤后弹窗呈现。
 */

export type GenerationFailedSurface = "image-studio" | "image-workflow";

export interface ImageGenerationFailedPayload {
  surface: GenerationFailedSurface;
  reason: string;
}

export const IMAGE_GENERATION_FAILED_EVENT = "image:generation-failed";
