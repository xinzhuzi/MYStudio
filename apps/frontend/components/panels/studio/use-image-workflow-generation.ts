import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  assertImageWorkflowContinuityCapability,
  buildImageWorkflowGenerationRequest,
  setGeneratedImageResult,
  setGeneratedImageStatus,
} from "@/lib/studio/image-workflow";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";
import {
  createWorkflowFilename,
  prepareReferenceImages,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";
import { resolveGenerationTargetNodeId } from "./image-workflow-graph-utils";

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
    const request = buildImageWorkflowGenerationRequest(graph, targetNodeId);
    if (!request.prompt.trim()) {
      toast.error("请先填写生成提示词");
      return;
    }
    assertImageWorkflowContinuityCapability(request);
    saveGraph(setGeneratedImageStatus(graph, targetNodeId, "generating"));

    try {
      const projectId = useProjectStore.getState().activeProjectId;
      if (!projectId) throw new Error("请先选择项目");
      const referenceImages = await prepareReferenceImages(request.referenceImages);
      const result = await aiManager.freedomImage({
        prompt: request.prompt,
        model: request.model,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        negativePrompt: request.negativePrompt,
        referenceImages,
        extraParams: request.quality === "hd" ? { quality: "hd" } : undefined,
      });
      const node = graph.nodes.find((item) => item.id === targetNodeId);
      const saved = await window.projectFiles?.saveImage({
        projectId,
        relativePath: workflowImageRelativePath(
          graph.id,
          createWorkflowFilename("gen", targetNodeId, `${node?.title || "workflow-image"}.png`),
        ),
        source: result.url,
      });
      if (!saved?.success || !saved.url) {
        throw new Error(saved?.error || "项目内图片保存失败");
      }
      const materialId = addMaterial({
        name: `${node?.title || "workflow-image"}.png`,
        localPath: saved.url,
        size: saved.size ?? 0,
      });
      const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
      saveGraph(setGeneratedImageResult(latest, targetNodeId, {
        imageUrl: saved.url,
        mediaId: materialId ?? result.mediaId,
      }));
      toast.success("图片已生成并保存到当前项目");
    } catch (error) {
      const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
      saveGraph(setGeneratedImageStatus(
        latest,
        targetNodeId,
        "failed",
        error instanceof Error ? error.message : "生成失败",
      ));
      toast.error(error instanceof Error ? error.message : "生成失败");
    }
  }, [addMaterial, saveGraph, workflowId]);

  return { generateNode };
}
