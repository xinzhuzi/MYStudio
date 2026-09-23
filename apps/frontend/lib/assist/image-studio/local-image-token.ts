// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 本地生图 sidecar(127.0.0.1:17595)装机随机令牌取用(0924 安全收口 H5)。
 *
 * 真令牌由 electron main 装机生成 UUID 持久化(tts-runtime 控制令牌同款先例),
 * spawn sidecar 时经 MANYING_LOCAL_IMAGE_TOKEN env 注入;渲染层经
 * imageGenRuntime.localImageToken IPC 按需取,进程内缓存,不落 localStorage
 * (provider.apiKey 恒为非机密占位,公开仓库不再携带任何可用令牌字面量)。
 * 非 Electron 环境(jsdom 测试/网页)无桥=空串,由调用方回退/由 sidecar 拒绝。
 */

let cached: Promise<string> | null = null;
let overrideForTests: (() => string) | null = null;

/** 测试注入位(照 comfy-sidecar-bridge 的 liveness 探针注入范式)。 */
export function setLocalImageTokenForTests(override: (() => string) | null): void {
  overrideForTests = override;
  cached = null;
}

export async function getLocalImageToken(): Promise<string> {
  if (overrideForTests) return overrideForTests();
  if (!cached) {
    try {
      const bridge = (window as { imageGenRuntime?: { localImageToken?: () => Promise<string> } })
        .imageGenRuntime;
      cached = Promise.resolve(bridge?.localImageToken ? bridge.localImageToken() : "");
    } catch {
      cached = Promise.resolve("");
    }
  }
  return cached;
}
