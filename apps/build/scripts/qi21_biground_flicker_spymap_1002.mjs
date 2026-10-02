#!/usr/bin/env node
// ⑲ 残余闪现写手取证(引擎管理员丁,腿2 附):defineProperty 钉宿主 widget
// hidden setter 记调用栈 → wheel 序列 → dump 写记录,定位「闪现帧=hidden 被
// 外部写 false」的路径(store 投影重建 vs litegraph 内部 vs 扩展自身)。
// 产物:apps/output/biground-1002/ext/hidden-writes-diag.json
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = "http://127.0.0.1:17599";
const CDP_PORT = 9396;
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/biground-1002/ext`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;

let chromeProc = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/qi21-flicker-diag-${Date.now()}`, "--window-size=1720,1050",
    "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
  let page = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch {}
    await sleep(1200);
  }
  if (!page) throw new Error("page 未出现");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };

  let t1 = Date.now();
  while (Date.now() - t1 < 120_000) { if (await ev(vis("window.app && window.app.isGraphReady === true ? 1 : null"))) break; await sleep(2000); }
  await sleep(2500);
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  await ev(`window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'flicker-diag')`);
  t1 = Date.now();
  while (Date.now() - t1 < 40_000) { if (await ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 1 : null`))) break; await sleep(1000); }
  await sleep(2500);
  await ev(`(() => { const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); window.app.canvas.setDirty(true, true); return 1; })()`);
  await sleep(600);

  // 钉 hidden setter(稳态后装,避开装载期写)
  const armed = await ev(`(() => {
    const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
    if (!host) return 'no-host';
    window.__hw = [];
    for (const w of host.widgets) {
      let v = w.hidden;
      Object.defineProperty(w, 'hidden', { configurable: true,
        get: () => v,
        set: (nv) => { window.__hw.push({ w: w.name, from: v, to: nv, t: Math.round(performance.now()),
          stack: String(new Error().stack || '').split('\\n').slice(1, 7).map((s) => s.trim()).join(' <= ') }); v = nv; } });
    }
    return host.widgets.length;
  })()`);
  log("spy armed on", armed, "widgets");

  const center = JSON.parse(String(await ev(vis(`JSON.stringify((() => {
    const c = document.querySelector('canvas'); if (!c) return { x: 860, y: 500 };
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })())`))));
  const wheel = (dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
  const zoomState = vis(`JSON.stringify((() => {
    const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
    return { scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3), vis: host.widgets.filter((w) => !w.hidden).length,
             untagged: host.widgets.filter((w) => w.__qi21Tag === undefined).length,
             tags: host.widgets.map((w) => w.__qi21Tag ?? 0).join(',') };
  })())`);
  let flicker = 0;
  let idleFlicker = 0; const idleSeen = [];
  for (let i = 0; i < 260; i++) { // 空闲 260×~77ms≈20s,零输入
    await sleep(70);
    const st = JSON.parse(String(await ev(zoomState)) || "{}");
    if ((st?.vis ?? 0) >= 6) { idleFlicker++; idleSeen.push({ i, ...st }); }
  }
  log(`空闲 20s:闪现样本=${idleFlicker}/260`, idleSeen.slice(0, 3));
  for (let i = 0; i < 48; i++) {
    await wheel(i < 36 ? 90 : -120);
    await sleep(70);
    const st = JSON.parse(String(await ev(zoomState)) || "{}");
    if ((st?.vis ?? 0) >= 6) { flicker++; log(`step ${i} scale=${st.scale} SIX-VIS untagged=${st.untagged} tags=${st.tags}`); }
  }
  const writes = JSON.parse(String(await ev("JSON.stringify(window.__hw || [])")) || "[]");
  writeFileSync(join(OUT_DIR, "hidden-writes-diag.json"), JSON.stringify({ idleFlicker, idleSeen, flickerFrames: flicker, writeCount: writes.length, writes, finishedAt: new Date().toISOString() }, null, 2));
  log(`缩放闪现帧=${flicker}/48;空闲闪现样本=${idleFlicker}/260;hidden 写=${writes.length} → hidden-writes-diag.json`);
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(0);
} catch (e) {
  console.error("[FATAL]", e);
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(2);
}
