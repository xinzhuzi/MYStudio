#!/usr/bin/env node
// qi21 用户测试批 P2·真前端 loadGraphData 验证(2026-10-01,Trellis
// 10-01-qi21-usetest-batch implement.md 步骤 6 预期「真前端 loadGraphData
// missing=0」)。
//
// 口径(missing=0 的可执行化):
//   A. object_info:术后接口面在引擎注册([150] 六出+透明覆盖/[151] 手动宽高);
//   B. 仓库真源 JSON 原样 loadGraphData(零注入,同 s10 落盘版终验先例);
//   C. 画布节点数=12/活链=14(主图零丢件零丢线);
//   D. 干跑 graphToPrompt 成功且展开计数:40: 前缀恰 8(9 件-MarkdownNote)、
//      208: 前缀恰 6、根恰 12——转换层零 missing(缺类型/缺输入/断链即抛);
//   E. 宿主面板六控件名序+值(Q3 序)+加速宿主两控件;
//   F. 展开排队图接线抽验:152.透明模式←150 输出槽5(透明值)/151.联动开关=
//      PE开关值/151.手动宽=0/手动高=0/150.透明覆盖=false(纯布尔跨界);
//   G. 装载期 console 零 missing/error 级告警(逐条记录)。
// 产物:apps/output/usertest-batch-1001/loadgraph-check-report.json + 截图。
// 环境变量:ENGINE_URL(默认 17000,引擎操作员 keeper 已拉)/CDP_PORT(默认 9377)。
// 退出码 0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const CDP_PORT = Number(process.env.CDP_PORT || 9377);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/usertest-batch-1001`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";   // [40] 装配子图实例 uuid(术后)
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"; // [208] 加速子图 uuid
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-usertest-loadgraph-chrome-profile";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleMsgs = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
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
    if (m.method === "Log.entryAdded") consoleMsgs.push(`[log] ${m.params.entry.level} ${m.params.entry.text}`);
    if (m.method === "Runtime.consoleAPICalled") {
      consoleMsgs.push(`[console.${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable").catch(() => {});
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 500);
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

class EnvError extends Error {}

const wfJson = JSON.parse(readFileSync(WF, "utf8"));
const MAIN_NODES = wfJson.nodes.length;      // 12
const MAIN_LINKS = wfJson.links.length;      // 14
const SUBJ = wfJson.nodes.find((n) => n.id === 40).widgets_values[0];

let page = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  // A. 引擎与术后接口面
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const baseInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21DaojieBase`)).json()).MyQi21DaojieBase;
  check("A1 [150] 六出(BASE..透明值)", JSON.stringify(baseInfo.output_name) ===
    JSON.stringify(["BASE", "WIDTH", "HEIGHT", "型名", "rgba_default", "透明值"]),
    JSON.stringify(baseInfo.output_name));
  check("A2 [150] optional 透明覆盖", !!baseInfo.input?.optional?.透明覆盖, "");
  const whInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21WhSuggest`)).json()).MyQi21WhSuggest;
  check("A3 [151] optional 手动宽/手动高", !!whInfo.input?.optional?.手动宽 && !!whInfo.input?.optional?.手动高,
    JSON.stringify(Object.keys(whInfo.input?.optional || {})));

  // B. 真前端装载(仓库真源零注入);装载前静置 3s 让启动期 console 噪音
  //    (vite preloadError/legacy menu 弃用告警等,与本工作流无关)先冲刷完,
  //    G1 只扫装载后窗口
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000);
  const preLoadCount = consoleMsgs.length;
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'p2-usertest-verify');
    return 'opened';
  })()`);
  check("B1 loadGraphData(仓库真源原样·零注入)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${MAIN_NODES} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(2000);

  // C. 主图零丢件零丢线(links=LinkMap,按键数计)
  const canvasCounts = await page.ev(vis(`JSON.stringify({
    nodes: window.app.graph._nodes.length,
    liveLinks: Object.keys(window.app.graph.links || {}).length,
  })`));
  const cc = JSON.parse(String(canvasCounts));
  check(`C1 主图节点数=${MAIN_NODES}`, cc.nodes === MAIN_NODES, canvasCounts);
  check(`C2 主图活链=${MAIN_LINKS}`, cc.liveLinks === MAIN_LINKS, canvasCounts);

  // D. 干跑 graphToPrompt(转换层 missing=0 的判定件;展开=根9(12-Note-两宿主)
  //    +40:前缀8(9件-Note)+208:前缀6(三支路全量,lazy 裁剪发生在执行期非转换期))
  const dryRaw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(dryRaw).startsWith("ERR:")) {
    check("D1 干跑 graphToPrompt 成功(零 missing)", false, String(dryRaw).slice(0, 400));
    throw new EnvError("graphToPrompt 失败:缺类型/缺输入/断链");
  }
  const prompt = JSON.parse(String(dryRaw));
  const keys = Object.keys(prompt);
  const asmKeys = keys.filter((k) => k.startsWith("40:"));
  const accKeys = keys.filter((k) => k.startsWith("208:"));
  const rootKeys = keys.filter((k) => !k.includes(":"));
  check("D2 装配子图展开=8(9件-Note)", asmKeys.length === 8, `得 ${asmKeys.length}:${JSON.stringify(asmKeys)}`);
  check("D3 加速子图展开=6(三支路全量)", accKeys.length === 6, `得 ${accKeys.length}:${JSON.stringify(accKeys)}`);
  check(`D4 根节点=9(${MAIN_NODES}-Note-两宿主)`, rootKeys.length === MAIN_NODES - 3, `得 ${rootKeys.length}:${JSON.stringify(rootKeys)}`);
  check("D5 三态件 MyQi21RgbaSelect 零注册(退役)", !keys.some((k) => prompt[k].class_type === "MyQi21RgbaSelect"), "");

  // E. 宿主面板控件名序+值(Q3 序)
  const panel = await page.ev(vis(`JSON.stringify((() => {
    const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
    const acc  = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ACCEL)});
    const pick = (n) => n && n.widgets ? n.widgets.map((w) => [w.name, w.value, w.type]) : null;
    return { asm: pick(host), acc: pick(acc) };
  })())`));
  const pv = JSON.parse(String(panel));
  const asmNames = (pv.asm || []).map((w) => w[0]);
  const asmVals = (pv.asm || []).map((w) => w[1]);
  check("E1 装配宿主六控件名序(Q3)", JSON.stringify(asmNames) ===
    JSON.stringify(["主体句", "型选择", "PE开关", "透明", "手动宽", "手动高"]), JSON.stringify(asmNames));
  const wantVals = [SUBJ, "人物", true, false, 0, 0];
  check("E2 装配宿主六控件值", JSON.stringify(asmVals) === JSON.stringify(wantVals),
    JSON.stringify(asmVals).slice(0, 200));
  const asmTypes = (pv.asm || []).map((w) => w[2]);
  check("E3 透明=toggle/手动宽高=number 控件型(前端 widget 型名)",
    asmTypes[3] === "toggle" && asmTypes[4] === "number" && asmTypes[5] === "number",
    JSON.stringify(asmTypes));
  const accNames = (pv.acc || []).map((w) => w[0]);
  check("E4 加速宿主两控件(速度档位/seed)", JSON.stringify(accNames) === JSON.stringify(["速度档位", "seed"]),
    JSON.stringify(accNames));

  // F. 展开排队图接线抽验(纯布尔跨界+扇出+手填)
  const byType = (cls) => Object.entries(prompt).filter(([, v]) => v.class_type === cls);
  const bases = byType("MyQi21DaojieBase");
  check("F1 装配内 [150] 恰 1 件", bases.length === 1, JSON.stringify(bases.map(([k]) => k)));
  const baseIn = bases[0][1].inputs;
  check("F2 [150].base=人物/透明覆盖=false(面板直通)",
    baseIn.base === "人物" && baseIn.透明覆盖 === false, JSON.stringify(baseIn));
  const whs = byType("MyQi21WhSuggest");
  check("F3 装配内 [151] 恰 1 件", whs.length === 1, JSON.stringify(whs.map(([k]) => k)));
  const whIn = whs[0][1].inputs;
  const peSwitchVal = prompt[Object.keys(prompt).find((k) => prompt[k].class_type === "MyQi21PromptSelect")]?.inputs?.pe开关;
  check("F4 [151].联动开关=PE开关面板值(true=建议路)", whIn.联动开关 === true, `联动开关=${whIn.联动开关}`);
  check("F5 [151].手动宽=0/手动高=0(0=跟型)", whIn.手动宽 === 0 && whIn.手动高 === 0,
    `手动宽=${whIn.手动宽} 手动高=${whIn.手动高}`);
  const sels = byType("MyQi21PromptSelect");
  check("F6 [152] 恰 1 件+pe开关=true", sels.length === 1 && sels[0][1].inputs.pe开关 === true,
    `pe开关=${sels[0]?.[1]?.inputs?.pe开关}`);
  const baseKey = bases[0][0];
  const tmRef = sels[0][1].inputs.透明模式;
  check("F7 [152].透明模式 ← [150] 输出槽5(透明值)", Array.isArray(tmRef) && tmRef[0] === baseKey && tmRef[1] === 5,
    JSON.stringify(tmRef));
  const sws = Object.entries(prompt).filter(([, v]) => v.class_type === "ComfySwitchNode");
  const swRef = sws.map(([, v]) => v.inputs.switch);
  check("F8 [144].switch ← [150] 输出槽5(透明值,纯布尔)",
    sws.length === 1 && Array.isArray(swRef[0]) && swRef[0][0] === baseKey && swRef[0][1] === 5,
    JSON.stringify(swRef));
  check("F9 [151].wh_ratio ← [140](lazy 链保持)", Array.isArray(whIn.wh_ratio) &&
    prompt[whIn.wh_ratio[0]]?.class_type === "QwenImage21_T2IPromptRewrite", JSON.stringify(whIn.wh_ratio));

  // G. 装载后窗口 console/log 告警扫描(启动期噪音不属本工作流,G1 只看装载后)
  await sleep(1000);
  const postLoad = consoleMsgs.slice(preLoadCount);
  const bad = postLoad.filter((m) => /missing|not found|unknown node|failed to|error/i.test(m));
  check("G1 装载后零 missing/error 级告警", bad.length === 0,
    bad.slice(0, 5).join(" | ").slice(0, 400) || `(clean;装载后窗口 ${postLoad.length} 条全无告警)`);

  await page.screenshot("loadgraph-p2-verify.png");
} catch (e) {
  if (!(e instanceof EnvError)) results.push({ name: "驱动异常", pass: false, detail: String(e && e.message) });
  else check("环境段", false, e.message);
} finally {
  const report = {
    mode: "p2-loadgraph-verify", engine: ENGINE, wf: WF,
    wfNote: "仓库真源原样装载(loadGraphData 零注入)",
    finishedAt: new Date().toISOString(),
    results,
    consoleMsgs: consoleMsgs.slice(0, 80),
  };
  try { writeFileSync(join(OUT_DIR, "loadgraph-check-report.json"), JSON.stringify(report, null, 2)); } catch {}
  try { page?.close(); } catch {}
  killChrome();
}
log("════ P2 loadGraphData 验证汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
