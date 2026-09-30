#!/usr/bin/env node
/**
 * B6/B8 真浏览器实弹驱动器(09-30,Trellis 09-30-teman-absorb-closing 引擎实弹
 * 延期项——TE-MAN 排查 §三 5「引擎实弹验证延期至引擎空窗」的收口弹药):
 * 真浏览器(headless Chrome CDP)驱动 my_nodes/web 两画布扩展件,把 jsdom 探针
 * (b6_progress/b8_dblclick/b8_subgraph_probe_0930,0930 收官批复 32/48/27 断言
 * 全绿)的行为断言搬到真引擎事件流与真输入管线下:
 *
 *   组 b6(node-progress-highlight.js——画布并发运行高亮):
 *     临时测试图(b2 同款零模型链:LoadImage×2→MyImageABCompare,零碰生产件)
 *     连排 3 单 queuePrompt;每单断言:在跑窗口内节点描边样式函数返场
 *     ({color:#fbbf24,lineWidth:3}=THEME.pending+PROGRESS_HIGHLIGHT_TOKENS
 *     单源)→history success 后褪去(undefined)→三单毕终态全图无残留。
 *     采样机制=渲染帧级 wrap 哨兵:对每节点 strokeStyles.myProgress(件在
 *     nodeCreated/setup 挂的函数式槽,渲染循环逐键 call)包一层状态翻转记录
 *     器——事件到达→件自身 requestDraw→下一帧渲染 call→翻转入 window.__b6Log,
 *     零轮询竞态(单节点执行短于轮询周期也逃不掉);执行期间驱动器轮询 log
 *     尾态尽力抢拍截图(软证据,不设硬门)。
 *     并发多节点同亮面(事件合成态)已由 jsdom 探针场景 2 覆盖,引擎单执行流
 *     一时刻仅一节点 executing,真浏览器侧如实只断言单节点生命周期。
 *
 *   组 b8(dblclick-connect-nearest.js——双击自动连最近兼容口):
 *     临时测试图(LoadImage[IMAGE 输出]+VAEDecode[LATENT/VAE 输入,更近但
 *     类型不兼容]+MyImageABCompare[image_a/image_b 双 IMAGE 空闲输入,更远];
 *     全引擎核心节点零模型依赖);CDP Input.dispatchMouseEvent 真双击序列
 *     (clickCount 1→1→2→2,Chrome 第二对 up 后派发 DOM dblclick——件监听位):
 *       ① 双击 LoadImage IMAGE 输出口(getOutputPos(0) 真值经 __vp 换算视口)
 *          →连到最远兼容的 AB.image_a(前置几何断言:更近的 VAEDecode.latents
 *          距离更短=类型过滤真受测),graph.links 末条 origin/target 逐字段核对,
 *          VAEDecode 两输入零占用;
 *       ② 再双击同输出口→image_a 已占被跳,连次近空闲 AB.image_b(空闲过滤);
 *       ③ 双击空白→links 计数不变(零扰原生)。
 *     子图域行为(canvas.graph 扫描面)由常驻 jsdom 探针 b8_subgraph_probe
 *     覆盖;真浏览器子图态不在本驱动范围(如实注记,非缩水断言)。
 *
 * 骨架照 b2_browser_evidence_0930.mjs(4817211 退出码收口版):探活+A0 环境段
 * 失败=退出码 2;page 模块级+finally 恒 writeReport/cleanup(异常崩溃不丢已取得
 * 证据、不泄漏 detached Chrome);killChrome 兜底自启自弑。
 * 用法:node apps/build/scripts/b6b8_browser_live_0930.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9374)/
 *   GROUPS(逗号分隔组名 b6,b8;默认全跑)。全组=合并账 b6b8-live-report.json;
 *   部分组=partial- 前缀独立账(永不覆写全组存档,同 b2 D-3 路由闸)。
 * 退出码 0=全绿;1=有失败项或驱动异常(已取得证据随 finally 落盘);2=环境错误
 *   (开场 /system_stats 探活+A0 环境段);130=SIGINT(同钩落盘+清理)。
 * 引擎生命周期在驱动外(引擎操作员);本驱动零改引擎家、零写引擎 userdata。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9374);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/b6b8-browser-live-0930`;
const GROUPS = new Set((process.env.GROUPS || "b6,b8").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const FULL_MODE = GROUPS.size === 2 && GROUPS.has("b6") && GROUPS.has("b8");
const SHOT_PREFIX = FULL_MODE ? "" : "partial-";
// B6 描边样式单源期望值(node-progress-highlight.js 消费 theme.js:
// THEME.pending="#fbbf24" + PROGRESS_HIGHLIGHT_TOKENS.lineWidth=3)
const EXPECT_COLOR = "#fbbf24";
const EXPECT_LINE_WIDTH = 3;

class EnvError extends Error {}
let page = null;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/b6b8-chrome-profile";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 500)}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1500,980", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter", "--disable-background-timer-throttling",
    ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
  log("chrome spawned pid", chromeProc.pid);
}
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch { /* gone */ } }
  log("chrome killed (self-spawned)");
}

async function getPageClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch { /* port not ready */ }
    await sleep(1200);
  }
  if (!page) throw new Error("引擎前端 page target 未出现(90s)");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 600);
      return r.result.value;
    },
    async mouse(type, x, y, extra = {}) {
      return send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, ...extra });
    },
    async hover(x, y) { await this.mouse("mouseMoved", x, y); await sleep(60); },
    /** 真双击序列:click(1)→click(2)——Chrome 在第二对 mouseReleased(clickCount:2)
     * 后派发 DOM dblclick;间隔 80ms < 系统双击时限。litegraph 自身 Pointer 时间戳
     * 双击判定(isDouble)同吃这两次,b8 件是 DOM dblclick 纯观察者,两判定位互不干扰。 */
    async dblclick(x, y) {
      await this.mouse("mousePressed", x, y, { clickCount: 1 });
      await sleep(80);
      await this.mouse("mouseReleased", x, y, { clickCount: 1 });
      await sleep(80);
      await this.mouse("mousePressed", x, y, { clickCount: 2 });
      await sleep(80);
      await this.mouse("mouseReleased", x, y, { clickCount: 2 });
      await sleep(350);
    },
    async screenshot(name) {
      const path = join(OUT_DIR, `${SHOT_PREFIX}${name}.png`);
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return path; }
      } catch { /* fallthrough */ }
      log(`📸 失败 ${path}`); return null;
    },
  };
}

async function waitFor(fn, { timeout = 60_000, interval = 1000, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

/** litegraph 画布配景(b2 S6 配方):固定 ds.scale/offset;装 __vp 换算器
 *  (litegraph 自家 convertOffsetToCanvas,与引擎内部逆换算同源) */
async function frameCanvas(page, focusPt, scale = 0.8) {
  const rc = await page.ev(`(() => {
    const canvas = window.app.canvas;
    const rect = canvas.canvas.getBoundingClientRect();
    canvas.ds.scale = ${scale};
    canvas.ds.offset = [rect.width / 2 / ${scale} - ${focusPt[0]}, rect.height / 2 / ${scale} - ${focusPt[1]}];
    canvas.setDirty(true, true);
    window.__vp = (gx, gy) => {
      const c = window.app.canvas;
      const r = c.canvas.getBoundingClientRect();
      const p = c.ds.convertOffsetToCanvas([gx, gy]);
      return { x: r.left + p[0], y: r.top + p[1] };
    };
    return 'framed';
  })()`);
  for (let i = 0; i < 12; i++) {
    const a = await page.ev(vis(`JSON.stringify([window.app.canvas.ds.scale, window.app.canvas.ds.offset])`));
    await sleep(350);
    const b = await page.ev(vis(`JSON.stringify([window.app.canvas.ds.scale, window.app.canvas.ds.offset])`));
    if (String(a) === String(b)) break;
  }
  await sleep(250);
  return rc;
}
async function vp(page, g) {
  return JSON.parse(String(await page.ev(`JSON.stringify(window.__vp(${g[0]}, ${g[1]}))`)));
}

async function loadWf(page, wf, label, nodeCount) {
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wf)}, true, true, ${JSON.stringify(label)});
    return 'opened';
  })()`);
  check(`B0 工作流载入(${label})`, opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ok' : null`)),
    { timeout: 30_000, interval: 800, label: `${label} 画布切换` });
  await sleep(1200);
}

async function waitHistoryOnce(knownPids, sig, timeout = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        if (!sig(JSON.stringify(e.prompt?.[2] || {}))) continue;
        return { pid, status: e.status?.status_str || "" };
      }
    } catch { /* retry */ }
    await sleep(1500);
  }
  return { error: "history 超时" };
}
const historyPids = async () => { try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { return new Set(); } };

const report = { mode: "b6b8-browser-live", engine: ENGINE, startedAt: new Date().toISOString(), groups: {}, interactions: {} };

/** B6 图:b2 组①同款零模型链(LoadImage×2→MyImageABCompare)——0930 b2 实证
 *  queuePrompt→success 全通;B6 事件面(executing/progress/executed/status)在
 *  此链上完整走一遍,且 MyImageABCompare 自身 onExecuted 与 B6 executed 清扫互不干扰。 */
function buildB6Wf() {
  return {
    nodes: [
      { id: 1, type: "LoadImage", pos: [-620, 80], size: [270, 314], flags: {}, order: 0, mode: 0, inputs: [], outputs: [{ name: "IMAGE", type: "IMAGE", links: [1], slot_index: 0 }], properties: { "Node name for S&R": "LoadImage" }, widgets_values: ["b2_img_a.png", "image"] },
      { id: 2, type: "LoadImage", pos: [-620, 440], size: [270, 314], flags: {}, order: 1, mode: 0, inputs: [], outputs: [{ name: "IMAGE", type: "IMAGE", links: [2], slot_index: 0 }], properties: { "Node name for S&R": "LoadImage" }, widgets_values: ["b2_img_b.png", "image"] },
      { id: 3, type: "MyImageABCompare", pos: [-300, 80], size: [430, 372], flags: {}, order: 2, mode: 0, inputs: [{ name: "image_a", type: "IMAGE", link: 1 }, { name: "image_b", type: "IMAGE", link: 2 }], outputs: [{ name: "image_a", type: "IMAGE", links: null }, { name: "image_b", type: "IMAGE", links: null }], properties: {}, widgets_values: ["旧版", "新版"] },
    ],
    links: [[1, 1, 0, 3, 0, "IMAGE"], [2, 2, 0, 3, 1, "IMAGE"]],
    groups: [], config: {}, extra: {}, version: 0.4,
  };
}

/** B8 图:LoadImage[IMAGE 输出]+VAEDecode[LATENT/VAE 输入·更近·类型不兼容]+
 *  MyImageABCompare[image_a/image_b IMAGE 空闲·更远]。VAEDecode 摆近=类型过滤
 *  真受测(几何前提在组内先断言);AB 双输入=第二次双击验空闲过滤(image_a 已占
 *  →连 image_b)。零模型依赖(connect 纯画布操作,图不执行)。 */
function buildB8Wf() {
  return {
    nodes: [
      { id: 1, type: "LoadImage", pos: [-700, 300], size: [270, 314], flags: {}, order: 0, mode: 0, inputs: [], outputs: [{ name: "IMAGE", type: "IMAGE", links: null, slot_index: 0 }], properties: { "Node name for S&R": "LoadImage" }, widgets_values: ["b2_img_a.png", "image"] },
      { id: 2, type: "VAEDecode", pos: [-150, 40], size: [220, 60], flags: {}, order: 1, mode: 0, inputs: [{ name: "samples", type: "LATENT", link: null }, { name: "vae", type: "VAE", link: null }], outputs: [{ name: "IMAGE", type: "IMAGE", links: null, slot_index: 0 }], properties: { "Node name for S&R": "VAEDecode" }, widgets_values: [] },
      { id: 3, type: "MyImageABCompare", pos: [-150, 420], size: [430, 372], flags: {}, order: 2, mode: 0, inputs: [{ name: "image_a", type: "IMAGE", link: null }, { name: "image_b", type: "IMAGE", link: null }], outputs: [{ name: "image_a", type: "IMAGE", links: null }, { name: "image_b", type: "IMAGE", links: null }], properties: {}, widgets_values: ["旧版", "新版"] },
    ],
    links: [],
    groups: [], config: {}, extra: {}, version: 0.4,
  };
}

// ══════════════════ 组 b6:并发运行高亮(node-progress-highlight.js) ══════════════════
async function groupB6(page) {
  const g = { checks: [], shots: [], runs: [] };
  await loadWf(page, buildB6Wf(), "b6b8-progress", 3);

  // 装帧配景:全图节点入视口(B6 描边渲染=渲染循环逐键 call strokeStyles,
  // 视口外节点不重绘则哨兵无采样——配景保证帧级采样覆盖)
  await frameCanvas(page, [-350, 300], 0.62);

  // 装帧后 wrap 哨兵:对全图节点 strokeStyles.myProgress 包状态翻转记录器。
  // 前置=引擎真节点确有该函数式槽(件经 nodeCreated/setup 挂;若引擎前端
  // litegraph 无此机制或件未装载,前置即红,如实报)
  const hookRc = await page.ev(`(() => {
    window.__b6Log = [];
    window.__b6Lit = () => window.app.graph._nodes.map((n) => ({ id: String(n.id), lit: (typeof n.strokeStyles?.myProgress === 'function') ? (r => r ? { color: r.color, lineWidth: r.lineWidth } : null)(n.strokeStyles.myProgress.call(n)) : 'no-fn' }));
    let wrapped = 0;
    for (const n of window.app.graph._nodes) {
      const f = n?.strokeStyles?.myProgress;
      if (typeof f !== 'function' || f.__b6wrapped) continue;
      let last = undefined;
      const w = function (...a) {
        const r = f.apply(this, a);
        const key = r ? (r.color + ':' + r.lineWidth) : null;
        if (key !== last) { last = key; window.__b6Log.push({ t: Date.now(), node: String(this && this.id), lit: r ? { color: r.color, lineWidth: r.lineWidth } : null }); }
        return r;
      };
      w.__b6wrapped = true;
      n.strokeStyles.myProgress = w;
      wrapped++;
    }
    return JSON.stringify({ wrapped, nodes: window.app.graph._nodes.length, logLen: window.__b6Log.length });
  })()`);
  const hook = JSON.parse(String(hookRc));
  check("b6 前置:全图节点 strokeStyles.myProgress 函数式槽在场(件已装载)", hook.wrapped === 3 && hook.nodes === 3,
    `wrapped=${hook.wrapped}/nodes=${hook.nodes}(myProgress 缺席=件未装载或引擎 litegraph 无描边槽机制)`);
  g.checks.push({ name: "myprogress-slot-present", pass: hook.wrapped === 3, ...hook });

  const readLog = async () => JSON.parse(String(await page.ev(`JSON.stringify(window.__b6Log)`)));
  const clearLog = () => page.ev(`(() => { window.__b6Log = []; return 'cleared'; })()`);

  // 连排 3 单:每单 queuePrompt→在跑窗口哨兵记录描边在场→history success→褪去。
  // 单节点执行可能亚秒级——帧级 wrap 哨兵零竞态(事件→setDirty→下一帧 call 链路
  // 由件自身触发,不依赖驱动器轮询命中);驱动器轮询仅用于抢拍截图(软证据)。
  for (let run = 1; run <= 3; run++) {
    await clearLog();
    const known = await historyPids();
    await sleep(400);
    const queued = await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && e.message); } })()`);
    check(`b6-${run} queuePrompt 提交`, queued === "queued", String(queued));

    // 在跑窗口轮询 wrap log(抢拍截图;在场判定以 log 终读为准,轮询未命中不算失败)
    let shotTaken = false;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 30_000) {
      const entries = await readLog();
      if (entries.some((e) => e.lit)) {
        if (!shotTaken) { shotTaken = true; g.shots.push(await page.screenshot(`g-b6-running-${run}`)); }
        break;
      }
      const done = await (async () => { try { const h = await (await fetch(`${ENGINE}/history`)).json(); return Object.keys(h).some((pid) => !known.has(pid)); } catch { return false; } })();
      if (done) break;
      await sleep(200);
    }

    const hist = await waitHistoryOnce(known, (b) => b.includes("MyImageABCompare"));
    check(`b6-${run} 引擎执行完成`, hist.status === "success", `status=${hist.status} pid=${String(hist.pid).slice(0, 8)}`);

    // 褪去:executed/status 双清扫路终态——success 后 1.2s 两次读 log 尾态稳定且全 null
    await sleep(700);
    const logA = await readLog();
    await sleep(500);
    const logB = await readLog();
    const litEntries = logB.filter((e) => e.lit);
    const appeared = litEntries.length > 0;
    const styleOk = litEntries.every((e) => e.lit.color === EXPECT_COLOR && e.lit.lineWidth === EXPECT_LINE_WIDTH);
    const faded = logB.length === 0 ? logA.length === 0 : logB[logB.length - 1].lit === null;
    const litNodes = [...new Set(litEntries.map((e) => e.node))];
    check(`b6-${run} 在跑窗口描边在场(wrap 帧级哨兵:事件→setDirty→渲染 call 翻转入账)`, appeared,
      `翻转记录=${JSON.stringify(logB)} 亮过节点=${litNodes.join(",")}`);
    check(`b6-${run} 描边样式单源(THEME.pending ${EXPECT_COLOR} + token lineWidth ${EXPECT_LINE_WIDTH})`, appeared && styleOk,
      `实测=${JSON.stringify([...new Set(litEntries.map((e) => e.lit))])}`);
    check(`b6-${run} 完成即褪(终态尾记录 lit=null;executed 双键清+status 队列清零兜底)`, faded,
      `logA=${JSON.stringify(logA)} logB=${JSON.stringify(logB)}`);
    g.runs.push({ run, history: hist, log: logB, litNodes, shot: shotTaken });
    g.checks.push({ name: `run-${run}-appear`, pass: appeared }, { name: `run-${run}-style`, pass: appeared && styleOk }, { name: `run-${run}-fade`, pass: faded });
    await sleep(600);
  }

  // 终态:全图 live 直读无残留(哨兵漏网防御:直调每节点 myProgress)
  const finalLit = JSON.parse(String(await page.ev(`JSON.stringify(window.__b6Lit())`)));
  const residual = finalLit.filter((x) => x.lit !== null && x.lit !== "no-fn");
  check("b6 三单毕终态全图无残留(队列清零后 live 直读)", residual.length === 0, JSON.stringify(finalLit));
  g.checks.push({ name: "final-no-residual", pass: residual.length === 0, finalLit });
  g.shots.push(await page.screenshot("g-b6-final"));
  report.groups.b6 = g;
  return g;
}

// ══════════════════ 组 b8:双击自动连最近兼容口(dblclick-connect-nearest.js) ══════════════════
async function groupB8(page) {
  const g = { checks: [], shots: [] };
  await loadWf(page, buildB8Wf(), "b6b8-dblclick", 3);
  await frameCanvas(page, [-250, 350], 0.55);

  // 槽位几何真值:输出/输入 pos 皆 litegraph getOutputPos/getInputPos(件同源);
  // 前置断言①件的 dblclick 监听在 canvas 元素(装载体证据)②几何前提=更近的
  // VAEDecode.samples 距 LoadImage.IMAGE 输出 < AB.image_a 距离(类型过滤真受测)
  const geoRc = await page.ev(`(() => {
    const nodes = window.app.graph._nodes;
    const src = nodes.find((n) => n.id === 1);
    const vae = nodes.find((n) => n.id === 2);
    const ab = nodes.find((n) => n.id === 3);
    const out = src.getOutputPos(0);
    const dist = (p) => Math.hypot(p[0] - out[0], p[1] - out[1]);
    return JSON.stringify({
      out: [out[0], out[1]],
      dVae: dist(vae.getInputPos(0)),
      dAba: dist(ab.getInputPos(0)),
      dAbb: dist(ab.getInputPos(1)),
      links0: (window.app.graph.links || []).length,
      getEvents: typeof window.app.canvas.canvas.dispatchEvent === 'function' ? 'dom-ok' : 'no-dom',
    });
  })()`);
  const geo = JSON.parse(String(geoRc));
  check("b8 前置:几何受测性(更近的 VAEDecode.samples[LATENT] 比 AB.image_a[IMAGE] 近)", geo.dVae < geo.dAba,
    `out=(${geo.out.map((v) => v.toFixed(0)).join(",")}) d(VAEDecode.samples)=${geo.dVae.toFixed(0)} < d(AB.image_a)=${geo.dAba.toFixed(0)}(若反向则类型过滤未被真测,布局失效)`);
  check("b8 前置:初始零连线", geo.links0 === 0, `links=${geo.links0}`);
  g.geo = geo;
  g.checks.push({ name: "geometry-type-filter-tested", pass: geo.dVae < geo.dAba, dVae: geo.dVae, dAba: geo.dAba });

  // ① 双击 LoadImage IMAGE 输出口 → 连 AB.image_a(类型过滤跳过更近的 LATENT 口)
  const srcOutVp = await vp(page, geo.out);
  await page.hover(srcOutVp.x, srcOutVp.y);
  await page.dblclick(srcOutVp.x, srcOutVp.y);
  const st1 = JSON.parse(String(await page.ev(`(() => {
    const nodes = window.app.graph._nodes;
    const links = window.app.graph.links || [];
    const ab = nodes.find((n) => n.id === 3); const vae = nodes.find((n) => n.id === 2);
    return JSON.stringify({ links: links.map((l) => ({ id: l.id, type: l.type, origin_id: l.origin_id, origin_slot: l.origin_slot, target_id: l.target_id, target_slot: l.target_slot })), abIn: ab.inputs.map((i) => i.link), vaeIn: vae.inputs.map((i) => i.link) });
  })()`)));
  const link1 = st1.links.at(-1);
  const connect1 = st1.abIn[0] != null && link1 && link1.origin_id === 1 && link1.origin_slot === 0 && link1.target_id === 3 && link1.target_slot === 0;
  check("b8-① 双击输出点(CDP 真双击)→连最近兼容输入 AB.image_a", connect1,
    `links=${JSON.stringify(st1.links)} AB.inputs.link=${JSON.stringify(st1.abIn)}`);
  check("b8-① 类型过滤:更近的 VAEDecode(LATENT/VAE 输入)零占用", st1.vaeIn.every((l) => l == null), JSON.stringify(st1.vaeIn));
  g.checks.push({ name: "connect-nearest-compatible", pass: connect1 }, { name: "type-filter-vae-untouched", pass: st1.vaeIn.every((l) => l == null) });
  g.shots.push(await page.screenshot("g-b8-connected-1"));

  // ② 再双击同输出口 → image_a 已占被跳,连次近空闲 AB.image_b(空闲过滤)
  await page.hover(srcOutVp.x, srcOutVp.y);
  await page.dblclick(srcOutVp.x, srcOutVp.y);
  const st2 = JSON.parse(String(await page.ev(`(() => {
    const nodes = window.app.graph._nodes;
    const links = window.app.graph.links || [];
    const ab = nodes.find((n) => n.id === 3); const vae = nodes.find((n) => n.id === 2);
    return JSON.stringify({ links: links.map((l) => ({ id: l.id, origin_id: l.origin_id, origin_slot: l.origin_slot, target_id: l.target_id, target_slot: l.target_slot })), abIn: ab.inputs.map((i) => i.link), vaeIn: vae.inputs.map((i) => i.link) });
  })()`)));
  const link2 = st2.links.at(-1);
  const connect2 = st2.links.length === 2 && st2.abIn[0] != null && st2.abIn[1] != null
    && link2 && link2.origin_id === 1 && link2.target_id === 3 && link2.target_slot === 1;
  check("b8-② 再双击同输出口→已占槽被跳,连次近空闲 AB.image_b(空闲过滤:input.link≠null 槽永不被动)", connect2,
    `links=${JSON.stringify(st2.links)} AB.inputs.link=${JSON.stringify(st2.abIn)}`);
  check("b8-② 已占槽零替换(第一条 link 原样保留)", st2.links.length >= 1 && st2.links[0].target_slot === 0 && st2.abIn[0] === st1.abIn[0], JSON.stringify(st2.links.map((l) => l.target_slot)));
  g.checks.push({ name: "free-slot-filter", pass: connect2 }, { name: "occupied-slot-untouched", pass: st2.links.length >= 1 && st2.links[0].target_slot === 0 });

  // ③ 双击空白 → links 计数不变(零扰原生:不劫持不截停)
  const blankVp = await vp(page, [-1000, 1200]);
  await page.dblclick(blankVp.x, blankVp.y);
  const linksAfterBlank = JSON.parse(String(await page.ev(`JSON.stringify((window.app.graph.links || []).length)`)));
  check("b8-③ 双击空白零动作(links 计数不变)", linksAfterBlank === st2.links.length, `links=${linksAfterBlank}(双击前=${st2.links.length})`);
  g.checks.push({ name: "blank-zero-action", pass: linksAfterBlank === st2.links.length });
  g.shots.push(await page.screenshot("g-b8-final"));
  report.groups.b8 = g;
  report.interactions.b8 = { srcOutVp, blankVp };
  return g;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // A0 环境段(失败=退出码 2):被测两件依赖的节点类注册+测试资产在场+前端就绪
  try {
    for (const cls of ["MyImageABCompare", "LoadImage", "VAEDecode"]) {
      const r = await fetch(`${ENGINE}/object_info/${encodeURIComponent(cls)}`);
      check(`A0 节点注册: ${cls}`, r.status === 200, `HTTP ${r.status}`);
    }
    const li = await (await fetch(`${ENGINE}/object_info/LoadImage`)).json();
    const imgs = li.LoadImage.input.required.image[0] || [];
    check("A0 测试资产在 LoadImage combo(b2_img_a/b.png,b2 役上传件)", imgs.includes("b2_img_a.png") && imgs.includes("b2_img_b.png"), imgs.filter((f) => f.startsWith("b2_")).join(","));
    // 被测件装载探针:页面侧扩展注册名在场(两件皆 app.registerExtension 常驻)
    launchChrome();
    page = await getPageClient();
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
    const exts = await page.ev(vis(`JSON.stringify((window.app?.extensions || []).map((e) => e.name))`));
    const extList = typeof exts === "string" ? exts : JSON.stringify(exts);
    check("A0 被测件装载:my.progress.highlight 在扩展注册表", extList.includes("my.progress.highlight"), extList.slice(0, 400));
    check("A0 被测件装载:my.dblclick.connect.nearest 在扩展注册表", extList.includes("my.dblclick.connect.nearest"), extList.slice(0, 400));
  } catch (e) {
    throw new EnvError(`A0 环境段失败: ${e && e.message}`);
  }
  check("A0 引擎前端就绪", true);
  await sleep(2000);

  if (GROUPS.has("b6")) await groupB6(page);
  if (GROUPS.has("b8")) await groupB8(page);
}

function writeReport() {
  report.results = results;
  report.groupsMode = [...GROUPS].join(",");
  report.finishedAt = new Date().toISOString();
  const name = FULL_MODE ? "b6b8-live-report.json" : `b6b8-live-g${[...GROUPS].sort().join("")}-report.json`;
  writeFileSync(join(OUT_DIR, name), JSON.stringify(report, null, 2));
}

function cleanup() {
  try { page?.close(); } catch { /* gone */ }
  killChrome();
}

// 退出码语义(照 b2 4817211 收口版):0=全绿;1=有失败项或驱动异常(已取得证据
// 随 finally 落盘);2=环境错误;130=SIGINT(同钩清理)。
process.on("SIGINT", () => {
  log("SIGINT:落盘已取得证据并清理后退出");
  try { writeReport(); } catch { /* 尽力 */ }
  cleanup();
  process.exit(130);
});

try {
  const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", alive.system?.comfyui_version);
} catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

let exitCode = 0;
try {
  await main();
  if (!results.every((r) => r.pass)) exitCode = 1;
} catch (e) {
  exitCode = e instanceof EnvError ? 2 : 1;
  console.error(e instanceof EnvError ? "环境错误(退出码 2):" : "驱动异常(退出码 1,已取得证据随 finally 落盘):", e && e.message);
} finally {
  try { writeReport(); } catch (e) { console.error("报告落盘失败:", e && e.message); }
  cleanup();
}
log(`════ B6/B8 实弹汇总(组模式=${[...GROUPS].join(",")})════`);
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(exitCode);
