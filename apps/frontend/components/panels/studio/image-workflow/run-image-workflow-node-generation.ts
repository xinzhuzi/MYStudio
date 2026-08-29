import { aiManager } from "@/lib/ai/ai-manager";
import { maybeAutoDenoiseUrl } from "@/lib/ai/image-auto-denoise";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
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
 * generateImage→项目内保存→材料入库→成图节点回写,返回最终轻量 URL。
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
    ? await compileActiveDaojieStoryboardFramePrompt(
        hardenReferenceAnchors(stripCompiledFrameRedundantSections(styledPrompt)))
    : null;
  const node = graph.nodes.find((item) => item.id === targetNodeId);
  const chapterId = chapterScopeForWorkflowTarget(
    graph.target,
    useStudioStore.getState().storyboards,
  );
  const buildRequest = (transport?: "chat") => ({
    prompt: compiledFrame?.providerPrompt ?? styledPrompt,
    model: request.model,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    negativePrompt: compiledFrame ? undefined : request.negativePrompt,
    promptPolicy: (compiledFrame ? "raw" : undefined) as "raw" | undefined,
    referenceImages,
    extraParams: request.quality === "hd" ? { quality: "hd" } : undefined,
    transport,
    // 分镜/工作流成图自存项目真源(projectFiles.saveImage),跳过媒体库副本双写
    persistMedia: false,
  });
  const generateAndSave = async (transport?: "chat") => {
    const generated = await aiManager.generateImage(buildRequest(transport));
    // 生图落库自动去噪(噪点治理 08-29):开关开启时,成图在写入项目
    // workflow-images 前先过轻度双边滤波;失败原样保存(fail-open)。
    const denoisedSource = await maybeAutoDenoiseUrl(generated.url);
    const saved = await getProjectFilesBridge()?.saveImage({
      projectId,
      relativePath: workflowImageRelativePath(
        graph.id,
        createWorkflowFilename("gen", targetNodeId, `${node?.title || "workflow-image"}.png`),
        chapterId,
      ),
      source: denoisedSource,
    });
    return { generated, saved };
  };
  let { generated: result, saved } = await generateAndSave();
  if ((!saved?.success || !saved.url) && /^https?:/i.test(result.url)) {
    // 08-24 结构修复:images 端点已成功(生成已计费)但远程 URL 下载失败
    // (晚高峰 CDN 504/网关过载)——旧路径直接抛错丢图。此处回退 chat 形态
    // 重试一次:base64 data-URL 直返、不经 CDN,保存走主进程 dataURL 解析。
    // 08-25 日志补齐:回退事件入 diagnostics(此前仅 console,排障盲区)。
    void logEvent({
      level: "warn",
      category: "ai",
      operationId: createOperationId("image-workflow-url-save-fallback"),
      message: "Image URL save failed, falling back to chat base64 retry",
      context: {
        workflowId: graph.id,
        targetNodeId,
        saveError: (saved?.error || "").slice(0, 200),
        remoteUrlPrefix: result.url.slice(0, 100),
      },
    });
    console.warn(
      "[image-workflow] 成图 URL 保存失败(下载类),回退 chat base64 重试一次:",
      saved?.error || result.url.slice(0, 80),
    );
    ({ generated: result, saved } = await generateAndSave("chat"));
  }
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

/**
 * 参考身份硬锚(2026-08-25 参考遵循度抽检根修): chat 回退通道对参考图遵循
 * 偏松+文字锚点段已剥离,人物细节漂移(S44 白发画成黑发/S4 赵四形象漂移
 * 实证)。发送时把 @图N 头段升级为硬锚句式,幂等(已是硬锚不再加),仅作用于
 * 头段的绑定行,不改正文/不涨字数门(每行+~8 字,82 镜最大头段 4 行≈32 字)。
 */
function hardenReferenceAnchors(prompt: string): string {
  return prompt.replace(
    // 名字段允许半角分号:复合资产名「李先生;管事」不可再截断(08-28 无色根修),
    // 全角「；」仍是参考行分隔符、半/全角逗号仍排除。
    /@图(\d+)\s*为([^,，；\n]*?)(角色|场景|道具)(?![^\n]*一致)/g,
    (_line, num: string, name: string, kind: string) =>
      `@图${num} 为${name}${kind}，外观须与@图${num}一致`,
  );
}
