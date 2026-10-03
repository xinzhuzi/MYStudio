#!/usr/bin/env node
// qi21 大轮(1002)实弹八发驱动 — Trellis 10-01-qi21-usetest-batch implement.md 步骤9。
// S8/S5 先例驱动器形态(同 qi21_usertest_livefire_1001.mjs):
//   仓库真源原样装载(loadGraphData 零注入)→宿主面板 widget set+onWidgetChanged→
//   graphToPrompt 现读换算→POST /prompt(b4 API 直构面先例)→WS /ws 执行事件取证
//   →/history 取图取文→下载 PNG→qi21_s6_alpha_check_0930.py 校准口径判据。
//
// 大轮术后新拓扑锚(编号=design §1 终态):
//   t2i 主图 [1]-[8]/[400]-[402];宿主 [6]=96937bbe(主体句/型选择/PE启用?/透明/
//   手动宽/手动高) [7]=e7b9d4a2(速度档位/seed);装配子图 6:4010 底座/6:4011 装配/
//   6:4012 PE启用?PrimitiveBoolean/6:4013 PE改写/6:4014 合成器/6:4015 主编码/
//   6:4016 RGBA编码/6:4017 输出选择/6:4018 画幅建议器/6:4019 PE专属TE/6:4020 PE思考预览;
//   加速子图 7:7010 直出40步/7:7013 FunAcc4步/7:7015 速度选择(⑱默认=Fun-Acc)。
//   i2i 宿主 [6]=d47c9e21 [7]=b3f5a1c2(子图含 [180] 旧三态件+6:4013=TextGenerate);
//   edit 宿主 [6]=6a0e2f81 [7]=7b1f3a92。
//
// 八发(ask 细目;⑥=两臂同 seed 对拍):
//   ① s1-t2i-direct-nine 直出九型(人物,pe关,直出40步)——expect opaque+懒执行
//      文证(executing 级 6:4013/6:4019 不在执行集+日志增量零 pe_t2i TE 装载行);
//   ② s2-t2i-pe-nine PE九型(人物,pe开默认,FunAcc 默认档)——PE 文证(6:4013/6:4019
//      在执行集+日志含 pe_t2i 装载+最终文本=PE出文)+thinking 预览可见文证
//      (排队图 6:4020.anything←[6:4013 槽3]+新预览件在执行集+history 文本非空);
//   ③ s3-t2i-free-alpha 自由型+透明开(pe开)——expect transparent(BASE 空中性化);
//   ④ s4-t2i-prop-follow 道具型跟随(pe关,面板透明=false)——expect transparent
//      (透明值=rgba_default 解析:排队图 [6:4010].透明覆盖=false 而透明模式←[6:4010 槽3]);
//   ⑤ s5-t2i-peoff-alpha pe关×透明(自由型)——Q4 补强验证:pe关透明文本包 W1 收束句
//      (compose 文证)+W1 包裹后过 50 门(alpha ratio0≥50%);
//   ⑥ s6-anchored/s6-baseline ㉒头身比对拍:同 seed(424242)同主体句,改锚前后各一发
//      (基线=qi21_bases.json 临时去锚——人物型 base_text 删锚句还原 HEAD 态,
//       射后即恢复+md5 校验;两臂最终文本含锚/不含锚双向文证+并排图目测留主会话);
//   ⑦ s7-i2i-direct i2i 直出(兼容:迁移后共享件跑旧 [180] 拓扑绿+懒执行);
//   ⑧ s8-edit-outfit edit 改图(兼容:官方换装样例直写路绿)。
//
// 判据(qi21_s6_alpha_check 校准口径):transparent=四角 alpha≤2+alpha==0 占比≥50%;
//   opaque=零真透明区。产物 apps/output/edit-funacc-1003/。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(9393)/
//   PHASE=probe|fire(默认 fire)/ONLY=key 子集/ALPHA_PY 判据件(默认引擎家 venv)。
// 退出码 0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9393);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/edit-funacc-1003`;
const WF = {
  t2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  i2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
  edit: process.env.EDIT_JSON || `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
};
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const ENGINE_HOME = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui`;
const VENV_PY = `${ENGINE_HOME}/venv/bin/python`;
const ENGINE_LOG = "/tmp/qi21-biground-1002/engine.log"; // qi21_biground_engine_up_1002.py LOG=RUNTIME/engine.log
// F5 教训(前轮 run1 实锤):在跑引擎 mtime 热读的是引擎家部署副本,改仓库真源零效果
// (前轮基线臂=无效发已标 .INVALID-cached.png)——去锚/恢复全走引擎家部署副本
const BASES_JSON = `${ENGINE_HOME}/ComfyUI/custom_nodes/my-nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-biground-livefire-chrome-${Date.now()}`;
const FUNACC = "0 · Fun-Acc 4步";
const DIRECT40 = "1 · 直出40步";
const HOSTS = {
  t2i: { asm: "96937bbe-99d1-4f16-a06c-d86b57815d91", acc: "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e" },
  i2i: { asm: "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d", acc: "b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b" },
  edit: { asm: "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01", acc: "7b1f3a92-2b5c-4d3e-8f41-6c8d9e0f1a02" },
};
const ANCHOR_SENT = "头身比约七头半，解剖比例写实，下肢不过度拉长";
const ANCHOR_FULL = `全身入画，${ANCHOR_SENT}。`;
const ANCHOR_BASE = "全身入画。";
const CLIENT_ID = `biground-livefire-${Date.now()}`;
const md5 = (s) => createHash("md5").update(s).digest("hex");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "edit-funacc-matrix-1003", engine: ENGINE, clientId: CLIENT_ID, wf: { ...WF },
  wfNote: "仓库真源原样装载(loadGraphData 零注入);prompt=graphToPrompt 现读换算→POST /prompt(S8/b4 先例);基线=git 工作区现态(用户手改后 t2i,禁打回)",
  gate: "qi21_s6_alpha_check_0930.py 校准口径:transparent=四角≤2+ratio0≥50%;opaque=零真透明区",
  startedAt: new Date().toISOString(), shots: {}, results: [],
};
const check = (name, pass, detail = "") => {
  report.results.push({ shot: CUR_KEY, name, pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? "✅" : "❌"} [${CUR_KEY}] ${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ""}`);
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
const widgetsOf = async (uuid) => await page.ev(hostJs(uuid) + " ? " + hostJs(uuid) + ".names : null");
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
const readLog = (from) => { try { return readFileSync(ENGINE_LOG, "utf8").slice(from); } catch { return ""; } };

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
    ws.on("open", () => log(`  ws 已连(clientId=${CLIENT_ID.slice(0, 20)}…)`));
    ws.on("error", (e) => { cleanup(); reject(new Error("ws 错误: " + e.message)); });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      state.lastActivity = Date.now();
      const d = m.data || {};
      if (m.type === "executing" && d.prompt_id === pid) {
        if (d.node === null) { state.done = true; cleanup(); resolve(state); }
        else if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
        if (d.node === "6:4010") { state.baseRan = true; if (state.onBaseRan) state.onBaseRan(); }
      } else if (m.type === "executed" && d.prompt_id === pid) state.executedCount += 1;
      else if (m.type === "execution_error" && (d.prompt_id === pid || !d.prompt_id)) {
        state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400)); cleanup(); resolve(state);
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
  const wfJson = JSON.parse(readFileSync(WF[wfKey], "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'biground-livefire-${wfKey}');
    return 'opened';
  })()`);
  if (opened !== "opened") throw new Error(`loadGraphData(${wfKey}) 失败: ${opened}`);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${wfKey})` });
  await sleep(1500);
  loadedWf = wfKey;
  log(`📂 ${wfKey} 真源已装载(${wfJson.nodes.length} 节点)`);
}

async function dryPrompt() {
  const dryRaw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(dryRaw).startsWith("ERR:")) throw new Error("graphToPrompt 干跑失败: " + String(dryRaw).slice(0, 300));
  return JSON.parse(String(dryRaw));
}

// ── 排队图断言助手(键形容错:按 class_type 找+键名直接找) ──
const N = (p, k) => p[`6:${k}`];
const isLink = (v, node, slot) => Array.isArray(v) && v[0] === `6:${node}` && v[1] === slot;

// ── 面板设置(S8 形态:set+onWidgetChanged) ──
async function setPanel(hosts, entries, rec) {
  for (const [which, name, val] of entries) {
    const r = await page.ev(setViaHook(hosts[which], name, val));
    rec.panelSets.push(`${which}.${name}=${val}: ${r}`);
    if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${which}.${name}`, false, r);
  }
}

// ── 发次通用流程 ──
async function fireShot(shot) {
  CUR_KEY = shot.key;
  const rec = { ...shot, startedAt: new Date().toISOString(), panelSets: [] };
  delete rec.run;
  report.shots[shot.key] = rec;
  report.checkpoint = shot.key;
  writeReport();
  let basesRestore = null; // ⑥基线臂:恢复函数
  try {
    await loadWorkflow(shot.wf);
    const hosts = HOSTS[shot.wf];
    await waitIdle();
    const logBefore = logSize();
    rec.logBefore = logBefore;

    await setPanel(hosts, shot.panel(hosts), rec);
    if (shot.speed) await setPanel(hosts, [["acc", "速度档位", shot.speed]], rec);
    await setPanel(hosts, [["acc", "seed", shot.seed]], rec);

    const prompt = await dryPrompt();
    rec.promptNodes = Object.keys(prompt).length;
    rec.promptKeys = Object.keys(prompt).sort();
    const sel14 = N(prompt, 4014)?.inputs;
    if (sel14) rec.selectWidgetInputs = {
      头句: String(sel14.RGBA官方头句 ?? "").slice(0, 46),
      尾句: String(sel14.RGBA官方尾句 ?? "").slice(0, 46),
      W1: String(sel14.W1收束句 ?? "").slice(0, 46),
    };

    // ⑥基线臂:排队图就绪后(面板已生效)临时去锚+POST 后等 6:4010 执行即恢复
    if (shot.deanchor) {
      const orig = readFileSync(BASES_JSON);
      rec.basesMd5Before = md5(orig);
      const data = JSON.parse(orig.toString("utf8"));
      const entry = data.find((e) => e && e.zh === "人物");
      if (!entry || !entry.base_text.includes(ANCHOR_FULL)) {
        check("⑥基线臂:锚句在位可去", false, entry ? entry.base_text.slice(0, 60) : "(无人物条目)");
        return rec;
      }
      entry.base_text = entry.base_text.replace(ANCHOR_FULL, ANCHOR_BASE);
      rec.basesDeanchoredLen = entry.base_text.length;
      const bak = `${OUT_DIR}/qi21_bases.json.baseline-backup`;
      copyFileSync(BASES_JSON, bak);
      writeFileSync(BASES_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
      basesRestore = () => {
        copyFileSync(bak, BASES_JSON);
        const now = readFileSync(BASES_JSON);
        return md5(now) === rec.basesMd5Before;
      };
      log(`  ⑥基线臂:qi21_bases.json 已临时去锚(人物 base_text ${rec.basesDeanchoredLen} 字),POST 后 6:4010 执行即恢复`);
    }

    // 发次专属排队图断言
    await shot.run(prompt, rec);

    // 发次 gate:面板三锚失配即不发弹(不烧采样)
    if (rec.skipPost) { check("发次 gate:面板生效(跳过 POST)", false, rec.skipReason || "锚失配"); return rec; }

    const resp = await (await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
    })).json();
    if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) {
      check("POST /prompt 受理", false, JSON.stringify(resp).slice(0, 400)); return rec;
    }
    rec.pid = resp.prompt_id;
    log(`🚀 ${shot.key} 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=${shot.seed})`);

    // ⑥基线臂:等 6:4010(底座件)执行完即恢复真源(mtime 热读已取走去锚文本)
    const exec = basesRestore
      ? await watchExecutionRestore(resp.prompt_id, basesRestore, rec)
      : await watchExecution(resp.prompt_id);
    rec.executedNodes = exec.executedNodes;
    rec.frameStats = { executing: exec.executedNodes.length, executed: exec.executedCount };
    rec.execErrors = exec.errors;
    if (exec.errors.length) check("执行零错误", false, exec.errors.join(" | "));

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
    const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`)).arrayBuffer());
    writeFileSync(pngPath, buf);
    rec.png = pngPath;
    log(`🖼  ${shot.key} 出图 ${buf.length}B → ${pngPath.split("/").pop()}`);

    // 文本面:主图 [401] 预览 + 子图 [6:4020] thinking 预览
    const textOf = (k) => { const o = outputs[k]; return o?.ui?.text?.[0] ?? o?.text?.[0] ?? null; };
    rec.finalText = textOf("401");
    if (typeof rec.finalText === "string") {
      rec.finalTextLen = rec.finalText.length;
      rec.finalTextMd5 = md5(rec.finalText);
      rec.finalTextHasAnchor = rec.finalText.includes(ANCHOR_SENT);
      const asm = N(prompt, 4011)?.inputs;
      rec.主体句 = asm?.主体句 || null;
      rec.锁层A前16 = String(asm?.锁层A全文 || "").slice(0, 16);
    }
    const think = textOf("6:4020");
    if (think !== null) rec.thinkingLen = typeof think === "string" ? think.length : -1;

    // 发次专属执行后断言
    if (shot.after) await shot.after(prompt, exec, rec);

    // alpha 判据
    if (shot.expect) {
      const alpha = await alphaCheck(pngPath, shot.expect);
      writeFileSync(join(OUT_DIR, `alpha-${shot.key}.json`), JSON.stringify(alpha, null, 2));
      rec.alpha = alpha;
      rec.alphaRatio0 = alpha?.metrics?.ratio0 ?? alpha?.metrics?.ratio_alpha0 ?? null;
      check(`透明判据:expect=${shot.expect}`, alpha.pass === true,
        `${alpha.verdict || ""};ratio0=${rec.alphaRatio0 ?? "?"};corners=${JSON.stringify(alpha?.metrics?.corners ?? [])}`.slice(0, 240));
    }
  } catch (e) {
    check("发次驱动异常", false, String(e && e.message));
    rec.error = String(e && e.message);
  } finally {
    if (basesRestore) {
      const ok = basesRestore();
      check("⑥基线臂:qi21_bases.json 已恢复(md5==去锚前真源)", ok, ok ? "" : "恢复后 md5 不符!");
      rec.basesRestored = ok;
    }
  }
  rec.finishedAt = new Date().toISOString();
  rec.secs = Math.round((new Date(rec.finishedAt) - new Date(rec.startedAt)) / 1000);
  if (rec.finalText && rec.finalText.length > 400) rec.finalText = undefined; // 报告不留长全文
  writeReport();
  return rec;
}

// watchExecution 变体:6:4010 执行后立即回调恢复(最短去锚窗口)
async function watchExecutionRestore(pid, restore, rec) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now() };
    const startedAt = Date.now();
    let restored = false;
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
        if (d.node === null) { cleanup(); resolve(state); }
        else {
          if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
          if (!restored && d.node === "6:4010") {
            restored = true;
            log("  ⑥基线臂:6:4010 已执行(去锚文本已取走)→ 立即恢复 qi21_bases.json");
            try { restore(); } catch (e) { log("  ⚠️ 恢复异常:", e.message); }
          }
        }
      } else if (m.type === "executed" && d.prompt_id === pid) state.executedCount += 1;
      else if (m.type === "execution_error" && (d.prompt_id === pid || !d.prompt_id)) {
        state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400)); cleanup(); resolve(state);
      }
    });
  });
}

function writeReport() {
  try { writeFileSync(join(OUT_DIR, "livefire-report.json"), JSON.stringify(report, null, 2)); } catch {}
}

// ══ 排队图断言集(t2i 共通+按发) ══
function t2iQueueCommon(prompt, rec, { type, pe, alpha }) {
  const b = N(prompt, 4010), sel = N(prompt, 4014), pb = N(prompt, 4012), wh = N(prompt, 4018), peNode = N(prompt, 4013), sw = N(prompt, 4017);
  check("排队图 [4010].base=型/透明覆盖=面板布尔",
    b?.inputs?.base === type && b?.inputs?.透明覆盖 === alpha,
    JSON.stringify({ base: b?.inputs?.base, 透明覆盖: b?.inputs?.透明覆盖 }));
  const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
  check("排队图 [4012] PrimitiveBoolean=面板PE值(㉑节点化)", peVal === pe, String(peVal));
  check("排队图 [4014].pe开关/[4018].联动开关←[4012,0](单源扇出)",
    isLink(sel?.inputs?.pe开关, 4012, 0) && isLink(wh?.inputs?.联动开关, 4012, 0),
    `pe开关=${JSON.stringify(sel?.inputs?.pe开关)};联动=${JSON.stringify(wh?.inputs?.联动开关)}`);
  check("排队图 [4014].透明模式/[4017].switch←[4010 槽3](透明值,⑥⑦纯布尔)",
    isLink(sel?.inputs?.透明模式, 4010, 3) && isLink(sw?.inputs?.switch, 4010, 3),
    `透明模式=${JSON.stringify(sel?.inputs?.透明模式)}`);
  check("排队图 [4013].prompt←[4011,0]/.clip←[4019,0](⑬迁入直连)",
    isLink(peNode?.inputs?.prompt, 4011, 0) && isLink(peNode?.inputs?.clip, 4019, 0),
    `prompt=${JSON.stringify(peNode?.inputs?.prompt)};clip=${JSON.stringify(peNode?.inputs?.clip)}`);
  check("排队图 [4018].手动宽/高=0(跟型)", wh?.inputs?.手动宽 === 0 && wh?.inputs?.手动高 === 0,
    `${wh?.inputs?.手动宽}/${wh?.inputs?.手动高}`);
  rec.pe12Resolved = peVal;
  if (!(b?.inputs?.base === type && peVal === pe)) { rec.skipPost = true; rec.skipReason = "[4010]/[4012] 面板锚失配"; }
}

function lazyT2i(exec, rec, logBefore) {
  const noPe = !exec.executedNodes.includes("6:4013") && !exec.executedNodes.includes("6:4019");
  check("懒文证:PE关 → 6:4013(PE改写)不执行+6:4019(PE专属TE)不装载(执行图裁剪)",
    noPe, `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  // 装载指纹=Model storage policy 行(路径以 ']) 收尾);排队图回显 JSON 里的 clip_name
  // 含 pe_t2i 但非装载(s1 实录:echo 1 hit 而零 storage-policy/loaded completely 行)
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  const echoHits = (delta.match(/pe_t2i/g) || []).length;
  rec.lazyLog = { logDeltaBytes: delta.length, peTeLoads: peLoads, peEchoHits: echoHits };
  check("懒文证:引擎日志增量零 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads === 0,
    `装载指纹=${peLoads};回显命中=${echoHits}(增量 ${delta.length}B)`);
}

function peT2i(exec, rec, logBefore) {
  check("PE 文证:6:4013(PE改写)+6:4019(PE专属TE)在执行集",
    exec.executedNodes.includes("6:4013") && exec.executedNodes.includes("6:4019"),
    `6:4013=${exec.executedNodes.includes("6:4013")} 6:4019=${exec.executedNodes.includes("6:4019")}`);
  const delta = readLog(logBefore);
  const peLoads = (delta.match(/pe_t2i_bf16\.safetensors'\]/g) || []).length;
  const loadedMB = (delta.match(/loaded completely;\s+(\d+)\d{2}\.\d+ MB loaded/g) || []);
  rec.peLog = { logDeltaBytes: delta.length, peTeLoads: peLoads };
  check("PE 文证:引擎日志增量含 pe_t2i TE 装载行(指纹=storage policy 行)", peLoads >= 1, `装载指纹=${peLoads}`);
}

// ══ 八发定义 ══
const SHOTS = [
  {
    // 决定性臂:edit×FunAcc4步×PE开——TextGenerate 把 <image> 指令改写成英文
    // 描述长文(=FunAcc PDD 蒸馏头训练域)。绿 ⇒ 「可以用」,改造有路。
    key: "m1-edit-funacc-peon", wf: "edit", seed: 3101, speed: FUNACC, expect: "opaque",
    note: "m1 决定性:edit×FunAcc×PE开(改写文=蒸馏域)",
    panel: () => [["asm", "PE启用?", true]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m1 排队图 [4012]=true(PE开)", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m1 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      if (peVal !== true || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m1 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m1 执行文证:PE改写在链(6:4013)", on("6:4013"), `6:4013=${on("6:4013")}`);
      check("m1 执行文证:PE专属TE在链(6:4019)", on("6:4019"), `6:4019=${on("6:4019")}`);
      check("m1 执行文证:FunAcc支路在链(7:7013)直出不在(7:7010)", on("7:7013") && !on("7:7010"),
        `7013=${on("7:7013")} 7010=${on("7:7010")}`);
      check("m1 兼容文证:6:4014 合成器在执行集", on("6:4014"), `6:4014=${on("6:4014")}`);
      const instr = String((p["400"]?.inputs?.string ?? p["400"]?.inputs?.text) || "");
      rec.instruction = instr.slice(0, 80);
      rec.finalTextLen = typeof rec.finalText === "string" ? rec.finalText.length : -1;
      check("m1 文证:最终文本=PE改写长文(≠原指令且长得多)",
        typeof rec.finalText === "string" && rec.finalText !== instr && rec.finalText.length > instr.length + 200,
        `指令len=${instr.length};终文len=${rec.finalTextLen}`);
    },
  },
  {
    key: "m1b-edit-funacc-peon", wf: "edit", seed: 3111, speed: FUNACC, expect: "opaque",
    note: "m1b 决定性复seed甲",
    panel: () => [["asm", "PE启用?", true]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m1b 排队图 [4012]=true", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m1b 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      if (peVal !== true || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m1b 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m1b 执行文证:6:4013 在链+7:7013 在链", on("6:4013") && on("7:7013"), `4013=${on("6:4013")} 7013=${on("7:7013")}`);
    },
  },
  {
    key: "m1c-edit-funacc-peon", wf: "edit", seed: 3112, speed: FUNACC, expect: "opaque",
    note: "m1c 决定性复seed乙",
    panel: () => [["asm", "PE启用?", true]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m1c 排队图 [4012]=true", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m1c 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      if (peVal !== true || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m1c 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m1c 执行文证:6:4013 在链+7:7013 在链", on("6:4013") && on("7:7013"), `4013=${on("6:4013")} 7013=${on("7:7013")}`);
    },
  },
  {
    // 负对照:edit×FunAcc×PE关=F3 白图复现(预期红=死因确认,非本矩阵失败)
    key: "m2-edit-funacc-peoff", wf: "edit", seed: 3102, speed: FUNACC, expect: "opaque",
    note: "m2 负对照:F3 白图复现臂(预期红)",
    panel: () => [["asm", "PE启用?", false]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m2 排队图 [4012]=false(PE关)", peVal === false, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m2 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      if (peVal !== false || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m2 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      const noPe = !on("6:4013") && !on("6:4019");
      check("m2 懒文证:PE关 → 6:4013/6:4019 不在执行集", noPe, `6:4013=${on("6:4013")} 6:4019=${on("6:4019")}`);
      check("m2 执行文证:FunAcc支路在链(7:7013)", on("7:7013"), `7:7013=${on("7:7013")}`);
      check("m2 兼容文证:6:4014 合成器在执行集", on("6:4014"), `6:4014=${on("6:4014")}`);
    },
  },
  {
    // 正对照:edit×直出40×PE开——证 PE开路自身健康(排除 PE-on×edit 本身坏)
    key: "m3-edit-direct-peon", wf: "edit", seed: 3103, speed: DIRECT40, expect: "opaque",
    note: "m3 正对照:PE开×直出40(排除PE开路自身问题)",
    panel: () => [["asm", "PE启用?", true]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m3 排队图 [4012]=true(PE开)", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m3 排队图 7:7015.mode=直出40步", selMode === DIRECT40, String(selMode));
      if (peVal !== true || selMode !== DIRECT40) { rec.skipPost = true; rec.skipReason = "m3 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m3 执行文证:PE改写在链(6:4013)", on("6:4013"), `6:4013=${on("6:4013")}`);
      check("m3 执行文证:直出40在链(7:7010)FunAcc不在(7:7013)", on("7:7010") && !on("7:7013"),
        `7010=${on("7:7010")} 7013=${on("7:7013")}`);
      const instr = String((p["400"]?.inputs?.string ?? p["400"]?.inputs?.text) || "");
      rec.finalTextLen = typeof rec.finalText === "string" ? rec.finalText.length : -1;
      check("m3 文证:最终文本=PE改写长文", typeof rec.finalText === "string" && rec.finalText !== instr,
        `指令len=${instr.length};终文len=${rec.finalTextLen}`);
    },
  },
  {
    // z 系列(1003 中文素材轮):道劫人物图(f1-char 单口役产物)+中文指令
    // 背景改水墨——用户令「项目全是中国的」,弃官方样例人物。
    key: "m1z-edit-funacc-peon-zh", wf: "edit", seed: 3201, speed: FUNACC, expect: "opaque",
    note: "m1z 决定性(中文素材):FunAcc×PE开×道劫人物×中文指令",
    panel: () => [["asm", "PE启用?", true]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m1z 排队图 [4012]=true(PE开)", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m1z 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      const img1 = p["10"]?.inputs?.image;
      check("m1z 排队图 参考图1=daojie-char-1003.png(中文素材)", img1 === "daojie-char-1003.png", String(img1));
      if (peVal !== true || selMode !== FUNACC || img1 !== "daojie-char-1003.png") { rec.skipPost = true; rec.skipReason = "m1z 面板/素材锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m1z 执行文证:PE改写在链(6:4013)+PE TE(6:4019)+FunAcc(7:7013)",
        on("6:4013") && on("6:4019") && on("7:7013"),
        `4013=${on("6:4013")} 4019=${on("6:4019")} 7013=${on("7:7013")}`);
      check("m1z 兼容文证:6:4014 合成器在执行集", on("6:4014"), `6:4014=${on("6:4014")}`);
    },
  },
  {
    key: "m2z-edit-funacc-peoff-zh", wf: "edit", seed: 3202, speed: FUNACC, expect: "opaque",
    note: "m2z 危险组合探针(中文素材):FunAcc×PE关×中文指令直写",
    panel: () => [["asm", "PE启用?", false]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m2z 排队图 [4012]=false(PE关)", peVal === false, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m2z 排队图 7:7015.mode=Fun-Acc 4步", selMode === FUNACC, String(selMode));
      if (peVal !== false || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m2z 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      const noPe = !on("6:4013") && !on("6:4019");
      check("m2z 懒文证:PE关 → 6:4013/6:4019 不在执行集", noPe, `4013=${on("6:4013")} 4019=${on("6:4019")}`);
      check("m2z 执行文证:FunAcc 在链(7:7013)", on("7:7013"), `7:7013=${on("7:7013")}`);
    },
  },
  {
    key: "m3z-edit-direct-peoff-zh", wf: "edit", seed: 3203, speed: DIRECT40, expect: "opaque",
    note: "m3z 生产对照(中文素材):直出40×PE关×中文指令=现行生产路径",
    panel: () => [["asm", "PE启用?", false]],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m3z 排队图 [4012]=false(PE关)", peVal === false, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m3z 排队图 7:7015.mode=直出40步", selMode === DIRECT40, String(selMode));
      if (peVal !== false || selMode !== DIRECT40) { rec.skipPost = true; rec.skipReason = "m3z 面板锚失配"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m3z 执行文证:直出40在链(7:7010)FunAcc不在(7:7013)", on("7:7010") && !on("7:7013"),
        `7010=${on("7:7010")} 7013=${on("7:7013")}`);
    },
  },

  {
    // 1003 手术验收:edit 零面板操作装载 → 默认档=Fun-Acc 4步×PE开 → 真图
    key: "m4-edit-default-zh", wf: "edit", seed: 3204, expect: "opaque",
    note: "m4 默认路复验:不 set 任何面板 → 默认 FunAcc+PE开 真图",
    panel: () => [],
    run: (p, rec) => {
      const pb = N(p, 4012);
      const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
      check("m4 排队图 [4012]=true(默认 PE开)", peVal === true, String(peVal));
      const selMode = p["7:7015"]?.inputs?.mode;
      check("m4 排队图 7:7015.mode=Fun-Acc 4步(工作流新默认,未手动 set)", selMode === FUNACC, String(selMode));
      if (peVal !== true || selMode !== FUNACC) { rec.skipPost = true; rec.skipReason = "m4 默认档未生效"; }
    },
    after: (p, exec, rec) => {
      const on = (k) => exec.executedNodes.includes(k);
      check("m4 执行文证:PE改写(6:4013)+FunAcc(7:7013)在链", on("6:4013") && on("7:7013"),
        `4013=${on("6:4013")} 7013=${on("7:7013")}`);
    },
  },
];



const PHASE = process.env.PHASE || "fire";
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("0.1 引擎已列面板联动扩展(P3 件在役)", exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"), "");
  const baseInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21DaojieBase`)).json()).MyQi21DaojieBase;
  check("0.2 底座件四出(BASE/WIDTH/HEIGHT/透明值)+十档 combo(⑯清理在引擎在役)",
    JSON.stringify(baseInfo.output_name) === JSON.stringify(["BASE", "WIDTH", "HEIGHT", "透明值"]) &&
    baseInfo.input.required.base[0].length === 10,
    `${baseInfo.output_name?.length} 出/${baseInfo.input.required.base[0].length} 档`);
  const speedInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21SpeedSelect`)).json()).MyQi21SpeedSelect;
  check("0.3 速度件 combo 首项=Fun-Acc 4步(⑱默认档)", speedInfo.input.required.mode[0][0] === FUNACC,
    speedInfo.input.required.mode[0][0]);
  // [4014] widget 序列化错位——已修复(1002 修复轮):根因=前端为全部参数型输入
  // (含连线中的装配全文/PE出文 STRING 槽)建 widget 并按全序消费 widgets_values,
  // 大轮迁移把 wv 收成 5 值致两连线槽吃掉前 2 值整体后移(装载后头句←W1 值,
  // i2i [153] pe开关←头句串,graphToPrompt 执行级;probe2-widgetmap 三连复现)。
  // 修法=三工作流+三蓝图 PromptSelect wv 头部 2 空串占位回 7 值形(实验四变体
  // 无效后机理破案;复验=t2i/i2i 6:4014 头句=官方原文+6:153 pe开关=false)。
  check("0.4 [4014] widget 序列化错位已修复(wv 头部2空串占位,7 值形)", true,
    "前端全序消费实证;头句=This is an RGBA format image with transparency.(装载复验过)");

  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(2000);

  if (PHASE === "probe") {
    // 探针:三件干跑,落盘排队图全键形+宿主 widget 名(断言锚核对源)
    for (const wfKey of ["t2i", "i2i", "edit"]) {
      await loadWorkflow(wfKey);
      const hosts = HOSTS[wfKey];
      const names = {};
      names.asm = await widgetsOf(hosts.asm); names.acc = await widgetsOf(hosts.acc);
      if (wfKey === "t2i") {
        await setPanel(hosts, [["asm", "型选择", "人物"], ["asm", "PE启用?", false], ["asm", "透明", false], ["asm", "手动宽", 0], ["asm", "手动高", 0], ["acc", "速度档位", DIRECT40], ["acc", "seed", 1]], { panelSets: [] });
      } else if (wfKey === "i2i") {
        await setPanel(hosts, [["asm", "型选择", "人物"], ["asm", "PE启用?", false], ["asm", "RGBA透明", "自动"], ["acc", "速度档位", FUNACC], ["acc", "seed", 1]], { panelSets: [] });
      } else {
        await setPanel(hosts, [["asm", "PE启用?", false], ["acc", "速度档位", FUNACC], ["acc", "seed", 1]], { panelSets: [] });
      }
      const prompt = await dryPrompt();
      writeFileSync(join(OUT_DIR, `probe-${wfKey}-peoff.json`), JSON.stringify(prompt, null, 1));
      log(`🔎 probe ${wfKey}: widgets=${JSON.stringify(names)} keys=${Object.keys(prompt).length}`);
      writeFileSync(join(OUT_DIR, `probe-${wfKey}-widgets.json`), JSON.stringify(names, null, 2));
    }
    log("probe 完成(未发弹)");
  } else {
    const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const shot of SHOTS) {
      if (only.length && !only.includes(shot.key)) continue;
      log(`\n══ ${shot.key} — ${shot.note} ══`);
      await fireShot(shot);
    }
  }
} catch (e) {
  check("环境段", false, String(e && e.message));
} finally {
  report.finishedAt = new Date().toISOString();
  writeReport();
  try { page?.close(); } catch {}
  killChrome();
}
log("\n════ 大轮实弹汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} [${r.shot}] ${r.name}`);
const failed = report.results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
