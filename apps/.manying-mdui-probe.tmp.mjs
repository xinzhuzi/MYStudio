import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const CHROME = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const DBG = 17944;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, "--no-first-run", "--user-data-dir=/tmp/manying-mdui-profile2", "--no-sandbox", "about:blank"], { stdio: "ignore" });
async function url() { for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); const p = t.find(x => x.type === "page"); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(300); } throw new Error("chrome"); }
let seq = 0; const pend = new Map();
const ws = new WebSocket(await url());
await new Promise(r => ws.on("open", r));
ws.on("message", raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result ?? m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return "EXC: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300); return r.result.value; };
try {
  await send("Page.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:17599/" });
  for (let i = 0; i < 60; i++) { if (await ev("window.app && window.app.isGraphReady === true")) break; await sleep(1000); }
  const graph = JSON.parse(readFileSync("/tmp/manying-mdui-user/default/workflows/漫影/1_图片/分镜/0_工作流主线/分镜工作流.json", "utf8"));
  await ev(`window.__manyingOpenWorkflow(${JSON.stringify({ name: "漫影/1_图片/分镜/0_工作流主线/分镜工作流.json", graph })})`);
  await sleep(1000);
  await ev(`(() => { const els = Array.from(document.querySelectorAll("button, [role=tab], li")); const hit = els.filter(e => (e.textContent || "").trim().startsWith("分镜工作流")); if (hit.length) { hit.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight)); hit[0].click(); } return 1; })()`);
  await sleep(4000);
  console.log(await ev(`(() => {
    const nodes = window.app.canvas.graph._nodes.filter(n => (n.properties || {}).manyingStage);
    const n = nodes.find(n => n.title === "剧本");
    const el = n && n.__manyingDomBody && n.__manyingDomBody.el;
    const a = nodes.find(n => n.title === "衍生资产");
    return JSON.stringify({
      keys: nodes.map(n => n.properties.manyingStage.key),
      scriptHTMLHead: el ? el.querySelector(".ms-body").innerHTML.slice(0, 260) : "no-el",
      assetsHTMLHead: a && a.__manyingDomBody ? a.__manyingDomBody.el.querySelector(".ms-body").innerHTML.slice(0, 160) : "no-el",
      mdGlobal: typeof window.markdownit,
    });
  })()`));
} catch (e) { console.error("ERR:", e.message); } finally { try { ws.close(); } catch {} chrome.kill(); }
