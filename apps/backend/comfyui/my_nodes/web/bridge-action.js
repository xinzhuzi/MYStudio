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

// 1105 根治:App 重启→sidecar 令牌轮换→页面缓存令牌陈货→侧栏恒 403。
// 作废进程级令牌缓存,下一次 bridgeToken() 现取 /my_bridge/config(引擎侧
// 已改现读文件真源,见 my_nodes/bridge/settings.py)。
export function invalidateBridgeToken() {
  bridgeTokenPromise = null;
}

// 统一带令牌取数口:401/403=令牌陈旧指纹 → 作废缓存 → 重取 → 重试一次。
// POST 重放安全(403=请求被拒未执行)。window 注入令牌的旧 asar 路径下
// 重试同令牌无害(至多多一发请求)。
export async function bridgeFetch(url, init = {}) {
  const doFetch = async () => {
    const headers = new Headers(init.headers || {});
    headers.set("X-Manying-Image-Token", await bridgeToken());
    return fetch(url, { ...init, headers });
  };
  let response = await doFetch();
  if (response.status === 401 || response.status === 403) {
    invalidateBridgeToken();
    response = await doFetch();
  }
  return response;
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
  bridgeFetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...(note ? { note } : {}), originProjectId, originEpisodeId }),
  }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }).catch((error) => {
    window.alert?.(`制作动作提交失败(${error?.message || error})，请检查宿主状态；确认动作未在执行后再重试`);
  });
}
