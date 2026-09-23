#!/usr/bin/env node
/**
 * Q2-1 qwen21-edit.json(升级版:双图多图编辑+PE-I2I 换核心 TextGenerate)真前端实测 E2E(09-24):
 *   ① 干跑:载入 edit 件 graphToPrompt 无异常;节点注册核 TextGenerate/QwenImage21Cache 须 200;
 *   ② 多图编辑:官方两示例图(portrait_model_denim+clothing_light_blue_denim_shirt,已在引擎 input)
 *      → LoadImage×2 → TextEncodeQwenImage21 images 双槽 → [19]=true 走 EmptyLatentImage 1024² 自定义画幅路
 *      → 排队出图,收图 PNG 魔数+sips 实测 1024×1024 对账;
 *   ③ PE 开关:[15] ComfySwitch true 排队成功(排队图取证 switch=true/TextGenerate 进执行图)即 /interrupt
 *      断开复位(不浪费整轮生成),复位后干跑取证 switch=false;
 *   ④ 产物 ~/Downloads/qi21-edit-final/;console 执行期错误留档 console-edit-final.json。
 * 驱动仿 apps/build/scripts/qi21_e2e_final_0923.mjs;引擎生命周期(自拉起 17002/停)在驱动外管理。
 *
 * 用法:node apps/build/scripts/qi21_edit_final_0924.mjs
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
const CDP_PORT = Number(process.env.CDP_PORT || 9361);
const E2E_DIR = `${process.env.HOME}/Downloads/qi21-edit-final`;
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/3_改图/qwen21-edit.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-edit-final-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_500_000); // 25 min(1024² 25步 MPS 余量)

const IMG1 = "portrait_model_denim.png";               // [4] 编辑画布/人物(官方示例)
const IMG2 = "clothing_light_blue_denim_shirt.png";    // [5] 参考/衬衫(官方示例)
const SEED = 4242;                                      // [8] KSampler 固定 seed(稳定样张)
const EXP_W = 1024, EXP_H = 1024;                       // ② [19]=true → [18] EmptyLatentImage 1024²
const TOL_PX = 16;                                      // 引擎 16 倍数归整容差(1024 恰 16 倍数,期望精确)

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

/** 节点定位按 id(edit 件为普通工作流,id 稳定;新前端 loadGraphData 后 node.id 为字符串,String 比较)。 */
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

/** 干跑全图 class 清单(懒执行剪枝观察:PE 组在 switch 开/关时的进出执行图)。 */
function promptClasses(page) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      return JSON.stringify([...new Set(Object.values(p.output || {}).map(n => n.class_type))].sort());
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

/** ② 多图编辑拍签名:双图名+固定 seed+1024 空潜在 prompt[2] 内。 */
const editSig = (blob) =>
  blob.includes(IMG1) && blob.includes(IMG2) && /"seed"\s*:\s*4242/.test(blob) && /"width"\s*:\s*1024/.test(blob);

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

  // ── ① 节点注册核:TextGenerate / QwenImage21Cache 须 200 ──
  for (const nodeName of ["TextGenerate", "QwenImage21Cache"]) {
    let ok = false, detail = "";
    try {
      const r = await fetch(`${ENGINE}/object_info/${nodeName}`);
      ok = r.status === 200;
      if (ok) { await r.json(); detail = "200"; } else detail = `HTTP ${r.status}`;
    } catch (e) { detail = String(e.message); }
    check(`① 节点注册: /object_info/${nodeName} 200`, ok, detail);
    if (!ok) {
      writeFileSync(join(E2E_DIR, "edit-final-report.json"), JSON.stringify({ ...report, fatal: `${nodeName} 未注册`, results }, null, 2));
      killChrome();
      process.exit(1);
    }
  }

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
  const opened = await loadWorkflow(page, "qwen21-edit-终验收", graphJson);
  check("edit 件: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(1500);

  // ── ① 干跑:graphToPrompt 无异常 ─────────────────────────
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
    catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("① 干跑: graphToPrompt 无异常(edit 件装配)", String(dry).startsWith("ok:"), String(dry).slice(0, 300));
  report.dryRun = String(dry);

  // 默认态干跑取证:LoadImage 双图名 / KSampler 默认参 / 布尔开关基线
  const li0 = await promptDigest(page, "LoadImage", ["image"]);
  log("[① 默认态] LoadImage 队列图:", String(li0).slice(0, 300));
  report.defaultLoadImages = String(li0).slice(0, 400);
  const ks0 = await promptDigest(page, "KSampler", ["seed", "control_after_generate", "steps", "cfg"]);
  log("[① 默认态] KSampler 队列图:", String(ks0).slice(0, 300));
  report.defaultKSampler = String(ks0).slice(0, 400);
  const classes0 = await promptClasses(page);
  log("[① 默认态] 执行图 class 清单:", String(classes0).slice(0, 600));
  report.defaultClasses = String(classes0);
  // 注:前端 graphToPrompt 不剪懒执行分支(两臂恒进编译图);旁路剪枝发生在服务端执行层,
  // 由 ② 收成拍的 executed 节点消息核(TextGenerate=[26] 不得出现在服务端执行记录)。
  await page.screenshot("0-loaded-default");

  // ── ② 多图编辑:双图→双槽→[19]=true 1024²→排队出图 ─────────
  const gen = { phase: "multi-image edit" };
  const r4 = await setWidgetById(page, 4, "image", IMG1);
  check(`② [4] LoadImage image=${IMG1}`, String(r4).startsWith("set:"), String(r4).slice(0, 160));
  const r5 = await setWidgetById(page, 5, "image", IMG2);
  check(`② [5] LoadImage image=${IMG2}`, String(r5).startsWith("set:"), String(r5).slice(0, 160));
  const r19 = await setWidgetById(page, 19, "value", true);
  check("② [19] PrimitiveBoolean=true(输出画幅走 [18] EmptyLatentImage 1024²)", String(r19).startsWith("set:") && String(r19).endsWith("true"), String(r19).slice(0, 160));
  const rSeed = await setWidgetById(page, 8, "seed", SEED);
  check(`② [8] KSampler seed=${SEED}`, String(rSeed).startsWith("set:"), String(rSeed).slice(0, 160));
  const rCtrl = await setWidgetById(page, 8, "control_after_generate", "fixed");
  check("② [8] KSampler control_after_generate=fixed(签名稳定)", String(rCtrl).startsWith("set:"), String(rCtrl).slice(0, 160));
  await sleep(900);

  // 排队图预取证(干跑):双图名+双槽+1024 空潜+seed/steps/cfg
  const liDig = await promptDigest(page, "LoadImage", ["image"]);
  const liOk = String(liDig).includes(IMG1) && String(liDig).includes(IMG2);
  check("② 干跑排队图: LoadImage×2 = portrait+denim_shirt(双图就位)", liOk, String(liDig).slice(0, 300));
  const teDig = await promptDigest(page, "TextEncodeQwenImage21", ["images.image_1", "images.image_2"]);
  const teOk = /"16"/.test(String(teDig)) && /"17"/.test(String(teDig));
  check("② 干跑排队图: TextEncodeQwenImage21 images 双槽←[16]/[17](预缩后双图)", teOk, String(teDig).slice(0, 400));
  const elDig = await promptDigest(page, "EmptyLatentImage", ["width", "height", "batch_size"]);
  const elOk = /"width":\s*1024/.test(String(elDig)) && /"height":\s*1024/.test(String(elDig));
  check("② 干跑排队图: EmptyLatentImage 1024×1024 进执行图", elOk, String(elDig).slice(0, 300));
  const pbDig = await promptDigest(page, "PrimitiveBoolean", ["value"]);
  check("② 干跑排队图: [19] PrimitiveBoolean value=true(画幅开关联动)", /"value":\s*true/.test(String(pbDig)), String(pbDig).slice(0, 200));
  const ksDig = await promptDigest(page, "KSampler", ["seed", "steps", "cfg"]);
  const ksOk = /"seed":\s*4242/.test(String(ksDig)) && /"steps":\s*25/.test(String(ksDig)) && /"cfg":\s*1/.test(String(ksDig));
  check("② 干跑排队图: KSampler seed=4242/steps=25/cfg=1(官方路径)", ksOk, String(ksDig).slice(0, 300));
  gen.dryEvidence = { li: String(liDig).slice(0, 300), te: String(teDig).slice(0, 400), el: String(elDig).slice(0, 300), ks: String(ksDig).slice(0, 300) };

  const knownPids = await historyPids();
  await sleep(800);
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check("② queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") throw new Error(`② queuePrompt 失败: ${queued}`);
  const hist = await waitHistory(editSig, { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  gen.secs = secs;
  if (hist.error) {
    check("② 引擎出图(多图编辑 1024²)", false, String(hist.error).slice(0, 4000));
    gen.error = hist.error;
  } else {
    gen.pid = hist.pid;
    gen.promptBlobHead = (hist.promptBlob || "").slice(0, 400);
    const outPath = join(E2E_DIR, "edit-multi-1024.png");
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const buf = await fetchView(saveImg, outPath);
    const magic = pngMagic(buf);
    const size = await sipsSize(outPath);
    check("② PNG 魔数", magic === true, outPath);
    const dw = Math.abs((size.w ?? 0) - EXP_W), dh = Math.abs((size.h ?? 0) - EXP_H);
    const sizeOk = dw <= TOL_PX && dh <= TOL_PX;
    check(`② sips 尺寸对账(期望 ${EXP_W}×${EXP_H};维差≤${TOL_PX}px)`, sizeOk,
      size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px`);
    check("② 引擎出图(/view 取回)", buf.length > 50_000,
      `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${String(hist.pid).slice(0, 8)})`);
    gen.outPath = outPath; gen.size = size; gen.sizeOk = sizeOk; gen.engineFile = saveImg.filename; gen.bytes = buf.length;
    // 服务端排队图取证:双图双槽在 history prompt[2]
    gen.serverDualSlot = (hist.promptBlob || "").includes(IMG1) && (hist.promptBlob || "").includes(IMG2);
    check("② 服务端排队图: 双图名在 history prompt[2](双槽实弹)", gen.serverDualSlot === true, "history prompt[2] 内双图名");
    // 服务端懒执行取证:executed 节点里 TextGenerate=[26] 不得出现(PE 组旁路=模型不加载)
    const executedNodes = [];
    for (const m of (hist.messages || [])) {
      if (!Array.isArray(m) || (m[0] !== "executed" && m[0] !== "executing")) continue;
      const v = m[1];
      const nid = (v && typeof v === "object" && v.node !== undefined) ? String(v.node) : String(v ?? "");
      if (nid && !executedNodes.includes(nid)) executedNodes.push(nid);
    }
    gen.executedNodes = executedNodes;
    check("② 服务端懒执行: PE 组 [26]TextGenerate 不在执行记录(旁路不载 PE 模型)", !executedNodes.includes("26"),
      `executed=${JSON.stringify(executedNodes)}`);
  }
  report.cases["case-multi-edit-1024"] = gen;
  await page.screenshot("edit-multi-done");

  // ── ③ PE 开关:true 排队成功即 /interrupt 断开复位 ──────────
  const pe = { phase: "PE round-trip" };
  const rOn = await setWidgetById(page, 15, "switch", true);
  check("③ PE 开: [15] ComfySwitchNode switch=true", String(rOn).startsWith("set:") && String(rOn).endsWith("true"), String(rOn).slice(0, 200));
  await sleep(900);
  const drySW = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  const swOn = (() => { try { const arr = JSON.parse(String(drySW)); return Array.isArray(arr) && arr.some((x) => x.switch === true); } catch { return false; } })();
  check("③ PE 开: 干跑排队图 ComfySwitchNode 有 switch=true(PE 路选中)", swOn, String(drySW).slice(0, 400));
  pe.drySwitchOn = String(drySW).slice(0, 600);
  const classesOn = await promptClasses(page);
  log("[③ PE 开] 执行图 class 清单(信息性:前端编译图两臂恒在场):", String(classesOn).slice(0, 600));
  pe.classesOn = String(classesOn).slice(0, 800);

  const knownPidsPE = await historyPids();
  await sleep(500);
  const queuedPE = await queuePrompt(page);
  check("③ PE 开: queuePrompt 发出(真前端)", queuedPE === "queued", String(queuedPE));
  pe.queued = String(queuedPE);
  // 排队图取证:轮 /queue+/history 找新 pid,抓其 prompt[2] 内 switch=true + TextGenerate
  let pePid = null, pePromptBlob = null;
  const peDeadline = Date.now() + 90_000;
  while (Date.now() < peDeadline && !pePromptBlob) {
    const qs = await queueSnapshot();
    for (const q of [...(qs?.queue_running || []), ...(qs?.queue_pending || [])]) {
      const pid = Array.isArray(q) ? q[1] : q?.promptId ?? q?.prompt_id;
      if (pid && !knownPidsPE.has(pid)) {
        const blob = JSON.stringify(Array.isArray(q) ? q[2] : q?.prompt?.[2] || {});
        if (/TextGenerate/.test(blob)) { pePid = pid; pePromptBlob = blob; }
      }
    }
    if (!pePromptBlob) {
      try {
        const h = await (await fetch(`${ENGINE}/history`)).json();
        for (const [pid, e] of Object.entries(h)) {
          if (knownPidsPE.has(pid)) continue;
          const blob = JSON.stringify(e.prompt?.[2] || {});
          if (/TextGenerate/.test(blob)) { pePid = pid; pePromptBlob = blob; break; }
        }
      } catch { /* 尽力 */ }
    }
    await sleep(1500);
  }
  if (pePromptBlob) {
    const hasTrue = /"switch"\s*:\s*true/.test(pePromptBlob);
    const hasTG = /"class_type"\s*:\s*"TextGenerate"/.test(pePromptBlob);
    const hasPEClip = /qwen3\.5_9b_qwen_image_2\.1_pe_i2i_bf16\.safetensors/.test(pePromptBlob);
    pe.pid = pePid; pe.switchTrue = hasTrue; pe.textGenerateIn = hasTG; pe.peWeightIn = hasPEClip;
    check("③ PE 排队图: 新 pid 排队图 switch=true 且 TextGenerate+PE 权重在场(实弹排队)", hasTrue && hasTG && hasPEClip,
      `pid=${String(pePid).slice(0, 8)};switch=true=${hasTrue};TextGenerate=${hasTG};pe_i2i 权重=${hasPEClip}`);
  } else {
    check("③ PE 排队图: 新 pid 排队图 switch=true 且 TextGenerate+PE 权重在场(实弹排队)", false, "90s 内未在 /queue+/history 捕到新 pid 排队图");
  }
  // 断开:POST /interrupt 取消执行(不浪费整轮),等队列清空
  try {
    const r = await fetch(`${ENGINE}/interrupt`, { method: "POST" });
    pe.interruptStatus = r.status;
    log("③ /interrupt →", r.status);
  } catch (e) { pe.interruptError = String(e.message); log("③ /interrupt 失败:", e.message); }
  await sleep(3000);
  const qsAfter = await queueSnapshot();
  pe.queueAfterInterrupt = qsAfter ? { running: qsAfter.queue_running?.length ?? 0, pending: qsAfter.queue_pending?.length ?? 0 } : null;
  // 复位:false + 干跑取证 switch 全 false(布尔 widget 态)
  const rOff = await setWidgetById(page, 15, "switch", false);
  check("③ PE 复位: [15] ComfySwitchNode switch=false", String(rOff).startsWith("set:") && String(rOff).endsWith("false"), String(rOff).slice(0, 200));
  await sleep(900);
  const drySW2 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  const allFalse = (() => { try { const arr = JSON.parse(String(drySW2)); return Array.isArray(arr) && arr.every((x) => x.switch === false); } catch { return false; } })();
  check("③ PE 复位: 干跑排队图 ComfySwitchNode 布尔 switch 全 false(旁路复位)", allFalse, String(drySW2).slice(0, 400));
  pe.drySwitchAfterReset = String(drySW2).slice(0, 600);
  // 记录被打断拍的最终态(如实;interrupt 视为预期取消,不算失败)
  try {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    const e = h[pePid];
    pe.interruptedStatus = e ? { status: e.status?.status_str, completed: e.status?.completed, messages: JSON.stringify(e.status?.messages || []).slice(0, 1500) } : "pid 不在 history(队列内被取消)";
  } catch { /* 尽力 */ }
  report.cases["case-PE-roundtrip"] = pe;
  await page.screenshot("pe-roundtrip-done");

  // ── ④ console 留存与汇总 ─────────────────────────────────
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-edit-final.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("④ 全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-edit-final.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "edit-final-report.json"), JSON.stringify(report, null, 2));

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
  try { writeFileSync(join(E2E_DIR, "console-edit-final.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
