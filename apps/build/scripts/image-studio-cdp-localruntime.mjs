// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 装机应用本地生图 runtime 拉起:设置→本地配置→本地图片生成 行内启动/探测,
 * 轮询 17595 服务就绪后回报。只负责拉起 runtime,不点生成。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
async function evaluate(expression) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result.result.value)));
    ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}
async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`waitFor timeout: ${label} last=${JSON.stringify(last)?.slice(0, 400)}`);
}
const log = (m) => console.log(m);

async function localRuntimeUp() {
  return evaluate(`fetch('http://127.0.0.1:17595/health', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false)`);
}

// 已在跑则直接成功
if (await localRuntimeUp()) { log("PASS 本地生图 runtime 已在运行"); process.exit(0); }

// 导航到设置(工作区在则点侧栏;Dashboard 则先进项目)
await waitFor(async () => {
  const atDashboard = await evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`);
  if (atDashboard) {
    await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  return evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('设置'))`);
}, 40000, "侧栏设置入口");
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('设置')).click()`);
await waitFor(() => evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '本地配置')`), 20000, "本地配置 tab");
// Radix tab 不吃裸 click:五事件指针序列
await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '本地配置');
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 9 }));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 9 }));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
  return 'ok';
})()`);
// 等「本地图片生成」区块出现(tab 内容渲染)
await waitFor(() => evaluate(`document.body.textContent.includes('本地图片生成')`), 15000, "本地图片生成区块");
log("PASS 进入 设置→本地配置(区块已渲染)");

// 点「准备运行时」(源码实证文案;未就绪时显示)
const clicked = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')].filter((b) => {
    const text = b.textContent.trim();
    return (text === '准备运行时' || text === '探测') && !b.disabled;
  });
  const start = buttons.find((b) => b.textContent.trim() === '准备运行时') ?? buttons[0];
  if (!start) return 'no-start-button';
  start.click();
  return 'clicked:' + start.textContent.trim();
})()`);
log("启动点击: " + clicked);

// 轮询 runtime 就绪(模型加载可能要 1-2 分钟)
try {
  await waitFor(() => localRuntimeUp(), 180000, "本地 runtime 17595 就绪");
  log("PASS 本地生图 runtime 已就绪(17595 /health OK)");
  process.exit(0);
} catch (error) {
  log("FAIL runtime 未在 3 分钟内就绪: " + error.message);
  process.exit(1);
}
