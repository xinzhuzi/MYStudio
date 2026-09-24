#!/usr/bin/env node
/**
 * R26.4 实弹验收驱动 v2(0924;17002 手动引擎 + headless Chrome 真前端;派生自
 * qi21_weapon_fix_shot_0924.mjs / qi21_install_accept_17002_0924.mjs /
 * qi21_daojie_i2i_e2e_0924.mjs):
 * 硬性 AC(D1 用户令):加速槽「关闭=正常生成」——关态 MODEL 直连,OFF 态实弹
 * 必须出全图。
 *
 * 「零 LoraLoader」取证口径(v2 勘正):graphToPrompt 序列化整幅画布,懒执行臂
 * ([31] LoraLoaderModelOnly 接 [32] ComfySwitchNode.on_true,lazy:true)必然
 * 随图进排队 prompt——前端干跑图「零 LoraLoader」结构性不可能。正确的关态
 * 证明两级(R24 i2i e2e 同款):①排队图开关源 [30] PrimitiveBoolean 序列化
 * value=false(MODEL 直连指令态);②服务端懒执行记录(history status.messages
 * 的 executed/executing 事件)不含 [31] ——LoRA 节点未执行=权重未加载。
 *
 * 相位(子命令,一相一进程;引擎生命周期与拍间 POST /free 在驱动外管理):
 *   t2i-off  :载入 qi21-道劫-t2i,不碰任何开关(默认全关),干跑取证(开关源
 *             value=false+base=人物+武器部件句在场+否定式绝迹+steps=40)→
 *             app.queuePrompt → 等 40 步 4.2MP 全图(~22min)→ 服务端执行记录
 *             零 [31](硬性AC)→ 尺寸 1824×2432+PNG 魔数+耗时 → cp
 *             ~/Downloads/q21-final-0924/r26/r26-t2i-off-seed0-full.png。
 *             HARVEST_ONLY=1 时:不 queue,只重载干跑+等已完成 history 相符项
 *             (供驱动首跑排队(06:12)后被勘误重启的收编;排队图与新干跑逐字节
 *             对账=同一默认关态图)。
 *   t2i-on   :重载 t2i(干净态),运行态把 [30] value→true+KSampler [7] steps
 *             40→4(setWidgetById 口径;只运行态,进程退出即弃,不改仓库)→ 干跑
 *             (LoraLoaderModelOnly 入排队图+steps=4+开关源 value=true)→
 *             queuePrompt → 出图(~3min)→ 服务端执行记录含 [31](LoRA 真加载)
 *             +history 排队图取证 → cp r26-t2i-on-seed0-4step.png
 *   edit-off :载入 qwen21-edit(槽在场),开关默认关 → 干跑(开关源 value=false)
 *             → queuePrompt → 全图(1024²,~7min)→ 服务端执行记录零 [31] → cp
 *             r26-edit-off-default.png
 *   i2i-dry  :载入 qi21-道劫-i2i,干跑取证(槽在场[31]viggle r64 预填+开关源
 *             value=false+base=人物+指令在场);不出图(R24 两拍 526s/514s 已在
 *             档:.trellis/tasks/archive/2026-09/09-24-qi21-daojie-i2i/prd.md:41)。
 *
 * 用法:node apps/build/scripts/qi21_r26_live_0924.mjs <t2i-off|t2i-on|edit-off|i2i-dry>
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17002)/ CDP_PORT(默认 9380)/
 *   GEN_TIMEOUT_MS(默认 2_400_000=40min)/ HARVEST_ONLY=1(仅 t2i-off)
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const PHASE = process.argv[2];
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9380);
const HARVEST_ONLY = process.env.HARVEST_ONLY === "1";
const OUT_DIR = `${process.env.HOME}/Downloads/q21-final-0924/r26`;          // 图证目录(ask 指定)
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`; // 相位报告
const WF = {
  "t2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  "edit": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json`,
  "i2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
};
const DEST = {
  "t2i-off": join(OUT_DIR, "r26-t2i-off-seed0-full.png"),
  "t2i-on": join(OUT_DIR, "r26-t2i-on-seed0-4step.png"),
  "edit-off": join(OUT_DIR, "r26-edit-off-default.png"),
};
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-r26-17002-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 2_400_000);
const TOL_PX = 16, TOL_RATIO = 0.01;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
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

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf;
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

/** history 轮询:新 pid 相符项;返回 messages(服务端执行记录)+执行节点表 */
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
  return wf;
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

/** 干跑 blob 深查:开关源序列化值(找 class_type=PrimitiveBoolean 节点的 inputs.value) */
function boolSourceValue(blob) {
  try {
    const d = JSON.parse(blob);
    for (const [k, n] of Object.entries(d)) {
      if (n?.class_type === "PrimitiveBoolean") return { node: k, value: n.inputs?.value };
    }
    return { node: null, value: null };
  } catch (e) { return { node: null, value: null, err: String(e) }; }
}

/** 画布槽位取证:LoRA 加速槽在场(节点类型+默认关+viggle r64 预填) */
async function slotAudit(page) {
  const raw = await page.ev(`(() => {
    const nodes = window.app.graph._nodes;
    const grab = (type) => nodes.filter(n => n.type === type).map(n => ({ id: String(n.id), title: String(n.title || ''), widgets: (n.widgets || []).map(w => ({ name: String(w.name), value: w.value })) }));
    return JSON.stringify({ lora: grab('LoraLoaderModelOnly'), bools: grab('PrimitiveBoolean'), switches: grab('ComfySwitchNode') });
  })()`);
  let d;
  try { d = JSON.parse(String(raw)); } catch { return { error: String(raw) }; }
  const lora31 = (d.lora || []).find((n) => n.widgets.some((w) => String(w.value).includes("viggle-turbo-4step-lora-r64")));
  const src30 = (d.bools || []).find((n) => n.widgets.some((w) => w.value === false));
  const sw32 = (d.switches || []).find((n) => n.widgets.some((w) => w.value === false));
  return {
    slotPresent: Boolean(lora31 && src30 && sw32),
    detail: JSON.stringify(d).slice(0, 400),
    lora31: lora31 ? JSON.stringify(lora31) : "missing",
    src30: src30 ? JSON.stringify(src30) : "missing",
    sw32: sw32 ? JSON.stringify(sw32) : "missing",
  };
}

/** 运行态设 widget(R24 setWidgetById 口径:id 定位+name 匹配+callback) */
function setWidgetById(page, nid, wname, value) {
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

async function queueAndCollect(page, report, phase, sigFn, destPath, expectLoraExecuted, sizeW, sizeH) {
  const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await sleep(600);
  const t0 = Date.now();
  const queued = await page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check("queuePrompt 发出(真前端序列化+排队)", queued === "queued", String(queued));
  const hist = await waitHistory(sigFn, { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("引擎出图(/history 完成含图)", false, hist.error.slice(0, 500));
    return;
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const buf = await fetchView(saveImg, destPath);
  const magic = pngMagicBuf(buf);
  const size = await sipsSize(destPath);
  const dw = Math.abs((size.w ?? 0) - sizeW), dh = Math.abs((size.h ?? 0) - sizeH);
  const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - sizeW / sizeH) : 1;
  check("出图落盘+cp 取证目录+PNG 魔数", existsSync(destPath) && magic && buf.length > 50_000,
    `${saveImg.filename} → ${destPath} (${(buf.length / 1024).toFixed(0)}KB, PNG 魔数=${magic}, pid=${String(hist.pid).slice(0, 8)})`);
  check(`sips 尺寸对账(${sizeW}x${sizeH};维差≤${TOL_PX}px·比例≤1%)`, dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO,
    size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
  check("耗时(排队→完成)", true, `${secs}s(引擎执行段=${execDurationSec(hist.messages) ?? "?"}s)`);
  const executed = executedNodesOf(hist.messages);
  const loraNodeId = "31";
  const loraRan = executed.includes(loraNodeId);
  check(expectLoraExecuted
    ? `开态硬证:服务端执行记录含 [${loraNodeId}](LoRA 真加载)`
    : `硬性AC·服务端懒执行零 LoRA:[${loraNodeId}] 不在执行记录(权重未加载)`,
    expectLoraExecuted ? loraRan : !loraRan,
    `executed=${JSON.stringify(executed)}`);
  report.cases[phase] = { imgName: saveImg.filename, destPath, bytes: buf.length, size, secs, execSecs: execDurationSec(hist.messages), pid: hist.pid, executedNodes: executed, promptBlob: hist.promptBlob };
  report.promptBlob = hist.promptBlob;
}

async function main() {
  if (!["t2i-off", "t2i-on", "edit-off", "i2i-dry"].includes(PHASE)) {
    console.error("用法: node qi21_r26_live_0924.mjs <t2i-off|t2i-on|edit-off|i2i-dry>");
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: PHASE, harvestOnly: HARVEST_ONLY, engine: ENGINE, startedAt: new Date().toISOString(), genTimeoutMs: GEN_TIMEOUT, cases: {} };

  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  // ══════════ ① t2i 关态全图(不碰任何开关)══════════
  if (PHASE === "t2i-off") {
    await loadWorkflow(page, WF.t2i, HARVEST_ONLY ? "qi21-道劫-t2i-R26关态-收编" : "qi21-道劫-t2i-R26关态");
    // 不碰任何开关:零 widget 写入。取证默认态。
    const defaults = await page.ev(`(() => {
      const nodes = window.app.graph._nodes;
      const grab = (type) => nodes.filter(n => n.type === type).map(n => ({ id: n.id, title: String(n.title || ''), w: (n.widgets || []).map(x => ({ name: String(x.name), value: x.value })) }));
      return JSON.stringify({ lora: grab('LoraLoaderModelOnly'), bool: grab('PrimitiveBoolean'), sw: grab('ComfySwitchNode'), ks: nodes.filter(n => n.type === 'KSampler').map(n => ({ id: n.id, w: (n.widgets || []).map(x => ({ name: String(x.name), value: x.value })) })) });
    })()`);
    let dd; try { dd = JSON.parse(String(defaults)); } catch { dd = {}; }
    const swDefaultFalse = (dd.sw || []).length > 0 && (dd.sw || []).every((n) => n.w.every((x) => x.value !== true));
    const ksSteps40 = (dd.ks || []).some((n) => n.w.some((x) => x.name === "steps" && x.value === 40));
    check("[32] MODEL 开关默认=false(未碰任何开关)", swDefaultFalse, String(defaults).slice(0, 300));
    check("[7] KSampler 默认 steps=40(完整态)", ksSteps40, String(defaults).slice(0, 300));

    const dry = await dryRun(page);
    const dryOk = !dry.error;
    check("干跑 graphToPrompt 成功", dryOk, dry.error || `${(dry.blob || "").length} 字符`);
    let dryBlob = "";
    if (dryOk) {
      dryBlob = dry.blob;
      const src = boolSourceValue(dry.blob);
      check("硬性AC·干跑排队图开关源 [30] 序列化 value=false(关态 MODEL 直连指令态)", src.value === false, JSON.stringify(src));
      check("干跑排队图含加速槽节点(懒执行臂随图序列化,服务端零执行另证)", dry.blob.includes("LoraLoaderModelOnly"), "[31] 在排队图=槽在位(执行与否看服务端记录)");
      check("干跑执行图 base=人物", dry.blob.includes('"base":"人物"'), 'blob 含 "base":"人物"');
      check("干跑武器部件句在场(石青剑绦+乌木剑鞘+剑身完整收在鞘中)",
        dry.blob.includes("石青剑绦") && dry.blob.includes("乌木剑鞘") && dry.blob.includes("剑身完整收在鞘中"), "");
      check("干跑否定式绝迹(无「未拔」)", !dry.blob.includes("未拔"), "");
      check("干跑 KSampler seed=0/steps=40", dry.blob.includes('"steps":40') && dry.blob.includes('"seed":0'), "");
      report.dryRunBlob = dry.blob;
    }
    const slot = await slotAudit(page);
    check("槽在场取证([31]viggle r64 预填+[30]源+[32]MODEL 开关,默认全关)", slot.slotPresent, slot.detail);

    if (HARVEST_ONLY) {
      // 收编模式:OFF 图已在跑/已完成(驱动首跑 06:12 排队),只等 history 相符项
      // (base=人物+steps=40)+逐字节对账排队图=新干跑。
      const hist = await waitHistory((blob) => blob.includes('"base":"人物"') && blob.includes('"steps":40'), { timeout: GEN_TIMEOUT, knownPids: new Set() });
      if (hist.error) {
        check("收编:history 相符项(OFF 全图)", false, hist.error.slice(0, 500));
      } else {
        const same = dryBlob && hist.promptBlob === dryBlob;
        check("收编对账:服务端排队图 === 新干跑图(逐字节,同默认关态)", Boolean(same), `diff=${same ? 0 : "有"}(dry=${dryBlob.length}B, queued=${(hist.promptBlob || "").length}B)`);
        const executed = executedNodesOf(hist.messages);
        check("硬性AC·服务端懒执行零 LoRA:[31] 不在执行记录(权重未加载)", !executed.includes("31"), `executed=${JSON.stringify(executed)}`);
        const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
        const buf = await fetchView(saveImg, DEST[PHASE]);
        const magic = pngMagicBuf(buf);
        const size = await sipsSize(DEST[PHASE]);
        const dw = Math.abs((size.w ?? 0) - 1824), dh = Math.abs((size.h ?? 0) - 2432);
        const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - 1824 / 2432) : 1;
        check("出图落盘+cp 取证目录+PNG 魔数", existsSync(DEST[PHASE]) && magic && buf.length > 50_000,
          `${saveImg.filename} → ${DEST[PHASE]} (${(buf.length / 1024).toFixed(0)}KB, PNG 魔数=${magic}, pid=${String(hist.pid).slice(0, 8)})`);
        check("sips 尺寸对账(人物型 1824x2432;维差≤16px·比例≤1%)", dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO,
          size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
        const execSecs = execDurationSec(hist.messages);
        check("耗时(引擎执行段,40 步全图)", Number(execSecs) > 600, `${execSecs ?? "?"}s(全图实弹基准=非加速态)`);
        report.cases.t2iOff = { imgName: saveImg.filename, destPath: DEST[PHASE], bytes: buf.length, size, execSecs, pid: hist.pid, executedNodes: executed };
        report.promptBlob = hist.promptBlob;
      }
    } else {
      await queueAndCollect(page, report, "t2iOff",
        (blob) => blob.includes('"base":"人物"') && blob.includes('"steps":40'),
        DEST[PHASE], false, 1824, 2432);
      const c = report.cases.t2iOff;
      if (c) check("耗时下界(40 步全图=非加速态)", Number(c.execSecs ?? 0) > 600, `${c.execSecs}s`);
    }
  }

  // ══════════ ② t2i 开态加速图(运行态 LoRA=true+steps→4;只运行态不改仓库)══════════
  if (PHASE === "t2i-on") {
    await loadWorkflow(page, WF.t2i, "qi21-道劫-t2i-R26开态");
    const f1 = await setWidgetById(page, 30, "value", true);
    check("运行态切换 [30] LoRA 开关源 value=true", String(f1).startsWith("set:"), String(f1));
    const f2 = await setWidgetById(page, 7, "steps", 4);
    check("运行态切换 [7] KSampler steps=4", String(f2).startsWith("set:"), String(f2));
    await sleep(1200);

    const dry = await dryRun(page);
    const dryOk = !dry.error;
    check("干跑 graphToPrompt 成功", dryOk, dry.error || `${(dry.blob || "").length} 字符`);
    if (dryOk) {
      const src = boolSourceValue(dry.blob);
      check("开态干跑开关源 [30] 序列化 value=true", src.value === true, JSON.stringify(src));
      check("开态干跑排队图含 LoraLoaderModelOnly(LoRA 真入链)", dry.blob.includes("LoraLoaderModelOnly"), "");
      check("开态干跑 steps=4", dry.blob.includes('"steps":4'), "");
      check("开态干跑 viggle r64 权重在列", dry.blob.includes("viggle-turbo-4step-lora-r64"), "");
      check("开态干跑 base=人物", dry.blob.includes('"base":"人物"'), "");
      report.dryRunBlob = dry.blob;
    }
    const slot = await slotAudit(page);
    check("槽在场取证([31] viggle r64 预填不变)", (slot.lora31 || "").includes("viggle-turbo-4step-lora-r64"), slot.lora31);

    await queueAndCollect(page, report, "t2iOn",
      (blob) => blob.includes("LoraLoaderModelOnly") && blob.includes('"steps":4') && blob.includes('"base":"人物"'),
      DEST[PHASE], true, 1824, 2432);
    const c = report.cases.t2iOn;
    if (c) check("服务端排队图取证(含 LoraLoaderModelOnly+steps=4)", String(c.promptBlob || "").includes("LoraLoaderModelOnly") && String(c.promptBlob || "").includes('"steps":4'), "history prompt[2]");
  }

  // ══════════ ③ edit 关态全图(开关默认关)══════════
  if (PHASE === "edit-off") {
    await loadWorkflow(page, WF.edit, "qwen21-edit-R26关态");
    const defaults = await page.ev(`(() => {
      const nodes = window.app.graph._nodes;
      const grab = (type) => nodes.filter(n => n.type === type).map(n => ({ id: n.id, w: (n.widgets || []).map(x => ({ name: String(x.name), value: x.value })) }));
      return JSON.stringify({ lora: grab('LoraLoaderModelOnly'), bool: grab('PrimitiveBoolean'), sw: grab('ComfySwitchNode') });
    })()`);
    let dd; try { dd = JSON.parse(String(defaults)); } catch { dd = {}; }
    check("edit 槽在场+开关默认关(零 widget 写入)", (dd.lora || []).length === 1 && (dd.bool || []).length >= 1 && (dd.sw || []).every((n) => n.w.every((x) => x.value !== true)), String(defaults).slice(0, 300));

    const dry = await dryRun(page);
    const dryOk = !dry.error;
    check("干跑 graphToPrompt 成功", dryOk, dry.error || `${(dry.blob || "").length} 字符`);
    if (dryOk) {
      const src = boolSourceValue(dry.blob);
      check("硬性AC·edit 干跑排队图开关源 value=false(关态)", src.value === false, JSON.stringify(src));
      report.dryRunBlob = dry.blob;
    }
    const slot = await slotAudit(page);
    check("edit 槽在场取证([31] viggle r64 预填+[30]源+[32]MODEL 开关)", slot.slotPresent, slot.detail);

    await queueAndCollect(page, report, "editOff",
      (blob) => blob.includes('"class_type":"LoadImage"') && blob.includes("portrait_model_denim"),
      DEST[PHASE], false, 1024, 1024);
    const c = report.cases.editOff;
    if (c) check("服务端排队图取证(零 LoRA 直连:排队图含槽节点属懒执行臂,执行记录零 [31] 已证)", true, "history prompt[2] 含 [31]=随图序列化;executed 零 [31]");
  }

  // ══════════ ④ i2i 关态干跑取证(不出图;R24 两拍 526s/514s 已在档)══════════
  if (PHASE === "i2i-dry") {
    await loadWorkflow(page, WF.i2i, "qi21-道劫-i2i-R26干跑");
    const slot = await slotAudit(page);
    check("i2i 槽在场取证([31] viggle r64 预填+[30]源关+[32]MODEL 开关关)", slot.slotPresent, slot.detail);
    const dry = await dryRun(page);
    const dryOk = !dry.error;
    check("干跑 graphToPrompt 成功", dryOk, dry.error || `${(dry.blob || "").length} 字符`);
    if (dryOk) {
      const src = boolSourceValue(dry.blob);
      check("硬性AC·i2i 干跑排队图开关源 value=false(关态 MODEL 直连指令态)", src.value === false, JSON.stringify(src));
      check("i2i 干跑执行图 base=人物", dry.blob.includes('"base":"人物"'), "");
      check("i2i 干跑指令在场(shirt 指令)", dry.blob.includes("light blue denim shirt"), "");
      // 部件句:i2i 装配=指令+人物BASE+锁层A(无①主体句;BASE 文本在服务端
      // qi21_bases.json 物化,序列化执行图不含字面部件句)——如实记录在场性。
      const parts = dry.blob.includes("石青剑绦");
      check("i2i 部件句字面在场性(结构事实记录)", parts, parts ? "字面在场" : "不在场=i2i 装配结构使然(指令+BASE+锁层A,无①主体句),非槽结构漂移;槽结构见上两项");
      report.dryRunBlob = dry.blob;
    }
    check("i2i 相位=干跑取证(未 queuePrompt,R24 两拍 526s/514s 在档引用)", true, ".trellis/tasks/archive/2026-09/09-24-qi21-daojie-i2i/prd.md:41");
  }

  report.results = results;
  report.consoleErrors = consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, `r26-report-${PHASE}.json`), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? `✅ ${PHASE} 全绿` : `❌ ${PHASE} 存在失败项`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("驱动失败:", e.message);
  try { writeFileSync(join(REPORT_DIR, `r26-report-${PHASE || "fatal"}.json`), JSON.stringify({ fatal: String(e.message), results, consoleErrors }, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
