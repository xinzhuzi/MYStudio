import { useCallback } from "react";
import { toast } from "sonner";
import {
  buildImageWorkflowGenerationRequest,
  setGeneratedImageStatus,
} from "@/lib/studio/image-workflow";
import {
  buildUnclothChainRequest,
  findUnclothUpstream,
} from "@/lib/assist/image-studio/uncloth-request";
import { eventBus } from "@/lib/events/event-bus";
import {
  IMAGE_GENERATION_FAILED_EVENT,
  type ImageGenerationFailedPayload,
} from "@/lib/events/image-generation-events";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";
import { resolveGenerationTargetNodeId } from "./image-workflow-graph-utils";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";

type UseImageWorkflowGenerationOptions = {
  workflowId?: string;
  saveGraph: (graph: ImageWorkflowGraph) => void;
  addMaterial: (input: { name: string; localPath: string; size: number }) => string;
};

export function useImageWorkflowGeneration({
  workflowId,
  saveGraph,
  addMaterial,
}: UseImageWorkflowGenerationOptions) {
  const generateNode = useCallback(async (nodeId: string) => {
    const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === workflowId);
    if (!graph) return;
    const targetNodeId = resolveGenerationTargetNodeId(graph, nodeId);
    if (!targetNodeId) {
      toast.error("未找到要生成的图片节点");
      return;
    }
    // 无衣物链分流预检(09-04 通用化,与图片工作室同源):链的文本来自
    // uncloth 上游,成图直连提示词缺失不是错误——完整链跳过空提示词预检;
    // 有 uncloth 上游但输入不完整时明确指路,绝不静默走普通生成
    const unclothRequest = buildUnclothChainRequest(graph, targetNodeId);
    const hasCompleteUnclothChain = !("error" in unclothRequest);
    if (!hasCompleteUnclothChain && findUnclothUpstream(graph, targetNodeId)) {
      toast.error(unclothRequest.error);
      return;
    }
    // 空 prompt 预检须在置 generating 前(原行为:零状态变化直接返回)
    if (
      !hasCompleteUnclothChain &&
      !buildImageWorkflowGenerationRequest(graph, targetNodeId).prompt.trim()
    ) {
      toast.error("请先填写生成提示词");
      return;
    }
    saveGraph(setGeneratedImageStatus(graph, targetNodeId, "generating"));

    try {
      await runImageWorkflowNodeGeneration(graph, targetNodeId, { addMaterial });
      toast.success("图片已生成并保存到当前项目");
    } catch (error) {
      const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
      const reason = error instanceof Error ? error.message : "生成失败";
      saveGraph(setGeneratedImageStatus(latest, targetNodeId, "failed", reason));
      // 失败提示弹窗化(09-03 用户裁定):不放节点卡,画布层弹窗呈现
      eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
        surface: "image-workflow",
        reason,
      } satisfies ImageGenerationFailedPayload);
    }
  }, [addMaterial, saveGraph, workflowId]);

  return { generateNode };
}
