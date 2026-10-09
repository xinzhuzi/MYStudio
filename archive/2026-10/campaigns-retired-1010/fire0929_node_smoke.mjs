#!/usr/bin/env node
/**
 * 实弹验收 0929 — 两枚新自研节点真前端现场冒烟(临时小图,画布即弃):
 *   ① MyImageGridSplit:LoadImage(fire0929_grid2x2.png 2×2 色块)→ 2×2 切割
 *      → 断言引擎 input 目录出现 4 张切割帧 + 逐格像素色对账(红/绿/蓝/黄);
 *   ② MyVideoFrameGrab:LoadVideo(fire0929_video8f.mp4 8 帧纯色)→ 均匀抽 4 帧
 *      → 断言 input 出现 f00000/f00002/f00005/f00007 + 帧色对账。
 * 铁律:真前端 queuePrompt(headless CDP + app.loadGraphData 注入临时图,非仓库工作流);
 * history 轮询每 3s 一发(禁 sleep 阻塞主循环之外的挂死)。
 * 驱动仿 apps/build/scripts/qi21_e2e_final_0923.mjs;引擎生命周期在驱动外管理。
 * 用法:node apps/build/scripts/fire0929_node_smoke.mjs;退出码 0=全绿 1=有失败 2=环境错。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17001";
const CDP_PORT = Number(process.env.CDP_PORT || 9371);
const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/fire0929-smoke-chrome-profile";
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const INPUT_DIR = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/input`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0;
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_PROFILE}`,
    "--window-size=1720,1050", "--no-first-run", "--no-default-browser-check",
    "--disable-crash-reporter", "--disable-background-timer-throttling", ENGINE,
  ], { detached: true, stdio: "ignore" });
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
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
      consoleErrors.push({ src: "console", type: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000),
        ts: new Date().toISOString() });
    } else if (m.method === "Log.entryAdded" && (m.params.entry?.level === "error")) {
      consoleErrors.push({ src: "log", text: m.params.entry.text, url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000), ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 800);
      return r.result.value;
    },
  };
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

async function loadGraph(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 节点定位按 type(画布唯一);widget 按 name 设值。 */
function setWidget(page, type, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)});
    if (!n) return 'node-missing:' + ${JSON.stringify(type)};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:' + w.name + '=' + String(w.value);
  })()`);
}

function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

async function historyPids() {
  try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); }
  catch { return new Set(); }
}

/** 干跑队列图里指定 classType 的节点 inputs 摘要(执行集预取证)。 */
function promptDigest(page, classType, fields) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const out = [];
      for (const k of Object.keys(p.output || {}).sort()) {
        if (p.output[k].class_type === ${JSON.stringify(classType)}) {
          const o = { node: k, class_type: p.output[k].class_type };
          for (const f of ${JSON.stringify(fields)}) o[f] = p.output[k].inputs[f];
          out.push(o);
        }
      }
      return JSON.stringify(out);
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
}

/** 等新拍完成:返回 {pid, entry}(含 outputs/status/messages);error 态即返。 */
async function waitNewHistory(knownPids, { timeout = 120_000 } = {}) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 8000)}` };
        }
        if (st === "success" || e.status?.completed) {
          return { pid, entry: e, status: st, messages: e.status?.messages };
        }
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

/** 引擎 venv python 逐像素对账(切割格/抽帧色)。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
async function pixelCheck(filesJson, expectJson) {
  const { stdout } = await execFileP(VENV_PY, ["-c", `
import json, sys, os
from PIL import Image
files = json.loads(sys.argv[1]); expect = json.loads(sys.argv[2])
base = ${JSON.stringify(INPUT_DIR)}
out = []
for rel, (w, h, rgb, tol) in zip(files, expect):
    p = os.path.join(base, rel)
    if not os.path.exists(p):
        out.append({"file": rel, "exists": False}); continue
    im = Image.open(p).convert("RGB")
    px = im.getpixel((im.width // 2, im.height // 2))
    diffs = [abs(a - b) for a, b in zip(px, rgb)]
    out.append({"file": rel, "exists": True, "size": im.size, "center_px": list(px),
                "expect": list(rgb), "maxdiff": max(diffs), "ok": im.size == (w, h) and max(diffs) <= tol})
print(json.dumps(out))
`, JSON.stringify(filesJson), JSON.stringify(expectJson)]);
  return JSON.parse(stdout);
}

// ── 临时图 ①:LoadImage → MyImageGridSplit ─────────────────────────
const GRID_GRAPH = {
  id: "fire0929-smoke-grid",
  nodes: [
    { id: 1, type: "LoadImage", pos: [80, 200], size: [270, 314], flags: {}, order: 0, mode: 0,
      inputs: [{ name: "upload", type: "IMAGE", link: null }],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }, { name: "MASK", type: "MASK", links: null }],
      properties: { "Node name for S&R": "LoadImage" },
      widgets_values: ["fire0929_grid2x2.png", "image"] },
    { id: 2, type: "MyImageGridSplit", pos: [480, 200], size: [340, 300], flags: {}, order: 1, mode: 0,
      inputs: [{ name: "images", type: "IMAGE", link: 1 }],
      outputs: [{ name: "input_names", type: "STRING", links: null }],
      properties: { "Node name for S&R": "MyImageGridSplit" },
      widgets_values: [2, 2, "fire0929_grid", 0.0, 0.0, 1.0, 1.0] },
  ],
  links: [[1, 1, 0, 2, 0, "IMAGE"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

// ── 临时图 ②:LoadVideo → MyVideoFrameGrab ─────────────────────────
const GRAB_GRAPH = {
  id: "fire0929-smoke-grab",
  nodes: [
    { id: 1, type: "LoadVideo", pos: [80, 200], size: [320, 320], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [1] }],
      properties: { "Node name for S&R": "LoadVideo" },
      widgets_values: ["fire0929_video8f.mp4"] },
    { id: 2, type: "MyVideoFrameGrab", pos: [520, 200], size: [340, 300], flags: {}, order: 1, mode: 0,
      inputs: [{ name: "video", type: "VIDEO", link: 1 }],
      outputs: [{ name: "input_names", type: "STRING", links: null }],
      properties: { "Node name for S&R": "MyVideoFrameGrab" },
      widgets_values: ["均匀 · 等距N帧", 4, "fire0929_frames"] },
  ],
  links: [[1, 1, 0, 2, 0, "VIDEO"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

async function main() {
  // 引擎探活 + 注册断言
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  // ══ ① 宫格切割 ══
  const opened1 = await loadGraph(page, "fire0929-冒烟-宫格切割", GRID_GRAPH);
  check("① 工作流载入(前端 loadGraphData,临时图)", opened1 === "opened", String(opened1));
  await sleep(1500);
  const rImg = await setWidget(page, "LoadImage", "image", "fire0929_grid2x2.png");
  const rRows = await setWidget(page, "MyImageGridSplit", "rows", 2);
  const rCols = await setWidget(page, "MyImageGridSplit", "cols", 2);
  const rPfx = await setWidget(page, "MyImageGridSplit", "filename_prefix", "fire0929b_grid");
  check("① 画布设值: LoadImage=fire0929_grid2x2.png", String(rImg).startsWith("set:"), String(rImg).slice(0, 120));
  check("① 画布设值: rows=2/cols=2/prefix=fire0929_grid", [rRows, rCols, rPfx].every((r) => String(r).startsWith("set:")),
    [rRows, rCols, rPfx].map(String).join(" | ").slice(0, 200));
  const dry1 = await promptDigest(page, "MyImageGridSplit", ["rows", "cols", "filename_prefix"]);
  check("① 干跑: graphToPrompt 队列图含 MyImageGridSplit", String(dry1).includes("MyImageGridSplit") && !String(dry1).startsWith("graphToPrompt-err"), String(dry1).slice(0, 200));

  const known1 = await historyPids();
  await sleep(800);
  const q1 = await queuePrompt(page);
  check("① queuePrompt 发出(真前端)", q1 === "queued", String(q1));
  const h1 = await waitNewHistory(known1, { timeout: 120_000 });
  if (h1.error) {
    check("① 引擎执行完成", false, h1.error.slice(0, 3000));
  } else {
    check("① 引擎执行完成", true, `pid=${String(h1.pid).slice(0, 8)} status=${h1.status}`);
    const inputImgs = [];
    for (const o of Object.values(h1.entry.outputs || {})) if (o.images) inputImgs.push(...o.images.filter((i) => i.type === "input" && /\.png$/i.test(i.filename)));
    check("① history outputs 含 type=input 回灌帧(ui.images)", inputImgs.length === 4,
      JSON.stringify(inputImgs.map((i) => i.filename)));
    const gridFiles = ["fire0929b_grid_00001_r0c0.png", "fire0929b_grid_00001_r0c1.png", "fire0929b_grid_00001_r1c0.png", "fire0929b_grid_00001_r1c1.png"];
    const gridExpect = [[128, 128, [255, 0, 0], 2], [128, 128, [0, 255, 0], 2], [128, 128, [0, 0, 255], 2], [128, 128, [255, 255, 0], 2]];
    const px1 = await pixelCheck(gridFiles, gridExpect);
    check("① input 目录 4 张切割帧存在+尺寸 128×128+逐格色对账(红/绿/蓝/黄)",
      px1.every((p) => p.exists && p.ok),
      px1.map((p) => `${p.file}:${p.exists ? `${p.size[0]}x${p.size[1]}@${p.center_px}` : "缺失"}`).join(" ; "));
  }
  await sleep(1000);

  // ══ ② 截帧回灌 ══
  const opened2 = await loadGraph(page, "fire0929-冒烟-截帧回灌", GRAB_GRAPH);
  check("② 工作流载入(前端 loadGraphData,临时图)", opened2 === "opened", String(opened2));
  await sleep(1500);
  const rVid = await setWidget(page, "LoadVideo", "file", "fire0929_video8f.mp4");
  const rStrat = await setWidget(page, "MyVideoFrameGrab", "strategy", "均匀 · 等距N帧");
  const rCnt = await setWidget(page, "MyVideoFrameGrab", "frame_count", 4);
  const rPfx2 = await setWidget(page, "MyVideoFrameGrab", "filename_prefix", "fire0929b_frames");
  check("② 画布设值: LoadVideo=fire0929_video8f.mp4", String(rVid).startsWith("set:"), String(rVid).slice(0, 120));
  check("② 画布设值: 均匀/4帧/prefix=fire0929_frames", [rStrat, rCnt, rPfx2].every((r) => String(r).startsWith("set:")),
    [rStrat, rCnt, rPfx2].map(String).join(" | ").slice(0, 240));
  const dry2 = await promptDigest(page, "MyVideoFrameGrab", ["strategy", "frame_count", "filename_prefix"]);
  check("② 干跑: graphToPrompt 队列图含 MyVideoFrameGrab", String(dry2).includes("MyVideoFrameGrab") && !String(dry2).startsWith("graphToPrompt-err"), String(dry2).slice(0, 200));

  const known2 = await historyPids();
  await sleep(800);
  const q2 = await queuePrompt(page);
  check("② queuePrompt 发出(真前端)", q2 === "queued", String(q2));
  const h2 = await waitNewHistory(known2, { timeout: 120_000 });
  if (h2.error) {
    check("② 引擎执行完成", false, h2.error.slice(0, 3000));
  } else {
    check("② 引擎执行完成", true, `pid=${String(h2.pid).slice(0, 8)} status=${h2.status}`);
    const inputImgs2 = [];
    for (const o of Object.values(h2.entry.outputs || {})) if (o.images) inputImgs2.push(...o.images.filter((i) => i.type === "input" && /\.png$/i.test(i.filename)));
    check("② history outputs 含 type=input 回灌帧(ui.images)", inputImgs2.length === 4,
      JSON.stringify(inputImgs2.map((i) => i.filename)));
    // 均匀 4/8 → 帧号 0,2,5,7。素材经 cv2 VideoWriter 写入=按 BGR 落盘:
    // 调色板 RGB(255,0,0)/(0,0,255)/(0,255,255)/(255,128,0) 在文件里呈现为
    // BGR 通道序 → PIL 按 RGB 读回=蓝/红/黄/azure(mp4 有损,tol 60)
    const frameFiles = ["fire0929b_frames_00001_f00000.png", "fire0929b_frames_00001_f00002.png", "fire0929b_frames_00001_f00005.png", "fire0929b_frames_00001_f00007.png"];
    const frameExpect = [[64, 48, [0, 0, 255], 60], [64, 48, [255, 0, 0], 60], [64, 48, [255, 255, 0], 60], [64, 48, [0, 128, 255], 60]];
    const px2 = await pixelCheck(frameFiles, frameExpect);
    check("② input 目录 4 张帧图存在+尺寸 64×48+帧号(0/2/5/7)色对账(红/蓝/青/橙)",
      px2.every((p) => p.exists && p.ok),
      px2.map((p) => `${p.file}:${p.exists ? `${p.size[0]}x${p.size[1]}@${p.center_px}Δ${p.maxdiff}` : "缺失"}`).join(" ; "));
  }

  // console 留存与汇总
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(OUT_DIR, "fire0929-smoke-console.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  writeFileSync(join(OUT_DIR, "fire0929-smoke-report.json"), JSON.stringify({ results, consoleErrors }, null, 2));

  page.close();
  killChrome();
  log("════ 冒烟汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 200)}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟失败:", e.message);
  killChrome();
  process.exit(1);
});
