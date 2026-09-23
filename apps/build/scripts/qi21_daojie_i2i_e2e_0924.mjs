#!/usr/bin/env node
/**
 * qi21-道劫-i2i.json 真前端实弹 E2E(09-24,Trellis 09-24-qi21-daojie-i2i R24.4):
 *   ① 节点注册核:MyQi21DaojieBase / TextGenerate / QwenImage21Cache /
 *      LoraLoaderModelOnly 须 200(LoRA 槽核心件+viggle r64 件已装机);
 *   ② 默认型(人物)实弹出图 1 张:[40] 面板不动(型选择默认人物),[8] seed=42 fixed,
 *      排队出图,PNG 魔数+sips 对账(总像素≈1.5MP 预缩档+比例跟随输入图);
 *   ③ 换型(场景)实弹出图 1 张:[40] 面板「型选择」切 场景(一处切换生效),seed=4242,
 *      同款对账;
 *   ④ 装配全文取证:每拍 history 里 [28] easy showAnything 服务端执行出的最终文本,
 *      与期望(指令[22]+该型 BASE(qi21_bases.json)+锁层A([110] 子图常量))逐字节比对;
 *      服务端懒执行取证:LoraLoaderModelOnly=[31]/TextGenerate=[26] 不在执行记录
 *      (LoRA 槽与 PE 组默认旁路=模型不加载);
 *   ⑤ 产物 ~/Downloads/qi21-daojie-i2i-0924/;console 执行期错误留档。
 * 驱动仿 apps/build/scripts/qi21_e2e_final_0923.mjs + qi21_edit_final_0924.mjs;
 * 引擎生命周期(自拉起 17002/停)在驱动外管理。
 *
 * 用法:node apps/build/scripts/qi21_daojie_i2i_e2e_0924.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9363);
const E2E_DIR = `${process.env.HOME}/Downloads/qi21-daojie-i2i-0924`;
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`;
const BASES_JSON = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-i2i-0924-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_500_000); // 25 min/张(1.5MP 40步 MPS 余量)

const IMG1 = "portrait_model_denim.png";               // [4] 编辑画布/人物(官方示例)
const IMG2 = "clothing_light_blue_denim_shirt.png";    // [5] 参考/衬衫(官方示例)
const SEED_A = 42, SEED_B = 4242;                       // 两拍固定 seed(可复现样张)
const IN_W = 896, IN_H = 1152;                          // 输入画布实寸(sips 实测;比例锚)
// 预缩期望(逐字段复刻引擎 ImageScaleToTotalPixels 数学:nodes_post_processing.py
// execute():total=MP×1024²;scale=sqrt(total/(h·w));w=round(w·scale/32)·32)——
// 896×1152@1.5MiP → 1120×1408(=实拍值,零漂移);对账容差=引擎潜像 16 倍数归整≤16px
const PRESCALE_MP = 1.5, PRESCALE_STEP = 32;
const _psTotal = PRESCALE_MP * 1024 * 1024;
const _psScale = Math.sqrt(_psTotal / (IN_W * IN_H));
const EXP_W = Math.round(IN_W * _psScale / PRESCALE_STEP) * PRESCALE_STEP;
const EXP_H = Math.round(IN_H * _psScale / PRESCALE_STEP) * PRESCALE_STEP;
const TOL_PX = 16;                                      // 引擎潜像归整容差(qi21 e2e 同款)

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0;
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

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
      consoleErrors.push({ src: "console", type: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000),
        ts: new Date().toISOString() });
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

/** 节点定位按 id(主图节点 id 稳定;新前端 loadGraphData 后 node.id 为字符串)。 */
function setWidgetById(page, nid, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === String(${nid}));
    if (!n) return 'node-missing:' + ${nid};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:[' + n.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value);
  })()`);
}

/** [40] 装配子图节点(type=子图UUID)外露 widget 设值(型选择 COMBO 一处切换)。 */
function setSGWidget(page, sgType, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing:' + ${JSON.stringify(sgType)};
    if (!n.widgets || !n.widgets.length) return 'no-widgets:on-subgraph-node';
    const w = n.widgets.find(w => String(w.name || '') === ${JSON.stringify(wname)});
    if (!w) return 'widget-not-found:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:' + w.name + '=' + String(w.value);
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

async function historyPids() {
  try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); }
  catch { return new Set(); }
}

/** 一趟扫描 history:命中(已完成含图)即返回,不命中返回 null(收成模式用)。 */
async function scanHistoryOnce(feature) {
  try {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    for (const [pid, e] of Object.entries(h)) {
      const blob = JSON.stringify(e.prompt?.[2] || {});
      if (!feature(blob, pid)) continue;
      if ((e.status?.status_str || "") === "error") continue;
      const imgs = [];
      for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
      if (imgs.length) return { pid, imgs, status: e.status?.status_str, outputs: e.outputs, messages: e.status?.messages, promptBlob: blob };
    }
  } catch { /* 尽力 */ }
  return null;
}

/** 一拍签名(prompt[2] 紧凑 JSON):指令指纹+MyQi21DaojieBase.base=型名+seed=N。 */
const INSTR_SIG = "Put the light blue denim shirt from <image2>";
const shotSig = (name, seed) => (blob) =>
  blob.includes(INSTR_SIG) && blob.includes(`"base":"${name}"`) && blob.includes(`"seed":${seed},`);

async function waitHistory(feature, { timeout, knownPids = new Set() }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob, pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error(全量 messages): ${JSON.stringify(e.status?.messages || []).slice(0, 20000)}` };
        }
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages, promptBlob: blob };
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

function pngMagic(buf) {
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

let SG_TYPE = "";

/** 一拍通用:优先收成(history 已完成的同签名拍)→否则设型+seed 排队 → 收图验证
 * (魔数/尺寸=预缩公式精确对账)→ showAnything 装配全文逐字节比对。 */
async function genShot(page, { name, seed, baseText, lockA, directive }) {
  const tag = `${name}-seed${seed}`;
  const outPath = join(E2E_DIR, `i2i-${name}-seed${seed}.png`);
  const report = { tag, outPath };
  const sig = shotSig(name, seed);

  let mode = null;
  let hist = await scanHistoryOnce(sig);
  mode = hist ? "harvest" : "queued";  // 收成:引擎已完成的同签名拍(先前驱动排队,同工作流同参)

  const rc = await setSGWidget(page, SG_TYPE, "型选择", name);
  check(`${tag}: [40] 型选择=${name}(宿主面板一处切换)`, String(rc).startsWith("set:") && String(rc).endsWith(name), String(rc).slice(0, 200));
  if (!String(rc).startsWith("set:")) throw new Error(`${tag} 型选择设置失败: ${rc}`);
  const rs = await setWidgetById(page, 8, "seed", seed);
  check(`${tag}: [8] KSampler seed=${seed}`, String(rs).startsWith("set:"), String(rs).slice(0, 160));
  const rctl = await setWidgetById(page, 8, "control_after_generate", "fixed");
  check(`${tag}: [8] control_after_generate=fixed(签名稳定)`, String(rctl).startsWith("set:"), String(rctl).slice(0, 160));
  await sleep(900);

  // 干跑排队图取证:MyQi21DaojieBase.base=型名;双图名在执行图
  const dryBase = await promptDigest(page, "MyQi21DaojieBase", ["base"]);
  check(`${tag}: 干跑排队图 MyQi21DaojieBase.base=${name}`, String(dryBase).includes(`"base":"${name}"`), String(dryBase).slice(0, 200));
  const dryLI = await promptDigest(page, "LoadImage", ["image"]);
  const liOk = String(dryLI).includes(IMG1) && String(dryLI).includes(IMG2);
  check(`${tag}: 干跑排队图 LoadImage 双图(${IMG1}+${IMG2})`, liOk, String(dryLI).slice(0, 200));

  if (!hist) {
    const knownPids = await historyPids();
    await sleep(800);
    const t0 = Date.now();
    const queued = await queuePrompt(page);
    check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
    if (queued !== "queued") throw new Error(`${tag} queuePrompt 失败: ${queued}`);
    hist = await waitHistory(sig, { timeout: GEN_TIMEOUT, knownPids });
    report.secs = ((Date.now() - t0) / 1000).toFixed(0);
  }
  report.mode = mode;
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, String(hist.error).slice(0, 4000));
    report.error = hist.error;
    return report;
  }
  report.pid = hist.pid;
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const buf = await fetchView(saveImg, outPath);
  const magic = pngMagic(buf);
  const size = await sipsSize(outPath);
  check(`${tag}: PNG 魔数`, magic === true, outPath);
  const dw = Math.abs((size.w ?? 0) - EXP_W), dh = Math.abs((size.h ?? 0) - EXP_H);
  const sizeOk = dw <= TOL_PX && dh <= TOL_PX;
  check(`${tag}: sips 尺寸对账(预缩公式精确:896×1152@1.5MiP·32步进→${EXP_W}×${EXP_H};维差≤${TOL_PX}px)`, sizeOk,
    size.err ? String(size.err) : `实际 ${size.w}x${size.h}(${((size.w * size.h) / 1e6).toFixed(2)}MP);维差 ${dw}/${dh}px`);
  check(`${tag}: 引擎出图(/view 取回)`, buf.length > 50_000,
    `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${report.secs ? `排队→完成 ${report.secs}s` : `收成拍(mode=${mode})`}, pid=${String(hist.pid).slice(0, 8)})`);
  report.size = size; report.sizeOk = sizeOk; report.engineFile = saveImg.filename; report.bytes = buf.length;
  report.serverBase = (hist.promptBlob || "").includes(`"base":"${name}"`);
  check(`${tag}: 服务端排队图 MyQi21DaojieBase.base=${name}`, report.serverBase === true, "history prompt[2] 内 base 字段");

  // [28] easy showAnything 服务端执行出的最终装配全文(装配硬证据)
  const texts = [];
  for (const o of Object.values(hist.outputs || {})) if (o && Array.isArray(o.text)) texts.push(...o.text);
  if (texts.length) {
    const finalText = texts.sort((a, b) => b.length - a.length)[0];
    report.assemblyText = finalText;
    writeFileSync(join(E2E_DIR, `i2i-${name}-final-prompt.txt`), finalText);
    const want = [directive, baseText, lockA].join("\n");
    const eq = finalText === want;
    check(`${tag}: 装配全文 == 期望(指令+${name}型BASE+锁层A,showAnything 取证)`, eq,
      eq ? `${finalText.length} 字符逐字节一致` :
        `不一致:实际头100=${finalText.slice(0, 100)};期望头100=${want.slice(0, 100)};len=${finalText.length}/${want.length}`);
  } else {
    check(`${tag}: 装配全文捕获([28] showAnything)`, false, "history outputs 无 text 字段");
  }

  // 服务端懒执行取证:LoRA 槽 [31]/PE 组 [26] 不在执行记录(默认旁路=模型不加载)
  const executedNodes = [];
  for (const m of (hist.messages || [])) {
    if (!Array.isArray(m) || (m[0] !== "executed" && m[0] !== "executing")) continue;
    const v = m[1];
    const nid = (v && typeof v === "object" && v.node !== undefined) ? String(v.node) : String(v ?? "");
    if (nid && !executedNodes.includes(nid)) executedNodes.push(nid);
  }
  report.executedNodes = executedNodes;
  check(`${tag}: 服务端懒执行: [31]LoraLoaderModelOnly 与 [26]TextGenerate 不在执行记录(双槽默认旁路)`,
    !executedNodes.includes("31") && !executedNodes.includes("26"),
    `executed=${JSON.stringify(executedNodes)}`);
  return report;
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  const report = { engine: ENGINE, wf: WF, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF)) { console.error("工作流缺失:", WF); process.exit(2); }

  // ── 引擎探活(自拉由驱动外 bash 完成) ──
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
    report.engineVersion = alive.system?.comfyui_version;
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  // ── ① 节点注册核 ──
  for (const nodeName of ["MyQi21DaojieBase", "TextGenerate", "QwenImage21Cache", "LoraLoaderModelOnly"]) {
    let ok = false, detail = "";
    try {
      const r = await fetch(`${ENGINE}/object_info/${nodeName}`);
      ok = r.status === 200;
      if (ok) { await r.json(); detail = "200"; } else detail = `HTTP ${r.status}`;
    } catch (e) { detail = String(e.message); }
    check(`① 节点注册: /object_info/${nodeName} 200`, ok, detail);
    if (!ok) {
      writeFileSync(join(E2E_DIR, "i2i-report.json"), JSON.stringify({ ...report, fatal: `${nodeName} 未注册`, results }, null, 2));
      killChrome();
      process.exit(1);
    }
  }
  // LoRA 件在场(viggle r64 已装机)
  const loraObj = await (await fetch(`${ENGINE}/object_info/LoraLoaderModelOnly`)).json();
  const loraList = loraObj.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
  check("① LoRA 件装机: viggle r64 在 LoraLoaderModelOnly combo 列表",
    loraList.includes("Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors"),
    `${loraList.length} 项 loras;目标件${loraList.includes("Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors") ? "在场" : "缺席"}`);
  report.loraInstalled = loraList.includes("Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors");

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF, "utf8"));
  SG_TYPE = graphJson.definitions.subgraphs[0].id;
  const nodeCount = graphJson.nodes.length;
  const opened = await loadWorkflow(page, "qi21-道劫-i2i-实弹验收", graphJson);
  check("i2i 件: 工作流载入(前端 loadGraphData,装配子图装载)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(1500);

  // ── ① 干跑:graphToPrompt 无异常 ──
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
    catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("① 干跑: graphToPrompt 无异常(装配子图+九型底座+LoRA 槽装载)", String(dry).startsWith("ok:"), String(dry).slice(0, 300));
  report.dryRun = String(dry);

  // [40] 面板 widgets 实测(勿猜)
  const probe = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(SG_TYPE)});
    if (!n) return 'node-missing';
    return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: typeof w.value === 'string' ? w.value.slice(0, 30) + '…(' + w.value.length + ')' : w.value })) });
  })()`));
  log("[探测] [40] 子图节点 widgets:", String(probe).slice(0, 1200));
  check("① 探测: [40] 装配子图节点在前端可寻址(type=UUID)", String(probe).startsWith('{"title"'), String(probe).slice(0, 200));
  report.subgraphWidgets = String(probe).slice(0, 2000);

  // 期望装配真值(本地重建:指令=[22];BASE=qi21_bases.json 该型;锁层A=子图[110] 常量)
  const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
  const baseByZh = {}; for (const e of bases) baseByZh[e.zh] = e.base_text;
  const sgNodes = {}; for (const n of graphJson.definitions.subgraphs[0].nodes) sgNodes[n.id] = n;
  const lockA = sgNodes[110].widgets_values[0];
  const directive = graphJson.nodes.find((n) => n.id === 22).widgets_values[0];
  check("前置: 期望装配真值可重建(指令[22]+BASE(qi21_bases)+锁层A[110])",
    directive.includes(INSTR_SIG) && lockA.length > 500 && baseByZh["人物"].length > 500,
    `指令 ${directive.length} 字符;锁层A ${lockA.length} 字符;人物 BASE ${baseByZh["人物"].length} 字符`);

  // 开关基线:PE [15]/LoRA [30]/画幅 [19] false;[40] RGBA false(默认全旁路)
  for (const [nid, wn] of [[15, "switch"], [30, "value"], [19, "value"]]) {
    const r = await setWidgetById(page, nid, wn, false);
    check(`前置: [${nid}] ${wn}=false(旁路基线)`, String(r).startsWith("set:"), String(r).slice(0, 160));
  }
  const rRGBA = await setSGWidget(page, SG_TYPE, "RGBA透明开关", false);
  check("前置: [40] RGBA透明开关=false", String(rRGBA).startsWith("set:"), String(rRGBA).slice(0, 160));

  // ── 环境事实处置(09-24 实测):PE-I2I 权重不在本机 text_encoders ──
  // qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors 缺席(引擎 combo 列表仅
  // pe_t2i + qwen3vl_8b;外置盘/Trash/Spotlight 均无)。[12] 即使被 PE 开关 [15]
  // =false 旁路,排队验证仍全图校验 combo 值。处置=测试期把 [12].clip_name 覆写为
  // 在盘 t2i PE 件:**惰性 widget**——默认路([15]=false)PE 组不进执行图(懒执行),
  // 此值对出图与装配全文零影响;交付件仍保 pe_i2i 真源(设计=edit 骨架 i2i 系
  // 提示词链,与契约测试互锁;权重恢复后即原生可跑)。
  const PE_I2I_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors";
  const PE_OVERRIDE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors";
  const peObj = await (await fetch(`${ENGINE}/object_info/CLIPLoader`)).json();
  const clipList = peObj.CLIPLoader?.input?.required?.clip_name?.[0] || [];
  if (!clipList.includes(PE_I2I_FILE)) {
    const r = await setWidgetById(page, 12, "clip_name", PE_OVERRIDE);
    check("环境处置: PE-I2I 权重缺席,[12].clip_name 测试期覆写→在盘 t2i PE 件(惰性 widget:PE 开关关=组不进执行图,对输出零影响)",
      String(r).startsWith("set:"), String(r).slice(0, 200));
    report.peClipOverride = {
      reason: `${PE_I2I_FILE} 不在 text_encoders(引擎 combo 仅 pe_t2i+qwen3vl_8b;外置盘/Trash/mdfind 均无)`,
      overrideTo: PE_OVERRIDE,
      inert: "PE 开关 [15]=false → TextGenerate 不执行 → PE 权重不加载(服务端懒执行取证另见各拍 executed 列表)",
      shippedFileUntouched: "交付 JSON 仍保 pe_i2i(设计真源;权重恢复后原生可跑)",
    };
  } else {
    check("环境核对: PE-I2I 权重在盘,无需覆写", true, PE_I2I_FILE);
  }
  await sleep(800);
  await page.screenshot("0-loaded-default");

  // ── ② 默认型(人物)出图 + ③ 换型(场景)出图 ──
  report.cases["case-人物-seed42"] = await genShot(page, { name: "人物", seed: SEED_A, baseText: baseByZh["人物"], lockA, directive });
  await page.screenshot("shot-renwu-done");

  // 拍间释放(实拍 OOM 复盘:第一拍后权重/KV 驻留,第二拍 KSampler 顶到 MPS 上限
  // 182.78GiB 报 OOM;POST /free 卸载模型+清缓存,第二拍重载权重再跑)
  try {
    const r = await fetch(`${ENGINE}/free`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    check("拍间释放: POST /free(unload_models+free_memory)→为换型拍清出 MPS 预算", r.status === 200, `HTTP ${r.status}`);
    report.freeBetweenShots = r.status;
  } catch (e) {
    check("拍间释放: POST /free(unload_models+free_memory)", false, String(e.message));
  }
  await sleep(6000);

  report.cases["case-场景-seed4242"] = await genShot(page, { name: "场景", seed: SEED_B, baseText: baseByZh["场景"], lockA, directive });
  await page.screenshot("shot-changjing-done");

  // ── ④ console 留存与汇总 ──
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-i2i.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("④ 全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-i2i.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "i2i-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 实弹验收全部通过" : "❌ 实弹验收存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-i2i.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
