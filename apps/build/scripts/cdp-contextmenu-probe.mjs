#!/usr/bin/env node
/**
 * 右键菜单装机取证探针(09-15,一次性诊断,非回归):
 * 对五个表面逐一发 contextmenu,转储弹出的菜单项 + 截图,回答
 * 「右键点击弹出了什么弹窗、里面有什么功能」:
 *   A 顶部工作流标签(ComfyUI 原生 WorkflowTab)
 *   B 漫影侧栏工作流叶子行(自研 sidebar.js 树)
 *   C 画布空白处(litegraph 画布菜单/节点搜索)
 *   D 画布中心(节点/连线右键,litegraph)
 *   E ComfyUI 侧栏 dock 按钮清单(+原生工作流侧栏树一眼)
 * 通道沿用 cdp-daojie-krea2-ink-e2e.mjs(webview 不进 /json/list,经主 target
 * executeJavaScript;注入每段≤10 行防 IPC 竞态;截图 CDP 优先+screencapture 兜底)。
 * 退出码恒 0(取证脚本不设断言门)。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.manju2026.manying-studio";
const WF_T2I_REL = "1_图片/K2图像/1_文生图/K2-文生图.json";
const WF_DIR = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function prekillApp() {
  const cp = require("node:child_process");
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
    ["pkill", ["-f", "漫影工作室/comfyui/ComfyUI/main.py"]],
  ];
  for (const [cmd, args] of steps) {
    try { cp.execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* 可选步骤 */ }
  }
}

function launchApp() {
  const child = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env, MYSTUDIO_REMOTE_DEBUG: "1" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  log("app spawned pid", child.pid);
}

async function getMainClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    try {
      const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
      page = list.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
      if (page) break;
    } catch { /* 端口未就绪 */ }
    await sleep(1500);
  }
  if (!page) throw new Error("主窗口 target 未出现");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return null;
      return r.result.value;
    },
    async domClick(selector, pred = "e=>true") {
      return this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="button"]') || el;
        t.click();
        return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
    async screenshot(name) {
      const path = `/tmp/ctx-probe-${name}.png`;
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) {
          require("node:fs").writeFileSync(path, Buffer.from(r.data, "base64"));
          log(`📸 ${path}`);
          return;
        }
      } catch { /* 落入原生截屏兜底 */ }
      try { require("node:child_process").execFileSync("screencapture", ["-x", "-C", path]); log(`📸(native) ${path}`); }
      catch { log(`📸 失败 ${path}`); }
    },
  };
}

async function wv(main, code) {
  return main.ev(`(async () => {
    const wv = document.querySelector('webview');
    if (!wv) return null;
    try { return await wv.executeJavaScript(${JSON.stringify(code)}, false); }
    catch (e) { return null; }
  })()`);
}

async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时: ${label}`);
}

// ── 取证小件(每段注入≤10 行,防 webview IPC 竞态)──
const dumpMenus = (main) => wv(main, `(() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const sels = ['[role="menu"]','[role="menuitem"]','.p-contextmenu','.p-contextmenu-item',
    '.p-menuitem','.litemenu','.litemenu-entry','.litemenu-title','[class*="ontextmenu"]'];
  const out = {};
  for (const s of sels) {
    const t = [...document.querySelectorAll(s)].filter(vis)
      .map(e => (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50)).filter(Boolean);
    if (t.length) out[s] = t.slice(0, 30);
  }
  return JSON.stringify(out);
})()`);

const ctxOn = (main, targetExpr, frac) => wv(main, `(() => {
  const el = ${targetExpr};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = Math.round(r.x + r.width * ${frac ?? 0.5}), y = Math.round(r.y + r.height / 2);
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 2, buttons: 2 }));
  return 'ctx@' + x + ',' + y;
})()`);

const closeMenus = (main) => wv(main, `(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: 8, clientY: 8, button: 0 }));
  return 1;
})()`);

/** litegraph 不监听 contextmenu 事件(包内零命中),菜单走 pointer 序列(button=2) */
const pointerCtx = (main, targetExpr, frac) => wv(main, `(() => {
  const el = ${targetExpr};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = Math.round(r.x + r.width * ${frac ?? 0.5}), y = Math.round(r.y + r.height / 2);
  const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y,
    button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', base));
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('contextmenu', base));
  return 'ptr-ctx@' + x + ',' + y;
})()`);

const report = (main, tag, shot) => async () => {
  await sleep(1000);
  const dump = await dumpMenus(main);
  log(`[${tag}] 菜单转储:`, dump);
  await main.screenshot(shot);
  await closeMenus(main);
  await sleep(400);
};

async function main() {
  if (!existsSync(APP_BIN)) { console.error("装机应用不存在:", APP_BIN); process.exit(2); }
  const t2iGraph = JSON.parse(readFileSync(join(WF_DIR, WF_T2I_REL), "utf8"));
  const expect = t2iGraph.nodes.length;

  log("① prekill + 启动装机应用");
  prekillApp();
  launchApp();
  const mainPage = await getMainClient();
  log("② 等应用水合");
  await waitFor(() => mainPage.ev(`(() => { try { return document.querySelectorAll('button').length > 5 || null; } catch { return null; } })()`), { label: "应用水合" });
  const onDashboard = await mainPage.ev(`(() => { try { return document.querySelectorAll('div.dashboard-project-card').length > 0 || null; } catch { return null; } })()`);
  if (onDashboard) {
    await mainPage.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
    log("进入道劫项目"); await sleep(3000);
  }
  await mainPage.domClick("button", `e => ((e.textContent||'').trim() === '本地模型')`);
  await sleep(1200);
  const inForm = await mainPage.ev(`(() => { try { return !!document.querySelector('[data-local-model-studio]') || null; } catch { return null; } })()`);
  if (inForm) {
    log("生图表单态→切回 ComfyUI 画布");
    await mainPage.ev(`(() => { try { document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return 1; } catch { return null; } })()`);
    await waitFor(() => mainPage.ev(`(() => {
      const sec = document.querySelector('[data-orb-section="local-models"]');
      if (sec && sec.getAttribute('data-state') === 'closed') sec.querySelector('button')?.click();
      return !!document.querySelector('[data-orb-nav-mode="comfy"]') || null;
    })()`), { timeout: 15_000, interval: 800, label: "本地模型分区展开" });
    await mainPage.ev(`(() => { try { document.querySelector('[data-orb-nav-mode="comfy"]')?.click(); return 1; } catch { return null; } })()`);
    await sleep(1500);
  }
  log("③ 等 webview + 画布就绪");
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 600_000) {
      const state = await mainPage.ev(`(() => {
        if (document.querySelector('webview')) return 'webview';
        const startBtn = document.querySelector('[data-comfy-canvas-start]');
        if (startBtn) return 'need-start';
        if (document.querySelector('[data-comfy-canvas-starting]')) return 'starting';
        return 'waiting';
      })()`);
      if (state === "need-start") await mainPage.domClick("[data-comfy-canvas-start]", "e=>true");
      if (state === "webview") break;
      await sleep(3000);
    }
  }
  await waitFor(() => wv(mainPage, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  log("画布就绪");

  log("④ 开漫影侧栏→展开目录→点文生图(制造一个已开标签)");
  await waitFor(() => wv(mainPage, `(() => {
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮" });
  await waitFor(() => wv(mainPage, `document.body.innerText.includes('K2图像') ? 'y' : null`), { timeout: 30_000, label: "侧栏树" });
  for (const folder of ["K2图像", "1_文生图"]) {
    await waitFor(() => wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => r.querySelector('button') && r.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(folder)});
      if (!row) return null; row.click(); return 'ok';
    })()`), { timeout: 20_000, interval: 1200, label: `展开 ${folder}` });
    await sleep(600);
  }
  await waitFor(() => wv(mainPage, `(() => [...document.querySelectorAll('.my-tree-row')].some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_T2I_REL)})) ? 'y' : null)()`),
    { timeout: 15_000, interval: 800, label: "文生图叶子行" });
  await wv(mainPage, `(() => { [...document.querySelectorAll('.my-tree-row')].find(r => (r.title||'').endsWith(${JSON.stringify("repo:" + WF_T2I_REL)}))?.click(); return 1; })()`);
  await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expect} ? 'y' : null`),
    { timeout: 60_000, interval: 1000, label: `文生图上画布(${expect} 节点)` });
  log(`文生图已开(${expect} 节点)`);

  log("E dock 按钮清单(原生侧栏有哪些入口)");
  const dock = await wv(mainPage, `(() => [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
    .map(b => (b.title || b.getAttribute('aria-label') || (b.textContent||'').trim()).trim()).filter(Boolean))()`);
  log("dock:", JSON.stringify(dock));

  log("A 顶部工作流标签右键");
  const tabHit = await ctxOn(mainPage, `[...document.querySelectorAll('.workflow-label')].find(e => (e.textContent||'').includes('K2-文生图'))`);
  log("[A] 派发:", tabHit);
  if (tabHit) await report(mainPage, "A·顶部标签", "A-tab")();
  else {
    const anyTab = await wv(mainPage, `(() => [...document.querySelectorAll('.workflow-label')].map(e => (e.textContent||'').trim()).slice(0,5))()`);
    log("[A] 未找到文生图标签;现存 .workflow-label:", JSON.stringify(anyTab));
    if (anyTab && anyTab.length) {
      await ctxOn(mainPage, `document.querySelector('.workflow-label')`);
      await report(mainPage, "A·顶部标签(第一个)", "A-tab")();
    } else await mainPage.screenshot("A-tab-missing");
  }

  log("B 漫影侧栏叶子行右键");
  const rowHit = await ctxOn(mainPage, `[...document.querySelectorAll('.my-tree-row')].find(r => (r.title||'').endsWith(${JSON.stringify("repo:" + WF_T2I_REL)}))`);
  log("[B] 派发:", rowHit);
  await report(mainPage, "B·漫影树行", "B-myrow")();

  log("C 画布左下空白右键(#graph-canvas,pointer 序列)");
  const cvCorner = await pointerCtx(mainPage, `document.querySelector('#graph-canvas')`, 0.04);
  log("[C] 派发:", cvCorner);
  await report(mainPage, "C·画布空白", "C-canvas")();

  log("D 画布中心右键(节点/连线上,#graph-canvas,pointer 序列)");
  const cvCenter = await pointerCtx(mainPage, `document.querySelector('#graph-canvas')`, 0.5);
  log("[D] 派发:", cvCenter);
  await report(mainPage, "D·画布中心", "D-center")();

  log("F 原生工作流侧栏条目右键(dock「工作流」→搜索过滤出叶子)");
  const wfBtn = await wv(mainPage, `(() => {
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('工作流') && !((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`);
  log("[F] 点开原生工作流侧栏:", wfBtn);
  if (wfBtn) {
    await sleep(1200);
    await wv(mainPage, `(() => {
      const input = document.querySelector('.side-bar-panel input, [class*="sidebar"] input');
      if (!input) return 'no-input';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'MY-');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'searched';
    })()`);
    await sleep(1500);
    const treeState = await wv(mainPage, `(() => ({
      json: [...document.querySelectorAll('.p-treenode-content, [class*="tree"] [class*="node-content"]')]
        .map(e => (e.textContent || '').trim()).filter(t => t.endsWith('.json')).slice(0, 6),
      all: [...document.querySelectorAll('.p-treenode-content, [class*="tree"] [class*="node-content"]')]
        .map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 8),
    }))()`);
    log("[F] 树状态:", JSON.stringify(treeState));
    const hit = await ctxOn(mainPage, `[...document.querySelectorAll('.p-treenode-content, [class*="tree"] [class*="node-content"]')]
      .find(e => (e.textContent || '').trim().endsWith('.json'))`);
    log("[F] 派发:", hit);
    await report(mainPage, "F·原生侧栏条目", "F-native-wf")();
  } else await mainPage.screenshot("F-btn-missing");

  mainPage.close();
  log("══ 取证完毕,截图: /tmp/ctx-probe-*.png ══");
  prekillApp();
  process.exit(0);
}

main().catch((e) => { console.error("探针失败:", e.message); prekillApp(); process.exit(1); });
