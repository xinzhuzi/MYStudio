import { aiManager } from "@/lib/ai/ai-manager";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  assertImageWorkflowContinuityCapability,
  buildImageWorkflowGenerationRequest,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { withActiveVisualManualStoryboardStyleTokens } from "@/lib/studio/visual-manual-style-tokens";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";
import {
  chapterScopeForWorkflowTarget,
  createWorkflowFilename,
  prepareReferenceImages,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";

/**
 * 单节点生图核心(自 use-image-workflow-generation.generateNode 提取,行为零变化):
 * 组装黄金公式请求→连续性门禁→file:// 参考按需转 dataURL 传输→风格锁→
 * freedomImage→项目内保存→材料入库→成图节点回写,返回最终轻量 URL。
 * 不含:generating/failed 状态置位、toast、分镜回写——由调用方编排
 * (单镜 hook 与分镜面板批量串行 hook 各自决定失败策略)。
 */
export async function runImageWorkflowNodeGeneration(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  input: {
    addMaterial: (material: { name: string; localPath: string; size: number }) => string;
  },
): Promise<{ imageUrl: string }> {
  const request = buildImageWorkflowGenerationRequest(graph, targetNodeId);
  if (!request.prompt.trim()) {
    throw new Error("请先填写生成提示词");
  }
  assertImageWorkflowContinuityCapability(request);

  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) throw new Error("请先选择项目");
  // 资产参考(file://)按需转 dataURL 传输:节点只存轻量 file:// 路径
  // (持久化纪律,防 dataURL 入库 OOM),发送前经 IPC 读受管图转 base64
  // ——与 project-file:// 参考同口径,不落盘。
  const assetBridge = getStudioAssetsBridge();
  const assetRefIdsByUrl = new Map(
    graph.nodes
      .filter((node): node is typeof node & { type: "reference"; imageUrl: string } =>
        node.type === "reference" && Boolean(node.imageUrl?.startsWith("file://"))
        && node.source?.kind === "asset" && Boolean(node.source.id))
      .map((node) => [node.imageUrl as string, (node.source as { id: string }).id]),
  );
  const resolvedReferenceUrls = await Promise.all(request.referenceImages.map(async (url) => {
    const assetId = assetRefIdsByUrl.get(url);
    if (!assetId || !assetBridge?.readImageDataUrl) return url;
    return await assetBridge.readImageDataUrl(assetId).catch(() => null) ?? url;
  }));
  const referenceImages = await prepareReferenceImages(resolvedReferenceUrls);
  // 分镜帧生图接入所选视觉手册风格锁(扩展手册: sanitize+水墨 token);
  // 仅限 storyboard 工作流,自由/资产工作流提示词不做覆盖。
  const prompt = graph.target.kind === "storyboard"
    ? withActiveVisualManualStoryboardStyleTokens(request.prompt)
    : request.prompt;
  const result = await aiManager.freedomImage({
    prompt,
    model: request.model,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    negativePrompt: request.negativePrompt,
    referenceImages,
    extraParams: request.quality === "hd" ? { quality: "hd" } : undefined,
  });
  const node = graph.nodes.find((item) => item.id === targetNodeId);
  const chapterId = chapterScopeForWorkflowTarget(
    graph.target,
    useStudioStore.getState().storyboards,
  );
  const saved = await getProjectFilesBridge()?.saveImage({
    projectId,
    relativePath: workflowImageRelativePath(
      graph.id,
      createWorkflowFilename("gen", targetNodeId, `${node?.title || "workflow-image"}.png`),
      chapterId,
    ),
    source: result.url,
  });
  if (!saved?.success || !saved.url) {
    throw new Error(saved?.error || "项目内图片保存失败");
  }
  const materialId = input.addMaterial({
    name: `${node?.title || "workflow-image"}.png`,
    localPath: saved.url,
    size: saved.size ?? 0,
  });
  // 成图节点回写须基于 store 最新代(参考解析等旁路可能已推进图)
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  const updated = setGeneratedImageResult(latest, targetNodeId, {
    imageUrl: saved.url,
    mediaId: materialId ?? result.mediaId,
  });
  useStudioStore.getState().upsertImageWorkflow(updated);
  return { imageUrl: saved.url };
}
