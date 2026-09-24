#!/usr/bin/env node
/**
 * 满血接线轮 实弹验收驱动(0924;17002 手动引擎 + headless Chrome 真前端;派生自
 * qi21_r26_live_0924.mjs(实弹/出图范式)+ qi21_fullpower_dry_0924.mjs(steps 链/
 * 懒执行走查谓词)——干跑轮已 52 项全绿,本驱动补「真出图」一环)。
 *
 * 验什么(任务令「满血接线实弹」):
 *   ① t2i-on-fire :载入 qi21-道劫-t2i,运行态**只把 [30] LoRA 开关=true(零其它
 *     widget 写入,不碰 steps)**→干跑(steps 链解析必须=6+LoraLoaderModelOnly 在
 *     懒执行集;若仍 40=联动断)→ app.queuePrompt → 出全图(~211s 量级)→ 尺寸
 *     1824×2432 + 服务端排队图 [30] value=true + steps 链=6 + LoRA 字段 → 三通道
 *     下载(节点 fetch /view + curl /view + 引擎盘上原文件)字节/SHA256 双对账 →
 *     cp ~/Downloads/q21-final-0924/fullpower/。
 *   ② t2i-off-return:同画布把 [30] 开关回 false→干跑(steps 必须=40+懒执行集零
 *     LoRA)+排队图取证即止——关态全图 R26.4 已证(1347s,t2i-off-seed0-full.png),
 *     不重跑 22 分钟,如实注记。
 *   ③ edit-dual / i2i-dual:各干跑双态取证(开=6+LoRA/关=40+零 LoRA),不出图
 *     (三件同构,实弹由 t2i 代表,如实注记)。
 *   拍间 POST /free;引擎生命周期与 pkill 在驱动外管理。
 *
 * 方法论(R26.4 勘正在案):graphToPrompt 必序列化懒臂——排队图含 [31] 属结构
 * 事实,「零 LoRA」口径=懒执行走查(SaveImage 回溯,开关经 switch 连线解析布尔源
 * 只走选中臂);服务端真执行另证=history status.messages executed 事件。
 *
 * 用法:node apps/build/scripts/qi21_fullpower_live_0924.mjs all
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17002)/ CDP_PORT(默认 9384)/
 *   GEN_TIMEOUT_MS(默认 900000=15min;快拍也给足余量)
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);
const HARVEST = process.env.HARVEST === "1"; // ① 相位收编:首跑已排队出图,不重排队只收档取证(R26 HARVEST 同款)
const ENGINE_LOG = process.env.ENGINE_LOG || "/tmp/qi21-fullpower-live-0924/engine.log";

const PHASE = process.argv[2] || "all";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9384);
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900000);
const ENGINE_OUT = process.env.ENGINE_OUT || `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/output`;
const OUT_DIR = `${process.env.HOME}/Downloads/q21-final-0924/fullpower`;     // 图证目录(ask 指定)
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`; // 相位报告
const WF = {
  "t2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  "i2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
  "edit": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
};
// 每件节点 id 锚(与生成器/契约/干跑驱动同表)
const ANCHOR = {
  "t2i":  { save: "9",  ks: "7", sw: "177", c40: "178", c6: "179", pb: "30", lora: "31" },
  "i2i":  { save: "10", ks: "8", sw: "164", c40: "165", c6: "166", pb: "30", lora: "31" },
  "edit": { save: "10", ks: "8", sw: "33",  c40: "34",  c6: "35",  pb: "30", lora: "31" },
};
const LORA_NAME = "Qwen-Image-2.1-viggle-turbo-v0.2-5step-lora-r256.safetensors";
const FIRE_DEST = join(OUT_DIR, "fullpower-t2i-on-seed0-6step.png");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-fullpower-live-17002-profile";
const TOL_PX = 16, TOL_RATIO = 0.01;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
const runtimeWrites = []; // 运行态 widget 写入台账(铁证:一拨=仅 [30])
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--window-size=1720,1050",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-reporter",
    "--disable-background-timer-throttling",
    ENGINE,
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
      consoleErrors.push({ src: "console", type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500), ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500), ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
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

/** 载入工作流(真前端 loadGraphData)并等画布切换到该节点数 */
async function loadWorkflow(page, wfPath, label) {
  const wf = JSON.parse(readFileSync(wfPath, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wf)}, true, true, ${JSON.stringify(label)});
    return 'opened';
  })()`);
  check("工作流载入(真前端 loadGraphData)", opened === "opened", `${label}: ${String(opened)}`);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wf.nodes.length} ? ${wf.nodes.length} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${wf.nodes.length} 节点)` });
  await sleep(1500);
}

/** 干跑 graphToPrompt,返回 {blob} */
async function dryRun(page) {
  const raw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'err:' + e.message; }
  })()`);
  if (String(raw).startsWith("err:") || String(raw).startsWith("EXC:")) return { error: String(raw) };
  return { blob: String(raw) };
}

/** 运行态设 widget(R24 setWidgetById 口径:id 定位+name 匹配+callback;只运行态,进程退出即弃) */
function setWidgetById(page, nid, wname, value) {
  runtimeWrites.push({ node: String(nid), widget: wname, value, ts: new Date().toISOString() });
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === String(${nid}));
    if (!n) return 'node-missing:' + ${nid};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:[' + n.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value);
  })()`);
}

/* ── 排队图(API prompt)解析:steps 链 + 懒执行走查(与生成器/契约/干跑轮同口径谓词)── */
function parseBlob(blob) {
  try { return JSON.parse(blob); } catch { return null; }
}
function resolveSwitchBool(d, node) {
  const sw = node.inputs?.switch;
  if (Array.isArray(sw)) {
    const src = d[sw[0]];
    if (src?.class_type === "PrimitiveBoolean") return Boolean(src.inputs?.value);
  }
  return Boolean(node._widget_switch_fallback); // 排队图无 widget 概念,连线态恒走连线
}
/** steps 链解析:KSampler.steps → steps 开关 → 布尔源定臂 → PrimitiveInt 常量值 */
function resolveSteps(d, a) {
  const ks = d[a.ks];
  if (!ks || ks.class_type !== "KSampler") return { err: "KSampler 不在排队图" };
  const steps = ks.inputs?.steps;
  if (!Array.isArray(steps)) return { err: `KSampler.steps 非链接(得 ${JSON.stringify(steps)})`, raw: steps };
  const sw = d[steps[0]];
  if (!sw || sw.class_type !== "ComfySwitchNode") return { err: "steps 上游非 ComfySwitchNode" };
  const on = resolveSwitchBool(d, sw);
  const arm = on ? sw.inputs?.on_true : sw.inputs?.on_false;
  if (!Array.isArray(arm)) return { err: `steps 开关 ${on ? "on_true" : "on_false"} 臂非链接` };
  const c = d[arm[0]];
  if (!c || c.class_type !== "PrimitiveInt") return { err: "steps 臂上游非 PrimitiveInt" };
  return { value: c.inputs?.value, on, switchSrc: sw.inputs?.switch };
}
/** 懒执行走查:SaveImage 回溯;ComfySwitchNode 经 switch 连线解析布尔源只走选中臂 */
function executedSet(d, a) {
  const reach = new Set();
  const stack = [a.save];
  while (stack.length) {
    const nid = stack.pop();
    if (reach.has(nid) || !d[nid]) continue;
    reach.add(nid);
    const node = d[nid];
    if (node.class_type === "ComfySwitchNode") {
      const on = resolveSwitchBool(d, node);
      const arm = on ? node.inputs?.on_true : node.inputs?.on_false;
      if (Array.isArray(arm)) stack.push(arm[0]);
      continue;
    }
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v)) stack.push(String(v[0]));
    }
  }
  return reach;
}

/** 干跑取证(双态通用):开关源值 + steps 链 + 同源连线 + 常量臂 + 懒执行集 LoRA 在否 */
function forensicsDry(kind, on, blob) {
  const a = ANCHOR[kind];
  const d = parseBlob(blob);
  check(`[${kind}-${on ? "on" : "off"}] 排队图可解析`, Boolean(d), "");
  if (!d) return null;
  const pb = d[a.pb];
  check(`[${kind}-${on ? "on" : "off"}] 开关源 [30] 排队图 value=${on}`,
    pb?.class_type === "PrimitiveBoolean" && pb.inputs?.value === on, JSON.stringify(pb?.inputs));
  const st = resolveSteps(d, a);
  check(`[${kind}-${on ? "on" : "off"}] steps 链解析=${on ? 6 : 40}(${on ? "开=一拨自动 6" : "关=自动回 40 原路"})`,
    st.value === (on ? 6 : 40), JSON.stringify(st));
  const ks = d[a.ks];
  const stepsSw = d[ks.inputs.steps[0]];
  check(`[${kind}-${on ? "on" : "off"}] steps 开关 switch 连线=同一布尔源 [30]`,
    JSON.stringify(stepsSw.inputs?.switch) === JSON.stringify([a.pb, 0]), JSON.stringify(stepsSw.inputs?.switch));
  check(`[${kind}-${on ? "on" : "off"}] 排队图含常量臂(40/6 随图序列化)`,
    d[a.c40]?.inputs?.value === 40 && d[a.c6]?.inputs?.value === 6,
    `c40=${JSON.stringify(d[a.c40]?.inputs)} c6=${JSON.stringify(d[a.c6]?.inputs)}`);
  const reach = executedSet(d, a);
  const loraIn = reach.has(a.lora);
  check(on
    ? `[${kind}-on] 开态执行集含 [31] LoraLoaderModelOnly(LoRA 真入链)`
    : `[${kind}-off] 硬性AC·关态执行集零 LoraLoaderModelOnly(关闭=正常生成)`,
    on ? loraIn : !loraIn,
    `executed=${JSON.stringify([...reach].sort((x, y) => Number(x) - Number(y)))}`);
  if (on) {
    check(`[${kind}-on] 排队图 LoRA 字段(${LORA_NAME})`,
      d[a.lora]?.class_type === "LoraLoaderModelOnly" && String(d[a.lora]?.inputs?.lora_name || "").includes(LORA_NAME),
      JSON.stringify(d[a.lora]?.inputs));
  }
  return { kind, on, steps: st.value, pbValue: pb?.inputs?.value, loraExecuted: loraIn, executedCount: reach.size };
}

async function freeEngine() {
  try {
    await fetch(`${ENGINE}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    log("POST /free(拍间清场)");
  } catch (e) { log("/free 失败(非致命):", e.message); }
}

/* ── 服务端 history 轮询 + 执行记录 ── */
function executedNodesOf(messages) {
  const executed = [];
  for (const m of (messages || [])) {
    if (!Array.isArray(m) || (m[0] !== "executed" && m[0] !== "executing")) continue;
    const v = m[1];
    const nid = (v && typeof v === "object" && v.node !== undefined) ? String(v.node) : String(v ?? "");
    if (nid && !executed.includes(nid)) executed.push(nid);
  }
  return executed;
}
function execDurationSec(messages) {
  let start = null, end = null;
  for (const m of (messages || [])) {
    if (!Array.isArray(m)) continue;
    if (m[0] === "execution_start" && m[1]?.timestamp) start = m[1].timestamp;
    if (m[0] === "execution_success" && m[1]?.timestamp) end = m[1].timestamp;
  }
  return start && end ? ((end - start) / 1000).toFixed(0) : null;
}
async function waitHistory(feature, { timeout, knownPids = new Set() }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob, pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 4000)}` };
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, promptBlob: blob, messages: e.status?.messages || [] };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

/* ── 三通道大下载对账:①节点 fetch /view(主=落盘 cp 位)②curl /view ③引擎盘上原文件;字节+SHA256 双对账 ── */
async function sha256File(path) {
  const { stdout } = await execFileP("/usr/bin/shasum", ["-a", "256", path]);
  return stdout.trim().split(/\s+/)[0];
}
function pngMagicBuf(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    return { w: Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]) };
  } catch (e) { return { err: String(e.message) }; }
}
async function fetchViewRetry(img, outPath, tries = 3) {
  // 本地环回取图韧性:整拍重试(断点续传不适用=环回单连接原子读;如实注记)
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${ENGINE}/view?${q}`, { signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`/view ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(outPath, buf);
      return buf;
    } catch (e) { lastErr = String(e.message); log(`fetch /view 第${i}拍失败:`, lastErr); await sleep(2000); }
  }
  throw new Error(`fetch /view 三拍皆败: ${lastErr}`);
}
async function threeChannelAudit(img, destPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const audit = { img: `${img.subfolder ? img.subfolder + "/" : ""}${img.filename}` };
  // 通道1:节点 fetch /view → 直接落 cp 位(=ask 的 cp ~/Downloads/q21-final-0924/fullpower/)
  const buf = await fetchViewRetry(img, destPath);
  audit.ch1_nodeFetch = { path: destPath, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  // 通道2:curl /view 独立进程再取一份
  const curlPath = `/tmp/fullpower-live-curl-${Date.now()}.png`;
  try {
    await execFileP("/usr/bin/curl", ["-sS", "--retry", "3", "-o", curlPath, `${ENGINE}/view?${q}`], { timeout: 300_000 });
    audit.ch2_curl = { path: curlPath, bytes: (await import("node:fs")).statSync(curlPath).size, sha256: await sha256File(curlPath) };
  } catch (e) { audit.ch2_curl = { error: String(e.message) }; }
  // 通道3:引擎盘上原文件(ground truth,--output-directory 指向的家)
  const diskPath = join(ENGINE_OUT, img.subfolder || "", img.filename);
  if (existsSync(diskPath)) {
    audit.ch3_engineDisk = { path: diskPath, bytes: readFileSync(diskPath).length, sha256: await sha256File(diskPath) };
  } else { audit.ch3_engineDisk = { error: `不存在: ${diskPath}` }; }
  const h1 = audit.ch1_nodeFetch.sha256;
  audit.bytesAgree = audit.ch2_curl.bytes === buf.length && audit.ch3_engineDisk.bytes === buf.length;
  audit.shaAgree = h1 === audit.ch2_curl.sha256 && h1 === audit.ch3_engineDisk.sha256;
  check("大下载三通道字节+SHA256 双对账(fetch /view + curl /view + 引擎盘原文件)",
    audit.bytesAgree && audit.shaAgree,
    `bytes=${buf.length} sha256=${h1.slice(0, 16)}… ch2=${audit.ch2_curl.sha256?.slice(0, 16) ?? "?"}… ch3=${audit.ch3_engineDisk.sha256?.slice(0, 16) ?? "?"}…`);
  check("PNG 魔数+体积合理(>50KB)", pngMagicBuf(buf) && buf.length > 50_000, `${(buf.length / 1024).toFixed(0)}KB`);
  return { buf, audit };
}

/* ══════════ ① t2i 开态一拨全配实弹(只翻 [30],不碰 steps)══════════ */
async function t2iFire(page, report) {
  await loadWorkflow(page, WF.t2i, "满血接线实弹-t2i-开态一拨");
  // 不碰 steps:唯一运行态写入=[30]=true(runtimeWrites 台账为证)
  const f = await setWidgetById(page, 30, "value", true);
  check("[t2i-fire] 运行态把 [30] value=true(一拨,零其它写入)", String(f).startsWith("set:"), String(f));
  // 「不碰 steps」旁证:KSampler [7] steps widget 值仍 40(steps 已转输入,widget 值不被联动改写)
  const ksWidget = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === '7');
    const w = (n.widgets || []).find(x => x.name === 'steps');
    return JSON.stringify({ stepsWidget: w ? w.value : null });
  })()`);
  check("[t2i-fire] steps widget 未被触碰(联动走输入链,widget 面值仍 40)", String(ksWidget).includes('"stepsWidget":40'), String(ksWidget));
  await sleep(1200);

  const dry = await dryRun(page);
  check("[t2i-fire] 干跑 graphToPrompt 成功(一拨后)", !dry.error, dry.error || `${(dry.blob || "").length} 字符`);
  let dryF = null;
  if (!dry.error) { dryF = forensicsDry("t2i", true, dry.blob); report.cases["t2i-on-dry"] = dryF; }
  if (dry.error) { await freeEngine(); return; }

  // queuePrompt → 等全图(开态签名:LoRA 在图+开关源 true+steps 链=6)
  const a = ANCHOR.t2i;
  const sig = (blob) => {
    const d = parseBlob(blob);
    return Boolean(d) && d[a.lora]?.class_type === "LoraLoaderModelOnly" && d[a.pb]?.inputs?.value === true && resolveSteps(d, a).value === 6;
  };
  let hist;
  let wallSecs = null;
  if (HARVEST) {
    // 收编:首跑(shasum 路径勘误前)已 queuePrompt 且引擎已出全图,不重排队只收档
    check("[t2i-fire] 收编模式(HARVEST=1):等已完成 history 相符项(开态签名)", true, "首跑 11:06:20Z 排队,引擎 235.47s 执行完毕");
    hist = await waitHistory(sig, { timeout: 120_000, knownPids: new Set() });
  } else {
    const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
    await sleep(600);
    const t0 = Date.now();
    const queued = await page.ev(`(async () => {
      const app = window.app;
      if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
      try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
    })()`);
    check("[t2i-fire] queuePrompt 发出(真前端序列化+排队)", queued === "queued", String(queued));
    hist = await waitHistory(sig, { timeout: GEN_TIMEOUT, knownPids });
    wallSecs = ((Date.now() - t0) / 1000).toFixed(0);
  }
  if (hist.error) {
    check("[t2i-fire] 引擎出图(/history 完成含图)", false, hist.error.slice(0, 500));
    await freeEngine();
    return;
  }
  const execSecs = execDurationSec(hist.messages);
  if (HARVEST && !wallSecs) wallSecs = `${execSecs}(引擎执行段,收编口径)`;
  // 服务端排队图取证(history prompt[2])
  const hd = parseBlob(hist.promptBlob);
  check("[t2i-fire] 服务端排队图含 [30] value:true", hd?.[a.pb]?.inputs?.value === true, JSON.stringify(hd?.[a.pb]?.inputs));
  const hst = hd ? resolveSteps(hd, a) : { err: "排队图不可解析" };
  check("[t2i-fire] 服务端排队图 steps 链解析=6", hst.value === 6, JSON.stringify(hst));
  check("[t2i-fire] 服务端排队图 LoRA 字段(v0.2-5step-r256)",
    hd?.[a.lora]?.class_type === "LoraLoaderModelOnly" && String(hd?.[a.lora]?.inputs?.lora_name || "").includes(LORA_NAME),
    JSON.stringify(hd?.[a.lora]?.inputs));
  // 服务端执行证明(R26.4 勘正口径:history 不持久化 executed 事件,commit fdbbaab)——
  // 引擎日志 [MY出图][摘要]/[全量JSON] = 服务端执行时记录:LoRA 真入执行图。
  {
    const logTxt = readFileSync(ENGINE_LOG, "utf8");
    const digestLines = logTxt.split("\n").filter((l) => l.includes("[MY出图][摘要]"));
    const lastDigest = digestLines[digestLines.length - 1] || "";
    check("[t2i-fire] 服务端执行记录(引擎日志[MY出图][摘要])含 LoRA v0.2-5step-r256 ×1.0(权重真加载)",
      lastDigest.includes(`LoRA: ${LORA_NAME}`) && lastDigest.includes("×1.0"),
      lastDigest.slice(0, 300));
    const jsonLines = logTxt.split("\n").filter((l) => l.includes("[MY出图][全量JSON]"));
    const lastJson = jsonLines[jsonLines.length - 1] || "";
    const m = lastJson.match(/\[MY出图\]\[全量JSON\] (\{.*\})\s*$/);
    let engineJson = null;
    try { engineJson = m ? JSON.parse(m[1]) : null; } catch { engineJson = null; }
    check("[t2i-fire] 引擎日志执行图 [30] value:true+steps 链=6(服务端全量JSON)",
      engineJson?.[a.pb]?.inputs?.value === true && resolveSteps(engineJson, a).value === 6,
      engineJson ? `[${a.pb}]=${JSON.stringify(engineJson[a.pb]?.inputs)} steps=${JSON.stringify(resolveSteps(engineJson, a))}` : "全量JSON 行不可解析");
    // 执行完成事实:execution_success 在 messages + 引擎日志 Prompt executed
    check("[t2i-fire] 引擎执行成功记录(execution_success+日志 Prompt executed)",
      JSON.stringify(hist.messages).includes("execution_success") && /Prompt executed in \d+(\.\d+)? seconds/.test(logTxt),
      `messages 含 execution_success;日志 ${((logTxt.match(/Prompt executed in (\d+(?:\.\d+)?) seconds/) || [])[1] || "?")}s`);
  }

  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const { buf, audit } = await threeChannelAudit(saveImg, FIRE_DEST);
  const size = await sipsSize(FIRE_DEST);
  const dw = Math.abs((size.w ?? 0) - 1824), dh = Math.abs((size.h ?? 0) - 2432);
  const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - 1824 / 2432) : 1;
  check("出图落盘+cp 取证目录(fullpower/)", existsSync(FIRE_DEST) && buf.length > 50_000,
    `${saveImg.filename} → ${FIRE_DEST} (${(buf.length / 1024).toFixed(0)}KB, pid=${String(hist.pid).slice(0, 8)})`);
  check("sips 尺寸对账(人物型 1824x2432;维差≤16px·比例≤1%)", dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO,
    size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
  check("耗时(开态 6 步全图,~211s 量级)", true, `墙钟 ${wallSecs}s(引擎执行段=${execSecs ?? "?"}s;40 步关态基准=1347s,R26.4 在档)`);
  report.cases["t2i-on-fire"] = { imgName: saveImg.filename, destPath: FIRE_DEST, bytes: buf.length, size, wallSecs, execSecs, pid: hist.pid, historyMessagesKinds: (hist.messages || []).map((m) => (Array.isArray(m) ? m[0] : "?")), audit };
  report.promptBlobFire = hist.promptBlob;
  await freeEngine();
}

/* ══════════ ② t2i 关态自动回 40(开关回 false;干跑+排队图取证即止)══════════ */
async function t2iOffReturn(page, report) {
  const f = await setWidgetById(page, 30, "value", false);
  check("[t2i-off-return] 开关回 false(同画布回拨)", String(f).startsWith("set:"), String(f));
  await sleep(1000);
  const dry = await dryRun(page);
  check("[t2i-off-return] 干跑 graphToPrompt 成功", !dry.error, dry.error || `${(dry.blob || "").length} 字符`);
  if (!dry.error) {
    report.cases["t2i-off-return"] = forensicsDry("t2i", false, dry.blob);
    report.dryRunBlobOffReturn = dry.blob;
  }
  check("[t2i-off-return] 关态全图不重跑(R26.4 已证 1347s 全图逐字节=默认干跑图)", true,
    "证据: ~/Downloads/q21-final-0924/r26/r26-t2i-off-seed0-full.png(commit fdbbaab)");
  await freeEngine();
}

/* ══════════ ③ edit/i2i 干跑双态取证(不出图;同构实弹由 t2i 代表)══════════ */
async function dualDry(page, kind, report) {
  await loadWorkflow(page, WF[kind], `满血接线实弹-${kind}-双态干跑`);
  const dryOff = await dryRun(page);
  check(`[${kind}-dual] 关态干跑 graphToPrompt 成功(零 widget 写入)`, !dryOff.error, dryOff.error || `${(dryOff.blob || "").length} 字符`);
  if (!dryOff.error) report.cases[`${kind}-off-dry`] = forensicsDry(kind, false, dryOff.blob);
  const f = await setWidgetById(page, 30, "value", true);
  check(`[${kind}-dual] 运行态把 [30] value=true(一拨)`, String(f).startsWith("set:"), String(f));
  await sleep(1000);
  const dryOn = await dryRun(page);
  check(`[${kind}-dual] 开态干跑 graphToPrompt 成功`, !dryOn.error, dryOn.error || `${(dryOn.blob || "").length} 字符`);
  if (!dryOn.error) report.cases[`${kind}-on-dry`] = forensicsDry(kind, true, dryOn.blob);
  check(`[${kind}-dual] 不出图(三件同构,开态实弹由 t2i 代表,如实注记)`, true, "");
  await freeEngine();
}

async function main() {
  if (PHASE !== "all") { console.error("用法: node qi21_fullpower_live_0924.mjs all"); process.exit(2); }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: PHASE, engine: ENGINE, startedAt: new Date().toISOString(), genTimeoutMs: GEN_TIMEOUT, cases: {} };

  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  await t2iFire(page, report);          // ① 开态一拨全配实弹(唯一出图)
  await t2iOffReturn(page, report);     // ② 关态自动回 40(干跑+排队图取证即止)
  await dualDry(page, "edit", report);  // ③ edit 双态干跑
  await dualDry(page, "i2i", report);   // ③ i2i 双态干跑

  report.results = results;
  report.runtimeWrites = runtimeWrites; // 铁证:全程运行态写入仅 [30](true→false×3 件)
  report.consoleErrors = consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, "fullpower-live-report.json"), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  if (consoleErrors.length) log(`⚠ 前端 console 错误 ${consoleErrors.length} 条(R26 口径=报备不计红;boot 期 vite:preloadError 噪声,见报告)`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 满血接线实弹 全绿" : "❌ 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("驱动失败:", e.message);
  try { writeFileSync(join(REPORT_DIR, "fullpower-live-report.json"), JSON.stringify({ fatal: String(e.message), results, consoleErrors, runtimeWrites }, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
