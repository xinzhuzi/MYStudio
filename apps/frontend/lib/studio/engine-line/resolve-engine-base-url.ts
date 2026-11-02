// 生效引擎 BaseURL 统一出口(11-02 remote-engine-takeover R1/S1):
// 配置了远端引擎(Windows ComfyUI)后,前端一切与引擎地址绑定的面(内嵌画布
// webview src / 分镜批量队列通道 / 后续列表代理)都从本件取生效 base——
// 远端配置(settings url)优先,否则回落本机托管引擎端口;两侧皆无=空串,
// 由调用方自判态。禁止任何面再自行拼 `http://127.0.0.1:${port}`。
//
// 真源:sidecar GET /comfy/engine/remote(comfy-sidecar-bridge getRemoteEngine;
// 设置页「引擎地址」写 App 家 remote-engine.json,保存即生效)。

import { getRemoteEngine } from "@/lib/assist/image-studio/comfy-sidecar-bridge";

/** 生效引擎 BaseURL:远端配置=settings url;否则=http://127.0.0.1:${本机port} */
export async function resolveEngineBaseUrl(localPort: number | null): Promise<string> {
  try {
    const status = await getRemoteEngine();
    if (status.source === "settings" && status.url) return status.url;
  } catch { /* sidecar 未跑→本机 */ }
  if (localPort && Number.isFinite(localPort) && localPort > 0) return `http://127.0.0.1:${localPort}`;
  return ""; // 两者皆无(引擎全无)→空串=调用方自判态
}

/**
 * 生效引擎解析详情(1102 R2/R5 消费):base 之外附 remoteActive——远端是否
 * 真正接管(source=settings 且 url 非空)。画布用它分流:远端生效时可达态改探
 * 远端探活、跳过本机自动拉起(Q2 纯备胎);非远端时维持本机 serviceRunning 口径。
 */
export interface EngineBaseResolution {
  /** 生效 base;两侧皆无=空串(同 resolveEngineBaseUrl 语义)。 */
  base: string;
  /** 远端引擎是否生效(settings 配置且 url 非空)。 */
  remoteActive: boolean;
}

export async function resolveEngineBase(localPort: number | null): Promise<EngineBaseResolution> {
  try {
    const status = await getRemoteEngine();
    if (status.source === "settings" && status.url) {
      return { base: status.url, remoteActive: true };
    }
  } catch { /* sidecar 未跑→本机 */ }
  if (localPort && Number.isFinite(localPort) && localPort > 0) {
    return { base: `http://127.0.0.1:${localPort}`, remoteActive: false };
  }
  return { base: "", remoteActive: false };
}

// ---------------------------------------------------------------------------
// 远端 sidecar base(C4/C6:远端引擎≠远端 sidecar;Windows MYStudio App 自带
// 同款 sidecar,固定端口 17595——施工时以 Windows 实机实证端口,如有漂移需
// 加配置字段候另裁)。列表/库存代理消费;从远端引擎 URL 提取主机名拼 17595,
// 引擎自身端口(如 17000)被剥掉。
// ---------------------------------------------------------------------------

export const REMOTE_SIDECAR_PORT = 17595;

/** 远端引擎 URL → 主机名(剥协议/引擎端口/路径;URL 解析失败走裸 host 兜底)。 */
function remoteHostnameOf(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname;
  } catch {
    return trimmed
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
      .split("/")[0]
      .replace(/:\d+$/, "");
  }
}

/** 远端 sidecar BaseURL:远端引擎 URL 主机名+固定 17595;空入=空串。 */
export function resolveRemoteSidecarBaseUrl(remoteEngineUrl: string): string {
  const host = remoteHostnameOf(remoteEngineUrl);
  return host ? `http://${host}:${REMOTE_SIDECAR_PORT}` : "";
}

// ---------------------------------------------------------------------------
// 引擎地址变更通知面(1102 R1「补订阅」):设置页保存/一键切换/清空引擎地址
// 后,已挂载的跟随视图(画布 src、配置页提示条)零重启即时刷新。
// 说明:全前端此前无远端地址变更广播(勘察 1102:仅 REVEAL 深链事件),本件
// 自带最小 pub/sub;生产者=McpSettingsTab.saveRemoteEngine 成功路径(同渲染
// 进程,模块级单例即跨组件生效)。
// ---------------------------------------------------------------------------

let remoteEngineVersion = 0;
const remoteEngineListeners = new Set<() => void>();

/** 远端地址已变更(保存/一键切换/清空成功后由设置页调用);版本号+1 并广播。 */
export function notifyRemoteEngineChanged(): void {
  remoteEngineVersion += 1;
  for (const listener of [...remoteEngineListeners]) {
    try {
      listener();
    } catch { /* 单个订阅者异常不拦其余刷新 */ }
  }
}

/** 订阅引擎地址变更;返回退订函数(useSyncExternalStore 订阅面)。 */
export function subscribeRemoteEngineChanged(listener: () => void): () => void {
  remoteEngineListeners.add(listener);
  return () => {
    remoteEngineListeners.delete(listener);
  };
}

/** 当前引擎地址版本号(每次 notify +1;useSyncExternalStore 快照面)。 */
export function getRemoteEngineVersion(): number {
  return remoteEngineVersion;
}

/** 测试隔离:清版本号+退订全部监听。 */
export function resetRemoteEngineVersionForTests(): void {
  remoteEngineVersion = 0;
  remoteEngineListeners.clear();
}
