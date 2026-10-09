#!/usr/bin/env node
// qi21 用户测试批 P4·直排五发实弹(2026-10-02,Trellis 10-01-qi21-usetest-batch
// implement.md 步骤 10)。S8 先例驱动器形态(s8-integration-directfire):
//   仓库真源原样装载(loadGraphData 零注入)→面板 widget set(onWidgetChanged
//   钩子通路)→graphToPrompt 现读换算→POST /prompt(b4 API 直构面先例)→
//   WS /ws 执行事件取证(executing/executed 流)→/history 取图→下载 PNG→
//   qi21_s6_alpha_check_0930.py 校准口径判据。
//
// 五发(ask 细目):
//   ① t2i-direct-nine 直出九型(人物,pe关)——expect opaque;
//      懒文证:executedNodes 无 40:140(PE改写)/11(PE TE loader)
//      +引擎日志增量零 pe_t2i TE 装载行;
//   ② t2i-pe-nine PE九型(人物,pe开默认)——expect opaque;
//      PE 文证:排队图 40:140.prompt←['40:141',0](装配器口0)+最终文本=PE出文
//      +executedNodes 含 40:140/11;
//   ③ t2i-free-alpha 自由型+透明开——expect transparent;
//      两段装配文证:最终文本(PE关=装配全文)逐字==主体句+'\n'+锁层A全文
//      (BASE 空=自由型正常态,首行主体句+无空行);
//   ④ t2i-prop-follow 道具型跟随——expect transparent;
//      透明文证:排队图 40:150.透明覆盖=false(面板布尔未开)而
//      40:152.透明模式/40:144.switch←[40:150 槽5](透明值=rgba_default 解析)
//      →alpha transparent=跟随型自动;懒文证同①;
//   ⑤ i2i-direct i2i 直出一发(共享件升级兼容实证,i2i 工作流零动):
//      旧拓扑([180] 三态件在)在六出底座+十档 combo 下装载执行绿;
//      懒文证:executedNodes 无 40:26(TextGenerate PE 链)/12(i2i PE TE loader)
//      +日志增量零 pe_i2i TE 装载行。
//
// 判据(qi21_s6_alpha_check 校准口径):transparent=四角 alpha≤2+全透≥50%;
//   opaque=零真透明区(全透<0.1%+四角≥250+均值≥250);严口径并报于 verdict。
// 产物:apps/output/usertest-batch-1001/p4-livefire-report.json +
//   <key>-seed<seed>.png + alpha-<key>.json(逐发)。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9393)/
//   ONLY(逗号分隔 key 子集重跑)/ALPHA_PY(判据件 python,默认引擎家 venv)。
// 退出码 0=五发全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9393);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/usertest-batch-1001`;
const T2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const I2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const ENGINE_LOG = "/private/tmp/usertest-batch-1001/engine.log"; // 17599 进程 stdout(lsof 实证)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-p4-livefire-chrome-profile-${Date.now()}`;
const SPEED_DIRECT = "0 · 直出40步";
// 宿主定位(t2i 术后 uuid / i2i 原样 uuid)
const HOSTS = {
  t2i: { asm: "96937bbe-99d1-4f16-a06c-d86b57815d91", acc: "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e" },
  i2i: { asm: "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d", acc: "b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b" },
};
const PE_TE = { t2i: "qwen3.5_9b_qwen_image_2.1_pe_t2i", i2i: "qwen3.5_9b_qwen_image_2.1_pe_i2i" };
const CLIENT_ID = `p4-livefire-${Date.now()}`;

const SHOTS = [
  { key: "t2i-direct-nine", wf: "t2i", type: "人物", pe: false, alpha: false, seed: 1001, expect: "opaque", lazy: "t2i",
    note: "①直出九型(人物,pe关);懒取证首发(新拓扑真机四源帧)" },
  { key: "t2i-pe-nine", wf: "t2i", type: "人物", pe: true, alpha: false, seed: 1002, expect: "opaque", peWire: true,
    note: "②PE九型(人物,pe开默认);文证=40:140.prompt←装配器口0+最终文本=PE出文" },
  { key: "t2i-free-alpha", wf: "t2i", type: "自由", pe: false, alpha: true, seed: 1003, expect: "transparent", twoSeg: true,
    note: "③自由型+透明开;验透明alpha+BASE空两段装配(首行主体句+无空行)" },
  { key: "t2i-prop-follow", wf: "t2i", type: "道具", pe: false, alpha: false, seed: 1004, expect: "transparent", followType: true, lazy: "t2i",
    note: "④道具型跟随(rgba_default 自动透明);排队图透明覆盖=false 而透明值=型默认 true" },
  { key: "i2i-direct", wf: "i2i", type: "人物", pe: false, rgbaCombo: "跟随型", seed: 1005, expect: "opaque", lazy: "i2i",
    note: "⑤i2i 直出一发(共享件升级兼容实证;旧拓扑 [180] 三态件+六出底座共存)" },
  // 补验发(③④首跑透明判据 ratio0=4.3%/0 的归因闭环:seed 对齐 0930 s10-p2
  // pass 先例 9201/9203,同图同文本只换 seed;过门=方差实证,仍低=深查)
  { key: "t2i-free-alpha-s9203", wf: "t2i", type: "自由", pe: false, alpha: true, seed: 9203, expect: "transparent",
    note: "③b 补验:自由+透明 seed9203(0930 face-9203 pass 先例 seed)" },
  { key: "t2i-prop-follow-s9201", wf: "t2i", type: "道具", pe: false, alpha: false, seed: 9201, expect: "transparent",
    note: "④b 补验:道具跟随 seed9201(0930 prop-9201 pass 先例 seed)" },
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "p4-usertest-livefire", engine: ENGINE, clientId: CLIENT_ID,
  wf: { t2i: T2I, i2i: I2I },
  wfNote: "仓库真源原样装载(loadGraphData 零注入);prompt JSON=graphToPrompt 现读换算→POST /prompt(S8/b4 先例)",
  gate: "qi21_s6_alpha_check_0930.py 校准口径:transparent=四角≤2+ratio0≥50%;opaque=零真透明区;严口径并报于 verdict",
  startedAt: new Date().toISOString(),
  shots: {}, results: [],
};
const check = (name, pass, detail = "") => {
  report.results.push({ shot: CUR_KEY, name, pass, detail: String(detail).slice(0, 500) });
  log(`${pass ? "✅" : "❌"} [${CUR_KEY}] ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};
let CUR_KEY = "(env)";

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
}
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch {} }
}

async function getPageClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch {}
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
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

const hostJs = (uuid) => `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(uuid)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w };
})()`;
const setViaHook = (uuid, name, val) => `(async () => {
  const h = ${hostJs(uuid)}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; if (!w) return 'no-widget:' + ${JSON.stringify(name)};
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;

async function waitIdle() {
  for (let i = 0; i < 600; i++) {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(5000);
  }
  throw new Error("引擎队列 50min 未空闲");
}

const logSize = () => { try { return statSync(ENGINE_LOG).size; } catch { return 0; } };
const readLog = (from) => { try { return readFileSync(ENGINE_LOG, "utf8").slice(from); } catch { return ""; } };

function alphaCheck(png, expect) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [ALPHA_PY, png, expect], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: err.slice(0, 300), raw: out.slice(0, 300) }); }
    });
  });
}

// ── WS 执行监听:收 executing(节点流)/executed/完成信号 ──
async function watchExecution(pid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now(), done: false };
    const timer = setInterval(() => {
      if (Date.now() - state.lastActivity > 15 * 60_000) {
        cleanup(); reject(new Error("执行停滞:>15min 无事件(引擎侧模型冷装/长任务)"));
      }
      if (Date.now() - startedAt > 60 * 60_000) {
        cleanup(); reject(new Error("单发超时 60min"));
      }
    }, 30_000);
    const startedAt = Date.now();
    const cleanup = () => { clearInterval(timer); try { ws.close(); } catch {} };
    ws.on("open", () => log(`  ws 已连(clientId=${CLIENT_ID.slice(0, 18)}…)`));
    ws.on("error", (e) => { cleanup(); reject(new Error("ws 错误: " + e.message)); });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      state.lastActivity = Date.now();
      const d = m.data || {};
      if (m.type === "executing" && d.prompt_id === pid) {
        if (d.node === null) { state.done = true; cleanup(); resolve(state); }
        else if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
      } else if (m.type === "executed" && d.prompt_id === pid) state.executedCount += 1;
      else if (m.type === "execution_error" && (d.prompt_id === pid || !d.prompt_id)) {
        state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400));
        cleanup(); resolve(state);
      } else if (m.type === "execution_interrupted" && d.prompt_id === pid) {
        state.errors.push("interrupted"); cleanup(); resolve(state);
      }
    });
  });
}

let page = null;
let loadedWf = null;

async function loadWorkflow(wfKey) {
  if (loadedWf === wfKey) return;
  const wfJson = JSON.parse(readFileSync(wfKey === "t2i" ? T2I : I2I, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'p4-livefire-${wfKey}');
    return 'opened';
  })()`);
  if (opened !== "opened") throw new Error(`loadGraphData(${wfKey}) 失败: ${opened}`);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${wfKey})` });
  await sleep(1500);
  loadedWf = wfKey;
  log(`📂 ${wfKey} 真源已装载(${wfJson.nodes.length} 节点)`);
}

async function fireShot(shot) {
  CUR_KEY = shot.key;
  const rec = { ...shot, startedAt: new Date().toISOString(), panelSets: [] };
  report.shots[shot.key] = rec;
  report.checkpoint = shot.key;
  writeReport();
  try {
    await loadWorkflow(shot.wf);
    const hosts = HOSTS[shot.wf];
    await waitIdle();
    const logBefore = logSize();
    rec.logBefore = logBefore;

    // 面板设置(S8 形态:set+onWidgetChanged)
    const asmSets = { 型选择: shot.type, PE开关: shot.pe };
    if (shot.wf === "t2i") { asmSets.透明 = shot.alpha; asmSets.手动宽 = 0; asmSets.手动高 = 0; }
    else asmSets.RGBA透明 = shot.rgbaCombo;
    for (const [name, val] of Object.entries(asmSets)) {
      const r = await page.ev(setViaHook(hosts.asm, name, val));
      rec.panelSets.push(`${name}=${val}: ${r}`);
      if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${name}`, false, r);
    }
    for (const [name, val] of Object.entries({ 速度档位: SPEED_DIRECT, seed: shot.seed })) {
      const r = await page.ev(setViaHook(hosts.acc, name, val));
      rec.panelSets.push(`${name}=${val}: ${r}`);
      if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${name}(${shot.wf})`, false, r);
    }

    // graphToPrompt 现读换算(干跑兼排队图文证源)
    const dryRaw = await page.ev(`(async () => {
      try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
      catch (e) { return 'ERR:' + (e && (e.message || e)); }
    })()`);
    if (String(dryRaw).startsWith("ERR:")) { check("干跑 graphToPrompt", false, dryRaw); return rec; }
    const prompt = JSON.parse(String(dryRaw));
    rec.promptNodes = Object.keys(prompt).length;
    const asm141 = prompt["40:141"], sel152 = prompt["40:152"], base150 = prompt["40:150"], pe140 = prompt["40:140"], wh151 = prompt["40:151"];
    rec.dryNodes = { asm: !!asm141, sel: !!sel152, base: !!base150, peRewrite: !!pe140, wh: !!wh151 };
    if (shot.wf === "t2i") {
      check("排队图 [150].base=型/透明覆盖=面板布尔",
        base150?.inputs?.base === shot.type && base150?.inputs?.透明覆盖 === shot.alpha,
        JSON.stringify({ base: base150?.inputs?.base, 透明覆盖: base150?.inputs?.透明覆盖 }));
      check("排队图 [152].pe开关=面板值", sel152?.inputs?.pe开关 === shot.pe, String(sel152?.inputs?.pe开关));
      check("排队图 [151].联动开关=PE开关扇出值", wh151?.inputs?.联动开关 === shot.pe, String(wh151?.inputs?.联动开关));
      check("排队图 [151].手动宽/高=0(跟型)", wh151?.inputs?.手动宽 === 0 && wh151?.inputs?.手动高 === 0,
        `${wh151?.inputs?.手动宽}/${wh151?.inputs?.手动高}`);
      // gate:面板生效三锚任一失即跳过本发(不烧 25min 采样)
      const panelOk = base150?.inputs?.base === shot.type && sel152?.inputs?.pe开关 === shot.pe && wh151?.inputs?.联动开关 === shot.pe;
      if (!panelOk) { check("发次 gate:面板生效(跳过 POST)", false, "排队图三锚失配,不发弹"); return rec; }
      check("排队图 [140].prompt←[40:141,0](装配器口0,Q1=B+)",
        Array.isArray(pe140?.inputs?.prompt) && pe140.inputs.prompt[0] === "40:141" && pe140.inputs.prompt[1] === 0,
        JSON.stringify(pe140?.inputs?.prompt));
      check("排队图 [152].透明模式/[144].switch←[40:150 槽5](透明值)",
        JSON.stringify(sel152?.inputs?.透明模式) === JSON.stringify(["40:150", 5]) &&
        JSON.stringify(Object.values(prompt).find((v) => v.class_type === "ComfySwitchNode")?.inputs?.switch) === JSON.stringify(["40:150", 5]),
        `透明模式=${JSON.stringify(sel152?.inputs?.透明模式)}`);
      rec.pePromptInput = pe140?.inputs?.prompt || null;
      rec.主体句 = asm141?.inputs?.主体句 || null;
      rec.锁层A前16 = String(asm141?.inputs?.锁层A全文 || "").slice(0, 16);
    } else {
      // i2i 旧拓扑兼容面:[180] 三态件在场+[150] 存量五出消费不断
      const sel180 = Object.entries(prompt).find(([, v]) => v.class_type === "MyQi21RgbaSelect");
      check("排队图 i2i 旧拓扑 [180] 三态件在场(零动实证)", !!sel180, sel180 ? sel180[0] : "(缺)");
      check("排队图 i2i [150].base=人物/六出下存量消费",
        base150?.inputs?.base === shot.type, JSON.stringify(base150?.inputs));
      check("排队图 i2i [152].pe开关=false", sel152?.inputs?.pe开关 === false, String(sel152?.inputs?.pe开关));
      if (base150?.inputs?.base !== shot.type || sel152?.inputs?.pe开关 !== false) {
        check("发次 gate:i2i 面板生效(跳过 POST)", false, "排队图锚失配,不发弹"); return rec;
      }
    }

    // POST /prompt(b4 形态)
    const resp = await (await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
    })).json();
    if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) {
      check("POST /prompt 受理", false, JSON.stringify(resp).slice(0, 400)); return rec;
    }
    rec.pid = resp.prompt_id;
    log(`🚀 ${shot.key} 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=${shot.seed})`);

    // WS 取证 + 完成
    const exec = await watchExecution(resp.prompt_id);
    rec.executedNodes = exec.executedNodes;
    rec.frameStats = { executing: exec.executedNodes.length, executed: exec.executedCount };
    rec.execErrors = exec.errors;
    if (exec.errors.length) { check("执行零错误", false, exec.errors.join(" | ")); }

    // history 取图+文本
    const hist = await (await fetch(`${ENGINE}/history/${resp.prompt_id}`)).json();
    const h = hist[resp.prompt_id] || {};
    rec.historyStatus = h.status?.status_str || "(missing)";
    const outputs = h.outputs || {};
    const saveOut = Object.values(outputs).find((o) => o.images && o.images.length);
    if (!saveOut) { check("history 出图在位", false, JSON.stringify(Object.keys(outputs))); return rec; }
    const img = saveOut.images[0];
    rec.savedImage = `${img.subfolder}/${img.filename}`;
    const pngPath = join(OUT_DIR, `${shot.key}-seed${shot.seed}.png`);
    const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer());
    writeFileSync(pngPath, buf);
    rec.png = pngPath;
    log(`🖼  ${shot.key} 出图 ${buf.length}B → ${pngPath.split("/").pop()}`);

    // [27] 最终文本(PE关=装配全文直写路;PE开=PE出文)
    const show27 = outputs["27"];
    const finalText = show27?.ui?.text?.[0] ?? show27?.text?.[0] ?? null;
    if (typeof finalText === "string") {
      rec.finalTextLen = finalText.length;
      rec.finalTextMd5 = require("node:crypto").createHash("md5").update(finalText).digest("hex");
      rec.finalTextHead = finalText.slice(0, 120);
      rec.finalTextTail = finalText.slice(-100);
      rec.finalText = finalText; // ③两段拼断言用(报告剥离)
    }

    // ①-④ t2i 文证 / ⑤ i2i 文证
    if (shot.wf === "t2i") {
      if (shot.lazy === "t2i") {
        const lazyOk = !exec.executedNodes.includes("40:140") && !exec.executedNodes.includes("11");
        check("懒文证:PE关 → 40:140(PE改写)不执行+11(PE TE)不装载(执行图裁剪)",
          lazyOk, `在埂行集:40:140=${exec.executedNodes.includes("40:140")} 11=${exec.executedNodes.includes("11")}`);
        const delta = readLog(logBefore);
        const peHits = (delta.match(new RegExp(PE_TE.t2i, "g")) || []).length;
        rec.lazyLog = { logDeltaBytes: delta.length, peTeHits: peHits };
        check("懒文证:引擎日志增量零 pe_t2i TE 装载行", peHits === 0, `hits=${peHits}(增量 ${delta.length}B)`);
      }
      if (shot.peWire) {
        check("PE 文证:40:140 在执行集+11(PE TE)装载", exec.executedNodes.includes("40:140") && exec.executedNodes.includes("11"),
          `40:140=${exec.executedNodes.includes("40:140")} 11=${exec.executedNodes.includes("11")}`);
        const delta = readLog(logBefore);
        const peHits = (delta.match(new RegExp(PE_TE.t2i, "g")) || []).length;
        rec.peLog = { logDeltaBytes: delta.length, peTeHits: peHits };
        check("PE 文证:引擎日志增量含 pe_t2i TE 装载行", peHits >= 1, `hits=${peHits}`);
        const subj = rec.主体句, lockA = prompt["40:141"]?.inputs?.锁层A全文;
        if (typeof finalText === "string" && subj && lockA) {
          check("PE 文证:最终文本=PE出文(≠装配全文直写路文本)", finalText !== `${subj}\n${lockA}` && finalText.length > 200,
            `len=${finalText.length};首字符=${finalText.slice(0, 1).codePointAt(0).toString(16)}`);
        }
      }
      if (shot.twoSeg) {
        const subj = rec.主体句, lockA = prompt["40:141"]?.inputs?.锁层A全文;
        if (typeof finalText === "string" && subj && lockA) {
          const expect = `${subj}\n${lockA}`;
          check("两段装配文证:最终文本逐字==主体句+\\n+锁层A(BASE 空=自由型正常态)",
            finalText === expect, `len ${finalText.length} vs ${expect.length};首行匹配=${finalText.split("\n")[0] === subj}`);
          check("两段装配文证:首行=主体句+全文无空行(\\n\\n 零出现)",
            finalText.split("\n")[0] === subj && !finalText.includes("\n\n"),
            `首行匹配=${finalText.split("\n")[0] === subj};空行=${(finalText.match(/\n\n/g) || []).length}`);
        } else check("两段装配文证(素材在位)", false, `finalText=${typeof finalText} 主体句=${!!subj} 锁层A=${!!lockA}`);
        const delta = readLog(logBefore);
        rec.freeBaseLog = { neutralWarnHits: (delta.match(/自由型此为正常态/g) || []).length };
        check("自由型文证:装配器中性化警告在场(「自由型此为正常态」)", rec.freeBaseLog.neutralWarnHits >= 1,
          `hits=${rec.freeBaseLog.neutralWarnHits}`);
      }
      if (shot.followType) {
        // ④排队图透明覆盖=false(面板未开)而执行结果透明=rgba_default 跟随解析(⑥⑦纯布尔链)
        check("跟随文证:排队图 [150].透明覆盖=false(面板布尔未开)",
          prompt["40:150"]?.inputs?.透明覆盖 === false, String(prompt["40:150"]?.inputs?.透明覆盖));
        const warn = readLog(logBefore).includes("BASE 输入未接线") === false;
        check("跟随文证:道具型 BASE 层在装配(无两段降级警告)", warn, "(日志增量无降级警告行)");
      }
    } else {
      // ⑤ i2i:懒(本地 PE 链不执行)+兼容(旧透明链 [180] 在执行集)
      const lazyOk = !exec.executedNodes.includes("40:26") && !exec.executedNodes.includes("12");
      check("懒文证:i2i PE关 → 40:26(TextGenerate)不执行+12(i2i PE TE)不装载",
        lazyOk, `40:26=${exec.executedNodes.includes("40:26")} 12=${exec.executedNodes.includes("12")}`);
      const delta = readLog(logBefore);
      const peHits = (delta.match(new RegExp(PE_TE.i2i, "g")) || []).length;
      rec.lazyLog = { logDeltaBytes: delta.length, peTeHits: peHits };
      check("懒文证:引擎日志增量零 pe_i2i TE 装载行", peHits === 0, `hits=${peHits}(增量 ${delta.length}B)`);
      const rgba180 = exec.executedNodes.find((n) => prompt[n]?.class_type === "MyQi21RgbaSelect");
      check("兼容文证:i2i 旧透明链 [180] 三态件照常执行", !!rgba180, `执行件=${rgba180 || "(未执行)"}`);
      check("兼容文证:i2i 装配器 [40:141] 执行(共享件新代码跑旧拓扑)", exec.executedNodes.includes("40:141"),
        exec.executedNodes.includes("40:141") ? "在执行集" : "(缺)");
    }

    // alpha 判据(qi21_s6_alpha_check 校准口径)
    const alpha = await alphaCheck(pngPath, shot.expect);
    writeFileSync(join(OUT_DIR, `alpha-${shot.key}.json`), JSON.stringify(alpha, null, 2));
    rec.alpha = alpha;
    check(`透明判据:expect=${shot.expect}`, alpha.pass === true, alpha.verdict || JSON.stringify(alpha).slice(0, 200));
  } catch (e) {
    check("发次驱动异常", false, String(e && e.message));
    rec.error = String(e && e.message);
  }
  rec.finishedAt = new Date().toISOString();
  if (rec.secs === undefined) rec.secs = Math.round((new Date(rec.finishedAt) - new Date(rec.startedAt)) / 1000);
  if (rec.finalText) rec.finalText = undefined; // 报告不留全文(长度)
  writeReport();
  return rec;
}

function writeReport() {
  try { writeFileSync(join(OUT_DIR, "p4-livefire-report.json"), JSON.stringify(report, null, 2)); } catch {}
}

// ── main ──
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("0.1 引擎已列面板联动扩展(P3 件在役)", exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"), "");
  const baseInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21DaojieBase`)).json()).MyQi21DaojieBase;
  check("0.2 [150] 六出+十档 combo(P1 升级在引擎在役)",
    JSON.stringify(baseInfo.output_name) === JSON.stringify(["BASE", "WIDTH", "HEIGHT", "型名", "rgba_default", "透明值"]) &&
    baseInfo.input.required.base[0].length === 10,
    `${baseInfo.output_name?.length} 出/${baseInfo.input.required.base[0].length} 档`);

  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(2000);

  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.key)) continue;
    log(`\n══ ${shot.key} — ${shot.note} ══`);
    await fireShot(shot);
  }
} catch (e) {
  check("环境段", false, String(e && e.message));
} finally {
  report.finishedAt = new Date().toISOString();
  writeReport();
  try { page?.close(); } catch {}
  killChrome();
}
log("\n════ P4 直排五发实弹汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} [${r.shot}] ${r.name}`);
const failed = report.results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
