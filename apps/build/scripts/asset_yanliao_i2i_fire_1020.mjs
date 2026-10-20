// 晏燎图生图战役·单轮点火(1020):关弹窗→(必要时导航回资产库)→开晏燎弹窗→
// 校验主图=目标→点「图生图」。用法: node asset_yanliao_i2i_fire_1020.mjs <目标基名>
const target = process.argv[2];
if (!target) { console.error("need target base name"); process.exit(2); }

const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(m, p = {}) {
  return new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const h = pending.get(m.id); pending.delete(m.id);
    m.error ? h.rej(new Error(JSON.stringify(m.error))) : h.res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));

const r = await send("Runtime.evaluate", {
  returnByValue: true,
  awaitPromise: true,
  expression: `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // ① 关现有弹窗(Radix Escape)
    if (document.querySelector("[role=dialog]")) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(600);
      if (document.querySelector("[role=dialog]")) {
        const x = document.querySelector("[role=dialog] button");
        x?.click(); await sleep(600);
      }
    }
    // ② 确保在资产库角色页
    let card = [...document.querySelectorAll("h3,h4,div,span")].find((e) => e.children.length === 0 && e.textContent?.trim() === "晏燎");
    if (!card) {
      const nav = [...document.querySelectorAll("button,a,[role=tab]")].find((e) => e.textContent?.trim() === "资产");
      nav?.click(); await sleep(3000);
      const tab = [...document.querySelectorAll("[role=tab],button")].find((e) => e.textContent?.trim() === "角色");
      tab?.click(); await sleep(2500);
      card = [...document.querySelectorAll("h3,h4,div,span")].find((e) => e.children.length === 0 && e.textContent?.trim() === "晏燎");
    }
    if (!card) return { ok: false, step: "card", page: (document.body.innerText || "").slice(0, 120) };
    card.click(); await sleep(2800);
    const dlg = document.querySelector("[role=dialog]");
    if (!dlg) return { ok: false, step: "dialog" };
    const alt = dlg.querySelector("img")?.alt ?? "";
    if (alt !== ${JSON.stringify(target)}) return { ok: false, step: "main-alt", alt };
    const btn = [...dlg.querySelectorAll("button")].find((b) => b.textContent?.trim() === "图生图");
    if (!btn) return { ok: false, step: "btn" };
    if (btn.disabled) return { ok: false, step: "busy" };
    btn.click();
    return { ok: true, firedAt: new Date().toISOString(), alt };
  })()`,
});
const v = r.result?.value ?? { ok: false, step: "eval", exc: r.exceptionDetails?.exception?.description?.slice(0, 200) };
console.log(JSON.stringify(v));
ws.close();
process.exit(v.ok ? 0 : 1);
