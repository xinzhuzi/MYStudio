#!/usr/bin/env node
/**
 * Qwen-Image-2.1 道劫 PRO 九型分层装配版 实弹 E2E · round 6(09-23):
 * 真前端实测 apps/.../1_文生图/qwen21-daojie-t2i-pro.json(九型分层装配版:
 * 九底座 [17]-[23][25][26] × 八级 ComfySwitchNode 级联 [28]-[35] +
 * [24] 主体句槽 × [36] 通用锁层 × [37][38] StringConcatenate 装配 + [27] 预览)。
 *
 * 相对 round4 的差异:被测件换九型分层装配版,三拍(全 1024²):
 *   ① 默认人物型出图(九开关全 false → 底座①人物,[24] 默认=库人物例一);
 *   ② [28] 选型① true → 场景型(验九路级联选底座②);
 *   ③ [24] 主体句槽换库中场景示例句(例一)再出图(验装配链)。
 * 装配取证:每拍 history 里 [27] easy showAnything 的最终装配全文,
 * 并与本地按工作流 JSON 重建的期望装配文本逐字节比对(prompt[2] 含全部九底座
 * 字符串,不能作选型证明;服务端执行出的 [27] 文本才是级联/装配的硬证据)。
 * 产物落 round6/;节点定位恒按 type+title 片段(勿按 JSON id)。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_round6_0923.mjs
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

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9346);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qwen21-e2e-0923/round6";
const WF_PRO = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i-pro.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qwen21-r6-pro-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900_000); // 15 min/张(bf16 20B 首拍含载入)

// 库示例主体句(docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md):
// 场景-基础 例一(《道劫_九型主体句示例》§2 原文,:123)
const SUBJ_SCENE_EX1 = "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。";

// 拍指纹(仅用于在 history 新 pid 里认领本拍;选型/装配的硬证明靠 [27] 文本比对)
const SHOT_SIGS = {
  shot1: "她立于山门石阶最上一级",   // [24] 默认(库人物例一)
  shot2: "空镜场景，前、中、远三层分开", // 底座②场景开头(级联切②后 [27] 应含)
  shot3: "九根断裂的石柱围成半圆",     // 换槽句(库场景例一)
};

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

/** 一拍通用:queuePrompt → 等 history → 取回验证 + [27] 装配全文比对。 */
async function genShot(page, tag, sig, expectedAssembly, opts = {}) {
  const report = { tag };
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  await sleep(800);
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
  if (queued !== "queued") throw new Error(`${tag} queuePrompt 失败: ${queued}`);

  const hist = await waitHistory((blob) => blob.includes(sig), { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  report.secs = secs;
  report.pid = hist.pid;
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    report.error = hist.error;
    return report;
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const outPath = join(E2E_DIR, `${tag}-${stamp()}.png`);
  const buf = await fetchView(saveImg, outPath);
  const magic = await pngMagic(buf);
  const size = await sipsSize(outPath);
  check(`${tag}: PNG 魔数`, magic === true, outPath);
  check(`${tag}: sips 尺寸${opts.expectW ? ` ${opts.expectW}x${opts.expectH}` : ""}`,
    size.w === opts.expectW && size.h === opts.expectH, `${size.w}x${size.h}`);
  check(`${tag}: 引擎出图(/view 取回)`, buf.length > 50_000,
    `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${String(hist.pid).slice(0, 8)})`);
  report.outPath = outPath;
  report.engineFile = saveImg.filename;
  report.size = size;
  report.hist = { outputs: hist.outputs, messages: hist.messages };
  // [27] easy showAnything 服务端执行出的最终装配全文(装配链硬证据)
  const texts = [];
  for (const o of Object.values(hist.outputs || {})) if (o && Array.isArray(o.text)) texts.push(...o.text);
  if (texts.length) {
    const finalText = texts.sort((a, b) => b.length - a.length)[0];
    report.assemblyText = finalText;
    writeFileSync(join(E2E_DIR, `${tag}-final-prompt.txt`), finalText);
    check(`${tag}: 装配全文捕获([27] showAnything)`, true, `${finalText.length} 字符 → ${tag}-final-prompt.txt`);
    // 与本地按工作流 JSON 重建的期望装配逐字节比对(prompt[2] 含全部九底座,不构成选型证明)
    if (expectedAssembly != null) {
      const eq = finalText === expectedAssembly;
      check(`${tag}: 装配全文 == 期望(${opts.assemblyDesc || ""})`, eq,
        eq ? `${finalText.length} 字符逐字节一致` :
          `不一致:实际头120=${finalText.slice(0, 120)};期望头120=${expectedAssembly.slice(0, 120)};len=${finalText.length}/${expectedAssembly.length}`);
    }
  } else {
    check(`${tag}: 装配全文捕获([27] showAnything)`, false, "history outputs 无 text 字段");
  }
  return report;
}

async function main() {
  const report = { engine: ENGINE, wf: WF_PRO, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF_PRO)) { console.error("工作流缺失:", WF_PRO); process.exit(2); }
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  // 本地重建期望装配(真源=工作流 JSON;[37]=[24]+"\n"+级联, [38]=[37]+"\n"+[36])
  const wf = JSON.parse(readFileSync(WF_PRO, "utf8"));
  const nm = {}; for (const n of wf.nodes) nm[n.id] = n;
  const strOf = (id) => nm[id].widgets_values[0];
  const BASE1 = strOf(17), BASE2 = strOf(18), LOCK = strOf(36), DEF_SUBJ = strOf(24);
  const EXPECT = {
    shot1: `${DEF_SUBJ}\n${BASE1}\n${LOCK}`,
    shot2: `${DEF_SUBJ}\n${BASE2}\n${LOCK}`,
    shot3: `${SUBJ_SCENE_EX1}\n${BASE2}\n${LOCK}`,
  };
  log(`期望装配长度: 人物=${EXPECT.shot1.length} 场景=${EXPECT.shot2.length} 换槽=${EXPECT.shot3.length}`);

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF_PRO, "utf8"));
  const nodeCount = graphJson.nodes.length;
  const opened = await loadWorkflow(page, "daojie-t2i-pro-r6", graphJson);
  check("pro: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(1500);

  // ── ① 干跑:graphToPrompt 无异常 ─────────────────────────────
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
    catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("① 干跑: graphToPrompt 无异常", String(dry).startsWith("ok:"), String(dry).slice(0, 300));
  const dryConcat = await promptDigest(page, "StringConcatenate", ["string_a", "string_b", "delimiter"]);
  log("[① 干跑] StringConcatenate 队列图取证:", String(dryConcat).slice(0, 400));

  // 默认态取证:九级开关全 false + [24] 默认预置句
  for (const d of [
    { classType: "ComfySwitchNode", fields: ["switch"] },
    { classType: "TextEncodeQwenImage21", fields: ["prompt"] },
  ]) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[默认态] 队列图取证 ${d.classType}:`, String(dg).slice(0, 700));
  }
  await page.screenshot("r6-1-loaded-default");

  // ── 拍① 默认人物型出图(1024²;九开关全 false → 底座①人物,直写路) ──
  const steps1 = [
    { type: "ResolutionSelector", titlePart: "", widget: "aspect_ratio", value: "1:1 (Square)" },
    { type: "ResolutionSelector", titlePart: "", widget: "megapixels", value: 1.0 },
  ];
  for (const s of steps1) {
    const r = await setWidget(page, s.type, s.titlePart, s.widget, s.value);
    check(`拍① 改参 ${s.type}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(800);
  const latent1 = await promptDigest(page, "EmptyLatentImage", ["width", "height"]);
  log("[拍①] EmptyLatentImage 队列图取证:", String(latent1).slice(0, 200));
  const sw1 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  log("[拍①] 全开关态(应全 false):", String(sw1).slice(0, 700));
  report.cases.shot1 = await genShot(page, "r6-1-default-renwu", SHOT_SIGS.shot1,
    EXPECT.shot1, { expectW: 1024, expectH: 1024, assemblyDesc: "[24]默认人物例一+底座①人物+[36]锁层" });
  await sleep(1200);
  await page.screenshot("r6-1-done");

  // ── 拍② 型开关切场景型([28] 选型① true → 底座②场景;验九路级联) ──
  const r2 = await setWidget(page, "ComfySwitchNode", "选型①", "switch", true);
  check("拍② 改参 ComfySwitchNode/选型①.switch=true", String(r2).startsWith("set:"), String(r2).slice(0, 300));
  if (!String(r2).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  await sleep(800);
  const sw2 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  log("[拍②] 全开关态(选型①应 true):", String(sw2).slice(0, 700));
  report.cases.shot2 = await genShot(page, "r6-2-switch-changjing", SHOT_SIGS.shot2,
    EXPECT.shot2, { expectW: 1024, expectH: 1024, assemblyDesc: "[24]默认句+底座②场景+[36]锁层(九路级联)" });
  await sleep(1200);
  await page.screenshot("r6-2-done");

  // ── 拍③ [24] 主体句槽换库中场景示例句(例一)再出图(验装配链) ──
  const r3 = await setWidget(page, "StringConstant", "主体句槽", "string", SUBJ_SCENE_EX1);
  check("拍③ 改参 StringConstant/主体句槽.string=库场景例一", String(r3).startsWith("set:"), String(r3).slice(0, 300));
  if (!String(r3).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  await sleep(800);
  const sw3 = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  log("[拍③] 全开关态(选型①仍 true):", String(sw3).slice(0, 700));
  report.cases.shot3 = await genShot(page, "r6-3-swap-subject", SHOT_SIGS.shot3,
    EXPECT.shot3, { expectW: 1024, expectH: 1024, assemblyDesc: "[24]库场景例一+底座②场景+[36]锁层(装配链)" });
  await sleep(1200);
  await page.screenshot("r6-3-done");

  // ── console 留存与汇总 ─────────────────────────────────────
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-r6.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-r6.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "round6-pro-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ round6(九型分层装配版)全部通过" : "❌ round6(九型分层装配版)存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-r6.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
