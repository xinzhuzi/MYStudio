// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { toast } from "sonner";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { appendProjectLedger, ledgerFilenameOf, ledgerMonthFolderOf } from "./history-records";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { useProjectStore } from "@/stores/project/project-store";
import type { UnclothChainRequest } from "./uncloth-request";

/**
 * 无衣物链执行(09-04-krea2-uncloth-node):sidecar 专用端点跑完整管线
 * (双分割+两遍采样),结果落项目内→回写成图节点(直通)+uncloth 节点回显。
 * 不含 generating/failed 状态置位与 toast——由 UI hook 编排。
 */

const LOCAL_IMAGE_BASE_URL = "http://127.0.0.1:17595";
const LOCAL_IMAGE_TOKEN = "manying-local-image";

export interface RunUnclothResult {
  imageUrl: string;
  mediaId?: string;
}

export async function runUnclothChain(
  request: UnclothChainRequest,
): Promise<RunUnclothResult> {
  // sidecar 自愈(普通生成链同款):缺席/僵尸时先拉起,裸 fetch 会连接拒绝
  const { ensureLocalImageSidecarRunning } = await import("@/lib/ai/image-generation-engine");
  if (!(await ensureLocalImageSidecarRunning())) {
    throw new Error("本地生图运行时未就绪,请在 设置→本地配置 点「准备运行时」后重试");
  }
  // 输入图归一化为 data URL(sidecar 只收 base64;端到端实弹第四撞:
  // local-image:// 地址被当 base64 解码→Invalid base64)
  const inputImage = await toDataUrl(request.inputImageUrl);
  if (!inputImage) {
    throw new Error(`输入图无法读取(${request.inputImageUrl.slice(0, 40)}…):仅支持画布内受管图片`);
  }
  const response = await fetch(`${LOCAL_IMAGE_BASE_URL}/v1/images/uncloth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOCAL_IMAGE_TOKEN}`,
    },
    body: JSON.stringify({
      prompt: request.prompt,
      input_image: inputImage,
      params: request.params,
    }),
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
    | null;
  if (!response.ok || !json?.data?.[0]?.b64_json) {
    throw new Error(json?.error?.message || `无衣物管线失败(HTTP ${response.status})`);
  }
  const dataUrl = `data:image/png;base64,${json.data[0].b64_json}`;

  // 落盘:项目内 media/ai-image/(与生成链同款纪律;无活动项目=禁落盘)
  const projectId = useProjectStore.getState().activeProjectId;
  const bridge = getProjectFilesBridge();
  if (!projectId) throw new Error("请先选择项目(处理结果落项目内存储)");
  if (!bridge?.saveImage) throw new Error("项目文件桥不可用,无法落盘");
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seed =
    request.prompt.slice(0, 16).replace(/[^\w\u4e00-\u9fff]+/g, "_").slice(0, 16) || "uncloth";
  const filename = `uncloth_${seed}_${Date.now()}.png`;
  const saved = await bridge
    .saveImage({
      projectId,
      relativePath: `media/ai-image/${month}/${filename}`,
      source: dataUrl,
    })
    .catch(() => undefined);
  const imageUrl =
    saved?.success && saved.url ? saved.url : throwRuntimeError("处理结果落盘失败,请重试");
  const mediaId = saveToMediaLibrary(imageUrl, request.prompt, "ai-image");
  // 磁盘台账(09-04 挂账根修):此前无衣物链只落图+媒体库不写台账,记录
  // 只活在 localStorage(50 条上限会丢)。file 取受管 URL 尾段(编码口径,
  // 与生成链同构);references 存输入图供复原。失败静默不阻断。
  void appendProjectLedger({
    projectId,
    relativePath: `media/ai-image/${ledgerMonthFolderOf(imageUrl)}/ledger.json`,
    entry: {
      ts: Date.now(),
      prompt: request.prompt,
      model: "krea2-uncloth",
      file: `${ledgerMonthFolderOf(imageUrl)}/${ledgerFilenameOf(imageUrl)}`,
      references: [request.inputImageUrl],
      source: "image-studio-uncloth",
    },
  }).catch(() => {});

  toast.success("无衣物处理完成");
  return { imageUrl, mediaId };
}

/** 受管图地址 → data URL(local-image:// 经媒体库读取;project-file:// 经
 * 项目桥;data: 原样;远程 http 拒绝——本链只吃画布内图) */
async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  if (url.startsWith("local-image://")) return readImageAsBase64(url);
  if (url.startsWith("project-file://")) {
    const bridge = getProjectFilesBridge();
    if (!bridge?.readAsBase64) return null;
    try {
      const result = await bridge.readAsBase64(url);
      const payload = result as { success?: boolean; base64?: string } | null;
      if (payload?.success && payload.base64) return payload.base64;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function throwRuntimeError(message: string): never {
  throw new Error(message);
}
