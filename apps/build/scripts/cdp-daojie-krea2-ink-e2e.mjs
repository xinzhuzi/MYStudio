#!/usr/bin/env node
/**
 * 道劫专属 Krea2 工作流装机应用 E2E(09-14):
 * 启动装机版 → 侧栏「本地模型」进 ComfyUI 沉浸模块 → webview(域树断言 1_图片)
 * → 以侧栏同款机制(__manyingOpenWorkflow/loadGraphData)打开库内工作流
 *   「Krea2-道劫水墨-文生图_my」与「Krea2-道劫水墨-图生图_my」→ queuePrompt 实弹
 * → 断言引擎 output 各新增一张 PNG。
 *
 * CDP 通道:Electron <webview> 不注册到 /json/list(实弹 09-14),
 * webview 内一律经主 target evaluate `document.querySelector('webview').executeJavaScript()`。
 *
 * 前置:/Applications/漫影工作室.app 为最新打包(build:mac 已覆盖安装)。
 * 环境变量:KEEP_APP=1 测完保留应用;CDP_PORT 默认 9222;GEN_TIMEOUT_MS 默认 420s。
 * 退出码:0=全部断言通过;1=失败;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.manju2026.manying-studio";
const CH = join(homedir(), "Library/Application Support/漫影工作室/comfyui");
const ENGINE_OUTPUT = join(CH, "output");
const ENGINE_INPUT = join(CH, "input");
// 09-14 用户裁定:漫影工作流文件名一律 _my.json 后缀(应用已全库改名)
const WF_T2I_REL = "漫影/1_图片/K2图像/1_文生图/MY-漫影-K2-文生图.json";
const WF_I2I_REL = "漫影/1_图片/K2图像/2_图生图/MY-漫影-K2-图生图.json";
const WF_DIR = join(CH, "ComfyUI/user/default/workflows");
const REF_IMAGE = "daojie_e2e_ref.png";
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 420_000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function prekillApp() {
  const cp = require("node:child_process");
  // 照 smoke-desktop.mjs stopExistingMYStudioInstances 官方惯例
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    // 引擎是应用托管子进程;孤儿引擎占口毒化下一轮(09-10 教训),按引擎家路径连带清理
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
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`/tmp/daojie-ink-e2e-${name}.png`, Buffer.from(r.data, "base64"));
      log(`📸 /tmp/daojie-ink-e2e-${name}.png`);
    },
  };
}

/** webview 内执行(<webview> 不进 /json/list,经主 target 的 executeJavaScript 通道)。 */
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

function countOutput(prefix) {
  if (!existsSync(ENGINE_OUTPUT)) return 0;
  return readdirSync(ENGINE_OUTPUT).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).length;
}

async function waitNewOutput(prefix, before, { timeout = GEN_TIMEOUT_MS } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const now = countOutput(prefix);
    if (now > before) {
      const name = readdirSync(ENGINE_OUTPUT).filter((f) => f.startsWith(prefix) && f.endsWith(".png"))
        .map((f) => ({ f, t: statSync(join(ENGINE_OUTPUT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
      return name;
    }
    await sleep(3000);
  }
  return null;
}

/** 在 webview 里以侧栏同款机制打开库工作流(name=库内相对全路径)。 */
async function openWorkflowInCanvas(main, name, graphJson) {
  const code = `(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    const payload = { name: ${JSON.stringify(name)}, graph: ${JSON.stringify(graphJson)} };
    try {
      if (typeof window.__manyingOpenWorkflow === 'function') { void window.__manyingOpenWorkflow(payload); return 'opened-via-sidebar-api'; }
    } catch (e) { /* fallthrough */ }
    app.loadGraphData(payload.graph, true, true, payload.name);
    return 'opened-via-loadGraphData';
  })()`;
  return wv(main, code);
}

async function queueAndAssert(main, { tag, prefix }) {
  const before = countOutput(prefix);
  // 诊断:队列图=graphToPrompt 的真实形态(kjnodes 等扩展可能在序列化时注入节点)
  const digest = await wv(main, `(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const types = {};
      for (const k of Object.keys(p.output || {})) types[p.output[k].class_type] = (types[p.output[k].class_type] || 0) + 1;
      const inj = Object.keys(p.output || {}).filter(k => /PreviewOverride/i.test(p.output[k].class_type || ''));
      const injDetail = inj.map(k => ({ id: k, cls: p.output[k].class_type, inputs: p.output[k].inputs }));
      return JSON.stringify({ types, injDetail });
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  log(`[${tag}] 队列图类型:`, String(digest).slice(0, 400));
  const queued = await wv(main, `(async () => {
    const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null;
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && e.message); }
  })()`);
  check(`${tag}: queuePrompt 发出`, queued === "queued", String(queued));
  if (queued !== "queued") return false;
  const img = await waitNewOutput(prefix, before);
  if (!img) {
    const hist = await wv(main, `(async () => {
      try {
        const h = await (await fetch('/history')).json();
        const entries = Object.entries(h).sort((a, b) => (b[1].prompt ? b[1].prompt[1] : 0) - (a[1].prompt ? a[1].prompt[1] : 0)).slice(0, 2);
        return JSON.stringify(entries.map(([pid, e]) => ({ pid: pid.slice(0, 8), status: e.status })));
      } catch (err) { return 'hist-err:' + err.message; }
    })()`);
    log(`[${tag}] 引擎 history 近2条:`, String(hist).slice(0, 500));
    check(`${tag}: 引擎出图`, false, `超时 ${GEN_TIMEOUT_MS / 1000}s`);
    return false;
  }
  const size = statSync(join(ENGINE_OUTPUT, img.f)).size;
  const ok = size > 200_000;
  check(`${tag}: 引擎出图`, ok, `${img.f} (${(size / 1024).toFixed(0)}KB)`);
  return ok;
}

async function main() {
  if (!existsSync(APP_BIN)) { console.error("装机应用不存在:", APP_BIN); process.exit(2); }
  const wfT2I = join(WF_DIR, WF_T2I_REL);
  const wfI2I = join(WF_DIR, WF_I2I_REL);
  for (const f of [wfT2I, wfI2I]) {
    if (!existsSync(f)) { console.error("库工作流缺失:", f); process.exit(2); }
  }
  // 参考图(图生图用):复用最近一张应用分镜图
  const refCandidates = readdirSync(ENGINE_OUTPUT).filter((f) => /^MYStudio_.*\.png$/.test(f)).sort().reverse();
  if (!refCandidates.length) { console.error("无参考图可用(output 无 MYStudio_*.png)"); process.exit(2); }
  copyFileSync(join(ENGINE_OUTPUT, refCandidates[0]), join(ENGINE_INPUT, REF_IMAGE));
  log("参考图就位:", REF_IMAGE, "←", refCandidates[0]);

  log("① prekill + 启动装机应用(真实 userData)");
  prekillApp();
  launchApp();

  log("② attach 主窗口,等应用水合");
  const mainPage = await getMainClient();
  log("主窗口:", (mainPage.url || "").slice(0, 60));
  await waitFor(() => mainPage.ev(vis(`document.querySelectorAll('button').length > 5`)), { label: "应用水合" });
  await mainPage.screenshot("1-app-ready");

  const onDashboard = await mainPage.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
  if (onDashboard) {
    await mainPage.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
    log("进入道劫项目"); await sleep(3000);
  } else { log("已在项目内"); }

  log("③ 侧栏「本地模型」进 ComfyUI 沉浸模块");
  const navClicked = await mainPage.domClick("button", `e => ((e.textContent||'').trim() === '本地模型')`);
  check("侧栏「本地模型」入口可点", Boolean(navClicked), String(navClicked));
  await mainPage.screenshot("2-nav-clicked");

  log("④ 等 webview 挂载(引擎冷启>2min,状态机:就绪未跑→启动屏→running→webview)");
  {
    const t0 = Date.now();
    let lastShot = 0;
    while (Date.now() - t0 < 600_000) {
      const state = await mainPage.ev(vis(`(() => {
        if (document.querySelector('webview')) return 'webview';
        const startBtn = document.querySelector('[data-comfy-canvas-start]');
        if (startBtn) return 'need-start';
        if (document.querySelector('[data-comfy-canvas-starting]')) return 'starting';
        return 'waiting';
      })()`));
      if (state === "need-start") {
        const clicked = await mainPage.domClick("[data-comfy-canvas-start]", "e=>true");
        log("点击「启动 ComfyUI」:", clicked);
      }
      if (state === "webview") break;
      if (Date.now() - lastShot > 45_000) { lastShot = Date.now(); log("引擎状态:", state); await mainPage.screenshot(`4-engine-${state}`); }
      await sleep(3000);
    }
    if (!(await mainPage.ev(vis(`!!document.querySelector('webview')`)))) throw new Error("waitFor 超时: webview 元素挂载(600s)");
  }
  await waitFor(
    () => wv(mainPage, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  check("ComfyUI 画布就绪(webview.app.isGraphReady)", true);
  await mainPage.screenshot("3-comfy-ready");

  log("⑤ 打开漫影侧栏并断言本地模型模块域树");
  // 漫影侧栏=ComfyUI sidebar tab(id=manying.shots/title=漫影),dock 按钮在
  // side-tool-bar;域名渲染去数字前缀(1_图片→图片)且分组默认折叠,
  // 断言用恒可见区标题「本地模型工作流库」
  await waitFor(() => wv(mainPage, `(() => {
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null;
    btn.click();
    return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮" });
  const hasDomain = await waitFor(() => wv(mainPage, `document.body.innerText.includes('本地模型工作流库') ? 'yes' : null`),
    { timeout: 30_000, label: "侧栏工作流库区" });
  check("侧栏含本地模型工作流库(域树浏览)", Boolean(hasDomain));
  await mainPage.screenshot("4-sidebar-domains");

  log("⑥ 打开道劫文生图工作流并实弹");
  const t2iGraph = JSON.parse(readFileSync(wfT2I, "utf8"));
  const opened1 = await openWorkflowInCanvas(mainPage, WF_T2I_REL, t2iGraph);
  check("文生图工作流载入", opened1 && opened1 !== "app-not-ready", String(opened1));
  await sleep(2500);
  const nodes1 = await wv(mainPage, `window.app.graph ? window.app.graph._nodes.length : 0`);
  check("文生图画布节点数=17", nodes1 === 17, `实际 ${nodes1}`);
  await mainPage.screenshot("5-t2i-loaded");
  const okT2I = await queueAndAssert(mainPage, { tag: "文生图", prefix: "Krea2-道劫水墨-文生图" });
  await mainPage.screenshot("6-t2i-result");

  log("⑦ 打开道劫图生图工作流并实弹(参考图注入 LoadImage)");
  const i2iGraph = JSON.parse(readFileSync(wfI2I, "utf8"));
  const opened2 = await openWorkflowInCanvas(mainPage, WF_I2I_REL, i2iGraph);
  check("图生图工作流载入", opened2 && opened2 !== "app-not-ready", String(opened2));
  await sleep(2500);
  // __manyingOpenWorkflow 绑定库文件重读原始 JSON(传参 graph 被忽略),基底的
  // LoadImage 默认图「测试图 (27).png」不在本机 input=validation 拒队列。按真实
  // 用户路径补一步:在画布上把 LoadImage 选为参考图(改 widget 值+触发 callback)。
  const refSet = await wv(mainPage, `(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'LoadImage');
    if (!n || !n.widgets) return null;
    const w = n.widgets.find(w => w.name === 'image');
    if (!w) return null;
    w.value = ${JSON.stringify(REF_IMAGE)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return w.value;
  })()`);
  check("图生图参考图已选(画布 LoadImage)", refSet === REF_IMAGE, String(refSet));
  await sleep(1200);
  const nodes2 = await wv(mainPage, `window.app.graph ? window.app.graph._nodes.length : 0`);
  check("图生图画布节点数=21", nodes2 === 21, `实际 ${nodes2}`);
  await mainPage.screenshot("7-i2i-loaded");
  const okI2I = await queueAndAssert(mainPage, { tag: "图生图", prefix: "Krea2-道劫水墨-图生图" });
  await mainPage.screenshot("8-i2i-result");

  mainPage.close();
  const allPass = results.every((r) => r.pass);
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  log(allPass ? "✅ E2E 全部通过" : "❌ E2E 存在失败项");
  if (!process.env.KEEP_APP) prekillApp();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("E2E 失败:", e.message); if (!process.env.KEEP_APP) prekillApp(); process.exit(1); });
