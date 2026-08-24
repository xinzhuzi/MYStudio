import { aiManager } from "@/lib/ai/ai-manager";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  assertImageWorkflowContinuityCapability,
  buildImageWorkflowGenerationRequest,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import {
  compileActiveDaojieStoryboardFramePrompt,
  withActiveVisualManualStoryboardStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
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
 * 编译形态冗余段剥离(800 门死锁解除): 只剥 request 组装层为「自由画布可读
 * 提示词」内嵌的参考锚点段——编译链的参考约束走 @图N+图本体+帧负面,这些段
 * 在该形态下纯冗余且必然撑爆 800 门。非编译链(enhanced)不受影响。
 */
function stripCompiledFrameRedundantSections(prompt: string): string {
  return prompt
    .replace(/【多视图身份锁】[^【]*/g, "")
    .replace(/【资产圣经】[^【]*/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

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
  // 资产参考(file:// 与 asset-file://)按需转 dataURL 传输:节点只存轻量
  // 虚拟/受管路径(持久化纪律,防 dataURL 入库 OOM),发送前经 IPC 读受管图
  // 转 base64——与 project-file:// 参考同口径,不落盘。
  const assetBridge = getStudioAssetsBridge();
  const assetRefIdsByUrl = new Map(
    graph.nodes
      .filter((node): node is typeof node & { type: "reference"; imageUrl: string } =>
        node.type === "reference"
        && Boolean(
          node.imageUrl?.startsWith("file://")
          || node.imageUrl?.startsWith("asset-file://")
          || node.imageUrl?.startsWith("/"),
        )
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
  const styledPrompt = graph.target.kind === "storyboard"
    ? withActiveVisualManualStoryboardStyleTokens(request.prompt)
    : request.prompt;
  // 道劫手册:分镜帧最终正文经 ma-gongbi-v1 编译(唯一 Avoid+负面唯一所有者+800 门)后
  // 以 raw 策略直传;非道劫(或非分镜)保持既有 enhanced 传输与分离负面。
  // 800 门死锁解除(08-24 实证): request 组装层内嵌的【资产圣经】【多视图身份锁】
  // 锚点段(~800+ 字符)会把任何正文顶爆 800 门(203 正文+锚点=1277 仍拒)。编译形
  // 态下参考约束已由 @图N 标记+参考图本体+帧负面承担,锚点段冗余——进编译前剥离
  // (S08 直连同款口径实证: 无锚点段+@图N+4 参考图=形象六项全对)。
  const compiledFrame = graph.target.kind === "storyboard"
    ? await compileActiveDaojieStoryboardFramePrompt(stripCompiledFrameRedundantSections(styledPrompt))
    : null;
  const result = await aiManager.freedomImage({
    prompt: compiledFrame?.providerPrompt ?? styledPrompt,
    model: request.model,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    negativePrompt: compiledFrame ? undefined : request.negativePrompt,
    promptPolicy: compiledFrame ? "raw" : undefined,
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
