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

/**
 * 取本地 sidecar 装机令牌。
 *
 * 1103 追修(实弹日志定谳:渲染层全 403 窗口):**只缓存非空成功**——装机循环后
 * app 重启,渲染层首取若跑赢 preload 注入(window.imageGenRuntime 未就绪),旧实现
 * 会把空串钉死成进程终身缓存,之后一切鉴权请求恒 403 且永不自愈。空结果不缓存,
 * 下次调用重取;403 自愈由 comfySidecarRequest 触发 invalidate 后重取。
 */
export async function getLocalImageToken(): Promise<string> {
  if (overrideForTests) return overrideForTests();
  if (cached) return cached;
  let token = "";
  try {
    const bridge = (window as { imageGenRuntime?: { localImageToken?: () => Promise<string> } })
      .imageGenRuntime;
    if (bridge?.localImageToken) token = await bridge.localImageToken();
  } catch {
    token = "";
  }
  if (token) cached = Promise.resolve(token);
  return token;
}

/** 令牌失效(403 自愈链):清缓存,下次调用重取。 */
export function invalidateLocalImageToken(): void {
  cached = null;
}
