#!/usr/bin/env node
// qi21 大轮(1002)补发:s6-baseline 引擎侧真去锚 + s8 edit 空图重试。
// 教训(run1):引擎执行读的是引擎家部署副本 custom_nodes/my-nodes/nodes/qi21_bases.json,
// 改仓库真源零效果→run1 s6-baseline 全缓存秒回(hasAnchor 仍 true)=无效发,本脚本改引擎侧
// 文件(mtime 热更+IS_CHANGED 签名穿透缓存),POST 后 6:4010 执行即恢复+md5 验。
// s8:run1 出图全透明空白(alphaMean=0.0;sancai 先例=MPS 瞬态 NaN),同 seed 重试一次,
// 仍空白再换 seed 3009 一次(瞬态 vs 结构性判别)。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const ENGINE = "http://127.0.0.1:17599";
const CDP_PORT = 9393;
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/biground-1002/fire`;
const T2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const EDIT = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
// 引擎侧部署副本(执行真源);仓库真源禁动(禁打回)
const BASES_ENGINE = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ANCHOR_FULL = "全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。";
const ANCHOR_BASE = "全身入画。";
const ANCHOR_SENT = "头身比约七头半";
const HOSTS_T2I = { asm: "96937bbe-99d1-4f16-a06c-d86b57815d91", acc: "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e" };
const HOSTS_EDIT = { asm: "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01", acc: "7b1f3a92-2b5c-4d3e-8f41-6c8d9e0f1a02" };
const md5 = (b) => createHash("md5").update(b).digest("hex");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = { mode: "biground-1002-refire", startedAt: new Date().toISOString(), results: [], shots: {} };
const check = (shot, name, pass, detail = "") => {
  report.results.push({ shot, name, pass, detail: String(detail).slice(0, 500) });
  log(`${pass ? "✅" : "❌"} [${shot}] ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ""}`);
};
function writeReport() { writeFileSync(join(OUT_DIR, "refire-report.json"), JSON.stringify(report, null, 2)); }

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/qi21-refire-chrome-${Date.now()}`, "--window-size=1400,900", "--no-first-run",
    "--no-default-browser-check", ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
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
  if (!page) throw new Error("page target 未出现");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  return {
    close: () => ws.close(),
    ev: async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
      return r.result.value;
    },
  };
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
  for (let i = 0; i < 720; i++) {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(5000);
  }
  throw new Error("队列 60min 未空闲");
}
async function loadWorkflow(page, path) {
  const wfJson = JSON.parse(readFileSync(path, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app; if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'refire'); return 'opened'; })()`);
  if (opened !== "opened") throw new Error("loadGraphData 失败: " + opened);
  await sleep(2500);
  return wfJson.nodes.length;
}
async function dryPrompt(page) {
  const raw = await page.ev(`(async () => { try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); } catch (e) { return 'ERR:' + (e && e.message); } })()`);
  if (String(raw).startsWith("ERR:")) throw new Error("graphToPrompt: " + raw);
  return JSON.parse(String(raw));
}
function alphaCheck(png, expect) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [ALPHA_PY, png, expect], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { try { resolve({ exit: code, ...JSON.parse(out) }); } catch { resolve({ exit: code, error: err.slice(0, 200) }); } });
  });
}
function watchExecution(clientId) {
  // 先连后 POST 形态;clientId 与 POST 一致(事件只发持有 prompt 的 socket)
  let onMsg = () => {}, onErr = () => {};
  const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${clientId}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  const state = { executedNodes: [], errors: [], lastActivity: Date.now(), done: false };
  const startedAt = Date.now();
  let onBaseRan = null;
  let timer = null;
  const cleanup = () => { if (timer) clearInterval(timer); try { ws.close(); } catch {} };
  ws.on("error", (e) => { cleanup(); onErr(new Error("ws: " + e.message)); });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    state.lastActivity = Date.now();
    const d = m.data || {};
    if (m.type === "executing" && d.prompt_id && !state.pid) state.pid = d.prompt_id;
    if (m.type === "executing" && d.prompt_id === state.pid) {
      if (d.node === null) { state.done = true; cleanup(); onMsg(state); }
      else {
        if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
        if (onBaseRan && d.node === "6:4010") { const f = onBaseRan; onBaseRan = null; f(); }
      }
    } else if (m.type === "execution_error" && (d.prompt_id === state.pid || !d.prompt_id)) {
      state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 300)); cleanup(); onMsg(state);
    }
  });
  const readyP = new Promise((res, rej) => { ws.once("open", () => res()); ws.once("error", (e) => rej(e)); });
  return {
    state,
    async run(postFn, baseRan) {
      onBaseRan = baseRan || null;
      await readyP;
      timer = setInterval(() => {
        if (Date.now() - state.lastActivity > 20 * 60_000) { cleanup(); onErr(new Error("执行停滞>20min")); }
        if (Date.now() - startedAt > 70 * 60_000) { cleanup(); onErr(new Error("单发超时70min")); }
      }, 30_000);
      await postFn(); // POST 在 ws 已连之后
      return await new Promise((res, rej) => { onMsg = res; onErr = rej; });
    },
  };
}
async function fetchHistoryImage(pid, pngPath) {
  const hist = await (await fetch(`${ENGINE}/history/${pid}`)).json();
  const h = hist[pid] || {};
  const outputs = h.outputs || {};
  const saveOut = Object.values(outputs).find((o) => o.images && o.images.length);
  if (!saveOut) return { status: h.status?.status_str || "(missing)", text: null };
  const img = saveOut.images[0];
  const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`)).arrayBuffer());
  writeFileSync(pngPath, buf);
  const text = outputs["401"]?.ui?.text?.[0] ?? null;
  return { status: h.status?.status_str, pngBytes: buf.length, text };
}

// ══ A. s8 edit 空图重试(先快后慢) ══
async function refireEdit(page, seed, tag) {
  const key = `s8-retry-${tag}`;
  const rec = { key, seed, startedAt: new Date().toISOString() };
  report.shots[key] = rec;
  try {
    const n = await loadWorkflow(page, EDIT);
    await waitIdle();
    for (const [h, name, val] of [[HOSTS_EDIT.asm, "PE启用?", false], [HOSTS_EDIT.acc, "速度档位", "0 · Fun-Acc 4步"], [HOSTS_EDIT.acc, "seed", seed]]) {
      const r = await page.ev(setViaHook(h, name, val));
      if (String(r) !== `set:${name}=${val}`) check(key, `面板 ${name}`, false, r);
    }
    const prompt = await dryPrompt(page);
    const peVal = prompt["6:4012"]?.inputs?.value;
    check(key, "排队图 [4012]=false", peVal === false, String(peVal));
    const watcher = watchExecution(`refire-${tag}`);
    const exec = await watcher.run(async () => {
      const resp = await (await fetch(`${ENGINE}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, client_id: `refire-${tag}` }) })).json();
      if (!resp.prompt_id) throw new Error("POST 受理失败: " + JSON.stringify(resp).slice(0, 200));
      rec.pid = resp.prompt_id;
      log(`🚀 ${key} 已排队(seed=${seed})`);
    });
    rec.executedNodes = exec.executedNodes;
    if (exec.errors.length) { check(key, "执行零错误", false, exec.errors.join("|")); }
    const pngPath = join(OUT_DIR, `s8-edit-outfit-seed${seed}.png`);
    const h = await fetchHistoryImage(resp.prompt_id, pngPath);
    rec.historyStatus = h.status;
    if (!h.pngBytes) { check(key, "出图在位", false, h.status); return; }
    rec.png = pngPath; rec.pngBytes = h.pngBytes;
    const alpha = await alphaCheck(pngPath, "opaque");
    rec.alpha = alpha;
    const m = alpha.metrics || {};
    check(key, `透明判据:expect=opaque(重试 seed=${seed})`, alpha.pass === true,
      `${alpha.verdict};alphaMean=${m.alphaMean};ratio0=${m.ratioAlpha0 ?? m.ratio0}`);
    rec.alphaMean = m.alphaMean;
  } catch (e) { check(key, "驱动异常", false, String(e.message)); rec.error = String(e.message); }
  rec.secs = Math.round((Date.now() - new Date(rec.startedAt)) / 1000);
  writeReport();
}

// ══ B. s6-baseline 引擎侧去锚 ══
async function refireBaseline(page) {
  const key = "s6-baseline-refire";
  const rec = { key, seed: 424242, startedAt: new Date().toISOString() };
  report.shots[key] = rec;
  let restore = null;
  try {
    // run1 的缓存无效发留证改名
    const invalid = join(OUT_DIR, "s6-baseline-seed424242.png");
    if (existsSync(invalid)) { renameSync(invalid, join(OUT_DIR, "s6-baseline-seed424242.INVALID-cached.png")); log("run1 缓存无效发已改名 .INVALID-cached.png"); }
    await loadWorkflow(page, T2I);
    await waitIdle();
    for (const [h, name, val] of [[HOSTS_T2I.asm, "型选择", "人物"], [HOSTS_T2I.asm, "PE启用?", false], [HOSTS_T2I.asm, "透明", false], [HOSTS_T2I.asm, "手动宽", 0], [HOSTS_T2I.asm, "手动高", 0], [HOSTS_T2I.acc, "速度档位", "1 · 直出40步"], [HOSTS_T2I.acc, "seed", 424242]]) {
      const r = await page.ev(setViaHook(h, name, val));
      if (String(r) !== `set:${name}=${val}`) check(key, `面板 ${name}`, false, r);
    }
    const prompt = await dryPrompt(page);
    const b = prompt["6:4010"]?.inputs;
    check(key, "排队图 [4010].base=人物/透明覆盖=false", b?.base === "人物" && b?.透明覆盖 === false, JSON.stringify(b));
    const peVal = prompt["6:4012"]?.inputs?.value;
    check(key, "排队图 [4012]=false(PE关)", peVal === false, String(peVal));
    if (b?.base !== "人物" || peVal !== false) { check(key, "gate", false, "面板锚失配,不发弹"); return; }
    // 引擎侧去锚(执行真源)
    const orig = readFileSync(BASES_ENGINE);
    rec.basesMd5Before = md5(orig);
    const data = JSON.parse(orig.toString("utf8"));
    const entry = data.find((e) => e && e.zh === "人物");
    if (!entry || !entry.base_text.includes(ANCHOR_FULL)) { check(key, "引擎侧锚句在位可去", false, "前置失败"); return; }
    entry.base_text = entry.base_text.replace(ANCHOR_FULL, ANCHOR_BASE);
    rec.basesDeanchoredLen = entry.base_text.length;
    const bak = join(OUT_DIR, "qi21_bases.engine.baseline-backup.json");
    copyFileSync(BASES_ENGINE, bak);
    writeFileSync(BASES_ENGINE, JSON.stringify(data, null, 2) + "\n", "utf8");
    restore = () => { copyFileSync(bak, BASES_ENGINE); return md5(readFileSync(BASES_ENGINE)) === rec.basesMd5Before; };
    log(`引擎侧 qi21_bases.json 已去锚(人物 ${rec.basesDeanchoredLen} 字),POST→6:4010 执行→恢复`);
    const watcher = watchExecution("refire-s6b");
    let restoreOk = null;
    const exec = await watcher.run(async () => {
      const resp = await (await fetch(`${ENGINE}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, client_id: "refire-s6b" }) })).json();
      if (!resp.prompt_id) throw new Error("POST 受理失败: " + JSON.stringify(resp).slice(0, 200));
      rec.pid = resp.prompt_id;
      log(`🚀 ${key} 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=424242,直出40步 ~23min)`);
    }, () => {
      restoreOk = restore();
      log(`6:4010 已执行(去锚 BASE 已被读走)→ 引擎侧文件恢复 ${restoreOk ? "OK" : "FAIL"}`);
    });
    rec.executedNodes = exec.executedNodes;
    if (exec.errors.length) check(key, "执行零错误", false, exec.errors.join("|"));
    const pngPath = join(OUT_DIR, "s6-baseline-seed424242.png");
    const h = await fetchHistoryImage(resp.prompt_id, pngPath);
    rec.historyStatus = h.status;
    if (!h.pngBytes) { check(key, "出图在位", false, h.status); return; }
    rec.png = pngPath; rec.pngBytes = h.pngBytes;
    log(`🖼 ${key} 出图 ${h.pngBytes}B`);
    check(key, "⑥基线臂文证:最终文本不含锚句(引擎侧去锚生效)", typeof h.text === "string" && !h.text.includes(ANCHOR_SENT),
      `hasAnchor=${typeof h.text === "string" ? h.text.includes(ANCHOR_SENT) : "?"};len=${h.text?.length}(锚臂 2185,去锚预期 2162)`);
    rec.finalTextLen = h.text?.length ?? null;
    rec.finalTextHasAnchor = typeof h.text === "string" ? h.text.includes(ANCHOR_SENT) : null;
    check(key, "真实采样文证:7:7010 在执行集(非缓存秒回;run1 教训)", exec.executedNodes.includes("7:7010"), `7:7010=${exec.executedNodes.includes("7:7010")};6:4010=${exec.executedNodes.includes("6:4010")}`);
    check(key, "懒文证:6:4013/6:4019 不在执行集", !exec.executedNodes.includes("6:4013") && !exec.executedNodes.includes("6:4019"), "");
  } catch (e) {
    check(key, "驱动异常", false, String(e.message));
    rec.error = String(e.message);
  } finally {
    if (restore) {
      const ok = restore();
      check(key, "⑥基线臂:引擎侧 qi21_bases.json 已恢复(md5 验)", ok, ok ? "" : "md5 不符!");
      rec.basesRestored = ok;
    }
  }
  rec.secs = Math.round((Date.now() - new Date(rec.startedAt)) / 1000);
  writeReport();
}

// ══ main ══
let page = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  // 引擎侧与仓库侧 bases 一致性(去锚前)
  const eng = readFileSync(BASES_ENGINE);
  const repo = readFileSync(`${REPO}/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`);
  check("(env)", "引擎侧 bases==仓库真源(锚在场,md5 一致)", md5(eng) === md5(repo) && eng.includes(ANCHOR_SENT), `md5同=${md5(eng) === md5(repo)}`);
  launchChrome();
  page = await getPageClient();
  for (let i = 0; i < 60 && !(await page.ev("window.app && window.app.isGraphReady === true ? 1 : 0")); i++) await sleep(1000);
  await sleep(1500);
  // s8 空图重试:run1(seed3008)已被引擎节点缓存完整持有——同 seed 重发必全缓存秒回
  // (run1 补发实录:Prompt executed in 0.01s),真重跑需清缓存=重启引擎,而重启杀
  // 并行会话在用的前端态=禁区;故直取 seed 3009 新发(瞬态空白 vs 结构性判别)。
  check("(env)", "s8 同seed重试不可行文证(run1 空白输出已进节点缓存)", true,
    "同 prompt 重发=全缓存秒回(0.01s 实录);改判 seed3009 新发");
  await refireEdit(page, 3009, "seed3009");
  await refireBaseline(page);
} catch (e) {
  check("(env)", "环境段", false, String(e.message));
} finally {
  report.finishedAt = new Date().toISOString();
  writeReport();
  try { page?.close(); } catch {}
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
}
log("\n════ 补发汇总 ════");
for (const r of report.results) log(`${r.pass ? "✅" : "❌"} [${r.shot}] ${r.name}`);
process.exit(report.results.some((r) => !r.pass) ? 1 : 0);
