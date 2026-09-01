// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 本地免费生图预热:设置→本地配置→本地图片生成「准备运行时」→ krea2-turbo「设为当前」
 * → 轮询就绪。完成后不关应用(留给用户直接用)。
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
  throw new Error(`waitFor timeout: ${label} last=${JSON.stringify(last)?.slice(0, 300)}`);
}
const log = (m) => console.log(m);

// 导航:Dashboard→项目→设置→本地配置
await waitFor(async () => {
  const atDashboard = await evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`);
  if (atDashboard) {
    await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  return evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('设置'))`);
}, 40000, "侧栏设置");
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('设置')).click()`);
await waitFor(() => evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '本地配置')`), 20000, "本地配置 tab");
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
await waitFor(() => evaluate(`document.body.textContent.includes('本地图片生成')`), 15000, "本地图片生成区块");
log("PASS 设置→本地配置");

// 拉起 runtime(若未就绪)
const runtimeState = await evaluate(`(() => {
  const body = document.body.textContent;
  const hasReady = body.includes('已就绪（') || body.includes('模型已就绪');
  return JSON.stringify({ hasReady, hasPrepare: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '准备运行时') });
})()`);
log("runtime 状态: " + runtimeState);
const parsed = JSON.parse(runtimeState);
if (parsed.hasPrepare) {
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '准备运行时')?.click()`);
  log("已点「准备运行时」,等 runtime 就绪…");
}
await waitFor(() => evaluate(`fetch('http://127.0.0.1:17595/health', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false)`), 180000, "sidecar 17595 就绪");
log("PASS 本地生图 runtime 就绪");

// krea2-turbo 设为当前
await waitFor(() => evaluate(`document.body.textContent.includes('krea2-turbo') || document.body.textContent.includes('Krea2')`), 20000, "krea2 行出现");
const setActive = await evaluate(`(() => {
  // 找 krea2 行(含 krea2-turbo 文本的最小卡片)里的「设为当前」按钮
  let row = null;
  for (const el of document.querySelectorAll('div,section')) {
    const t = el.textContent ?? '';
    if (t.includes('krea2-turbo') && t.includes('设为当前') && (!row || t.length < row.textContent.length)) row = el;
  }
  if (!row) return 'no-row';
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '设为当前' && !b.disabled);
  if (!btn) return 'no-button(may already active)';
  btn.click();
  return 'clicked';
})()`);
log("设为当前: " + setActive);
await new Promise((r) => setTimeout(r, 1500));

// 终态确认:runtime 就绪 + krea2 为当前模型
const final = await evaluate(`(() => {
  const body = document.body.textContent;
  const active = body.match(/当前[::]\\s*(krea2-turbo|flux2-klein-9b|z-image-turbo|qwen-image-edit-2511)/);
  return JSON.stringify({
    readyText: body.includes('已就绪') || body.includes('模型已就绪'),
    activeModel: active ? active[1] : null,
    krea2ActiveVisible: body.includes('当前') && body.includes('krea2'),
  });
})()`);
log("终态: " + final);
ws.close();
process.exit(0);
