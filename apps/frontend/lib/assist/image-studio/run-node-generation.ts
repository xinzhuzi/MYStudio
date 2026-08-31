// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { aiManager } from "@/lib/ai/ai-manager";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { maybeAutoDenoiseUrl } from "@/lib/ai/image-auto-denoise";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { readImageAsBase64, saveImageToLocal, type ImageCategory } from "@/lib/media/image-storage";
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";
import type { ImageWorkflowGraph } from "@/types/studio";
import { buildImageStudioGenerationRequest } from "./request";

/**
 * 图片工作室单节点生图核心(自由画布)。
 *
 * 与分镜链 runImageWorkflowNodeGeneration 的分工:无资产圣经/风格锁/连续性
 * 门禁/VLM 闸门(那些是分镜生产域的);落盘走应用级媒体库 local-image://
 * (画布与项目解耦,无打开项目也能用),而不是项目内 projectFiles。
 * 不含 generating/failed 状态置位与 toast——由 UI hook 编排。
 */

/** 媒体库 ai-image 分类实际落在 local-image://ai-image/(分类字面量随媒体库口径) */
const AI_IMAGE_CATEGORY = "ai-image" as ImageCategory;

export interface RunImageStudioNodeGenerationInput {
  /** 模型专属附加参数(Midjourney speed/stylization、Ideogram render_speed/style 等) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraParams?: Record<string, any>;
  signal?: AbortSignal;
}

export interface RunImageStudioNodeGenerationResult {
  /** 节点回写地址:优先 local-image:// 稳定地址;两次落盘都失败时降级原始 URL */
  imageUrl: string;
  mediaId?: string;
  /** imageUrl 是否为稳定受管地址(local-image:// 或 project-file://) */
  persisted: boolean;
  prompt: string;
  model?: string;
}

function safeFilenameSeed(prompt: string): string {
  return prompt.slice(0, 24).replace(/[^\w\u4e00-\u9fff]+/g, "_").slice(0, 24) || "studio";
}

export async function runImageStudioNodeGeneration(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  input: RunImageStudioNodeGenerationInput = {},
): Promise<RunImageStudioNodeGenerationResult> {
  const request = buildImageStudioGenerationRequest(graph, targetNodeId);
  if (!request.prompt) {
    throw new Error("请先填写生成提示词");
  }
  // 参考图(受管 scheme)→ base64 dataURL 传输;引擎层再做 768px/1MB 缩略
  const referenceImages = await prepareImageWorkflowReferenceImages(request.referenceImages, {
    readProjectFileAsBase64: async (url) =>
      (await getProjectFilesBridge()?.readAsBase64(url)) ?? undefined,
    readLocalImageAsBase64: readImageAsBase64,
  });

  const buildParams = (transport?: "chat") => ({
    prompt: request.prompt,
    model: request.model,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    negativePrompt: request.negativePrompt,
    referenceImages,
    extraParams: {
      ...(request.quality === "hd" ? { quality: "hd" } : {}),
      ...(input.extraParams ?? {}),
    },
    signal: input.signal,
    transport,
    // 落库由本函数显式管理(saveImageToLocal→媒体库),跳过引擎内媒体库双写
    persistMedia: false,
  });

  const persistToLocal = async (url: string): Promise<string | null> => {
    // 生图落库自动去噪(设置开关控制;未启用/失败原样返回)
    const denoised = await maybeAutoDenoiseUrl(url);
    const filename = `studio_${safeFilenameSeed(request.prompt)}_${Date.now()}.png`;
    const saved = await saveImageToLocal(denoised, AI_IMAGE_CATEGORY, filename);
    return saved.startsWith("local-image://") || saved.startsWith("project-file://")
      ? saved
      : null;
  };

  let generated = await aiManager.generateImage(buildParams());
  let stableUrl = await persistToLocal(generated.url);
  if (!stableUrl && /^https?:/i.test(generated.url)) {
    // images 端点已成功(已计费)但远程 URL 下载失败——chat 形态 base64
    // 直返重试一次再落盘(与分镜链同策略)
    generated = await aiManager.generateImage(buildParams("chat"));
    stableUrl = await persistToLocal(generated.url);
  }
  const finalUrl = stableUrl ?? generated.url;
  // 媒体库记录:传入受管地址时 addMediaFromUrl 跳过异步下载、条目地址即刻
  // 稳定;降级传远程 URL 时其内部会后台下载并改写条目地址(第二落盘机会)
  const mediaId = saveToMediaLibrary(finalUrl, request.prompt, "ai-image");
  return {
    imageUrl: finalUrl,
    mediaId,
    persisted: stableUrl !== null,
    prompt: request.prompt,
    model: request.model,
  };
}
