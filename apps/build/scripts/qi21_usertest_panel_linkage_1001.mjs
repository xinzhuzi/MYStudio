#!/usr/bin/env node
// qi21 用户测试批 P3·面板联动扩展真前端实弹(2026-10-01,Trellis
// 10-01-qi21-usetest-batch implement.md 步骤 9)。
//
// 前提:my_nodes/web/qi21-panel-linkage.js 已双家同步+引擎已重启
// (17599,/extensions/my-nodes/qi21-panel-linkage.js 已列)。
// 口径(ask 四场景,loadGraphData 真源装载后逐场景切换断言+截图):
//   S1 打开工作流自恢复:型=人物(九型)+PE开 → 透明隐藏+手动宽高隐藏;
//   S2 型切「自由」(onWidgetChanged 即时通路)→ 透明显示;
//   S3 切回九型「道具」(纯 value 赋值+轮询兜底通路)→ 透明复隐藏
//      +透明布尔值恒存(「只管显隐不管值」);
//   S4 PE 关(纯 value+轮询)→ 手动宽/手动高显示;
//   S5 PE 开(onWidgetChanged)→ 手动宽/手动高复隐藏。
// 附断言:扩展注册面(app.extensions 含 my.qi21.panel.linkage)/
//   isWidgetVisible 双口径/序列化零污染(宿主 widgets_values 恒六值,
//   hidden 不入保存)/装载后 console 零 error。
// 产物:apps/output/usertest-batch-1001/panel-linkage-*.png(五截图)+
//   panel-linkage-check-report.json。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9391)。
// 退出码 0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9391);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/usertest-batch-1001`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91"; // [40] 装配子图实例 uuid
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-panel-linkage-chrome-profile-${Date.now()}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleMsgs = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};

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
    if (m.method === "Runtime.consoleAPICalled") {
      consoleMsgs.push(`[console.${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
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
    async screenshot(name) {
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64")); log(`📸 ${name}`); }
      } catch {}
    },
  };
}

async function waitFor(fn, { timeout = 90_000, interval = 1000, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

class EnvError extends Error {}

// 页内探针片段:宿主定位+widget 读写(hidden 双口径+getLayoutWidgets)
const HOST_JS = `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w };
})()`;
const panelState = `JSON.stringify((() => {
  const h = ${HOST_JS}; if (!h) return null;
  const vis = (name) => { const w = h.w[name]; return w ? { hidden: !!w.hidden, isVis: h.host.isWidgetVisible ? h.host.isWidgetVisible(w) : null } : null; };
  return {
    values: { 型选择: h.w['型选择']?.value, PE开关: h.w['PE开关']?.value, 透明: h.w['透明']?.value, 手动宽: h.w['手动宽']?.value, 手动高: h.w['手动高']?.value },
    alpha: vis('透明'), manualW: vis('手动宽'), manualH: vis('手动高'),
    layoutNames: h.host.getLayoutWidgets ? h.host.getLayoutWidgets().map((x) => x.name) : null,
  };
})())`;
// 值切换 A:onWidgetChanged 钩子通路(litegraph 用户交互后的同一条官方钩子)
const setViaHook = (name, val) => `(async () => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;
// 值切换 B:纯 value 赋值(轮询兜底通路覆盖的非交互值源)
const setViaAssign = (name, val) => `(async () => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  h.w[${JSON.stringify(name)}].value = ${JSON.stringify(val)};
  return 'assign:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;

let page = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  // 0. 引擎+扩展就绪
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version, "fe", stats.system?.required_frontend_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("0.1 引擎已列新扩展 js", exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"),
    exts.filter((x) => x.includes("qi21-panel")).join(",") || "(未列)");

  // 1. 真前端装载(仓库真源零注入)
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000); // 启动期 console 噪音冲刷
  const preLoadCount = consoleMsgs.length;
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'p3-panel-linkage');
    return 'opened';
  })()`);
  check("1.1 loadGraphData(仓库真源原样)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(2000); // 扩展轮询首轮(400ms)+布局落定

  // 扩展注册面(真前端已加载)
  const reg = await page.ev(vis(`(window.app.extensions || []).some((e) => e && e.name === 'my.qi21.panel.linkage')`));
  check("1.2 扩展注册于真前端(app.extensions)", reg === true, String(reg));

  // 宿主居中(截图可读)
  await page.ev(`(() => { const h = ${HOST_JS}; if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h.host); return true; })()`);
  await page.ev(`window.app.canvas.setDirty(true, true)`);
  await sleep(600);

  // S1 打开工作流自恢复:人物(九型)+PE开 → 透明隐藏+手填隐藏
  console.log("[S1 打开工作流自恢复]");
  let st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S1.1 宿主面板就位(五控件名齐)", st && st.values.型选择 === "人物" && st.values.PE开关 === true,
    JSON.stringify(st?.values));
  check("S1.2 九型 → 透明隐藏(hidden)", st.alpha.hidden === true, JSON.stringify(st.alpha));
  check("S1.3 九型 → 透明不可见(isWidgetVisible 双口径)", st.alpha.isVis === false, JSON.stringify(st.alpha));
  check("S1.4 PE开 → 手动宽/手动高隐藏", st.manualW.hidden === true && st.manualH.hidden === true,
    JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S1.5 布局件不含隐藏控件(getLayoutWidgets)",
    !st.layoutNames.includes("透明") && !st.layoutNames.includes("手动宽") && !st.layoutNames.includes("手动高"),
    JSON.stringify(st.layoutNames));
  await page.screenshot("panel-linkage-s1-initial-nine-pe-on.png");

  // S2 型切「自由」(onWidgetChanged 即时通路)→ 透明显示
  console.log("[S2 切自由·透明显示]");
  const alphaBefore = st.values.透明;
  await page.ev(setViaHook("型选择", "自由"));
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S2.1 自由 → 透明显示(hidden=false·即时)", st.alpha.hidden === false, JSON.stringify(st.alpha));
  check("S2.2 自由 → 透明可见(isWidgetVisible)", st.alpha.isVis === true, JSON.stringify(st.alpha));
  check("S2.3 透明布尔值原样(零值写)", st.values.透明 === alphaBefore, `${alphaBefore} → ${st.values.透明}`);
  await page.screenshot("panel-linkage-s2-free-alpha-shown.png");

  // S3 切回九型「道具」(纯 value+轮询兜底)→ 透明复隐藏+值恒存
  console.log("[S3 切回九型·透明复隐藏]");
  const s3set = await page.ev(setViaAssign("型选择", "道具"));
  check("S3.0 值赋值成功(非钩子通路)", s3set === "assign:型选择=道具", String(s3set));
  await sleep(1200); // > 2×400ms tick
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S3.1 道具(九型)→ 透明复隐藏(轮询兜底通路)", st.alpha.hidden === true, JSON.stringify(st.alpha));
  check("S3.2 透明布尔值仍恒存(九型不覆写)", st.values.透明 === alphaBefore, `${alphaBefore} → ${st.values.透明}`);
  await page.screenshot("panel-linkage-s3-back-to-nine-alpha-hidden.png");

  // S4 PE 关(纯 value+轮询)→ 手动宽/手动高显示
  console.log("[S4 PE关·手填显示]");
  await page.ev(setViaAssign("PE开关", false));
  await sleep(1200);
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S4.1 PE关 → 手动宽/手动高显示", st.manualW.hidden === false && st.manualH.hidden === false,
    JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S4.2 手填值原样 0/0(零值写)", st.values.手动宽 === 0 && st.values.手动高 === 0,
    `${st.values.手动宽}/${st.values.手动高}`);
  await page.screenshot("panel-linkage-s4-pe-off-manual-shown.png");

  // S5 PE 开(onWidgetChanged)→ 手动宽/手动高复隐藏
  console.log("[S5 PE开·手填复隐藏]");
  await page.ev(setViaHook("PE开关", true));
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S5.1 PE开 → 手动宽/手动高复隐藏(即时)", st.manualW.hidden === true && st.manualH.hidden === true,
    JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S5.2 联动终态=初态(S1 口径复现)",
    st.alpha.hidden === true && st.manualW.hidden === true && st.manualH.hidden === true, "");
  await page.screenshot("panel-linkage-s5-pe-on-manual-hidden.png");

  // 6. 序列化零污染:hidden 不入保存(widgets_values 恒六值)
  console.log("[序列化零污染]");
  const ser = await page.ev(vis(`(() => {
    const h = ${HOST_JS}; if (!h) return null;
    const s = h.host.serialize ? h.host.serialize() : null;
    return s ? JSON.stringify({ wv: s.widgets_values, keys: Object.keys(s).filter((k) => /hidden/i.test(k)) }) : 'no-serialize';
  })()`));
  check("6.1 宿主 serialize widgets_values 恒六值(透明 false/手填 0 在位)",
    (() => { if (typeof ser !== "string") return false;
      try { const p = JSON.parse(ser); return Array.isArray(p.wv) && p.wv.length === 6 && p.wv[3] === alphaBefore && p.wv[4] === 0; }
      catch { return false; } })(), String(ser).slice(0, 200));
  check("6.2 serialize 零 hidden 键(纯 UI 态不入保存)",
    (() => { try { return JSON.parse(String(ser)).keys.length === 0; } catch { return false; } })(), String(ser).slice(0, 200));

  // 7. 装载后窗口 console 零 error(扩展侧不炸)
  await sleep(1000);
  const postLoad = consoleMsgs.slice(preLoadCount);
  const errs = postLoad.filter((m) => /error|uncaught|failed to/i.test(m));
  check("7.1 装载后 console 零 error", errs.length === 0, errs.slice(0, 3).join(" | ").slice(0, 300) || "(clean)");
} catch (e) {
  if (!(e instanceof EnvError)) results.push({ name: "驱动异常", pass: false, detail: String(e && e.message) });
  else check("环境段", false, e.message);
} finally {
  const report = {
    mode: "p3-panel-linkage-livefire", engine: ENGINE, wf: WF,
    finishedAt: new Date().toISOString(),
    results,
    consoleMsgs: consoleMsgs.slice(0, 60),
  };
  try { writeFileSync(join(OUT_DIR, "panel-linkage-check-report.json"), JSON.stringify(report, null, 2)); } catch {}
  try { page?.close(); } catch {}
  killChrome();
}
log("════ P3 面板联动实弹汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
