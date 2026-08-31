// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * dev 模式挂载期全量控制台捕获:导航进图片工作室画布,收集 React Flow dev
 * 告警定位连线不渲染根因。前置:MYSTUDIO_REMOTE_DEBUG=1 npm run dev 已启动。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const events = [];
let ws = null;
let messageId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}
async function waitFor(fn, timeoutMs = 20000, label = "") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`waitFor timeout ${label}`);
}

async function main() {
  // 等 dev server 的 CDP 端口
  let list;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      list = await (await fetch("http://127.0.0.1:9222/json")).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!list) { console.log("NO-CDP: dev server 端口未出现(2 分钟)"); process.exit(1); }
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((r) => ws.once("open", r));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400);
      events.push(`[console.${m.params.type}] ${text}`);
    } else if (m.method === "Runtime.exceptionThrown") {
      events.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ""}`.slice(0, 800));
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  console.log("attached to dev app, navigating ...");

  await waitFor(() => evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`), 30000, "dashboard");
  await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
  await waitFor(() => evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助'))`), 25000, "workspace");
  await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('辅助')).click()`);
  await waitFor(async () => {
    const ready = await evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`);
    if (ready) return true;
    await evaluate(`(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes('图片工作室')); if (tab) { tab.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,composed:true,button:0,pointerId:1})); tab.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,composed:true,button:0})); tab.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,composed:true,button:0,pointerId:1})); tab.dispatchEvent(new MouseEvent('mouseup', {bubbles:true,composed:true,button:0})); tab.dispatchEvent(new MouseEvent('click', {bubbles:true,composed:true,button:0})); } return 'try'; })()`);
    return false;
  }, 25000, "图片工作室 tab");

  const state = await waitFor(() => evaluate(`(() => {
    const cards = document.querySelectorAll('[data-image-studio-node-kind]').length;
    return cards > 0 ? JSON.stringify({
      cards,
      edges: document.querySelectorAll('.react-flow__edge').length,
      edgePaths: document.querySelectorAll('.react-flow__edge-path').length,
    }) : null;
  })()`).then((v) => (v && JSON.parse(v).cards > 0 ? v : null)), 20000, "canvas nodes");
  console.log("canvas:", state);
  await new Promise((r) => setTimeout(r, 2500));
  console.log("\n=== console 捕获(全量) ===");
  console.log(events.length ? events.join("\n") : "(无 console 输出)");
  try { ws.close(); } catch {}
}

main().catch((error) => {
  console.log(`error: ${error.message}`);
  console.log(events.join("\n"));
  process.exit(1);
});
