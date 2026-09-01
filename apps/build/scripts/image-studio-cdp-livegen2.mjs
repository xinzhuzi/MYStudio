// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 实弹文生图·第二阶段:模型已预置(localStorage 注入,等价 UI 选择),导航后
 * 直接点「生成」(普通按钮)并轮询成品,取三件套落库证据。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const PROMPT_MARK = "白衣剑修";
const GENERATION_TIMEOUT_MS = 300000;

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

// 找到目标组(prompt 含标记)与其成图节点
const target = await waitFor(() => evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  const promptNode = w.nodes.find((n) => n.type === 'prompt' && n.prompt.includes(${JSON.stringify(PROMPT_MARK)}));
  if (!promptNode) return null;
  const edge = w.edges.find((e) => e.source === promptNode.id);
  if (!edge) return null;
  const gen = w.nodes.find((n) => n.id === edge.target);
  return JSON.stringify({ prompt: promptNode.prompt, model: gen.model ?? null, status: gen.status, genId: gen.id });
})()`), 10000, "目标生成组");
const targetInfo = JSON.parse(target);
log(`PASS 目标组: model=${targetInfo.model} status=${targetInfo.status}`);
if (targetInfo.status === "generating") { log("已在生成中,直接轮询"); }
else if (targetInfo.status === "ready") { log("已有成品(上次坐标误点已成功?)"); }

// 视口归位后点「生成」(普通按钮,DOM click 可靠)
if (targetInfo.status !== "ready") {
  if (targetInfo.status !== "generating") {
    await evaluate(`document.querySelector('button[aria-label="适配画布"]')?.click()`);
    await new Promise((r) => setTimeout(r, 600));
    const clicked = await evaluate(`(() => {
      const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
      const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
      const gens = [...w.nodes].filter((n) => n.type === 'generated');
      const last = gens.find((n) => n.id === ${JSON.stringify(targetInfo.genId)});
      const domGens = [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')];
      const domNode = domGens.find((n) => n.textContent.includes('生成'));
      // 点该节点 footer 的生成按钮:找含目标 prompt 组的成图卡(最后一张含该提示词连线的卡)
      const cards = domGens;
      const card = cards[cards.length - 1];
      const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '生成');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()`);
    if (clicked !== "clicked") throw new Error(`生成按钮: ${clicked}`);
    log("已点击「生成」,轮询(最长 5 分钟)…");
  }
}

const t0 = Date.now();
const finalState = await waitFor(async () => {
  const state = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
    const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
    const gen = w.nodes.find((n) => n.id === ${JSON.stringify(targetInfo.genId)});
    return JSON.stringify({ status: gen.status, resultUrl: gen.resultUrl ?? null, errorReason: gen.errorReason ?? null, mediaId: gen.resultMediaId ?? null });
  })()`).then(JSON.parse);
  const sec = Math.round((Date.now() - t0) / 1000);
  if (sec % 10 === 0) log(`  +${sec}s status=${state.status}`);
  return state.status === "ready" || state.status === "failed" ? state : null;
}, GENERATION_TIMEOUT_MS, "生成完成");

if (finalState.status !== "ready") {
  log(`FAIL 生成失败: ${finalState.errorReason}`);
  process.exit(1);
}
const stable = (finalState.resultUrl || "").startsWith("local-image://") || (finalState.resultUrl || "").startsWith("project-file://");
log(`PASS 实弹文生图完成(${Math.round((Date.now() - t0) / 1000)}s): ${finalState.resultUrl}`);
log(`  stableUrl=${stable} mediaId=${finalState.mediaId ?? "无"}`);

const history = await evaluate(`(() => {
  const freedom = JSON.parse(localStorage.getItem('mystudio-freedom')).state;
  const h = freedom.imageHistory[0];
  return h ? JSON.stringify({ prompt: h.prompt.slice(0, 20), mediaId: h.mediaId ?? null, sameUrl: h.resultUrl === ${JSON.stringify(finalState.resultUrl)} }) : 'empty';
})()`);
log(`  历史条目: ${history}`);
ws.close();
process.exit(0);
