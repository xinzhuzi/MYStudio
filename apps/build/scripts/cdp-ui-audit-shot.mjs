/** UI 截图审计(保温会话版,09-15 提速裁定产物)。用法:
 *  node cdp-ui-audit-shot.mjs [--shots first-screen,local-models,comfy-canvas,custom]
 *                             [--out /tmp/ui-audit] [--resize 1200|0] [--reload]
 *                             [--nav "<js>"] [--ready "<js>"]  (custom 状态的导航/就绪表达式)
 *                             [--quit] [--force-relaunch] [--app <二进制路径>] [--port 9222]
 * 保温:CDP 可达则直接附着零冷启动;结束默认保持应用运行供下轮复用(要收摊加 --quit)。
 * 防打断:应用在跑但无 CDP(=用户正常使用中)时中止,需重启实例加 --force-relaunch。
 */
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const APP = opt("app", "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室");
const PORT = Number(opt("port", "9222"));
const OUT = opt("out", "/tmp/ui-audit");
const RESIZE = Number(opt("resize", "1200"));
const NAV = opt("nav", "");
const READY = opt("ready", "");
const SHOTS = (opt("shots", "first-screen") || "").split(",").map((s) => s.trim()).filter(Boolean);

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s] ${m}`);

const APPS = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(APPS);
const WebSocket = require(APPS + "node_modules/.pnpm/node_modules/ws");

// 内置状态注册表:navJs=导航表达式;readyJs=就绪表达式;engine=引擎门(慢是正常);startJs=等待期间尽力点击的开始钮
const SHOT_REGISTRY = {
  "first-screen": { readyJs: `document.querySelectorAll("button").length>5`, capMs: 60_000 },
  "local-models": {
    navJs: `[...document.querySelectorAll("button")].some(b=>{if((b.textContent||"").trim()==="本地模型"){b.click();return true}return false})`,
    readyJs: `!!document.querySelector("[data-comfy-canvas-start], webview")`,
    capMs: 120_000,
  },
  "comfy-canvas": {
    navJs: `[...document.querySelectorAll("button")].some(b=>{if((b.textContent||"").trim()==="本地模型"){b.click();return true}return false})`,
    readyJs: `!!document.querySelector("webview")`,
    startJs: `(()=>{const s=document.querySelector("[data-comfy-canvas-start]");if(s)s.click()})()`,
    engine: true, capMs: 720_000, settleMs: 4_000,
  },
};

const findPage = async () => {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return l.find((t) => t.type === "page" && !(t.url || "").startsWith("devtools") && !/^http:\/\/127\.0\.0\.1/.test(t.url || ""))
      || l.find((t) => t.type === "page" && !(t.url || "").startsWith("devtools"));
  } catch { return null; }
};

let page = await findPage();
if (page) {
  log(`warm attach(零冷启动): ${(page.url || "").slice(0, 70)}`);
} else {
  let running = false;
  try { execFileSync("pgrep", ["-f", "漫影工作室.app/Contents"], { stdio: "ignore" }); running = true; } catch {}
  if (running && !flag("force-relaunch")) {
    console.error("ABORT: 应用在运行但 CDP 不可达(疑似用户正常使用中)。确认重启实例请加 --force-relaunch。");
    process.exit(3);
  }
  log("cold boot: 清残留实例(仅此一轮)");
  for (const [c, a] of [
    ["osascript", ["-e", 'tell application id "com.manju2026.manying-studio" to quit']],
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-f", "漫影工作室/comfyui/ComfyUI/main.py"]],
  ]) { try { execFileSync(c, a, { stdio: "ignore" }); } catch {} }
  await sleep(1500);
  log(`cold boot: spawn 应用(CDP :${PORT})`);
  const child = spawn(APP, [`--remote-debugging-port=${PORT}`], { env: { ...process.env, MYSTUDIO_REMOTE_DEBUG: "1" }, detached: true, stdio: "ignore" });
  child.unref();
  const cap = Date.now() + 180_000;
  while (Date.now() < cap && !(page = await findPage())) await sleep(500);
  if (!page) { console.error("NO PAGE: 180s 内 CDP 页面未出现"); process.exit(2); }
  log("cold boot: CDP 页面已出现");
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let seq = 0; const pending = new Map(); const consoleLogs = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`cdp-timeout:${method}`)); }, 60_000);
  pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    consoleLogs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  }
  if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level)) {
    consoleLogs.push(`[log:${m.params.entry.level}] ` + (m.params.entry.text || "").slice(0, 200));
  }
});
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
await send("Runtime.enable"); await send("Log.enable");

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};
const pollJs = async (jsExpr, capMs, intervalMs, label, startJs) => {
  if (await evaluate(`(()=>{try{return ${jsExpr}}catch{return false}})()`)) return true;
  if (startJs) log(`wait ${label}: 引擎门,慢是正常(上限 ${Math.round(capMs / 1000)}s)`);
  const deadline = Date.now() + capMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (startJs) await evaluate(`(()=>{try{${startJs}}catch{}})()`);
    if (await evaluate(`(()=>{try{return ${jsExpr}}catch{return false}})()`)) return true;
    if (Date.now() - lastLog > 15_000) { log(`wait ${label} …`); lastLog = Date.now(); }
    await sleep(intervalMs);
  }
  return false;
};

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
const results = [];
const takeShot = async (name) => {
  let data = null;
  try { const r = await send("Page.captureScreenshot", { format: "png" }); data = r?.data; } catch {}
  const file = `${OUT}/${stamp}-${name}.png`;
  if (data) writeFileSync(file, Buffer.from(data, "base64"));
  else {
    log(`WARN: CDP 截图失败,回落 screencapture -x`);
    execFileSync("screencapture", ["-x", file], { stdio: "ignore" });
  }
  if (RESIZE > 0) { try { execFileSync("sips", ["-Z", String(RESIZE), file], { stdio: "ignore" }); } catch {} }
  log(`SHOT ${file} (${Math.round(statSync(file).size / 1024)}KB)`);
  results.push(file);
};

if (!(await pollJs(`document.querySelectorAll("button").length>5`, 60_000, 500, "first-screen"))) {
  log("WARN: 60s 内未见按钮,仍继续截图存档");
}
for (const name of SHOTS) {
  const s = name === "custom"
    ? { navJs: NAV || null, readyJs: READY || `true`, capMs: 60_000 }
    : SHOT_REGISTRY[name];
  if (!s) { log(`SKIP 未知 shot: ${name}(可选: ${Object.keys(SHOT_REGISTRY).join("/")})`); continue; }
  if (flag("reload")) {
    try { await send("Page.reload"); } catch {}
    await pollJs(`document.querySelectorAll("button").length>1`, 60_000, 500, "reload-ready");
  }
  if (s.navJs) log(`nav ${name}: ${await evaluate(s.navJs)}`);
  const ok = await pollJs(s.readyJs, s.capMs, s.engine ? 1000 : 500, name, s.startJs);
  log(`ready ${name}: ${ok}`);
  await sleep(s.settleMs ?? 600);
  await takeShot(name);
}

log(`DONE shots=${results.length} console异常=${consoleLogs.length}`);
if (consoleLogs.length) console.log("CONSOLE-TAIL " + consoleLogs.slice(-5).join(" || "));
results.forEach((f) => console.log("SHOT " + f));
if (flag("quit")) {
  try { execFileSync("osascript", ["-e", 'tell application id "com.manju2026.manying-studio" to quit'], { stdio: "ignore" }); } catch {}
  log("已退出应用(--quit)");
} else {
  log("应用保持运行(保温),下轮审计直接附着;要收摊加 --quit");
}
process.exit(0);
