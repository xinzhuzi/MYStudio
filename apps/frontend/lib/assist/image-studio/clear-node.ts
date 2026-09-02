// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { findPromptNodeForGenerated } from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";

/**
 * 右键「清空内容」计划(09-02 用户需求,09-02 深审后抽取为纯函数):
 * 清理文本框+该节点已存在/已生成的图片,节点本身保留。
 * - 成图节点:内联提示词/反向词+结果图(含批量组)全部清空、状态复位;
 *   若连线了提示词节点,卡内文本框显示的是它的正文——一并清(所见即所清)。
 * - 提示词节点:清正文/反向词;参考图节点:清图。
 * - 生成中/排队中:busy(在途结果会回写,清了白发,应先停止)。
 */
export type NodeClearPlan =
  | { busy: true }
  | { busy: false; targets: { nodeId: string; updates: Partial<ImageWorkflowNode> }[] };

export function buildNodeClearPlan(graph: ImageWorkflowGraph, nodeId: string): NodeClearPlan {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return { busy: false, targets: [] };
  if (node.type === "generated") {
    if (node.status === "generating" || node.status === "queued") return { busy: true };
    const targets: { nodeId: string; updates: Partial<ImageWorkflowNode> }[] = [
      {
        nodeId: node.id,
        updates: {
          prompt: "",
          negativePrompt: "",
          resultUrl: undefined,
          resultMediaId: undefined,
          imageBatch: undefined,
          status: "idle",
          errorReason: undefined,
          generatedAt: undefined,
        } as Partial<ImageWorkflowNode>,
      },
    ];
    const promptNode = findPromptNodeForGenerated(graph, node.id);
    if (promptNode) {
      targets.unshift({
        nodeId: promptNode.id,
        updates: { prompt: "", negativePrompt: "" } as Partial<ImageWorkflowNode>,
      });
    }
    return { busy: false, targets };
  }
  if (node.type === "prompt") {
    return {
      busy: false,
      targets: [
        { nodeId: node.id, updates: { prompt: "", negativePrompt: "" } as Partial<ImageWorkflowNode> },
      ],
    };
  }
  if (node.type === "reference") {
    return {
      busy: false,
      targets: [{ nodeId: node.id, updates: { imageUrl: "" } as Partial<ImageWorkflowNode> }],
    };
  }
  return { busy: false, targets: [] };
}
