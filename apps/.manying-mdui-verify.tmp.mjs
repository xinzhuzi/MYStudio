// 七型分发+md 成型终验
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const CHROME = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const DBG = 17943;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, "--no-first-run", "--user-data-dir=/tmp/manying-mdui-profile", "--no-sandbox", "--window-size=1600,1400", "about:blank"], { stdio: "ignore" });
async function url() { for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); const p = t.find(x => x.type === "page"); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(300); } throw new Error("chrome"); }
let seq = 0; const pend = new Map(); const errors = [];
const ws = new WebSocket(await url());
await new Promise(r => ws.on("open", r));
ws.on("message", raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result ?? m); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 150)); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const pass = (n, ok) => console.log((ok ? "PASS " : "FAIL ") + n);
try {
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:17599/" });
  for (let i = 0; i < 60; i++) { if (await ev("window.app && window.app.isGraphReady === true")) break; await sleep(1000); }
  const graph = JSON.parse(readFileSync("/tmp/manying-mdui-user/default/workflows/漫影/1_图片/分镜/0_工作流主线/分镜工作流.json", "utf8"));
  await ev(`window.__manyingOpenWorkflow(${JSON.stringify({ name: "漫影/1_图片/分镜/0_工作流主线/分镜工作流.json", graph })})`);
  await sleep(1500);
  await ev(`(() => { const els = Array.from(document.querySelectorAll("button, [role=tab], li")); const hit = els.filter(e => (e.textContent || "").trim().startsWith("分镜工作流")); if (hit.length) { hit.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight)); hit[0].click(); } return 1; })()`);
  await sleep(2500);
  // 等 markdown-it import+重渲染(宽限 5s)
  await sleep(5000);
  const s = JSON.parse(await ev(`(() => {
    const nodes = window.app.canvas.graph._nodes.filter(n => (n.properties || {}).manyingStage);
    const body = (title) => { const n = nodes.find(n => n.title === title); return n && n.__manyingDomBody ? n.__manyingDomBody.el : null; };
    const script = body("剧本");
    const plan = body("导演规划");
    const assets = body("衍生资产");
    const table = body("分镜表");
    const panel = body("分镜面板");
    const prod = body("单镜视频生产");
    const bench = body("视频工作台");
    return JSON.stringify({
      mdH1: script ? script.querySelectorAll(".ms-md h1").length : -1,
      mdH2: script ? script.querySelectorAll(".ms-md h2").length : -1,
      mdRaw: script ? !!Array.from(script.querySelectorAll(".ms-md > *")).some(e => e.textContent.trim().startsWith("#")) : true,
      planMd: plan ? plan.querySelectorAll(".ms-md h1,h2,h3,p").length : -1,
      cards: assets ? assets.querySelectorAll(".ms-cards .ms-card").length : -1,
      tableRows: table ? table.querySelectorAll(".ms-rows .ms-row .sub").length : -1,
      tiles: panel ? panel.querySelectorAll(".ms-tiles .ms-tile").length : -1,
      queueRows: prod ? prod.querySelectorAll("[data-shot-idx]").length : -1,
      trackRows: bench ? bench.querySelectorAll(".ms-rows .ms-row").length : -1,
      mounted: nodes.length === 7 && nodes.every(n => n.__manyingDomBody && document.contains(n.__manyingDomBody.el)),
    });
  })()`));
  pass("七节点全挂载", s.mounted);
  pass("剧本 md 成型(h1/h2 在场)", s.mdH1 >= 1 && s.mdH2 >= 1);
  pass("剧本无裸 md 标记(#/##)", !s.mdRaw);
  pass("导演规划 md 成型", s.planMd > 5);
  pass("资产卡", s.cards >= 15);
  pass("分镜表两行制", s.tableRows >= 3);
  pass("磁贴网格", s.tiles >= 30);
  pass("队列行(带 data-shot-idx)", s.queueRows >= 30);
  pass("轨道行", s.trackRows >= 2);
  pass("零页面异常", errors.length === 0);
  // 截图存证
  await ev(`(() => { const app = window.app, ds = app.canvas.ds; const node = app.canvas.graph._nodes.find(n => n.title === "剧本"); ds.scale = 0.9; ds.offset = [50 - node.pos[0] * 0.9, 30 - node.pos[1] * 0.9]; app.canvas.setDirty(true, true); return 1; })()`);
  await ev(`new Promise(r => { window.app.canvas.canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); requestAnimationFrame(() => requestAnimationFrame(r)); })`);
  await sleep(800);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/manying-md-script.png", Buffer.from(shot.data, "base64"));
} catch (e) { console.error("ERR:", e.message); } finally { try { ws.close(); } catch {} chrome.kill(); }
