#!/usr/bin/env node
/**
 * qi21 S3 门禁补真前端验证(09-30,Trellis 09-29-qi21-canvas-batch S3 门禁腿):
 *   腿A door(三件各自开门):t2i/i2i/edit 每件——
 *     ① 装配+加速两子图宿主**真实双击可入**(CDP 原生鼠标事件走前端完整手势链:
 *        CanvasPointer 双击检测→LGraphCanvas 双击分支→openSubgraph→setGraph;
 *        见 0930 预探 7 轮实录:ds 变换公式 px=(graphPt+offset)×scale、点击点须
 *        避开宿主面板控件区(命中 widget 走 widget 分支不开门));
 *        见证=subgraph-opened 事件 detail.subgraph.id==子图 UUID + canvas 图切换
 *        (根图节点数→子图内节点数)+进入态截图;退出=setGraph(根图)复位验证;
 *     ② 宿主面板控件在位(装配:件面板清单 JSON 实况;加速:速度档位+seed);
 *     ③ graphToPrompt 干跑默认档无异常+排队图摘要(SpeedSelect.mode=默认直出/
 *        PrimitiveInt.value/直出 KSampler steps=40,子图内节点展开键=宿主:内id);
 *   腿B lazy(i2i E2E 腿真跑,四源帧取证):三档(直出40/viggle/Fun-Acc)各一发实弹,
 *     每档四源=①页面 socket tee 逐节点 executing/executed 帧(app.api.socket 第二
 *        监听器现收,按 prompt_id 归属;0930 勘误:per-node 事件 sid 定向提交客户端,
 *        引擎 execution.py:496,第二 ws 客户端零帧不可用)
 *     ②/history(状态/产物/排队图 prompt[2]/cached 清单)③engine.log 窗口切片
 *     (入队/装载/Prompt executed in HH:MM:SS)④干跑排队图摘要(切档前置证);
 *     断言=选中支路采样器在执行集,未选支路采样器/KSampler/LoRA/T8 零出现
 *     (executing/executed 事件口径,S0 探针判读先例:cached≠执行),PE 组
 *     TextGenerate(PE 旁路)零出现;阳性对照=帧源活性>0 防零帧空集假证。
 *   探针控制(如实记):viggle 档生产 steps=359(0929 拉齐值)→探针在加速子图内
 *   前端实改该 KSampler steps=359→6(卡荐档,机器无法 359 步@1.5MP 门禁时限内跑完;
 *   懒证据=执行集成员资格,与 steps 值无关),生产 JSON 零触碰。
 *
 * 用法:node qi21_s3_gate_0930.mjs door   # 腿A(免生图)
 *      node qi21_s3_gate_0930.mjs lazy   # 腿B(真跑三档,约 25-35 分钟)
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17598)/CDP_PORT(默认 9367)。
 * 退出码 0=该腿全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17598";
const CDP_PORT = Number(process.env.CDP_PORT || 9367);
const MODE = process.argv[2] || "door";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/s3-gate-0930`;
const ENGINE_LOG = "/tmp/s3-gate-engine-0930/engine.log";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-s3-gate-chrome-profile";

const PIECES = [
  { key: "t2i", path: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
    asmPanel: ["主体句", "型选择", "RGBA透明", "PE开关", "画幅联动开关"], accelHost: 208 },
  { key: "i2i", path: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
    asmPanel: ["指令", "型选择", "RGBA透明", "PE开关"], accelHost: 190 },
  { key: "edit", path: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
    asmPanel: ["指令", "PE开关"], accelHost: 58 },
];

const SPEED_DIRECT = "0 · 直出40步", SPEED_FUNACC = "2 · Fun-Acc 4步", SPEED_VIGGLE = "1 · viggle";
const RGBA_FOLLOW = "跟随型";
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
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
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
    async dblclick(x, y) { // 原生输入管线双击(真实手势链:CanvasPointer 双击检测)
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(80);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await sleep(160);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async screenshot(name) {
      const path = join(OUT_DIR, `${name}.png`);
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* fallthrough */ }
      log(`📸 失败 ${path}`);
    },
  };
}

async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

function loadWorkflow(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

function setSGWidget(page, sgType, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing';
    if (!n.widgets || !n.widgets.length) return 'no-widgets';
    const w = n.widgets.find(w => String(w.name || '') === ${JSON.stringify(wname)});
    if (!w) return 'widget-not-found:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:' + w.name + '=' + String(w.value);
  })()`);
}

function setWidgetById(page, nid, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === String(${nid}));
    if (!n) return 'node-missing:' + ${nid};
    const w = n.widgets && n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + (n.widgets ? n.widgets.map(x => x.name).join(',') : 'none');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:[' + n.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value);
  })()`);
}

function promptDigest(page, classType, fields) {
  return page.ev(`(async () => {
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
      return out.length ? JSON.stringify(out) : 'class-not-found:' + ${JSON.stringify(classType)};
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
}

/** 真实双击开门:ds 变换居中宿主节点身(避控件区)→CDP 原生双击→见证收证 */
async function doorOpen(page, sgType, label, shotName) {
  const prep = await page.ev(`(() => {
    const app = window.app; const canvas = app.canvas;
    const node = app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!node) return JSON.stringify({ err: 'node-missing' });
    window.__evts = [];
    canvas.canvas.addEventListener('subgraph-opening', () => window.__evts.push('opening'));
    canvas.canvas.addEventListener('subgraph-opened', (e) => window.__evts.push('opened:' + (e.detail && e.detail.subgraph ? (e.detail.subgraph.id || '') : '?')));
    window.__rootGraph = app.graph;
    window.__rootCount = app.graph._nodes.length;
    window.__hostId = node.id;
    window.__isSubgraphHost = !!node.subgraph;
    const rect = canvas.canvas.getBoundingClientRect();
    const bodyY = node.pos[1] + Math.min(node.size[1] - 20, Math.max(140, node.size[1] * 0.7));
    const graphPt = [node.pos[0] + node.size[0] / 2, bodyY];
    const scale = 0.5;
    const targetPx = [rect.width / 2, rect.height / 2];
    canvas.ds.scale = scale;
    canvas.ds.offset = [targetPx[0] / scale - graphPt[0], targetPx[1] / scale - graphPt[1]];
    canvas.setDirty(true);
    const px2 = canvas.ds.convertOffsetToCanvas(graphPt);
    const hit = canvas.graph.getNodeOnPos(graphPt[0], graphPt[1], canvas.graph._nodes);
    const widget = node.getWidgetOnPos(graphPt[0], graphPt[1]);
    window.__clickPt = { x: Math.round(rect.left + px2[0]), y: Math.round(rect.top + px2[1]) };
    return JSON.stringify({ hostId: node.id, isSubgraphHost: window.__isSubgraphHost, rootCount: window.__rootCount, hit: hit ? hit.id : null, widgetHere: widget ? widget.name : null, click: window.__clickPt });
  })()`);
  let prepObj = null; try { prepObj = JSON.parse(String(prep)); } catch { /* keep null */ }
  if (!prepObj || prepObj.err) { check(`${label}: 开门前定位`, false, String(prep).slice(0, 200)); return false; }
  const prepOk = prepObj.isSubgraphHost === true && String(prepObj.hit) === String(prepObj.hostId) && prepObj.widgetHere === null;
  check(`${label}: 开门前定位(宿主=SubgraphNode·命中本节点·点击点在节点身非控件)`, prepOk,
    `host=[${prepObj.hostId}] subgraphHost=${prepObj.isSubgraphHost} hit=${prepObj.hit} widgetHere=${prepObj.widgetHere} click=${prepObj.click.x},${prepObj.click.y}`);
  if (!prepOk) return false;

  await page.dblclick(prepObj.click.x, prepObj.click.y);
  await sleep(1500);
  const state = await page.ev(vis(`(() => {
    const c = window.app.canvas;
    return JSON.stringify({
      evts: window.__evts || [],
      entered: c.graph !== window.__rootGraph,
      innerCount: c.graph && c.graph._nodes ? c.graph._nodes.length : null,
      rootCount: window.__rootCount,
      innerTypes: c.graph && c.graph._nodes ? c.graph._nodes.map(n => n.type).slice(0, 20) : null,
    });
  })()`));
  let st = null; try { st = JSON.parse(String(state)); } catch { /* keep null */ }
  const openedEvt = (st && st.evts || []).find((e) => String(e).startsWith("opened:"));
  const evtIdOk = openedEvt ? String(openedEvt).slice(7) === String(sgType) : false; // "opened:"=7 字符(0930 首轮 off-by-one 勘误)
  const entered = !!st && st.entered === true && st.innerCount > 0 && st.innerCount !== st.rootCount;
  check(`${label}: 真实双击开门(原生鼠标事件→subgraph-opened 事件+画布图切换入子图)`,
    evtIdOk && entered,
    `evt=${openedEvt || "无"} id匹配=${evtIdOk} 图切换=${entered}(根${st ? st.rootCount : "?"}节点→子图${st ? st.innerCount : "?"}节点) evts=${JSON.stringify([...new Set(st ? st.evts : [])])}`);
  if (!entered) return false;
  await page.screenshot(shotName);
  // 退出复位
  const exitRc = await page.ev(`(() => { try { window.app.canvas.setGraph(window.__rootGraph); return 'exited'; } catch (e) { return 'EXC:' + e.message; } })()`);
  await sleep(600);
  const backRc = await page.ev(vis(`window.app.canvas.graph === window.__rootGraph ? 'at-root(' + window.app.canvas.graph._nodes.length + ')' : 'not-at-root'`));
  check(`${label}: 退出复位(setGraph 根图)`, exitRc === "exited" && String(backRc).startsWith("at-root(") && String(backRc) === `at-root(${st.innerCount ? st.rootCount : "?"})`,
    `${exitRc} / ${backRc}`);
  return evtIdOk && entered;
}

// ── 懒取证源①:页面自身 socket 帧 tee(S0 探针同款;0930 首跑实证勘误)──
// 本版引擎 per-node executing/executed 事件按 sid=提交客户端定向发送
// (execution.py:496 server.send_sync("executing",…,server.client_id)),第二 ws
// 客户端(e2e 0924 写法)收不到任何帧——首跑 direct 拍 0 帧如实 FAIL 后改用
// S0 已证法:在页面 app.api.socket 上挂第二监听器(tee,不动前端自身派发),
// 帧落 window.__tee,拍后按 prompt_id 归属取出。
async function installTee(page) {
  const rc = await page.ev(`(() => {
    try {
      const sock = window.app.api.socket;
      if (!sock || typeof sock.addEventListener !== 'function') return 'no-socket:' + String(sock);
      window.__tee = [];
      window.__teeInstalledAt = Date.now();
      sock.addEventListener('message', (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if ((m.type === 'executing' || m.type === 'executed') && m.data && m.data.prompt_id && m.data.node != null) {
          window.__tee.push({ t: m.type, pid: m.data.prompt_id, node: String(m.data.node) });
        }
      });
      return 'tee-installed';
    } catch (e) { return 'EXC:' + e.message; }
  })()`);
  check("B0 懒取证源①装订:页面 socket tee(app.api.socket 第二监听器)", rc === "tee-installed", String(rc).slice(0, 200));
  return rc === "tee-installed";
}
function teeFramesOf(teeArr, pid) {
  const rec = { executing: new Set(), executed: new Set() };
  for (const f of teeArr || []) {
    if (f.pid !== pid || (f.t !== "executing" && f.t !== "executed")) continue;
    rec[f.t].add(String(f.node));
  }
  return rec;
}

async function historyPids() { try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { return new Set(); } }

function logWindow(fromOffset) { // 证据源③:engine.log 切片
  try { return readFileSync(ENGINE_LOG, "utf8").slice(fromOffset); } catch { return ""; }
}
function logSize() { try { return readFileSync(ENGINE_LOG).length; } catch { return 0; } }
function distillLog(win) {
  return win.split("\n").filter((l) => /got prompt|Prompt executed|loading|Loading|Requested|unload|lora|LoRA|text_encoder|clip|failed|Error|error/i.test(l)).slice(0, 80);
}
function logExecLines(win) { // 本版格式 "Prompt executed in 00:12:52"(HH:MM:SS,0930 首跑勘误:非秒数)
  return (win.match(/Prompt executed in [0-9:.]+/g) || []);
}

async function waitHistory(feature, { timeout, knownPids }) {
  const t0 = Date.now(); let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob, pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 8000)}` };
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages, promptBlob: blob, cached: (e.status?.messages || []).flatMap((m) => m[1]?.nodes || []) };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf;
}

// ══════════════ 腿A:三件开门+干跑 ══════════════
async function legDoor() {
  const report = { mode: "door", engine: ENGINE, startedAt: new Date().toISOString(), pieces: {} };
  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("A0 引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  for (const piece of PIECES) {
    const pr = { path: piece.path };
    report.pieces[piece.key] = pr;
    const graphJson = JSON.parse(readFileSync(piece.path, "utf8"));
    const subs = graphJson.definitions?.subgraphs || [];
    const asmSg = subs.find((s) => (s.name || "").includes("装配"));
    const accSg = subs.find((s) => (s.name || "").includes("加速"));
    check(`[${piece.key}] 前置: 恰两子图(装配+加速)`, subs.length === 2 && !!asmSg && !!accSg, subs.map((s) => s.name).join(" | "));
    if (!asmSg || !accSg) continue;
    const ASM = asmSg.id, ACCEL = accSg.id;
    const inner = (sg) => sg.nodes.length;
    pr.subgraphs = { asm: { id: ASM, nodes: inner(asmSg) }, accel: { id: ACCEL, nodes: inner(accSg) } };
    // 内件盘点(懒取证靶)
    const findInner = (sg, pred) => sg.nodes.find(pred);
    const ksAll = accSg.nodes.filter((n) => n.type === "KSampler");
    const ksDir = ksAll.find((n) => n.widgets_values?.[2] === 40);
    const ksVig = ksAll.find((n) => n.widgets_values?.[2] === 359);
    const t8 = findInner(accSg, (n) => n.type === "T8QwenImage21FunAccPDD4Step");
    const lora = findInner(accSg, (n) => n.type === "LoraLoaderModelOnly");
    const seedN = findInner(accSg, (n) => n.type === "PrimitiveInt");
    const selN = findInner(accSg, (n) => n.type === "MyQi21SpeedSelect");
    pr.accelInner = { host: piece.accelHost, ksDirect: ksDir?.id, ksViggle: ksVig?.id, t8: t8?.id, lora: lora?.id, seed: seedN?.id, select: selN?.id };
    check(`[${piece.key}] 前置: 加速子图六件齐(直出KS40步/viggle KS359/T8/LoRA/seed/选择件)`,
      [ksDir, ksVig, t8, lora, seedN, selN].every(Boolean),
      `直出=${ksDir?.id} viggle=${ksVig?.id} T8=${t8?.id} LoRA=${lora?.id} seed=${seedN?.id} 选择=${selN?.id}`);

    const nodeCount = graphJson.nodes.length;
    const opened = await loadWorkflow(page, `s3-gate-${piece.key}`, graphJson);
    check(`[${piece.key}] 工作流载入(loadGraphData)`, opened === "opened", String(opened));
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
      { timeout: 40_000, interval: 1000, label: `${piece.key} 画布切换` });
    await sleep(1500);
    await page.screenshot(`door-${piece.key}-00-loaded`);

    // ── ① 两子图真实双击开门 ──
    pr.doorAsm = await doorOpen(page, ASM, `[${piece.key}] 装配子图[${graphJson.nodes.find((n) => n.type === ASM)?.id}]`, `door-${piece.key}-asm-entered`);
    // 重新装载复位(干净态开第二门)
    await loadWorkflow(page, `s3-gate-${piece.key}`, graphJson);
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: `${piece.key} 复位` });
    await sleep(1200);
    pr.doorAccel = await doorOpen(page, ACCEL, `[${piece.key}] 加速子图[${piece.accelHost}]`, `door-${piece.key}-accel-entered`);
    await loadWorkflow(page, `s3-gate-${piece.key}`, graphJson);
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: `${piece.key} 复位2` });
    await sleep(1200);

    // ── ② 双宿主面板控件实况(期望=JSON widget 型边界输入 − 宿主已连线槽;连线槽=slot 非 panel 控件,0930 首轮实证)──
    const hostNode = graphJson.nodes.find((n) => n.type === ASM);
    const linkedNames = new Set((hostNode?.inputs || []).filter((i) => i.link !== null && i.link !== undefined).map((i) => i.name)); // inputs[]=全槽册;连线判定=link 非 null
    const sgWidgetInputs = (asmSg.inputs || []).filter((i) => ["COMBO", "BOOLEAN", "INT", "STRING", "FLOAT"].includes(i.type)).map((i) => i.name);
    const wantAsm = sgWidgetInputs.filter((nm) => !linkedNames.has(nm));
    pr.panelExpect = { sgWidgetInputs, linked: [...linkedNames], unlinkedExpected: wantAsm };
    const probeAsm = await page.ev(vis(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(ASM)});
      if (!n) return 'node-missing';
      return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type })) });
    })()`));
    let asmW = null; try { asmW = JSON.parse(String(probeAsm)); } catch { /* null */ }
    check(`[${piece.key}] 装配宿主面板控件在位(未连线 widget 型输入:${wantAsm.join("/") || "无"};连线槽=${[...linkedNames].join("/") || "无"})`,
      !!asmW && wantAsm.every((nm) => (asmW.widgets || []).some((w) => w.name === nm)),
      String(probeAsm).slice(0, 300));
    pr.asmPanel = String(probeAsm).slice(0, 600);
    const probeAcc = await page.ev(vis(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(ACCEL)});
      if (!n) return 'node-missing';
      return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: w.value })) });
    })()`));
    let accW = null; try { accW = JSON.parse(String(probeAcc)); } catch { /* null */ }
    check(`[${piece.key}] 加速宿主面板双控件在位(速度档位/seed)`,
      !!accW && ["速度档位", "seed"].every((nm) => (accW.widgets || []).some((w) => w.name === nm)),
      String(probeAcc).slice(0, 300));
    pr.accelPanel = String(probeAcc).slice(0, 600);

    // ── ③ graphToPrompt 干跑默认档 ──
    const dry = await page.ev(`(async () => {
      try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
      catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
    })()`);
    check(`[${piece.key}] graphToPrompt 干跑默认档无异常`, String(dry).startsWith("ok:"), String(dry).slice(0, 300));
    pr.dryRun = String(dry);
    const HOST = piece.accelHost;
    const drySel = await promptDigest(page, "MyQi21SpeedSelect", ["mode"]);
    check(`[${piece.key}] 干跑排队图 SpeedSelect.mode=${SPEED_DIRECT}(展开键=${HOST}:${selN.id})`,
      String(drySel).includes(`"mode":"${SPEED_DIRECT}"`) && String(drySel).includes(`"node":"${HOST}:${selN.id}"`), String(drySel).slice(0, 220));
    const drySeed = await promptDigest(page, "PrimitiveInt", ["value"]);
    // 内节点 id 装载时可重编号(0930 实证 t2i 206/207→216/217,与装配子图全局撞号重排;i2i/edit 稳定)
    // ——seed 断言按加速域前缀取 PrimitiveInt 实况,勿锚 JSON 内 id
    let seedDryOk = false, seedDryDetail = String(drySeed).slice(0, 220);
    try { seedDryOk = JSON.parse(String(drySeed)).some((o) => String(o.node).startsWith(`${HOST}:`) && typeof o.value === "number"); } catch { /* keep false */ }
    check(`[${piece.key}] 干跑排队图 PrimitiveInt 在加速子图域(宿主面板 seed 直通,展开键实况)`, seedDryOk, seedDryDetail);
    const dryKs = await promptDigest(page, "KSampler", ["steps"]);
    check(`[${piece.key}] 干跑排队图 双 KSampler 在队(steps 40/359,懒=执行期裁剪非排队期)`,
      String(dryKs).includes(`"steps":40`) && String(dryKs).includes(`"steps":359`), String(dryKs).slice(0, 260));
    const dryT8 = await promptDigest(page, "T8QwenImage21FunAccPDD4Step", ["model_file"]);
    check(`[${piece.key}] 干跑排队图 T8 支路在队(model_file=${t8.widgets_values?.[0]})`,
      String(dryT8).includes(`"node":"${HOST}:`) && String(dryT8).includes(String(t8.widgets_values?.[0])), String(dryT8).slice(0, 220));
    const dryLora = await promptDigest(page, "LoraLoaderModelOnly", ["lora_name"]);
    check(`[${piece.key}] 干跑排队图 LoRA 支路在队(${lora.widgets_values?.[0].slice(0, 44)}…)`,
      String(dryLora).includes(String(lora.widgets_values?.[0])), String(dryLora).slice(0, 220));
    pr.digests = { sel: String(drySel).slice(0, 200), seed: String(drySeed).slice(0, 200), ks: String(dryKs).slice(0, 300) };
    await page.screenshot(`door-${piece.key}-99-dry-default`);
  }

  report.finishedAt = new Date().toISOString();
  report.results = results;
  writeFileSync(join(OUT_DIR, "door-report.json"), JSON.stringify(report, null, 2));
  page.close(); killChrome();
  log("════ 腿A汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

// ══════════════ 腿B:i2i 三档懒执行四源帧真跑 ══════════════
async function legLazy() {
  const report = { mode: "lazy", engine: ENGINE, startedAt: new Date().toISOString(), profiles: {} };
  const piece = PIECES.find((p) => p.key === "i2i");
  const graphJson = JSON.parse(readFileSync(piece.path, "utf8"));
  const subs = graphJson.definitions?.subgraphs || [];
  const asmSg = subs.find((s) => (s.name || "").includes("装配"));
  const accSg = subs.find((s) => (s.name || "").includes("加速"));
  const ASM = asmSg.id, ACCEL = accSg.id;

  const monWs = null; // 0930 勘误:第二 ws 客户端收不到 sid 定向的 per-node 事件,弃用(见 installTee 头注)
  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "前端就绪" });
  await sleep(2000);
  await installTee(page);
  const nodeCount = graphJson.nodes.length;
  const opened = await loadWorkflow(page, "s3-gate-lazy-i2i", graphJson);
  check("B0 i2i 工作流载入", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(1500);

  // ── 运行态 id 发现(0930 实证:子图内节点装载可重编号,懒取证靶以干跑排队图实况为准,勿锚 JSON id)──
  const HOST = piece.accelHost;
  const parseDigest = async (cls, fields) => { try { return JSON.parse(String(await promptDigest(page, cls, fields))); } catch { return null; } };
  const selArr = await parseDigest("MyQi21SpeedSelect", ["mode"]);
  const ksArr = await parseDigest("KSampler", ["steps"]);
  const seedArr = await parseDigest("PrimitiveInt", ["value"]);
  const t8Arr = await parseDigest("T8QwenImage21FunAccPDD4Step", ["model_file"]);
  const loraArr = await parseDigest("LoraLoaderModelOnly", ["lora_name"]);
  const tgArr = await parseDigest("TextGenerate", ["clip_name"]);
  const rt = {
    SEL: selArr?.find((o) => String(o.node).startsWith(`${HOST}:`))?.node,
    KS_DIR: ksArr?.find((o) => String(o.node).startsWith(`${HOST}:`) && o.steps === 40)?.node,
    KS_VIG: ksArr?.find((o) => String(o.node).startsWith(`${HOST}:`) && o.steps === 359)?.node,
    SEED: seedArr?.find((o) => String(o.node).startsWith(`${HOST}:`) && typeof o.value === "number")?.node,
    T8: t8Arr?.find((o) => String(o.node).startsWith(`${HOST}:`))?.node,
    LORA: loraArr?.find((o) => String(o.node).startsWith(`${HOST}:`))?.node,
    TG: tgArr?.find((o) => String(o.node).startsWith("40:"))?.node,
  };
  const rtOk = Object.values(rt).every((v) => !!v);
  check("B0 运行态懒取证靶发现(干跑排队图实况:选择/直出KS/viggleKS/seed/T8/LoRA/PE TextGenerate)",
    rtOk, JSON.stringify(rt));
  if (!rtOk) { writeFileSync(join(OUT_DIR, "lazy-report.json"), JSON.stringify({ fatal: "运行态靶发现不全", rt, results }, null, 2)); page.close(); killChrome(); process.exit(1); }
  const NID = rt; // 展开键=宿主:内节点运行态 id
  const KS_VIG_INNER_ID = Number(String(rt.KS_VIG).split(":")[1]); // viggle steps 探针控制的子图内实况 id
  log("懒取证靶(运行态发现):", JSON.stringify(NID));
  report.targets = NID;

  // 基线(与 e2e 同口径):人物/跟随型/PE关/[19]画幅false/速度=直出
  const bl = [];
  bl.push(["型选择=人物", await setSGWidget(page, ASM, "型选择", "人物")]);
  bl.push([`RGBA透明=${RGBA_FOLLOW}`, await setSGWidget(page, ASM, "RGBA透明", RGBA_FOLLOW)]);
  bl.push(["PE开关=false", await setSGWidget(page, ASM, "PE开关", false)]);
  bl.push(["[19] value=false", await setWidgetById(page, 19, "value", false)]);
  for (const [nm, rc] of bl) check(`B0 基线 ${nm}`, String(rc).startsWith("set:"), String(rc).slice(0, 160));
  const peObj = await (await fetch(`${ENGINE}/object_info/CLIPLoader`)).json();
  const peOk = (peObj.CLIPLoader?.input?.required?.clip_name?.[0] || []).includes("qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors");
  check("B0 环境: PE-I2I 权重在盘(无需 e2e 的惰性覆写处置)", peOk, "");

  const PROFILES = [
    { key: "direct", mode: SPEED_DIRECT, seed: 101, mustIn: [NID.KS_DIR, NID.SEL], mustOut: [NID.KS_VIG, NID.LORA, NID.T8, NID.TG], stepsOverride: null, timeout: 1_500_000 },
    { key: "funacc", mode: SPEED_FUNACC, seed: 202, mustIn: [NID.T8, NID.SEL], mustOut: [NID.KS_DIR, NID.KS_VIG, NID.LORA, NID.TG], stepsOverride: null, timeout: 1_200_000 },
    { key: "viggle", mode: SPEED_VIGGLE, seed: 303, mustIn: [NID.LORA, NID.KS_VIG, NID.SEL], mustOut: [NID.KS_DIR, NID.T8, NID.TG], stepsOverride: { from: 359, to: 6 }, timeout: 1_200_000 },
  ];

  for (const prof of PROFILES) {
    const pr = { profile: prof.key, mode: prof.mode, seed: prof.seed };
    report.profiles[prof.key] = pr;
    // 档位+seed(加速宿主面板,切档探针)
    const rm = await setSGWidget(page, ACCEL, "速度档位", prof.mode);
    check(`[${prof.key}] 宿主面板切档 速度档位=${prof.mode}`, String(rm).startsWith("set:") && String(rm).endsWith(prof.mode), String(rm).slice(0, 160));
    const rs = await setSGWidget(page, ACCEL, "seed", prof.seed);
    check(`[${prof.key}] 宿主面板 seed=${prof.seed}`, String(rs).startsWith("set:") && String(rs).endsWith(String(prof.seed)), String(rs).slice(0, 160));
    // viggle 探针控制:入加速子图实改 KS steps 359→6(真实前端路径:双击入图→widget 改值)
    if (prof.stepsOverride) {
      const rc = await page.ev(`(() => {
        const app = window.app; const canvas = app.canvas;
        const node = app.graph._nodes.find(n => n.type === ${JSON.stringify(ACCEL)});
        if (!node) return 'node-missing';
        window.__rootGraph = app.graph;
        const rect = canvas.canvas.getBoundingClientRect();
        const bodyY = node.pos[1] + Math.min(node.size[1] - 20, Math.max(140, node.size[1] * 0.7));
        const graphPt = [node.pos[0] + node.size[0] / 2, bodyY];
        const scale = 0.5;
        canvas.ds.scale = scale;
        canvas.ds.offset = [rect.width / 2 / scale - graphPt[0], rect.height / 2 / scale - graphPt[1]];
        canvas.setDirty(true);
        const px2 = canvas.ds.convertOffsetToCanvas(graphPt);
        window.__clickPt = { x: Math.round(rect.left + px2[0]), y: Math.round(rect.top + px2[1]) };
        return 'prepped@' + window.__clickPt.x + ',' + window.__clickPt.y;
      })()`);
      const pt = JSON.parse(await page.ev(vis(`JSON.stringify(window.__clickPt)`)));
      await page.dblclick(pt.x, pt.y);
      await sleep(1200);
      const setRc = await page.ev(`(() => {
        const g = window.app.canvas.graph;
        const n = g && g._nodes ? g._nodes.find(n => String(n.id) === String(${KS_VIG_INNER_ID})) : null;
        if (!n) return 'inner-missing:' + (g ? 'in-subgraph' : 'no-graph');
        const w = n.widgets && n.widgets.find(w => w.name === 'steps');
        if (!w) return 'widget-missing:' + (n.widgets ? n.widgets.map(x => x.name).join(',') : 'none');
        const before = w.value;
        w.value = ${prof.stepsOverride.to};
        try { w.callback && w.callback(w.value); } catch (e) {}
        return 'steps ' + before + '->' + w.value;
      })()`);
      check(`[${prof.key}] 探针控制: 加速子图内 KS[${KS_VIG_INNER_ID}] steps ${prof.stepsOverride.from}→${prof.stepsOverride.to}(真实前端双击入图改值;359步@1.5MP 超门禁时限,懒证据=执行集与 steps 无关)`,
        String(setRc).includes(`->${prof.stepsOverride.to}`), String(setRc).slice(0, 200));
      pr.stepsOverride = String(setRc);
      await page.ev(`(() => { try { window.app.canvas.setGraph(window.__rootGraph); return 'exited'; } catch (e) { return 'EXC:' + e.message; } })()`);
      await sleep(600);
    }
    // 源④:干跑排队图(切档前置证)
    const drySel = await promptDigest(page, "MyQi21SpeedSelect", ["mode"]);
    check(`[${prof.key}] 源④干跑: 排队图 mode=${prof.mode}`, String(drySel).includes(`"mode":"${prof.mode}"`) && String(drySel).includes(`"node":"${NID.SEL}"`), String(drySel).slice(0, 200));
    const drySeed = await promptDigest(page, "PrimitiveInt", ["value"]);
    check(`[${prof.key}] 源④干跑: 排队图 seed=${prof.seed}(${NID.SEED})`,
      String(drySeed).includes(`"value":${prof.seed}`) && String(drySeed).includes(`"node":"${NID.SEED}"`), String(drySeed).slice(0, 200));
    const dryKs = await promptDigest(page, "KSampler", ["steps"]);
    const wantSteps = prof.stepsOverride ? `"steps":${prof.stepsOverride.to}` : null;
    check(`[${prof.key}] 源④干跑: 排队图 KSampler steps 集(${prof.key === "viggle" ? "359→6 探针值" : "40/359 生产值"})`,
      wantSteps ? String(dryKs).includes(wantSteps) && !String(dryKs).includes('"steps":359') : (String(dryKs).includes('"steps":40') && String(dryKs).includes('"steps":359')),
      String(dryKs).slice(0, 260));
    pr.dryDigest = { sel: String(drySel).slice(0, 160), ks: String(dryKs).slice(0, 240) };

    // 真跑
    const logBefore = logSize();
    const knownPids = await historyPids();
    await sleep(800);
    const queued = await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); } })()`);
    check(`[${prof.key}] queuePrompt 发出(真前端)`, queued === "queued", String(queued));
    if (queued !== "queued") break;
    const sig = (blob) => blob.includes(`"mode":"${prof.mode}"`) && (blob.includes(`"value":${prof.seed},`) || blob.includes(`"value":${prof.seed}}`)) && blob.includes(`"${NID.SEL}"`);
    const t0 = Date.now();
    const hist = await waitHistory(sig, { timeout: prof.timeout, knownPids });
    pr.secs = ((Date.now() - t0) / 1000).toFixed(0);
    const logWin = logWindow(logBefore);
    pr.engineLog = distillLog(logWin);
    if (hist.error) {
      check(`[${prof.key}] 引擎执行完成`, false, String(hist.error).slice(0, 3000));
      pr.error = hist.error;
      continue;
    }
    pr.pid = hist.pid;
    // 产物
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    try {
      const buf = await fetchView(saveImg, join(OUT_DIR, `lazy-${prof.key}-seed${prof.seed}.png`));
      check(`[${prof.key}] 出图落盘(/view)`, buf.length > 50_000, `${saveImg.filename} ${(buf.length / 1024).toFixed(0)}KB ${pr.secs}s pid=${String(hist.pid).slice(0, 8)}`);
    } catch (e) { check(`[${prof.key}] 出图落盘(/view)`, false, String(e.message)); }
    // 源②:history
    pr.history = { status: hist.status, cachedCount: (hist.cached || []).length, cached: hist.cached };
    check(`[${prof.key}] 源②history: status=success`, hist.status === "success", `status=${hist.status} cached=${(hist.cached || []).length} 节点`);
    pr.promptBlobHas = { mode: (hist.promptBlob || "").includes(`"mode":"${prof.mode}"`), select: (hist.promptBlob || "").includes(`"${NID.SEL}"`) };
    check(`[${prof.key}] 源②history: 排队图 prompt[2] 含档位+子图展开键`, pr.promptBlobHas.mode && pr.promptBlobHas.select, JSON.stringify(pr.promptBlobHas));
    // 源③:engine.log
    const logExecLine = logExecLines(logWin).join(", ");
    check(`[${prof.key}] 源③engine.log: 本窗 Prompt executed 行`, logExecLine.length > 0, logExecLine || "(无——如实在 report.engineLog)");
    // 源①:页面 socket tee 执行帧断言(提交客户端 sid 定向事件的唯一旁路源)
    const teeRaw = await page.ev(vis(`JSON.stringify(window.__tee || [])`));
    let teeArr = null; try { teeArr = JSON.parse(String(teeRaw)); } catch { /* null */ }
    const rec = teeArr ? teeFramesOf(teeArr, hist.pid) : null;
    const executedNodes = rec ? [...new Set([...rec.executed, ...rec.executing])] : [];
    pr.executedNodes = executedNodes;
    pr.frameStats = rec ? { executing: rec.executing.size, executed: rec.executed.size } : null;
    const sawFrames = !!rec && executedNodes.length > 0;
    check(`[${prof.key}] 源①socket tee 帧源活性(>0 帧,防零帧空集假证)`, sawFrames,
      rec ? `executing=${rec.executing.size}/executed=${rec.executed.size}` : "tee 未捕获该拍(源失效=FAIL)");
    const missingIn = prof.mustIn.filter((x) => !executedNodes.includes(x));
    const leaked = prof.mustOut.filter((x) => executedNodes.includes(x));
    check(`[${prof.key}] 三档懒执行断言: 选中支路[${prof.mustIn.join(",")}]在执行集 / 未选[${prof.mustOut.join(",")}]零出现`,
      sawFrames && missingIn.length === 0 && leaked.length === 0,
      `missing=${JSON.stringify(missingIn)} leaked=${JSON.stringify(leaked)}; executed=${JSON.stringify(executedNodes)}`);
    pr.verdict = { missingIn, leaked, pass: sawFrames && missingIn.length === 0 && leaked.length === 0 };
    await page.screenshot(`lazy-${prof.key}-done`);
    // 拍间释放(0924 OOM 复盘配方)
    try {
      const r = await fetch(`${ENGINE}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
      check(`[${prof.key}] 拍间释放 POST /free`, r.status === 200, `HTTP ${r.status}`);
    } catch (e) { check(`[${prof.key}] 拍间释放 POST /free`, false, String(e.message)); }
    await sleep(6000);
  }

  report.finishedAt = new Date().toISOString();
  report.results = results;
  writeFileSync(join(OUT_DIR, "lazy-report.json"), JSON.stringify(report, null, 2));
  page.close();
  if (monWs) { try { monWs.close(); } catch { /* gone */ } }
  killChrome();
  log("════ 腿B汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

mkdirSync(OUT_DIR, { recursive: true });
try {
  const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", alive.system?.comfyui_version);
} catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }
if (MODE === "door") await legDoor();
else if (MODE === "lazy") await legLazy();
else { console.error("用法: node qi21_s3_gate_0930.mjs door|lazy"); process.exit(2); }
