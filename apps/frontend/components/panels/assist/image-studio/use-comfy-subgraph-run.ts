// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import {
  compileComfySubgraph,
  type ComfySubgraphNodeInput,
} from "@/lib/assist/image-studio/comfy-subgraph-compiler";
import {
  comfyImageUrlToB64,
  comfySidecarJson,
  comfyUpstreamImageUrlOf,
  persistComfyImage,
  runComfyExecute,
} from "@/lib/assist/image-studio/comfy-execute";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import { collapseTransparentNodes } from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowNode } from "@/types/studio";

/**
 * 子图运行编排(09-08 三期收官,流X):画布选中含 comfy-generic 的选区 →
 * 编译器 → /comfy/execute → 末端节点回图(mediaRef 模式,照工作流节点口径)。
 * 编译错误大白话 toast(环/口类型不匹配/上游未就绪),不静默降级。
 */

/** 画布节点 → 编译器输入投影(仅取编译所需字段) */
function toCompilerNode(node: ImageWorkflowNode): ComfySubgraphNodeInput {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ...(node.type === "comfy-generic"
      ? { classType: node.classType, descriptor: node.descriptor, widgetValues: node.widgetValues }
      : {}),
    ...(node.type === "reference" ? { imageUrl: node.imageUrl } : {}),
    ...(node.type === "generated" || node.type === "uncloth" || node.type === "comfy-workflow" || node.type === "comfy-generic"
      ? { resultUrl: node.resultUrl }
      : {}),
    ...(node.type === "prompt" ? { prompt: node.prompt, negativePrompt: node.negativePrompt } : {}),
  };
}

export function useComfySubgraphRun() {
  return useCallback(async (selectedIds: string[]) => {
    const store = useImageStudioStore.getState();
    const graph = selectActiveImageStudioWorkflow(store);
    if (!graph || selectedIds.length === 0) return;
    // 09-09 透明节点塌缩(reroute 直通/bypassed 穿线)后再投影:旁路节点与
    // 中转点不进编译节点表,但其语义已经在塌缩边里生效(图进图出/文进文出)。
    const collapsed = collapseTransparentNodes(graph);
    const compile = compileComfySubgraph({
      nodes: collapsed.nodes
        .filter((node) => node.bypassed !== true && node.type !== "reroute")
        .map(toCompilerNode),
      edges: collapsed.edges,
      selection: selectedIds,
    });
    if (!compile.ok) {
      toast.error(compile.error);
      return;
    }
    compile.terminals.forEach((terminal) =>
      useImageStudioStore.getState().setComfyNodeStatus(terminal.canvasNodeId, "running"),
    );
    try {
      const images: Array<{ key: string; name: string; b64: string }> = [];
      for (const pending of compile.pendingImages) {
        const source = collapsed.nodes.find((node) => node.id === pending.sourceNodeId);
        const url = comfyUpstreamImageUrlOf(source);
        if (!url) throw new Error(`上游「${source?.title ?? pending.sourceNodeId}」的图不见了,重新连一下再运行`);
        images.push({ key: pending.key, name: pending.name, b64: await comfyImageUrlToB64(url) });
      }
      toast.info(`子图开始执行(${compile.nodeCount} 个效果节点,本地引擎可能要跑一会儿)`);
      const result = await runComfyExecute({ graph: compile.graph, inputs: { strings: {}, images } });
      let okCount = 0;
      for (const terminal of compile.terminals) {
        const image = (result.images ?? []).find((item) => item.nodeId === terminal.saveNodeId)
          ?? (result.images ?? [])[0];
        if (!image) {
          useImageStudioStore.getState().setComfyNodeStatus(terminal.canvasNodeId, "failed", "这次运行没有这张输出");
          continue;
        }
        const persisted = await persistComfyImage(image.b64, terminal.nodeTitle);
        useImageStudioStore.getState().setComfyNodeResult(terminal.canvasNodeId, {
          resultUrl: persisted.url ?? `data:image/png;base64,${image.b64}`,
          resultMediaId: persisted.mediaId,
        });
        okCount += 1;
      }
      toast.success(`子图完成:${okCount}/${compile.terminals.length} 个末端节点出图`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "子图执行失败";
      compile.terminals.forEach((terminal) =>
        useImageStudioStore.getState().setComfyNodeStatus(terminal.canvasNodeId, "failed", message),
      );
      toast.error(message);
    }
  }, []);
}

/** 高级层全量 classType 清单拉取(效果节点弹窗;引擎未跑给空数组回落策展) */
export async function fetchEngineClassTypes(): Promise<string[]> {
  const reply = await comfySidecarJson<{ classTypes?: string[] | null }>(
    "GET",
    "/comfy/engine/object-info",
    { timeoutMs: 30_000 },
  );
  return reply.classTypes ?? [];
}
