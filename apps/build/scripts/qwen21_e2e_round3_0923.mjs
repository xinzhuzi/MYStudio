#!/usr/bin/env node
/**
 * Qwen-Image-2.1 PE-T2I bf16 件 实弹 E2E · round 3(09-23):
 * 验证自转 bf16 PE 文本编码器(qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors,
 * apps/build/scripts/qwen21_pe_bf16_convert_0923.py 产物)在 MPS 上真跑通——
 * int8 旧件首轮已证死于 aten::_int_mm 无 MPS 内核(round2/pe-mps-fail.txt)。
 *
 * 相对 round2(qwen21_e2e_round2_0923.mjs)的差异:仅保留 pe phase,产物落
 * round3/,改写文本存 pe_rewritten_prompt_bf16.txt;节点定位同款 type+title 片段。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_round3_0923.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const execFileP = promisify(execFile);

const PHASE = "pe";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qwen21-e2e-0923/round3";
const WF_T2I = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qwen21-r3-${PHASE}-chrome-profile`;
const PE_TIMEOUT = Number(process.env.PE_TIMEOUT_MS || 3_600_000);   // 60 min(9B bf16 在 MPS 生成)
const PE_CLIP_NEW = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors";

const PE_ZH_PROMPT = "一位水墨风格的修仙少年立于山巅";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0;
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
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch { /* gone */ } }
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
    } catch { /* port not ready */ }
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
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
      consoleErrors.push({ src: "console", type: m.params.type, phase: PHASE,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000),
        ts: new Date().toISOString() });
    } else if (m.method === "Log.entryAdded" && (m.params.entry?.level === "error")) {
      consoleErrors.push({ src: "log", phase: PHASE, text: m.params.entry.text, url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", phase: PHASE, text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000), ts: new Date().toISOString() });
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
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 800);
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

async function loadWorkflow(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 节点定位按 type+title 片段(勿按 JSON id)。 */
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

function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

/** pe 模式:临时接线 ShowText|pysssss 到 PE positive_prompt(仅画布运行态,不落盘 JSON)。 */
function wireShowText(page) {
  return page.ev(`(() => {
    const app = window.app;
    if (!window.LiteGraph || !window.LiteGraph.createNode) return 'no-LiteGraph';
    const pe = app.graph._nodes.find(n => n.type === 'QwenImage21_T2IPromptRewrite');
    if (!pe) return 'pe-node-missing';
    const st = window.LiteGraph.createNode('ShowText|pysssss');
    if (!st) return 'showtext-create-failed';
    st.title = 'E2E-PE捕获(临时)';
    st.pos = [120, 1900];
    app.graph.add(st);
    const c = pe.connect(0, st, 0);
    return c ? 'wired:showtext#' + st.id : 'connect-failed';
  })()`);
}

async function waitHistory(feature, { timeout, knownPids = new Set() }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error(全量 messages): ${JSON.stringify(e.status?.messages || []).slice(0, 20000)}` };
        }
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages };
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
  return buf;
}

async function pngMagic(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
    return { w: Number(w), h: Number(h), raw: stdout.trim() };
  } catch (e) { return { err: String(e.message) }; }
}

async function main() {
  const report = { phase: PHASE, engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF_T2I)) { console.error("工作流缺失:", WF_T2I); process.exit(2); }
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF_T2I, "utf8"));
  const opened = await loadWorkflow(page, "t2i-pe-bf16", graphJson);
  check("t2i-pe: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === 16 ? 16 : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换(16 节点)" });
  await sleep(1500);

  // 画布 PE 加载器 widgets 取证:必须已指新 bf16 件
  const peClipWidget = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'CLIPLoader' && String(n.title || '').includes('PE文本编码加载'));
    return n ? String(n.widgets_values ? n.widgets_values[0] : n.widgets[0].value) : 'node-missing';
  })()`);
  check("t2i-pe: 画布 PE CLIPLoader 指向 bf16 件", peClipWidget === PE_CLIP_NEW, String(peClipWidget).slice(0, 200));

  const wired = await wireShowText(page);
  check("t2i-pe: ShowText 临时接线(捕获改写文本)", String(wired).startsWith("wired:"), String(wired));

  const steps = [
    { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
    { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
    { type: "QwenImage21_T2IPromptRewrite", widget: "prompt", value: PE_ZH_PROMPT },
    { type: "ComfySwitchNode", titlePart: "提示词开关", widget: "switch", value: true },
  ];
  for (const s of steps) {
    const r = await setWidget(page, s.type, s.titlePart || "", s.widget, s.value);
    check(`t2i-peON: 改参 ${s.type}${s.titlePart ? "/" + s.titlePart : ""}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(1200);
  for (const d of [
    { classType: "QwenImage21_T2IPromptRewrite", fields: ["prompt", "max_new_tokens", "presence_penalty"] },
    { classType: "ComfySwitchNode", fields: ["switch"] },
    { classType: "CLIPLoader", fields: ["clip_name", "type"] },
  ]) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[t2i-pe] 队列图取证 ${d.classType}:`, String(dg).slice(0, 500));
  }
  await page.screenshot("t2i-pe-1-loaded");

  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check("t2i-peON: queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") { page.close(); killChrome(); process.exit(1); }

  const hist = await waitHistory((blob) => blob.includes(PE_ZH_PROMPT), { timeout: PE_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("t2i-peON: 引擎出图", false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    report.cases.pe = { error: hist.error, secs };
  } else {
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const outPath = join(E2E_DIR, `t2i-pe-${stamp()}.png`);
    const buf = await fetchView(saveImg, outPath);
    const magic = await pngMagic(buf);
    const size = await sipsSize(outPath);
    check("t2i-peON: PNG 魔数", magic === true, outPath);
    check("t2i-peON: sips 尺寸", size.w === 1024 && size.h === 1024, `${size.w}x${size.h}`);
    check("t2i-peON: 引擎出图(/view 取回)", buf.length > 50_000,
      `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${hist.pid.slice(0, 8)})`);
    report.cases.pe = { outPath, secs, pid: hist.pid, engineFile: saveImg.filename, size, hist: { outputs: hist.outputs, messages: hist.messages } };

    let texts = [];
    for (const o of Object.values(hist.outputs || {})) {
      if (o && Array.isArray(o.text)) texts.push(...o.text);
    }
    const full = texts.sort((a, b) => b.length - a.length)[0] || "";
    if (full) {
      writeFileSync(join(E2E_DIR, "pe_rewritten_prompt_bf16.txt"), full);
      check("t2i-peON: 改写文本捕获(ShowText)", true, `${full.length} 字符 → pe_rewritten_prompt_bf16.txt;开头: ${full.slice(0, 160)}`);
      report.cases.pe.rewritten = full;
    } else {
      check("t2i-peON: 改写文本捕获(ShowText)", false, "history outputs 无 text 字段");
    }
  }
  await sleep(1500);
  await page.screenshot("t2i-pe-2-done");

  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, `console-${PHASE}.json`), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("本 phase 控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-${PHASE}.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, `round3-${PHASE}-report.json`), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? `✅ phase=${PHASE}(bf16) 全部通过` : `❌ phase=${PHASE}(bf16) 存在失败项`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, `console-${PHASE}.json`), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
