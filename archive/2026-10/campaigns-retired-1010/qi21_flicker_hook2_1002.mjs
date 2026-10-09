#!/usr/bin/env node
// ⑲ 深挖 v2:hidden 翻转不走 w.hidden= 赋值(v1 实测 0 写)→ 假设 widget 对象被
// 前端整体重建(新对象默认不 hidden→闪现开始),扩展 400ms 轮询写回(闪现结束)。
// v2:rAF 循环盯宿主 widgets 数组的对象身份,新对象出现=重建事件(闪现开始时刻);
// 并即时 hook 新对象的 hidden setter 抓「扩展写回」的栈。缩放序列跑完读双事件。
// 产物:apps/output/biground-1002/flicker/hidden-write-stacks-v2.json。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT = `${REPO}/apps/output/biground-1002/flicker/hidden-write-stacks-v2.json`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;

const chromeProc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9399",
  `--user-data-dir=/tmp/qi21-flicker-hook2-${Date.now()}`, "--window-size=1720,1050",
  "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
  "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
chromeProc.unref();

try {
  let page = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try {
      const list = await (await fetch("http://127.0.0.1:9399/json/list")).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch {}
    await sleep(1200);
  }
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

  let tt = Date.now();
  while (Date.now() - tt < 120_000) { if (await ev(vis("window.app && window.app.isGraphReady === true ? 1 : null"))) break; await sleep(2000); }
  await sleep(2500);
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  await ev(`window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'flicker-hook2')`);
  tt = Date.now();
  while (Date.now() - tt < 40_000) { if (await ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 1 : null`))) break; await sleep(1000); }
  await sleep(2500);
  await ev(`(() => { const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); return 1; })()`);
  await sleep(600);

  // v2 监测:rAF 盯对象身份+即时 hook 新对象 hidden setter
  const hookRes = await ev(`(() => {
    if (window.__hook2) return 'already';
    window.__hook2 = { rebuilds: [], writes: [], known: new WeakSet(), gen: 0 };
    const H = window.__hook2;
    const hostFinder = () => window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
    const hookWidget = (w) => {
      if (H.known.has(w)) return;
      H.known.add(w);
      const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(w), 'hidden');
      let cur;
      try { cur = proto && proto.get ? proto.get.call(w) : w.hidden; } catch { cur = false; }
      Object.defineProperty(w, 'hidden', {
        configurable: true,
        get() { return cur; },
        set(v) {
          const from = cur; cur = v;
          H.writes.push({ w: w.name, from, to: v, t: Math.round(performance.now()),
            scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3),
            stack: (new Error().stack || '').split('\\n').slice(1, 8).join(' | ') });
        },
      });
    };
    const tick = () => {
      const h = hostFinder();
      if (h && h.widgets && h.widgets.length) {
        const ids = h.widgets.map((w) => {
          hookWidget(w);
          return w.name + '#' + (w.__fid ||= ++H.gen);
        }).join(',');
        if (H.lastIds && ids !== H.lastIds) {
          H.rebuilds.push({ t: Math.round(performance.now()), scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3),
            from: H.lastIds, to: ids,
            hiddenNow: h.widgets.map((w) => w.name + ':' + !!w.hidden).join(',') });
        }
        H.lastIds = ids;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return 'hooked2';
  })()`);
  log("v2 监测:", hookRes);

  const center = JSON.parse(String(await ev(vis(`JSON.stringify((() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`)) || '{"x":860,"y":464}'));
  const wheel = (dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
  // 复刻 Phase A 触发条件:screencast 开着(渲染压力)+同款缩放序列
  let casting = true;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Page.screencastFrame" && casting) {
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    }
  });
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1280, maxHeight: 800 });
  // framegrab 实证可触发的模式:匀速缩出 36 步(70ms/90dy,跨 0.33 阈值)
  for (let i = 0; i < 36; i++) { await wheel(90); await sleep(70); }
  for (let i = 0; i < 12; i++) { await wheel(-90); await sleep(70); }
  await sleep(1600);
  casting = false;
  try { await send("Page.stopScreencast"); } catch {}

  const data = JSON.parse(String(await ev(vis("JSON.stringify({ rebuilds: window.__hook2?.rebuilds ?? [], writes: window.__hook2?.writes ?? [] })")) || '{"rebuilds":[],"writes":[]}'));
  writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), ...data }, null, 2));
  log(`重建事件 ${data.rebuilds.length} 笔 / hidden 写 ${data.writes.length} 笔 → ${OUT}`);
  for (const r of data.rebuilds.slice(0, 10)) log(`REBUILD @${r.t}ms scale=${r.scale}\n  from: ${r.from}\n  to:   ${r.to}\n  hiddenNow: ${r.hiddenNow}`);
  for (const w of data.writes.slice(0, 10)) log(`WRITE ${w.w}: ${w.from}→${w.to} @${w.t}ms scale=${w.scale}\n  ${w.stack}`);
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(0);
} catch (e) {
  console.error("[FATAL]", e);
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(2);
}
