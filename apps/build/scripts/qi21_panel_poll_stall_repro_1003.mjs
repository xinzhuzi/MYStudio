#!/usr/bin/env node
// qi21-panel-linkage 400ms 兜底轮询「停摆」复现+判别(2026-10-03,轮询根因役)。
//
// 背景:昨日段A(qi21_thinking_mode_linkage_1002.mjs)报「多次 graphToPrompt
// 干跑后兜底轮询停摆」——tickAliveProbe(破坏手动宽 hidden=false→期望恢复
// true,8×300ms 恒 false)与 mode4Recovery(手置 mode=4→期望归位 0,12×300ms
// 恒 4)。两探针均跑在 A3.0(切 PE启用?=false)之后,而 PE 关态下扩展的
// 正确行为=手动宽显示(hidden=false)+mode 维持 4——假设:非停摆,是探针
// 用 PE 开态期望去判 PE 关态=判读假阳性。
//
// 本脚本三路判别(一次跑全拿):
//   R1 复现昨日口径:PE 关态跑昨日同款两探针 → 若「假死」复现,昨日观察可
//      由口径缺陷解释;
//   R2 同态正确口径:PE 关态破坏 manualW.hidden=true→期望恢复 false;手置
//      mode=0→期望拉回 4;PE 开态(干跑前后)破坏 hidden=false→期望 true、
//      手置 mode=4→期望归位 0 → 全恢复=轮询活着;
//   R3 spy 决定性:Page.addScriptToEvaluateOnNewDocument 劫持
//      setInterval/clearInterval,qi21 tick(interval 源码含 applyLinkage)
//      执行计数单调增/零 clear/零异常=轮询本体活着。
// 产物:apps/output/thinking-poll-stall-1003/report.json。
// 环境:引擎自拉(全机无 ComfyUI/main.py 才拉,同 biground argv,口 17599,
// 收摊杀净);Chrome headless CDP 9393。
// 退出码:0=全绿;1=有红;2=环境错。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9393);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/thinking-poll-stall-1003`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const HOME_COMFY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91"; // [6] 装配宿主子图实例 uuid(字节级核对着真源)
const THINK_HINT = "PE思考";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-pollstall-1003-chrome-${Date.now()}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const jq = (v) => JSON.stringify(v);
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
};

// ── spy:劫持 setInterval/clearInterval(文档创建期注入,先于扩展 import)──
const SPY_JS = `(() => {
  const S = { intervals: {}, cleared: [], pagehide: 0, errors: [], t0: Date.now() };
  window.__qi21Spy = S;
  const origSI = window.setInterval.bind(window);
  window.setInterval = function (fn, delay, ...args) {
    const src = String(fn);
    const rec = { delay, src: src.slice(0, 200), runs: 0, errs: [], created: Date.now() - S.t0 };
    const wrapped = function (...a) {
      rec.runs++;
      try { return fn.apply(this, a); }
      catch (e) { rec.errs.push({ msg: String(e && (e.message || e)), stack: String(e && e.stack || '').slice(0, 500), at: Date.now() - S.t0 }); throw e; }
    };
    const id = origSI(wrapped, delay, ...args);
    rec.id = id; S.intervals[String(id)] = rec;
    return id;
  };
  const origCI = window.clearInterval.bind(window);
  window.clearInterval = function (id, ...a) {
    const r = S.intervals[String(id)];
    S.cleared.push({ id, qi21: !!r, delay: r ? r.delay : null, runs: r ? r.runs : null, at: Date.now() - S.t0 });
    return origCI(id, ...a);
  };
  window.addEventListener('pagehide', () => { S.pagehide++; });
  window.addEventListener('error', (e) => { S.errors.push(String(e.message).slice(0, 200)); });
  window.addEventListener('unhandledrejection', (e) => { S.errors.push('rej:' + String(e.reason).slice(0, 200)); });
})();`;

// ── 页内探针(与昨日驱动器/扩展同款寻址)──
const HOST_JS = `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w };
})()`;
const STATE_JS = `(() => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const inner = h.host.subgraph && h.host.subgraph._nodes;
  const tn = Array.isArray(inner) && inner.find((x) => x && x.type === 'easy showAnything' && String(x.title ?? '').includes(${JSON.stringify(THINK_HINT)}));
  const g = (n) => (h.w[n] ? !!h.w[n].hidden : null);
  return JSON.stringify({ mw: g('手动宽'), mh: g('手动高'), alpha: g('透明'), pe: h.w['PE启用?'] ? h.w['PE启用?'].value : null, mode: tn ? tn.mode : null });
})()`;
const setPeViaHook = (val) => `(async () => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const w = h.w['PE启用?']; if (!w) return 'no-widget';
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.('PE启用?', ${JSON.stringify(val)}, old, w);
  return 'set:PE启用?=' + ${JSON.stringify(val)};
})()`;
const breakWidgetHidden = (name, val) => `(() => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; if (!w) return 'no-w';
  w.hidden = ${JSON.stringify(val)};
  return 'broken:${name}=' + ${JSON.stringify(val)};
})()`;
const setThinkMode = (m) => `(() => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const inner = h.host.subgraph && h.host.subgraph._nodes;
  const n = inner && inner.find((x) => x && x.type === 'easy showAnything' && String(x.title ?? '').includes(${JSON.stringify(THINK_HINT)}));
  if (!n) return 'no-think';
  n.mode = ${m};
  return 'mode=' + ${m};
})()`;
const dryPromptKeys = `(async () => {
  try { const p = await window.app.graphToPrompt(); const o = p.output || {};
    return JSON.stringify({ n: Object.keys(o).length, has4020: '6:4020' in o }); }
  catch (e) { return 'ERR:' + (e && (e.message || e)); }
})()`;

class EnvError extends Error {}
let chromeProc = null, page = null, engineProc = null, engineSelfLaunched = false;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", "about:blank"], { detached: true, stdio: "ignore" });
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
      target = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE))
        || list.find((t) => t.type === "page" && (t.url || "").startsWith("about:blank"));
      if (target) break;
    } catch {}
    await sleep(1200);
  }
  if (!target) throw new EnvError(`引擎前端 page target 未出现(90s)`);
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
    send, close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
      return r.result.value;
    },
  };
}
async function waitFor(fn, { timeout = 30_000, interval = 500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}
const parse = (r) => { try { return JSON.parse(String(r)); } catch { return { err: String(r).slice(0, 200) }; } };
async function readState() { return parse(await page.ev(STATE_JS)); }
// 隐探针:破坏 hidden→观察恢复(同昨日 8×300ms=2.4s 窗)
async function probeHidden(name, breakTo, expect, rounds = 8) {
  const b = await page.ev(breakWidgetHidden(name, breakTo));
  const seq = [];
  for (let i = 0; i < rounds; i++) {
    await sleep(300);
    const st = await readState();
    const key = name === "手动宽" ? "mw" : name === "手动高" ? "mh" : "alpha";
    seq.push(st?.[key]);
    if (st?.[key] === expect) break;
  }
  return { break: b, seq, recovered: seq.includes(expect) };
}
// mode 探针:手置 mode→观察拉回(同昨日 12×300ms=3.6s 窗)
async function probeMode(setTo, expect, rounds = 12) {
  const b = await page.ev(setThinkMode(setTo));
  const seq = [];
  for (let i = 0; i < rounds; i++) {
    await sleep(300);
    const st = await readState();
    seq.push(st?.mode);
    if (st?.mode === expect) break;
  }
  return { break: b, seq, recovered: seq.includes(expect) };
}
async function spySample() {
  const s = parse(await page.ev(`(() => { try { return JSON.stringify(window.__qi21Spy); } catch (e) { return 'ERR:' + e.message; } })()`));
  const qi21 = Object.values(s?.intervals ?? {}).filter((r) => r.src.includes("applyLinkage") || r.src.includes("attached"));
  return { allIntervals: Object.keys(s?.intervals ?? {}).length, qi21,
    clearedQi21: (s?.cleared ?? []).filter((c) => c.qi21), pagehide: s?.pagehide, errors: (s?.errors ?? []).slice(0, 5) };
}

const report = { mode: "poll-stall-repro-1003", startedAt: new Date().toISOString(), probes: {} };
try {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── 0. 引擎(全机无 ComfyUI/main.py 才自拉,同 biground argv)──
  const existing = await new Promise((res) => {
    const p = spawn("pgrep", ["-f", "ComfyUI/main.py"]);
    let out = ""; p.stdout.on("data", (d) => { out += d; }); p.on("close", () => res(out.split(/\s+/).filter(Boolean)));
    p.on("error", () => res([]));
  });
  if (existing.length) { throw new EnvError(`外部 ComfyUI/main.py 进程 ${existing} 在场,不自拉`); }
  const probe = async (t = 4) => { try { const r = await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(t * 1000) }); return r.status; } catch { return null; } };
  if (await probe() !== 200) {
    const argv = [`${HOME_COMFY}/venv/bin/python`, `${HOME_COMFY}/ComfyUI/main.py`,
      "--listen", "127.0.0.1", "--port", "17599", "--enable-manager",
      "--use-pytorch-cross-attention", "--gpu-only", "--reserve-vram", "16",
      "--input-directory", `${HOME_COMFY}/input`, "--output-directory", `${HOME_COMFY}/output`];
    log("自拉引擎 17599(biground 同 argv)…");
    engineProc = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore", env: { ...process.env, MYSTUDIO_COMFYUI_HOME: HOME_COMFY } });
    engineProc.unref(); engineSelfLaunched = true;
    const t0 = Date.now();
    while (Date.now() - t0 < 300_000) { if (await probe() === 200) break; await sleep(3000); }
    if (await probe() !== 200) throw new EnvError("引擎 300s 未就绪");
  }
  log("引擎就绪:", ENGINE);

  // ── 1. Chrome(about:blank 起)→ 注册 spy(NO_SPY=1 对照模式跳过=昨日原生环境)→ CDP 导航到引擎 ──
  const NO_SPY = process.env.NO_SPY === "1";
  launchChrome();
  page = await getPageClient();
  if (!NO_SPY) {
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_JS });
    await page.send("Page.navigate", { url: ENGINE });
    await waitFor(() => page.ev(`window.__qi21Spy ? 'spy' : null`), { timeout: 60_000, interval: 1000, label: "spy 生效(导航后新文档)" });
  } else {
    log("NO_SPY=1 对照模式:不注 spy(昨日原生环境)");
    await page.send("Page.navigate", { url: ENGINE });
  }
  await waitFor(() => page.ev(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`), { timeout: 120_000, interval: 2000, label: "前端就绪" });
  await sleep(3000);
  await sleep(3000);

  // ── 2. 装载 t2i + 装载归位(同昨日 A1)──
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'poll-stall-1003');
    return 'opened';
  })()`);
  check("S0.1 loadGraphData(t2i 真源)", opened === "opened", String(opened));
  // 画布切换等待 + 现场诊断(超时即抓原始返回)
  let nodesReady = false;
  try {
    await waitFor(() => page.ev(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`), { timeout: 40_000, interval: 1000, label: "画布切换" });
    nodesReady = true;
  } catch (e) {
    const diag = await page.ev(`(() => { try { return JSON.stringify({ nn: window.app.graph ? window.app.graph._nodes.length : -1, want: ${wfJson.nodes.length}, raw: ${STATE_JS} }); } catch (x) { return 'D:' + x.message; } })()`);
    log("画布切换超时诊断:", String(diag).slice(0, 300));
    throw e;
  }
  const t0 = await waitFor(async () => { const s = await readState(); return s && s.mode === 0 ? s : null; }, { timeout: 30_000, interval: 400, label: "[4020] 装载归位 mode==0" }).catch(async (e) => {
    const raw = await page.ev(STATE_JS);
    const spyRaw = await spySample();
    log("归位超时诊断: STATE=", String(raw).slice(0, 200), " spy=", jq(spyRaw.qi21.map((x) => ({ delay: x.delay, runs: x.runs }))).slice(0, 200));
    throw e;
  });
  check("S0.2 装载归位 mode==0(PE开默认)", t0?.mode === 0, jq(t0));

  // ── 3. spy 基线:qi21 tick 在册且在跑(NO_SPY 对照模式跳过 spy 断言)──
  const spy0 = await spySample();
  await sleep(2100);
  const spy1 = await spySample();
  const r0 = spy0.qi21[0]?.runs ?? null, r1 = spy1.qi21[0]?.runs ?? null;
  if (!NO_SPY) {
    check("S0.3 spy:qi21 400ms interval 在册(delay=400,src 含 applyLinkage)",
      spy0.qi21.length >= 1 && spy0.qi21.some((x) => x.delay === 400),
      `qi21Intervals=${jq(spy0.qi21.map((x) => ({ delay: x.delay, runs: x.runs })))}`);
    check("S0.4 spy:tick 执行计数单调增(2.1s 窗 ≈+5)",
      r1 !== null && r0 !== null && r1 > r0, `runs ${r0}→${r1}(Δ=${r1 - r0})`);
  }
  report.probes.spyBaseline = { r0, r1 };

  // ── 4. R4-a:PE 开态双探针(装载后,未干跑)──
  const pA_mw = await probeHidden("手动宽", false, true);
  const pA_mode = await probeMode(4, 0);
  report.probes.peOnBeforeDry = { mw: pA_mw, mode: pA_mode };
  check("S1.1 PE开·干跑前:破坏 manualW.hidden=false→恢复 true",
    pA_mw.recovered, jq(pA_mw.seq));
  check("S1.2 PE开·干跑前:手置 mode=4→归位 0",
    pA_mode.recovered, jq(pA_mode.seq));

  // ── 5. 干跑×10 + serialize×10(昨日 3 次量级 ×3 加压,复刻 A2/A3.2/Q3.8 窗)──
  const dry = [];
  for (let i = 0; i < 10; i++) {
    const d = String(await page.ev(dryPromptKeys));
    dry.push(d.slice(0, 40));
    await page.ev(`window.app.graph.serialize(); true`);
  }
  log("干跑×10+serialize×10:", dry.slice(0, 3).join(" | "), "…");

  // ── 6. R4-b:PE 开态双探针(干跑后)──
  const pB_mw = await probeHidden("手动宽", false, true);
  const pB_mode = await probeMode(4, 0);
  report.probes.peOnAfterDry = { mw: pB_mw, mode: pB_mode };
  check("S2.1 PE开·干跑后:破坏 manualW.hidden=false→恢复 true(轮询未停)",
    pB_mw.recovered, jq(pB_mw.seq));
  check("S2.2 PE开·干跑后:手置 mode=4→归位 0(轮询未停)",
    pB_mode.recovered, jq(pB_mode.seq));

  // ── 7. R1-a:切 PE=false(同昨日 A3.0)+ PE 关态干跑×10 → 昨日口径探针复现 ──
  const setOff = await page.ev(setPeViaHook(false));
  const stOff = await readState();
  const dryOff = [];
  for (let i = 0; i < 10; i++) {
    dryOff.push(String(await page.ev(dryPromptKeys)).slice(0, 40));
    await page.ev(`window.app.graph.serialize(); true`);
  }
  log(`PE关态干跑×10+serialize×10(封「PE关×多干跑组合杀轮询」反驳)`);
  // 昨日 tickAliveProbe:破坏 hidden=false,期望恢复 true(PE关态正确值=false)
  const yd_mw = await probeHidden("手动宽", false, true);
  // 昨日 mode4Recovery 前置:手置 mode=4,期望归位 0(PE关态正确值=4)
  const yd_mode = await probeMode(4, 0);
  report.probes.peOffYesterdayLens = { setOff, stOff, mw: yd_mw, mode: yd_mode };
  check("R1.1 复现昨日口径·隐:PE关态破坏 manualW.hidden=false→seq 恒 false(『不恢复』=正确态,假死复现)",
    !yd_mw.recovered && yd_mw.seq.length >= 2 && yd_mw.seq.every((x) => x === false),
    `seq=${jq(yd_mw.seq)} pe=${stOff?.pe}`);
  check("R1.2 复现昨日口径·mode:PE关态手置 mode=4→seq 恒 4(『不归位』=正确态,假死复现)",
    !yd_mode.recovered && yd_mode.seq.every((x) => x === 4),
    `seq=${jq(yd_mode.seq)} pe=${stOff?.pe}`);

  // ── 8. R2:同态正确口径(PE 关态×10 连干跑后)──
  const pC_mw = await probeHidden("手动宽", true, false);   // 破坏=错误隐藏→期望恢复显示
  const pC_mode = await probeMode(0, 4);                     // 手置=错误归0→期望拉回4
  report.probes.peOffCorrectLens = { mw: pC_mw, mode: pC_mode };
  check("R2.1 PE关·正确口径:破坏 manualW.hidden=true→恢复 false(显示)=轮询活着",
    pC_mw.recovered, jq(pC_mw.seq));
  check("R2.2 PE关·正确口径:手置 mode=0→拉回 4=轮询活着",
    pC_mode.recovered, jq(pC_mode.seq));

  // ── 9. 切回 PE=true 终态自洽 + spy 终采 ──
  const setOn = await page.ev(setPeViaHook(true));
  const stOn = await readState();
  await page.ev(dryPromptKeys);
  const pD_mw = await probeHidden("手动宽", false, true);
  report.probes.peOnFinal = { setOn, stOn, mw: pD_mw };
  check("S3.1 切回 PE开:manualW 破坏后恢复 true(全序列尾仍活)", pD_mw.recovered, jq(pD_mw.seq));
  const spyEnd = await spySample();
  const rEnd = spyEnd.qi21[0]?.runs ?? null;
  if (!NO_SPY) {
    check("R3.1 spy 终采:tick runs 单调增至尾(全程在跑)",
      rEnd !== null && rEnd > r1, `runs ${r1}→${rEnd}`);
    check("R3.2 spy:qi21 interval 零 clearInterval", spyEnd.clearedQi21.length === 0, jq(spyEnd.clearedQi21));
    check("R3.3 spy:tick 零异常", (spyEnd.qi21[0]?.errs ?? []).length === 0, jq((spyEnd.qi21[0]?.errs ?? []).slice(0, 2)));
    check("R3.4 spy:零 pagehide", spyEnd.pagehide === 0, String(spyEnd.pagehide));
  }
  report.probes.spyEnd = { runs: rEnd, clearedQi21: spyEnd.clearedQi21, errs: spyEnd.qi21[0]?.errs ?? [], pagehide: spyEnd.pagehide };
} catch (e) {
  if (e instanceof EnvError) { check("环境段", false, e.message); process.exitCode = 2; }
  else { results.push({ name: "驱动异常", pass: false, detail: String(e && e.message) }); log("驱动异常:", e); }
} finally {
  report.finishedAt = new Date().toISOString();
  report.results = results;
  report.pass = results.length > 0 && results.every((r) => r.pass);
  try { writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2)); } catch {}
  try { page?.close(); } catch {}
  killChrome();
  if (engineSelfLaunched && engineProc) { try { process.kill(-engineProc.pid, "SIGTERM"); log("收摊:引擎已停(自拉实例)"); } catch {} }
}
log("════ 轮询停摆复现判别汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
