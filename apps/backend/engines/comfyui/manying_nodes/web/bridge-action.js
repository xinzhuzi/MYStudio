export const BRIDGE_URL = (window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
export const BRIDGE_TOKEN = window.MANYING_BRIDGE_TOKEN || "manying-local-image";

export function postAction(kind, note, button) {
  if (button) {
    button.classList.remove("ms-btn--flash");
    void button.offsetWidth;
    button.classList.add("ms-btn--flash");
  }
  fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
    method: "POST",
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(note ? { kind, note } : { kind }),
  }).catch(() => undefined);
}
