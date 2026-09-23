#!/usr/bin/env node
/**
 * Qwen-Image-2.1 编辑流 + PE-I2I bf16 件 实弹 E2E · round 7(09-23):
 * 验证 qwen21-edit.json 新接的 PE-I2I 改写组([12]loader+[13]EditPromptRewrite
 * 看图改写+[14]直写+[15]开关,apps/build/scripts/qwen21_edit_pe_group_0923.py 产物)
 * 与自转 bf16 PE-I2I 权重(qwen21_pe_i2i_bf16_convert_0923.py 产物)真跑通。
 *
 * 两拍(引擎 input 用官方换装双图,已在位):
 *   ① 直写回归:开关 false 默认路出图(证明手术零回归);
 *   ② PE 开路:开关 true,短句中文指令 → PE 看图改写精确指令 → 出图;
 *      (edit 系统提示词决策A:输出语言随输入——中文进中文出,非恒英文;
 *      ShowText|pysssss 临时接线捕获改写全文(仅画布运行态,不落盘 JSON)。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_edit_pe_0923.mjs
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

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const CDP_PORT = Number(process.env.CDP_PORT || 9347);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qwen21-e2e-0923/round7-edit-pe";
const WF_EDIT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qwen21-r7-edit-pe-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_800_000); // 30 min/拍(PE 9B bf16+出图)
const PE_I2I_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors";
const EDIT_CLASS = "QwenImage21_EditPromptRewrite";

const DIRECT_PROMPT_HEAD = "Keep the character and pose in <image1> unchanged";
const PE_SEED = "把 <image1> 画布人物的上衣换成 <image2> 的浅蓝色牛仔衬衫,人脸、发型、姿势和背景都保持不变";

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
      consoleErrors.push({ src: "console", type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000), ts: new Date().toISOString() });
    } else if (m.method === "Log.entryAdded" && (m.params.entry?.level === "error")) {
      consoleErrors.push({ src: "log", text: m.params.entry.text, url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000), ts: new Date().toISOString() });
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

/** ShowText 临时接线到 PE positive_prompt(仅画布运行态,不落盘 JSON)。 */
function wireShowText(page) {
  return page.ev(`(() => {
    const app = window.app;
    if (!window.LiteGraph || !window.LiteGraph.createNode) return 'no-LiteGraph';
    const pe = app.graph._nodes.find(n => n.type === ${JSON.stringify(EDIT_CLASS)});
    if (!pe) return 'pe-node-missing';
    const st = window.LiteGraph.createNode('ShowText|pysssss');
    if (!st) return 'showtext-create-failed';
    st.title = 'E2E-PE-I2I捕获(临时)';
    st.pos = [420, 980];
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
  const report = { phase: "edit-pe-i2i", engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF_EDIT)) { console.error("工作流缺失:", WF_EDIT); process.exit(2); }
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

  const graphJson = JSON.parse(readFileSync(WF_EDIT, "utf8"));
  const opened = await loadWorkflow(page, "edit-pe-i2i", graphJson);
  check("edit-pe: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === 15 ? 15 : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换(15 节点)" });
  await sleep(1500);

  // 画布取证:PE 加载器指向 i2I bf16 件;PE 节点 image_1 真接图
  const peClipWidget = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'CLIPLoader' && String(n.title || '').includes('PE-I2I'));
    return n ? String(n.widgets_values ? n.widgets_values[0] : n.widgets[0].value) : 'node-missing';
  })()`);
  check("edit-pe: 画布 PE-I2I CLIPLoader 指向 bf16 件", peClipWidget === PE_I2I_FILE, String(peClipWidget).slice(0, 200));
  const peWiredImg = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(EDIT_CLASS)});
    if (!n) return 'pe-node-missing';
    const i = (n.inputs || []).find(x => x.name === 'image_1');
    return i && i.link != null ? 'wired-link#' + i.link : 'image_1-悬空';
  })()`);
  check("edit-pe: PE image_1 画布真接线", String(peWiredImg).startsWith("wired-link#"), String(peWiredImg));

  // ── 拍①:直写回归(开关 false 默认路)───────────────────────────
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  const dg0 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  check("edit-直写: 开关默认 false(promptDigest)", String(dg0).includes('"switch":false'), String(dg0).slice(0, 200));
  let t0 = Date.now();
  let queued = await queuePrompt(page);
  check("edit-直写: queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") { page.close(); killChrome(); process.exit(1); }
  let hist = await waitHistory((b) => b.includes(DIRECT_PROMPT_HEAD), { timeout: GEN_TIMEOUT, knownPids });
  let secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("edit-直写: 引擎出图", false, `${hist.error.slice(0, 4000)}(${secs}s)`);
  } else {
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const outPath = join(E2E_DIR, `edit-direct-${stamp()}.png`);
    const buf = await fetchView(saveImg, outPath);
    const size = await sipsSize(outPath);
    check("edit-直写: PNG 魔数+取回", (await pngMagic(buf)) === true && buf.length > 50_000,
      `${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${secs}s, ${size.w}x${size.h})`);
    report.cases.direct = { outPath, secs, pid: hist.pid, size };
  }

  // ── 拍②:PE 开路(短句中文 → PE 看图改写 → 出图)────────────────
  const wired = await wireShowText(page);
  check("edit-peON: ShowText 临时接线(捕获改写文本)", String(wired).startsWith("wired:"), String(wired));
  for (const s of [
    { type: EDIT_CLASS, widget: "prompt", value: PE_SEED },
    { type: "ComfySwitchNode", titlePart: "PE改写开关", widget: "switch", value: true },
  ]) {
    const r = await setWidget(page, s.type, s.titlePart || "", s.widget, s.value);
    check(`edit-peON: 改参 ${s.type}${s.titlePart ? "/" + s.titlePart : ""}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(1200);
  for (const d of [
    { classType: EDIT_CLASS, fields: ["prompt", "presence_penalty", "max_length"] },
    { classType: "ComfySwitchNode", fields: ["switch"] },
    { classType: "CLIPLoader", fields: ["clip_name", "type"] },
  ]) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[edit-peON] 队列图取证 ${d.classType}:`, String(dg).slice(0, 600));
  }
  await page.screenshot("edit-pe-1-loaded");

  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  t0 = Date.now();
  queued = await queuePrompt(page);
  check("edit-peON: queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") { page.close(); killChrome(); process.exit(1); }
  hist = await waitHistory((b) => b.includes(PE_SEED), { timeout: GEN_TIMEOUT, knownPids });
  secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("edit-peON: 引擎出图", false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    report.cases.pe = { error: hist.error, secs };
  } else {
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const outPath = join(E2E_DIR, `edit-pe-${stamp()}.png`);
    const buf = await fetchView(saveImg, outPath);
    const size = await sipsSize(outPath);
    check("edit-peON: PNG 魔数+取回", (await pngMagic(buf)) === true && buf.length > 50_000,
      `${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${secs}s, ${size.w}x${size.h})`);

    let texts = [];
    for (const o of Object.values(hist.outputs || {})) {
      if (o && Array.isArray(o.text)) texts.push(...o.text);
    }
    const full = texts.sort((a, b) => b.length - a.length)[0] || "";
    if (full) {
      writeFileSync(join(E2E_DIR, "pe_i2i_rewritten_prompt.txt"), full);
      // edit 系统提示词决策A:输出语言随输入(中文进中文出)——关键物断言
      // 取中英双语;另断言 <imageN> 双图 tag(edit 提示词多图强制引用规则)
      const hasGarment = /denim|shirt|牛仔|衬衫/i.test(full);
      const hasTags = full.includes("<image1>") && full.includes("<image2>");
      check("edit-peON: 改写文本捕获(ShowText)", full.length > 200 && hasGarment && hasTags,
        `${full.length} 字符(关键物:${hasGarment} 双图tag:${hasTags}) → pe_i2i_rewritten_prompt.txt;开头: ${full.slice(0, 160)}`);
      report.cases.pe = { outPath, secs, pid: hist.pid, size, rewritten: full };
    } else {
      check("edit-peON: 改写文本捕获(ShowText)", false, "history outputs 无 text 字段");
      report.cases.pe = { outPath, secs, pid: hist.pid, size, rewritten: null };
    }
  }
  await sleep(1500);
  await page.screenshot("edit-pe-2-done");

  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-edit-pe.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("本 phase 控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-edit-pe.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "round7-edit-pe-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ round7 edit+PE-I2I 全部通过" : "❌ round7 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-edit-pe.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
