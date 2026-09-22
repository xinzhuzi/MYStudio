#!/usr/bin/env node
/**
 * Qwen-Image-2.1 双工作流真前端 E2E(09-23):
 * Chrome(headless)开引擎前端 http://127.0.0.1:17002 → CDP 注入
 * app.loadGraphData 载入仓库两条 Q2-1 工作流 → 画布改参(真实 widget 回调)
 * → app.queuePrompt()(真前端序列化+排队,禁 API 转换器)→ 引擎 /history
 * 轮询本单完成 → /view 取真图 → 产物落 E2E_DIR。
 *
 * 仿 cdp-daojie-krea2-ink-e2e.mjs / cdp-e2e-daojie-dugu-generation.mjs 的
 * CDP WebSocket + Runtime.evaluate 通道;差别:目标是引擎前端页本身
 * (无 Electron webview 中转)。
 *
 * 控制台零报错取证:Runtime.consoleAPICalled(error/assert)+ Log.entryAdded(error)
 * + Runtime.exceptionThrown 全量收集,原文落 E2E_DIR/console-errors.json。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_0923.mjs
 * 退出码:0=双绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qwen21-e2e-0923";
const WF_DIR = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像";
const WF_T2I = join(WF_DIR, "1_文生图/qwen21-t2i.json");
const WF_EDIT = join(WF_DIR, "3_改图/qwen21-edit.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qwen21-e2e-0923-chrome-profile";
const T2I_TIMEOUT = Number(process.env.T2I_TIMEOUT_MS || 1_800_000);
const EDIT_TIMEOUT = Number(process.env.EDIT_TIMEOUT_MS || 2_100_000);

const T2I_PROMPT = "A serene mountain lake at sunrise, soft mist over the water, warm golden light on distant snowy peaks, a small wooden boat near the shore, photorealistic, ultra detailed, professional landscape photography";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, "");

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
    "--disable-background-timer-throttling",
    ENGINE,
  ], { detached: true, stdio: "ignore" });
  chromeProc.unref();
  log("chrome spawned pid", chromeProc.pid);
}

function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch { /* already gone */ } }
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
    } catch { /* 端口未就绪 */ }
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
      return;
    }
    // ── 控制台报错全量收集(零报错取证)──
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
      consoleErrors.push({ src: "console", type: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000),
        ts: new Date().toISOString() });
    } else if (m.method === "Log.entryAdded" && (m.params.entry?.level === "error")) {
      consoleErrors.push({ src: "log", level: m.params.entry.level, text: m.params.entry.text,
        url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000),
        ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 500);
      return r.result.value;
    },
    async screenshot(name) {
      const path = join(E2E_DIR, `${name}.png`);
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* fallthrough */ }
      log(`📸 失败 ${path}`);
    },
  };
}

async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时: ${label}`);
}

/** 画布载入工作流(真前端 loadGraphData,同参考脚本 openWorkflowInCanvas)。 */
async function loadWorkflow(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 画布改 widget(真实 widget.value + callback,同参考脚本图生图参考图注入)。
 * 节点定位按 type(+title 片段)而非 JSON id——loadGraphData 会重新分配节点 id。 */
function setWidget(page, type, titlePart, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)}
      && (!${JSON.stringify(titlePart)} || String(n.title || '').includes(${JSON.stringify(titlePart)})));
    if (!n) return 'node-missing:' + ${JSON.stringify(type)} + '/' + ${JSON.stringify(titlePart)};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:' + String(w.value);
  })()`);
}

/** 队列图形态取证:graphToPrompt 后指定类型全部节点的 inputs(证明改参真进了排队图)。 */
function promptDigest(page, classType, fields) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const out = [];
      for (const k of Object.keys(p.output || {}).sort()) {
        if (p.output[k].class_type === ${JSON.stringify(classType)}) {
          const o = { node: k };
          for (const f of ${JSON.stringify(fields)}) o[f] = p.output[k].inputs[f];
          out.push(o);
        }
      }
      return out.length ? JSON.stringify(out) : 'class-not-found:' + ${JSON.stringify(classType)};
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
}

/** 真前端 queuePrompt(前端序列化→POST /prompt,非自写转换器)。 */
function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

/** 引擎 /history 轮询本单(feature 匹配排队图特征),完成取 SaveImage 产物。 */
async function waitHistory(feature, { timeout }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          const msgs = JSON.stringify(e.status?.messages || []).slice(0, 3000);
          return { pid, error: `引擎执行 error: ${msgs}` };
        }
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length && (st === "completed" || st === "success")) return { pid, imgs, status: st };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf.length;
}

/** 跑一件:载入→改参→queue→history→取图。steps=[{type,titlePart?,widget,value}],digests=[{classType,fields}] */
async function runCase(page, { tag, wfPath, tabName, nodeCount, steps, digests, feature, timeoutMs, outPrefix }) {
  const graphJson = JSON.parse(readFileSync(wfPath, "utf8"));
  const opened = await loadWorkflow(page, tabName, graphJson);
  check(`${tag}: 工作流载入(前端 loadGraphData)`, opened === "opened", String(opened));
  if (opened !== "opened") return null;

  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `${tag} 画布切换(${nodeCount} 节点)` });
  check(`${tag}: 画布节点数=${nodeCount}`, true);
  await sleep(1500); // widget 序列化落位

  for (const step of steps) {
    const r = await setWidget(page, step.type, step.titlePart || "", step.widget, step.value);
    check(`${tag}: 改参 ${step.type}${step.titlePart ? "/" + step.titlePart : ""}.${step.widget}`, String(r).startsWith("set:"), String(r));
    if (!String(r).startsWith("set:")) return null;
  }
  await sleep(1200);

  for (const d of digests) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[${tag}] 队列图取证 ${d.classType}:`, String(dg).slice(0, 360));
  }
  await page.screenshot(`${outPrefix}-1-loaded`);

  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
  if (queued !== "queued") return null;

  const hist = await waitHistory(feature, { timeout: timeoutMs });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, `${hist.error}(${secs}s)`);
    return null;
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const outPath = join(E2E_DIR, `${outPrefix}-${stamp()}.png`);
  const bytes = await fetchView(saveImg, outPath);
  check(`${tag}: 引擎出图(/view 取回)`, bytes > 50_000,
    `${saveImg.filename} → ${outPath} (${(bytes / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${hist.pid.slice(0, 8)})`);
  await sleep(1500);
  await page.screenshot(`${outPrefix}-2-done`);
  return { outPath, secs, pid: hist.pid, engineFile: saveImg.filename };
}

async function main() {
  const report = { engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  for (const f of [WF_T2I, WF_EDIT]) {
    if (!existsSync(f)) { console.error("工作流缺失:", f); process.exit(2); }
  }
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  log("① 拉起 Chrome(headless)开引擎前端");
  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");

  log("② 等 ComfyUI 前端 graph 就绪");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  log("③ t2i 实弹(ResolutionSelector 1:1 + 1MP = 1024x1024)");
  const t2i = await runCase(page, {
    tag: "t2i", wfPath: WF_T2I, tabName: "qwen21-t2i",
    nodeCount: JSON.parse(readFileSync(WF_T2I, "utf8")).nodes.length,
    steps: [
      { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
      { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
      { type: "TextEncodeQwenImage21", widget: "prompt", value: T2I_PROMPT },
    ],
    digests: [
      { classType: "ResolutionSelector", fields: ["aspect_ratio", "megapixels"] },
      { classType: "TextEncodeQwenImage21", fields: ["prompt", "resolution"] },
    ],
    feature: (blob) => blob.includes(T2I_PROMPT.slice(0, 40)),
    timeoutMs: T2I_TIMEOUT, outPrefix: "t2i",
  });
  report.cases.t2i = t2i;

  log("④ edit 实弹(双 LoadImage 官方示例图,resolution=0 跟随 image_1)");
  const edit = await runCase(page, {
    tag: "edit", wfPath: WF_EDIT, tabName: "qwen21-edit",
    nodeCount: JSON.parse(readFileSync(WF_EDIT, "utf8")).nodes.length,
    steps: [
      { type: "LoadImage", titlePart: "image_1", widget: "image", value: "portrait_model_denim.png" },
      { type: "LoadImage", titlePart: "image_2", widget: "image", value: "clothing_light_blue_denim_shirt.png" },
    ],
    digests: [
      { classType: "LoadImage", fields: ["image"] },
      { classType: "TextEncodeQwenImage21", fields: ["prompt", "resolution"] },
    ],
    feature: (blob) => blob.includes("portrait_model_denim.png") && blob.includes("clothing_light_blue_denim_shirt.png"),
    timeoutMs: EDIT_TIMEOUT, outPrefix: "edit",
  });
  report.cases.edit = edit;

  // ── 收尾取证 ──
  writeFileSync(join(E2E_DIR, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));
  check("前端控制台零报错(error/assert/exception 全程收集)", consoleErrors.length === 0,
    consoleErrors.length
      ? `${consoleErrors.length} 条,原文见 console-errors.json;首条: ${String(consoleErrors[0]?.text).slice(0, 200)}`
      : "0 条");
  report.consoleErrorCount = consoleErrors.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "e2e-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ E2E 全部通过" : "❌ E2E 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-errors.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* 尽力 */ }
  killChrome();
  process.exit(1);
});
