// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ImageWorkflowGeneratedNode } from "@/types/studio";

/**
 * 节点当前生效的整组图(批量保存/下载/组显示的统一数据源)。
 *
 * 不变量:imageBatch 只在 resultUrl 仍是组内一张图时生效——超分会把
 * resultUrl 换轨成 up4x- 新文件、单张重新生成会写入组外新图,两者之后
 * 旧 batch 即陈旧;此时一切消费回落 [resultUrl],防止旧组冒充新结果
 * (深审 P1-1)。setBatchPrimary 换主图=组内精确等值回写,不变量保持。
 */
export function effectiveBatchImages(node: ImageWorkflowGeneratedNode): string[] {
  const batch = node.imageBatch?.images ?? [];
  if (batch.length > 0 && node.resultUrl && batch.includes(node.resultUrl)) {
    return batch;
  }
  return node.resultUrl ? [node.resultUrl] : [];
}
