#!/usr/bin/env node
// 505 修复实弹验证(1003)装载+发弹一体驱动。
//
// 验证对象:qi21-道劫-t2i.json [505].type 由 'ImageComparer (rgthree)'(无空格,
// 26437ec 判 missing_node_type)修复为 'Image Comparer (rgthree)'(带空格全称
// =引擎注册名,rgthree-comfy/py/image_comparer.py:9 get_name('Image Comparer'))。
//
// 先例形态:
//   装载=qi21_singleport_loadgraph_1002.mjs(真前端 loadGraphData 零注入+console 告警)
//   发弹=qi21_singleport_fire_1002.mjs(宿主面板 widget set+onWidgetChanged→
//         graphToPrompt 现读换算→POST /prompt→WS 执行事件→/history 取证)
//   黑图门禁+同seed重试=qwen21_sancai_retry_diag_1002.mjs(D1 原样重试:
//         重试绿=首轮瞬态,仍黑=必现如实上报);黑图判据=唯一色
//         (qi21_consistency_lora_ab_1001.mjs:纯黑=1/健康≈7万,阈值<1000 判黑)。
//
// 口径(ask 505-fix-1003):
//   ①装载=t2i 仓库真源原样 loadGraphData 装进引擎,断言 [505] 不再
//     missing_node_type(object_info 或排队校验双口径——本役两口径都做:
//     object_info 段在 engine_up 脚本;此处=画布非红+graphToPrompt 干跑+
//     POST /prompt 受理零 node_errors);
//   ②发弹=真单一发(FunAcc 4步 1024² 快速臂),history success+对比件纯预览
//     不落盘口径核对(history ui 条目 type=temp+引擎 output 目录快照 diff
//     零 rgthree.compare.* 新文件;comparer=PreviewImage 子类,nodes.py:1724
//     output_dir=temp/type='temp'——不落持久盘的机制面);
//   ③证据=apps/output/505-fix-1003/(装载校验 JSON+出图+引擎日志摘句)。
//
// 黑图门禁:出图唯一色<1000 → 同 seed 原样重发一轮(sancai D1 口径);
//   重试绿=首轮瞬态如实记录,仍黑=红。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9391)。
// 产物:apps/output/505-fix-1003/{load-verify.json,fire-report.json,
//   f1-funacc4-seed*.png,t2i-canvas.png,engine-log-excerpt.txt}。
// 退出码:0=全绿;1=有红;2=环境错。引擎由 qi21_505_fix_engine_up_1003.py 管
// (自拉 pid 停留收尾统一 kill,本驱动不碰引擎进程)。
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9391);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/505-fix-1003`;
const WF_T2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ENGINE_HOME = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui`;
const VENV_PY = `${ENGINE_HOME}/venv/bin/python`;
const ENGINE_OUT = `${ENGINE_HOME}/output`;
const ENGINE_TEMP = `${ENGINE_HOME}/ComfyUI/temp`;
const ENGINE_LOG = "/tmp/qi21-505-fix-1003/engine.log"; // qi21_505_fix_engine_up_1003.py 同源
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-505-fire-chrome-${Date.now()}`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e";
const NEW_NAME = "Image Comparer (rgthree)";
const FUNACC4 = "0 · Fun-Acc 4步";
const SEED = 50521003;
const CLIENT_ID = `q505-fix-1003-${Date.now()}`;
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "505-fix-1003-loadfire", engine: ENGINE, wf: WF_T2I, seed: SEED,
  wfNote: "t2i 仓库真源原样装载(loadGraphData 零注入);真单一发=FunAcc 4步·自由型兜底1024²·pe关·透明关",
  startedAt: new Date().toISOString(), results: [], shots: {},
};
const check = (name, pass, detail = "") => {
  report.results.push({ name, pass, detail: String(detail).slice(0, 700) });
  log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
  return Boolean(pass);
};
let CUR = "(env)";

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
  let id = 0; const pending = new Map(); const consoleMsgs = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Log.entryAdded") consoleMsgs.push(`[log] ${m.params.entry.level} ${m.params.entry.text}`);
    if (m.method === "Runtime.consoleAPICalled") {
      consoleMsgs.push(`[console.${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Log.enable").catch(() => {});
  return {
    send, consoleMsgs,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
      return r.result.value;
    },
    async screenshot(name) {
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64")); log(`📸 ${name}`); }
      } catch {}
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
const readLog = (fromBytes) => { try { return readFileSync(ENGINE_LOG).slice(fromBytes).toString("utf8"); } catch { return ""; } };

// 引擎 output/temp 目录递归快照(不落盘口径的文件系统判据)
function snapDir(dir) {
  const out = {};
  const walk = (d, prefix) => {
    let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) walk(join(d, e.name), `${prefix}${e.name}/`);
      else { try { out[`${prefix}${e.name}`] = statSync(join(d, e.name)).size; } catch {} }
    }
  };
  walk(dir, "");
  return out;
}
const diffSnap = (before, after) => Object.fromEntries(
  Object.entries(after).filter(([k, v]) => before[k] !== v));

// 唯一色黑图判据(引擎家 venv PIL;先例 consistency AB:纯黑=1/健康≈7万)
function uniqueColors(pngPath) {
  const r = spawnSync(VENV_PY, ["-c",
    `from PIL import Image; import json; im=Image.open(${JSON.stringify(pngPath)}).convert('RGB'); print(json.dumps({"unique_colors": len(set(im.getdata())), "size": im.size}))`],
    { encoding: "utf8", timeout: 120_000 });
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return { error: (r.stderr || r.stdout || "").slice(0, 300) }; }
}

async function watchExecution(pid, { stall = 15 * 60_000, hard = 25 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now() };
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - state.lastActivity > stall) { cleanup(); reject(new Error(`执行停滞:>${Math.round(stall / 60000)}min 无事件`)); }
      if (Date.now() - startedAt > hard) { cleanup(); reject(new Error(`单发超时 ${Math.round(hard / 60000)}min`)); }
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

let page = null;
const PHASE = process.env.PHASE || "fire";
report.phase = PHASE;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version, `模式=${PHASE}`);

  // ── hist 复核模式:对已发弹的 history 重算修正后判据(不重发弹) ──
  if (PHASE.startsWith("hist:")) {
    const pid = PHASE.slice(5);
    const hist = await (await fetch(`${ENGINE}/history/${pid}`)).json();
    const h = hist[pid] || {};
    check("H4 history status=success", h.status?.status_str === "success",
      `status_str=${JSON.stringify(h.status?.status_str)}`);
    const outputs = h.outputs || {};
    const o505 = outputs["505"] || {};
    const aImgs = o505.ui?.a_images ?? o505.a_images ?? [];
    const bImgs = o505.ui?.b_images ?? o505.b_images ?? [];
    check("H5 [505] history 双图口有图:a_images(直出)+b_images(2K)",
      aImgs.length > 0 && bImgs.length > 0,
      `a=${aImgs.length};b=${bImgs.length};a[0]=${JSON.stringify(aImgs[0])};b[0]=${JSON.stringify(bImgs[0])}`);
    check("H6 纯预览不落盘·history 口径:条目 type='temp'(PreviewImage 语义,非 output)",
      aImgs.length + bImgs.length > 0 && [...aImgs, ...bImgs].every((im) => im.type === "temp"),
      JSON.stringify([...aImgs, ...bImgs].map((im) => `${im.type}/${im.filename}`)));
    check("H6b 纯预览不落盘·temp 文件名前缀 rgthree.compare.",
      aImgs.length + bImgs.length > 0 && [...aImgs, ...bImgs].every((im) => (im.filename || "").includes("rgthree.compare")),
      JSON.stringify([...aImgs, ...bImgs].map((im) => im.filename)));
    const o8 = outputs["8"]?.images?.[0];
    const o504 = outputs["504"]?.images?.[0];
    check("H7 落盘双源在位:[8](output)+[504](output) vs [505](temp)口径对照",
      o8?.type === "output" && o504?.type === "output",
      `[8]=${JSON.stringify(o8)?.slice(0, 120)};[504]=${JSON.stringify(o504)?.slice(0, 120)}`);
    writeFileSync(join(OUT_DIR, "hist-recheck.json"), JSON.stringify({
      mode: "505-fix-1003-hist-recheck", engine: ENGINE, pid,
      outputs505: { a_images: aImgs, b_images: bImgs },
      results: report.results, finishedAt: new Date().toISOString(),
    }, null, 2));
  } else {
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000);

  // ══ ①装载段:仓库真源原样 loadGraphData+[505] 不再 missing_node_type ══
  CUR = "load";
  const wfJson = JSON.parse(readFileSync(WF_T2I, "utf8"));
  const node505 = wfJson.nodes.find((n) => n.id === 505);
  check("L3 真源 [505].type = 'Image Comparer (rgthree)'(带空格全称,修复值)",
    node505?.type === NEW_NAME, `得 ${JSON.stringify(node505?.type)}`);
  const preLoad = page.consoleMsgs.length;
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'q505-fix-load');
    return 'opened';
  })()`);
  check("L4 loadGraphData(仓库真源原样·零注入)", opened === "opened", String(opened));
  if (opened !== "opened") throw new Error("装载失败: " + opened);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换(t2i)" });
  await sleep(2500);

  const canvasCounts = await page.ev(vis(`JSON.stringify({
    nodes: window.app.graph._nodes.length,
    liveLinks: Object.keys(window.app.graph.links || {}).length,
    ids: window.app.graph._nodes.map((n) => n.id),
    n505: (() => { const n = window.app.graph._nodes.find((n) => String(n.id) === '505');
      return n ? { id: n.id, idType: typeof n.id, type: n.type, title: n.title, missing: !!(n.flags && (n.flags.missing || n.flags.deleted)),
        ctor: n.constructor && n.constructor.name } : null; })(),
  })`));
  const cc = JSON.parse(String(canvasCounts));
  check("L5 画布零丢件丢线(节点=16/活链=JSON links 数)", cc.nodes === wfJson.nodes.length && cc.liveLinks === wfJson.links.length,
    `nodes=${cc.nodes};liveLinks=${cc.liveLinks}`);
  report.canvasIds = cc.ids;
  check("L6 [505] 在画布且非红(type=新名·flags 无 missing 标记)",
    cc.n505?.type === NEW_NAME && cc.n505?.missing === false,
    `n505=${JSON.stringify(cc.n505)};画布 id 集=${JSON.stringify(cc.ids)}`.slice(0, 400));
  const postLoad = page.consoleMsgs.slice(preLoad);
  const badMsgs = postLoad.filter((m) => /missing|not found|unknown node|failed to|not registered|error/i.test(m));
  check("L7 装载后 console 零 missing/未注册/error 级告警(缺型必报区)", badMsgs.length === 0,
    badMsgs.slice(0, 5).join(" | ").slice(0, 400) || `(clean;装载后窗口 ${postLoad.length} 条全无告警)`);
  report.loadConsoleSample = postLoad.slice(0, 30);
  await page.screenshot("t2i-canvas.png");

  // 面板(发弹臂:自由型兜底 1024²·pe关·透明关·FunAcc 4步)
  await waitIdle();
  const panelSets = [];
  for (const [which, name, val] of [
    ["asm", "型选择", "自由"], ["asm", "PE启用?", false], ["asm", "透明", false],
    ["asm", "手动宽", 0], ["asm", "手动高", 0],
    ["acc", "速度档位", FUNACC4], ["acc", "seed", SEED],
  ]) {
    const uuid = which === "asm" ? ASM : ACCEL;
    const r = await page.ev(setViaHook(uuid, name, val));
    panelSets.push(`${which}.${name}=${val}: ${r}`);
    if (String(r) !== `set:${name}=${val}`) check(`面板设置 ${which}.${name}`, false, r);
  }
  report.panelSets = panelSets;
  log("面板:", panelSets.map((s) => s.split(": ")[1]).join(" | "));

  const dryRaw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(dryRaw).startsWith("ERR:")) {
    check("L8 graphToPrompt 干跑成功(排队校验口径:缺型必抛)", false, String(dryRaw).slice(0, 400));
    throw new Error("graphToPrompt 干跑失败");
  }
  const dryPrompt = JSON.parse(String(dryRaw));
  check("L8 graphToPrompt 干跑成功(排队校验口径:缺型/缺输入/断链必抛)", true, `keys=${Object.keys(dryPrompt).length}`);
  const q505 = dryPrompt["505"];
  check("L9 干跑排队图含 '505' 键且 class_type='Image Comparer (rgthree)'(带空格新名)",
    q505?.class_type === NEW_NAME, `class_type=${JSON.stringify(q505?.class_type)}`);
  check("L10 排队图 [505] 双图口接线:image_a←['5',0](直出)/image_b←['503',0](2K)",
    JSON.stringify(q505?.inputs?.image_a) === JSON.stringify(["5", 0])
    && JSON.stringify(q505?.inputs?.image_b) === JSON.stringify(["503", 0]),
    `a=${JSON.stringify(q505?.inputs?.image_a)};b=${JSON.stringify(q505?.inputs?.image_b)}`);
  const modeSel = dryPrompt["7:7015"]?.inputs?.mode;
  const seedVal = dryPrompt["7:7014"]?.inputs?.value ?? dryPrompt["7:7014"]?.inputs?.seed;
  const latent = dryPrompt["4"]?.inputs;
  // 画幅=[6] width/height 直驱 [4](契约口径),排队图里是链引用看不到数字;
  // 数字断言移到出图侧(F 段 PNG size),此处记录链形态即可
  check("L11 发弹臂生效:速度档=Fun-Acc 4步+seed 单源",
    modeSel === FUNACC4 && seedVal === SEED,
    `mode=${modeSel};seed=${seedVal};[4] latent 接线=${JSON.stringify({ width: latent?.width, height: latent?.height })}(链=[6]直驱,数字验在出图)`);
  writeFileSync(join(OUT_DIR, "load-verify.json"), JSON.stringify({
    mode: "505-fix-1003-load", engine: ENGINE, wf: WF_T2I, seed: SEED,
    wfShaNote: "仓库真源原样 loadGraphData 零注入(装载时读盘字节即所验)",
    canvas: cc, badConsole: badMsgs, panelSets,
    prompt505: q505, armCheck: { modeSel, seedVal, latent },
    results: report.results.filter((r) => r.name.startsWith("L")),
    finishedAt: new Date().toISOString(),
  }, null, 2));

  // ══ ②发弹段:真单一发(FunAcc 4步 1024²)+不落盘口径核对 ══
  if (PHASE === "load") {
    log("PHASE=load:装载段完(不 POST 发弹)");
  } else {
  CUR = "fire";
  const outBefore = snapDir(ENGINE_OUT);
  const tempBefore = snapDir(ENGINE_TEMP);
  const logBeforeFire = logSize();
  const resp = await (await fetch(`${ENGINE}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: dryPrompt, client_id: CLIENT_ID }),
  })).json();
  check("F1 POST /prompt 受理(排队校验口径:零 node_errors/零 error)",
    resp.prompt_id !== undefined && !(resp.error) && (!resp.node_errors || Object.keys(resp.node_errors).length === 0),
    JSON.stringify(resp).slice(0, 300));
  if (resp.prompt_id === undefined) throw new Error("POST 受理失败");
  const pid = resp.prompt_id;
  log(`🚀 真单一发已排队(pid=${pid.slice(0, 8)}…,FunAcc4·自由型1024²·seed=${SEED})`);
  const shot = { key: "f1-funacc4-1024", seed: SEED, pid, startedAt: new Date().toISOString() };
  report.shots[shot.key] = shot;
  const exec = await watchExecution(pid);
  shot.executedNodes = exec.executedNodes;
  shot.frameStats = { executing: exec.executedNodes.length, executed: exec.executedCount };
  shot.execErrors = exec.errors;
  if (exec.errors.length) check("F2 执行零错误(execution_error)", false, exec.errors.join(" | "));
  else check("F2 执行零错误(execution_error)", true, `executing=${exec.executedNodes.length} 件/executed=${exec.executedCount} 帧`);
  check("F3 '505' 在执行集(comparer 实跑,非旁路)", exec.executedNodes.includes("505"),
    `505=${exec.executedNodes.includes("505")};尾档件=${["501", "502", "503", "504"].map((i) => `${i}=${exec.executedNodes.includes(i)}`).join("/")}`);

  const hist = await (await fetch(`${ENGINE}/history/${pid}`)).json();
  const h = hist[pid] || {};
  shot.historyStatus = h.status?.status_str || "(missing)";
  check("F4 history status=success", h.status?.status_str === "success",
    `status_str=${JSON.stringify(h.status?.status_str)};completed=${h.status?.completed};messages=${(h.status?.messages || []).length}`);
  const outputs = h.outputs || {};
  const o505 = outputs["505"] || {};
  // history 拍平口径:comparer 后端 result["ui"] 内容在 history 里直接挂 outputs["505"]
  // 顶层(实测 60c418f5:{"a_images":[...],"b_images":[...]},无 .ui 包层;首版取
  // o505.ui?.a_images 系取证层级错误,非链路红)
  const aImgs = o505.ui?.a_images ?? o505.a_images ?? [];
  const bImgs = o505.ui?.b_images ?? o505.b_images ?? [];
  shot.outputs505 = { a_images: aImgs, b_images: bImgs };
  check("F5 [505] history 双图口有图:a_images(直出)+b_images(2K)",
    aImgs.length > 0 && bImgs.length > 0,
    `a=${aImgs.length} 张;b=${bImgs.length} 张;a[0]=${JSON.stringify(aImgs[0])?.slice(0, 160)}`);
  check("F6 纯预览不落盘·history 口径:[505] 条目 type='temp'(PreviewImage 语义,非 output)",
    aImgs.length + bImgs.length > 0 && [...aImgs, ...bImgs].every((im) => im.type === "temp"),
    JSON.stringify([...aImgs, ...bImgs].map((im) => `${im.type}/${im.filename}`)).slice(0, 300));
  check("F6b 纯预览不落盘·temp 文件名前缀 rgthree.compare.(comparer 自存指纹)",
    aImgs.length + bImgs.length > 0 && [...aImgs, ...bImgs].every((im) => (im.filename || "").includes("rgthree.compare")),
    JSON.stringify([...aImgs, ...bImgs].map((im) => im.filename)).slice(0, 300));

  // [8] 直出正式图(SaveImage→output 持久盘)拉回本役产物目录=ask 的「出图」证据
  const o8 = outputs["8"]?.images?.[0];
  if (!o8) check("F7 [8] SaveImage 出图在位(history)", false, JSON.stringify(Object.keys(outputs)));
  else {
    let buf = Buffer.alloc(0);
    try {
      buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(o8.filename)}&subfolder=${encodeURIComponent(o8.subfolder || "")}&type=${encodeURIComponent(o8.type)}`)).arrayBuffer());
    } catch (e) { log("view 取图异常:", String(e)); }
    if (!buf.length) { check("F7 [8] 直出图取回", false, `view 空(${o8.filename})`); }
    else {
      const pngPath = join(OUT_DIR, `f1-funacc4-seed${SEED}.png`);
      writeFileSync(pngPath, buf);
      shot.png = pngPath; shot.pngBytes = buf.length; shot.save8 = o8;
      log(`🖼 直出图 ${buf.length}B → ${pngPath.split("/").pop()}`);
      check("F7 [8] SaveImage 直出图落盘+取回(output 持久盘,正式档)", true,
        `${o8.filename} ${buf.length}B(type=${o8.type})`);
      // 画幅数字断言在此兑现(自由型兜底 1024²,快速臂口径)
      const sz = uniqueColors(pngPath);
      shot.pngSize = sz.size ?? null;
      check("F7b 出图画幅=1024×1024(自由型兜底,快速臂小画幅口径)",
        Array.isArray(sz.size) && sz.size[0] === 1024 && sz.size[1] === 1024,
        JSON.stringify(sz.size));
    }
  }
  const o504 = outputs["504"]?.images?.[0];
  shot.save504 = o504 || null;
  check("F8 [504] 2K SaveImage 在位(尾档正式档;与 [505] 纯预览对照)",
    !!o504, JSON.stringify(o504 || {}).slice(0, 160));

  // 纯预览不落盘·文件系统口径:output 持久盘 diff
  await sleep(2000);
  const outNew = diffSnap(outBefore, snapDir(ENGINE_OUT));
  shot.outputNewFiles = outNew;
  const comparerInOutput = Object.keys(outNew).filter((k) => k.includes("rgthree.compare"));
  const expectSave8 = Object.keys(outNew).filter((k) => k.startsWith("QI21道劫文生图"));
  const expectSave504 = Object.keys(outNew).filter((k) => k.startsWith("MYStudio-2K"));
  check("F9 纯预览不落盘·文件系统口径:引擎 output 持久盘零 rgthree.compare.* 新文件",
    comparerInOutput.length === 0, `新增=${JSON.stringify(Object.keys(outNew))}`.slice(0, 400));
  check("F10 落盘恰两源:[8] QI21道劫文生图_* + [504] MYStudio-2K*(SaveImage 语义)",
    expectSave8.length >= 1 && expectSave504.length >= 1,
    `save8=${expectSave8.length} 张;save504=${expectSave504.length} 张;其他=${JSON.stringify(Object.keys(outNew).filter((k) => !k.startsWith("QI21道劫文生图") && !k.startsWith("MYStudio-2K")))}`.slice(0, 400));
  const tempNew = diffSnap(tempBefore, snapDir(ENGINE_TEMP));
  shot.tempNewCount = Object.keys(tempNew).length;
  check("F11 comparer temp 预览缓存有新文件(rgthree.compare.* 落 temp,机制面对照)",
    Object.keys(tempNew).filter((k) => k.includes("rgthree.compare")).length >= 2,
    `temp 新增 ${Object.keys(tempNew).length} 件,含 rgthree.compare ${Object.keys(tempNew).filter((k) => k.includes("rgthree.compare")).length} 件`);

  // 黑图门禁:唯一色<1000 判黑 → 同 seed 原样重发一轮(sancai D1 口径)
  if (shot.png) {
    let uc = uniqueColors(shot.png);
    shot.uniqueColors = uc;
    check("F12 黑图门禁:唯一色≥1000(纯黑=1/健康≈7万,AB 先例)", (uc.unique_colors ?? 0) >= 1000,
      JSON.stringify(uc));
    if ((uc.unique_colors ?? 0) < 1000) {
      log(`⛔ 判黑(唯一色=${uc.unique_colors}),同 seed=${SEED} 原样重发一轮(sancai D1 甄别口径)`);
      const retryResp = await (await fetch(`${ENGINE}/prompt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: dryPrompt, client_id: CLIENT_ID }),
      })).json();
      const rex = await watchExecution(retryResp.prompt_id);
      const rh = (await (await fetch(`${ENGINE}/history/${retryResp.prompt_id}`)).json())[retryResp.prompt_id];
      const rimg = rh?.outputs?.["8"]?.images?.[0];
      if (rimg) {
        const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(rimg.filename)}&subfolder=${encodeURIComponent(rimg.subfolder || "")}&type=${encodeURIComponent(rimg.type)}`)).arrayBuffer());
        const rpng = join(OUT_DIR, `f1-retry-same-seed${SEED}.png`);
        writeFileSync(rpng, buf);
        uc = uniqueColors(rpng);
        shot.retry = { pid: retryResp.prompt_id, status: rh?.status?.status_str, uniqueColors: uc, png: rpng, errors: rex.errors };
        check("F12b 同 seed 重试:绿=首轮瞬态/黑=必现", (uc.unique_colors ?? 0) >= 1000,
          `重试唯一色=${JSON.stringify(uc)};status=${rh?.status?.status_str}`);
      } else { check("F12b 同 seed 重试出图取回", false, "retry [8] 无图"); }
    }
  } else check("F12 黑图门禁", false, "无直出图可判");

  // 引擎日志摘句(发弹窗口增量关键行)
  const fireLog = readLog(logBeforeFire);
  const keyLines = fireLog.split("\n").filter((l) =>
    /got prompt|Prompt executed|Requested to load|loaded completely|rgthree|comparer|ERROR|Error|saving image/i.test(l)).slice(0, 80);
  shot.engineLogKeyLines = keyLines.slice(0, 40);
  writeFileSync(join(OUT_DIR, "engine-log-excerpt.txt"),
    `# 505-fix-1003 发弹窗口引擎日志摘句(增量 ${fireLog.length}B,起字节 ${logBeforeFire})\n` +
    keyLines.join("\n") + "\n");
  check("F13 引擎日志摘句落盘(engine-log-excerpt.txt)", keyLines.length > 0,
    `关键行 ${keyLines.length} 条(前3:${keyLines.slice(0, 3).map((l) => l.slice(0, 80)).join(" / ")})`);
  shot.finishedAt = new Date().toISOString();
  shot.secs = Math.round((new Date(shot.finishedAt) - new Date(shot.startedAt)) / 1000);
  } // ── PHASE=fire 发弹段完(load 模式跳过) ──
  } // ── PHASE=fire 全流程完 ──
} catch (e) {
  check("驱动异常", false, String(e && e.message));
  report.error = String(e && e.message);
} finally {
  report.finishedAt = new Date().toISOString();
  if (PHASE === "fire") {
    try { writeFileSync(join(OUT_DIR, "fire-report.json"), JSON.stringify(report, null, 2)); } catch {}
  }
  try { page?.close(); } catch {}
  killChrome();
}
log("\n════ 505 修复实弹验证汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
const failed = report.results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
