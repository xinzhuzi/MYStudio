#!/usr/bin/env node
/**
 * 实弹验收 0929 — Q2-1 i2i/edit 默认档真前端出图(各一发)v2:
 *   v1 教训(留档):①运行时节 id 为字符串,按数字寻址 node-missing;
 *   ②i2i 外层[40] widgets_values 首段为连链输入「指令」的 stale 值 → loadGraphData
 *   后三 widget 按位右移(型选择=指令文/RGBA=人物/PE=false),须画布层拨回文件本意
 *   (型选择=人物、RGBA=false、PE=true;指令走外链 22 号 PrimitiveStringMultiline 本就完好)。
 *   ③前端 graphToPrompt 含懒支路全集(静态可达),懒执行铁证以引擎日志加载行为准
 *   (viggle/Fun-Acc LoRA 零加载行 + tqdm 40/40);服务端排队图(prompt[2])另路取证如实报。
 *   产物落 apps/output/(绝不落 apps/out)。
 * 用法:node apps/build/scripts/fire0929_i2i_edit.mjs;退出码 0=全绿 1=有失败 2=环境错。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17001";
const CDP_PORT = Number(process.env.CDP_PORT || 9372);
const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/fire0929-live-chrome-profile";
const ENGINE_LOG = `${OUT_DIR}/fire0929-engine.log`;
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_800_000); // 30 min/张预算
const REF_IMG = "q21-0929-9号概念气氛图_PE开路_40步_seed0.png";
const INSTRUCTION = "Put the light blue denim shirt from <image2> on the character in <image1>, keep everything else unchanged";

// 单发模式:SHOT=i2i|edit 只跑该发(引擎 MPS 分配器跨拍累积 OOM 后,一发一干净引擎重试)
const ONLY = process.env.SHOT || "";
const SHOTS_ALL = [
  {
    key: "i2i",
    wf: `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
    nodeCount: 27,
    outPath: `${OUT_DIR}/q21-0929-道劫i2i_默认直出40步_PE开_实弹.png`,
    serverGraph: `${OUT_DIR}/fire0929-i2i-server-prompt.json`,
    logSlice: `${OUT_DIR}/fire0929-i2i-engine-slice.log`,
    hasSubgraph: true,
  },
  {
    key: "edit",
    wf: `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
    nodeCount: 33,
    outPath: `${OUT_DIR}/q21-0929-edit_默认直出40步_PE开_实弹.png`,
    serverGraph: `${OUT_DIR}/fire0929-edit-server-prompt.json`,
    logSlice: `${OUT_DIR}/fire0929-edit-engine-slice.log`,
    hasSubgraph: false,
  },
];
const SHOTS = ONLY ? SHOTS_ALL.filter((s) => s.key === ONLY) : SHOTS_ALL;
if (!SHOTS.length) { console.error("SHOT 过滤后为空:", ONLY); process.exit(2); }

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

async function loadWorkflow(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 按 type 找全部节点(节 id 为字符串,勿按数字寻址)。 */
function setWidgetOnAll(page, type, wname, value) {
  return page.ev(`(() => {
    const ns = window.app.graph._nodes.filter(n => n.type === ${JSON.stringify(type)});
    if (!ns.length) return 'node-missing:' + ${JSON.stringify(type)};
    const rs = [];
    for (const n of ns) {
      if (!n.widgets) { rs.push('no-widgets'); continue; }
      const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
      if (!w) { rs.push('widget-missing:' + n.widgets.map(x => x.name).join(',')); continue; }
      w.value = ${JSON.stringify(value)};
      try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
      rs.push('set:' + String(w.value).slice(0, 50));
    }
    return rs.join(' | ');
  })()`);
}

function readWidgetOnFirst(page, type, wname) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)});
    if (!n) return 'node-missing:' + ${JSON.stringify(type)};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    return JSON.stringify({ name: w.name, value: typeof w.value === 'string' ? w.value.slice(0, 60) : w.value });
  })()`);
}

function setWidgetById(page, nodeId, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === ${JSON.stringify(String(nodeId))});
    if (!n) return 'node-missing:' + ${JSON.stringify(String(nodeId))};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:' + String(w.value).slice(0, 60);
  })()`);
}

function readWidgetById(page, nodeId, wname) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === ${JSON.stringify(String(nodeId))});
    if (!n) return 'node-missing:' + ${JSON.stringify(String(nodeId))};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    return JSON.stringify({ name: w.name, value: typeof w.value === 'string' ? w.value.slice(0, 60) : w.value });
  })()`);
}

function fullPromptGraph(page) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      return JSON.stringify(p.output);
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
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

async function waitNewHistory(knownPids, { timeout } = {}) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 12000)}` };
        }
        if (st === "success" || e.status?.completed) {
          return { pid, entry: e, status: st };
        }
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

/** 排队后趁执行期抓服务端排队图(/queue running 拍的 prompt[2])。 */
async function captureServerPrompt(knownPids, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const qs = await (await fetch(`${ENGINE}/queue`)).json();
      for (const q of [...(qs.queue_running || []), ...(qs.queue_pending || [])]) {
        const pid = Array.isArray(q) ? q[1] : q?.promptId ?? q?.prompt_id;
        if (pid && !knownPids.has(pid)) {
          const data = Array.isArray(q) ? q[2] : q?.prompt?.[2];
          if (data) return { pid, data };
        }
      }
    } catch { /* 尽力 */ }
    await sleep(2000);
  }
  return null;
}

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf;
}

function pngMagic(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
    return { w: Number(w), h: Number(h) };
  } catch (e) { return { err: String(e.message) }; }
}

function engineLogSlice(startOffset) {
  const fd = readFileSync(ENGINE_LOG);
  return { text: fd.subarray(startOffset, fd.length).toString("utf8") };
}

const firstLines = (arr, n = 2) => arr.slice(0, n).map((l) => l.trim().slice(0, 150)).join(" ; ") || "(无)";

async function runShot(page, shot) {
  const tag = shot.key;
  const graphJson = JSON.parse(readFileSync(shot.wf, "utf8"));
  const sgType = graphJson.definitions?.subgraphs?.[0]?.id || "";
  log(`──── ${tag}:载入 ${shot.wf.split("/").pop()} ────`);
  const opened = await loadWorkflow(page, `fire0929-${tag}-实弹`, graphJson);
  check(`${tag}: 工作流载入(前端 loadGraphData,仓库真源)`, opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${shot.nodeCount} ? ${shot.nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${shot.nodeCount} 节点)` });
  await sleep(1500);

  // 参考图:REFS=one(默认)仅 image_1 槽([4])选参考图,[5] 保持文件默认(双 4.4MP 同图
  // 曾把 MPS 顶到 182.6GiB OOM;单数「参考图」口径+工作流双槽语义=image_1 为参考);
  // REFS=both 双槽都选。
  const REFS_MODE = process.env.REFS || "one";
  let rImg;
  if (REFS_MODE === "both") {
    rImg = await setWidgetOnAll(page, "LoadImage", "image", REF_IMG);
  } else {
    rImg = await setWidgetById(page, "4", "image", REF_IMG);
  }
  check(`${tag}: 画布 LoadImage 选参考图(REFS=${REFS_MODE})`, !String(rImg).includes("missing") && String(rImg).split(" | ").every((x) => x.startsWith("set:")), String(rImg).slice(0, 240));

  // 诊断模式:CACHE=off 把 [7] QwenImage21Cache device 拨 'off'(其余全默认)。
  // 背景:i2i/edit 默认态三连 OOM(182.6-182.8GiB @ ~25步),差分铁证=t2i(无此件)
  // 同机同负载成功;判别实验=关缓存跑通即坐实根因。
  const CACHE_MODE = process.env.CACHE || "";
  if (CACHE_MODE === "off") {
    const rc = await setWidgetById(page, "7", "device", "off");
    check(`${tag}: 诊断=[7] QwenImage21Cache device=off(其余默认)`, String(rc).startsWith("set:off") || String(rc).includes("set:off"), String(rc).slice(0, 120));
  }

  // 默认档位:只读不改
  const modeR = await readWidgetOnFirst(page, "MyQi21SpeedSelect", "mode");
  check(`${tag}: MyQi21SpeedSelect 默认档=0 · 直出40步(未切)`, String(modeR).includes("0 · 直出40步"), String(modeR).slice(0, 160));

  if (shot.hasSubgraph) {
    // 文件缺陷修复(画布层):外层[40] widgets_values 首段=连链「指令」的 stale 值 → 三 widget 右移。
    // 拨回文件本意:型选择=人物、RGBA=false、PE=true(指令走外链 22 号,无需 widget)。
    const rBase = await page.ev(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
      if (!n) return 'node-missing';
      const out = [];
      for (const [name, value] of [['型选择', '人物'], ['RGBA透明开关', false], ['PE开关', true]]) {
        const w = (n.widgets || []).find(w => String(w.name) === name);
        if (!w) { out.push('widget-missing:' + name); continue; }
        w.value = value;
        try { w.callback && w.callback(w.value); } catch (e) {}
        out.push(name + '=' + String(w.value));
      }
      return out.join(',');
    })()`);
    check(`${tag}: 画布修复[40]三 widget=型选择人物/RGBA false/PE true(文件 widgets_values 右移缺陷)`,
      String(rBase) === "型选择=人物,RGBA透明开关=false,PE开关=true", String(rBase).slice(0, 200));
    const r22 = await readWidgetById(page, "22", "value");
    check(`${tag}: 外图[22] 指令 PrimitiveStringMultiline 在链(指令真源)`, String(r22).startsWith("{") && String(r22).includes(INSTRUCTION.slice(0, 20)), String(r22).slice(0, 200));
  } else {
    const peR = await readWidgetById(page, "15", "switch");
    check(`${tag}: [15] PE 开关 默认=true(未切)`, String(peR).includes("true"), String(peR).slice(0, 160));
  }
  await sleep(900);

  // 干跑:全量图(前端静态可达集,含懒支路;记录为上下文)
  const dryGraph = String(await fullPromptGraph(page));
  check(`${tag}: 干跑 graphToPrompt 无异常`, !dryGraph.startsWith("graphToPrompt-err"), dryGraph.slice(0, 200));
  let dry = {};
  try { dry = JSON.parse(dryGraph); } catch { /* keep {} */ }
  const dryBase = Object.entries(dry).filter(([, n]) => n.class_type === "MyQi21DaojieBase").map(([, n]) => n.inputs.base);
  if (shot.hasSubgraph) {
    check(`${tag}: 干跑图 MyQi21DaojieBase.base=人物(修复生效)`, dryBase.length === 1 && dryBase[0] === "人物", JSON.stringify(dryBase));
    // PE 开关(内 15):on_true 指向 RegexExtract 产物的开关须为 true
    const peSw = Object.entries(dry).filter(([k, n]) => n.class_type === "ComfySwitchNode" && JSON.stringify(n.inputs.on_true || "").includes(":27"));
    check(`${tag}: 干跑图 子图 PE 开关(→RegexExtract)=true`, peSw.length === 1 && peSw[0][1].inputs.switch === true, JSON.stringify(peSw.map(([, n]) => n.inputs.switch)));
  }
  const dryLoadImages = Object.entries(dry).filter(([, n]) => n.class_type === "LoadImage").map(([, n]) => n.inputs.image);
  const refOk = REFS_MODE === "both"
    ? dryLoadImages.length === 2 && dryLoadImages.every((i) => i === REF_IMG)
    : dryLoadImages.length === 2 && dryLoadImages[0] === REF_IMG;
  check(`${tag}: 干跑图 参考图就位(REFS=${REFS_MODE})`, refOk, JSON.stringify(dryLoadImages).slice(0, 220));
  const heretic = Object.entries(dry).filter(([, n]) => n.class_type === "CLIPLoader" && String(n.inputs.clip_name).includes("heretic"));
  const peClip = Object.entries(dry).filter(([, n]) => n.class_type === "CLIPLoader" && String(n.inputs.clip_name).includes("pe_i2i"));
  check(`${tag}: 干跑图 heretic TE+PE TE 可达`, heretic.length >= 1 && peClip.length >= 1,
    JSON.stringify([...heretic, ...peClip].map(([, n]) => n.inputs.clip_name)));

  // 排队(真前端)+ 服务端排队图 + 引擎日志切片
  const logOffsetBefore = statSync(ENGINE_LOG).size;
  const known = await historyPids();
  await sleep(800);
  const t0 = Date.now();
  const q = await queuePrompt(page);
  check(`${tag}: queuePrompt 发出(真前端)`, q === "queued", String(q));
  const serverCap = await captureServerPrompt(known, 120_000);
  const h = await waitNewHistory(known, { timeout: GEN_TIMEOUT });
  const wallSecs = ((Date.now() - t0) / 1000).toFixed(0);
  if (h.error) {
    check(`${tag}: 引擎执行完成`, false, h.error.slice(0, 6000));
    return { tag, fatal: h.error };
  }
  check(`${tag}: 引擎执行完成`, true, `pid=${String(h.pid).slice(0, 8)} status=${h.status} 排队→完成 ${wallSecs}s`);

  // 服务端排队图(懒执行执行集的第一手:如实记录内容形态)
  const serverData = serverCap?.data || h.entry.prompt?.[2] || null;
  if (serverData) writeFileSync(shot.serverGraph, JSON.stringify(serverData, null, 2));
  const serverBlob = JSON.stringify(serverData || {});
  const serverSteps = [...serverBlob.matchAll(/"steps":\s*(\d+)/g)].map((m) => Number(m[1]));
  const serverHasT8 = /T8QwenImage21FunAcc/.test(serverBlob);
  const serverHasViggleLora = /LoraLoaderModelOnly[^}]*viggle/.test(serverBlob) || (/"lora_name"\s*:\s*"[^"]*viggle[^"]*"/.test(serverBlob));
  check(`${tag}: 服务端排队图=直出 KSampler 40 步在链`, serverSteps.includes(40), `steps=[${serverSteps.join(",")}]`);
  check(`${tag}: 服务端排队图懒支路形态(T8/viggle LoRA 是否在图,如实取证)`, true,
    `T8在图=${serverHasT8};viggleLoRA在图=${serverHasViggleLora}(执行侧铁证见日志断言)`);

  // 引擎日志切片:加载行 + tqdm + Prompt executed
  const slice = engineLogSlice(logOffsetBefore);
  writeFileSync(shot.logSlice, slice.text);
  const lines = slice.text.split("\n");
  const clean = (l) => l.replace(/\x1b\[[0-9;]*m/g, "");
  // 权重加载行实测形态:「Model storage policy: … paths=['…model.safetensors']」;
  // 排除 [MY出图] 侧车摘要(静态全图枚举,含未选支路件名)与 custom_nodes 插件导入行。
  const loadLines = lines.map(clean).filter((l) => /\.safetensors|\.gguf/i.test(l) && !/\[MY出图\]/.test(l) && !/custom_nodes/.test(l));
  const hereticLoad = loadLines.filter((l) => /heretic/i.test(l));
  const peLoad = loadLines.filter((l) => /pe_i2i/i.test(l));
  const ditLoad = loadLines.filter((l) => /qwen_image_2\.1_bf16/i.test(l));
  const viggleLoad = loadLines.filter((l) => /viggle/i.test(l));
  const funAccLoad = loadLines.filter((l) => /Fun-Acc/i.test(l));
  const tqdm40 = lines.map(clean).filter((l) => /\b40\/40\b/.test(l));
  const executedLines = lines.map(clean).filter((l) => /Prompt executed in/.test(l));
  check(`${tag}: 日志=heretic TE 加载行`, hereticLoad.length >= 1, firstLines(hereticLoad));
  check(`${tag}: 日志=PE TE(pe_i2i)加载行`, peLoad.length >= 1, firstLines(peLoad));
  check(`${tag}: 日志=Q2-1 DiT(qwen_image_2.1_bf16)加载行`, ditLoad.length >= 1, firstLines(ditLoad));
  check(`${tag}: 懒执行铁证=引擎日志 viggle LoRA 零加载`, viggleLoad.length === 0, firstLines(viggleLoad, 3));
  check(`${tag}: 懒执行铁证=引擎日志 Fun-Acc LoRA 零加载`, funAccLoad.length === 0, firstLines(funAccLoad, 3));
  check(`${tag}: 日志=采样进度 40/40(直出 40 步实跑)`, tqdm40.length >= 1, firstLines(tqdm40));
  check(`${tag}: 日志=Prompt executed 行(每张)`, executedLines.length >= 1, executedLines.map((l) => l.trim()).join(" | ").slice(0, 300));

  // 产物:/view 取回 → apps/output
  const imgs = [];
  for (const o of Object.values(h.entry.outputs || {})) if (o.images) imgs.push(...o.images.filter((i) => (i.type || "output") === "output"));
  if (!imgs.length) {
    check(`${tag}: 引擎出图`, false, "history outputs 无 output 图");
    return { tag, fatal: "no-output-images" };
  }
  const saveImg = imgs.find((i) => /\.png$/i.test(i.filename)) || imgs[0];
  const finalOutPath = CACHE_MODE === "off" ? shot.outPath.replace("_实弹.png", "_cache-off诊断_实弹.png") : shot.outPath;
  const buf = await fetchView(saveImg, finalOutPath);
  const magic = pngMagic(buf);
  const size = await sipsSize(finalOutPath);
  check(`${tag}: PNG 魔数+产物落 apps/output`, magic === true && buf.length > 50_000,
    `${saveImg.filename} → ${finalOutPath} (${(buf.length / 1024 / 1024).toFixed(1)}MB, sips=${size.w}x${size.h}, ${wallSecs}s, pid=${String(h.pid).slice(0, 8)})`);
  return { tag, pid: h.pid, outPath: shot.outPath, wallSecs, engineFile: saveImg.filename, size, serverSteps, serverHasT8, serverHasViggleLora };
}

async function main() {
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }
  for (const s of SHOTS) if (!existsSync(s.wf)) { console.error("工作流缺失:", s.wf); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const shots = [];
  for (const s of SHOTS) shots.push(await runShot(page, s));

  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(OUT_DIR, "fire0929-live-console.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  writeFileSync(join(OUT_DIR, "fire0929-live-report.json"), JSON.stringify({ results, shots, consoleErrors }, null, 2));

  page.close();
  killChrome();
  log("════ 实弹汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 260)}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error("实弹失败:", e.message);
  killChrome();
  process.exit(1);
});
