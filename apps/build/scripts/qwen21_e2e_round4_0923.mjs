#!/usr/bin/env node
/**
 * Qwen-Image-2.1 道劫 PRO 装配件 实弹 E2E · round 4(09-23):
 * 真前端实测 apps/.../1_文生图/qwen21-daojie-t2i-pro.json(规范化装配版:
 * 底座四选一链 [17]-[20]×[21]-[23] + 主体句换槽 [24]×[25]×[26] + PE/RGBA 双开关承袭)。
 *
 * 相对 round3(qwen21_e2e_round3_0923.mjs)的差异:被测件换 pro 装配件,四拍:
 *   ① 干跑:载入 graphToPrompt 无异常;
 *   ② 默认底座(全开关 false=人物首条)出图 1 张(1024²,直写路);
 *   ③ [24] 主体句槽换库中示例主体句(人物-云台 例一 B 槽)+ [25] 拼装开关 true,再出图
 *     (验证 [26] RegexReplace 装配结构可用);
 *   ④ N 选一切换:[21] true → 底座②场景,[24] 同步换场景示例 B 槽句,再出图。
 * 产物落 round4/;节点定位恒按 type+title 片段(勿按 JSON id)。
 *
 * 用法:node apps/build/scripts/qwen21_e2e_round4_0923.mjs
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
const CDP_PORT = Number(process.env.CDP_PORT || 9344);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qwen21-e2e-0923/round4";
const WF_PRO = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i-pro.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qwen21-r4-pro-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900_000); // 15 min/张(bf16 20B CLIP 已在 ② 首载)

// 库示例主体句(docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md):
// ③=人物-云台执剑立绘 例一 B 槽(:64 块);④=场景-山门暮霭空镜 例一 B 槽(:182 块)
const SUBJ_CHAR_B1 = "she stands full-body on the flat crown of the terrace, right hand resting on the pommel of an undrawn straight sword, gaze lifted past the left edge of the frame";
const SUBJ_SCENE_B1 = "a timber gate of two posts and a heavy lintel stands half charred at the head of a broken stair, the left post blackened to its crown, the right door gone, the lintel cracked through";

// 拍指纹:从 history 全量 prompt[2] 里找含本拍特征串的 prompt
const SHOT_SIGS = {
  shot2: "solitary cultivator in layered robes",            // 人物首条底座锚定句
  shot3: "right hand resting on the pommel of an undrawn straight sword", // 换槽句进 B 槽
  shot4: "an abandoned mountain gate at dusk",              // 场景底座锚定句
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

/** 取 [25] 输出线最终文本(经 [27] easy showAnything 预览节点拿最终 prompt 的一部分不可靠,
 *  改用 graphToPrompt 后从 [14] on_false 上游 [25] 的 STRING 输入取证)。 */
function assemblyText(page) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'easy showAnything');
    return n ? 'found' : 'missing';
  })()`);
}

/** 一拍通用:设参 → queuePrompt → 等 history → 取回验证。 */
async function genShot(page, tag, sig, opts = {}) {
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
  // easy showAnything [27] 的 text 输出(装配预览最终文本)
  const texts = [];
  for (const o of Object.values(hist.outputs || {})) if (o && Array.isArray(o.text)) texts.push(...o.text);
  if (texts.length) {
    report.assemblyPreview = texts.sort((a, b) => b.length - a.length)[0];
    writeFileSync(join(E2E_DIR, `${tag}-final-prompt.txt`), report.assemblyPreview);
    check(`${tag}: 装配预览文本捕获([27] showAnything)`, true, `${report.assemblyPreview.length} 字符 → ${tag}-final-prompt.txt`);
  } else {
    check(`${tag}: 装配预览文本捕获([27] showAnything)`, false, "history outputs 无 text 字段");
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
  const opened = await loadWorkflow(page, "daojie-t2i-pro", graphJson);
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
  const dryDigest = await promptDigest(page, "RegexReplace", ["pattern", "replace"]);
  log("[① 干跑] RegexReplace 队列图取证:", String(dryDigest).slice(0, 400));

  // 默认态取证:四级开关全 false + [24] 默认预置句
  for (const d of [
    { classType: "ComfySwitchNode", fields: ["switch"] },
    { classType: "RegexReplace", fields: ["pattern", "replace"] },
    { classType: "TextEncodeQwenImage21", fields: ["prompt"] },
  ]) {
    const dg = await promptDigest(page, d.classType, d.fields);
    log(`[默认态] 队列图取证 ${d.classType}:`, String(dg).slice(0, 600));
  }
  await page.screenshot("pro-1-loaded-default");

  // ── ② 默认底座出图(1024²;人物首条,全开关 false,直写路) ─────
  const steps2 = [
    { type: "ResolutionSelector", widget: "aspect_ratio", value: "1:1 (Square)" },
    { type: "ResolutionSelector", widget: "megapixels", value: 1.0 },
  ];
  for (const s of steps2) {
    const r = await setWidget(page, s.type, "", s.widget, s.value);
    check(`② 改参 ${s.type}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(800);
  const emptyDigest = await promptDigest(page, "EmptyLatentImage", ["width", "height"]);
  log("[②] EmptyLatentImage 队列图取证:", String(emptyDigest).slice(0, 200));
  report.cases.shot2 = await genShot(page, "pro-2-default-base", SHOT_SIGS.shot2, { expectW: 1024, expectH: 1024 });
  await sleep(1200);
  await page.screenshot("pro-2-done");

  // ── ③ 换主体句槽(库示例)+ 拼装开关 true,再出图 ─────────────
  const steps3 = [
    { type: "StringConstant", titlePart: "主体句区", widget: "string", value: SUBJ_CHAR_B1 },
    { type: "ComfySwitchNode", titlePart: "拼装开关", widget: "switch", value: true },
  ];
  for (const s of steps3) {
    const r = await setWidget(page, s.type, s.titlePart, s.widget, s.value);
    check(`③ 改参 ${s.type}/${s.titlePart}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(800);
  const asm3 = await promptDigest(page, "RegexReplace", ["pattern", "replace"]);
  log("[③] RegexReplace 队列图取证(换槽后):", String(asm3).slice(0, 500));
  report.cases.shot3 = await genShot(page, "pro-3-swap-subject", SHOT_SIGS.shot3, { expectW: 1024, expectH: 1024 });
  await sleep(1200);
  await page.screenshot("pro-3-done");

  // ── ④ N 选一切换:[21] true → 底座②场景;[24] 同步换场景示例 B 句 ──
  const steps4 = [
    { type: "ComfySwitchNode", titlePart: "底座选型①", widget: "switch", value: true },
    { type: "StringConstant", titlePart: "主体句区", widget: "string", value: SUBJ_SCENE_B1 },
  ];
  for (const s of steps4) {
    const r = await setWidget(page, s.type, s.titlePart, s.widget, s.value);
    check(`④ 改参 ${s.type}/${s.titlePart}.${s.widget}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(800);
  const asm4 = await promptDigest(page, "RegexReplace", ["pattern", "replace"]);
  log("[④] RegexReplace 队列图取证(切场景后):", String(asm4).slice(0, 500));
  report.cases.shot4 = await genShot(page, "pro-4-switch-base", SHOT_SIGS.shot4, { expectW: 1024, expectH: 1024 });
  await sleep(1200);
  await page.screenshot("pro-4-done");

  // ── console 留存与汇总 ─────────────────────────────────────
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-pro.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-pro.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "round4-pro-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ round4(pro 装配件)全部通过" : "❌ round4(pro 装配件)存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-pro.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
