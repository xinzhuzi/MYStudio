// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/** 现场取证:文生图按钮点击前后 DOM/store 对比 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((resolve) => ws.once("open", resolve));
let messageId = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve) => {
    pending.set(id, (m) => resolve(m));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.error) throw new Error(r.error.message);
  return r.result.result.value;
}

const snap = (label) => evaluate(`(() => {
  const persisted = (() => { try { return JSON.parse(localStorage.getItem('mystudio-image-studio')); } catch { return null; } })();
  const active = persisted?.state.workflows.find((w) => w.id === persisted.state.activeWorkflowId);
  const button = document.querySelector('[data-image-studio-add-t2i]');
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    domCards: document.querySelectorAll('[data-image-studio-node-kind]').length,
    domEdges: document.querySelectorAll('.react-flow__edge').length,
    buttonExists: Boolean(button),
    buttonDisabled: button?.disabled ?? null,
    activeWorkflowNodes: active?.nodes.length ?? null,
    activeWorkflowEdges: active?.edges.length ?? null,
    workflows: persisted?.state.workflows.length ?? null,
    activeName: active?.name ?? null,
  });
})()`);

console.log(await snap("before"));
await evaluate(`document.querySelector('[data-image-studio-add-t2i]')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(await snap("after-1.5s"));
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(await snap("after-3s"));
// 直接调 store 按钮onClick 的替代路径:点 toolbar 里文本含文生图的全部按钮
await evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.includes('文生图')).forEach((b) => b.click())`);
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(await snap("after-all-t2i-buttons"));
ws.close();
