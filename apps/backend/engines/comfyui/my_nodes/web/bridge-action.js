// 双读注入变量:新名 MY_* 优先,旧名 MANYING_* 兼容(装机旧 asar 注入期防漂)
export const BRIDGE_URL = (window.MY_BRIDGE_URL || window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
export const BRIDGE_TOKEN = window.MY_BRIDGE_TOKEN || window.MANYING_BRIDGE_TOKEN || "manying-local-image";

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
  fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
    method: "POST",
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...(note ? { note } : {}), originProjectId, originEpisodeId }),
  }).catch(() => undefined);
}
