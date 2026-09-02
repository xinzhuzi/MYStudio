// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { aiManager } from "@/lib/ai/ai-manager";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { maybeAutoDenoiseUrl } from "@/lib/ai/image-auto-denoise";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { useProjectStore } from "@/stores/project/project-store";
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
      ...(input.extraParams ?? {}),
    },
    signal: input.signal,
    transport,
    // 落库由本函数显式管理(saveImageToLocal→媒体库),跳过引擎内媒体库双写
    persistMedia: false,
  });


/** ledger 条目(09-03 弹窗增丰):复原所需输入快照为可选键,读侧宽容旧记录 */
type ProjectLedgerEntry = {
  ts: number;
  prompt: string;
  model: string;
  file: string;
  negativePrompt?: string | null;
  aspectRatio?: string;
  resolution?: string | null;
  references?: string[];
  source?: string;
};

/** 项目内 ledger 追加(09-02 治理):读改写,坏 JSON 重建为空数组 */
async function appendProjectLedger(input: {
  projectId: string;
  relativePath: string;
  entry: ProjectLedgerEntry;
}): Promise<void> {
  const bridge = getProjectFilesBridge();
  if (!bridge?.writeText || !bridge.readText) return;
  let entries: ProjectLedgerEntry[] = [];
  try {
    const existing = await bridge.readText({
      projectId: input.projectId,
      relativePath: input.relativePath,
    });
    const text = typeof existing === "string" ? existing : existing?.text;
    if (text) {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) entries = parsed;
    }
  } catch {
    entries = []; // 坏文件重建
  }
  entries.push(input.entry);
  // `_p/{pid}/…` 虚拟键与读侧(readText {projectId, relativePath})同构:
  // 外部位置项目动态重定向+store 布局收口。旧 `projects/…` 键形式不重定向,
  // 会把台账写进 AppSupport 旧行造成读写分家(09-03 对拍实锤)。
  await bridge.writeText(
    `_p/${input.projectId}/${input.relativePath}`,
    JSON.stringify(entries.slice(-2000), null, 2),
  );
}

function monthFolderOf(url: string): string {
  const match = /\/(\d{4}-\d{2})\//.exec(url);
  return match?.[1] ?? new Date().toISOString().slice(0, 7);
}

function filenameOf(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  return clean.slice(clean.lastIndexOf("/") + 1) || "image.png";
}

  const projectId = useProjectStore.getState().activeProjectId;
  const persistToLocal = async (url: string): Promise<string | null> => {
    // 生图落库自动去噪(设置开关控制;未启用/失败原样返回)
    const denoised = await maybeAutoDenoiseUrl(url);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const filename = `studio_${safeFilenameSeed(request.prompt)}_${Date.now()}.png`;
    // 项目作用域正源(09-02 生成记录治理,对齐 cloud 链 08-30 副本库退役通道):
    // 落当前项目 media/ai-image/YYYY-MM/(project-file://,随项目走);
    // 无活动项目=禁落盘(绝不回退 userData 应用级旧路径——该位置已裁定退役)。
    if (!projectId) {
      throw new Error("请先选择项目(生成图落项目内存储)");
    }
    const projectFiles = getProjectFilesBridge();
    if (!projectFiles?.saveImage) {
      throw new Error("项目文件桥不可用,无法落盘");
    }
    const saved = await projectFiles.saveImage({
      projectId,
      relativePath: `media/ai-image/${month}/${filename}`,
      source: denoised,
    }).catch(() => undefined);
    if (!saved?.success || !saved.url) {
      // 落盘失败返回 null:远程 URL 走 chat 重试链;两次失败降级原始地址
      // (媒体库内部异步下载是第二落盘机会)——绝不回退 userData 旧路径
      return null;
    }
    return saved.url;
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
  // 磁盘 ledger(09-02 治理):与图片同存项目内,永不与图脱钩;localStorage
  // 历史不再作为唯一索引(50 条上限丢记录的根修)。失败不阻断返回。
  const ledgerRelative = stableUrl
    ? `media/ai-image/${monthFolderOf(stableUrl)}/ledger.json`
    : null;
  if (projectId && ledgerRelative && stableUrl) {
    void appendProjectLedger({
      projectId,
      relativePath: ledgerRelative,
      entry: {
        ts: Date.now(),
        prompt: request.prompt,
        model: request.model ?? "",
        file: `${monthFolderOf(stableUrl)}/${filenameOf(stableUrl)}`,
        negativePrompt: request.negativePrompt ?? null,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution ?? null,
        references: request.referenceImages,
        source: "image-studio-canvas",
      },
    }).catch(() => {
      // ledger 写失败静默(下次生成重试;面板回落 localStorage)
    });
  }
  return {
    imageUrl: finalUrl,
    mediaId,
    persisted: stableUrl !== null,
    prompt: request.prompt,
    model: request.model,
  };
}
