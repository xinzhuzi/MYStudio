#!/usr/bin/env node
/** 1104 交接#3 A1 备胎弹窗实弹走查(一次性运维)。
 *
 * 前提:Windows 引擎已被杀(remote 192.168.0.101:17000 不可达),remote-engine.json
 * 指向远端。流程:重启本 App(带 CDP 口)→ 大模型 → 悬浮球切「生图」→ 加速档
 * (免 checkpoint——引擎死时模型列表为空也不拦)→ 填提示词 → 生成 → 等
 * [data-local-model-fallback-dialog] 弹出 → 截图 → 断言三键(关闭/重试/切换到
 * 本机引擎)→ 点关闭(不动引擎路由)→ 复盘截图。
 *
 * 用法: node a1_fallback_dialog_walkthrough_1104.mjs [--port 9223]
 *   [--out ~/...输出目录] [--keep-app](不退出 App)
 * 产出: out/a1-dialog.png / a1-after-close.png / a1-verdict.json
 */
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const APP = opt("app", "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室");
const PORT = Number(opt("port", "9223"));
const OUT = opt("out", join(homedir(), "Downloads/a1-fallback-1104"));

const require = createRequire(fileURLToPath(new URL("../../", import.meta.url)));
const WebSocket = require("ws");

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s] ${m}`);
const verdict = { steps: [], dialogShown: false, buttons: {}, error: null };

async function cdpReady() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return res.ok;
  } catch { return false; }
}

async function launchApp() {
  // 温柔退现有实例( userData 落盘)再带 CDP 口拉起
  try { execFileSync("osascript", ["-e", 'tell application "漫影工作室" to quit'], { timeout: 8000 }); } catch { /* 未在跑 */ }
  await sleep(2500);
  spawn(APP, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpReady()) return true;
    await sleep(1000);
  }
  return false;
}

async function findPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const pages = await res.json();
  return pages.find((p) => p.type === "page" && !/devtools/i.test(p.url));
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let seq = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, { awaitPromise = false } = {}) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(`eval 异常: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description?.slice(0, 200) ?? ""}`);
    return r.result?.value;
  };
  return { ws, send, evalJs };
}

async function shot(cdp, path) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path, Buffer.from(r.data, "base64"));
  log(`截图 → ${path}`);
}

async function waitFor(cdp, expr, label, timeoutMs = 60000, intervalMs = 800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cdp.evalJs(expr)) return true;
    await sleep(intervalMs);
  }
  throw new Error(`等待超时: ${label} (${timeoutMs}ms)`);
}

const clickByText = (text) => `(() => {
  const btn = [...document.querySelectorAll("button")].find(b => (b.textContent || "").trim() === ${JSON.stringify(text)});
  if (!btn) return false; btn.click(); return true;
})()`;

const CLICK_SELECTOR = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false; el.click(); return true;
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  log(`A1 备胎弹窗走查(输出 ${OUT})`);
  if (!(await cdpReady())) {
    log("CDP 不可达 → 重启 App(带调试口)");
    if (!(await launchApp())) throw new Error("App 拉起后 CDP 60s 不可达");
    log("App 已起,CDP 就绪");
  }
  const page = await findPage();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront");

  // 1) 等首屏就绪
  await waitFor(cdp, `document.querySelectorAll("button").length > 5`, "首屏按钮", 60000);
  verdict.steps.push("首屏就绪");

  // 1.5) 首屏若是项目选择页(dashboard-project-card)→点首卡进项目
  //      (大模型导航在项目内;无卡=已直入项目,零动作)
  const enteredProject = await cdp.evalJs(`(() => {
    const card = document.querySelector(".dashboard-project-card");
    if (!card) return false; card.click(); return true;
  })()`);
  if (enteredProject) {
    verdict.steps.push("项目选择页→点首卡进项目");
    await sleep(2500);
  }

  // 2) 主导航 → 大模型
  if (!(await cdp.evalJs(clickByText("大模型")))) throw new Error("找不到「大模型」导航钮");
  await waitFor(cdp, `!!document.querySelector("[data-comfy-workspace]")`, "大模型工作区", 30000);
  verdict.steps.push("大模型模块打开");

  // 3) 切「生图」页签:先直接找按钮;找不到则点悬浮球开导航再找
  if (!(await cdp.evalJs(clickByText("生图")))) {
    await cdp.evalJs(`(() => {
      const orb = [...document.querySelectorAll("button,[role=button]")].find(b => ((b.getAttribute("aria-label") || "")).startsWith("导航"));
      if (orb) { orb.click(); return true; } return false;
    })()`);
    await sleep(1200);
    if (!(await cdp.evalJs(clickByText("生图")))) throw new Error("悬浮球菜单里也找不到「生图」");
  }
  await waitFor(cdp, `!!document.querySelector("[data-local-model-studio]")`, "漫影生图面板", 30000);
  verdict.steps.push("生图面板打开");

  // 4) 加速档(引擎死时模型列表空,标准档会被 checkpoint 守卫拦)
  if (!(await cdp.evalJs(CLICK_SELECTOR("[data-local-model-mode-fast]")))) throw new Error("加速档按钮缺席");
  await sleep(600);
  verdict.steps.push("切加速档(免 checkpoint)");

  // 5) 填提示词(React 受控组件:native setter + input 事件)
  await cdp.evalJs(`(() => {
    const ta = document.querySelector("[data-local-model-prompt]");
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "A1 备胎弹窗实弹验证——远端引擎不可达时应弹窗");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  verdict.steps.push("提示词已填");

  // 6) 杀引擎态下点生成 → 等弹窗(桥探活+令牌链路,给足 150s)
  if (!(await cdp.evalJs(CLICK_SELECTOR("[data-local-model-generate]")))) throw new Error("生成按钮缺席");
  log("已点生成,等备胎弹窗(引擎已杀,预期 bridge-unreachable)…");
  const shown = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 150_000) {
      if (await cdp.evalJs(`(() => {
        const d = document.querySelector("[data-local-model-fallback-dialog]");
        return !!d && !!(d.offsetParent || d.getClientRects().length);
      })()`)) return true;
      await sleep(1000);
    }
    return false;
  })();
  verdict.dialogShown = shown;
  if (!shown) {
    await shot(cdp, join(OUT, "a1-no-dialog.png"));
    throw new Error("150s 内备胎弹窗未出现(截图 a1-no-dialog.png 留证)");
  }
  await shot(cdp, join(OUT, "a1-dialog.png"));
  verdict.steps.push("弹窗出现并截图");

  // 7) 断言三键在场
  verdict.buttons = await cdp.evalJs(`(() => ({
    close: !!document.querySelector("[data-local-model-fallback-close]"),
    retry: !!document.querySelector("[data-local-model-fallback-retry]"),
    swit: !!document.querySelector("[data-local-model-fallback-switch]"),
  }))()`);
  verdict.steps.push(`三键断言: ${JSON.stringify(verdict.buttons)}`);

  // 8) 点「关闭」(不动引擎路由——切本机会改 remote-engine.json,不碰)
  await cdp.evalJs(CLICK_SELECTOR("[data-local-model-fallback-close]"));
  await sleep(800);
  await shot(cdp, join(OUT, "a1-after-close.png"));
  verdict.steps.push("已点关闭(引擎路由未动)");

  cdp.ws.close();
  log("走查完成");
  writeFileSync(join(OUT, "a1-verdict.json"), JSON.stringify(verdict, null, 2));
  console.log("VERDICT:", JSON.stringify(verdict, null, 2));
}

try {
  await main();
  process.exit(0);
} catch (e) {
  verdict.error = String(e.message ?? e);
  try { writeFileSync(join(OUT, "a1-verdict.json"), JSON.stringify(verdict, null, 2)); } catch {}
  console.error("FAIL:", verdict.error);
  process.exit(1);
}
