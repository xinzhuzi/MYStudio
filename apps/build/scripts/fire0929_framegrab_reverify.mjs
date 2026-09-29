#!/usr/bin/env node
/**
 * 实弹验收 0929 复验 — 仅「节点冒烟-截帧」条目重打:
 * 上轮 64×48 纯色帧 PNG 仅 158 字节,被编排核验以「产物过小」驳回(节点行为本身全绿)。
 * 本轮换 512×384 噪声+梯度八帧视频(帧 PNG 自带熵,几十 KB 级),真前端重跑同一节点:
 *   LoadVideo(fire0929c_video8f.mp4) → MyVideoFrameGrab(均匀/4 帧/prefix=fire0929c_frames)
 *   → 断言 input 恰出 f00000/f00002/f00005/f00007,尺寸 512×384,均色贴基色,单帧 ≥20KB。
 * 铁律:真前端 queuePrompt;history 3s 短轮询;引擎生命周期在驱动外管理。
 * 用法:node apps/build/scripts/fire0929_framegrab_reverify.mjs;退出码 0=全绿。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17001";
const CDP_PORT = Number(process.env.CDP_PORT || 9374);
const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/fire0929-reverify-chrome-profile";
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const INPUT_DIR = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/input`;
const VIDEO = "fire0929c_video8f.mp4";
const PREFIX = process.env.FRAME_PREFIX || "fire0929d_frames";

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

const GRAB_GRAPH = {
  id: "fire0929c-reverify-framegrab",
  nodes: [
    { id: 1, type: "LoadVideo", pos: [80, 200], size: [320, 320], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [1] }],
      properties: { "Node name for S&R": "LoadVideo" },
      widgets_values: [VIDEO] },
    { id: 2, type: "MyVideoFrameGrab", pos: [520, 200], size: [340, 300], flags: {}, order: 1, mode: 0,
      inputs: [{ name: "video", type: "VIDEO", link: 1 }],
      outputs: [{ name: "input_names", type: "STRING", links: null }],
      properties: { "Node name for S&R": "MyVideoFrameGrab" },
      widgets_values: ["均匀 · 等距N帧", 4, PREFIX] },
  ],
  links: [[1, 1, 0, 2, 0, "VIDEO"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

async function frameAssert() {
  // 均匀 4/8 → 帧号 0,2,5,7;素材=cv2 按 BGR 落盘(调色板索引 0/2/5/7 的 RGB 期望=蓝/红/黄/azure)
  // 期望=基色+素材水平梯度中点(+30/2=15;素材=cv2 按 BGR 落盘,索引 0/2/5/7 的 RGB 期望=蓝/红/黄/azure)
  const files = ["f00000", "f00002", "f00005", "f00007"].map((s) => `${PREFIX}_00001_${s}.png`);
  const g = 15;
  const expect = [[512, 384, [g, g, 255], 10], [512, 384, [255, g, g], 10], [512, 384, [255, 255, g], 10], [512, 384, [g, 128 + g / 2, 255], 10]];
  const { stdout } = await execFileP(VENV_PY, ["-c", `
import json, sys, os
from PIL import Image
import numpy as np
files = json.loads(sys.argv[1]); expect = json.loads(sys.argv[2])
base = ${JSON.stringify(INPUT_DIR)}
out = []
for rel, (w, h, rgb, tol) in zip(files, expect):
    p = os.path.join(base, rel)
    if not os.path.exists(p):
        out.append({"file": rel, "exists": False}); continue
    im = Image.open(p).convert("RGB")
    arr = np.asarray(im, dtype=np.float32)
    mean = arr.reshape(-1, 3).mean(axis=0)
    mdiff = int(np.abs(mean - np.array(rgb)).max())
    size = os.path.getsize(p)
    out.append({"file": rel, "exists": True, "dims": im.size, "bytes": size,
                "mean_rgb": [round(float(x), 1) for x in mean], "maxdiff": mdiff,
                "ok": im.size == (w, h) and mdiff <= tol and size >= 20000})
print(json.dumps(out))
`, JSON.stringify(files), JSON.stringify(expect)]);
  return JSON.parse(stdout);
}

async function main() {
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }
  const oi = await (await fetch(`${ENGINE}/object_info/MyVideoFrameGrab`)).json();
  check("复验前置: MyVideoFrameGrab 在册", "MyVideoFrameGrab" in oi, `category=${oi.MyVideoFrameGrab?.category}`);
  const lv = await (await fetch(`${ENGINE}/object_info/LoadVideo`)).json();
  const lvOpts = lv.LoadVideo?.input?.required?.file?.[1]?.options || [];
  check("复验前置: LoadVideo combo 含测试视频", lvOpts.includes(VIDEO), JSON.stringify(lvOpts));

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(GRAB_GRAPH)}, true, true, 'fire0929c-复验-截帧回灌');
    return 'opened';
  })()`);
  check("工作流载入(前端 loadGraphData,临时小图)", opened === "opened", String(opened));
  await sleep(1500);
  const setW = async (type, wname, value) => page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)});
    if (!n) return 'node-missing:' + ${JSON.stringify(type)};
    const w = (n.widgets || []).find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + (n.widgets || []).map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) {}
    return 'set:' + w.name + '=' + String(w.value);
  })()`);
  const rVid = await setW("LoadVideo", "file", VIDEO);
  const rStrat = await setW("MyVideoFrameGrab", "strategy", "均匀 · 等距N帧");
  const rCnt = await setW("MyVideoFrameGrab", "frame_count", 4);
  const rPfx = await setW("MyVideoFrameGrab", "filename_prefix", PREFIX);
  check("画布设值: LoadVideo/均匀/4帧/prefix", [rVid, rStrat, rCnt, rPfx].every((r) => String(r).startsWith("set:")),
    [rVid, rStrat, rCnt, rPfx].map(String).join(" | ").slice(0, 260));
  const dry = await page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const hit = Object.values(p.output || {}).find(n => n.class_type === 'MyVideoFrameGrab');
      return JSON.stringify(hit || 'not-found');
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("干跑: 队列图含 MyVideoFrameGrab(均匀/4/prefix)", String(dry).includes("MyVideoFrameGrab") && String(dry).includes(PREFIX), String(dry).slice(0, 200));

  const known = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await sleep(800);
  const q = await page.ev(`(async () => {
    const app = window.app;
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check("queuePrompt 发出(真前端)", q === "queued", String(q));

  const t0 = Date.now();
  let hist = null;
  while (Date.now() - t0 < 120_000) {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    for (const [pid, e] of Object.entries(h)) {
      if (known.has(pid)) continue;
      const st = e.status?.status_str || "";
      if (st === "error") { hist = { pid, error: JSON.stringify(e.status?.messages || []).slice(0, 6000) }; }
      else if (st === "success" || e.status?.completed) { hist = { pid, entry: e, status: st }; }
      if (hist) break;
    }
    if (hist) break;
    await sleep(3000);
  }
  if (!hist) { check("引擎执行完成", false, "120s 超时"); }
  else if (hist.error) { check("引擎执行完成", false, String(hist.error).slice(0, 3000)); }
  else {
    check("引擎执行完成", true, `pid=${String(hist.pid).slice(0, 8)} status=${hist.status} 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const inputImgs = [];
    for (const o of Object.values(hist.entry.outputs || {})) if (o.images) inputImgs.push(...o.images.filter((i) => i.type === "input" && /\.png$/i.test(i.filename)));
    check("history outputs 含 4 条 type=input 回灌帧", inputImgs.length === 4, JSON.stringify(inputImgs.map((i) => i.filename)));
    const px = await frameAssert();
    const sizes = px.map((p) => `${p.file}:${p.exists ? `${p.dims[0]}x${p.dims[1]}@${p.bytes}B,mean=${p.mean_rgb},Δ${p.maxdiff}` : "缺失"}`).join(" ; ");
    check("input 4 帧存在+512×384+均色贴基色+单帧≥20KB", px.length === 4 && px.every((p) => p.exists && p.ok), sizes);
    writeFileSync(join(OUT_DIR, "fire0929-framegrab-reverify-report.json"), JSON.stringify({ results, frames: px }, null, 2));
  }

  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0, phaseErrs.length ? `${phaseErrs.length} 条` : "0 条");
  page.close();
  killChrome();
  log("════ 复验汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 220)}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => { console.error("复验失败:", e.message); killChrome(); process.exit(1); });
