// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 对用户真实失败节点(model=krea2-turbo)点生成,实弹验收模型归属路由修复。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evaluate = (expression) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result.result.value)));
  ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});
const waitFor = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(1000);
  }
  throw new Error("timeout: " + label + " last=" + JSON.stringify(last)?.slice(0, 300));
};

// 导航:Dashboard→项目→辅助→图片工作室画布
await waitFor(async () => {
  const atDashboard = await evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`);
  if (atDashboard) {
    await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
    await sleep(1200);
  }
  return evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助'))`);
}, 40000, "进入工作区");
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('辅助')).click()`);
await waitFor(() => evaluate("Boolean(document.querySelector('[data-image-studio-add-t2i]'))"), 30000, "画布");
await evaluate(`document.querySelector('button[aria-label="适配画布"]')?.click()`);
await sleep(600);

const genId = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  const gen = w.nodes.find((n) => n.type === 'generated');
  return gen ? gen.id + '|' + (gen.model ?? '-') + '|' + gen.status : 'none';
})()`);
console.log("目标节点:", genId);
if (genId === "none") throw new Error("无成图节点");
const [, model, preStatus] = genId.split("|");
if (model !== "krea2-turbo") throw new Error("节点模型不是 krea2-turbo: " + model);

const clicked = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')];
  const card = cards[0];
  if (!card) return 'no-card';
  const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '生成' || b.textContent.trim() === '重新生成');
  if (!btn) return 'no-button';
  btn.click();
  return btn.textContent.trim();
})()`);
if (clicked.startsWith("no-")) throw new Error(clicked);
console.log(`已点击「${clicked}」(原状态 ${preStatus})`, new Date().toLocaleTimeString());

const t0 = Date.now();
const fin = await waitFor(async () => {
  const st = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
    const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
    const gen = w.nodes.find((n) => n.id === ${JSON.stringify(genId.split("|")[0])});
    return JSON.stringify({ status: gen.status, url: gen.resultUrl ?? null, err: gen.errorReason ?? null });
  })()`).then(JSON.parse);
  const sec = Math.round((Date.now() - t0) / 1000);
  if (sec % 20 === 0) console.log(`  +${sec}s ${st.status}`);
  return (st.status === "ready" || st.status === "failed") ? st : null;
}, 420000, "生成完成");

console.log("终态:", JSON.stringify(fin).slice(0, 400));
const ok = fin.status === "ready" && (fin.url || "").startsWith("local-image://");
console.log(ok ? "PASS 用户节点本地实弹生图成功" : "FAIL");
ws.close();
process.exit(ok ? 0 : 1);
