#!/usr/bin/env node
// ⑲ 深挖:hidden 被谁清除?页内对宿主 3 个隐藏控件的 hidden 属性 defineProperty
// 拦截写操作并记录调用栈,缩放触发后读栈——指认前端本体清 hidden 的代码路径。
// 产物:apps/output/biground-1002/flicker/hidden-write-stacks.json。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT = `${REPO}/apps/output/biground-1002/flicker/hidden-write-stacks.json`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;

const chromeProc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9398",
  `--user-data-dir=/tmp/qi21-flicker-hook-${Date.now()}`, "--window-size=1720,1050",
  "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
  "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
chromeProc.unref();

try {
  let page = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try {
      const list = await (await fetch("http://127.0.0.1:9398/json/list")).json();
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
  await ev(`window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'flicker-hook')`);
  tt = Date.now();
  while (Date.now() - tt < 40_000) { if (await ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 1 : null`))) break; await sleep(1000); }
  await sleep(2500); // 扩展轮询首轮:hidden 已设好
  await ev(`(() => { const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); return 1; })()`);
  await sleep(600);

  // 装 hidden 写拦截(对宿主全部 widget,只在被写时记录栈;轮询兜底写的栈也录=对照)
  const hookRes = await ev(`(() => {
    window.__hiddenWrites = [];
    const h = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
    if (!h) return 'no-host';
    for (const w of h.widgets) {
      const target = w;
      const name = w.name;
      const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'hidden');
      let cur;
      try { cur = proto && proto.get ? proto.get.call(target) : target.hidden; } catch { cur = target._state?.options?.hidden ?? false; }
      Object.defineProperty(target, 'hidden', {
        configurable: true,
        get() { return cur; },
        set(v) {
          const from = cur; cur = v;
          window.__hiddenWrites.push({ w: name, from, to: v, t: Math.round(performance.now()),
            stack: (new Error().stack || '').split('\\n').slice(1, 9).join(' | ') });
          if (window.__hiddenWrites.length > 60) window.__hiddenWrites.shift();
        },
      });
    }
    return 'hooked:' + h.widgets.length;
  })()`);
  log("hidden 拦截:", hookRes);

  const center = JSON.parse(String(await ev(vis(`JSON.stringify((() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`)) || '{"x":860,"y":464}'));
  const wheel = (dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 16; i++) { await wheel(100); await sleep(45); }  // 快速缩出(跨 0.33/0.11 阈值)
    for (let i = 0; i < 16; i++) { await wheel(-100); await sleep(45); } // 快速缩进
  }
  await sleep(1500);

  const writes = JSON.parse(String(await ev(vis("JSON.stringify(window.__hiddenWrites || [])")) || "[]"));
  writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), writes }, null, 2));
  log(`hidden 写事件 ${writes.length} 笔 → ${OUT}`);
  for (const wEvent of writes.slice(0, 12)) {
    log(`--- ${wEvent.w}: ${wEvent.from}→${wEvent.to} @${wEvent.t}ms`);
    log(`    ${wEvent.stack}`);
  }
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(0);
} catch (e) {
  console.error("[FATAL]", e);
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
  process.exit(2);
}
