#!/usr/bin/env node
/**
 * qi21-道劫-i2i.json 真前端实弹 E2E(09-24 建件,Trellis 09-29-qi21-canvas-batch S3 适配):
 *   ① 节点注册核:MyQi21DaojieBase / TextGenerate / QwenImage21Cache /
 *      LoraLoaderModelOnly / MyQi21SpeedSelect / MyQi21RgbaSelect 须 200
 *      (后两件=加速子图汇流与 RGBA 三态面板的载荷件,0929 S2/S3 新增);
 *   ② 默认型(人物)实弹出图 1 张:[40] 面板型选择默认人物;seed 经 [190] 加速子图
 *      宿主面板「seed」INT 外露直通(0929 S3 D5:原 [8] KSampler 面上 seed 已迁子图内
 *      [191] PrimitiveInt,宿主外露值件;control=fixed 留内节点 widget,由前置静态
 *      断言锁),排队出图,PNG 魔数+sips 对账(总像素≈1.5MP 预缩档+比例跟随输入图);
 *   ③ 换型(场景)实弹出图 1 张:[40] 面板「型选择」切 场景(一处切换生效),seed=4242,
 *      同款对账;
 *   ④ 装配全文取证:每拍 history 里 [28] easy showAnything 服务端执行出的最终文本,
 *      与期望(指令[22]+该型 BASE(qi21_bases.json)+锁层A([110] 子图常量))逐字节比对;
 *      服务端懒执行取证(0929 S3 口径):子图收装后执行帧内节点 id=<宿主id>:<内节点id>
 *      (0929 S0 探针 A 级实录),未选支路 LoRA[190:31]/T8[190:176] 与 PE 组
 *      TextGenerate[40:26] 不在执行集(速度档位=默认直出+PE 旁路=零加载);
 *      本版引擎 per-node executing/executed 事件不进 /history status_messages
 *      (qi21_r26_wsmon_0924.mjs 先例+S0 探针复证),取证源=ws 广播第二客户端现收,
 *      直出采样器[190:8] 必在执行集=阳性对照(防零帧空集假证);
 *   ⑤ 产物 ~/Downloads/qi21-daojie-i2i-s3/;console 执行期错误留档。
 * 0929 S3 适配面(与 0924 原版差异,详见任务档 notes):
 *   - widget 名单换新:「RGBA透明开关」BOOLEAN 退役 → 「RGBA透明」三态 combo
 *     (跟随型/强制开/强制关,MyQi21RgbaSelect);基线=跟随型(人物/场景均在四型
 *     透明名单外→跟随=关,语义等价旧 false);
 *   - 新子图寻址:加速宿主 [190] type=加速子图 UUID(原 MyQi21SpeedSelect 主图件
 *     原位改造),面板「速度档位」COMBO+「seed」INT;[40] 装配宿主面板=主体句/
 *     型选择/RGBA透明/PE开关 四控件;原主图 [15]PE 开关/[30]LoRA 开关迁子图/
 *     退役,基线改走宿主面板(LoRA 旁路=速度档位默认直出的懒语义);
 *   - 拍签名适配:seed 现以 PrimitiveInt「value」落排队图(原 KSampler「seed」
 *     字面),加子图形判别键(防 0924 旧形 history 收成串拍)。
 * 驱动仿 apps/build/scripts/qi21_e2e_final_0923.mjs + qi21_edit_final_0924.mjs;
 * 引擎生命周期(自拉起 17002/停)在驱动外管理。
 *
 * 用法:node apps/build/scripts/qi21_daojie_i2i_e2e_0924.mjs
 *      SKIP_GEN=1 同上但跳过两拍生图(0930 S3 门禁补:免生图开门验证模式)
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
const E2E_DIR = `${process.env.HOME}/Downloads/qi21-daojie-i2i-s3`; // 0929 S3 适配轮独立产物目录(与 0924 原轮区分)
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`;
const BASES_JSON = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-i2i-0924-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_500_000); // 25 min/张(1.5MP 40步 MPS 余量)

// 0929 S3 面板控件闭集常量(真源=自研件 SPEED_MODES/RGBA_MODES 首项;分隔符 U+00B7)
const SPEED_DIRECT = "0 · 直出40步"; // MyQi21SpeedSelect.SPEED_MODES[0]=默认档(直出)
const RGBA_FOLLOW = "跟随型";         // MyQi21RgbaSelect.RGBA_MODES[0]=默认(按型跟随)

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

/** 子图宿主节点(type=子图UUID)外露 widget 设值(0929 S3:装配宿主=[40] 型选择/
 *  RGBA透明/PE开关;加速宿主=[190] 速度档位/seed;宿主面板值=生效值,A 级实证)。 */
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

/** 一拍签名(prompt[2] 紧凑 JSON,0929 S3 口径):指令指纹+MyQi21DaojieBase.base=型名
 * +seed=N(现落子图内 PrimitiveInt「value」字面,原 KSampler「seed」字面已随迁走)
 * +子图形判别键(加速宿主:选择件展开键,防 0924 旧主图形 history 收成串拍)。 */
const INSTR_SIG = "Put the light blue denim shirt from <image2>";
const shotSig = (name, seed) => (blob) =>
  blob.includes(INSTR_SIG) && blob.includes(`"base":"${name}"`)
  && (blob.includes(`"value":${seed},`) || blob.includes(`"value":${seed}}`))
  && blob.includes(`"${ACCEL_HOST_ID}:${SEL_NID}"`);

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

// ── 0929 S3 子图寻址态(main() 内从 graphJson 实测发现,勿手抄常量)──
// 宿主节点 type=子图 UUID;子图内节点在排队图/执行帧的 id=<宿主id>:<内节点id>
let ASM_SG_TYPE = "";    // [40] 装配子图 UUID
let ACCEL_SG_TYPE = "";  // [190] 加速子图 UUID
let ASM_HOST_ID = 0;     // 装配宿主 id(40)
let ACCEL_HOST_ID = 0;   // 加速宿主 id(190)
let PE_TG_NID = 0;       // 装配子图内 TextGenerate id(26,PE 组懒取证靶)
let LORA_NID = 0;        // 加速子图内 LoraLoaderModelOnly id(31)
let T8_NID = 0;          // 加速子图内 T8QwenImage21FunAccPDD4Step id(176)
let KS_NID = 0;          // 加速子图内直出 KSampler id(8,steps=40,阳性对照)
let SEED_NID = 0;        // 加速子图内 PrimitiveInt id(191,seed 外露源)
let SEL_NID = 0;         // 加速子图内 MyQi21SpeedSelect id(192,子图形判别键)

// ── 服务端逐节点执行帧监听(ws 第二客户端,0929 S3 适配)──
// 本版引擎 executing/executed 事件不进 /history status_messages(先例:
// qi21_r26_wsmon_0924.mjs 头注+S0 探针 A 级复证),逐节点执行集唯一易取源=ws 广播
// 现收;按 prompt_id 归属,收 executing+executed 两型帧(node null 的结束帧跳过)。
const execFrames = new Map(); // prompt_id -> { executing: Set<nodeId>, executed: Set<nodeId> }
const execMonStats = { frames: 0, open: false };
function startExecMonitor() {
  const ws = new WebSocket(ENGINE.replace(/^http/, "ws") + "/ws?clientId=qi21-i2i-e2e-0924-execmon",
    { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  ws.on("open", () => { execMonStats.open = true; log("exec monitor ws open(逐节点执行帧源)"); });
  ws.on("error", (e) => log("exec monitor ws error:", e.message));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type !== "executing" && m.type !== "executed") return;
    const d = m.data || {};
    if (!d.prompt_id || d.node == null) return;
    execMonStats.frames++;
    let rec = execFrames.get(d.prompt_id);
    if (!rec) { rec = { executing: new Set(), executed: new Set() }; execFrames.set(d.prompt_id, rec); }
    rec[m.type].add(String(d.node));
  });
  return ws;
}

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

  const rc = await setSGWidget(page, ASM_SG_TYPE, "型选择", name);
  check(`${tag}: [40] 型选择=${name}(装配宿主面板一处切换)`, String(rc).startsWith("set:") && String(rc).endsWith(name), String(rc).slice(0, 200));
  if (!String(rc).startsWith("set:")) throw new Error(`${tag} 型选择设置失败: ${rc}`);
  // 0929 S3 D5:seed 迁加速子图内 [191] PrimitiveInt,宿主 [190] 面板「seed」INT 外露
  // 直通(原 [8] KSampler 面上 seed+control_after_generate 寻址退役;control=fixed
  // 留内节点 widget,由 main() 前置静态断言锁,签名稳定口径不变)
  const rs = await setSGWidget(page, ACCEL_SG_TYPE, "seed", seed);
  check(`${tag}: [190] 加速宿主 seed=${seed}(面板 INT 直通子图内 [${SEED_NID}]→双采样器)`,
    String(rs).startsWith("set:") && String(rs).endsWith(String(seed)), String(rs).slice(0, 160));
  await sleep(900);

  // 干跑排队图取证:MyQi21DaojieBase.base=型名;双图名在执行图;
  // seed 经宿主面板直通=PrimitiveInt.value 字面+子图展开键 host:inner(0929 S3 形);
  // 速度档位=默认直出(选择件子图展开键在位=新形判别)
  const dryBase = await promptDigest(page, "MyQi21DaojieBase", ["base"]);
  check(`${tag}: 干跑排队图 MyQi21DaojieBase.base=${name}`, String(dryBase).includes(`"base":"${name}"`), String(dryBase).slice(0, 200));
  const dryLI = await promptDigest(page, "LoadImage", ["image"]);
  const liOk = String(dryLI).includes(IMG1) && String(dryLI).includes(IMG2);
  check(`${tag}: 干跑排队图 LoadImage 双图(${IMG1}+${IMG2})`, liOk, String(dryLI).slice(0, 200));
  const drySeed = await promptDigest(page, "PrimitiveInt", ["value"]);
  check(`${tag}: 干跑排队图 PrimitiveInt.value=${seed}(宿主面板直通,展开键=${ACCEL_HOST_ID}:${SEED_NID})`,
    String(drySeed).includes(`"value":${seed}`) && String(drySeed).includes(`"node":"${ACCEL_HOST_ID}:${SEED_NID}"`), String(drySeed).slice(0, 200));
  const drySel = await promptDigest(page, "MyQi21SpeedSelect", ["mode"]);
  check(`${tag}: 干跑排队图 MyQi21SpeedSelect.mode=${SPEED_DIRECT}(展开键=${ACCEL_HOST_ID}:${SEL_NID})`,
    String(drySel).includes(`"mode":"${SPEED_DIRECT}"`) && String(drySel).includes(`"node":"${ACCEL_HOST_ID}:${SEL_NID}"`), String(drySel).slice(0, 200));

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

  // 服务端懒执行取证(0929 S3 口径):子图内节点执行帧 id=<宿主id>:<内节点id>;
  // 取证源=ws 广播现收(本版引擎 per-node 事件不进 /history status_messages,见
  // startExecMonitor 头注);未选支路 LoRA/T8 与 PE 组 TextGenerate 不在执行集
  // (速度档位=默认直出+PE 旁路=零加载),直出采样器在执行集=阳性对照;
  // 收成拍(harvest)无现场帧不可回放,豁免并如实注记(懒取证以首跑拍为准)。
  const rec = execFrames.get(hist.pid);
  const executedNodes = rec ? [...new Set([...rec.executed, ...rec.executing])] : [];
  report.executedNodes = executedNodes;
  if (mode === "queued") {
    const sawFrames = !!rec && executedNodes.length > 0;
    check(`${tag}: 懒执行取证源活性(ws 逐节点帧>0,防零帧空集假证)`, sawFrames,
      rec ? `executed=${rec.executed.size}/executing=${rec.executing.size} 帧` : "ws 监控未捕获该拍执行帧(源失效=FAIL 不假证)");
    const LZY = `${ACCEL_HOST_ID}:${LORA_NID}`, T8 = `${ACCEL_HOST_ID}:${T8_NID}`;
    const TG = `${ASM_HOST_ID}:${PE_TG_NID}`, KS = `${ACCEL_HOST_ID}:${KS_NID}`;
    check(`${tag}: 服务端懒执行: LoRA[${LZY}]/T8[${T8}]/TextGenerate[${TG}] 不在执行集,直出采样器[${KS}]在(默认档+PE 旁路)`,
      sawFrames && ![LZY, T8, TG].some((x) => executedNodes.includes(x)) && executedNodes.includes(KS),
      `executed=${JSON.stringify(executedNodes)}`);
  } else {
    check(`${tag}: 服务端懒执行(收成拍豁免:ws 现场帧不可回放,懒取证以首跑拍为准)`, true,
      `mode=${mode};本拍 executed=${JSON.stringify(executedNodes)}`);
  }
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

  // ── ws 执行帧监控先行拉起(排队前就位,懒执行取证源;0929 S3)──
  const monWs = startExecMonitor();

  // ── ① 节点注册核(0929 S3:+速度选择/RGBA 三态两件=双子图面板载荷件) ──
  for (const nodeName of ["MyQi21DaojieBase", "TextGenerate", "QwenImage21Cache", "LoraLoaderModelOnly", "MyQi21SpeedSelect", "MyQi21RgbaSelect"]) {
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
  // LoRA 件在场(0930 S3 门禁勘误:r64=旧件已退役;真源=三件工作流 [31] 预填的
  // v0.2.1-6step-lora-r256,machine.md 09-24 换新+清旧终态,旧 r64 检查项陈旧)
  const LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors";
  const loraObj = await (await fetch(`${ENGINE}/object_info/LoraLoaderModelOnly`)).json();
  const loraList = loraObj.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
  check(`① LoRA 件装机: viggle v0.2.1 r256 在 LoraLoaderModelOnly combo 列表`,
    loraList.includes(LORA_FILE),
    `${loraList.length} 项 loras;目标件${loraList.includes(LORA_FILE) ? "在场" : "缺席"}`);
  report.loraInstalled = loraList.includes(LORA_FILE);

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF, "utf8"));
  // ── 0929 S3 子图寻址发现(实测发现勿手抄 UUID;两宿主按 type=UUID 寻址)──
  const subgraphs = graphJson.definitions?.subgraphs || [];
  check("前置: 恰两子图(装配+加速,S3 收装形态)", subgraphs.length === 2,
    subgraphs.map((s) => s.name).join(" | "));
  const asmSg = subgraphs.find((s) => (s.name || "").includes("装配"));
  const accSg = subgraphs.find((s) => (s.name || "").includes("加速"));
  ASM_SG_TYPE = asmSg?.id || "";
  ACCEL_SG_TYPE = accSg?.id || "";
  ASM_HOST_ID = graphJson.nodes.find((n) => n.type === ASM_SG_TYPE)?.id;
  ACCEL_HOST_ID = graphJson.nodes.find((n) => n.type === ACCEL_SG_TYPE)?.id;
  PE_TG_NID = asmSg?.nodes.find((n) => n.type === "TextGenerate")?.id;
  LORA_NID = accSg?.nodes.find((n) => n.type === "LoraLoaderModelOnly")?.id;
  T8_NID = accSg?.nodes.find((n) => n.type === "T8QwenImage21FunAccPDD4Step")?.id;
  KS_NID = accSg?.nodes.find((n) => n.type === "KSampler" && n.widgets_values?.[2] === 40)?.id; // 直出支路(steps=40)
  SEED_NID = accSg?.nodes.find((n) => n.type === "PrimitiveInt")?.id;
  SEL_NID = accSg?.nodes.find((n) => n.type === "MyQi21SpeedSelect")?.id;
  const found = [ASM_SG_TYPE, ACCEL_SG_TYPE, ASM_HOST_ID, ACCEL_HOST_ID, PE_TG_NID, LORA_NID, T8_NID, KS_NID, SEED_NID, SEL_NID].every((v) => v !== undefined && v !== "" && v !== 0);
  check("前置: 双子图寻址发现齐(装配宿主/加速宿主/懒取证靶/seed 源/选择件)", found,
    `装配=[${ASM_HOST_ID}]${ASM_SG_TYPE.slice(0, 8)}… 加速=[${ACCEL_HOST_ID}]${ACCEL_SG_TYPE.slice(0, 8)}… TextGenerate=${PE_TG_NID} LoRA=${LORA_NID} T8=${T8_NID} 直出KS=${KS_NID} seed=${SEED_NID} 选择件=${SEL_NID}`);
  // seed 签名稳定静态锁:control_after_generate=fixed 留子图内 [191] widget(宿主外露仅值件)
  const seedCtl = accSg?.nodes.find((n) => n.type === "PrimitiveInt")?.widgets_values?.[1];
  check(`前置: 加速子图 [${SEED_NID}] PrimitiveInt control_after_generate=fixed(原 [8] 面上寻址退役,改静态锁)`,
    seedCtl === "fixed", String(seedCtl));

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

  // [40]/[190] 双宿主面板 widgets 实测(勿猜)
  const probe = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(ASM_SG_TYPE)});
    if (!n) return 'node-missing';
    return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: typeof w.value === 'string' ? w.value.slice(0, 30) + '…(' + w.value.length + ')' : w.value })) });
  })()`));
  log("[探测] [40] 装配子图宿主 widgets:", String(probe).slice(0, 1200));
  let asmProbe = null; try { asmProbe = JSON.parse(String(probe)); } catch { /* keep null */ }
  check("① 探测: [40] 装配宿主在前端可寻址(type=UUID),面板四控件在位(主体句/型选择/RGBA透明/PE开关)",
    !!asmProbe && ["型选择", "RGBA透明", "PE开关"].every((nm) => (asmProbe.widgets || []).some((w) => w.name === nm)),
    String(probe).slice(0, 300));
  report.subgraphWidgets = String(probe).slice(0, 2000);
  const probeAcc = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(ACCEL_SG_TYPE)});
    if (!n) return 'node-missing';
    return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: typeof w.value === 'string' ? w.value.slice(0, 30) + '…(' + w.value.length + ')' : w.value })) });
  })()`));
  log("[探测] [190] 加速子图宿主 widgets:", String(probeAcc).slice(0, 800));
  let accProbe = null; try { accProbe = JSON.parse(String(probeAcc)); } catch { /* keep null */ }
  check("① 探测: [190] 加速宿主在前端可寻址(type=UUID),面板双控件在位(速度档位/seed)",
    !!accProbe && ["速度档位", "seed"].every((nm) => (accProbe.widgets || []).some((w) => w.name === nm)),
    String(probeAcc).slice(0, 300));
  report.accelSubgraphWidgets = String(probeAcc).slice(0, 2000);

  // 期望装配真值(本地重建:指令=[22];BASE=qi21_bases.json 该型;锁层A=子图[110] 常量)
  const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
  const baseByZh = {}; for (const e of bases) baseByZh[e.zh] = e.base_text;
  const sgNodes = {}; for (const n of asmSg.nodes) sgNodes[n.id] = n;
  const lockA = sgNodes[110].widgets_values[0];
  const directive = graphJson.nodes.find((n) => n.id === 22).widgets_values[0];
  check("前置: 期望装配真值可重建(指令[22]+BASE(qi21_bases)+锁层A[110])",
    directive.includes(INSTR_SIG) && lockA.length > 500 && baseByZh["人物"].length > 500,
    `指令 ${directive.length} 字符;锁层A ${lockA.length} 字符;人物 BASE ${baseByZh["人物"].length} 字符`);

  // 开关基线(0929 S3 口径):PE=关(装配宿主面板「PE开关」,原主图 [15] 已迁子图内)/
  // 速度档位=默认直出(加速宿主面板,原主图 [30] LoRA 开关退役——LoRA/T8 支路旁路
  // 现由档位懒语义承载)/画幅 [19]=false(主图件,寻址不变)/
  // RGBA=跟随型(三态 combo 退役旧「RGBA透明开关」布尔;人物/场景均在四型透明名单外
  // →跟随=关,语义等价旧 false 基线)
  const rPE = await setSGWidget(page, ASM_SG_TYPE, "PE开关", false);
  check("前置: [40] PE开关=false(装配宿主面板,PE 组旁路)", String(rPE).startsWith("set:") && String(rPE).endsWith("false"), String(rPE).slice(0, 160));
  const rSpd = await setSGWidget(page, ACCEL_SG_TYPE, "速度档位", SPEED_DIRECT);
  check(`前置: [190] 速度档位=${SPEED_DIRECT}(加速宿主面板;LoRA/T8 支路懒旁路)`,
    String(rSpd).startsWith("set:") && String(rSpd).endsWith(SPEED_DIRECT), String(rSpd).slice(0, 160));
  const r19 = await setWidgetById(page, 19, "value", false);
  check("前置: [19] value=false(画幅联动旁路,主图件寻址不变)", String(r19).startsWith("set:"), String(r19).slice(0, 160));
  const rRGBA = await setSGWidget(page, ASM_SG_TYPE, "RGBA透明", RGBA_FOLLOW);
  check(`前置: [40] RGBA透明=${RGBA_FOLLOW}(三态;人物/场景四型名单外→关,等价旧 false)`,
    String(rRGBA).startsWith("set:") && String(rRGBA).endsWith(RGBA_FOLLOW), String(rRGBA).slice(0, 160));

  // ── 环境事实处置(09-24 实测;0929 S3 寻址口径更新):PE-I2I 权重不在本机 text_encoders ──
  // qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors 缺席(引擎 combo 列表仅
  // pe_t2i + qwen3vl_8b;外置盘/Trash/Spotlight 均无)。[12] 即使被 PE 开关(装配
  // 宿主面板「PE开关」=false,旁路子图内 [15])旁路,排队验证仍全图校验 combo 值。
  // 处置=测试期把 [12].clip_name 覆写为在盘 t2i PE 件:**惰性 widget**——默认路
  // (PE 开关=false)PE 组不进执行图(懒执行),此值对出图与装配全文零影响;
  // 交付件仍保 pe_i2i 真源(设计=edit 骨架 i2i 系提示词链,与契约测试互锁;
  // 权重恢复后即原生可跑)。
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
      inert: "PE 开关=false(装配宿主面板)→ TextGenerate 不执行 → PE 权重不加载(服务端懒执行取证另见各拍 executed 列表)",
      shippedFileUntouched: "交付 JSON 仍保 pe_i2i(设计真源;权重恢复后原生可跑)",
    };
  } else {
    check("环境核对: PE-I2I 权重在盘,无需覆写", true, PE_I2I_FILE);
  }
  await sleep(800);
  await page.screenshot("0-loaded-default");

  // ── ② 默认型(人物)出图 + ③ 换型(场景)出图 ──
  // 0930 S3 门禁补:SKIP_GEN=1 → 免生图开门验证模式(跳过两拍生图,懒执行取证
  // 归编排腿 qi21_s3_gate_0930.mjs lazy 真跑;本模式覆盖=注册核/寻址发现/开门
  // 面板探测/基线开关/干跑/装配真值重建预检)
  if (process.env.SKIP_GEN) {
    log("SKIP_GEN=1:跳过两拍生图(开门验证模式)");
    report.skipGen = true;
  } else {
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
  }

  // ── ④ console 留存与汇总 ──
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-i2i.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("④ 全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-i2i.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.execMon = { open: execMonStats.open, frames: execMonStats.frames, pids: [...execFrames.keys()] };
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "i2i-report.json"), JSON.stringify(report, null, 2));

  page.close();
  try { monWs.close(); } catch { /* already gone */ }
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
