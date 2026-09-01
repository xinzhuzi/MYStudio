// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 本地免费生图实弹验收(09-01 路由修复后):导航画布 → 目标组钉 krea2-turbo →
 * 点生成/重新生成 → 轮询至 ready,断言 local-image:// 稳定地址。证据另由
 * sidecar 日志的 POST /v1/images/generations 交叉核验。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const PROMPT_MARK = "白衣剑修";
const GENERATION_TIMEOUT_MS = 420000;

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

// 导航(冷启动可能吞首击,带重试)
await waitFor(async () => {
  const atDashboard = await evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`);
  if (atDashboard) {
    await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  return evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助'))`);
}, 40000, "进入工作区");
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('辅助')).click()`);
await waitFor(() => evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`), 30000, "图片工作室工具栏");
log("PASS 导航到画布");

// 目标组:确保 gen 节点 model=krea2-turbo(手术+重载,等价 UI 选择)
const ensured = await evaluate(`(() => {
  const raw = JSON.parse(localStorage.getItem('mystudio-image-studio'));
  const s = raw.state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  let promptNode = w.nodes.find((n) => n.type === 'prompt' && (n.prompt || '').includes(${JSON.stringify(PROMPT_MARK)}));
  if (!promptNode) return 'no-group';
  const edge = w.edges.find((e) => e.source === promptNode.id);
  const gen = w.nodes.find((n) => n.id === edge.target);
  gen.model = 'krea2-turbo';
  localStorage.setItem('mystudio-image-studio', JSON.stringify(raw));
  return JSON.stringify({ genId: gen.id, status: gen.status });
})()`);
if (ensured === "no-group") throw new Error("目标组不存在(需要先跑 livegen 注入)");
const info = JSON.parse(ensured);
log(`PASS 目标组钉模 krea2-turbo: status=${info.status}`);
await evaluate(`location.reload()`);
await waitFor(() => evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`), 40000, "重载后画布");
await new Promise((r) => setTimeout(r, 1500));
await evaluate(`document.querySelector('button[aria-label="适配画布"]')?.click()`);
await new Promise((r) => setTimeout(r, 600));

// 点击「生成」或「重新生成」
const clicked = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')];
  for (const card of cards) {
    if (card.textContent.includes(${JSON.stringify(PROMPT_MARK)}) || cards.length === 1) {
      const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '生成' || b.textContent.trim() === '重新生成');
      if (btn) { btn.click(); return btn.textContent.trim(); }
    }
  }
  return 'no-button';
})()`);
if (clicked === "no-button") throw new Error("没找到生成按钮");
log(`已点击「${clicked}」,轮询(最长 7 分钟)…`);

const t0 = Date.now();
const finalState = await waitFor(async () => {
  const state = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
    const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
    const gen = w.nodes.find((n) => n.id === ${JSON.stringify(info.genId)});
    return JSON.stringify({ status: gen.status, resultUrl: gen.resultUrl ?? null, errorReason: gen.errorReason ?? null, mediaId: gen.resultMediaId ?? null });
  })()`).then(JSON.parse);
  const sec = Math.round((Date.now() - t0) / 1000);
  if (sec % 15 === 0) log(`  +${sec}s status=${state.status}`);
  return state.status === "ready" || state.status === "failed" ? state : null;
}, GENERATION_TIMEOUT_MS, "生成完成");

if (finalState.status !== "ready") {
  log(`FAIL 生成失败: ${finalState.errorReason}`);
  process.exit(1);
}
const stable = (finalState.resultUrl || "").startsWith("local-image://");
log(`PASS 本地实弹生图完成(${Math.round((Date.now() - t0) / 1000)}s): ${finalState.resultUrl}`);
log(`  stableUrl=${stable} mediaId=${finalState.mediaId ?? "无"}`);
ws.close();
process.exit(0);
