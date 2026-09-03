// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  findPromptNodeForGenerated,
  getGeneratedNode,
} from "@/lib/studio/image-workflow/graph-build";
import { orderedReferenceSources } from "@/lib/assist/image-studio/reference-order";
import type {
  ImageWorkflowGraph,
} from "@/types/studio";

/**
 * 图片工作室(辅助面板·自由画布)的生图请求组装。
 *
 * 与分镜链 `buildImageWorkflowGenerationRequest` 的分工:分镜链带资产圣经
 * 连续性契约/多参考排序 manifest/风格锁,自由画布一概不注入——提示词、
 * 负面词原样透传,参考图按连线顺序收集。模型/画幅/分辨率参数权威在
 * 成图节点(graph-build.addGeneratedImageNode 恒置 paramsEdited)。
 */
export interface ImageStudioGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio: string;
  resolution?: string;
  /** 参考图地址(受管 scheme):参考图节点 imageUrl + 上游成图 resultUrl,按连线顺序 */
  referenceImages: string[];
}

/** 成图节点的生成模式显式判定(09-03 用户裁定:t2i/i2i 参数不混淆,
 * 一个节点必须能无歧义判断自己是纯文生图还是图生图)。
 * emptyReferences>0 = 挂着空参考图/未生成上游——此态下静默过滤会让
 * "图生图组"实际走文生图通道,是歧义源,调用方应阻断并指路。 */
export interface ImageStudioGenerationMode {
  mode: "text-to-image" | "image-to-image";
  /** 已就绪参考输入数(非空参考图+有结果的上游成图) */
  readyReferences: number;
  /** 挂边但不可用的参考输入数(空参考图节点/未生成的上游成图) */
  emptyReferences: number;
}

export function classifyImageStudioGeneration(
  graph: ImageWorkflowGraph,
  nodeId: string,
): ImageStudioGenerationMode {
  const sources = orderedReferenceSources(graph, nodeId);
  let readyReferences = 0;
  let emptyReferences = 0;
  for (const source of sources) {
    const url =
      source.type === "reference" ? source.imageUrl : source.type === "generated" ? source.resultUrl : "";
    if (url) readyReferences += 1;
    else emptyReferences += 1;
  }
  return {
    mode: readyReferences > 0 ? "image-to-image" : "text-to-image",
    readyReferences,
    emptyReferences,
  };
}

export function buildImageStudioGenerationRequest(
  graph: ImageWorkflowGraph,
  nodeId: string,
): ImageStudioGenerationRequest {
  const node = getGeneratedNode(graph, nodeId);
  const promptNode = findPromptNodeForGenerated(graph, nodeId);
  const promptSource = promptNode ?? node;
  // 参考源顺序=编号单源(reference-order:位置序)——节点显示的「参考图 N」
  // 与发往引擎的数组下标同源;本地 Krea2 只吃第 1 张=画布最上面的参考图
  const orderedSources = orderedReferenceSources(graph, nodeId);
  const referenceImages = orderedSources.flatMap((source) => {
    if (source.type === "reference" && source.imageUrl) return [source.imageUrl];
    // 链式图生图:上游成图结果作为参考图(与分镜链 previous-approved-frame 同语义)
    if (source.type === "generated" && source.resultUrl) return [source.resultUrl];
    return [];
  });

  return {
    prompt: promptSource.prompt.trim(),
    negativePrompt: promptSource.negativePrompt?.trim() || undefined,
    model: node.model ?? promptSource.model,
    aspectRatio: node.aspectRatio,
    resolution: node.resolution ?? promptSource.resolution,
    referenceImages,
  };
}
