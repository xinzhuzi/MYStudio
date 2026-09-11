// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 漫影云中继执行器(09-10 云端收编):渲染层应答引擎「漫影 云端生图」节点。
 *
 * 链路=ComfyUI 节点 → main 中继(17596) → 本执行器 → generateImage(云链
 * 单源:供应商路由/兜底/计费/参考图缩略全在既有实现) → base64 回引擎。
 * 画布用户零登录零配置——账号即漫影应用本体(promptPolicy=raw:画布提示词
 * 即最终文本,不走应用内打磨词;persistMedia=false:媒体库落库由「漫影
 * 成图回写」节点显式决定,云节点不抢写)。
 */

import { generateImage } from "@/lib/ai/image-generation-engine";

interface RelayRequestPayload {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  referenceB64s?: string[];
}

export interface RelayRequest {
  id: string;
  payload: RelayRequestPayload;
}

/** 生图产物 URL → base64(data: 直取;http(s) 拉取;失败抛大白话)。 */
export async function imageResultToBase64(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma < 0) throw new Error("云端返回的图像数据不完整")
    return url.slice(comma + 1)
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`云端返回了不支持的图像地址:${url.slice(0, 120)}`)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    throw new Error(`云端图像下载失败(HTTP ${response.status})`)
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  let binary = ""
  const CHUNK = 0x8000
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

async function runRelayRequest(
  request: RelayRequest,
  respond: (response: { id: string; ok: boolean; imageB64?: string; error?: string }) => Promise<boolean>,
): Promise<void> {
  // respond 自身失败(应用退出中通道注销等)不得变 unhandled rejection——
  // 引擎侧有 6 分钟超时兜底,这边吞掉即可。
  const respondSafely = async (response: Parameters<typeof respond>[0]) => {
    try {
      await respond(response)
    } catch {
      // 中继已收摊:引擎会走「通道未接通/超时」大白话
    }
  }
  try {
    const result = await generateImage({
      prompt: request.payload.prompt,
      negativePrompt: request.payload.negativePrompt || undefined,
      aspectRatio: request.payload.aspectRatio || undefined,
      referenceImages: request.payload.referenceB64s?.length
        ? request.payload.referenceB64s.map((b64) => `data:image/png;base64,${b64}`)
        : undefined,
      promptPolicy: "raw",
      persistMedia: false,
    })
    const imageB64 = await imageResultToBase64(result.url)
    await respondSafely({ id: request.id, ok: true, imageB64 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await respondSafely({ id: request.id, ok: false, error: message })
  }
}

/** 装进渲染层(幂等):非桌面环境(无 preload 门面)静默缺席。 */
export function installComfyCloudRelayExecutor(): () => void {
  const relay = window.comfyCloudRelay
  if (!relay) return () => undefined
  return relay.onGenerateRequest((request) => {
    void runRelayRequest(request, (response) => relay.respond(response))
  })
}
