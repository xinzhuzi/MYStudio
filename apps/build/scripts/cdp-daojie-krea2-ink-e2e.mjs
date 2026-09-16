#!/usr/bin/env node
/**
 * 道劫专属 Krea2 工作流装机应用 E2E(09-14):
 * 启动装机版 → 侧栏「本地模型」进 ComfyUI 沉浸模块 → webview(域树断言 1_图片)
 * → 以侧栏同款机制(__myOpenWorkflow/loadGraphData)打开库内工作流
 *   「Krea2-道劫水墨-文生图_my」与「Krea2-道劫水墨-图生图_my」→ queuePrompt 实弹
 * → 断言引擎 output 各新增一张 PNG。
 *
 * CDP 通道:Electron <webview> 不注册到 /json/list(实弹 09-14),
 * webview 内一律经主 target evaluate `document.querySelector('webview').executeJavaScript()`。
 *
 * 前置:/Applications/漫影工作室.app 为最新打包(build:mac 已覆盖安装)。
 * 环境变量:KEEP_APP=1 测完保留应用;CDP_PORT 默认 9222;GEN_TIMEOUT_MS 默认 420s;
 * SKIP_GEN=1 免生图模式——⑤b 跳转/复用段照跑,⑥⑦ queuePrompt 跳过
 * (装机实弹但不加载模型权重,避开与并行大模型批次撞车)。
 * 退出码:0=全部断言通过;1=失败;2=环境错误。
 *
 * ⑤b(09-15 用户裁定回归):侧栏「重复点击同一 repo: 工作流=复用已开标签页」——
 * 走真实用户路径(漫影侧栏叶子行 onclick→openMyWorkflow),断言:首次点击画布
 * 切换且标签注册进 svc.openWorkflows、二次点击画布切回且标签集不变(带号 "(N)"
 * 复本叠签=失败);window.fetch spy 只作 content 拉取次数诊断(修复后复用=激活+
 * 按实例装载,内容仍每次拉取,fetch 数不是门)。
 *
 * 09-15 交接踩坑(全部落进对应代码位,勿再撞):
 * ① webview executeJavaScript 大段 async IIFE 偶发 GUEST_VIEW_MANAGER_CALL
 *   "undefined" is not valid JSON(IPC 竞态)——每段注入≤10 行、段间 sleep;
 * ② 装机 smoke 临时实例(mystudio-installed-smoke-*)残留会抢 9222 调试口——
 *   prekillApp 连带清理;
 * ③ webview persist 缓存旧 sidebar.js,普通 reload 无效,reloadIgnoringCache
 *   才可靠——⑤b 裁决的正是 sidebar.js,先无条件无视缓存重载再测;
 * ④ CDP Page.captureScreenshot 偶发空数据,macOS 原生 screencapture 兜底。
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
// 09-14 工作流存放架构裁定:静态自研 MY- 真源=仓库 apps/backend/engines/comfyui/workflows
const WF_T2I_REL = "1_图片/K2图像/1_文生图/MY-K2-文生图.json";
const WF_I2I_REL = "1_图片/K2图像/2_图生图/MY-K2-图生图.json";
const WF_DIR = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows";
const REF_IMAGE = "daojie_e2e_ref.png";
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 420_000);
const SKIP_GEN = process.env.SKIP_GEN === "1";

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
    // 踩坑②(09-15 交接):装机 smoke 临时 userData 实例(mystudio-installed-smoke-*)
    // 偶发活到本轮,抢 9222 调试口——起应用前连带清掉
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
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
      const path = `/tmp/daojie-ink-e2e-${name}.png`;
      // 踩坑④(09-15 交接):CDP 截图偶发返回空数据,macOS 原生 screencapture 兜底
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) {
          writeFileSync(path, Buffer.from(r.data, "base64"));
          log(`📸 ${path}`);
          return;
        }
      } catch { /* 落入原生截屏兜底 */ }
      try {
        require("node:child_process").execFileSync("screencapture", ["-x", "-C", path]);
        log(`📸(native) ${path}`);
      } catch { log(`📸 失败 ${path}`); }
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

/** 在 webview 里打开库工作流(name=画布标签)。
 * 09-14 manying→my 重构后 opener 别名路径装机实测 30s 不切画布(并行域
 * 回归,另行移交)——E2E 改走 loadGraphData 直载(同一 graphToPrompt/queue
 * 数据链,等效验证出图);打开协议 UI 路径留并行会话回归。 */
async function openWorkflowInCanvas(main, name, graphJson) {
  const code = `(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
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
  // 阈值 50KB:水墨风大面积留白的极简图 PNG 可低至 ~87KB(实测 00006),
  // 200KB 会误判合法产出;50KB 拦截真坏图(截断/空图)足够
  const ok = size > 50_000;
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
  // 参考图(图生图用):复用最近一张应用分镜图(SKIP_GEN 免生图模式不需要)
  if (!SKIP_GEN) {
    const refCandidates = readdirSync(ENGINE_OUTPUT).filter((f) => /^MYStudio_.*\.png$/.test(f)).sort().reverse();
    if (!refCandidates.length) { console.error("无参考图可用(output 无 MYStudio_*.png)"); process.exit(2); }
    copyFileSync(join(ENGINE_OUTPUT, refCandidates[0]), join(ENGINE_INPUT, REF_IMAGE));
    log("参考图就位:", REF_IMAGE, "←", refCandidates[0]);
  }

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
  await sleep(1200);
  // 09-14 加固:freedom persist 可能记住非画布模式(漫影生图表单态,
  // data-local-model-studio),须借悬浮球「本地模型」分区切回 ComfyUI 画布,
  // 否则 webview 永不挂载(后续步骤全挂)
  const inForm = await mainPage.ev(vis(`!!document.querySelector('[data-local-model-studio]')`));
  if (inForm) {
    log("检测到生图表单态,切回 ComfyUI 画布(悬浮球模式直达)");
    await mainPage.ev(vis(`document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`));
    await waitFor(() => mainPage.ev(vis(`(() => {
      const sec = document.querySelector('[data-orb-section="local-models"]');
      if (sec && sec.getAttribute('data-state') === 'closed') sec.querySelector('button')?.click();
      return !!document.querySelector('[data-orb-nav-mode="comfy"]');
    })()`)), { timeout: 15_000, interval: 800, label: "本地模型分区展开" });
    await mainPage.ev(vis(`document.querySelector('[data-orb-nav-mode="comfy"]')?.click()`));
    await sleep(1500);
  }
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

  log("⑤ 打开漫影侧栏并断言目录单树");
  // 漫影侧栏=ComfyUI sidebar tab(id=my.shots/title=漫影),dock 按钮在
  // side-tool-bar;09-14 裁定:本地模型模块只列「漫影 K2 生图」直达
  // (全库浏览与「N 个工作流」计数行退役);webview 持久会话可能缓存旧 JS,
  // 未见新区时忽略缓存重载一次再判
  await waitFor(() => wv(mainPage, `(() => {
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null;
    btn.click();
    return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮" });
  // 09-15 终态:侧栏=仓库目录单树镜像(编号从 0 向后)
  let hasK2 = await wv(mainPage, `document.body.innerText.includes('1_图片') && document.body.innerText.includes('K2图像') ? 'yes' : null`);
  let hasLib0 = hasK2;
  if (!hasK2 || !hasLib0) {
    await mainPage.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
    await waitFor(() => wv(mainPage, `window.app && window.app.isGraphReady === true ? 'y' : null`),
      { timeout: 120_000, interval: 2000, label: "webview 忽略缓存重载" });
    await waitFor(() => wv(mainPage, `(() => {
      const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
        .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
      if (!btn) return null; btn.click(); return 'clicked';
    })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮(重载后)" });
    hasK2 = await waitFor(() => wv(mainPage, `document.body.innerText.includes('1_图片') && document.body.innerText.includes('K2图像') ? 'yes' : null`),
      { timeout: 30_000, label: "K2 生图直达区" });
  }
  check("侧栏为仓库目录单树(1_图片/K2图像 段在)", hasK2 === "yes");
  const noJunk = await wv(mainPage, `(() => ({ lib: document.body.innerText.includes('本地模型工作流库'), n36: document.body.innerText.includes('个工作流') }))()`);
  check("旧工作流库浏览区已退役(无「本地模型工作流库」/「N 个工作流」)", Boolean(noJunk) && !noJunk.lib && !noJunk.n36);
  // 09-14 补全:漫影工作流库全量浏览(repo 真源 36 条,只在漫影侧栏)。
  // 库区在桥 fetch 完成后才渲染(直达区标题是同步先出)——必须轮询等待,
  // 单次取值会在 fetch 未归时抢跑假失败(第二十二轮实弹)
  const hasLib = await waitFor(() => wv(mainPage, `document.body.innerText.includes('2_视频') && document.body.innerText.includes('3_声音') ? 'yes' : null`),
    { timeout: 25_000, interval: 800, label: "目录树全量(2_视频/3_声音)" }).catch(() => null);
  check("侧栏树含全部域(2_视频/3_声音 在)", hasLib === "yes");
  await mainPage.screenshot("4-sidebar-k2");

  log("⑤b 侧栏跳转=复用已开标签页(09-15 裁定回归,免生图)");
  // 踩坑③:webview persist 会缓存旧 sidebar.js,普通 reload 无效,
  // reloadIgnoringCache 才可靠——⑤ 树在场不能证明跑的是新代码,裁决前先无条件重载。
  // 重载 commit 是异步的:isGraphReady 在旧页恒真会抢跑(首轮实弹教训:前几步
  // 跑在旧页、导航中途生效把状态炸了)——先在旧页落标记,「标记消失+graph 就绪」
  // 才是新页真身
  await wv(mainPage, `window.__myPreReloadMarker = 1`);
  await mainPage.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
  await waitFor(() => wv(mainPage, `(!window.__myPreReloadMarker && window.app && window.app.isGraphReady === true) ? 'y' : null`),
    { timeout: 120_000, interval: 2000, label: "复用段·新页真身(旧页标记消失+graph 就绪)" });
  // 收敛式打开:树在场才退出;树不在则点 dock 钮(重载后面板开合态不确定,
  // 盲点一下可能把已开的关上——点完不退出、下一轮见树才算数)
  await waitFor(() => wv(mainPage, `(() => {
    if (document.body.innerText.includes('1_图片') && document.body.innerText.includes('K2图像')) return 'y';
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "复用段·漫影侧栏打开(树在场)" });

  // 踩坑①:以下注入每段≤10 行、段间 sleep,勿合并大段(IPC 竞态)
  const leafProbe = (rel) => `(() => [...document.querySelectorAll('.my-tree-row')]
    .some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + rel)})) ? 'y' : null)()`;
  const leafClick = (rel) => wv(mainPage, `(() => {
    const row = [...document.querySelectorAll('.my-tree-row')]
      .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + rel)}));
    if (!row) return null; row.click(); return 'ok';
  })()`);
  // 目录行(含折叠钮 button)点击=开合切换,只点一次;叶子行=带「点击在画布打开: repo:」title
  const expandFolder = async (name) => {
    await waitFor(() => wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => r.querySelector('button') && r.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
      if (!row) return null; row.click(); return 'ok';
    })()`), { timeout: 20_000, interval: 1200, label: `展开目录 ${name}` });
    await sleep(800);
  };
  const readTabs = async () => JSON.parse((await wv(mainPage, `(() => {
    const s = window.app && window.app.extensionManager && window.app.extensionManager.workflow;
    const w = (s && s.openWorkflows) || [];
    return JSON.stringify({ len: w.length, paths: w.map(x => x && x.path) });
  })()`)) || '{"len":-1,"paths":[]}');
  // 路径三形态匹配,镜像 sidebar.js openMyWorkflow 的命中规则(勿比实现更严)
  const matchesRel = (paths, rel) => (paths || []).some((p) =>
    p === rel || p === "repo:" + rel || String(p || "").replace(/^workflows\//, "") === rel);

  const t2iGraph = JSON.parse(readFileSync(wfT2I, "utf8"));
  const i2iGraph = JSON.parse(readFileSync(wfI2I, "utf8"));
  const expectT2I = t2iGraph.nodes.length; // 真源节点数(并行演进,勿硬编码)
  const expectI2I = i2iGraph.nodes.length;

  await expandFolder("K2图像");
  await expandFolder("1_文生图");
  await waitFor(() => wv(mainPage, leafProbe(WF_T2I_REL)), { timeout: 15_000, interval: 800, label: "文生图叶子行" });
  await leafClick(WF_T2I_REL);
  const nodesT2I = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expectT2I} ? ${expectT2I} : null`),
    { timeout: 60_000, interval: 1000, label: `首次点击·画布切文生图(${expectT2I} 节点)` }).catch(() => 0);
  check("侧栏跳转·首次点击打开文生图(画布)", nodesT2I === expectT2I, `画布 ${nodesT2I}/${expectT2I} 节点`);
  const tabs1 = await readTabs();
  check("侧栏跳转·打开后标签已注册(openWorkflows 命中库路径)", matchesRel(tabs1.paths, WF_T2I_REL),
    JSON.stringify(tabs1.paths).slice(0, 300));

  await expandFolder("2_图生图");
  await waitFor(() => wv(mainPage, leafProbe(WF_I2I_REL)), { timeout: 15_000, interval: 800, label: "图生图叶子行" });
  await leafClick(WF_I2I_REL);
  const nodesI2I = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expectI2I} ? ${expectI2I} : null`),
    { timeout: 60_000, interval: 1000, label: `切换·画布切图生图(${expectI2I} 节点)` }).catch(() => 0);
  check("侧栏跳转·切到图生图(画布)", nodesI2I === expectI2I, `画布 ${nodesI2I}/${expectI2I} 节点`);
  const tabs2 = await readTabs();

  // 诊断取证:spy window.fetch 数 /comfy/workflows/<id>/content 拉取——修复后
  // 复用=激活+按实例装载,内容仍每次拉取(fetch 恒≥1,只作诊断不作门);
  // 复用的判据是标签集不变(带号 "(N)" 复本叠签会让集合变样)
  const armed = await wv(mainPage, `(() => {
    const of = window.fetch.bind(window);
    let n = 0;
    window.fetch = (...a) => { const u = String(a[0]); if (u.includes('/comfy/workflows/') && u.includes('/content')) n++; return of(...a); };
    window.__myContentFetchCount = () => n;
    return 'armed';
  })()`);
  await sleep(300);
  await leafClick(WF_T2I_REL);
  const nodesBack = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expectT2I} ? ${expectT2I} : null`),
    { timeout: 60_000, interval: 1000, label: `二次点击·画布切回文生图(${expectT2I} 节点)` }).catch(() => 0);
  const fetchCount = await wv(mainPage, `window.__myContentFetchCount ? window.__myContentFetchCount() : null`);
  const tabs3 = await readTabs();
  const sameTabs = tabs3.len === tabs2.len
    && JSON.stringify([...tabs2.paths].sort()) === JSON.stringify([...tabs3.paths].sort());
  check("侧栏跳转·二次点击切回文生图(画布)", nodesBack === expectT2I, `画布 ${nodesBack}/${expectT2I} 节点`);
  check("侧栏跳转·复用已开标签页(标签集不变)", sameTabs,
    `二次点击前后 ${tabs2.len}→${tabs3.len} 签,content 拉取 ${fetchCount} 次;paths=${JSON.stringify(tabs3.paths).slice(0, 300)}`);
  await mainPage.screenshot("4b-tab-reuse");

  log("⑤c 侧栏右键菜单(09-15 用户裁定:镜像原生工作流右键;litegraph ContextMenu)");
  // 菜单=sidebar.js 自己的 oncontextmenu 构造(window.ContextMenu 扩展点),
  // 合成 contextmenu 事件直达;条目类=.litemenu-entry(与画布右键菜单同款)
  const rowCtx = (rel) => wv(mainPage, `(() => {
    const row = [...document.querySelectorAll('.my-tree-row')]
      .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + rel)}));
    if (!row) return null;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: 220, clientY: 300, button: 2 }));
    return 'ctx';
  })()`);
  const menuItems = () => wv(mainPage, `(() => [...document.querySelectorAll('.litemenu-entry')]
    .filter(e => e.offsetWidth || e.offsetHeight).map(e => (e.textContent || '').trim()))()`);
  const clickMenuItem = (name) => wv(mainPage, `(() => {
    const el = [...document.querySelectorAll('.litemenu-entry')]
      .find(e => ((e.textContent || '').trim()).includes(${JSON.stringify(name)}));
    if (!el) return null; el.click(); return 'ok';
  })()`);
  const canvasNodes = () => wv(mainPage, `window.app.graph ? window.app.graph._nodes.length : null`);

  await rowCtx(WF_T2I_REL); await sleep(800);
  const items1 = await menuItems();
  const need = ["打开", "插入当前画布", "复制副本", "关闭标签", "导出 JSON"];
  check("右键菜单·五项齐(含已开态的关闭标签)", JSON.stringify(items1) === JSON.stringify(need),
    `实际 [${(items1 || []).join("|")}]`);

  await clickMenuItem("打开");
  const openKeep = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expectT2I} ? 'y' : null`),
    { timeout: 30_000, interval: 800, label: "右键打开·画布保持文生图" }).catch(() => null);
  check("右键菜单·打开生效(画布=文生图)", openKeep === "y", `画布 ${await canvasNodes()}/${expectT2I}`);

  await rowCtx(WF_T2I_REL); await sleep(800);
  await clickMenuItem("插入当前画布");
  const inserted = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expectT2I * 2} ? 'y' : null`),
    { timeout: 30_000, interval: 800, label: `插入·节点并入(19→${expectT2I * 2})` }).catch(() => null);
  check("右键菜单·插入当前画布(节点并入,原生 insertWorkflow 同款)", inserted === "y", `画布 ${await canvasNodes()}/${expectT2I * 2}`);
  await mainPage.screenshot("4c-insert");

  await rowCtx(WF_T2I_REL); await sleep(800);
  await clickMenuItem("复制副本");
  const copied = await waitFor(() => wv(mainPage, `(() => {
    const s = window.app && window.app.extensionManager && window.app.extensionManager.workflow;
    const w = (s && s.openWorkflows) || [];
    const hit = w.some(x => x && String(x.path || '').endsWith('MY-K2-文生图 副本.json'));
    return hit && window.app.graph && window.app.graph._nodes.length === ${expectT2I} ? 'y' : null;
  })()`), { timeout: 30_000, interval: 800, label: "复制副本·未保存副本签" }).catch(() => null);
  check("右键菜单·复制副本(副本签入清单+画布=副本)", copied === "y", `画布 ${await canvasNodes()}/${expectT2I}`);

  await rowCtx(WF_T2I_REL); await sleep(800);
  await clickMenuItem("关闭标签");
  const closed = await waitFor(() => wv(mainPage, `(() => {
    const s = window.app && window.app.extensionManager && window.app.extensionManager.workflow;
    const w = (s && s.openWorkflows) || [];
    const still = w.some(x => x && (x.path === ${JSON.stringify(WF_T2I_REL)} || x.path === ${JSON.stringify("repo:" + WF_T2I_REL)}
      || String(x.path || '').replace(/^workflows\\//, '') === ${JSON.stringify(WF_T2I_REL)}));
    return !still ? 'y' : null;
  })()`), { timeout: 30_000, interval: 800, label: "关闭标签·签移出清单" }).catch(() => null);
  check("右键菜单·关闭标签(签移出清单)", closed === "y");
  await mainPage.screenshot("4d-ctxmenu-done");

  if (SKIP_GEN) {
    log("⑥⑦ 跳过实弹生图(SKIP_GEN=1;跳转/复用段已覆盖本轮裁决,生图回归待并行大模型批次结束后全轮跑)");
  } else {
  log("⑥ 打开道劫文生图工作流并实弹");
  const opened1 = await openWorkflowInCanvas(mainPage, WF_T2I_REL, t2iGraph);
  check("文生图工作流载入", opened1 && opened1 !== "app-not-ready", String(opened1));
  const expect1 = t2iGraph.nodes.length; // 真源节点数(并行演进,勿硬编码)
  const nodes1 = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expect1} ? ${expect1} : null`),
    { timeout: 30_000, interval: 800, label: `文生图画布切换(${expect1} 节点)` }).catch(() => 0);
  check(`文生图画布节点数=${expect1}(真源动态)`, nodes1 === expect1, `实际 ${nodes1}`);
  await mainPage.screenshot("5-t2i-loaded");
  const okT2I = await queueAndAssert(mainPage, { tag: "文生图", prefix: "MY-K2-文生图" });
  await mainPage.screenshot("6-t2i-result");

  log("⑦ 打开道劫图生图工作流并实弹(参考图注入 LoadImage)");
  const opened2 = await openWorkflowInCanvas(mainPage, WF_I2I_REL, i2iGraph);
  check("图生图工作流载入", opened2 && opened2 !== "app-not-ready", String(opened2));
  // 会话恢复竞态:同文生图——轮询等画布真正切到 21 节点(选参考图/queue 才不串台)
  { const e2 = i2iGraph.nodes.length;
    await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${e2} ? ${e2} : null`),
      { timeout: 30_000, interval: 800, label: `图生图画布切换(${e2} 节点)` }).catch(() => 0); }
  // __myOpenWorkflow 绑定库文件重读原始 JSON(传参 graph 被忽略),基底的
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
  const expect2 = i2iGraph.nodes.length;
  const nodes2 = await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${expect2} ? ${expect2} : null`),
    { timeout: 30_000, interval: 800, label: `图生图画布切换(${expect2} 节点)` }).catch(() => 0);
  check(`图生图画布节点数=${expect2}(真源动态)`, nodes2 === expect2, `实际 ${nodes2}`);
  await mainPage.screenshot("7-i2i-loaded");
  const okI2I = await queueAndAssert(mainPage, { tag: "图生图", prefix: "MY-K2-图生图" });
  await mainPage.screenshot("8-i2i-result");
  }

  mainPage.close();
  const allPass = results.every((r) => r.pass);
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  log(allPass ? "✅ E2E 全部通过" : "❌ E2E 存在失败项");
  if (!process.env.KEEP_APP) prekillApp();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("E2E 失败:", e.message); if (!process.env.KEEP_APP) prekillApp(); process.exit(1); });
