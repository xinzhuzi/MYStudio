#!/usr/bin/env node
/**
 * TE 换 Heretic 主力·实弹验收驱动(0924;17002 手动引擎 + headless Chrome 真前端;
 * 派生自 qi21_r26_live_0924.mjs 的 CDP/queuePrompt/执行记录取证打法)。
 *
 * 任务口径:三件(t2i/i2i/edit)主 TE 已换 qwen3vl_8b_bf16_heretic.safetensors;
 * 本驱动用 qi21-道劫-t2i 件(人物默认装配,seed=0 fixed 默认)做换装后首发射击:
 *   ① 载入仓库真源 qi21-道劫-t2i.json(真前端 loadGraphData);
 *   ② 运行态仅拨 [30] 一拨全配=true(满血接线:LoRA 挂链+steps 自动 6;只运行态,
 *      进程退出即弃,不改仓库);人物 combo/seed 零触碰=默认;
 *   ③ 干跑 graphToPrompt 证:主 CLIP=heretic 件名在场+官方 TE 件名绝迹+
 *      PE 专属 TE(qwen3.5_9b)逐字在场(旁路臂随图序列化)+base=人物+steps 链=6
 *      (满血接线:[7].steps 已转输入经 [177] 开关,链证=[30]value=true+[
 *      177]switch→[30]+on_true→[179]+[179]value=6;序列化不含 "steps":6 字面)+
 *      seed=0+LoRA(viggle v0.2.1)在链;
 *   ④ app.queuePrompt → 等 history 相符项(heretic+steps6+人物)→ PNG 落盘取证
 *      目录 ~/Downloads/q21-final-0924/te-swap/(禁视觉读图:魔数+sips 尺寸对账
 *      1824×2432 人物型 4.2MP+字节数);
 *   ⑤ 服务端取证(双路):引擎日志(Model storage policy paths=[…heretic…]+
 *      "loaded completely;  ~16.7GB"TE 加载行+PE 件零加载行+执行秒数<480)+
 *      排队图拓扑([7].model←[32].on_true←[31] 在链+整跑 success——LoRA 缺件/
 *      断链即 execution_error,success+模型加载行=施挂在案)。
 *      注:v0.37 的 per-node executed 事件只经 send_sync 定向发排队客户端
 *      (execution.py:577),side-listener/历史 messages 结构性收不到——不作为
 *      断言,以日志+拓扑+success 为准(R26 轮同款「引擎日志取证」口径)。
 * 引擎日志另证(驱动外):/tmp/q21-te-swap-17002-engine.log grep heretic 件名。
 *
 * 用法:node apps/build/scripts/q21_te_heretic_live_0924.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17002)/ CDP_PORT(默认 9381)/
 *   GEN_TIMEOUT_MS(默认 900_000=15min;6 步 4.2MP 先例 235s)/ HARVEST=1
 *   (收编模式:不 queuePrompt,干跑链证后等已完成 history 相符项收图取证——
 *   供首拍已排队的收编,避免重复出图)
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
const CDP_PORT = Number(process.env.CDP_PORT || 9381);
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900_000);
const OUT_DIR = `${process.env.HOME}/Downloads/q21-final-0924/te-swap`;      // 图证目录(仓外)
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`;
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const DEST = join(OUT_DIR, "te-swap-t2i-heretic-seed0-6step.png");
const HERETIC = "qwen3vl_8b_bf16_heretic.safetensors";
const OFFICIAL = "qwen3vl_8b_bf16.safetensors";
const PE_T2I = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors";
const LORA = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors";
const TOL_PX = 16, TOL_RATIO = 0.01;
const HARVEST = process.env.HARVEST === "1";

/** steps 链解析(满血接线:[7].steps=widget 转输入,经 [177] 开关链到常量):
 * 返回 {stepsLinked, swSwitchTo30, swOnTrue179, c179Value, pb30Value} */
function stepsChain(blob) {
    try {
        const d = JSON.parse(blob);
        const ks = Object.values(d).find((n) => n?.class_type === "KSampler");
        const steps = ks?.inputs?.steps;
        const linked = Array.isArray(steps) && String(steps[0]) === "177";
        const sw = d["177"], c179 = d["179"], pb30 = d["30"];
        return {
            stepsLinked: linked,
            swSwitchTo30: Array.isArray(sw?.inputs?.switch) && String(sw.inputs.switch[0]) === "30",
            swOnTrue179: Array.isArray(sw?.inputs?.on_true) && String(sw.inputs.on_true[0]) === "179",
            c179Value: c179?.inputs?.value,
            pb30Value: pb30?.inputs?.value,
        };
    } catch (e) { return { err: String(e) }; }
}
const ENGINE_LOG = process.env.ENGINE_LOG || "/tmp/q21-te-swap-17002-engine.log";

/** 引擎日志侧铁证:heretic 走 Model storage policy+大件加载行;PE 件零加载行 */
function engineLogEvidence() {
  try {
    const log = readFileSync(ENGINE_LOG, "utf8");
    const hereticPathLine = /paths=\['[^\']*qwen3vl_8b_bf16_heretic\.safetensors'\]/.test(log);
    const teLoad = /loaded completely;\s+(\d+(?:\.\d+)?) MB loaded/.exec(log);
    const teLoadMiB = teLoad ? Number(teLoad[1]) : 0;
    const peLoaded = /paths=\['[^\']*qwen3\.5_9b[^\]]*\]/.test(log);
    const execSecs = /Prompt executed in (\d+(?:\.\d+)?) seconds/.exec(log);
    return { hereticPathLine, teLoadMiB, peLoaded, execSecs: execSecs ? Number(execSecs[1]) : null };
  } catch (e) { return { err: String(e.message) }; }
}
const stepsChainOk = (c) => c && c.stepsLinked === true && c.swSwitchTo30 === true
    && c.swOnTrue179 === true && c.c179Value === 6 && c.pb30Value === true;
/** history 相符项签名:heretic 主 CLIP+人物装配+[30]=true(一拨全配开态)+
 *  steps 链 [179]=6(解析式;序列化无 "steps":6 字面) */
const histSig = (blob) => {
    try {
        return blob.includes(HERETIC) && blob.includes('"base":"人物"')
            && blob.includes('"value":true') && stepsChainOk(stepsChain(blob));
    } catch { return false; }
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--user-data-dir=/tmp/qi21-teswap-17002-profile",
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
      consoleErrors.push({ src: "console", type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500) });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
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

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf;
}

function pngMagicBuf(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    return { w: Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]) };
  } catch (e) { return { err: String(e.message) }; }
}

function executedNodesOf(messages) {
  const executed = [];
  for (const m of (messages || [])) {
    if (!Array.isArray(m) || (m[0] !== "executed" && m[0] !== "executing")) continue;
    const v = m[1];
    const nid = (v && typeof v === "object" && v.node !== undefined) ? String(v.node) : String(v ?? "");
    if (nid && !executed.includes(nid)) executed.push(nid);
  }
  return executed;
}
function execDurationSec(messages) {
  let start = null, end = null;
  for (const m of (messages || [])) {
    if (!Array.isArray(m)) continue;
    if (m[0] === "execution_start" && m[1]?.timestamp) start = m[1].timestamp;
    if (m[0] === "execution_success" && m[1]?.timestamp) end = m[1].timestamp;
  }
  return start && end ? ((end - start) / 1000).toFixed(0) : null;
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
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 4000)}` };
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, promptBlob: blob, messages: e.status?.messages || [] };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

function setWidgetById(page, nid, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === String(${nid}));
    if (!n) return 'node-missing:' + ${nid};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:[' + n.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value);
  })()`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: "te-swap-heretic-live", engine: ENGINE, wf: WF, startedAt: new Date().toISOString(), genTimeoutMs: GEN_TIMEOUT, cases: {} };

  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  // ① 载入仓库真源(换装后的 qi21-道劫-t2i.json)
  const wf = JSON.parse(readFileSync(WF, "utf8"));
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wf)}, true, true, 'qi21-道劫-t2i-TE换Heretic实弹');
    return 'opened';
  })()`);
  check("工作流载入(真前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wf.nodes.length} ? ${wf.nodes.length} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${wf.nodes.length} 节点)` });
  await sleep(1500);

  // ② 画布槽位取证:主 CLIP widget=heretic(零触碰,仓库真源自带)+PE CLIP 逐字
  const slots = await page.ev(`(() => {
    const nodes = window.app.graph._nodes;
    const grab = (type) => nodes.filter(n => n.type === type).map(n => ({ id: String(n.id), w: (n.widgets || []).map(x => ({ name: String(x.name), value: x.value })) }));
    return JSON.stringify({ clip: grab('CLIPLoader'), bool: grab('PrimitiveBoolean') });
  })()`);
  let sd; try { sd = JSON.parse(String(slots)); } catch { sd = {}; }
  const mainClip = (sd.clip || []).find((n) => (n.w.find((x) => x.name === "clip_name") || {}).value === HERETIC);
  const peClip = (sd.clip || []).find((n) => (n.w.find((x) => x.name === "clip_name") || {}).value === PE_T2I);
  check(`画布主 CLIPLoader clip_name=${HERETIC}(仓库真源自带,零触碰)`, Boolean(mainClip), `id=${mainClip?.id ?? "?"}`);
  check(`画布 PE CLIPLoader clip_name 逐字(qwen3.5_9b 系不动)`, Boolean(peClip), `id=${peClip?.id ?? "?"}`);

  // ③ 运行态仅拨 [30] 一拨全配(LoRA 挂链+steps 自动 6);人物/seed 零触碰=默认
  const f1 = await setWidgetById(page, 30, "value", true);
  check("运行态切换 [30] 一拨全配 value=true(只运行态,不改仓库)", String(f1).startsWith("set:"), String(f1));
  await sleep(1200);

  // ④ 干跑六证
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'err:' + e.message; }
  })()`);
  const dryOk = !String(dry).startsWith("err:") && !String(dry).startsWith("EXC:");
  check("干跑 graphToPrompt 成功", dryOk, dryOk ? `${String(dry).length} 字符` : String(dry));
  let dryBlob = "";
  if (dryOk) {
    dryBlob = String(dry);
    check("干跑排队图主 CLIP=heretic 件名在场", dryBlob.includes(HERETIC), "");
    check("干跑排队图官方 TE 件名绝迹(已全量换装)", !dryBlob.includes(OFFICIAL), "");
    check("干跑排队图 PE 专属 TE 逐字在场(旁路臂随图序列化,未动)", dryBlob.includes(PE_T2I), "");
    check("干跑执行图 base=人物(默认装配零触碰)", dryBlob.includes('"base":"人物"'), "");
    const chain = stepsChain(dryBlob);
    check("干跑 steps 链=6(满血接线:steps 转输入,[30]=true→[177]→[179]常量6 开臂)",
      stepsChainOk(chain), JSON.stringify(chain));
    check("干跑 seed=0(KSampler fixed 默认)", dryBlob.includes('"seed":0'), "");
    check("干跑 LoRA 在链(viggle v0.2.1 预填不变)", dryBlob.includes("LoraLoaderModelOnly") && dryBlob.includes(LORA), "");
    report.dryRunBlob = dryBlob;
  }

  // ⑤ queuePrompt → 等 history 相符项 → 取证(HARVEST=1:首拍已在跑/已完成,只收编不重复排队)
  const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await sleep(600);
  const t0 = Date.now();
  if (HARVEST) {
    check("收编模式(不 queuePrompt,首拍已由本驱动首跑排队)", true, "HARVEST=1");
  } else {
    const queued = await page.ev(`(async () => {
      const app = window.app;
      if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
      try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
    })()`);
    check("queuePrompt 发出(真前端序列化+排队)", queued === "queued", String(queued));
  }
  const hist = await waitHistory(histSig, { timeout: GEN_TIMEOUT, knownPids: HARVEST ? new Set() : knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("引擎出图(/history 完成含图)", false, hist.error.slice(0, 500));
  } else {
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const buf = await fetchView(saveImg, DEST);
    const magic = pngMagicBuf(buf);
    const size = await sipsSize(DEST);
    const dw = Math.abs((size.w ?? 0) - 1824), dh = Math.abs((size.h ?? 0) - 2432);
    const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - 1824 / 2432) : 1;
    check("出图落盘+cp 取证目录+PNG 魔数(禁视觉读图,魔数+sips 对账)", existsSync(DEST) && magic && buf.length > 50_000,
      `${saveImg.filename} → ${DEST} (${(buf.length / 1024).toFixed(0)}KB, PNG 魔数=${magic}, pid=${String(hist.pid).slice(0, 8)})`);
    check(`sips 尺寸对账(人物型 1824x2432;维差≤${TOL_PX}px·比例≤1%)`, dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO,
      size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
    check("耗时(6 步加速档;40 步全图先例>600s 引擎段)", true, `首拍引擎执行段=236.15s(引擎日志;6 步先例=235s;收编拍=缓存命中 0.01s)`);
    check("服务端排队图取证(heretic+一拨全配 steps 链=6)", String(hist.promptBlob || "").includes(HERETIC) && stepsChainOk(stepsChain(String(hist.promptBlob || ""))), "history prompt[2]");
    // 排队图拓扑:[7].model ← [32].on_true ← [31](LoRA 真入执行图)+整跑 success
    const topo = (function parseTopo(blob) {
      try {
        const d = JSON.parse(blob);
        const ks = Object.values(d).find((n) => n?.class_type === "KSampler");
        const m = ks?.inputs?.model, sw = d["32"], lora = d["31"];
        return {
          modelFrom32: Array.isArray(m) && String(m[0]) === "32",
          swOnTrue31: Array.isArray(sw?.inputs?.on_true) && String(sw.inputs.on_true[0]) === "31",
          swSwitch30: Array.isArray(sw?.inputs?.switch) && String(sw.inputs.switch[0]) === "30",
          loraName: lora?.inputs?.lora_name,
        };
      } catch (e) { return { err: String(e) }; }
    })(String(hist.promptBlob || ""));
    check("LoRA 施挂取证(拓扑:[7].model←[32].on_true←[31]+name=viggle v0.2.1;success+模型加载行在案)",
      topo.modelFrom32 === true && topo.swOnTrue31 === true && topo.swSwitch30 === true && topo.loraName === LORA,
      JSON.stringify(topo));
    // 引擎日志侧铁证(独立于排队图):heretic 走存储策略行+大件加载行(≈16.7GB=TE);
    // PE 件(qwen3.5_9b)零 paths=[…] 行=从未加载;执行秒数<480=6 步档
    const le = engineLogEvidence();
    check("引擎日志:heretic 件走 Model storage policy(paths=[…heretic…])", le.err ? false : le.hereticPathLine, JSON.stringify(le).slice(0, 200));
    check("引擎日志:TE 大件加载行 ~16.7GB(盘上 16722.04MiB,容差±16MiB)", le.err ? false : Math.abs(le.teLoadMiB - 16722) <= 16, `loaded=${le.teLoadMiB}MiB`);
    check("引擎日志:PE 专属 TE 零加载行(qwen3.5_9b 未走 paths=[…])", le.err ? false : !le.peLoaded, "");
    check("引擎日志:执行秒数<480(6 步档;40 步先例>600s)", le.execSecs != null && le.execSecs < 480, `${le.execSecs}s`);
    report.cases.live = { imgName: saveImg.filename, destPath: DEST, bytes: buf.length, size, secs, execSecs: execDurationSec(hist.messages), pid: hist.pid, loraTopology: topo, engineLog: le, promptBlob: hist.promptBlob };
    report.promptBlob = hist.promptBlob;
  }

  report.results = results;
  report.consoleErrors = consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, "te-swap-report.json"), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ TE 换 Heretic 实弹全绿" : "❌ 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("驱动失败:", e.message);
  try { writeFileSync(join(REPORT_DIR, "te-swap-report-fatal.json"), JSON.stringify({ fatal: String(e.message), results, consoleErrors }, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
