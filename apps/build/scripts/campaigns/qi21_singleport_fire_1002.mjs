#!/usr/bin/env node
// qi21 单口战役(10-02-qi21-subgraph-singleport)实弹三发驱动 — implement.md 步4 后半。
//
// 先例形态(大轮 qi21_biground_livefire_1002.mjs):
//   仓库真源原样 loadGraphData(零注入)→宿主面板 widget set+onWidgetChanged→
//   graphToPrompt 现读换算→POST /prompt→WS 执行事件取证→/history 取图取文。
//
// 三发(t2i;坑8:自由型/人物型避型面失配;判据=三证法文证为主,像素门人眼终审):
//   f1 人物型·pe关·透明关(直出40步):进编码文本=装配全文原样(主体句\nBASE\n锁层A
//      三段逐字);懒执行取证(pe关零 PE TE:6:4013/6:4019 不在执行集+日志增量零
//      pe_t2i 装载行);
//   f2 自由型·pe关·透明开(直出40步):进编码文本=头句+" "+装配全文+" "+W1+" "+
//      尾句(逐字;装配全文=主体句\n锁层A 两段,BASE 空降级+中性化警告文证);
//   f3 自由型·pe开·透明开(直出40步):进编码文本=头句+" "+剥离(PE出文)+" "+W1+
//      " "+尾句——PE出文运行时产物不可预知,判据=结构逐字(头句前缀/尾句后缀/W1
//      在位)+中段词族零命中(实调 strip 幂等)+compose 重构 md5 闭环+PE 文证
//      (6:4013/6:4019 在执行集+日志含 pe_t2i 装载行)。
//
// 每发硬门(三证法):
//   证1 排队图传导:[4015].prompt ← ["6:4014",0] 且主图 [401].anything ← ["6:4014",0]
//      (单口后预览与进编码物理同一条线,链穿透宿主边界直达真源件);
//   证2 件执行级实调:引擎家部署副本(单口版)importlib 实调 compose(7 槽)→ md5;
//   证3 最终文本 md5:[401] 预览(history ui.text)md5 == 证2 md5(逐字)。
//
// 坑6(驱动器干跑断言自检):PHASE=dryrun=装载+面板+排队图断言+expect 构造全跑
//   (不 POST 不烧采样),断言构造逻辑红绿先见。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(9381)/
//   PHASE=dryrun|fire(默认 fire)/ONLY=f1,f2,f3 子集。
// 产物:apps/output/singleport-1002/fire/{fire-report.json,*.png,alpha-*.json}。
// 退出码 0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9381);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/singleport-1002/fire`;
const WF_T2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ENGINE_HOME = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui`;
const VENV_PY = `${ENGINE_HOME}/venv/bin/python`;
const COMPOSE_PROBE = `${REPO}/apps/build/scripts/qi21_singleport_compose_probe_1002.py`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const BASES_JSON = `${ENGINE_HOME}/ComfyUI/custom_nodes/my-nodes/nodes/qi21_bases.json`;
const ENGINE_LOG = "/tmp/qi21-singleport-1002/engine.log"; // qi21_singleport_engine_up_1002.py 同源
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-singleport-fire-chrome-${Date.now()}`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e";
const DIRECT40 = "1 · 直出40步";
const CLIENT_ID = `singleport-fire-${Date.now()}`;
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "singleport-1002-fire", engine: ENGINE, clientId: CLIENT_ID, wf: WF_T2I,
  wfNote: "仓库真源原样装载(loadGraphData 零注入);三证法文证为主(坑8);直出40步×3(透明+FunAcc 白图域规避)",
  gate: "硬门=排队图传导+compose 实调 md5+[401] 预览 md5 三证;alpha=记录项非门(像素门人眼终审,F4 口径)",
  startedAt: new Date().toISOString(), shots: {}, results: [],
};
const check = (name, pass, detail = "") => {
  report.results.push({ shot: CUR_KEY, name, pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? "✅" : "❌"} [${CUR_KEY}] ${name}${detail ? ` — ${String(detail).slice(0, 280)}` : ""}`);
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
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
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
  return { host, w, names: (host.widgets || []).map((x) => x.name) };
})()`;
const setViaHook = (uuid, name, val) => `(async () => {
  const h = ${hostJs(uuid)}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; if (!w) return 'no-widget:' + ${JSON.stringify(name)};
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;
async function waitIdle() {
  for (let i = 0; i < 720; i++) {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(5000);
  }
  throw new Error("引擎队列 60min 未空闲");
}
const logSize = () => { try { return statSync(ENGINE_LOG).size; } catch { return 0; } };
// 字节精确增量(1002 修正:早期版把 logSize 的字节值直接当 utf8 字符位 slice,
// [MY出图] 中文回显行致错位 ~12k 字符,f3 的 pe_t2i 装载行被错切出窗——取证工具
// 缺陷非链路红;Buffer.slice 按字节切,与 logSize 同单位)
const readLog = (fromBytes) => { try { return readFileSync(ENGINE_LOG).slice(fromBytes).toString("utf8"); } catch { return ""; } };

// ── compose 实调探针(引擎家部署副本单口版;证2) ──
function composeProbe(payload) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [COMPOSE_PROBE], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: (err || out).slice(0, 400) }); }
    });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}
async function watchExecution(pid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now(), done: false };
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - state.lastActivity > 20 * 60_000) { cleanup(); reject(new Error("执行停滞:>20min 无事件")); }
      if (Date.now() - startedAt > 70 * 60_000) { cleanup(); reject(new Error("单发超时 70min")); }
    }, 30_000);
    const cleanup = () => { clearInterval(timer); try { ws.close(); } catch {} };
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
        state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400)); cleanup(); resolve(state);
      } else if (m.type === "execution_interrupted" && d.prompt_id === pid) {
        state.errors.push("interrupted"); cleanup(); resolve(state);
      }
    });
  });
}
function alphaCheck(png, expect) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [ALPHA_PY, png, expect], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: err.slice(0, 300), raw: out.slice(0, 300) }); }
    });
  });
}

let page = null;
let loadedWf = false;
async function loadWorkflow() {
  if (loadedWf) return;
  const wfJson = JSON.parse(readFileSync(WF_T2I, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'singleport-fire-t2i');
    return 'opened';
  })()`);
  if (opened !== "opened") throw new Error(`loadGraphData(t2i) 失败: ${opened}`);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换(t2i)" });
  await sleep(1500);
  loadedWf = true;
  log(`📂 t2i 真源已装载(${wfJson.nodes.length} 节点)`);
}
async function dryPrompt() {
  const dryRaw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(dryRaw).startsWith("ERR:")) throw new Error("graphToPrompt 干跑失败: " + String(dryRaw).slice(0, 300));
  return JSON.parse(String(dryRaw));
}
const N = (p, k) => p[`6:${k}`];
const isLink = (v, node, slot) => Array.isArray(v) && v[0] === `6:${node}` && v[1] === slot;
async function setPanel(entries, rec) {
  for (const [which, name, val] of entries) {
    const uuid = which === "asm" ? ASM : ACCEL;
    const r = await page.ev(setViaHook(uuid, name, val));
    rec.panelSets.push(`${which}.${name}=${val}: ${r}`);
    if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${which}.${name}`, false, r);
  }
}
// 装配全文逐字构造(BASE=引擎家 qi21_bases.json 现读,F5 热读同源;主体句/锁层A=排队图)
function buildAssembly(prompt, typeName, rec) {
  const subject = prompt["400"]?.inputs?.value ?? "";
  const lockA = N(prompt, 4011)?.inputs?.锁层A全文 ?? "";
  const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
  const entry = bases.find((e) => e && e.zh === typeName);
  const baseText = entry?.base_text ?? "";
  rec.assemblySource = { subjectLen: subject.length, lockALen: lockA.length, baseLen: baseText.length, baseMd5: md5(baseText) };
  const assembly = baseText.trim() ? `${subject}\n${baseText}\n${lockA}` : `${subject}\n${lockA}`;
  return { assembly, subject, lockA, baseText };
}

// ── 排队图共通断言(证1:单口传导链) ──
function queueCommon(prompt, rec, { type, pe, alpha }) {
  const b = N(prompt, 4010), sel = N(prompt, 4014), pb = N(prompt, 4012), wh = N(prompt, 4018);
  check("证1·排队图 [4010].base=型/透明覆盖=面板布尔",
    b?.inputs?.base === type && b?.inputs?.透明覆盖 === alpha,
    JSON.stringify({ base: b?.inputs?.base, 透明覆盖: b?.inputs?.透明覆盖 }));
  const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
  check("证1·排队图 [4012] PrimitiveBoolean=面板PE值(㉑节点化)", peVal === pe, String(peVal));
  check("证1·[4014].pe开关/[4018].联动开关 ← [4012,0](单源扇出)",
    isLink(sel?.inputs?.pe开关, 4012, 0) && isLink(wh?.inputs?.联动开关, 4012, 0),
    `pe开关=${JSON.stringify(sel?.inputs?.pe开关)};联动=${JSON.stringify(wh?.inputs?.联动开关)}`);
  check("证1·[4014].透明模式 ← [4010,3](透明值,纯布尔跨界)",
    isLink(sel?.inputs?.透明模式, 4010, 3), `透明模式=${JSON.stringify(sel?.inputs?.透明模式)}`);
  check("证1·单口进编码:6:4015.prompt ← [6:4014,0](R2 单编码独挑)",
    isLink(N(prompt, 4015)?.inputs?.prompt, 4014, 0), `prompt=${JSON.stringify(N(prompt, 4015)?.inputs?.prompt)}`);
  check("证1·预览=实况链:主图 401.anything ← [6:4014,0](链穿透宿主边界直达单口真源件)",
    isLink(prompt["401"]?.inputs?.anything, 4014, 0), `anything=${JSON.stringify(prompt["401"]?.inputs?.anything)}`);
  check("证1·[4018].手动宽/高=0(跟型)", wh?.inputs?.手动宽 === 0 && wh?.inputs?.手动高 === 0, `${wh?.inputs?.手动宽}/${wh?.inputs?.手动高}`);
  const modeSel = prompt["7:7015"]?.inputs?.mode;
  check("证1·速度档=直出40步(三发统一)", modeSel === DIRECT40, String(modeSel));
  rec.pe12Resolved = peVal;
  if (!(b?.inputs?.base === type && peVal === pe)) { rec.skipPost = true; rec.skipReason = "[4010]/[4012] 面板锚失配"; }
}
function lazyEvidence(exec, rec, logBefore) {
  const noPe = !exec.executedNodes.includes("6:4013") && !exec.executedNodes.includes("6:4019");
  check("懒文证:pe关 → 6:4013(PE改写)不执行+6:4019(PE专属TE)不装载(执行图裁剪)",
    noPe, `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  const echoHits = (delta.match(/pe_t2i/g) || []).length;
  rec.lazyLog = { logDeltaBytes: delta.length, peTeLoads: peLoads, peEchoHits: echoHits };
  check("懒文证:引擎日志增量零 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads === 0,
    `装载指纹=${peLoads};回显命中=${echoHits}(增量 ${delta.length}B)`);
}
function peEvidence(exec, rec, logBefore) {
  check("PE 文证:6:4013(PE改写)+6:4019(PE专属TE)在执行集",
    exec.executedNodes.includes("6:4013") && exec.executedNodes.includes("6:4019"),
    `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  rec.peLog = { logDeltaBytes: delta.length, peTeLoads: peLoads };
  check("PE 文证:引擎日志增量含 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads >= 1, `装载指纹=${peLoads}`);
  check("thinking 预览文证(Q2 原样不动):6:4020 在执行集", exec.executedNodes.includes("6:4020"),
    `6:4020=${exec.executedNodes.includes("6:4020")}`);
}

// ══ 三发定义 ══
const SHOTS = [
  {
    key: "f1-char-peoff-opaque", seed: 4001,
    note: "f1 人物型·pe关·透明关:进编码文本=装配全文原样(三段逐字);懒执行取证",
    panel: () => [["asm", "型选择", "人物"], ["asm", "PE启用?", false], ["asm", "透明", false], ["asm", "手动宽", 0], ["asm", "手动高", 0],
                  ["acc", "速度档位", DIRECT40], ["acc", "seed", 4001]],
    run: async (prompt, rec) => {
      queueCommon(prompt, rec, { type: "人物", pe: false, alpha: false });
      if (rec.skipPost) return;
      const { assembly, baseText } = buildAssembly(prompt, "人物", rec);
      const sel = N(prompt, 4014)?.inputs || {};
      const probe = await composeProbe({
        mode: "compose", 装配全文: assembly, PE出文: null,
        pe开关: false, 透明模式: false,
        RGBA官方头句: sel.RGBA官方头句, RGBA官方尾句: sel.RGBA官方尾句, W1收束句: sel.W1收束句,
      });
      rec.expect = { assemblyLen: assembly.length, assemblyMd5: md5(assembly), probe };
      check("f1 证2·compose 实调(pe关+透明关)=装配全文原样 md5 同",
        probe.exit === 0 && probe.md5 === md5(assembly),
        `probe md5=${probe.md5};构造 md5=${md5(assembly)};len=${probe.len}/${assembly.length}${probe.error ? ";ERR=" + probe.error : ""}`);
      rec.expectMd5 = probe.md5;
    },
    after: async (prompt, exec, rec) => {
      lazyEvidence(exec, rec, rec.logBefore);
      check("f1 执行文证:6:4011(装配)+6:4014(合成)+6:4015(编码)在执行集",
        exec.executedNodes.includes("6:4011") && exec.executedNodes.includes("6:4014") && exec.executedNodes.includes("6:4015"),
        `4011=${exec.executedNodes.includes("6:4011")}/4014=${exec.executedNodes.includes("6:4014")}/4015=${exec.executedNodes.includes("6:4015")}`);
      check("f1 证3·[401] 预览 md5 == 进编码文本 md5(装配全文原样,逐字)",
        rec.finalTextMd5 === rec.expectMd5,
        `预览 md5=${rec.finalTextMd5};期望 md5=${rec.expectMd5};len=${rec.finalTextLen}/${rec.expect?.assemblyLen}`);
      check("f1 文证:预览含人物型 BASE 锚句(头身比约七头半)",
        typeof rec.finalText === "string" && rec.finalText.includes("头身比约七头半"),
        `len=${rec.finalTextLen}`);
    },
  },
  {
    key: "f2-free-peoff-alpha", seed: 4002,
    note: "f2 自由型·pe关·透明开:进编码文本=头句+装配全文+W1+尾句(逐字);懒执行+中性化警告",
    panel: () => [["asm", "型选择", "自由"], ["asm", "PE启用?", false], ["asm", "透明", true], ["asm", "手动宽", 0], ["asm", "手动高", 0],
                  ["acc", "速度档位", DIRECT40], ["acc", "seed", 4002]],
    run: async (prompt, rec) => {
      queueCommon(prompt, rec, { type: "自由", pe: false, alpha: true });
      if (rec.skipPost) return;
      const { assembly } = buildAssembly(prompt, "自由", rec);
      const sel = N(prompt, 4014)?.inputs || {};
      const probe = await composeProbe({
        mode: "compose", 装配全文: assembly, PE出文: null,
        pe开关: false, 透明模式: true,
        RGBA官方头句: sel.RGBA官方头句, RGBA官方尾句: sel.RGBA官方尾句, W1收束句: sel.W1收束句,
      });
      const expectText = `${sel.RGBA官方头句} ${assembly} ${sel.W1收束句} ${sel.RGBA官方尾句}`;
      rec.expect = { assemblyLen: assembly.length, assemblyMd5: md5(assembly), formulaMd5: md5(expectText), probe };
      check("f2 证2·compose 实调(pe关+透明开)== 头句+装配全文+W1+尾句 公式逐字(两路独立构造同 md5)",
        probe.exit === 0 && probe.md5 === md5(expectText),
        `probe md5=${probe.md5};公式 md5=${md5(expectText)};len=${probe.len}/${expectText.length}${probe.error ? ";ERR=" + probe.error : ""}`);
      rec.expectMd5 = probe.md5;
    },
    after: async (prompt, exec, rec) => {
      lazyEvidence(exec, rec, rec.logBefore);
      const delta = readLog(rec.logBefore);
      rec.freeBaseLog = { neutralWarnHits: (delta.match(/自由型此为正常态/g) || []).length };
      check("f2 文证:装配器中性化警告在场(「自由型此为正常态」,BASE 空降级)",
        rec.freeBaseLog.neutralWarnHits >= 1, `hits=${rec.freeBaseLog.neutralWarnHits}`);
      check("f2 证3·[401] 预览 md5 == 进编码文本 md5(包裹式逐字)",
        rec.finalTextMd5 === rec.expectMd5,
        `预览 md5=${rec.finalTextMd5};期望 md5=${rec.expectMd5};len=${rec.finalTextLen}`);
      const sel = N(prompt, 4014)?.inputs || {};
      const ft = typeof rec.finalText === "string" ? rec.finalText : "";
      check("f2 结构文证:预览=头句前缀+尾句后缀+W1 在位(逐字)",
        ft.startsWith(sel.RGBA官方头句) && ft.endsWith(sel.RGBA官方尾句) && ft.includes(sel.W1收束句),
        `head=${ft.slice(0, 20)}…tail=${ft.slice(-20)}…`);
    },
  },
  {
    key: "f3-free-peon-alpha", seed: 4003,
    note: "f3 自由型·pe开·透明开:进编码文本=头句+剥离(PE出文)+W1+尾句(结构逐字+重构 md5);PE 文证",
    panel: () => [["asm", "型选择", "自由"], ["asm", "PE启用?", true], ["asm", "透明", true], ["asm", "手动宽", 0], ["asm", "手动高", 0],
                  ["acc", "速度档位", DIRECT40], ["acc", "seed", 4003]],
    run: async (prompt, rec) => {
      queueCommon(prompt, rec, { type: "自由", pe: true, alpha: true });
      if (rec.skipPost) return;
      const sel = N(prompt, 4014)?.inputs || {};
      check("f3 证1·PE路接线:[4013].prompt←[4011,0]/.clip←[4019,0]/[4014].PE出文←[4013,0]",
        isLink(N(prompt, 4013)?.inputs?.prompt, 4011, 0) && isLink(N(prompt, 4013)?.inputs?.clip, 4019, 0)
          && isLink(sel?.PE出文, 4013, 0),
        `prompt=${JSON.stringify(N(prompt, 4013)?.inputs?.prompt)};PE出文=${JSON.stringify(sel?.PE出文)}`);
      check("f3 证1·[4018].wh_ratio←[4013,2](PE建议画幅,pe开路拉起)", isLink(N(prompt, 4018)?.inputs?.wh_ratio, 4013, 2),
        JSON.stringify(N(prompt, 4018)?.inputs?.wh_ratio));
      check("f3 证1·thinking 预览接线原样(Q2):6:4020.anything←[4013,3]",
        isLink(N(prompt, 4020)?.inputs?.anything, 4013, 3), JSON.stringify(N(prompt, 4020)?.inputs?.anything));
      rec.selWidgets = { head: sel.RGBA官方头句, tail: sel.RGBA官方尾句, w1: sel.W1收束句 };
    },
    after: async (prompt, exec, rec) => {
      peEvidence(exec, rec, rec.logBefore);
      const ft = typeof rec.finalText === "string" ? rec.finalText : "";
      const { head, tail, w1 } = rec.selWidgets || {};
      // 结构逐字:头句前缀+尾句后缀
      check("f3 结构文证:预览=头句逐字前缀+尾句逐字后缀",
        ft.startsWith(head) && ft.endsWith(tail), `head20=${ft.slice(0, 20)}…;tail20=${ft.slice(-20)}…`);
      // 中段=剥离(PE出文)+" "+W1
      const mid = ft.length > head.length + tail.length + 2 ? ft.slice(head.length + 1, ft.length - tail.length - 1) : "";
      const midOk = mid.endsWith(w1);
      const stripped = midOk ? mid.slice(0, mid.length - w1.length - 1) : "";
      check("f3 结构文证:中段以 W1 收束句收尾(剥离(PE出文)+空格+W1 拼接形)", midOk && stripped.length > 100,
        `midLen=${mid.length};strippedLen=${stripped.length};w1Len=${(w1 || "").length}`);
      rec.f3mid = { midLen: mid.length, strippedLen: stripped.length };
      if (!midOk || !stripped) return;
      // 词族零命中:实调 strip(stripped)==stripped(已剥离干净)
      const stripProbe = await composeProbe({ mode: "strip", text: stripped });
      check("f3 剥离文证:中段剥离段对词族 pattern 零命中(实调 strip 幂等=PE出文已被剥离)",
        stripProbe.exit === 0 && stripProbe.changed === false,
        `changed=${stripProbe.changed};orig=${stripProbe.orig_len}/stripped=${stripProbe.stripped_len}${stripProbe.error ? ";ERR=" + stripProbe.error : ""}`);
      // 英文域(PE出文=英文长文;装配直写路=中文)
      const asciiRatio = stripped ? (stripped.match(/[\x20-\x7e]/g) || []).length / stripped.length : 0;
      check("f3 PE域文证:剥离段 ascii 占比>0.6(PE出文英文,非装配中文直写)", asciiRatio > 0.6,
        `asciiRatio=${asciiRatio.toFixed(2)};len=${stripped.length}`);
      // 证2+证3:compose 重构 md5 闭环(PE出文参数=剥离段,strip 幂等 → 输出应逐字重构预览)
      const probe = await composeProbe({
        mode: "compose", 装配全文: null, PE出文: stripped,
        pe开关: true, 透明模式: true, RGBA官方头句: head, RGBA官方尾句: tail, W1收束句: w1,
      });
      check("f3 证2·compose 重构(pe开+透明+PE出文=剥离段)md5 == [401] 预览 md5",
        probe.exit === 0 && probe.md5 === rec.finalTextMd5,
        `probe md5=${probe.md5};预览 md5=${rec.finalTextMd5}${probe.error ? ";ERR=" + probe.error : ""}`);
    },
  },
];

// ── 发次通用流程 ──
async function fireShot(shot, phase) {
  CUR_KEY = shot.key;
  const rec = { ...shot, startedAt: new Date().toISOString(), panelSets: [] };
  delete rec.run; delete rec.after;
  report.shots[shot.key] = rec;
  try {
    await loadWorkflow();
    await waitIdle();
    const logBefore = logSize();
    rec.logBefore = logBefore;
    await setPanel(shot.panel(), rec);
    const prompt = await dryPrompt();
    rec.promptNodes = Object.keys(prompt).length;
    await shot.run(prompt, rec);
    if (phase === "dryrun") {
      check("干跑(坑6):面板+排队图断言+expect 构造全通过(未 POST)", !rec.skipPost,
        rec.skipPost ? rec.skipReason : `expectMd5=${rec.expectMd5 || "(f3 运行时重构)"};promptNodes=${rec.promptNodes}`);
      return rec;
    }
    if (rec.skipPost) { check("发次 gate:面板生效(跳过 POST)", false, rec.skipReason); return rec; }
    const resp = await (await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
    })).json();
    if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) {
      check("POST /prompt 受理", false, JSON.stringify(resp).slice(0, 400)); return rec;
    }
    rec.pid = resp.prompt_id;
    log(`🚀 ${shot.key} 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=${shot.seed})`);
    const exec = await watchExecution(resp.prompt_id);
    rec.executedNodes = exec.executedNodes;
    rec.frameStats = { executing: exec.executedNodes.length, executed: exec.executedCount };
    rec.execErrors = exec.errors;
    if (exec.errors.length) check("执行零错误", false, exec.errors.join(" | "));
    const hist = await (await fetch(`${ENGINE}/history/${resp.prompt_id}`)).json();
    const h = hist[resp.prompt_id] || {};
    rec.historyStatus = h.status?.status_str || "(missing)";
    const outputs = h.outputs || {};
    const saveOut = Object.values(outputs).find((o) => o.images && o.images.length);
    if (!saveOut) { check("history 出图在位", false, JSON.stringify(Object.keys(outputs))); return rec; }
    const img = saveOut.images[0];
    const pngPath = join(OUT_DIR, `${shot.key}-seed${shot.seed}.png`);
    const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`)).arrayBuffer());
    writeFileSync(pngPath, buf);
    rec.png = pngPath; rec.pngBytes = buf.length;
    log(`🖼  ${shot.key} 出图 ${buf.length}B → ${pngPath.split("/").pop()}`);
    const textOf = (k) => { const o = outputs[k]; return o?.ui?.text?.[0] ?? o?.text?.[0] ?? null; };
    const finalText = textOf("401");
    if (typeof finalText === "string") {
      rec.finalText = finalText.length > 400 ? undefined : finalText;
      rec.finalTextLen = finalText.length;
      rec.finalTextMd5 = md5(finalText);
      if (finalText.length > 400) rec.finalTextHeadTail = finalText.slice(0, 60) + "…[" + finalText.length + "]…" + finalText.slice(-60);
    } else {
      check("[401] 预览文本在位(history ui.text)", false, JSON.stringify(Object.keys(outputs)));
    }
    if (shot.after) await shot.after(prompt, exec, rec);
    // alpha 判据=记录项非门(F4 口径:像素门人眼终审)
    const expect = shot.key.includes("alpha") ? "transparent" : "opaque";
    const alpha = await alphaCheck(pngPath, expect);
    writeFileSync(join(OUT_DIR, `alpha-${shot.key}.json`), JSON.stringify(alpha, null, 2));
    rec.alpha = { expect, pass: alpha.pass, verdict: alpha.verdict ?? "", ratio0: alpha?.metrics?.ratio0 ?? null };
    log(`🧪 alpha 记录(非门):expect=${expect} verdict=${alpha.verdict} ratio0=${rec.alpha.ratio0}`);
  } catch (e) {
    check("发次驱动异常", false, String(e && e.message));
    rec.error = String(e && e.message);
  }
  rec.finishedAt = new Date().toISOString();
  rec.secs = Math.round((new Date(rec.finishedAt) - new Date(rec.startedAt)) / 1000);
  writeReport();
  return rec;
}
function writeReport() {
  try { writeFileSync(join(OUT_DIR, "fire-report.json"), JSON.stringify(report, null, 2)); } catch {}
}

// ══ main ══
const PHASE = process.env.PHASE || "fire";
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version, `模式=${PHASE}`);
  // 证2 前置自检:compose 探针件=引擎家部署副本单口版(与在跑引擎同源)
  const selfProbe = await composeProbe({
    mode: "compose", 装配全文: "装配例文", PE出文: null, pe开关: false, 透明模式: false,
    RGBA官方头句: "H", RGBA官方尾句: "T", W1收束句: "W",
  });
  check("0.1 证2 前置:compose 探针实调通(引擎家部署副本单口版)", selfProbe.exit === 0 && selfProbe.md5 === md5("装配例文"),
    `md5=${selfProbe.md5};err=${selfProbe.error ?? ""}`);
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(2000);
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.key)) continue;
    log(`\n══ ${shot.key} — ${shot.note} ══`);
    await fireShot(shot, PHASE);
    if (PHASE === "dryrun") { loadedWf = true; } // 干跑共用一次装载
  }
} catch (e) {
  check("环境段", false, String(e && e.message));
} finally {
  report.finishedAt = new Date().toISOString();
  writeReport();
  try { page?.close(); } catch {}
  killChrome();
}
log("\n════ 单口实弹三发汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} [${r.shot}] ${r.name}`);
const failed = report.results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
