// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { ComfyCanvasSwap } from "./comfy-canvas/ComfyCanvasSwap";

/**
 * 图片工作室(辅助面板·第一 Tab)。
 *
 * 09-09 换代批6 终态:画布=ComfyUI(旧 React Flow 画布已退役删除;
 * 存量数据冻结在 store,工作流库「导入存量画布」一键入 ComfyUI)。
 * 本文件只做壳,保持 FreedomView 的既有导入路径不变。
 */
export function ImageStudio() {
  return <ComfyCanvasSwap title="图片工作室画布 · ComfyUI" />;
}
