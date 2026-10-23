// 双读注入变量:新名 MY_* 优先,旧名 MANYING_* 兼容(装机旧 asar 注入期防漂)
export const BRIDGE_URL = (window.MY_BRIDGE_URL || window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");

// 0924 令牌随机化:装机随机令牌不再以固定字面量内嵌(公开仓库=令牌公开)。
// 优先级:window 注入(旧 asar 兼容)> 引擎同源 /my_bridge/config(主路径,
// 由 engine_manager launch_env 注入的 MYSTUDIO_BRIDGE_TOKEN 下发)> 空
// (fail-closed,sidecar 侧全 403)。结果按进程缓存。
let bridgeTokenPromise = null;
export function bridgeToken() {
  const injected = window.MY_BRIDGE_TOKEN || window.MANYING_BRIDGE_TOKEN;
  if (injected) return Promise.resolve(injected);
  if (!bridgeTokenPromise) {
    bridgeTokenPromise = fetch("/my_bridge/config")
      .then((response) => (response.ok ? response.json() : {}))
      .then((config) => config.bridgeToken || "")
      .catch(() => "");
  }
  return bridgeTokenPromise;
}

export function postAction(kind, note, button, originProjectId, originEpisodeId) {
  if (typeof originProjectId !== "string" || !originProjectId.trim()
    || typeof originEpisodeId !== "string" || !originEpisodeId.trim()) {
    window.alert?.("此工作流未绑定来源项目与章节，请从漫影项目重新打开后再执行");
    return;
  }
  if (button) {
    button.classList.remove("ms-btn--flash");
    void button.offsetWidth;
    button.classList.add("ms-btn--flash");
  }
  bridgeToken().then((token) => fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
    method: "POST",
    headers: { "X-Manying-Image-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...(note ? { note } : {}), originProjectId, originEpisodeId }),
  })).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }).catch((error) => {
    window.alert?.(`制作动作提交失败(${error?.message || error})，请检查宿主状态；确认动作未在执行后再重试`);
  });
}
