#!/usr/bin/env node
// ⑲ 闪现精准抓拍:逐步 wheel 步进,每步立即读宿主 hidden 状态+同步截图,
// 把「状态(6显=闪现中/3显=正常)↔像素帧」一帧一帧锁死(补 screencast
// 无法对齐页面时间戳的缺口)。产物:apps/output/biground-1002/flicker/framegrab/。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/BLOCK_EXT=1 禁扩展对照。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/biground-1002/flicker/framegrab`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const EXT_URL_PART = "/extensions/my-nodes/qi21-panel-linkage.js";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BLOCK_EXT = process.env.BLOCK_EXT === "1";
const TAG = BLOCK_EXT ? "off-ext" : "on-ext";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;

let chromeProc = null;
const shot = { steps: [] };

try {
  mkdirSync(OUT_DIR, { recursive: true });
  chromeProc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9397",
    `--user-data-dir=/tmp/qi21-flicker-grab-${Date.now()}`, "--window-size=1720,1050",
    "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", BLOCK_EXT ? "about:blank" : ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();

  let page = null;
  const start0 = Date.now();
  while (Date.now() - start0 < 90_000) {
    try {
      const list = await (await fetch("http://127.0.0.1:9397/json/list")).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(BLOCK_EXT ? "about:blank" : ENGINE));
      if (page) break;
    } catch {}
    await sleep(1200);
  }
  if (!page) throw new Error("page target 未出现");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method && listeners.length) for (const l of listeners) l(m);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  if (BLOCK_EXT) {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*qi21-panel-linkage.js*" }] });
    listeners.push((m) => {
      if (m.method === "Fetch.requestPaused") {
        const url = m.params.request.url || "";
        if (url.includes(EXT_URL_PART)) send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, body: Buffer.from("/*ablation*/").toString("base64") }).catch(() => {});
        else send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {});
      }
    });
    await send("Page.navigate", { url: ENGINE });
    await sleep(1500);
  }
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };
  const screenshot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", maxWidth: 1280, maxHeight: 800 });
    if (r && r.data) writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64"));
  };

  // 等前端就绪+装载+居中
  let t0 = Date.now();
  while (Date.now() - t0 < 120_000) { if (await ev(vis("window.app && window.app.isGraphReady === true ? 1 : null"))) break; await sleep(2000); }
  const reg = await ev(vis(`(window.app.extensions || []).some((e) => e && e.name === 'my.qi21.panel.linkage')`));
  log(`[${TAG}] 扩展注册=${reg}(期望 ${!BLOCK_EXT})`);
  await sleep(2500);
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  await ev(`window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'flicker-grab')`);
  t0 = Date.now();
  while (Date.now() - t0 < 40_000) { if (await ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 1 : null`))) break; await sleep(1000); }
  await sleep(2500);
  await ev(`(() => { const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); window.app.canvas.setDirty(true, true); return 1; })()`);
  await sleep(800);

  const center = JSON.parse(String(await ev(vis(`JSON.stringify((() => { const c = document.querySelector('canvas'); if (!c) return { x: 860, y: 500 }; const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`)) || '{"x":860,"y":500}'));
  const stateJs = vis(`JSON.stringify((() => { const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); return { scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3), vis: h.widgets.filter((w) => !w.hidden).map((w) => w.name) }; })())`);

  const wheel = (dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
  let flickerFrames = 0;
  // 逐 wheel 步进缩出(复现区 scale 0.53→0.1),每步读态+截图
  for (let i = 0; i < 36; i++) {
    await wheel(90);
    await sleep(70);
    const st = JSON.parse(String(await ev(stateJs)) || "{}");
    const six = st.vis && st.vis.length >= 6;
    if (six) flickerFrames++;
    const name = `${TAG}-step-${String(i).padStart(2, "0")}-scale${st.scale}-${six ? "SIX-VISIBLE-FLOCKER" : "normal"}.png`;
    await screenshot(name);
    shot.steps.push({ step: i, ...st, six });
    log(`step ${i} scale=${st.scale} visible=${st.vis.length}${six ? " ←闪现" : ""}`);
  }
  shot.flickerFrameCount = flickerFrames;
  shot.blockExt = BLOCK_EXT;
  shot.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT_DIR, `${TAG}-framegrab-report.json`), JSON.stringify(shot, null, 2));
  log(`[${TAG}] 闪现帧(6控件全显)= ${flickerFrames}/36`);
  if (chromeProc) { try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {} }
  process.exit(0);
} catch (e) {
  console.error("[FATAL]", e);
  if (chromeProc) { try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {} }
  process.exit(2);
}
