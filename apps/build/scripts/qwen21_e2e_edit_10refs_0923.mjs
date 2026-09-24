#!/usr/bin/env node
/**
 * Qwen-Image-2.1 编辑流 · 十参考图能力 实弹 E2E · round 7(09-23):
 * 在 qi21-edit.json 默认直写路(开关 [15] 不动)上,画布运行态临时新增 8 个
 * LoadImage 节点(LiteGraph.createNode,仅画布态不落盘 JSON),逐一接到
 * [6] TextEncodeQwenImage21 的 images.image_3..images.image_10 槽(按名寻 index,
 * 槽缺失则 addInput 补槽),[14] 直写 StringConstant 改为引用 <image1>..<image10>
 * 十图的多参考改图英文指令,真前端 queuePrompt 出图。
 *
 * 前置事实(本机 09-23 探针实证):
 *   ① AUTOGROW_V3:载入后 images.image_3/image_4 空槽已在,connect 后自动生长;
 *   ② 工作流 JSON 的 last_link_id=12 陈旧(links 实际用到 17),运行态 connect 会
 *      铸出撞号 Link 13 被 store 拒(LinkMap "cannot overwrite it")——故载入后
 *      先把 last_node_id/last_link_id 抬到画布现存最大值再接线;
 *   ③ [12] PE-I2I CLIPLoader 的 combo 校验须过(值无效则新前端标红硬阻塞
 *      排队,queuePrompt 静默返 false 零 POST)。i2i bf16 件 09-23 已自转落位
 *      (qwen21_pe_i2i_bf16_convert_0923.py 产物,18.8GB 七自检绿)——原生值
 *      即有效,无需桥;仅当 i2i 件缺失时才画布运行态桥到在位 t2i 件兜底
 *      (不落盘,switch=false 懒剪枝不实际加载,两种状态皆绿,如实记入报告)。
 *
 * 断言:
 *   A. graphToPrompt 摘要:TextEncode images.image_1..image_10 全为连线引用(数组);
 *   B. history 该拍 prompt[2] 含十图文件名与指令全文;
 *   C. 出图 PNG 魔数 + >50KB;
 *   D. 开关恒 false(直写路,不改开关);queuePrompt 返回 true 且真发 /prompt POST;
 *   E. 仓库工作流 JSON 磁盘字节零改动(⑥)。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_edit_10refs_0923.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const CDP_PORT = Number(process.env.CDP_PORT || 9355);
const E2E_DIR = `${process.env.HOME}/Downloads/qwen21-e2e-0923/round7-edit-pe`;
const WF_EDIT = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qwen21-r7-10refs-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_800_000); // 30 min(十图 VAE 编码 + 25 步采样)

// image_1/image_2 = 工作流在位官方双图;image_3..image_10 = 引擎 input 里 8 张不同图(ls 实证在位)
const BASE_IMAGES = ["portrait_model_denim.png", "clothing_light_blue_denim_shirt.png"];
const REF_IMAGES_3_10 = [
  "my-shot-sb-chapter-001-001-k2.jpg",
  "my-shot-sb-chapter-001-004.jpg",
  "my-shot-sb-chapter-001-005-k2.jpg",
  "my-shot-sb-chapter-001-006.jpg",
  "my-shot-sb-chapter-001-008-k2.jpg",
  "my-shot-sb-chapter-001-009.jpg",
  "my-shot-sb-chapter-001-010.jpg",
  "my-shot-sb-chapter-001-011.jpg",
];
const ALL_TEN = [...BASE_IMAGES, ...REF_IMAGES_3_10];

// [14] 直写改图指令:自然句引用 <image1>..<image10> 十图,不堆质量词
const INSTRUCTION =
  "Using <image1> as the base portrait, keep the person's face, hairstyle, body and pose exactly as they are, " +
  "and dress them in the light blue denim shirt from <image2>; then treat <image3>, <image4>, <image5>, <image6>, " +
  "<image7>, <image8>, <image9> and <image10> together as a styling mood board for this outfit, borrowing the color " +
  "palette, accessory choices and layering ideas that suit the character so the ten references blend into one " +
  "coherent everyday look, while the original background, lighting and camera framing stay unchanged.";
const INSTRUCTION_HEAD = "Using <image1> as the base portrait";

const TE_CLASS = "TextEncodeQwenImage21";
const TE_IMAGE_FIELDS = Array.from({ length: 10 }, (_, i) => `images.image_${i + 1}`);
const PE_T2I_FILE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"; // 缺件兜底桥(i2i 件缺失时才用)
const PE_I2I_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"; // [12] 原生指向(09-23 已自转落位,常态有效)

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
          return JSON.stringify(o);
        }
      }
      return 'class-not-found:' + ${JSON.stringify(classType)};
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
}

/** 抬 id 计数器:JSON last_link_id=12 陈旧(links 实际到 17),不抬则运行态 connect 铸撞号链被拒。 */
function fixIdCounters(page) {
  return page.ev(`(() => {
    const g = window.app.graph;
    const maxN = Math.max(...g._nodes.map(n => n.id));
    let maxL = 0;
    for (const k of g.links.keys()) { const v = Number(k); if (v > maxL) maxL = v; }
    g.last_node_id = Math.max(Number(g.last_node_id) || 0, maxN);
    g.last_link_id = Math.max(Number(g.last_link_id) || 0, maxL);
    return JSON.stringify({ last_node_id: Number(g.last_link_id && g.last_node_id) || g.last_node_id, last_link_id: g.last_link_id, maxN, maxL });
  })()`);
}

/** 画布运行态新增 8 个 LoadImage(仅画布,不落盘),按名连 images.image_3..image_10。 */
function wireTenRefs(page) {
  return page.ev(`(() => {
    const app = window.app;
    if (!window.LiteGraph || !window.LiteGraph.createNode) return 'no-LiteGraph';
    const n = app.graph._nodes.find(n => n.type === ${JSON.stringify(TE_CLASS)});
    if (!n) return 'te-node-missing';
    const files = ${JSON.stringify(REF_IMAGES_3_10)};
    const created = [];
    for (let k = 0; k < files.length; k++) {
      const li = window.LiteGraph.createNode('LoadImage');
      if (!li) return 'createNode-failed#' + k;
      li.title = 'E2E-10refs image_' + (k + 3) + '(临时)';
      li.pos = [-140 + (k % 4) * 380, 460 + Math.floor(k / 4) * 460];
      app.graph.add(li);
      const w = li.widgets.find(w => w.name === 'image');
      if (!w) return 'no-image-widget#' + k;
      w.value = files[k];
      try { w.callback && w.callback(w.value); } catch (e) { /* 缩略图拉取可失败,不挡 */ }
      const slotName = 'images.image_' + (k + 3);
      let slot = n.findInputSlot(slotName);
      if (slot === -1) { n.addInput(slotName, 'IMAGE'); slot = n.findInputSlot(slotName); }
      if (slot === -1) return 'slot-not-found#' + slotName;
      const c = li.connect(0, n, slot);
      if (!c) return 'connect-failed#' + slotName;
      created.push({ id: li.id, file: files[k], slot: slotName, slotIndex: slot, link: n.inputs[slot].link, widgetValue: String(w.value) });
    }
    return JSON.stringify({ created, canvasNodes: app.graph._nodes.length });
  })()`);
}

function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { const r = await app.queuePrompt(); return 'queued:' + String(r); } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

/** queuePrompt 真达服务端的硬证据:排队前先快照同特征的 queue 项/history pid,
 *  排队后 30s 内出现新的同特征 queue 项或 history pid(防旧任务污染判据)。 */
async function promptReachedServer(feature, known, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const q = await (await fetch(`${ENGINE}/queue`)).json();
      const all = [...q.queue_running, ...q.queue_pending];
      const fresh = all.find((it) => !known.queue.has(String(it[1])) && feature(JSON.stringify(it[2] || {})));
      if (fresh) return `queue:${fresh[1]}`;
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (!known.pids.has(pid) && feature(JSON.stringify(e.prompt?.[2] || {}))) return `history:${pid}`;
      }
    } catch { /* 重试 */ }
    await sleep(1500);
  }
  return null;
}

async function snapshotFeature(feature) {
  const out = { queue: new Set(), pids: new Set() };
  try {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    for (const it of [...q.queue_running, ...q.queue_pending]) {
      if (feature(JSON.stringify(it[2] || {}))) out.queue.add(String(it[1]));
    }
  } catch { /* 尽力 */ }
  try {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    for (const [pid, e] of Object.entries(h)) {
      if (feature(JSON.stringify(e.prompt?.[2] || {}))) out.pids.add(pid);
    }
  } catch { /* 尽力 */ }
  return out;
}

/** combo 校验守卫:[12] PE-I2I CLIPLoader 的 clip_name 须在 combo 有效值内
 *  (无效则新前端标红阻塞排队)。i2i 件在位时原生值即有效不动;仅当无效时
 *  桥到在位 t2i 件(switch=false 懒剪枝不实际执行;仅画布运行态,不落盘)。 */
function bridgePeLoader(page) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'CLIPLoader' && String(n.title || '').includes('PE-I2I'));
    if (!n) return 'node-missing';
    const w = n.widgets.find(w => w.name === 'clip_name');
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    const before = String(w.value);
    if (before !== ${JSON.stringify(PE_T2I_FILE)} && !(w.options && (w.options.values || []).includes(before))) {
      w.value = ${JSON.stringify(PE_T2I_FILE)};
      try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    }
    return JSON.stringify({ before, after: String(w.value), hasErrors: n.has_errors === true, valid: !!(w.options && (w.options.values || []).includes(String(w.value))) });
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
        if (imgs.length) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages, blob };
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

async function main() {
  const report = { phase: "edit-10refs", engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF_EDIT)) { console.error("工作流缺失:", WF_EDIT); process.exit(2); }
  mkdirSync(E2E_DIR, { recursive: true }); // 已存在则复用
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }
  // 引擎 input 十图在位预检(/view type=input)
  for (const f of ALL_TEN) {
    const r = await fetch(`${ENGINE}/view?filename=${encodeURIComponent(f)}&type=input`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.error("input 图缺失:", f, r.status); process.exit(2); }
  }
  log(`input 十图在位预检 10/10(${BASE_IMAGES.join("+")} + 8 分镜图)`);
  const wfBefore = readFileSync(WF_EDIT); // ⑥ 断言基线:跑完磁盘零改动

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF_EDIT, "utf8"));
  const opened = await loadWorkflow(page, "edit-10refs", graphJson);
  check("edit-10refs: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === 15 ? 15 : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换(15 节点)" });
  await sleep(1500);

  // ① 不改开关:断言默认直写路(switch=false)
  const sw = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  check("edit-10refs: 开关恒 false(直写路,不改开关)", String(sw).includes('"switch":false'), String(sw).slice(0, 120));

  // 抬 id 计数器(JSON 陈旧 last_link_id=12 → 实际 links 至 17)
  const fixed = await fixIdCounters(page);
  let fixedOk = false, fixedDetail = String(fixed).slice(0, 200);
  try {
    const f = JSON.parse(fixed);
    fixedOk = Number(f.last_link_id) >= 17 && Number(f.last_node_id) >= 15;
    fixedDetail = `last_node_id=${f.last_node_id} last_link_id=${f.last_link_id}(links 最大 ${f.maxL})`;
  } catch { /* fixedOk=false */ }
  check("edit-10refs: id 计数器抬正(避撞号)", fixedOk, fixedDetail);
  if (!fixedOk) { page.close(); killChrome(); process.exit(1); }

  // combo 校验:i2i 件在位 → 原生值有效(常态,更优);缺失 → 桥到在位 t2i 件
  // 兜底。两态皆绿,判据只锁「combo 有效且不标红」(switch=false 懒剪枝不执行)
  const bridged = await bridgePeLoader(page);
  let bridgeOk = false, bridgeDetail = String(bridged).slice(0, 240);
  try {
    const b = JSON.parse(bridged);
    const native = b.after === PE_I2I_FILE; // 原生在位(未桥)
    const bridgedToT2I = b.after === PE_T2I_FILE; // 缺件兜底(已桥)
    bridgeOk = b.valid === true && !b.hasErrors && (native || bridgedToT2I);
    bridgeDetail = `clip_name ${b.before} → ${b.after}(${native ? "i2i 件在位·原生有效" : bridgedToT2I ? "环境桥→t2i 件" : "意外值"};combo 有效:${b.valid};仅画布运行态,懒剪枝不加载)`;
    report.cases.envBridge = {
      node: "[12] PE-I2I CLIPLoader",
      reason: native
        ? "i2i bf16 件在位,原生 clip_name 即 combo 有效,无需桥(09-23 自转落位)"
        : "i2i 件缺失,画布运行态桥到在位 t2i 件过 combo 校验",
      ...b,
    };
  } catch { /* bridgeOk=false */ }
  check("edit-10refs: [12] PE-I2I clip_name combo 有效(在位或环境桥)", bridgeOk, bridgeDetail);
  if (!bridgeOk) { page.close(); killChrome(); process.exit(1); }

  // 掷新 seed(真实用户行为;seed=0 恒定会让同构拍全量命中节点缓存,失去真算力证据)
  const rolledSeed = Math.floor(Math.random() * 2 ** 31);
  const rolled = await setWidget(page, "KSampler", "", "seed", rolledSeed);
  check("edit-10refs: KSampler 掷新 seed(避节点缓存全命中)", String(rolled) === `set:${rolledSeed}`, String(rolled));
  if (!String(rolled).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  report.cases.seed = rolledSeed;

  // ③ [14] 直写指令改十图多参考英文指令
  const setPrompt = await setWidget(page, "StringConstant", "直写改图指令", "string", INSTRUCTION);
  check("edit-10refs: [14] 直写指令改十图指令", String(setPrompt) === "set:" + INSTRUCTION, String(setPrompt).slice(0, 160) + (String(setPrompt).length > 160 ? "…" : ""));
  if (!String(setPrompt).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }

  // ② 画布运行态新增 8 LoadImage → images.image_3..image_10(按名寻槽,缺则补)
  const wired = await wireTenRefs(page);
  let wiredList = null;
  try { wiredList = JSON.parse(wired); } catch { /* 保持 null */ }
  check("edit-10refs: 8 个临时 LoadImage 建立并接线(image_3..image_10)",
    !!wiredList && wiredList.created.length === 8 && wiredList.created.every((c) => c.link != null && c.widgetValue === c.file),
    wiredList ? `canvasNodes=${wiredList.canvasNodes};links=${wiredList.created.map((c) => c.link).join(",")}` : String(wired).slice(0, 300));
  if (!wiredList) { page.close(); killChrome(); process.exit(1); }

  // ④-A graphToPrompt:TextEncode images.image_1..image_10 全为连线引用
  await sleep(1200);
  const teDigest = await promptDigest(page, TE_CLASS, [...TE_IMAGE_FIELDS, "prompt"]);
  let teOk = false, teDetail = String(teDigest).slice(0, 500);
  try {
    const d = JSON.parse(teDigest);
    const bad = TE_IMAGE_FIELDS.filter((f) => !Array.isArray(d[f]));
    teOk = bad.length === 0;
    teDetail = `node=${d.node};${TE_IMAGE_FIELDS.map((f) => `${f.slice(7)}=${JSON.stringify(d[f])}`).join(" ")};prompt=${JSON.stringify(d.prompt)}`;
    report.cases.digest = d;
  } catch { /* teOk=false */ }
  check("edit-10refs: graphToPrompt 十图槽全连线引用(A)", teOk, teDetail);
  const scDigest = await promptDigest(page, "StringConstant", ["string"]);
  check("edit-10refs: graphToPrompt [14] 指令入队图", String(scDigest).includes(INSTRUCTION_HEAD), String(scDigest).slice(0, 160) + "…");
  await page.screenshot("edit-10refs-1-wired");

  // 真前端排队
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  const knownFeature = await snapshotFeature((b) => b.includes(INSTRUCTION_HEAD));
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check("edit-10refs: queuePrompt 返回 true(真前端)", queued === "queued:true", String(queued));
  if (queued !== "queued:true") { page.close(); killChrome(); process.exit(1); }
  const reached = await promptReachedServer((b) => b.includes(INSTRUCTION_HEAD), knownFeature);
  check("edit-10refs: /prompt 真达服务端(/queue|/history 新拍)", !!reached, String(reached));
  if (!reached) { page.close(); killChrome(); process.exit(1); }

  const hist = await waitHistory((b) => b.includes(INSTRUCTION_HEAD), { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("edit-10refs: 引擎出图", false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    report.cases.tenRefs = { error: hist.error, secs };
  } else {
    // ④-B history prompt[2] 含十图与指令文本
    const blob = hist.blob || "";
    const missImgs = ALL_TEN.filter((f) => !blob.includes(f));
    check("edit-10refs: history prompt[2] 含十图文件名(B-1)", missImgs.length === 0,
      missImgs.length ? `缺 ${missImgs.join(",")}` : `10/10:${ALL_TEN.join(",")}`);
    check("edit-10refs: history prompt[2] 含指令全文(B-2)", blob.includes(INSTRUCTION),
      blob.includes(INSTRUCTION) ? `${INSTRUCTION.length} 字符逐字命中` : "指令未逐字出现");
    // ④-C 出图 PNG 魔数 + >50KB
    const cachedMsg = (hist.messages || []).find((m) => m[0] === "execution_cached");
    const cachedNodes = Array.isArray(cachedMsg?.[1]?.nodes) ? cachedMsg[1].nodes : [];
    check("edit-10refs: 非缓存全命中(KSampler 真执行)", !cachedNodes.includes("8"),
      `execution_cached ${cachedNodes.length} 节点${cachedNodes.includes("8") ? "(含 KSampler=8,缓存命中!)" : "(KSampler=8 真执行)"}`);
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const outPath = join(E2E_DIR, `edit-10refs-${stamp()}.png`);
    const buf = await fetchView(saveImg, outPath);
    const size = await sipsSize(outPath);
    check("edit-10refs: PNG 魔数+取回 >50KB(C)", pngMagic(buf) === true && buf.length > 50_000,
      `${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${secs}s, ${size.w}x${size.h})`);
    report.cases.tenRefs = { outPath, secs, pid: hist.pid, size, prompt: INSTRUCTION, images: ALL_TEN, wired: wiredList.created };
  }
  await sleep(1500);
  await page.screenshot("edit-10refs-2-done");

  // ⑥ 临时节点仅画布运行态:仓库工作流 JSON 磁盘字节零改动
  const wfAfter = readFileSync(WF_EDIT);
  check("edit-10refs: 工作流 JSON 磁盘零改动(⑥)", wfBefore.equals(wfAfter),
    wfBefore.equals(wfAfter) ? `${WF_EDIT} 字节一致(${wfAfter.length}B)` : "磁盘文件被改动!");

  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-edit-10refs.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("本 phase 控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-edit-10refs.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "round7-edit-10refs-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ round7 十参考图编辑流全部通过" : "❌ round7 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-edit-10refs.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
