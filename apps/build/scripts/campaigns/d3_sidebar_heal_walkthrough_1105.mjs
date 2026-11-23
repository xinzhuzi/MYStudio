#!/usr/bin/env node
/** 1105 根治役 UI 级验收:重进大模型→装载菊花出现/消失→webview 侧栏
 * 工作流列表渲染(无「取不到工作流(403)」)。
 * 用法: node d3_sidebar_heal_walkthrough_1105.mjs [--port 9223] [--keep]
 * 结束默认退出 App(走查不留进程);产物 verdict JSON + 截图于 ~/Downloads/d3-heal-1105/。
 */
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const APP = opt("app", "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室");
const PORT = Number(opt("port", "9223"));
const OUT = opt("out", join(homedir(), "Downloads/d3-heal-1105"));
const require = createRequire(fileURLToPath(new URL("../../", import.meta.url)));
const WebSocket = require("ws");
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const t0 = Date.now();
const verdict = { spinnerShown: false, spinnerGone: false, sidebarTabs: [], workflowItems: 0, errorText: null };

async function cdpReady() { try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; } }
async function launch() {
  try { execFileSync("osascript", ["-e", 'tell application "漫影工作室" to quit'], { timeout: 8000 }); } catch {}
  await sleep(2500);
  spawn(APP, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 60; i++) { if (await cdpReady()) return true; await sleep(1000); }
  return false;
}
async function pages() { return (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()); }
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let seq = 0; const pend = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pend.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description?.slice(0, 300) ?? ""} @expr=${expression.slice(0, 80)}`);
    return r.result?.value;
  };
  return { ws, send, ev };
}
async function shot(cdp, p) { writeFileSync(p, Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64")); log(`截图→${p}`); }

const clickText = (t) => `(() => { const b=[...document.querySelectorAll("button")].find(x=>(x.textContent||"").trim()===${JSON.stringify(t)}); if(!b) return false; b.click(); return true; })()`;

try {
  mkdirSync(OUT, { recursive: true });
  if (!(await cdpReady()) && !(await launch())) throw new Error("App 拉起后 CDP 60s 不可达");
  // 等首屏→进项目→大模型
  let page; for (let i = 0; i < 30; i++) {
    page = (await pages()).find((p) => p.type === "page" && !/devtools/i.test(p.url));
    if (page) break; await sleep(1000);
  }
  const host = await connect(page.webSocketDebuggerUrl);
  await host.send("Runtime.enable");
  for (let i = 0; i < 30; i++) { if (await host.ev(`document.querySelectorAll("button").length>5`)) break; await sleep(1000); }
  // 项目选择页→点首卡;已在项目内(会话恢复)→零动作
  const entered = await host.ev(`(() => { const c=document.querySelector(".dashboard-project-card"); if(!c) return false; c.click(); return true; })()`);
  log(entered ? "项目选择页→点首卡" : "已在项目内(会话恢复)");
  if (entered) await sleep(2500);
  if (!(await host.ev(clickText("大模型")))) throw new Error("找不到「大模型」按钮(既非项目页也非项目内?)");
  log("已进大模型,等菊花→webview→侧栏…");

  // 菊花:出现(3s 内)且最终消失(90s 内)
  for (let i = 0; i < 6; i++) { if (await host.ev(`!!document.querySelector("[data-comfy-canvas-loading]")`)) { verdict.spinnerShown = true; break; } await sleep(500); }
  for (let i = 0; i < 36; i++) { if (!(await host.ev(`!!document.querySelector("[data-comfy-canvas-loading]")`))) { verdict.spinnerGone = true; break; } await sleep(2500); }
  log(`菊花: 出现=${verdict.spinnerShown} 消失=${verdict.spinnerGone}`);

  // webview target(ComfyUI 前端独立渲染进程)
  let wv; for (let i = 0; i < 40; i++) {
    wv = (await pages()).find((p) => /17000|myScope|comfy/i.test(p.url) && p.webSocketDebuggerUrl);
    if (wv) break; await sleep(1500);
  }
  if (!wv) throw new Error("40s 未见 ComfyUI webview CDP target");
  const web = await connect(wv.webSocketDebuggerUrl);
  await web.send("Runtime.enable");
  // 侧栏:等列表渲染(最多 60s),抓 tab 标签/条目数/错误文案
  for (let i = 0; i < 24; i++) {
    const probe = await web.ev(`(() => {
      const text = document.body.innerText || "";
      const items = document.querySelectorAll("[class*=sidebar] li, [class*=workflow] [class*=item], .ms-sidebar [class*=row]").length;
      const tabs = [...document.querySelectorAll("[class*=sidebar] [class*=tab], [class*=sidebar] button")].map(b => (b.textContent||"").trim()).filter(t => t && t.length <= 6).slice(0, 8);
      return { hasError: text.includes("取不到工作流"), items, tabs, text150: text.slice(0,150) };
    })()`);
    verdict.sidebarTabs = probe.tabs;
    verdict.workflowItems = probe.items;
    if (probe.items > 0 && !probe.hasError) break;
    if (probe.hasError) { verdict.errorText = probe.text150; break; }
    await sleep(2500);
  }
  await shot(host, join(OUT, "d3-host.png"));
  try { await shot(web, join(OUT, "d3-webview.png")); } catch {}
  if (argv.includes("--keep")) { log("keep:App 保留运行"); } else { try { execFileSync("osascript", ["-e", 'tell application "漫影工作室" to quit'], { timeout: 8000 }); } catch {} log("App 已退出(还原现场)"); }
  writeFileSync(join(OUT, "d3-verdict.json"), JSON.stringify(verdict, null, 2));
  console.log("VERDICT:", JSON.stringify(verdict, null, 2));
  const pass = verdict.spinnerShown && verdict.spinnerGone && verdict.workflowItems > 0 && !verdict.errorText;
  console.log(pass ? "PASS: 菊花+侧栏自愈全绿" : "FAIL: 见 verdict");
  process.exit(pass ? 0 : 1);
} catch (e) {
  verdict.fatal = String(e?.message ?? e);
  try { writeFileSync(join(OUT, "d3-verdict.json"), JSON.stringify(verdict, null, 2)); } catch {}
  console.error("FAIL:", verdict.fatal); process.exit(1);
}
