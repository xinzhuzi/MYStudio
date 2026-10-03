#!/usr/bin/env node
/**
 * Qwen-Image-2.1 工作流三件套 真前端 E2E · round 2(09-23):
 * 验证 16 节点改造版(PE 组 + RGBA 开关)。
 *
 * 相对 round1(qwen21_e2e_0923.mjs,10 节点旧版)的差异:
 * - [6].prompt 被 [14] 开关连线覆盖 → 普通路 prompt 必须写 [13] PrimitiveNode;
 * - 新增 phases:dry(双流干跑)/ normal / rgba(开关ON+PIL验真透明+复位) /
 *   pe(开关ON+中文短句+ShowText|pysssss 临时接线捕获改写文本);
 *   (daojie phase 随道劫直写旧件 09-23 午退役删除而移除)
 * - 控制台报错按 graphReady 前后分流(load-noise vs workflow-phase);
 * - PNG 魔数 + sips 尺寸在驱动内完成;rgba 额外用引擎 venv PIL 验 mode/alpha。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_round2_0923.mjs <dry|normal|rgba|pe>
 * 退出码 0=该 phase 全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const PHASE = process.argv[2] || "dry";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const E2E_DIR = `${process.env.HOME}/Downloads/qwen21-e2e-0923/round2`;
const WF_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像`;
const WF_T2I = join(WF_DIR, "1_文生图/qwen21-t2i.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qwen21-r2-${PHASE}-chrome-profile`;
const ENGINE_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const IMG_TIMEOUT = Number(process.env.IMG_TIMEOUT_MS || 600_000);   // 10 min/张
const PE_TIMEOUT = Number(process.env.PE_TIMEOUT_MS || 2_700_000);   // 45 min(9B PE 思考)

const T2I_PROMPT = "A serene mountain lake at sunrise, soft mist over the water, warm golden light on distant snowy peaks, a small wooden boat near the shore, photorealistic, ultra detailed, professional landscape photography";
const PE_ZH_PROMPT = "一位水墨风格的修仙少年立于山巅";
const RGBA_INNER = "a solitary young cultivator standing on a mountain summit, expressive ink brushwork, pale washes receding into mist, expansive negative space, one small vermilion accent";
const RGBA_FULL = `This is an RGBA format image with transparency. ${RGBA_INNER}. The image has an alpha channel and a transparent background.`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0; // graph ready 之后的报错才算 workflow-phase
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
      consoleErrors.push({ src: "log", phase: PHASE,
        text: m.params.entry.text, url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", phase: PHASE,
        text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000), ts: new Date().toISOString() });
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

/** graphToPrompt 全量干跑:无异常 + class 普查 + 开关序列化形态(on_false 应为内联字符串)。
 * 注:MarkdownNote 不入队、PrimitiveNode 序列化时值内联进消费节点后自身移除 → 16 画布节点=14 队列节点,属标准行为。 */
function dryRunPrompt(page, keyClasses, expectCount) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const ids = Object.keys(p.output || {});
      const classes = {};
      for (const k of ids) { const c = p.output[k].class_type; classes[c] = (classes[c] || 0) + 1; }
      const missing = ${JSON.stringify(keyClasses)}.filter(c => !classes[c]);
      const switches = [];
      for (const k of ids) {
        if (p.output[k].class_type === 'ComfySwitchNode') switches.push(p.output[k].inputs);
      }
      return JSON.stringify({ ok: true, nodes: ids.length, expect: ${expectCount}, classes, missing, switches });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e && (e.message || e)) }); }
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
        if (imgs.length && (st === "completed" || st === "success")) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages };
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

async function pilCheck(path) {
  const code = `
from PIL import Image
im = Image.open(${JSON.stringify(path)})
out = {"mode": im.mode, "size": list(im.size)}
if im.mode == "RGBA":
    mn, mx = im.getchannel("A").getextrema()
    out["alpha_min"] = mn; out["alpha_max"] = mx
    out["has_true_transparency"] = mn < 255
import json
print(json.dumps(out))
`;
  try {
    const { stdout } = await execFileP(ENGINE_PY, ["-c", code]);
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (e) { return { err: String(e.stderr || e.message).slice(0, 1000) }; }
}

async function loadCanvas(page, tag, wfPath, nodeCount) {
  const graphJson = JSON.parse(readFileSync(wfPath, "utf8"));
  const opened = await loadWorkflow(page, tag, graphJson);
  check(`${tag}: 工作流载入(前端 loadGraphData)`, opened === "opened", String(opened));
  if (opened !== "opened") return false;
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `${tag} 画布切换(${nodeCount} 节点)` });
  await sleep(1500);
  return true;
}

/** 载入→改参→queue→history→取图→魔数+sips。返回 {outPath,secs,pid,engineFile,size} */
async function runAndFetch(page, cfg) {
  const { tag, steps = [], digests = [], feature, timeoutMs, outPrefix, extraShot } = cfg;
  for (const s of steps) {
    const r = await setWidget(page, s.type, s.titlePart || "", s.widget, s.value);
    check(`${tag}: 改参 ${s.type}${s.titlePart ? "/" + s.titlePart : ""}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) return null;
  }
  await sleep(1200);
  for (const d of digests) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[${tag}] 队列图取证 ${d.classType}:`, String(dg).slice(0, 400));
  }
  if (extraShot) await extraShot();
  await page.screenshot(`${outPrefix}-1-loaded`);
  // 排队前快照已知 pid:waitHistory 只认新增单(防旧错误单特征撞车)
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
  if (queued !== "queued") return null;
  const hist = await waitHistory(feature, { timeout: timeoutMs, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    return { error: hist.error, secs };
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const outPath = join(E2E_DIR, `${outPrefix}-${stamp()}.png`);
  const buf = await fetchView(saveImg, outPath);
  const magic = await pngMagic(buf);
  const size = await sipsSize(outPath);
  check(`${tag}: PNG 魔数`, magic === true, outPath);
  check(`${tag}: sips 尺寸`, size.w === 1024 && size.h === 1024, `${size.w}x${size.h}`);
  check(`${tag}: 引擎出图(/view 取回)`, buf.length > 50_000,
    `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${hist.pid.slice(0, 8)})`);
  await sleep(1500);
  await page.screenshot(`${outPrefix}-2-done`);
  return { outPath, secs, pid: hist.pid, engineFile: saveImg.filename, size, hist };
}

async function main() {
  const report = { phase: PHASE, engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  for (const f of [WF_T2I]) {
    if (!existsSync(f)) { console.error("工作流缺失:", f); process.exit(2); }
  }
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

  if (PHASE === "dry") {
    for (const [tag, wf] of [["t2i", WF_T2I]]) {
      if (!(await loadCanvas(page, tag, wf, 16))) continue;
      const r = await dryRunPrompt(page, ["UNETLoader", "CLIPLoader", "VAELoader", "ResolutionSelector", "EmptyLatentImage", "TextEncodeQwenImage21", "KSampler", "VAEDecode", "SaveImage", "ComfySwitchNode", "QwenImage21_T2IPromptRewrite", "StringConstant"], 15);
      let parsed = null;
      try { parsed = JSON.parse(r); } catch { /* EXC: 前缀 */ }
      check(`${tag}: graphToPrompt 干跑无异常`, !!parsed?.ok, parsed?.ok ? "" : String(r).slice(0, 500));
      check(`${tag}: 队列节点数=15(Note 序列化剔除,标准行为)`, parsed?.nodes === 15, `nodes=${parsed?.nodes}`);
      check(`${tag}: 关键 class 全在场`, Array.isArray(parsed?.missing) && parsed.missing.length === 0, `missing=${JSON.stringify(parsed?.missing)}`);
      const sw = Array.isArray(parsed?.switches) ? parsed.switches : [];
      const peSw = sw.find((s) => Array.isArray(s.on_false) && s.on_false.length === 2);
      check(`${tag}: 提示词开关 on_false 链接在(StringConstant 真节点)`, !!peSw,
        sw.map((s) => `on_false=${Array.isArray(s.on_false) ? "link:" + JSON.stringify(s.on_false) : typeof s.on_false}`).join(" | ").slice(0, 300));
      report.cases[tag] = { dry: parsed };
      await page.screenshot(`${tag}-dry-done`);
    }
  } else if (PHASE === "normal") {
    if (await loadCanvas(page, "t2i-normal", WF_T2I, 16)) {
      report.cases.normal = await runAndFetch(page, {
        tag: "t2i-normal",
        steps: [
          { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
          { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
          { type: "StringConstant", titlePart: "直写提示词", widget: "string", value: T2I_PROMPT },
        ],
        digests: [
          { classType: "ResolutionSelector", fields: ["aspect_ratio", "megapixels"] },
          { classType: "ComfySwitchNode", fields: ["switch", "on_false"] },
          { classType: "KSampler", fields: ["seed", "steps", "cfg"] },
        ],
        feature: (blob) => blob.includes(T2I_PROMPT.slice(0, 40)),
        timeoutMs: IMG_TIMEOUT, outPrefix: "t2i-normal",
      });
    }
  } else if (PHASE === "rgba") {
    if (await loadCanvas(page, "t2i-rgba", WF_T2I, 16)) {
      const r = await runAndFetch(page, {
        tag: "t2i-rgbaON",
        steps: [
          { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
          { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
          { type: "StringConstant", titlePart: "直写提示词", widget: "string", value: RGBA_INNER },
          { type: "TextEncodeQwenImage21", titlePart: "RGBA文本编码", widget: "prompt", value: RGBA_FULL },
          { type: "ComfySwitchNode", titlePart: "RGBA开关", widget: "switch", value: true },
        ],
        digests: [
          { classType: "ComfySwitchNode", fields: ["switch"] },
          { classType: "TextEncodeQwenImage21", fields: ["prompt"] },
        ],
        feature: (blob) => blob.includes(RGBA_FULL.slice(0, 40)),
        timeoutMs: IMG_TIMEOUT, outPrefix: "t2i-rgba",
      });
      report.cases.rgba = r;
      if (r?.outPath) {
        const pil = await pilCheck(r.outPath);
        report.cases.rgba.pil = pil;
        check("t2i-rgbaON: PIL mode==RGBA", pil.mode === "RGBA", JSON.stringify(pil).slice(0, 300));
        check("t2i-rgbaON: alpha 通道存在非255(真透明)", pil.has_true_transparency === true, `alpha_min=${pil.alpha_min}`);
        // 复位 RGBA 开关 false(画布运行态;JSON 恒 false 未动)
        const reset = await setWidget(page, "ComfySwitchNode", "RGBA开关", "switch", false);
        const dg = await promptDigest(page, "ComfySwitchNode", ["switch"]);
        check("t2i-rgbaON: 开关复位 false", String(reset).startsWith("set:") && String(dg).includes('"switch":false'), `${String(reset).slice(0, 80)} | ${String(dg).slice(0, 120)}`);
        await page.screenshot("t2i-rgba-3-reset");
      }
    }
  } else if (PHASE === "pe") {
    if (await loadCanvas(page, "t2i-pe", WF_T2I, 16)) {
      const wired = await wireShowText(page);
      check("t2i-pe: ShowText 临时接线(捕获改写文本)", String(wired).startsWith("wired:"), String(wired));
      const r = await runAndFetch(page, {
        tag: "t2i-peON",
        steps: [
          { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
          { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
          { type: "QwenImage21_T2IPromptRewrite", widget: "prompt", value: PE_ZH_PROMPT },
          { type: "ComfySwitchNode", titlePart: "提示词开关", widget: "switch", value: true },
        ],
        digests: [
          { classType: "QwenImage21_T2IPromptRewrite", fields: ["prompt", "max_new_tokens", "presence_penalty"] },
          { classType: "ComfySwitchNode", fields: ["switch"] },
        ],
        feature: (blob) => blob.includes(PE_ZH_PROMPT),
        timeoutMs: PE_TIMEOUT, outPrefix: "t2i-pe",
      });
      report.cases.pe = r;
      if (r?.hist) {
        // ShowText 输出捕获(positive_prompt 全文)
        let texts = [];
        for (const o of Object.values(r.hist.outputs || {})) {
          if (o && Array.isArray(o.text)) texts.push(...o.text);
        }
        const full = texts.sort((a, b) => b.length - a.length)[0] || "";
        if (full) {
          writeFileSync(join(E2E_DIR, "pe_rewritten_prompt.txt"), full);
          check("t2i-peON: 改写文本捕获(ShowText)", true, `${full.length} 字符 → pe_rewritten_prompt.txt;开头: ${full.slice(0, 160)}`);
          report.cases.pe.rewritten = full;
        } else {
          check("t2i-peON: 改写文本捕获(ShowText)", false, "history outputs 无 text 字段");
        }
        report.cases.pe.messages = r.hist.messages;
      }
    }
  } else {
    console.error("未知 phase:", PHASE); process.exit(2);
  }

  // ── 收尾取证 ──
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, `console-${PHASE}.json`), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("本 phase 控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-${PHASE}.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, `round2-${PHASE}-report.json`), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? `✅ phase=${PHASE} 全部通过` : `❌ phase=${PHASE} 存在失败项`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, `console-${PHASE}.json`), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
