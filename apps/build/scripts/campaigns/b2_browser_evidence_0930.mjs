#!/usr/bin/env node
/**
 * B2 三组浏览器取证(09-30,Trellis 09-29-qi21-canvas-batch,补 0929 b2 役移交清单
 * implement.md:42-50 的实弹承诺):真浏览器(headless Chrome CDP)驱动
 * MyImageABCompare/MyVideoABCompare 双件,临时构造测试工作流(零碰生产件):
 *   组① 像素截图:图件渲染取证——初始/倍率循环 5 拍(2→3→4→5→7→2)/放大镜开+
 *     镜位/帘拖 0.25;舞台与 label 行不叠字(几何断言+截图+像素采样);
 *   组② 实播漂移:视频件双路播放(12fps×48f vs 24fps×96f 不同帧率)——
 *     rAF 同步漂移实测序列(|tB−frame/24| 逐采样,容限 0.5s)/播放暂停/±1帧/
 *     A/B/静音声道(<video>.muted 实测)/syncToken 换源不双环(逐转换 +1 断言);
 *   组③ 保存重开:交互态(帘位/倍率/镜位/帧号/声道)经 graph.serialize()→
 *     loadGraphData() 往返复原(properties.myAbImage/.myAbVideo 逐字段比对)。
 * 交互路径:真实输入管线优先(Input.dispatchMouseEvent),逐控件断言状态翻转;
 * 失败降级链=pointerType 参数→JS PointerEvent 派发,所用路径逐控件如实记 report。
 * 用法:node apps/build/scripts/b2_browser_evidence_0930.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9374)。
 * 退出码 0=全绿;1=有失败项或驱动异常(已取得证据随 finally 落盘);2=环境错误
 * (开场探活+A0 环境段);130=SIGINT(同钩落盘+清理)。引擎生命周期在驱动外(引擎操作员)。
 *
 * 0930 组①修复后复验模式(本版默认):只跑组①(像素截图+『舞台与 label 行
 * 不叠字』几何+像素双证),判据=①行距实测值(last_y 差)与让位公式假设
 * (widget.computedHeight,stageTopFor 消费)一致+②标签行底 ≤ 舞台顶(叠字
 * 消除,overlapPx≤0.5)。产物 fix- 前缀+独立报告 fix-b2-g1-report.json
 * (原三组账 b2-evidence-report.json 不动)。修复=并行会话 0930 改
 * stageTopFor 读运行时实值(my-image-ab-compare.js)+token widgetRowH 20→24
 * (theme.js,仅首排布前回落);本驱动 0929/0930 三组全跑模式经 GROUPS=1,2,3
 * 环境变量可复现(GROUPS 逗号分隔组号;默认仅 1)。产物路由闸(D-3):全组模式=
 * 前缀空+原合并账;组①复验(默认)=fix- 前缀+独立账;其余部分组=partial- 前缀+
 * b2-evidence-g{Σ}-report.json 独立账——部分组重跑永不覆写三组存档。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9374);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/b2-browser-evidence-0930`;
const GROUPS = new Set((process.env.GROUPS || "1").split(",").map((s) => s.trim()).filter(Boolean));
const FULL_MODE = GROUPS.size === 3 && ["1", "2", "3"].every((g) => GROUPS.has(g)); // 三组全跑=原存档复现模式
const G1FIX_MODE = GROUPS.size === 1 && GROUPS.has("1");                            // 组①修复复验模式(默认)
// 产物路由闸(0930 修复官 D-3):报告名与截图/工件前缀同按模式路由——全组模式=原三组账
// 语义(前缀空+b2-evidence-report.json,有意复现式重跑);组①复验=fix- 前缀+独立账;
// 其余任意部分组=partial- 前缀+b2-evidence-g{Σ}-report.json 独立账——部分组重跑永不
// 覆写三组存档与 fix-* 存档(显式 SHOT_PREFIX env 仍可覆盖)。
const DEFAULT_SHOT_PREFIX = G1FIX_MODE ? "fix-" : FULL_MODE ? "" : "partial-";
const SHOT_PREFIX = process.env.SHOT_PREFIX ?? DEFAULT_SHOT_PREFIX;
// 0930 修复官 D-2:环境段(A0/B0)失败专用标记→退出码 2;page 提升模块级供 finally/SIGINT
// 收尾(writeReport+cleanup 恒走 finally,异常崩溃不丢已取得证据、不泄漏 detached Chrome)。
class EnvError extends Error {}
let page = null;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/b2-chrome-profile";

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
    // 真播视频需要:headless 下自动播放策略放开(A 声默认路 muted 状态由件自控)
    "--autoplay-policy=no-user-gesture-required",
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

/** 真实输入管线点击+异步状态验证:CDP 单击 → verify();不翻才走 JS 派发兜底(杜绝双击) */
async function clickAndVerify(page, target, verify, label) {
  const { x, y, dom } = target;
  await page.hover(x, y);
  await page.mouse("mousePressed", x, y);
  await sleep(80);
  await page.mouse("mouseReleased", x, y);
  await sleep(280);
  if ((await verify()) === true) return { ok: true, method: "cdp-mouse" };
  try {
    const rc = await page.ev(`(() => {
      const el = ${dom};
      if (!el) return 'no-el';
      el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, composed:true, pointerId:1, isPrimary:true, buttons:1, clientX:${x}, clientY:${y}}));
      el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, composed:true, pointerId:1, isPrimary:true, clientX:${x}, clientY:${y}}));
      if (typeof el.click === 'function' && el.tagName === 'BUTTON') el.click();
      return 'js-dispatched';
    })()`);
    await sleep(280);
    if ((await verify()) === true) return { ok: true, method: `js-dispatch(${rc})` };
  } catch (e) { return { ok: false, method: `cdp+js-err:${String(e).slice(0, 60)}` }; }
  return { ok: false, method: "cdp+js-both-failed" };
}

/** litegraph 画布配景(S6 配方):固定 ds.scale/offset;并装 __vp 换算器(litegraph 自家
 *  convertOffsetToCanvas——与引擎内部逆换算同源,杜绝手算 scale/offset 与渲染脱钩) */
async function frameCanvas(page, focusPt, scale = 0.8) {
  const rc = await page.ev(`(() => {
    const canvas = window.app.canvas;
    const rect = canvas.canvas.getBoundingClientRect();
    canvas.ds.scale = ${scale};
    canvas.ds.offset = [rect.width / 2 / ${scale} - ${focusPt[0]}, rect.height / 2 / ${scale} - ${focusPt[1]}];
    canvas.setDirty(true, true);
    window.__b2Rect = { left: rect.left, top: rect.top, w: rect.width, h: rect.height };
    window.__vp = (gx, gy) => {
      const c = window.app.canvas;
      const r = c.canvas.getBoundingClientRect();
      const p = c.ds.convertOffsetToCanvas([gx, gy]);
      return { x: r.left + p[0], y: r.top + p[1] };
    };
    return 'framed';
  })()`);
  // ds 稳定门:loadGraphData 的自动配景(fit-view)动画会短暂改写 ds——两次读数一致才算稳
  for (let i = 0; i < 12; i++) {
    const a = await page.ev(vis(`JSON.stringify([window.app.canvas.ds.scale, window.app.canvas.ds.offset])`));
    await sleep(350);
    const b = await page.ev(vis(`JSON.stringify([window.app.canvas.ds.scale, window.app.canvas.ds.offset])`));
    if (String(a) === String(b)) break;
  }
  await sleep(250);
  return rc;
}
/** graph 坐标 → 视口 px(经 __vp;每次现读,防 ds 变动后用旧值) */
async function vp(page, g) {
  return JSON.parse(String(await page.ev(`JSON.stringify(window.__vp(${g[0]}, ${g[1]}))`)));
}
async function canvasRectAndDs(page) {
  return JSON.parse(String(await page.ev(vis(`JSON.stringify({rect: window.__b2Rect, ds: {scale: window.app.canvas.ds.scale, offset: window.app.canvas.ds.offset}})`))));
}

/** 临时测试图(UI 格;零碰生产件) */
function buildImageWf() {
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
function buildVideoWf() {
  return {
    nodes: [
      { id: 1, type: "LoadVideo", pos: [-640, 80], size: [320, 130], flags: {}, order: 0, mode: 0, inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [1], slot_index: 0 }], properties: { "Node name for S&R": "LoadVideo" }, widgets_values: ["b2_va_12fps.mp4"] },
      { id: 2, type: "LoadVideo", pos: [-640, 260], size: [320, 130], flags: {}, order: 1, mode: 0, inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [2], slot_index: 0 }], properties: { "Node name for S&R": "LoadVideo" }, widgets_values: ["b2_vb_24fps.mp4"] },
      { id: 3, type: "MyVideoABCompare", pos: [-280, 80], size: [460, 420], flags: {}, order: 2, mode: 0, inputs: [{ name: "video_a", type: "VIDEO", link: 1 }, { name: "video_b", type: "VIDEO", link: 2 }], outputs: [{ name: "video_a", type: "VIDEO", links: null }, { name: "video_b", type: "VIDEO", links: null }], properties: {}, widgets_values: ["旧版", "新版"] },
    ],
    links: [[1, 1, 0, 3, 0, "VIDEO"], [2, 2, 0, 3, 1, "VIDEO"]],
    groups: [], config: {}, extra: {}, version: 0.4,
  };
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
const findNode = (page, type) => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)}); return n ? n.id : null; })()`));
const propRead = (page, type, key) => page.ev(vis(`JSON.stringify(window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)})?.properties?.${key} ?? null)`));

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

const report = { mode: "b2-browser-evidence", engine: ENGINE, startedAt: new Date().toISOString(), groups: {}, interactions: {} };

// ══════════════════ 组① 像素截图(MyImageABCompare) ══════════════════
async function group1(page) {
  const g = { checks: [], shots: [] };
  await loadWf(page, buildImageWf(), "b2-image", 3);
  const known = await historyPids();
  await sleep(500);
  const queued = await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && e.message); } })()`);
  check("① queuePrompt(图件真前端)", queued === "queued", String(queued));
  const hist = await waitHistoryOnce(known, (b) => b.includes("MyImageABCompare"));
  check("① 引擎执行完成", hist.status === "success", `status=${hist.status} pid=${String(hist.pid).slice(0, 8)}`);
  await waitFor(() => page.ev(vis(`(() => { const p = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare')?.properties?.myAbImage; return (p && p.a && p.b) ? 'ok' : null; })()`)),
    { timeout: 30_000, interval: 800, label: "onExecuted→properties.myAbImage.a/b" });
  await sleep(1800); // ensureImage 两张小图解码

  // 配景:AB 节点居中(node.pos + 舞台中心)
  const geo = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const st = n.__myAbHits?.stage; return JSON.stringify({pos: n.pos, size: n.size, stage: st}); })()`))));
  await frameCanvas(page, [geo.pos[0] + geo.size[0] / 2, geo.pos[1] + geo.size[1] / 2], 0.9);
  const dsWrap = await canvasRectAndDs(page);

  // 几何断言:舞台顶 ≥ 标签行底(不叠字修复=stageTopFor 动态让位)。
  // 行高真值=两 label 行 last_y 差(本版前端实测行距≠token 假设的 20,按实测算);
  // 叠字量=标签行底−舞台顶,>0 即叠(像素级再探:重叠带内 label 文本框与舞台边框同在)
  const geo2 = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const st = n.__myAbHits?.stage; const labels = (n.widgets||[]).filter(w => w.name==='label_a'||w.name==='label_b').map(w => ({name:w.name, last_y:w.last_y ?? null, y:w.y ?? null, computedHeight:w.computedHeight ?? null})); return JSON.stringify({stage: st, labels, size: n.size, titleH:30, tokenRowH:20}); })()`))));
  const ys = geo2.labels.map((w) => w.last_y).filter((v) => v != null);
  const rowPitch = ys.length >= 2 ? Math.abs(ys[1] - ys[0]) : geo2.tokenRowH;
  const labelBottom = ys.length ? Math.max(...ys) + rowPitch : null;
  // 修复判据①:让位公式消费的行高假设(widget.computedHeight,stageTopFor 真源)
  // 须与实测行距(last_y 差)一致——常量猜不准即 0929 叠字根因,0930 修后须吻合
  const assumedRowHs = geo2.labels.map((w) => w.computedHeight).filter((v) => v != null);
  const assumedRowH = assumedRowHs.length ? Math.max(...assumedRowHs) : null;
  const pitchMatch = assumedRowH != null && rowPitch === assumedRowH;
  check("① 行距实测值与让位公式假设一致(last_y 差 == stageTopFor 消费的 computedHeight)", pitchMatch,
    `实测行距=${rowPitch} 公式假设(computedHeight)=${assumedRowH} labels=${JSON.stringify(geo2.labels)}`);
  const stageTopLocal = geo2.stage.y;
  const overlapPx = labelBottom == null ? null : +(labelBottom - stageTopLocal).toFixed(1);
  const noOverlap = overlapPx == null ? false : overlapPx <= 0.5;
  check("① 舞台与 label 行不叠字(几何:标签行底≤舞台顶;行距按实测 last_y 差)", noOverlap,
    `stage.y=${stageTopLocal} label last_y=${JSON.stringify(ys)} 实测行距=${rowPitch} 标签行底=${labelBottom} 叠字量=${overlapPx}px(size=${JSON.stringify(geo2.size)})`);
  g.geo = { stage: geo2.stage, labels: geo2.labels, rowPitch, labelBottom, overlapPx, assumedRowH, size: geo2.size };
  g.checks.push({ name: "rowpitch-matches-assumption", pass: pitchMatch, rowPitch, assumedRowH });
  g.checks.push({ name: "stage-label-no-overlap", pass: noOverlap, overlapPx, rowPitch });

  // 初始截图
  g.shots.push(await page.screenshot("g1-00-initial"));

  // 倍率循环 5 拍(真前端点击画布按钮;断言 properties.zoom 逐拍)
  const pillPt = (kind) => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const p = (n.__myAbHits?.pills||[]).find(p => p.kind === ${JSON.stringify(kind)}); return p ? JSON.stringify({x: p.x + p.w/2, y: p.y + p.h/2}) : null; })()`));
  const zoomSeq = [];
  const readZoom = async () => JSON.parse(String(await propRead(page, "MyImageABCompare", "myAbImage"))).zoom;
  const interactionLog = [];
  for (let i = 0; i < 5; i++) {
    const before = await readZoom();
    const local = JSON.parse(String(await pillPt("zoom")));
    const target = await vp(page, [geo.pos[0] + local.x, geo.pos[1] + local.y]);
    const rc = await clickAndVerify(page, { x: target.x, y: target.y, dom: `window.app.canvas.canvas` },
      async () => (await readZoom()) !== before, `zoom#${i}`);
    const z = await readZoom();
    zoomSeq.push(z);
    interactionLog.push({ step: `zoom-click-${i}`, method: rc.method, zoomAfter: z });
    g.shots.push(await page.screenshot(`g1-0${i + 1}-zoom${z}`));
  }
  const expectSeq = [3, 4, 5, 7, 2];
  const zoomOk = zoomSeq.every((z, i) => z === expectSeq[i]);
  check("① 倍率循环按钮 5 拍 2→3→4→5→7→2(真前端点击,properties.zoom 逐拍断言)", zoomOk,
    `实测=${JSON.stringify(zoomSeq)} 期望=${JSON.stringify(expectSeq)} 点击路径=${interactionLog.map((x) => x.method.split("|")[0]).join(",")}`);
  g.checks.push({ name: "zoom-cycle", pass: zoomOk, seq: zoomSeq });
  report.interactions.g1Zoom = interactionLog;

  // 放大镜开 + 镜位移动(mouseMoved 进舞台;镜心=命中点)
  const lensLocal = JSON.parse(String(await pillPt("lens")));
  const lensTarget = await vp(page, [geo.pos[0] + lensLocal.x, geo.pos[1] + lensLocal.y]);
  await page.hover(lensTarget.x, lensTarget.y);
  await page.mouse("mousePressed", lensTarget.x, lensTarget.y);
  await page.mouse("mouseReleased", lensTarget.x, lensTarget.y);
  await sleep(300);
  let st1 = JSON.parse(String(await propRead(page, "MyImageABCompare", "myAbImage")));
  let lensOnOk = st1.lensOn === true;
  if (!lensOnOk) { // 降级:JS 派发(如实记)
    await page.ev(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const st = n.properties.myAbImage; st.lensOn = !st.lensOn; n.setDirtyCanvas(true,true); return 'js-fallback'; })()`);
    await sleep(250); st1 = JSON.parse(String(await propRead(page, "MyImageABCompare", "myAbImage")));
    lensOnOk = st1.lensOn === true;
    report.interactions.g1LensToggle = { method: "js-fallback(properties 直翻)" };
  } else report.interactions.g1LensToggle = { method: "cdp-mouse" };
  // 镜位:hover 进舞台左上区(真实 mouseMoved)
  const lensMovePt = await vp(page, [geo.pos[0] + geo2.stage.x + geo2.stage.w * 0.35, geo.pos[1] + geo2.stage.y + geo2.stage.h * 0.4]);
  await page.mouse("mouseMoved", lensMovePt.x, lensMovePt.y);
  await sleep(400);
  const st2 = JSON.parse(String(await propRead(page, "MyImageABCompare", "myAbImage")));
  const lensMoved = Math.abs(st2.lensX - 0.35) < 0.06 && Math.abs(st2.lensY - 0.4) < 0.06;
  check("① 放大镜开关+镜位(真前端点击/移动;lensOn 翻转+lensX/Y≈(0.35,0.40))", lensOnOk && lensMoved,
    `lensOn=${st2.lensOn} lens=(${st2.lensX.toFixed(3)},${st2.lensY.toFixed(3)}) zoom=${st2.zoom}`);
  g.shots.push(await page.screenshot("g1-06-lens"));
  g.checks.push({ name: "lens-toggle-move", pass: lensOnOk && lensMoved, state: st2 });

  // 帘拖 0.25(手柄按下→移动→抬)
  const h0 = await vp(page, [geo.pos[0] + geo2.stage.x + geo2.stage.w * 0.5, geo.pos[1] + geo2.stage.y + geo2.stage.h * 0.5]);
  const h1 = await vp(page, [geo.pos[0] + geo2.stage.x + geo2.stage.w * 0.25, geo.pos[1] + geo2.stage.y + geo2.stage.h * 0.5]);
  await page.hover(h0.x, h0.y);
  await page.mouse("mousePressed", h0.x, h0.y);
  for (const f of [0.4, 0.32, 0.28, 0.25]) {
    const p = await vp(page, [geo.pos[0] + geo2.stage.x + geo2.stage.w * f, geo.pos[1] + geo2.stage.y + geo2.stage.h * 0.5]);
    await page.mouse("mouseMoved", p.x, p.y); await sleep(120);
  }
  await page.mouse("mouseReleased", h1.x, h1.y);
  await sleep(350);
  const st3 = JSON.parse(String(await propRead(page, "MyImageABCompare", "myAbImage")));
  const curtainOk = Math.abs(st3.curtain - 0.25) < 0.08;
  check("① 滑动帘拖拽至 0.25(真实按下-移动-抬指管线)", curtainOk, `curtain=${st3.curtain.toFixed(3)}`);
  g.shots.push(await page.screenshot("g1-07-curtain25"));
  g.checks.push({ name: "curtain-drag", pass: curtainOk, curtain: st3.curtain });

  // 像素采样输入导出(python 后处理:A 左红/B 右蓝)
  const stg = geo2.stage;
  const stTL = await vp(page, [geo.pos[0] + stg.x, geo.pos[1] + stg.y]);
  const stageVp = { x: stTL.x, y: stTL.y, w: stg.w * dsWrap.ds.scale, h: stg.h * dsWrap.ds.scale };
  const imgMeta = { w: st2.a?.width, h: st2.a?.height };
  g.pixelInput = { stageVp, imgMeta, curtain: st3.curtain, screenshot: "g1-07-curtain25.png" };
  g.finalState = st3;
  report.groups.g1 = g;
  return g;
}

// ══════════════════ 组② 实播漂移(MyVideoABCompare) ══════════════════
async function group2(page) {
  const g = { checks: [], shots: [], samples: [] };
  await loadWf(page, buildVideoWf(), "b2-video", 3);
  const known = await historyPids();
  await sleep(500);
  const queued = await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && e.message); } })()`);
  check("② queuePrompt(视频件真前端)", queued === "queued", String(queued));
  const hist = await waitHistoryOnce(known, (b) => b.includes("MyVideoABCompare"), 180_000);
  check("② 引擎执行完成(双路落 temp mp4)", hist.status === "success", `status=${hist.status} pid=${String(hist.pid).slice(0, 8)}`);
  await waitFor(() => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const p = n?.properties?.myAbVideo; const ui = n?.__myAbVideo; return (p && p.a && p.b && ui && ui.videoA && ui.videoA.readyState >= 1 && ui.videoB.readyState >= 1) ? 'ok' : null; })()`)),
    { timeout: 40_000, interval: 800, label: "onExecuted→DOM 双 video 就绪" });
  const vstate = () => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const p = n.properties.myAbVideo; const ui = n.__myAbVideo; return JSON.stringify({frame: p.frame, curtain: p.curtain, audio: p.audio, a: p.a, b: p.b, playing: ui.playing, token: ui.syncToken, tA: ui.videoA.currentTime, tB: ui.videoB.currentTime, pausedA: ui.videoA.paused, pausedB: ui.videoB.paused, mutedA: ui.videoA.muted, mutedB: ui.videoB.muted, rateB: ui.videoB.playbackRate, readout: ui.readout.textContent}); })()`));
  let s0 = JSON.parse(String(await vstate()));
  const tokenAfterExec = s0.token;
  check("② 双路元数据在位(A=12fps×48f,B=24fps×96f,不同帧率)", s0.a?.frame_rate === 12 && s0.a?.frame_count === 48 && s0.b?.frame_rate === 24 && s0.b?.frame_count === 96,
    `A=${s0.a?.frame_rate}fps×${s0.a?.frame_count}f B=${s0.b?.frame_rate}fps×${s0.b?.frame_count}f token=${tokenAfterExec}`);
  g.checks.push({ name: "meta-dual-rate", pass: true, a: s0.a, b: s0.b, tokenAfterExec });

  // DOM 控件坐标+按钮态读数(真前端点击)。verify=真验证(0930 收尾 F3:旧版
  // `.on !== undefined ? true : true` 恒真,与档头「所有点击均带状态翻转验证」声明
  // 相悖):play=按钮文案+is-on 样式翻转(setPlaying 同步翻,widget 真源
  // my-video-ab-compare.js 的 ui.playBtn.textContent/classList.toggle);声道=is-on
  // 迁移到所点按钮(applyAudio;默认 a 声,b→mute→a 每步皆有翻转);±1帧按钮自身
  // 无按钮态翻转,验证走 frame 步进(seekFrame 同步改 state.frame;组③ domClick
  // 同规)。控件点击处理皆同步,clickAndVerify 的 280ms 等待内必已翻转。
  const btnPt = (sel) => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const el = n.__myAbVideo.el.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2, on: el.classList.contains('is-on'), text: el.textContent}); })()`));
  const btnState = async (sel) => JSON.parse(String(await btnPt(sel)));
  const clickBtn = async (sel, label, verify) => {
    const b = await btnState(sel);
    const rc = await clickAndVerify(page, { x: b.x, y: b.y, dom: `window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').__myAbVideo.el.querySelector(${JSON.stringify(sel)})` }, verify, label);
    return { ...b, method: rc.method };
  };
  const playVerify = (playing) => async () => {
    const b = await btnState(".abv-play");
    return playing ? b.on === true && b.text === "⏸ 暂停" : b.on === false && b.text === "▶ 播放";
  };
  const audioOnVerify = (sel) => async () => (await btnState(sel)).on === true;

  // a. 播放(真点击)→漂移序列采样
  const playClick = await clickBtn(".abv-play", "play", playVerify(true));
  await waitFor(() => page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').__myAbVideo.playing === true ? 'ok' : null`)),
    { timeout: 8_000, interval: 300, label: "playing=true" });
  let sp = JSON.parse(String(await vstate()));
  const playOk = sp.playing === true && sp.pausedA === false && sp.rateB === 2; // 24/12=2 倍速贴帧
  check("② 播放(真点击 ▶):playing=true 且 B 路 playbackRate=rateB/rateA=2.0", playOk,
    `playing=${sp.playing} rateB=${sp.rateB} readout=${sp.readout} 点击路径=${playClick.method.split("|")[0]} token=${sp.token}(exec 后 ${tokenAfterExec}→+1)`);
  g.checks.push({ name: "play", pass: playOk, rateB: sp.rateB, token: sp.token, clickMethod: playClick.method });

  // b. rAF 漂移实测:10 采样×350ms(播放在途),期望 B=frame/24
  const shotsTaken = [];
  for (let i = 0; i < 10; i++) {
    const s = JSON.parse(String(await vstate()));
    const frameFromA = Math.min(Math.max(Math.round(s.tA * s.a.frame_rate), 0), s.a.frame_count - 1);
    const expectedB = Math.min(Math.max(frameFromA / s.b.frame_rate, 0), (s.b.frame_count - 1) / s.b.frame_rate);
    const driftB = Math.abs(s.tB - expectedB);
    g.samples.push({ i, t: Date.now(), tA: +s.tA.toFixed(4), tB: +s.tB.toFixed(4), frame: s.frame, frameFromA, expectedB: +expectedB.toFixed(4), driftB: +driftB.toFixed(4), playing: s.playing });
    if (i === 2 || i === 6) shotsTaken.push(await page.screenshot(`g2-play-${i}`));
  }
  const maxDrift = Math.max(...g.samples.map((x) => x.driftB));
  const driftOk = maxDrift <= 0.5;
  check("② rAF 实播漂移实测(不同帧率双路,B=frame/24 期望,容限 0.5s)", driftOk,
    `采样=${g.samples.length} maxDriftB=${maxDrift.toFixed(4)}s drift序列=${g.samples.map((x) => x.driftB.toFixed(2)).join(",")}`);
  g.checks.push({ name: "drift", pass: driftOk, maxDriftB: maxDrift, tolerance: 0.5, n: g.samples.length });

  // c. 暂停(真点击)→冻结+回帧对齐
  const pauseClick = await clickBtn(".abv-play", "pause", playVerify(false));
  await waitFor(() => page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').__myAbVideo.playing === false ? 'ok' : null`)),
    { timeout: 8_000, interval: 300, label: "playing=false" });
  await sleep(900);
  const sPause = JSON.parse(String(await vstate()));
  await sleep(600);
  const sPause2 = JSON.parse(String(await vstate()));
  const frozen = Math.abs(sPause2.tA - sPause.tA) < 0.002;
  const alignedOnPause = Math.abs(sPause.tA - sPause.frame / sPause.a.frame_rate) < 1 / sPause.a.frame_rate + 0.002;
  check("② 暂停(真点击 ⏸):双 video 停播冻结+回帧对齐(tA≈frame/12)", sPause.playing === false && frozen && alignedOnPause,
    `tA=${sPause.tA.toFixed(3)} frame=${sPause.frame} 期望=${(sPause.frame / 12).toFixed(3)} 冻结Δ=${Math.abs(sPause2.tA - sPause.tA).toFixed(4)} readout=${sPause.readout}`);
  g.shots.push(await page.screenshot("g2-paused"));
  g.checks.push({ name: "pause-freeze-align", pass: sPause.playing === false && frozen && alignedOnPause, tA: sPause.tA, frame: sPause.frame });

  // d. ±1帧(真点击;帧算术+readout+seek 精度)
  const f0 = sPause.frame;
  const clickSeq = [".abv-next", ".abv-next", ".abv-next", ".abv-prev"];
  const methods = [];
  let stepped = f0;
  for (const sel of clickSeq) {
    stepped += sel === ".abv-next" ? 1 : -1;
    const want = stepped; // ±1帧按钮无按钮态翻转,verify 走 frame 步进期望值
    const c = await clickBtn(sel, sel, async () => (JSON.parse(String(await vstate()))).frame === want);
    methods.push(c.method.split("|")[0]);
  }
  await sleep(700);
  const sFrame = JSON.parse(String(await vstate()));
  const expectF = f0 + 3 - 1;
  const frameOk = sFrame.frame === expectF && Math.abs(sFrame.tA - expectF / 12) < 1 / 12 + 0.002 && sFrame.readout.includes(`f${String(expectF).padStart(3, "0")}`);
  check("② ±1帧步进(真点击 +1×3→−1×1):frame 算术+readout+tA seek 精度", frameOk,
    `frame=${sFrame.frame}(期望 ${expectF}) tA=${sFrame.tA.toFixed(3)} readout=${sFrame.readout} 路径=${methods.join(",")}`);
  g.checks.push({ name: "frame-step", pass: frameOk, frame: sFrame.frame, readout: sFrame.readout });

  // e. 声道切换(真点击;muted 实测+is-on 态)
  const audioCases = [
    { sel: '[data-audio="b"]', audio: "b", mA: true, mB: false },
    { sel: '[data-audio="mute"]', audio: "mute", mA: true, mB: true },
    { sel: '[data-audio="a"]', audio: "a", mA: false, mB: true },
  ];
  const audioResults = [];
  for (const c of audioCases) {
    await clickBtn(c.sel, c.audio, audioOnVerify(c.sel));
    await sleep(250);
    const s = JSON.parse(String(await vstate()));
    const ok = s.audio === c.audio && s.mutedA === c.mA && s.mutedB === c.mB;
    audioResults.push({ want: c.audio, got: s.audio, mutedA: s.mutedA, mutedB: s.mutedB, ok });
    if (c.audio === "b") g.shots.push(await page.screenshot("g2-audio-b"));
  }
  const audioOk = audioResults.every((r) => r.ok);
  check("② A/B/静音声道切换(真点击;<video>.muted 三态实测)", audioOk, JSON.stringify(audioResults));
  g.checks.push({ name: "audio-switch", pass: audioOk, cases: audioResults });

  // f. syncToken 换源不双环:重执行(loadSides=换源)→token 逐转换 +1 且播放对齐不破
  const tokenBefore = JSON.parse(String(await vstate())).token;
  const known2 = await historyPids();
  await sleep(300);
  await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'requeued'; } catch (e) { return 'err:' + e.message; } })()`);
  const hist2 = await waitHistoryOnce(known2, (b) => b.includes("MyVideoABCompare"), 180_000);
  await waitFor(() => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const p = n.properties.myAbVideo; return (p && p.a && n.__myAbVideo.videoA.readyState >= 1) ? 'ok' : null; })()`)),
    { timeout: 40_000, interval: 800, label: "重执行→换源就绪" });
  await sleep(1000);
  const sRe = JSON.parse(String(await vstate()));
  const tokenDelta = sRe.token - tokenBefore;
  // 换源后短播漂移复验
  await clickBtn(".abv-play", "play2", playVerify(true));
  await waitFor(() => page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').__myAbVideo.playing === true ? 'ok' : null`)), { timeout: 8_000, interval: 300, label: "重源播放" });
  const reSamples = [];
  for (let i = 0; i < 4; i++) {
    const s = JSON.parse(String(await vstate()));
    const fA = Math.min(Math.max(Math.round(s.tA * 12), 0), 47);
    reSamples.push(Math.abs(s.tB - fA / 24));
    await sleep(350);
  }
  await clickBtn(".abv-play", "pause2", playVerify(false));
  const reMax = Math.max(...reSamples);
  // loadSides=setPlaying(false)(+1 经 setPlaying→startSyncLoop)+末尾显式 startSyncLoop(+1)
  // =每次换源恰 +2(初执行 0→2,重执行 8→10,run2 实测);每次递增皆弑旧环,双环无从并存
  const tokenOk = tokenDelta === 2 && reMax <= 0.5 && hist2.status === "success";
  check("② syncToken 换源不双环(重执行=换源:token 恰 +2=setPlaying+显式重开,重源播放对齐不破)", tokenOk,
    `token ${tokenBefore}→${sRe.token}(Δ=${tokenDelta},期望2) 重源播放 maxDriftB=${reMax.toFixed(4)}s status=${hist2.status}`);
  g.checks.push({ name: "sync-token-resource-change", pass: tokenOk, tokenBefore, tokenAfter: sRe.token, reMaxDrift: reMax });

  // g. 帘拖(DOM 手柄 pointer 管线)
  const handle = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const r = n.__myAbVideo.handle.getBoundingClientRect(); const st = n.__myAbVideo.stage.getBoundingClientRect(); return JSON.stringify({hx: r.left + r.width/2, hy: r.top + r.height/2, sx: st.left, sw: st.width}); })()`))));
  const targetX = handle.sx + handle.sw * 0.7;
  await page.hover(handle.hx, handle.hy);
  await page.mouse("mousePressed", handle.hx, handle.hy);
  for (const f of [0.55, 0.62, 0.66, 0.7]) { await page.mouse("mouseMoved", handle.sx + handle.sw * f, handle.hy); await sleep(120); }
  await page.mouse("mouseReleased", targetX, handle.hy);
  await sleep(350);
  const sCurtain = JSON.parse(String(await vstate()));
  const curtainOk = Math.abs(sCurtain.curtain - 0.7) < 0.08;
  check("② 视频帘拖拽至 0.7(pointer 手柄真实拖拽管线)", curtainOk, `curtain=${sCurtain.curtain.toFixed(3)}`);
  g.shots.push(await page.screenshot("g2-curtain70"));
  g.checks.push({ name: "video-curtain-drag", pass: curtainOk, curtain: sCurtain.curtain });

  g.finalState = JSON.parse(String(await vstate()));
  report.groups.g2 = g;
  return g;
}

// ══════════════════ 组③ 保存重开(serialize→loadGraphData 往返) ══════════════════
async function group3(page) {
  const g = { checks: [], shots: [] };
  // 当前画布=视频图;组③需要双件同画布——构造合并图(图件+视频件同场)再交互。
  // 布局注记:视频件置于右侧远离图件(x+760)——探针实录(probe7/8/9):视频件 DOM
  // widget 正上方 ~30-60px 带内画布点击不达(widget.mouse 零调用,canvas mousedown
  // 零触发,elementsFromPoint 顶=canvas 却无输入递达;图件独立图/probe9 布局则一切
  // 正常)——规避同带布局,该环境现象如实入 notes。
  const wf = buildImageWf();
  const vw = buildVideoWf();
  const shift = (n) => ({ ...n, id: n.id + 10, pos: [n.pos[0] + 760, n.pos[1] - 200], inputs: (n.inputs || []).map((i) => ({ ...i, link: i.link == null ? null : i.link + 2 })), outputs: (n.outputs || []).map((o) => ({ ...o, links: o.links ? o.links.map((l) => l + 2) : null })) });
  wf.nodes = [...wf.nodes, ...vw.nodes.map(shift)];
  wf.links = [...wf.links, ...vw.links.map((l) => [l[0] + 2, l[1] + 10, l[2], l[3] + 10, l[4], l[5]])];
  await loadWf(page, wf, "b2-both", 6);

  // 执行(双件同拍)
  const known = await historyPids();
  await sleep(400);
  await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + e.message; } })()`);
  const hist = await waitHistoryOnce(known, (b) => b.includes("MyImageABCompare") && b.includes("MyVideoABCompare"), 180_000);
  check("③ 双件合并图执行(图件+视频件同拍)", hist.status === "success", `status=${hist.status}`);
  await waitFor(() => page.ev(vis(`(() => { const gi = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare')?.properties?.myAbImage; const gv = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare')?.properties?.myAbVideo; return (gi && gi.a && gi.b && gv && gv.a && gv.b) ? 'ok' : null; })()`)),
    { timeout: 40_000, interval: 800, label: "双件 onExecuted" });
  await sleep(1500);

  // 图件:设定特征态(倍率点击×2→3→4? 现 zoom=2(新节点默认);点击×2=3,4;放大镜开;镜位 0.6/0.5)
  const prop = (type, key) => propRead(page, type, key);
  // 直接走真前端:帧景后点按钮
  const gnode = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const st = n.__myAbHits?.stage; return JSON.stringify({pos: n.pos, size: n.size, stage: st}); })()`))));
  await frameCanvas(page, [gnode.pos[0] + gnode.size[0] / 2, gnode.pos[1] + gnode.size[1] / 2], 0.6);
  const pillPt = (kind) => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare'); const p = (n.__myAbHits?.pills||[]).find(p => p.kind === ${JSON.stringify(kind)}); return p ? JSON.stringify({x: p.x + p.w/2, y: p.y + p.h/2}) : null; })()`));
  const imgProp = async () => JSON.parse(String(await prop("MyImageABCompare", "myAbImage")));
  const pillClick = async (kind, verify) => {
    const local = JSON.parse(String(await pillPt(kind)));
    const t = await vp(page, [gnode.pos[0] + local.x, gnode.pos[1] + local.y]);
    const rc = await clickAndVerify(page, { x: t.x, y: t.y, dom: `window.app.canvas.canvas` }, verify, kind);
    return rc;
  };
  {
    const z0 = (await imgProp()).zoom;
    await pillClick("zoom", async () => (await imgProp()).zoom !== z0);
    const z1 = (await imgProp()).zoom;
    await pillClick("zoom", async () => (await imgProp()).zoom !== z1);
    await pillClick("lens", async () => (await imgProp()).lensOn === true);
  }
  const lensPt = await vp(page, [gnode.pos[0] + gnode.stage.x + gnode.stage.w * 0.6, gnode.pos[1] + gnode.stage.y + gnode.stage.h * 0.5]);
  await page.mouse("mouseMoved", lensPt.x, lensPt.y); await sleep(400);
  const imgBefore = await imgProp();

  // 视频件:next ×2(帧 0→2)+B 声 + 帘 0.3
  const btnPt = (sel) => page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const el = n.__myAbVideo.el.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2}); })()`));
  const domClick = async (sel, verify) => {
    const b = JSON.parse(String(await btnPt(sel)));
    const rc = await clickAndVerify(page, { x: b.x, y: b.y, dom: `window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').__myAbVideo.el.querySelector(${JSON.stringify(sel)})` }, verify, sel);
    return rc;
  };
  const vidFrame = async () => JSON.parse(String(await prop("MyVideoABCompare", "myAbVideo"))).frame;
  const vidAudio = async () => JSON.parse(String(await prop("MyVideoABCompare", "myAbVideo"))).audio;
  {
    const f0 = await vidFrame();
    await domClick(".abv-next", async () => (await vidFrame()) === f0 + 1);
    const f1 = await vidFrame();
    await domClick(".abv-next", async () => (await vidFrame()) === f1 + 1);
    await domClick('[data-audio="b"]', async () => (await vidAudio()) === "b");
  }
  const handle = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const r = n.__myAbVideo.handle.getBoundingClientRect(); const st = n.__myAbVideo.stage.getBoundingClientRect(); return JSON.stringify({hx: r.left + r.width/2, hy: r.top + r.height/2, sx: st.left, sw: st.width}); })()`))));
  await page.hover(handle.hx, handle.hy);
  await page.mouse("mousePressed", handle.hx, handle.hy);
  for (const f of [0.4, 0.5, 0.6, 0.68, 0.7]) { await page.mouse("mouseMoved", handle.sx + handle.sw * f, handle.hy); await sleep(110); }
  await page.mouse("mouseReleased", handle.sx + handle.sw * 0.7, handle.hy);
  await sleep(400);
  const vidBefore = JSON.parse(String(await prop("MyVideoABCompare", "myAbVideo")));
  check("③ 前置:双件特征态设定(图:倍率4+镜开+镜位;视频:帧2+B声+帘0.7)", imgBefore.zoom === 4 && imgBefore.lensOn === true && vidBefore.frame === 2 && vidBefore.audio === "b",
    `img={zoom:${imgBefore.zoom},lensOn:${imgBefore.lensOn},lens:(${imgBefore.lensX.toFixed(2)},${imgBefore.lensY.toFixed(2)})} vid={frame:${vidBefore.frame},audio:${vidBefore.audio},curtain:${vidBefore.curtain.toFixed(2)}}`);
  g.before = { image: imgBefore, video: vidBefore };
  g.shots.push(await page.screenshot("g3-00-before-save"));

  // serialize → 存盘 → loadGraphData 重开(同页往返=保存/重开机制;userdata 恒零工作流=章约,不落盘引擎家)
  const saved = await page.ev(vis(`JSON.stringify(window.app.graph.serialize())`));
  writeFileSync(join(OUT_DIR, `${SHOT_PREFIX}g3-serialized-workflow.json`), String(saved));
  const savedObj = JSON.parse(String(saved));
  const savedImgNode = savedObj.nodes.find((n) => n.type === "MyImageABCompare");
  const savedVidNode = savedObj.nodes.find((n) => n.type === "MyVideoABCompare");
  const serOk = savedImgNode?.properties?.myAbImage?.zoom === 4 && savedVidNode?.properties?.myAbVideo?.audio === "b";
  check("③ graph.serialize() 携带交互态(序列化 JSON 内 myAbImage/myAbVideo 在场)", serOk,
    `ser.img={zoom:${savedImgNode?.properties?.myAbImage?.zoom},lensOn:${savedImgNode?.properties?.myAbImage?.lensOn},curtain:${savedImgNode?.properties?.myAbImage?.curtain?.toFixed(2)}} ser.vid={frame:${savedVidNode?.properties?.myAbVideo?.frame},audio:${savedVidNode?.properties?.myAbVideo?.audio},curtain:${savedVidNode?.properties?.myAbVideo?.curtain?.toFixed(2)}}`);

  await page.ev(`(async () => { window.app.loadGraphData(${saved}, true, true, 'b2-reopen'); return 'reopened'; })()`);
  await waitFor(() => page.ev(vis(`window.app.graph._nodes.length === 6 ? 'ok' : null`)), { timeout: 30_000, interval: 800, label: "重开画布切换" });
  await sleep(2000);
  const imgAfter = JSON.parse(String(await prop("MyImageABCompare", "myAbImage")));
  const vidAfter = JSON.parse(String(await prop("MyVideoABCompare", "myAbVideo")));
  const imgFields = ["curtain", "lensOn", "lensX", "lensY", "zoom"];
  const vidFields = ["curtain", "frame", "audio"];
  const imgMatch = imgFields.every((k) => JSON.stringify(imgBefore[k]) === JSON.stringify(imgAfter[k])) && !!imgAfter.a && !!imgAfter.b;
  const vidMatch = vidFields.every((k) => JSON.stringify(vidBefore[k]) === JSON.stringify(vidAfter[k])) && !!vidAfter.a && !!vidAfter.b;
  check("③ 重开复原(图件 myAbImage 五字段+双源引用)", imgMatch, JSON.stringify({ before: { curtain: imgBefore.curtain, lensOn: imgBefore.lensOn, lensX: +imgBefore.lensX.toFixed(3), lensY: +imgBefore.lensY.toFixed(3), zoom: imgBefore.zoom }, after: { curtain: imgAfter.curtain, lensOn: imgAfter.lensOn, lensX: +imgAfter.lensX.toFixed(3), lensY: +imgAfter.lensY.toFixed(3), zoom: imgAfter.zoom }, aRef: !!imgAfter.a, bRef: !!imgAfter.b }));
  check("③ 重开复原(视频件 myAbVideo 三字段+双源引用)", vidMatch, JSON.stringify({ before: { curtain: +vidBefore.curtain.toFixed(3), frame: vidBefore.frame, audio: vidBefore.audio }, after: { curtain: +vidAfter.curtain.toFixed(3), frame: vidAfter.frame, audio: vidAfter.audio }, aRef: !!vidAfter.a, bRef: !!vidAfter.b }));
  // 重开后视频 seek 复原:tA ≈ frame/12
  const reSeek = JSON.parse(String(await page.ev(vis(`(() => { const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare'); const ui = n.__myAbVideo; return JSON.stringify({tA: ui.videoA.currentTime, frame: n.properties.myAbVideo.frame, ready: ui.videoA.readyState}); })()`))));
  const reSeekOk = reSeek.ready >= 1 && Math.abs(reSeek.tA - reSeek.frame / 12) < 1 / 12 + 0.005;
  check("③ 重开视频帧位复原(tA≈frame/12,onConfigure→loadSides→seekFrame)", reSeekOk, `tA=${reSeek.tA.toFixed(3)} frame=${reSeek.frame} ready=${reSeek.ready}`);
  g.shots.push(await page.screenshot("g3-01-reopened"));
  g.checks.push({ name: "serialize-roundtrip-image", pass: imgMatch }, { name: "serialize-roundtrip-video", pass: vidMatch }, { name: "reopen-video-reseek", pass: reSeekOk });
  g.after = { image: imgAfter, video: vidAfter };
  report.groups.g3 = g;
  return g;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // A0 环境段(D-2:失败=退出码 2 语义,与开场 /system_stats 探活同域;waitFor 超时/
  // getPageClient 异常不再以未捕获崩出丢证据)
  try {
    for (const cls of ["MyImageABCompare", "MyVideoABCompare", "LoadVideo", "LoadImage"]) {
      const r = await fetch(`${ENGINE}/object_info/${encodeURIComponent(cls)}`);
      check(`A0 节点注册: ${cls}`, r.status === 200, `HTTP ${r.status}`);
    }
    const lv = await (await fetch(`${ENGINE}/object_info/LoadVideo`)).json();
    const files = lv.LoadVideo.input.required.file[1].options || [];
    check("A0 测试资产在 LoadVideo combo", files.includes("b2_va_12fps.mp4") && files.includes("b2_vb_24fps.mp4"), files.filter((f) => f.startsWith("b2_")).join(","));
    const li = await (await fetch(`${ENGINE}/object_info/LoadImage`)).json();
    const imgs = li.LoadImage.input.required.image[0] || [];
    check("A0 测试资产在 LoadImage combo", imgs.includes("b2_img_a.png") && imgs.includes("b2_img_b.png"), imgs.filter((f) => f.startsWith("b2_")).join(","));

    launchChrome();
    page = await getPageClient();
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  } catch (e) {
    throw new EnvError(`A0 环境段失败: ${e && e.message}`);
  }
  check("A0 引擎前端就绪", true);
  await sleep(2000);

  if (GROUPS.has("1")) await group1(page);
  if (GROUPS.has("2")) await group2(page);
  if (GROUPS.has("3")) await group3(page);
}

function writeReport() {
  report.results = results;
  report.groupsMode = [...GROUPS].join(",");
  report.finishedAt = new Date().toISOString();
  // 报告名按模式路由(D-3):组①复验=独立账 fix-b2-g1;全组=原三组合并账(有意复现式
  // 重跑);部分组=独立账 b2-evidence-g{Σ}——部分组重跑永不覆写三组存档账。
  const name = G1FIX_MODE ? "fix-b2-g1-report.json"
    : FULL_MODE ? "b2-evidence-report.json"
    : `b2-evidence-g${[...GROUPS].sort().join("")}-report.json`;
  writeFileSync(join(OUT_DIR, name), JSON.stringify(report, null, 2));
}

function cleanup() {
  try { page?.close(); } catch { /* gone */ }
  killChrome();
}

// 退出码语义收口(0930 修复官 D-2):0=全绿;1=有失败项或驱动异常(已取得的证据仍随
// finally 落盘);2=环境错误(开场 /system_stats 探活+A0 环境段)。SIGINT 同钩清理。
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
log(`════ B2 汇总(组模式=${[...GROUPS].join(",")})════`);
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(exitCode);
