#!/usr/bin/env node
/**
 * 装机终验 e2E(0924 终局轮·装机出图验收):
 * 前提:/Applications/漫影工作室.app 已由 build-mac.sh 覆盖安装;应用已在跑且
 * CDP 9377 可达(真 userData,普通实例;9222 被用户 Chrome 占用故用 9377)。
 *
 * 阶段A 漫影生图(K2 三处展示之三)在场断言 + 侧栏「本地模型」进 ComfyUI 画布;
 * 阶段B 真前端打开 qi21-道劫-t2i(漫影侧栏 repo: 叶子行=真实用户路径,失败回落
 *        loadGraphData 直载——同一 graphToPrompt/queuePrompt 数据链)→ 干跑排队图
 *        取证(MyQi21DaojieBase.base=人物)→ queuePrompt → 引擎 output 新 PNG
 *        落盘 → cp 到 ~/Downloads/q21-final-0924/ + PNG 魔数 + sips 尺寸对账;
 * 阶段C(加分项,PE-I2I 已恢复才做)qi21-edit 件 [15] PE 开关 true → 干跑取证
 *        switch=true + 排队后 /queue 图含 CLIPLoader(pe_i2i 件)+TextGenerate →
 *        /interrupt 断开复位(照 qi21_e2e_final_0923.mjs ④ 省弹模式,排队通过即证)。
 *
 * 驱动仿 apps/build/scripts/cdp-daojie-krea2-ink-e2e.mjs(webview 经主 target
 * executeJavaScript;每段注入≤10 行防 IPC 竞态)+ qi21_e2e_final_0923.mjs(对拍
 * 证据构成:排队图指纹+output 落盘+PNG 魔数+sips 对账)。
 * 用法:node apps/build/scripts/qi21_install_accept_0924.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const CDP_PORT = Number(process.env.CDP_PORT || 9377);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const CH = join(homedir(), "Library/Application Support/漫影工作室/comfyui");
const ENGINE_OUTPUT = join(CH, "output");
const WF_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows`;
const WF_T2I_REL = "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
const WF_EDIT_REL = "1_图片/Q2-1图像/2_图生图/qi21-edit.json";
const E2E_DIR = `${process.env.HOME}/Downloads/q21-final-0924`;
const OUT_PREFIX = "QI21道劫文生图_";
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 1_500_000); // 25min(4.2MP 40步 MPS 余量)
const TOL_PX = 16, TOL_RATIO = 0.01; // 人物型声明 1816x2424(3:4);引擎 16 倍数归整容差

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function getMainClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 60_000) {
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
  const consoleErrors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
      consoleErrors.push({ src: "console", text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500), ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500), ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send, consoleErrors,
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
        t.scrollIntoView({ block: 'center' });
        const r = t.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        t.dispatchEvent(new PointerEvent('pointerdown', o));
        t.dispatchEvent(new MouseEvent('mousedown', o));
        t.dispatchEvent(new PointerEvent('pointerup', o));
        t.dispatchEvent(new MouseEvent('mouseup', o));
        t.dispatchEvent(new MouseEvent('click', o));
        return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
  };
}

/** webview 内执行(<webview> 不进 /json/list,经主 target executeJavaScript)。 */
async function wv(main, code) {
  return main.ev(`(async () => {
    const wv = document.querySelector('webview');
    if (!wv) return null;
    try { return await wv.executeJavaScript(${JSON.stringify(code)}, false); }
    catch (e) { return 'WV-ERR:' + (e && e.message); }
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

function listOutput(prefix) {
  if (!existsSync(ENGINE_OUTPUT)) return [];
  return readdirSync(ENGINE_OUTPUT).filter((f) => f.startsWith(prefix) && f.endsWith(".png"));
}

async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
    return { w: Number(w), h: Number(h) };
  } catch (e) { return { err: String(e.message) }; }
}

function pngMagic(path) {
  const buf = readFileSync(path);
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/** 在 webview 画布上按 type(+title 片段)找节点设 widget 值。 */
function setWidgetCode(type, titlePart, wname, value) {
  return `(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)}
      && (!${JSON.stringify(titlePart)} || String(n.title || '').includes(${JSON.stringify(titlePart)})));
    if (!n) return 'node-missing';
    const w = (n.widgets || []).find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + (n.widgets || []).map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) {}
    return 'set:' + String(w.value);
  })()`;
}

function promptDigestCode(classType, fields) {
  return `(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const out = [];
      for (const k of Object.keys(p.output || {}).sort()) {
        if (p.output[k].class_type === ${JSON.stringify(classType)}) {
          const o = { node: k };
          for (const f of ${JSON.stringify(fields)}) o[f] = p.output[k].inputs[f];
          out.push(o);
        }
      }
      return out.length ? JSON.stringify(out) : 'class-not-found';
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`;
}

function queuePromptCode() {
  return `(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`;
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  const report = { startedAt: new Date().toISOString(), cases: {} };
  const wfT2I = join(WF_DIR, WF_T2I_REL);
  const wfEdit = join(WF_DIR, WF_EDIT_REL);
  for (const f of [wfT2I, wfEdit]) {
    if (!existsSync(f)) { console.error("库工作流缺失:", f); process.exit(2); }
  }

  log("① warm attach 主窗口(应用已由外部拉起,CDP 9377)");
  const mainPage = await getMainClient();
  await waitFor(() => mainPage.ev(vis(`document.querySelectorAll('button').length > 5 || !!document.querySelector('webview')`)),
    { label: "应用水合(按钮或沉浸画布 webview)" });
  log("主窗口已连接(水合或沉浸画布态)");

  const webviewAlready = await mainPage.ev(vis(`!!document.querySelector('webview')`));
  if (webviewAlready) {
    log("② 已在本地模型沉浸画布态(webview 在场),跳过导航");
    check("「本地模型」入口可达(已在沉浸画布态)", true, "webview 已挂载,免导航");
  } else {
  log("② 悬浮球「本地模型」进 ComfyUI 沉浸模块(项目内侧栏路径不可达时走 orb goto)");
  const clickFull = (el) => mainPage.ev(`(() => {
    const b = ${el};
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    b.dispatchEvent(new MouseEvent('mousedown', o));
    b.dispatchEvent(new PointerEvent('pointerup', o));
    b.dispatchEvent(new MouseEvent('mouseup', o));
    b.dispatchEvent(new MouseEvent('click', o));
    return (b.textContent || '').trim().slice(0, 40);
  })()`);
  let navClicked = await mainPage.domClick("button", `e => ((e.textContent||'').trim() === '本地模型')`);
  if (!navClicked) {
    // 设置页主侧栏无「本地模型」:开悬浮球 → goto 分区点「本地模型」
    await clickFull(`document.querySelector('[data-workflow-orb]')`);
    await sleep(1200);
    navClicked = await clickFull(`[...document.querySelectorAll('[data-orb-section="goto"] button,[data-orb-section="goto"] [role="button"],[data-orb-section="goto"] a')].find(e => (e.textContent||'').includes('本地模型'))`);
  }
  check("「本地模型」入口可点(侧栏或 orb goto)", Boolean(navClicked), String(navClicked));
  await sleep(2500);
  // 生图表单态(漫影生图=K2 三处展示之三)在场断言;在表单态则取证再切画布
  const inForm = await mainPage.ev(vis(`!!document.querySelector('[data-local-model-studio]')`));
  let manyingFormText = null;
  if (inForm) {
    manyingFormText = await mainPage.ev(vis(`(document.querySelector('[data-local-model-studio]')?.innerText || '').slice(0, 600)`));
    check("漫影生图模块在场(K2 三处展示之三)", Boolean(manyingFormText), String(manyingFormText).slice(0, 200));
    await clickFull(`document.querySelector('[data-workflow-orb]')`);
    await sleep(1000);
    const comfy = await clickFull(`document.querySelector('[data-orb-nav-mode="comfy"]')`);
    check("切回 ComfyUI 画布(orb nav)", Boolean(comfy), String(comfy));
    await sleep(1500);
  } else {
    // 已直落画布态:漫影生图=local-models 分区的 generate 模式,开 orb 取证在场
    // (orb 开合态不确定:先查在场,不在则点一下再查——收敛式)
    const genNav = await waitFor(async () => {
      const present = await mainPage.ev(vis(`!!document.querySelector('[data-orb-nav-mode="generate"]')`));
      if (present) return true;
      await clickFull(`document.querySelector('[data-workflow-orb]')`);
      await sleep(900);
      return null;
    }, { timeout: 15_000, interval: 0, label: "orb generate 模式在场" }).catch(() => null);
    check("漫影生图入口在场(K2 三处展示之三,orb generate 模式)", Boolean(genNav), genNav ? "data-orb-nav-mode=generate 在" : "未检出");
    report.manyingFormSkipped = "当前直落画布态,表单文本未采(入口在场断言)";
    // 收起 orb(若仍开)
    const orbOpen = await mainPage.ev(vis(`!!document.querySelector('[data-orb-nav-mode="generate"]')`));
    if (orbOpen) await clickFull(`document.querySelector('[data-workflow-orb]')`);
    await sleep(600);
  }
  } // ← nav else 块收口(webviewAlready 时不走导航)

  log("③ 等 webview 挂载(引擎冷启>2min;状态机 need-start→starting→webview)");
  {
    const t0 = Date.now();
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
      if ((Date.now() - t0) % 30_000 < 3200) log("引擎状态:", state);
      await sleep(3000);
    }
    if (!(await mainPage.ev(vis(`!!document.querySelector('webview')`)))) {
      writeFileSync(join(E2E_DIR, "accept-report.json"), JSON.stringify({ ...report, fatal: "webview 未挂载(600s)", results }, null, 2));
      process.exit(1);
    }
  }
  check("ComfyUI 画布 webview 挂载(装机应用拉起引擎)", true);
  const engineUrl = await mainPage.ev(vis(`document.querySelector('webview')?.src || ''`));
  report.engineUrl = engineUrl;
  log("webview src:", String(engineUrl).slice(0, 60));
  await waitFor(
    () => wv(mainPage, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  check("ComfyUI 画布就绪(webview.app.isGraphReady)", true);
  const engineBase = new URL(String(engineUrl)).origin;

  log("④ 节点注册核(引擎 API):MyQi21DaojieBase / TextGenerate");
  for (const [node, need] of [["MyQi21DaojieBase", true], ["TextGenerate", true], ["ComfySwitchNode", true]]) {
    let ok = false, detail = "";
    try {
      const r = await fetch(`${engineBase}/object_info/${node}`);
      ok = r.status === 200;
      detail = `HTTP ${r.status}`;
    } catch (e) { detail = String(e.message); }
    check(`节点注册: /object_info/${node} 200`, ok, detail);
  }

  log("⑤ 漫影侧栏打开 + 目录树断言(Q2-1图像 段在)");
  let sidebarErrText = null;
  try {
    await waitFor(() => wv(mainPage, `(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
      if (!btn) return null;
      btn.click(); return 'clicked';
    })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮" });
    const hasTree = await waitFor(() => wv(mainPage, `document.body.innerText.includes('1_图片') && document.body.innerText.includes('Q2-1图像') ? 'yes' : null`),
      { timeout: 25_000, interval: 800, label: "目录树(1_图片/Q2-1图像)" }).catch(() => null);
    sidebarErrText = await wv(mainPage, `document.body.innerText.includes('取不到工作流') ? (document.body.innerText.match(/取不到工作流[^\\n]{0,60}/) || [''])[0] : null`);
    check("漫影侧栏=仓库目录树(1_图片/Q2-1图像 段在)", hasTree === "yes",
      hasTree === "yes" ? "树在" : `树未出现${sidebarErrText ? `;侧栏报错:${sidebarErrText}` : ""}`);
    report.sidebarTreeK2Q21 = hasTree;
    report.sidebarError = sidebarErrText;
  } catch (e) {
    check("漫影侧栏=仓库目录树(1_图片/Q2-1图像 段在)", false, `侧栏按钮不可达:${e.message}`);
  }

  // ── 阶段B:qi21-道劫-t2i 出图 ─────────────────────────────
  log("⑥ 真前端打开 qi21-道劫-t2i(漫影侧栏 repo: 叶子=真实用户路径;树不可用时回落 loadGraphData)");
  const t2iGraph = JSON.parse(readFileSync(wfT2I, "utf8"));
  const nodeCount = t2iGraph.nodes.length;
  const expandFolder = async (name) => {
    await waitFor(() => wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => r.querySelector('button') && r.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
      if (!row) return null; row.click(); return 'ok';
    })()`), { timeout: 15_000, interval: 1200, label: `展开目录 ${name}` });
    await sleep(800);
  };
  let leafClicked = null;
  try {
    for (const folder of ["1_图片", "Q2-1图像", "1_文生图"]) await expandFolder(folder);
    leafClicked = await wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_T2I_REL)}));
      if (!row) return null; row.click(); return 'ok';
    })()`);
  } catch (e) {
    log("侧栏路径不可达(预期=403 缺陷):", e.message);
  }
  check("侧栏叶子打开 qi21-道劫-t2i(真实用户路径)", leafClicked === "ok",
    leafClicked === "ok" ? "ok" : `侧栏树不可用${sidebarErrText ? `(报错:${sidebarErrText})` : ""};回落 loadGraphData 等效路(同一 graphToPrompt/queuePrompt 数据链,krea2 驱动先例)`);
  let canvasVia = "sidebar-leaf";
  if (leafClicked !== "ok") {
    canvasVia = "loadGraphData-fallback";
    const opened = await wv(mainPage, `(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(t2iGraph)}, true, true, 'qi21-道劫-t2i-装机验收');
      return 'opened';
    })()`);
    check("回落: loadGraphData 直载 t2i", opened === "opened", String(opened));
  }
  report.t2iOpenVia = canvasVia;
  await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(2000);

  log("⑦ 干跑:graphToPrompt 排队图取证(型BASE·seed·steps)");
  // 型选择=道具(1024²1MP;前两跑引擎在 4.2MP 人物型长采样窗口被外部 TERM,
  // 道具型同链路出图但采样 ~2-3min,压缩暴露窗口——如实记 choice)
  const SG_TYPE = t2iGraph.definitions.subgraphs[0].id;
  const setType = await wv(mainPage, `(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(SG_TYPE)});
    if (!n) return 'node-missing';
    const w = (n.widgets || []).find(w => String(w.name) === '型选择');
    if (!w) return 'widget-missing:' + (n.widgets || []).map(x => x.name).join(',');
    w.value = '道具';
    try { w.callback && w.callback(w.value); } catch (e) {}
    return 'set:' + String(w.value);
  })()`);
  check("[40] 型选择=道具(1024²;压缩外部干扰暴露窗口)", String(setType).startsWith("set:道具") || String(setType).endsWith("道具"), String(setType));
  await sleep(1200);
  const dryBase = await wv(mainPage, promptDigestCode("MyQi21DaojieBase", ["base"]));
  check("干跑排队图 MyQi21DaojieBase.base=道具", String(dryBase).includes('"base":"道具"'), String(dryBase).slice(0, 200));
  const dryLatent = await wv(mainPage, promptDigestCode("EmptyLatentImage", ["width", "height", "batch_size"]));
  check("干跑排队图 EmptyLatentImage=1024x1024(型联动)", String(dryLatent).includes('"width":1024') && String(dryLatent).includes('"height":1024'), String(dryLatent).slice(0, 200));
  const dryKS = await wv(mainPage, promptDigestCode("KSampler", ["seed", "steps"]));
  check("干跑排队图 KSampler 在(seed/steps 可读)", String(dryKS).startsWith("["), String(dryKS).slice(0, 200));
  report.t2iDry = { base: String(dryBase).slice(0, 200), latent: String(dryLatent).slice(0, 200), ksampler: String(dryKS).slice(0, 200) };

  log("⑧ queuePrompt → 等引擎 output 新 PNG(真前端序列化+排队)");
  const before = listOutput(OUT_PREFIX);
  const subjSig = "她立于山门石阶最上一级"; // 主体句指纹(默认=库人物例一)
  const queued = await wv(mainPage, queuePromptCode());
  check("queuePrompt 发出(真前端)", queued === "queued", String(queued));
  const t0 = Date.now();
  let imgName = null;
  let engineDiedAt = null;
  if (queued === "queued") {
    let engineFailStreak = 0;
    while (Date.now() - t0 < GEN_TIMEOUT_MS) {
      const now = listOutput(OUT_PREFIX);
      if (now.length > before.length) {
        imgName = now.map((f) => ({ f, t: statSync(join(ENGINE_OUTPUT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
        break;
      }
      // 引擎中途死亡快败(免烧满 25min):/system_stats 连续 6 次(~24s)不可达
      // 且无新图 → 判引擎已死,留诊断
      try {
        const r = await fetch(`${engineBase}/system_stats`, { signal: AbortSignal.timeout(3000) });
        engineFailStreak = r.ok ? 0 : engineFailStreak + 1;
      } catch { engineFailStreak += 1; }
      if (engineFailStreak >= 6) { engineDiedAt = new Date().toISOString(); break; }
      await sleep(4000);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (engineDiedAt) {
    check("引擎出图(output 新 PNG)", false, `引擎中途死亡(${engineDiedAt},/system_stats 连续不可达);排队后 ${secs}s 无产出`);
    report.cases.t2i = { fatal: "engine-died-mid-run", engineDiedAt, secs };
  } else if (!imgName) {
    check("引擎出图(output 新 PNG)", false, `超时 ${GEN_TIMEOUT_MS / 1000}s`);
  } else {
    const srcPath = join(ENGINE_OUTPUT, imgName);
    const bytes = statSync(srcPath).size;
    const destPath = join(E2E_DIR, "qi21-daojie-t2i-装机验收.png");
    copyFileSync(srcPath, destPath);
    const magic = pngMagic(destPath);
    const size = await sipsSize(destPath);
    const dw = Math.abs((size.w ?? 0) - 1024), dh = Math.abs((size.h ?? 0) - 1024);
    const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - 1) : 1;
    const sizeOk = dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO;
    check("出图落盘+cp 取证目录", existsSync(destPath) && magic && bytes > 50_000,
      `${imgName} → ${destPath} (${(bytes / 1024).toFixed(0)}KB, PNG 魔数=${magic})`);
    check("sips 尺寸对账(道具型声明 1024x1024 1:1;维差≤16px·比例≤1%)", sizeOk,
      size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
    check("耗时记录(排队→落盘)", true, `${secs}s`);
    report.cases.t2i = { imgName, srcPath, destPath, bytes, size, secs, queuedAt: new Date(t0).toISOString() };
  }

  // ── 阶段C:PE-I2I 加分项(qi21-edit [15] PE 开路排队取证) ──
  log("⑨ PE-I2I 加分项:qi21-edit 件 PE 开路(排队通过即证,照 ④ 省弹模式)");
  if (!imgName) {
    check("PE-I2I 加分项:edit 件 PE 开路排队取证", false, "跳过:主出图未成(引擎中途死亡),PE 段无引擎可用");
    report.cases.peI2i = { skipped: "engine-died-before-pe" };
  } else {
  const editGraph = JSON.parse(readFileSync(wfEdit, "utf8"));
  const editNodeCount = editGraph.nodes.length;
  // 侧栏换叶子(树不可用则回落 loadGraphData)
  let editLeaf = null;
  try {
    await expandFolder("2_图生图").catch(() => {});
    editLeaf = await wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_EDIT_REL)}));
      if (!row) return null; row.click(); return 'ok';
    })()`);
  } catch (e) {
    log("edit 侧栏路径不可达:", e.message);
  }
  if (editLeaf !== "ok") {
    const opened = await wv(mainPage, `(async () => {
      const app = window.app;
      app.loadGraphData(${JSON.stringify(editGraph)}, true, true, 'qi21-edit-装机验收PE');
      return 'opened';
    })()`);
    check("回落: loadGraphData 直载 edit", opened === "opened", String(opened));
  } else {
    check("侧栏叶子打开 qi21-edit(真实用户路径)", true, "ok");
  }
  await waitFor(() => wv(mainPage, `window.app.graph && window.app.graph._nodes.length === ${editNodeCount} ? ${editNodeCount} : null`),
    { timeout: 40_000, interval: 1000, label: `画布切换(${editNodeCount} 节点)` });
  await sleep(2000);

  // [15] ComfySwitchNode → true(PE-I2I 路选中)
  const swOn = await wv(mainPage, `(() => {
    const ns = window.app.graph._nodes.filter(n => n.type === 'ComfySwitchNode');
    if (!ns.length) return 'no-switch-nodes';
    const n = ns.find(n => n.id === 15) || ns[0];
    const w = (n.widgets || []).find(w => String(w.name).toLowerCase().includes('switch')) || (n.widgets || [])[0];
    if (!w) return 'no-widget';
    w.value = true;
    try { w.callback && w.callback(w.value); } catch (e) {}
    return 'set:id' + n.id + '=' + String(w.value);
  })()`);
  check("PE 开: edit [15] ComfySwitch=true", String(swOn).endsWith("=true"), String(swOn));
  await sleep(1000);
  const drySW = await wv(mainPage, promptDigestCode("ComfySwitchNode", ["switch"]));
  const swTrueInDry = String(drySW).includes('"switch":true');
  check("PE 开: 干跑排队图 ComfySwitchNode switch=true", swTrueInDry, String(drySW).slice(0, 300));

  // 排队 + /queue+/history 捕新 pid 排队图(服务端侧对拍)
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${engineBase}/history`)).json())); } catch { /* 尽力 */ }
  const queuedPE = await wv(mainPage, queuePromptCode());
  check("PE 开: queuePrompt 发出(真前端)", queuedPE === "queued", String(queuedPE));
  let pePid = null, peBlob = null;
  const peDeadline = Date.now() + 120_000;
  while (Date.now() < peDeadline && !peBlob) {
    try {
      const qs = await (await fetch(`${engineBase}/queue`)).json();
      for (const q of [...(qs.queue_running || []), ...(qs.queue_pending || [])]) {
        const pid = Array.isArray(q) ? q[1] : q?.promptId ?? q?.prompt_id;
        if (pid && !knownPids.has(pid)) {
          const blob = JSON.stringify(Array.isArray(q) ? q[2] : q?.prompt?.[2] || {});
          if (blob.includes("pe_i2i") || blob.includes("TextGenerate")) { pePid = pid; peBlob = blob; }
        }
      }
      if (!peBlob) {
        const h = await (await fetch(`${engineBase}/history`)).json();
        for (const [pid, e] of Object.entries(h)) {
          if (knownPids.has(pid)) continue;
          const blob = JSON.stringify(e.prompt?.[2] || {});
          if (blob.includes("pe_i2i") || blob.includes("TextGenerate")) { pePid = pid; peBlob = blob; break; }
        }
      }
    } catch { /* 尽力 */ }
    await sleep(1500);
  }
  const peEvidence = { queued: String(queuedPE), drySwitch: String(drySW).slice(0, 400) };
  if (peBlob) {
    const hasPEWeight = peBlob.includes("qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors");
    const hasTextGen = peBlob.includes('"class_type":"TextGenerate"');
    const hasSwTrue = /"switch"\s*:\s*true/.test(peBlob);
    check("PE 排队图: 服务端队列新 pid 含 pe_i2i 权重+TextGenerate+switch=true",
      hasPEWeight && hasTextGen && hasSwTrue,
      `pid=${String(pePid).slice(0, 8)};pe_i2i权重=${hasPEWeight};TextGenerate=${hasTextGen};switch=true=${hasSwTrue}`);
    peEvidence.pid = pePid; peEvidence.queueBlobHas = { peWeight: hasPEWeight, textGenerate: hasTextGen, switchTrue: hasSwTrue };
    peEvidence.queueBlobSnippet = peBlob.slice(0, 2000);
  } else {
    check("PE 排队图: 服务端队列新 pid 含 pe_i2i 权重+TextGenerate+switch=true", false, "120s 内未在 /queue+/history 捕到新 pid 排队图");
  }
  // 省弹:/interrupt 断开 + 复位
  try {
    const r = await fetch(`${engineBase}/interrupt`, { method: "POST" });
    peEvidence.interruptStatus = r.status;
    log("/interrupt →", r.status);
  } catch (e) { peEvidence.interruptError = String(e.message); }
  await sleep(3000);
  const swOff = await wv(mainPage, `(() => {
    const ns = window.app.graph._nodes.filter(n => n.type === 'ComfySwitchNode');
    const n = ns.find(n => n.id === 15) || ns[0];
    const w = (n.widgets || []).find(w => String(w.name).toLowerCase().includes('switch')) || (n.widgets || [])[0];
    if (!w) return 'no-widget';
    w.value = false;
    try { w.callback && w.callback(w.value); } catch (e) {}
    return 'set=' + String(w.value);
  })()`);
  check("PE 复位: [15] switch=false", String(swOff).endsWith("=false"), String(swOff));
  report.cases.peI2i = peEvidence;
  } // ← imgName 守卫收口

  // ── console 留存与汇总 ──
  report.consoleErrors = mainPage.consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "accept-report.json"), JSON.stringify(report, null, 2));
  mainPage.close();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 260)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 装机验收全部通过" : "❌ 装机验收存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "accept-report.json"), JSON.stringify({ fatal: String(e.message), results }, null, 2)); } catch { /* best effort */ }
  process.exit(1);
});
