#!/usr/bin/env node
// ⑲ 复现「画布缩放时宿主 [40] UI 闪现 4/2 个选择框」(2026-10-02,Trellis
// 10-01-qi21-usetest-batch implement.md 前置步 2)。
//
// 口径:CDP 真前端(headless Chrome)装载仓库工作区现态 t2i → 居中 [40]
// 宿主 → Input.dispatchMouseEvent(mouseWheel) 真滚轮缩放序列 → 双证据采集:
//   ① 像素层:Page.startScreencast(everyNthFrame=1)帧序列 PNG;
//   ② 状态层:页内 rAF 采样宿主 widget hidden/isWidgetVisible/layout 数/
//      node size/ds.scale 的「变化时序」(只在签名变化时落样本=闪现直证)。
// 对照实验:Phase B 用 Fetch 拦截 /extensions/my-nodes/qi21-panel-linkage.js
//   返回空脚本(零改引擎家文件、零重启),其余流程全同。
// 产物:apps/output/biground-1002/flicker/{on-ext,off-ext}/ 帧 PNG +
//   flicker-repro-report.json。退出码 0=跑完两相;1=有失败;2=环境错误。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/biground-1002/flicker`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91"; // [40] 子图实例 uuid(工作区现态 10-02 实查)
const EXT_URL_PART = "/extensions/my-nodes/qi21-panel-linkage.js";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = { startedAt: new Date().toISOString(), engine: ENGINE, wf: WF, phases: {} };
const check = (phase, name, pass, detail = "") => {
  const p = (report.phases[phase] ??= { checks: [] });
  p.checks.push({ name, pass, detail: String(detail).slice(0, 800) });
  log(`${pass ? "PASS" : "FAIL"}  [${phase}] ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

let chromeProc = null;
function launchChrome(cdpPort, startUrl) {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=/tmp/qi21-flicker-chrome-${cdpPort}-${Date.now()}`, "--window-size=1720,1050",
    "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", startUrl], { detached: true, stdio: "ignore" });
  chromeProc.unref();
}
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch {} }
}

async function getPageClient(cdpPort, urlPrefix, { blockExt = false } = {}) {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(urlPrefix));
      if (page) break;
    } catch {}
    await sleep(1200);
  }
  if (!page) throw new Error(`page target 未出现(90s): ${urlPrefix}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method && listeners.length) for (const l of listeners) l(m);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  if (blockExt) {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*qi21-panel-linkage.js*" }] });
    listeners.push((m) => {
      if (m.method === "Fetch.requestPaused") {
        const url = m.params.request.url || "";
        if (url.includes(EXT_URL_PART)) {
          send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200,
            body: Buffer.from("/*qi21 flicker ablation: extension disabled*/").toString("base64") })
            .catch(() => {});
        } else {
          send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {});
        }
      }
    });
  }
  return {
    send, ws,
    onMessage: (fn) => listeners.push(fn),
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
      return r.result.value;
    },
    async screenshot(name) {
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64")); log(`📸 ${name}`); }
      } catch {}
    },
  };
}

async function waitFor(fn, { timeout = 90_000, interval = 1000, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

// 页内探针:宿主定位
const HOST_FIND = `window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)})`;

// 页内监测器:rAF 采样,只在签名变化时落样本(变化时序=闪现直证)
const INSTALL_MONITOR = `(() => {
  if (window.__flickerInstalled) return 'already';
  window.__flickerInstalled = true;
  window.__flicker = { events: [], frameCount: 0 };
  const sig = (h) => JSON.stringify([
    h.widgets.map((w) => [w.name, !!w.hidden, h.isWidgetVisible ? !!h.isWidgetVisible(w) : null]),
    h.getLayoutWidgets ? h.getLayoutWidgets().length : -1,
    h.widgets.length,
    Math.round(h.size?.[0] ?? -1), Math.round(h.size?.[1] ?? -1),
  ]);
  let lastSig = null;
  const tick = () => {
    window.__flicker.frameCount++;
    const h = ${HOST_FIND};
    if (h && h.widgets && h.widgets.length) {
      const s = sig(h);
      if (s !== lastSig) {
        lastSig = s;
        window.__flicker.events.push({ t: Math.round(performance.now()), scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3),
          widgets: h.widgets.map((w) => ({ n: w.name, hidden: !!w.hidden,
            vis: h.isWidgetVisible ? !!h.isWidgetVisible(w) : null,
            type: w.type || w.options?.type || w.options?.combo ? "combo" : (w.options?.isToggleWidget ? "toggle" : (w.options?.isNumberWidget ? "number" : (w.options?.isTextWidget ? "text" : "other"))) })),
          layout: h.getLayoutWidgets ? h.getLayoutWidgets().length : -1,
          size: [Math.round(h.size?.[0] ?? -1), Math.round(h.size?.[1] ?? -1)] });
        if (window.__flicker.events.length > 4000) window.__flicker.events.shift();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'installed';
})()`;

async function runPhase(phaseName, { cdpPort, blockExt }) {
  mkdirSync(join(OUT_DIR, phaseName), { recursive: true });
  const framesDir = join(OUT_DIR, phaseName);
  launchChrome(cdpPort, blockExt ? "about:blank" : ENGINE);
  const page = await getPageClient(cdpPort, blockExt ? "about:blank" : ENGINE, { blockExt });
  try {
    if (blockExt) {
      await page.send("Page.navigate", { url: ENGINE });
      await sleep(1000);
    }
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
    // Phase B 断言:扩展确实没装
    if (blockExt) {
      const reg = await page.ev(vis(`(window.app.extensions || []).some((e) => e && e.name === 'my.qi21.panel.linkage')`));
      check(phaseName, "扩展已被拦截未注册(对照前提)", reg === false, `registered=${reg}`);
    } else {
      const reg = await page.ev(vis(`(window.app.extensions || []).some((e) => e && e.name === 'my.qi21.panel.linkage')`));
      check(phaseName, "扩展已注册(复现前提)", reg === true, `registered=${reg}`);
    }
    await sleep(2500); // 等 sidebar 等落定
    // 装载工作区现态真源
    const wfJson = JSON.parse(readFileSync(WF, "utf8"));
    await page.ev(`(async () => { window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'flicker-${phaseName}'); return 'opened'; })()`);
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: "画布切换" });
    await sleep(2500); // 扩展轮询(400ms)首轮+布局落定
    // 居中 [40]
    await page.ev(`(() => { const h = ${HOST_FIND}; if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); window.app.canvas.setDirty(true, true); return !!h; })()`);
    await sleep(800);
    // 装监测器
    const mon = await page.ev(INSTALL_MONITOR);
    check(phaseName, "监测器已装(rAF 采样)", mon === "installed" || mon === "already", String(mon));
    // 初始面板态(截图前基线)
    const baseState = await page.ev(vis(`JSON.stringify((() => { const h = ${HOST_FIND}; return { scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3), widgets: h.widgets.map((w) => ({ n: w.name, hidden: !!w.hidden })) }; })())`));
    log(`[${phaseName}] 基线: ${baseState}`);
    await page.screenshot(join(phaseName, "00-baseline.png"));

    // screencast 帧收集(闪现=瞬态,靠帧序列抓)
    const frames = [];
    let casting = true;
    page.onMessage((m) => {
      if (m.method === "Page.screencastFrame" && casting) {
        frames.push({ idx: frames.length, ts: Math.round(performance.now?.() ?? Date.now()), data: m.params.data });
        page.send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
      }
    });
    await page.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1280, maxHeight: 800 });

    // 画布中心坐标(滚轮落点)
    const center = JSON.parse(String(await page.ev(vis(`JSON.stringify((() => { const c = document.querySelector('canvas'); if (!c) return { x: 860, y: 500 }; const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`)) || '{"x":860,"y":500}'));
    log(`[${phaseName}] 滚轮落点:`, JSON.stringify(center));

    // 缩放序列:三段(快速缩出→快速缩进→慢速往返),模拟用户画布缩放
    const wheel = (dy) => page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
    for (let i = 0; i < 22; i++) { await wheel(120); await sleep(35); }   // 快速缩出
    for (let i = 0; i < 22; i++) { await wheel(-120); await sleep(35); }  // 快速缩进
    for (let i = 0; i < 10; i++) { await wheel(80); await sleep(220); }   // 慢速缩出
    for (let i = 0; i < 10; i++) { await wheel(-80); await sleep(220); }  // 慢速缩进
    await sleep(1200); // 尾帧+轮询兜底窗口(400ms×3)
    casting = false;
    try { await page.send("Page.stopScreencast"); } catch {}

    // 帧落盘(全量;>220 帧则前 220)
    const saved = Math.min(frames.length, 220);
    for (let i = 0; i < saved; i++) {
      writeFileSync(join(framesDir, `frame-${String(i).padStart(3, "0")}.png`), Buffer.from(frames[i].data, "base64"));
    }
    log(`[${phaseName}] screencast 帧落盘 ${saved}/${frames.length}`);

    // 收态
    const endState = await page.ev(vis(`JSON.stringify((() => { const h = ${HOST_FIND}; return { scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3), widgets: h.widgets.map((w) => ({ n: w.name, hidden: !!w.hidden })) }; })())`));
    await page.screenshot(join(phaseName, "99-end.png"));
    // 变化时序读取
    const flick = JSON.parse(String(await page.ev(vis(`JSON.stringify({ events: window.__flicker?.events ?? [], frameCount: window.__flicker?.frameCount ?? 0 })`)) || '{"events":[],"frameCount":0}'));

    // ---- 分析:状态层抖动 ----
    // 「闪现」判定:hidden/可见签名在无用户值操作下来回翻转(≥1 次往返)
    const evs = flick.events;
    const hiddenFlips = []; // 每个翻转事件
    for (let i = 1; i < evs.length; i++) {
      const a = evs[i - 1], b = evs[i];
      for (let k = 0; k < Math.max(a.widgets.length, b.widgets.length); k++) {
        const wa = a.widgets[k], wb = b.widgets[k];
        if (wa?.n === wb?.n && wa?.n && wa.hidden !== wb.hidden) {
          hiddenFlips.push({ widget: wa.n, from: wa.hidden, to: wb.hidden, atMs: b.t, scaleAt: b.scale });
        }
      }
    }
    const sizeChanges = [];
    for (let i = 1; i < evs.length; i++) {
      const a = evs[i - 1], b = evs[i];
      if (a.size[0] !== b.size[0] || a.size[1] !== b.size[1]) sizeChanges.push({ from: a.size, to: b.size, atMs: b.t });
    }
    const layoutChanges = [];
    for (let i = 1; i < evs.length; i++) {
      if (evs[i - 1].layout !== evs[i].layout) layoutChanges.push({ from: evs[i - 1].layout, to: evs[i].layout, atMs: evs[i].t });
    }
    check(phaseName, `状态层采样就位(rAF 帧数=${flick.frameCount},变化事件=${evs.length})`,
      flick.frameCount > 50 && evs.length >= 1, `frames=${flick.frameCount} events=${evs.length}`);
    check(phaseName, `hidden 翻转次数(闪现直证;0=无)`, true, JSON.stringify(hiddenFlips.slice(0, 20)) + ` 共${hiddenFlips.length}次`);
    check(phaseName, `layout 件数变化(布局抖动)`, true, JSON.stringify(layoutChanges.slice(0, 20)) + ` 共${layoutChanges.length}次`);
    check(phaseName, `node size 变化`, true, JSON.stringify(sizeChanges.slice(0, 20)) + ` 共${sizeChanges.length}次`);

    report.phases[phaseName].summary = {
      frameCount: flick.frameCount, changeEvents: evs.length,
      hiddenFlips, hiddenFlipCount: hiddenFlips.length,
      layoutChanges, sizeChanges,
      baseline: JSON.parse(baseState || "{}"), endState: JSON.parse(endState || "{}"),
      framesTotal: frames.length, framesSaved: saved,
      eventsHead: evs.slice(0, 40),
    };
    return { hiddenFlips, layoutChanges };
  } finally {
    page.close();
    killChrome();
    await sleep(1500);
  }
}

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version, "fe", stats.system?.required_frontend_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  const extListed = exts.some((x) => x === EXT_URL_PART);
  log("引擎侧扩展 js 已列:", extListed);
  report.engineFrontend = stats.system?.required_frontend_version;
  report.extListedByEngine = extListed;

  const phaseA = await runPhase("on-ext", { cdpPort: 9395, blockExt: false });
  const phaseB = await runPhase("off-ext", { cdpPort: 9396, blockExt: true });

  // ---- 总判 ----
  const aFlicker = phaseA.hiddenFlips.length > 0;
  const bFlicker = phaseB.hiddenFlips.length > 0;
  report.verdict = { aFlicker, bFlicker };
  log(`\n== 总判 ==`);
  log(`Phase A(扩展启用)hidden 翻转: ${phaseA.hiddenFlips.length} 次`);
  log(`Phase B(扩展禁用)hidden 翻转: ${phaseB.hiddenFlips.length} 次`);
  if (aFlicker && !bFlicker) log("→ 锅在扩展(qi21-panel-linkage 显隐时机竞态)");
  else if (aFlicker && bFlicker) log("→ 锅在前端本体(两相均抖)");
  else log("→ headless 下未复现 hidden 抖动(看帧序列像素层)");
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT_DIR, "flicker-repro-report.json"), JSON.stringify(report, null, 2));
  log("报告:", join(OUT_DIR, "flicker-repro-report.json"));
  process.exit(0);
} catch (e) {
  report.error = String(e?.stack || e);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT_DIR, "flicker-repro-report.json"), JSON.stringify(report, null, 2));
  console.error("[ENV/FATAL]", e);
  killChrome();
  process.exit(2);
}
