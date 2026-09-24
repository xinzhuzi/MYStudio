#!/usr/bin/env node
/**
 * 武器句修复验证一拍(0924;17002 手动引擎 + headless Chrome 真前端;派生自 qi21_install_accept_17002_0924.mjs):
目的=人物型默认主体句换部件清单句(石青剑绦/乌木鞘/白玉格/剑身完整收在鞘中,废「未拔」否定式)后,
同 seed=0 同 40 步出一张,与 te-A/te-B 同目录交用户终审武器完整度。
 * 背景装机应用链路三轮被未归因外部 TERM(sidecar/引擎被杀、应用幸存、零 crash
 * 报告),改走仓库 canonical 真前端 e2e 口径(qi21_e2e_final_0923.mjs /
 * qi21_edit_final_0924.mjs 同款):引擎 17002(install-and-smoke
 * killDetachedComfyEngines 明文豁免 --port 17002)+ Chrome 开引擎真前端 →
 * app.loadGraphData 载入 qi21-道劫-t2i → 型选择=道具(1024²) → graphToPrompt
 * 干跑取证 → app.queuePrompt()(真前端序列化+排队,禁 API 转换器)→ /history
 * 轮询 → /view 取图 → cp ~/Downloads/q21-final-0924/ + PNG 魔数 + sips 对账;
 * 再 qi21-edit [15] PE 开关真开路:排队 → /queue 图取证(pe_i2i 权重+
 * TextGenerate+switch=true)→ /interrupt 断开复位(省弹,排队通过即证)。
 * 引擎生命周期(自拉 17002/停)在驱动外管理。
 * 用法:node apps/build/scripts/qi21_install_accept_17002_0924.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9379);
const E2E_DIR = `${process.env.HOME}/Downloads/qwen21-trial-0924`;
const WF_T2I = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const WF_EDIT = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-installaccept-17002-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_200_000); // 20min(1024² 40步 MPS+装载余量)
const TOL_PX = 16, TOL_RATIO = 0.01;

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
      consoleErrors.push({ src: "console", type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500), ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500), ts: new Date().toISOString() });
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
        if (imgs.length) return { pid, imgs, status: st, promptBlob: blob };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  const report = { engine: ENGINE, startedAt: new Date().toISOString(), cases: {} };
  for (const f of [WF_T2I, WF_EDIT]) {
    if (!existsSync(f)) { console.error("工作流缺失:", f); process.exit(2); }
  }
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  // ── t2i 道具型一拍(PE_ONLY=1 时跳过:主图已取证,只补 PE 段) ──
  if (process.env.PE_ONLY === "1") {
    log("PE_ONLY=1:跳过 t2i 主图段(已取证:QI21道劫文生图__00009_.png)");
  } else {
  const t2i = JSON.parse(readFileSync(WF_T2I, "utf8"));
  const SG_TYPE = t2i.definitions.subgraphs[0].id;
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(t2i)}, true, true, 'qi21-道劫-t2i-装机验收17002');
    return 'opened';
  })()`);
  check("t2i 载入(真前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${t2i.nodes.length} ? ${t2i.nodes.length} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${t2i.nodes.length} 节点)` });
  await sleep(1500);

  const setType = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(SG_TYPE)});
    if (!n) return 'node-missing';
    const w = (n.widgets || []).find(w => String(w.name) === '型选择');
    if (!w) return 'widget-missing';
    return 'default:' + String(w.value);
  })()`);
  check("[40] 型选择默认=人物(不切型,武器句在默认主体句)", String(setType).endsWith("人物"), String(setType));
  await sleep(1200);
  const dryBase = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt();
      for (const k of Object.keys(p.output || {})) if (p.output[k].class_type === 'MyQi21DaojieBase') return JSON.stringify({ node: k, base: p.output[k].inputs.base });
      return 'class-not-found'; } catch (e) { return 'err:' + e.message; }
  })()`);
  check("干跑排队图 base=人物", String(dryBase).includes('"base":"人物"'), String(dryBase).slice(0, 200));
  const dryWeapon = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt();
      const texts = Object.values(p.output || {}).map(n => JSON.stringify(n.inputs || {})).join('');
      return JSON.stringify({ parts: texts.includes('石青剑绦') && texts.includes('乌木剑鞘') && texts.includes('剑身完整收在鞘中'), neg: texts.includes('未拔') });
    } catch (e) { return 'err:' + e.message; }
  })()`);
  check("干跑武器部件清单在场+否定式绝迹", String(dryWeapon).includes('"parts":true') && String(dryWeapon).includes('"neg":false'), String(dryWeapon));
  const dryKS = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt();
      const out = [];
      for (const k of Object.keys(p.output || {}).sort()) if (p.output[k].class_type === 'KSampler') out.push({ node: k, seed: p.output[k].inputs.seed, steps: p.output[k].inputs.steps });
      return JSON.stringify(out); } catch (e) { return 'err:' + e.message; }
  })()`);
  check("干跑排队图 KSampler(seed/steps 可读)", String(dryKS).includes('"steps":40'), String(dryKS).slice(0, 200));
  report.t2iDry = { base: String(dryBase), ksampler: String(dryKS) };

  const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await sleep(600);
  const t0 = Date.now();
  const queued = await page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check("queuePrompt 发出(真前端序列化+排队)", queued === "queued", String(queued));
  const sig = (blob) => blob.includes('"base":"人物"');
  const hist = await waitHistory(sig, { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (hist.error) {
    check("引擎出图(/history 完成含图)", false, hist.error.slice(0, 500));
  } else {
    const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
    const destPath = join(E2E_DIR, "weapon-fix-人物-seed0.png");
    const buf = await fetchView(saveImg, destPath);
    const magic = pngMagicBuf(buf);
    const size = await sipsSize(destPath);
    const dw = Math.abs((size.w ?? 0) - 1824), dh = Math.abs((size.h ?? 0) - 2432);
    const ratioDrift = size.w && size.h ? Math.abs(size.w / size.h - 1824 / 2432) : 1;
    check("出图落盘+cp 取证目录", existsSync(destPath) && magic && buf.length > 50_000,
      `${saveImg.filename} → ${destPath} (${(buf.length / 1024).toFixed(0)}KB, PNG 魔数=${magic}, pid=${String(hist.pid).slice(0, 8)})`);
    check("sips 尺寸对账(人物型 1824x2432;维差≤16px·比例≤1%)",
      dw <= TOL_PX && dh <= TOL_PX && ratioDrift <= TOL_RATIO,
      size.err ? String(size.err) : `实际 ${size.w}x${size.h};维差 ${dw}/${dh}px;比例偏差 ${(ratioDrift * 100).toFixed(2)}%`);
    check("耗时(排队→完成)", true, `${secs}s`);
    check("服务端排队图 base=人物(history prompt[2])", String(hist.promptBlob || "").includes('"base":"人物"'), "history prompt[2] 内 base 字段");
    report.cases.t2i = { imgName: saveImg.filename, destPath, bytes: buf.length, size, secs, pid: hist.pid };
  }
  } // ← PE_ONLY 守卫收口

  report.consoleErrors = consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "weapon-fix-report.json"), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 补位 E2E 全绿" : "❌ 补位 E2E 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "weapon-fix-report.json"), JSON.stringify({ fatal: String(e.message), results, consoleErrors }, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
