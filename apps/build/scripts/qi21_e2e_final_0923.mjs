#!/usr/bin/env node
/**
 * Q2-1 道劫·MyQi21DaojieBase 总装版(qi21-道劫-t2i.json)真前端终验收 E2E(09-23):
 * 真前端载入含 [40] 装配子图(definitions.subgraphs, MyQi21DaojieBase 底座九选一)的新工作流:
 *   ① 干跑 graphToPrompt 无异常(节点注册先经 /object_info/MyQi21DaojieBase 200 验证);
 *   ② 选型联动三连:[40] 面板 combo「型选择」切 人物/场景/道具 各排队一张,
 *      sips 实测尺寸逐张对账(期望=节点 W/H:人物3:4=1816x2424·场景16:9=2800x1576·道具1:1=1024x1024);
 *   ③ 稳定样张:人物型 40 步完整态两图(seed 42/4242,主体句=库人物例一),记录每张耗时;
 *   ④ PE 开关往返:true 排队成功(排队图取证 ComfySwitchNode switch=true)即 /interrupt 断开复位,
 *      不浪费整轮生成;开关有效性以排队图为准。
 * 产物 ~/Downloads/qi21-final/{型名/型名-seedN.png};PNG 魔数+sips 验证;
 * console 执行期错误留档 console-final.json。
 * 驱动仿 apps/build/scripts/qi21_e2e_jiuxing_0923.mjs;引擎生命周期(自拉起/停)在驱动外管理。
 *
 * 用法:node apps/build/scripts/qi21_e2e_final_0923.mjs
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
const CDP_PORT = Number(process.env.CDP_PORT || 9359);
const E2E_DIR = `${process.env.HOME}/Downloads/qi21-final`;
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const BASES_JSON = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-final-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_500_000); // 25 min/张(4.2MP 40步 MPS)
const STEPS = 40; // ③ 口径:40 步完整态(=工作流默认)

// 库人物例一(docs/prompts/道劫_九型主体句示例.md §1 原文;=工作流 [24] 默认值)
const SUBJ_PERSON = "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。";
const SUBJ_SIG = "她立于山门石阶最上一级"; // 主体句唯一指纹(prompt[2] 内 PrimitiveStringMultiline value)
const ENGINE_LOG = `${process.env.HOME}/Downloads/qi21-final/engine.log`;
// 复用轮注记:首轮驱动(同工作流同参,型选择/seed/steps/三开关 false/主体句=库例一
// 均有 PASS 取证)因 history 特征匹配笔误(spaced JSON+base_text 误标)未收成;
// 引擎已产出/在跑的拍不浪费——本驱动按签名收成(harvest/inflight-wait),签名=
// 主体句指纹+紧凑 "base":"型名"+"seed":N,。首轮排队时间戳取自首轮驱动日志。
const PRIOR_QUEUE_AT = {
  "人物-seed42": "2026-09-23T05:50:49Z",   // 首轮驱动排队
  "场景-seed42": "2026-09-23T06:15:54Z",   // 首轮驱动排队
  "道具-seed42": "2026-09-23T06:36:56Z",   // 二轮驱动排队
  "人物-seed4242": "2026-09-23T06:40:38Z", // 二轮驱动排队
};

// ② 三连口径:节点声明 W/H=MyQi21DaojieBase native_px(K2 同款 8 倍数公式);
// 引擎侧 Qwen-Image(8×VAE+2×patchify)把潜像格数 round-half-to-even 到偶数 →
// 实测=声明值就近归整到 16 倍数(实证:1816→1824/2424→2432 半入上,1576→1568
// 半入下;2800/1024 恰 16 倍数不变)。对账判据=每维|实测-声明|≤16px 且比例
// 偏差≤1%(联动失效时维差为百千px级,远超此界)。
const TOL_PX = 16, TOL_RATIO = 0.01;
const TRIPLE = [
  { name: "人物", seed: 42, decW: 1816, decH: 2424, expRatio: "3:4", ratio: 3 / 4 },
  { name: "场景", seed: 42, decW: 2800, decH: 1576, expRatio: "16:9", ratio: 16 / 9 },
  { name: "道具", seed: 42, decW: 1024, decH: 1024, expRatio: "1:1", ratio: 1 },
];

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

/** [40] 装配子图节点(type=子图UUID)外露 widget 设值(combo 型选择/布尔开关)。 */
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
async function queueSnapshot() {
  try { return await (await fetch(`${ENGINE}/queue`)).json(); }
  catch { return null; }
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

/** 一拍签名(prompt[2] 紧凑 JSON):主体句指纹+MyQi21DaojieBase.base=型名+seed=N。 */
const shotSig = (name, seed) => (blob) =>
  blob.includes(SUBJ_SIG) && blob.includes(`"base":"${name}"`) && blob.includes(`"seed":${seed},`);

/** 单趟扫描 history:命中(已完成含图)即返回,不命中返回 null。 */
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

/** 引擎 log 全部 "Prompt executed in"(秒,按完成顺序;HH:MM:SS 或裸秒两种形态;
 * 采集拍按序号对帐——仅采前 N 张完整拍,PE 打断拍缀在尾不参与映射)。 */
function allEngineExecSecs() {
  try {
    const txt = readFileSync(ENGINE_LOG, "utf8");
    return [...txt.matchAll(/Prompt executed in (?:(\d+):(\d+):(\d+)|(\d+))/g)]
      .map((m) => m[4] !== undefined ? Number(m[4]) : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  } catch { return []; }
}
let engineExecCursor = 0; // 收成拍按完成顺序取第 N 条 executed 行(完成序=采集序)

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

/** 一拍通用:优先收成(history 已完成/引擎在跑同签名拍),否则真前端排队 → 取回验证(魔数/sips/对账)。 */
async function genShot(page, { name, seed, decW, decH, expRatio, ratio }) {
  const tag = `${name}-seed${seed}`;
  const outDir = join(E2E_DIR, name);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${name}-seed${seed}.png`);
  const report = { tag, outPath, declared: `${decW}x${decH}(${expRatio},MyQi21DaojieBase native_px)` };
  const sig = shotSig(name, seed);

  let mode = null;
  let hist = await scanHistoryOnce(sig);
  if (hist) {
    mode = "harvest"; // 引擎已完成的同签名拍(首轮驱动排队,同工作流同参)
  } else {
    // 引擎在跑同签名拍?(首轮驱动刚排的)在跑即等它,不重复排队
    const qs = await queueSnapshot();
    let inflight = false;
    for (const q of [...(qs?.queue_running || []), ...(qs?.queue_pending || [])]) {
      const blob = JSON.stringify(Array.isArray(q) ? q[2] : q?.prompt?.[2] || {});
      if (sig(blob, "")) { inflight = true; break; }
    }
    if (inflight) {
      mode = "inflight-wait";
      hist = await waitHistory(sig, { timeout: GEN_TIMEOUT });
    }
  }

  if (!hist) {
    // 真前端排队(常规路):型选择(combo)+ seed/steps(固定)
    mode = "queued";
    const rc = await setSGWidget(page, SG_TYPE, "型选择", name);
    check(`${tag}: [40] 型选择=${name}`, String(rc).startsWith("set:"), String(rc).slice(0, 200));
    if (!String(rc).startsWith("set:")) throw new Error(`${tag} 型选择设置失败: ${rc}`);
    const rs = await setWidget(page, "KSampler", "[7]", "seed", seed);
    check(`${tag}: [7] seed=${seed}(fixed)`, String(rs).startsWith("set:"), String(rs).slice(0, 120));
    const steps = await setWidget(page, "KSampler", "[7]", "steps", STEPS);
    check(`${tag}: [7] steps=${STEPS}(完整态)`, String(steps).startsWith("set:"), String(steps).slice(0, 120));
    await sleep(900);
    // 排队图预取证:干跑展开图 MyQi21DaojieBase.base=型名
    const dryBase = await promptDigest(page, "MyQi21DaojieBase", ["base"]);
    check(`${tag}: 干跑排队图 MyQi21DaojieBase.base=${name}`, String(dryBase).includes(`"base":"${name}"`),
      String(dryBase).slice(0, 200));

    const knownPids = await historyPids();
    await sleep(800);
    const t0 = Date.now();
    const queued = await queuePrompt(page);
    check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
    if (queued !== "queued") throw new Error(`${tag} queuePrompt 失败: ${queued}`);
    hist = await waitHistory(sig, { timeout: GEN_TIMEOUT, knownPids });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    report.secs = secs;
    report.timing = `排队→完成 ${secs}s(本驱动排队计时)`;
  }
  report.mode = mode;
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, `${hist.error.slice(0, 4000)}`);
    report.error = hist.error;
    return report;
  }
  report.pid = hist.pid;
  // 收成拍计时:引擎侧 "Prompt executed in" 按完成顺序对帐(权威);已知排队时间戳作旁证
  if (mode !== "queued") {
    const all = allEngineExecSecs();
    const engineSecs = engineExecCursor < all.length ? all[engineExecCursor++] : null;
    const q0 = PRIOR_QUEUE_AT[tag] ? Date.parse(PRIOR_QUEUE_AT[tag]) : null;
    const approx = q0 ? ((Date.now() - q0) / 1000).toFixed(0) : null;
    report.secs = engineSecs !== null ? engineSecs : (approx ?? null);
    report.timing = `收成拍:${mode};引擎侧 ${engineSecs !== null ? engineSecs + "s(Prompt executed in 第" + engineExecCursor + "条)" : "未解析到"}${approx ? `;排队→收成 ≈${approx}s(含检测延迟,仅旁证)` : ""}`;
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const buf = await fetchView(saveImg, outPath);
  const magic = pngMagic(buf);
  const size = await sipsSize(outPath);
  check(`${tag}: PNG 魔数`, magic === true, outPath);
  const dw = Math.abs((size.w ?? 0) - decW), dh = Math.abs((size.h ?? 0) - decH);
  const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - ratio) / ratio : 1;
  const sizeOk = dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO;
  check(`${tag}: sips 尺寸对账(节点声明 ${decW}x${decH} ${expRatio};维差≤${TOL_PX}px·比例偏差≤1%)`, sizeOk,
    size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
  check(`${tag}: 引擎出图(/view 取回)`, buf.length > 50_000,
    `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${report.timing || ""}, pid=${String(hist.pid).slice(0, 8)}, mode=${mode})`);
  report.size = size; report.sizeOk = sizeOk; report.engineFile = saveImg.filename; report.bytes = buf.length;
  report.serverBase = (hist.promptBlob || "").includes(`"base":"${name}"`);
  check(`${tag}: 服务端排队图 MyQi21DaojieBase.base=${name}`, report.serverBase === true, `history prompt[2] 内 base 字段`);
  return report;
}

let SG_TYPE = "";

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  const report = { engine: ENGINE, wf: WF, startedAt: new Date().toISOString(), cases: {}, sizeChecks: [] };
  if (!existsSync(WF)) { console.error("工作流缺失:", WF); process.exit(2); }

  // ── 引擎探活 ──
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  // ── 节点注册:/object_info/MyQi21DaojieBase 200(缺=接线部署问题如实报) ──
  let nodeReg = false, nodeRegDetail = "";
  try {
    const r = await fetch(`${ENGINE}/object_info/MyQi21DaojieBase`);
    nodeReg = r.status === 200;
    if (nodeReg) {
      const j = await r.json();
      const combo = j.MyQi21DaojieBase?.input?.required?.base?.[0] || [];
      nodeRegDetail = `200;base combo ${combo.length} 项: ${combo.join("/")}`;
    } else nodeRegDetail = `HTTP ${r.status}`;
  } catch (e) { nodeRegDetail = String(e.message); }
  check("① 节点注册: /object_info/MyQi21DaojieBase 200", nodeReg, nodeRegDetail);
  if (!nodeReg) {
    writeFileSync(join(E2E_DIR, "final-report.json"), JSON.stringify({ ...report, fatal: "MyQi21DaojieBase 未注册(接线部署问题)", results }, null, 2));
    killChrome();
    process.exit(1);
  }
  report.nodeReg = nodeRegDetail;

  // 底座库(真源 repo 份=引擎部署份,驱动外已 diff 验证一致)
  const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
  const baseMark = {}; for (const e of bases) baseMark[e.zh] = e.base_text.slice(0, 16);
  SG_TYPE = JSON.parse(readFileSync(WF, "utf8")).definitions.subgraphs[0].id;

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF, "utf8"));
  const nodeCount = graphJson.nodes.length;
  const opened = await loadWorkflow(page, "qi21-道劫-t2i-终验收", graphJson);
  check("总装版: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(1500);

  // ── ① 干跑:graphToPrompt 无异常(子图装载验证) ──────────────────
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
    catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("① 干跑: graphToPrompt 无异常(子图+MyQi21DaojieBase 装配)", String(dry).startsWith("ok:"), String(dry).slice(0, 300));

  // [40] 外露 widgets 实测(勿猜)
  const probe = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(SG_TYPE)});
    if (!n) return 'node-missing';
    return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: typeof w.value === 'string' ? w.value.slice(0, 30) + '…(' + w.value.length + ')' : w.value })) });
  })()`));
  log("[探测] [40] 子图节点 widgets:", String(probe).slice(0, 1200));
  check("① 探测: [40] 装配子图节点在前端可寻址(type=UUID)", String(probe).startsWith('{"title"'), String(probe).slice(0, 200));
  report.subgraphWidgets = String(probe).slice(0, 2000);

  // 主体句=[24](库人物例一,默认即库文;显式钉一遍)
  const subj = await setWidget(page, "PrimitiveStringMultiline", "主体句", "value", SUBJ_PERSON);
  check("前置: [24] 主体句=库人物例一", String(subj).startsWith("set:"), String(subj).slice(0, 160));
  // 开关基线:PE/RGBA/画幅联动 全 false(直写装配/普通/九型画幅)
  for (const [wn, val] of [["PE改写开关", false], ["RGBA透明开关", false], ["画幅联动开关", false]]) {
    const r = await setSGWidget(page, SG_TYPE, wn, val);
    check(`前置: [40] ${wn}=${val}`, String(r).startsWith("set:"), String(r).slice(0, 160));
  }
  await sleep(800);
  const latent0 = await promptDigest(page, "EmptyLatentImage", ["width", "height", "batch_size"]);
  log("[① 干跑] EmptyLatentImage 队列图取证(宽高=[40]连线):", String(latent0).slice(0, 200));
  await page.screenshot("0-loaded-default");

  // ── ② 选型联动三连 + ③ 稳定样张(人物-seed42 同拍双计) ──────────
  for (const t of TRIPLE) {
    report.cases[`case-${t.name}-seed${t.seed}`] = await genShot(page, t);
    report.sizeChecks.push(`${t.name}→${report.cases[`case-${t.name}-seed${t.seed}`].size?.w ?? "?"}x${report.cases[`case-${t.name}-seed${t.seed}`].size?.h ?? "?"}`);
    await sleep(1200);
  }
  // ③ 第二张:人物 seed 4242
  report.cases["case-人物-seed4242"] = await genShot(page, { name: "人物", seed: 4242, decW: 1816, decH: 2424, expRatio: "3:4", ratio: 3 / 4 });
  report.sizeChecks.push(`人物(seed4242)→${report.cases["case-人物-seed4242"].size?.w ?? "?"}x${report.cases["case-人物-seed4242"].size?.h ?? "?"}`);
  await page.screenshot("stability-done");

  // ── ④ PE 开关往返:true 排队成功即断开复位(不浪费整轮生成) ──────
  const peReport = { phase: "PE round-trip" };
  const rOn = await setSGWidget(page, SG_TYPE, "PE改写开关", true);
  check("④ PE 开: [40] PE改写开关=true", String(rOn).startsWith("set:") && String(rOn).endsWith("true"), String(rOn).slice(0, 200));
  await sleep(900);
  // 开态干跑取证:提示词开关(ComfySwitchNode) switch=true
  const drySW = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  const swOn = (() => { try { const arr = JSON.parse(String(drySW)); return Array.isArray(arr) && arr.some((x) => x.switch === true); } catch { return false; } })();
  check("④ PE 开: 干跑排队图 ComfySwitchNode 有 switch=true(PE 路选中)", swOn, String(drySW).slice(0, 400));
  peReport.drySwitchOn = String(drySW).slice(0, 600);

  const knownPidsPE = await historyPids();
  await sleep(500);
  const tPE0 = Date.now();
  const queuedPE = await queuePrompt(page);
  check("④ PE 开: queuePrompt 发出(真前端)", queuedPE === "queued", String(queuedPE));
  peReport.queued = String(queuedPE);
  // 排队图取证:轮 /queue+/history 找新 pid,抓其 prompt[2] 内 ComfySwitchNode switch=true
  let pePid = null, pePromptBlob = null, queueEvidence = "";
  const peDeadline = Date.now() + 90_000;
  while (Date.now() < peDeadline && !pePromptBlob) {
    const qs = await queueSnapshot();
    for (const q of [...(qs?.queue_running || []), ...(qs?.queue_pending || [])]) {
      const pid = Array.isArray(q) ? q[1] : q?.promptId ?? q?.prompt_id;
      if (pid && !knownPidsPE.has(pid)) {
        const blob = JSON.stringify(Array.isArray(q) ? q[2] : q?.prompt?.[2] || {});
        if (blob.includes(SUBJ_SIG)) { pePid = pid; pePromptBlob = blob; }
      }
    }
    if (!pePromptBlob) {
      try {
        const h = await (await fetch(`${ENGINE}/history`)).json();
        for (const [pid, e] of Object.entries(h)) {
          if (knownPidsPE.has(pid)) continue;
          const blob = JSON.stringify(e.prompt?.[2] || {});
          if (blob.includes(SUBJ_SIG)) { pePid = pid; pePromptBlob = blob; break; }
        }
      } catch { /* 尽力 */ }
    }
    await sleep(1500);
  }
  if (pePromptBlob) {
    const swMatches = [...pePromptBlob.matchAll(/"class_type"\s*:\s*"ComfySwitchNode"[^}]*?/g)].length;
    const hasTrue = /"switch"\s*:\s*true/.test(pePromptBlob);
    queueEvidence = `pid=${String(pePid).slice(0, 8)};排队图含 ComfySwitchNode×${swMatches},switch=true 在场=${hasTrue}`;
    check("④ PE 排队图: 引擎队列里出现新 pid 且 switch=true(PE 路实弹排队)", hasTrue, queueEvidence);
    peReport.pid = pePid; peReport.switchTrueInQueue = hasTrue;
  } else {
    check("④ PE 排队图: 引擎队列里出现新 pid 且 switch=true(PE 路实弹排队)", false, "90s 内未在 /queue+/history 捕到新 pid 排队图");
    peReport.switchTrueInQueue = false;
  }
  // 断开:POST /interrupt 取消执行(不浪费整轮),等队列清空
  try {
    const r = await fetch(`${ENGINE}/interrupt`, { method: "POST" });
    peReport.interruptStatus = r.status;
    log("④ /interrupt →", r.status);
  } catch (e) { peReport.interruptError = String(e.message); log("④ /interrupt 失败:", e.message); }
  await sleep(3000);
  // 复位:false + 干跑取证 switch 全 false
  const rOff = await setSGWidget(page, SG_TYPE, "PE改写开关", false);
  check("④ PE 复位: [40] PE改写开关=false", String(rOff).startsWith("set:") && String(rOff).endsWith("false"), String(rOff).slice(0, 200));
  await sleep(900);
  const drySW2 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  const allFalse = (() => { try { const arr = JSON.parse(String(drySW2)); return Array.isArray(arr) && arr.every((x) => x.switch === false); } catch { return false; } })();
  check("④ PE 复位: 干跑排队图 ComfySwitchNode 全 switch=false(旁路复位)", allFalse, String(drySW2).slice(0, 400));
  peReport.drySwitchAfterReset = String(drySW2).slice(0, 600);
  // 记录被打断拍的最终态(如实;interrupt 视为预期取消,不算失败)
  try {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    const e = h[pePid];
    peReport.interruptedStatus = e ? { status: e.status?.status_str, completed: e.status?.completed } : "pid 不在 history(队列内被取消)";
  } catch { /* 尽力 */ }
  report.cases["case-PE-roundtrip"] = peReport;
  await page.screenshot("pe-roundtrip-done");

  // ── console 留存与汇总 ─────────────────────────────────────
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-final.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-final.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "final-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 终验收全部通过" : "❌ 终验收存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-final.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
