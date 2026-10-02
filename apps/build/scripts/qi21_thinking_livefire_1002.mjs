#!/usr/bin/env node
// qi21 thinking 预览端到端实弹(2026-10-02,usetest 档在册遗留定谳:段B)。
//
// 测法(档内口径):ENGINE_URL=17599 / CDP_PORT=9393,形态=qi21_biground_livefire_1002.mjs
// 同款(仓库真源原样装载 loadGraphData 零注入→面板 set+onWidgetChanged→graphToPrompt
// 现读换算→POST /prompt→WS 执行事件→/history 取文)。
//   segB-s2(=s2-t2i-pe-nine):②PE九型(人物,pe开默认,FunAcc)——thinking 三连:
//     排队图 6:4020.anything←[4013 槽3]/执行集含 6:4020/history 6:4020 文本非空
//     +PE 文证(6:4013/6:4019 执行+日志 pe_t2i 装载+最终文本=PE出文);
//   segB-s4(=s4-t2i-prop-follow):④道具型(pe关)——懒文证(执行集无 6:4013/6:4019
//     +日志零 pe_t2i TE 装载)+排队图无 6:4020(mode4 联动剪枝·真前端全链)。
//
// ⚠️ [505] 旁路注记(本测发现,非注入漂移):仓库真源 t2i [505].type=
//   'ImageComparer (rgthree)'(无空格)而引擎注册名='Image Comparer (rgthree)'
//   (rgthree-comfy py/constants.py:4-5 get_name 带空格),POST /prompt 拒
//   missing_node_type(c4ee942 批静态契约锁名未实调的欠账)。本驱动在真源装载后
//   仅对该纯预览件置 mode=4(执行态开关,零 widget 值写入;[505] 组框⑤外纯预览
//   端点,不伤出图主链与 thinking 链),取证后如实上报;三工作流真源零触碰。
//
// alpha 判据(ALPHA_PY)=软记录不设门(像素域=模型服从度域,本测法门=thinking/
// 剪枝/懒文证;run1 先例 s4 corners 判据曾红属该域)。产物 apps/output/thinking-preview-1002/。
// 退出码:0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9393);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/thinking-preview-1002`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const ENGINE_LOG = "/tmp/qi21-biground-1002/engine.log"; // 同引擎同日志(livefire 口径)
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const ACC = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-thinking-livefire-chrome-${Date.now()}`;
const FUNACC = "0 · Fun-Acc 4步";
const CLIENT_ID = `thinking-livefire-${Date.now()}`;
const md5 = (s) => createHash("md5").update(s).digest("hex");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "segB-thinking-livefire", engine: ENGINE, wf: WF, clientId: CLIENT_ID,
  note505: "真源[505].type='ImageComparer (rgthree)'≠引擎注册名'Image Comparer (rgthree)'(rgthree constants get_name 带空格)→装载后 mode4 旁路该纯预览件;真源零触碰",
  startedAt: new Date().toISOString(), shots: {}, results: [],
};
const check = (name, pass, detail = "") => {
  report.results.push({ shot: CUR_KEY, name, pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? "✅" : "❌"} [${CUR_KEY}] ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};
let CUR_KEY = "(env)";
const N = (p, k) => p[`6:${k}`];
const isLink = (v, node, slot) => Array.isArray(v) && v[0] === `6:${node}` && v[1] === slot;
const logSize = () => { try { return statSync(ENGINE_LOG).size; } catch { return 0; } };
// 修复(本测发现):原 readFileSync(utf8).slice(字节offset) 在多字节日志上越界
// (字节≠字符 offset,历史中文行使差>0)→增量恒空假象;改 Buffer 字节切片。
const readLog = (from) => { try { return readFileSync(ENGINE_LOG).subarray(from).toString("utf8"); } catch { return ""; } };

let chromeProc = null, page = null;
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
  let target = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (target) break;
    } catch {}
    await sleep(1200);
  }
  if (!target) throw new Error("引擎前端 page target 未出现(90s)");
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
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
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
      return r.result.value;
    },
  };
}
async function waitFor(fn, { timeout = 90_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}
async function waitIdle() {
  for (let i = 0; i < 720; i++) {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(5000);
  }
  throw new Error("引擎队列 60min 未空闲");
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
async function dryPrompt() {
  const raw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(raw).startsWith("ERR:")) throw new Error("graphToPrompt 干跑失败: " + String(raw).slice(0, 300));
  return JSON.parse(String(raw));
}
function watchExecution(pid) {
  // WS 先连后 POST 由调用方保证(preWatch 返回 {await, dispose});本函数保留为
  // 兼容形态:立即连(调用方已在 POST 前调用 preWatch 时不会走到这里)。
  return preWatch().await(pid);
}
// 修复(本测发现):livefire 原版 POST 后才连 WS,毫秒级节点(6:4010/6:4011)
// 的 executing 事件在握手完成前发完即丢——本驱动先连 WS(clientId 定向)再 POST。
function preWatch() {
  let ws;
  const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now(), done: false };
  const events = [];
  let awaitFn = null;
  ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  const startedAt = Date.now();
  let timer = null;
  const cleanup = () => { if (timer) clearInterval(timer); try { ws.close(); } catch {} };
  ws.on("open", () => { state.connected = true; });
  ws.on("error", (e) => { state.wsError = String(e && e.message); });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    state.lastActivity = Date.now();
    const d = m.data || {};
    if (m.type === "executing" && d.prompt_id === state.pid) {
      if (d.node === null) { state.done = true; cleanup(); state.resolve?.(state); }
      else if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
    } else if (m.type === "executed" && d.prompt_id === state.pid) state.executedCount += 1;
    else if (m.type === "execution_error" && (d.prompt_id === state.pid || !d.prompt_id)) {
      state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400)); cleanup(); state.resolve?.(state);
    } else if (m.type === "execution_interrupted" && d.prompt_id === state.pid) {
      state.errors.push("interrupted"); cleanup(); state.resolve?.(state);
    }
  });
  state.await = (pid) => {
    state.pid = pid;
    return new Promise((resolve, reject) => {
      state.resolve = resolve;
      timer = setInterval(() => {
        if (Date.now() - state.lastActivity > 20 * 60_000) { cleanup(); reject(new Error("执行停滞:>20min 无事件")); }
        if (Date.now() - startedAt > 70 * 60_000) { cleanup(); reject(new Error("单发超时 70min")); }
      }, 30_000);
      if (state.done || state.errors.length) { cleanup(); resolve(state); } // 已完成(极快发)
    });
  };
  state.connectedP = new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  return state;
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

function queueCommon(p, rec, { type, pe, alpha }) {
  const b = N(p, 4010), sel = N(p, 4014), pb = N(p, 4012), wh = N(p, 4018), peNode = N(p, 4013);
  check("排队图 [4010].base=型/透明覆盖=面板布尔", b?.inputs?.base === type && b?.inputs?.透明覆盖 === alpha,
    JSON.stringify({ base: b?.inputs?.base, 透明覆盖: b?.inputs?.透明覆盖 }));
  const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
  check("排队图 [4012] PrimitiveBoolean=面板PE值(㉑节点化)", peVal === pe, String(peVal));
  check("排队图 [4014].pe开关/[4018].联动开关←[4012,0](单源扇出)",
    isLink(sel?.inputs?.pe开关, 4012, 0) && isLink(wh?.inputs?.联动开关, 4012, 0),
    `pe开关=${JSON.stringify(sel?.inputs?.pe开关)};联动=${JSON.stringify(wh?.inputs?.联动开关)}`);
  check("排队图 [4014].透明模式←[4010 槽3](透明值;[4017] 已删不查)",
    isLink(sel?.inputs?.透明模式, 4010, 3), JSON.stringify(sel?.inputs?.透明模式));
  check("排队图 [4013].prompt←[4011,0]/.clip←[4019,0](⑬迁入直连)",
    isLink(peNode?.inputs?.prompt, 4011, 0) && isLink(peNode?.inputs?.clip, 4019, 0),
    `prompt=${JSON.stringify(peNode?.inputs?.prompt)};clip=${JSON.stringify(peNode?.inputs?.clip)}`);
  rec.pe12Resolved = peVal;
  if (!(b?.inputs?.base === type && peVal === pe)) { rec.skipPost = true; rec.skipReason = "[4010]/[4012] 面板锚失配"; }
}
function peT2i(exec, rec, logBefore) {
  check("PE 文证:6:4013(PE改写)+6:4019(PE专属TE)在执行集",
    exec.executedNodes.includes("6:4013") && exec.executedNodes.includes("6:4019"),
    `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  rec.peLog = { logDeltaBytes: delta.length, peTeLoads: peLoads };
  check("PE 文证:引擎日志增量含 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads >= 1, `装载指纹=${peLoads}`);
}
function lazyT2i(exec, rec, logBefore) {
  check("懒文证:PE关 → 6:4013(PE改写)不执行+6:4019(PE专属TE)不装载(执行级裁剪)",
    !exec.executedNodes.includes("6:4013") && !exec.executedNodes.includes("6:4019"),
    `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  const echoHits = (delta.match(/pe_t2i/g) || []).length;
  rec.lazyLog = { logDeltaBytes: delta.length, peTeLoads: peLoads, peEchoHits: echoHits };
  check("懒文证:引擎日志增量零 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads === 0,
    `装载指纹=${peLoads};回显命中=${echoHits}(增量 ${delta.length}B)`);
}

const SHOTS = [
  {
    key: "segB-s2", seed: 3002, speed: FUNACC, expect: "opaque",
    note: "②PE九型(人物,pe开默认,FunAcc默认档);thinking 三连+PE 文证",
    panel: () => [["asm", "型选择", "人物"], ["asm", "PE启用?", true], ["asm", "透明", false], ["asm", "手动宽", 0], ["asm", "手动高", 0]],
    run: (p, rec) => {
      queueCommon(p, rec, { type: "人物", pe: true, alpha: false });
      check("thinking 文证①排队图:6:4020.anything←[4013 槽3](预览件在排队图)",
        isLink(N(p, 4020)?.inputs?.anything, 4013, 3), JSON.stringify(N(p, 4020)?.inputs?.anything));
      check("排队图 [4018].wh_ratio←[4013,2](PE建议画幅)", isLink(N(p, 4018)?.inputs?.wh_ratio, 4013, 2),
        JSON.stringify(N(p, 4018)?.inputs?.wh_ratio));
    },
    after: (p, exec, rec) => {
      peT2i(exec, rec, rec.logBefore);
      check("thinking 文证②执行集:6:4020(PE思考预览)在执行集(Q5)", exec.executedNodes.includes("6:4020"),
        `6:4020=${exec.executedNodes.includes("6:4020")}`);
      check("thinking 文证③history:6:4020 文本非空(画布可看推理)", typeof rec.thinkingLen === "number" && rec.thinkingLen > 50,
        `thinkingLen=${rec.thinkingLen}`);
      const ft = typeof rec.finalText === "string" ? rec.finalText : "";
      const asciiRatio = ft ? (ft.match(/[\x20-\x7e]/g) || []).length / ft.length : 0;
      check("PE 文证:最终文本=PE出文(英文长文,装配直写路=中文)", ft.length > 200 && asciiRatio > 0.6,
        `len=${rec.finalTextLen};asciiRatio=${asciiRatio.toFixed(2)}`);
      check("执行集含 7:7013(FunAcc 4步支路,⑱默认档)", exec.executedNodes.includes("7:7013"),
        `7:7013=${exec.executedNodes.includes("7:7013")}`);
    },
  },
  {
    key: "segB-s4", seed: 3004, speed: FUNACC, expect: "transparent",
    note: "④道具型(pe关)——懒文证+排队图无 6:4020(mode4 联动剪枝·真前端全链)",
    panel: () => [["asm", "型选择", "道具"], ["asm", "PE启用?", false], ["asm", "透明", false], ["asm", "手动宽", 0], ["asm", "手动高", 0]],
    run: (p, rec) => {
      queueCommon(p, rec, { type: "道具", pe: false, alpha: false });
      check("联动剪枝·排队图:PE关 → 6:4020 不在排队图(mode4 旁路剪枝)",
        !(("6:4020") in p), `hits=${Object.keys(p).filter((k) => k.includes("4020"))}`);
    },
    after: (p, exec, rec) => {
      lazyT2i(exec, rec, rec.logBefore);
      check("联动剪枝·执行集:PE关 → 6:4020 不执行(零预览成本)",
        !exec.executedNodes.includes("6:4020"), `6:4020=${exec.executedNodes.includes("6:4020")}`);
      check("执行集含 6:4011(装配)与 7:7013(FunAcc 支路,主链无伤)",
        exec.executedNodes.includes("6:4011") && exec.executedNodes.includes("7:7013"),
        `6:4011=${exec.executedNodes.includes("6:4011")} 7:7013=${exec.executedNodes.includes("7:7013")}`);
    },
  },
];

async function fireShot(shot) {
  CUR_KEY = shot.key;
  const rec = { ...shot, startedAt: new Date().toISOString(), panelSets: [] };
  delete rec.run; delete rec.after;
  report.shots[shot.key] = rec;
  try {
    await waitIdle();
    const logBefore = logSize();
    rec.logBefore = logBefore;
    for (const [which, name, val] of shot.panel()) {
      const r = await page.ev(setViaHook(which === "asm" ? ASM : ACC, name, val));
      rec.panelSets.push(`${which}.${name}=${val}: ${r}`);
      if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${which}.${name}`, false, r);
    }
    const spd = await page.ev(setViaHook(ACC, "速度档位", shot.speed));
    rec.panelSets.push(`acc.速度档位=${shot.speed}: ${spd}`);
    const sd = await page.ev(setViaHook(ACC, "seed", shot.seed));
    rec.panelSets.push(`acc.seed=${shot.seed}: ${sd}`);

    const prompt = await dryPrompt();
    rec.promptNodes = Object.keys(prompt).length;
    rec.has505inPrompt = "505" in prompt || "5:505" in prompt;

    await shot.run(prompt, rec);
    if (rec.skipPost) { check("发次 gate:面板生效", false, rec.skipReason); return rec; }

    // 先连 WS(clientId 定向)再 POST——毫秒级前置节点事件不再丢(本测修复)
    const watch = preWatch();
    try { await watch.connectedP; } catch (e) { check("WS 预连", false, String(e && e.message)); }

    const resp = await (await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
    })).json();
    if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) {
      check("POST /prompt 受理", false, JSON.stringify(resp).slice(0, 400)); return rec;
    }
    rec.pid = resp.prompt_id;
    log(`🚀 ${shot.key} 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=${shot.seed})`);

    const exec = await watch.await(resp.prompt_id);
    rec.executedNodes = exec.executedNodes;
    rec.execErrors = exec.errors;
    if (exec.errors.length) check("执行零错误", false, exec.errors.join(" | "));

    const hist = await (await fetch(`${ENGINE}/history/${resp.prompt_id}`)).json();
    const h = hist[resp.prompt_id] || {};
    rec.historyStatus = h.status?.status_str || "(missing)";
    check("history status=success", rec.historyStatus === "success", rec.historyStatus);
    const outputs = h.outputs || {};
    const saveOut = Object.values(outputs).find((o) => o.images && o.images.length);
    if (!saveOut) { check("history 出图在位", false, JSON.stringify(Object.keys(outputs)).slice(0, 200)); return rec; }
    const img = saveOut.images[0];
    rec.savedImage = `${img.subfolder}/${img.filename}`;
    const pngPath = join(OUT_DIR, `${shot.key}-seed${shot.seed}.png`);
    const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`)).arrayBuffer());
    writeFileSync(pngPath, buf);
    rec.png = pngPath;
    log(`🖼  ${shot.key} 出图 ${buf.length}B → ${pngPath.split("/").pop()}`);

    const textOf = (k) => { const o = outputs[k]; return o?.ui?.text?.[0] ?? o?.text?.[0] ?? null; };
    rec.finalText = textOf("401");
    if (typeof rec.finalText === "string") {
      rec.finalTextLen = rec.finalText.length;
      rec.finalTextMd5 = md5(rec.finalText);
      rec.finalTextHead = rec.finalText.slice(0, 120); // 断言先于截断(修复:原版挪删致 ascii 断言假红)
    }
    const think = textOf("6:4020");
    if (think !== null) rec.thinkingLen = typeof think === "string" ? think.length : -1;
    rec.thinkingHead = typeof think === "string" ? think.slice(0, 120) : null;

    await shot.after(prompt, exec, rec);
    if (typeof rec.finalText === "string" && rec.finalText.length > 400) rec.finalText = undefined; // 报告不留长全文

    if (shot.expect) { // 软记录:像素域不设门
      const alpha = await alphaCheck(pngPath, shot.expect);
      writeFileSync(join(OUT_DIR, `alpha-${shot.key}.json`), JSON.stringify(alpha, null, 2));
      rec.alpha = alpha;
      log(`🔎 alpha 软记录(${shot.key}):${alpha.verdict || ""} pass=${alpha.pass}`);
    }
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
  try { writeFileSync(join(OUT_DIR, "segB-livefire-report.json"), JSON.stringify(report, null, 2)); } catch {}
}

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("0.1 引擎已列面板联动扩展", exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"), "");

  // [505] 类名不匹配取证(object_info 现读 vs 真源静态)
  const oi = await (await fetch(`${ENGINE}/object_info`)).json();
  const comparerKey = Object.keys(oi).find((k) => /comparer/i.test(k));
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const n505 = wfJson.nodes.find((n) => n.id === 505);
  report.mismatch505 = { engineKey: comparerKey, wfType: n505?.type, equal: comparerKey === n505?.type };
  check("0.2 [505] 类名匹配(引擎注册名 vs 真源 type)", comparerKey === n505?.type,
    `engine='${comparerKey}' wf='${n505?.type}'(不匹配→mode4 旁路纯预览件,注记在册)`);

  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(2000);
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'thinking-livefire-1002');
    return 'opened';
  })()`);
  if (opened !== "opened") throw new Error("loadGraphData 失败: " + opened);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(2000);
  log("📂 t2i 真源已装载(16 节点)");

  // [505] mode4 旁路(执行态开关;类名不匹配绕行,主链零伤)
  if (comparerKey !== n505?.type) {
    const bypassed = await page.ev(`(() => {
      const n = window.app.graph._nodes.find((x) => String(x.id) === '505');
      if (!n) return 'no-505';
      n.mode = 4; return 'bypassed:' + n.mode;
    })()`);
    report.bypass505 = bypassed;
    log(`⚠️  [505] mode4 旁路(纯预览件,类名不匹配绕行):${bypassed}`);
  }

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
log("\n════ 段B thinking 实弹汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} [${r.shot}] ${r.name}`);
const failed = report.results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
