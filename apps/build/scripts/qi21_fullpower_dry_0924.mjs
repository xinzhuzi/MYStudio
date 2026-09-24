#!/usr/bin/env node
/**
 * 满血接线轮 干跑验收驱动(0924;17002 手动引擎 + headless Chrome 真前端;派生自
 * qi21_r26_live_0924.mjs——只干跑不 queuePrompt,出图证据 R26.4 已在档)。
 *
 * 验什么(任务令「一拨全配」):三件(t2i/i2i/edit)的 [30] LoRA 开关升级后——
 *   关态干跑(零 widget 写入):graphToPrompt 排队图里 steps 链解析=40(KSampler.steps
 *     →steps 联动 INT 开关→on_false→PrimitiveInt 40)+开关源 value=false+懒执行
 *     走查(SaveImage 回溯,开关经 switch 连线解析布尔源)执行集零 LoraLoaderModelOnly;
 *   开态干跑(运行态把 [30]=true,setWidgetById 只运行态不落盘):steps 链解析=6
 *     (on_true→PrimitiveInt 6)+开关源 value=true+懒执行走查执行集含 LoraLoader
 *     ModelOnly(LoRA 真入链)。
 *
 * 方法论勘正在案(R26.4):graphToPrompt 必序列化懒臂——排队图含 [31] 属结构事实,
 * 「零 LoRA」的正确口径=懒执行走查(共端点豁免同 inspect);本驱动走查与生成器
 * 自查/契约测试 _reach_state 同口径谓词。
 *
 * 用法:node apps/build/scripts/qi21_fullpower_dry_0924.mjs <t2i|t2i-on|i2i|i2i-on|edit|edit-on|all>
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17002)/ CDP_PORT(默认 9382)/
 *   GEN_TIMEOUT_MS(默认 900000=15min,干跑快拍也给足余量)
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const PHASE = process.argv[2] || "all";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9382);
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900000);
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`;
const WF = {
  "t2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  "i2i": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
  "edit": `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
};
// 每件的节点 id 锚(与生成器/契约测试同表)
const ANCHOR = {
  "t2i":  { save: "9", ks: "7", sw: "177", c40: "178", c6: "179", pb: "30", lora: "31" },
  "i2i":  { save: "10", ks: "8", sw: "164", c40: "165", c6: "166", pb: "30", lora: "31" },
  "edit": { save: "10", ks: "8", sw: "33", c40: "34", c6: "35", pb: "30", lora: "31" },
};
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-fullpower-17002-profile";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
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
    "--disable-background-timering",
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

async function waitFor(fn, { timeout = 90_000, interval = 1500, label = "" } = {}) {
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
  const { readFileSync } = await import("node:fs");
  const wf = JSON.parse(readFileSync(wfPath, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wf)}, true, true, ${JSON.stringify(label)});
    return 'opened';
  })()`);
  check("工作流载入(真前端 loadGraphData)", opened === "opened", `${label}: ${String(opened)}`);
  await waitFor(() => page.ev(`window.app.graph && window.app.graph._nodes.length === ${wf.nodes.length} ? ${wf.nodes.length} : null`),
    { timeout: 40_000, interval: 1000, label: `画布切换(${wf.nodes.length} 节点)` });
  await sleep(1200);
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

/** 运行态设 widget(R24 setWidgetById 口径:id 定位+name 匹配+callback;只运行态) */
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

/* ── 排队图(API prompt)解析:steps 链 + 懒执行走查(与生成器/契约同口径谓词)── */
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

async function freeEngine() {
  try {
    await fetch(`${ENGINE}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    log("POST /free(拍间清场)");
  } catch (e) { log("/free 失败(非致命):", e.message); }
}

/** 一拍:载入→(开态翻转 [30])→干跑→断言 */
async function phase(page, kind, on) {
  const a = ANCHOR[kind];
  await loadWorkflow(page, WF[kind], `满血接线-${kind}-${on ? "开态" : "关态"}`);
  if (on) {
    const f = await setWidgetById(page, 30, "value", true);
    check(`[${kind}${on ? "-on" : "-off"}] 运行态把 [30] value=true(一拨)`, String(f).startsWith("set:"), String(f));
    await sleep(1000);
  }
  const dry = await dryRun(page);
  check(`[${kind}${on ? "-on" : "-off"}] 干跑 graphToPrompt 成功`, !dry.error, dry.error || `${(dry.blob || "").length} 字符`);
  if (dry.error) return;
  const d = parseBlob(dry.blob);
  check(`[${kind}${on ? "-on" : "-off"}] 排队图可解析`, Boolean(d), "");
  if (!d) return;

  // 开关源序列化值(结构指令态)
  const pb = d[a.pb];
  check(`[${kind}${on ? "-on" : "-off"}] 开关源 [30] 排队图 value=${on}`,
    pb?.class_type === "PrimitiveBoolean" && pb.inputs?.value === on,
    JSON.stringify(pb?.inputs));

  // steps 链解析
  const st = resolveSteps(d, a);
  check(`[${kind}${on ? "-on" : "-off"}] steps 链解析=${on ? 6 : 40}(${on ? "开=一拨自动 6" : "关=自动回 40 原路"})`,
    st.value === (on ? 6 : 40), JSON.stringify(st));

  // 同一布尔源(两开关的 switch 连线同源)
  const ks = d[a.ks];
  const stepsSw = d[ks.inputs.steps[0]];
  check(`[${kind}${on ? "-on" : "-off"}] steps 开关 switch 连线=同一布尔源 [30]`,
    JSON.stringify(stepsSw.inputs?.switch) === JSON.stringify([a.pb, 0]),
    JSON.stringify(stepsSw.inputs?.switch));

  // 常量臂在排队图(懒臂随图序列化=结构事实)
  check(`[${kind}${on ? "-on" : "-off"}] 排队图含常量臂(40/6 随图序列化)`,
    d[a.c40]?.inputs?.value === 40 && d[a.c6]?.inputs?.value === 6,
    `c40=${JSON.stringify(d[a.c40]?.inputs)} c6=${JSON.stringify(d[a.c6]?.inputs)}`);

  // 懒执行走查:关态零 LoRA / 开态 LoRA 在链
  const reach = executedSet(d, a);
  const loraIn = reach.has(a.lora);
  check(on
    ? `[${kind}-on] 开态执行集含 [31] LoraLoaderModelOnly(LoRA 真入链)`
    : `[${kind}-off] 硬性AC·关态执行集零 LoraLoaderModelOnly(关闭=正常生成)`,
    on ? loraIn : !loraIn,
    `executed=${JSON.stringify([...reach].sort((x, y) => Number(x) - Number(y)))}`);

  await freeEngine();
  return { kind, on, steps: st.value, pbValue: pb?.inputs?.value, loraExecuted: loraIn, executedCount: reach.size };
}

async function main() {
  const all = ["t2i", "i2i", "edit"];
  const phases = PHASE === "all"
    ? all.flatMap((k) => [{ k, on: false }, { k, on: true }])
    : PHASE.endsWith("-on") ? [{ k: PHASE.slice(0, -3), on: true }] : [{ k: PHASE, on: false }];
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: PHASE, engine: ENGINE, startedAt: new Date().toISOString(), genTimeoutMs: GEN_TIMEOUT, cases: {} };

  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  for (const { k, on } of phases) {
    const r = await phase(page, k, on);
    report.cases[`${k}-${on ? "on" : "off"}`] = r ?? { error: "phase 未完成" };
  }

  report.results = results;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, `fullpower-dry-${PHASE}.json`), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? `✅ ${PHASE} 全绿` : `❌ ${PHASE} 存在失败项`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("驱动异常:", e); killChrome(); process.exit(2); });
