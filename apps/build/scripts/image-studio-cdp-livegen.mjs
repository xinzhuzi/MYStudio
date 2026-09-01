// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 图片工作室装机实弹:真实文生图(钱咖 gpt-image-2,经 freedom_image 绑定)。
 * 前置:MYSTUDIO_REMOTE_DEBUG=1 应用已启动且已进工作区(脚本自导航)。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const PROMPT = "水墨风格:一名白衣剑修立于山门石阶之上,晨雾缭绕,远山如黛,浅净平涂底";
const MODEL_ID = "gpt-image-2";
const GENERATION_TIMEOUT_MS = 240000;

const ws = await (async () => {
  const list = await (await fetch("http://127.0.0.1:9222/json")).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((r) => ws.once("open", r));
  return ws;
})();
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
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
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitFor timeout: ${label} last=${JSON.stringify(last)?.slice(0, 300)}`);
}
const log = (msg) => console.log(msg);

/** 五事件指针序列(普通 React 按钮) */
async function tap(selectorJs) {
  const result = await evaluate(`(() => {
    const el = ${selectorJs};
    if (!el) return "not-found";
    el.scrollIntoView({ block: "center" });
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 7 }));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 7 }));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return "ok";
  })()`);
  if (result !== "ok") throw new Error(`tap failed: ${result}`);
}

/** CDP Input 真实坐标点击(Radix Select 只吃 trusted 事件,合成序列无效) */
async function realClick(selectorJs) {
  const rect = await evaluate(`(() => {
    const el = ${selectorJs};
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!rect) throw new Error(`realClick: element not found`);
  const base = { button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none", buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, ...base });
  await new Promise((r) => setTimeout(r, 60));
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, ...base });
  return rect;
}

// ---------- 1) 导航进画布 ----------
await waitFor(() => evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]')) || [...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助'))`), 30000, "dashboard 或 workspace");
await evaluate(`(() => { const card = document.querySelector('.dashboard-project-card,[data-project-card]'); if (card) card.click(); return 'nav'; })()`);
await waitFor(() => evaluate(`[...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助'))`), 25000, "workspace");
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('辅助')).click()`);
await waitFor(() => evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`).catch(() => false).then(async (ok) => {
  if (ok) return true;
  await tap(`[...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes('图片工作室'))`).catch(() => {});
  return false;
}), 25000, "图片工作室 tab");
log("PASS 导航到画布");

// ---------- 2) 建组 + 填提示词(已有同提示词空组则复用,防重复堆积) ----------
const existingGroup = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  return w.nodes.some((n) => n.type === 'prompt' && n.prompt === ${JSON.stringify(PROMPT)});
})()`);
if (!existingGroup) {
  await evaluate(`document.querySelector('[data-image-studio-add-t2i]').click()`);
  await new Promise((r) => setTimeout(r, 800));
}
const typed = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-image-studio-node-kind="prompt"]')];
  const textarea = cards.map((c) => c.querySelector('textarea')).find((t) => t && t.value === '');
  if (!textarea) return "no-textarea";
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, ${JSON.stringify(PROMPT)});
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return "typed";
})()`);
if (typed !== "typed" && !existingGroup) throw new Error(`提示词填写失败: ${typed}`);
await new Promise((r) => setTimeout(r, 400));
const promptPersisted = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  return w.nodes.some((n) => n.type === 'prompt' && n.prompt === ${JSON.stringify(PROMPT)});
})()`);
if (!promptPersisted) throw new Error("提示词未落库");
log(`PASS 文生图组建组+提示词落库 (${PROMPT.slice(0, 18)}…)`);

// 视口归位:新节点可能在视野外(负坐标),坐标点击会落空——先「适配画布」
await evaluate(`document.querySelector('button[aria-label="适配画布"]')?.click()`);
await new Promise((r) => setTimeout(r, 600));

// ---------- 3) 选模型(最新成图节点的 ModelSelector → gpt-image-2,Radix 须真实坐标点击) ----------
await realClick(`[...document.querySelectorAll('[data-image-studio-node-kind="generated"]')].pop().querySelector('button[role="combobox"]')`);
const optionFound = await waitFor(() => evaluate(`(() => {
  const options = [...document.querySelectorAll('[role="option"]')];
  const hit = options.find((o) => (o.textContent || '').includes(${JSON.stringify(MODEL_ID)}));
  return hit ? "found" : null;
})()`), 8000, `下拉选项 ${MODEL_ID}`);
if (optionFound !== "found") throw new Error("模型选项未出现");
await realClick(`[...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes(${JSON.stringify(MODEL_ID)}))`);
await new Promise((r) => setTimeout(r, 600));
const modelSet = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
  const gens = w.nodes.filter((n) => n.type === 'generated');
  return gens[gens.length - 1].model;
})()`);
if (modelSet !== MODEL_ID) throw new Error(`模型设置失败: ${modelSet}`);
log(`PASS 模型选择: ${modelSet}`);

// ---------- 4) 点生成并轮询到成品 ----------
await tap(`(() => {
  const gens = [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')];
  const last = gens[gens.length - 1];
  return [...last.querySelectorAll('button')].find((b) => b.textContent.includes('生成'));
})()`);
log("已点击生成,轮询状态(最长 4 分钟)…");
const t0 = Date.now();
const finalState = await waitFor(async () => {
  const state = await evaluate(`(() => {
    const gens = [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')];
    const last = gens[gens.length - 1];
    const text = last ? last.textContent : '';
    const s = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
    const w = s.workflows.find((x) => x.id === s.activeWorkflowId);
    const storeNode = w.nodes.filter((n) => n.type === 'generated').pop();
    return JSON.stringify({
      domStatus: text.includes('生成中') ? 'generating' : text.includes('已完成') ? 'ready' : text.includes('失败') ? 'failed' : 'other',
      storeStatus: storeNode.status,
      resultUrl: storeNode.resultUrl ?? null,
      errorReason: storeNode.errorReason ?? null,
      hasImage: Boolean(last && last.querySelector('img')),
    });
  })()`);
  const parsed = JSON.parse(state);
  const every5 = Math.floor((Date.now() - t0) / 5000);
  if (every5 > 0 && every5 !== Math.floor((Date.now() - t0 - 500) / 5000)) {
    log(`  +${Math.round((Date.now() - t0) / 1000)}s status=${parsed.storeStatus} img=${parsed.hasImage}`);
  }
  return parsed.storeStatus === "ready" || parsed.storeStatus === "failed" ? parsed : null;
}, GENERATION_TIMEOUT_MS, "生成完成");

if (finalState.storeStatus !== "ready") {
  log(`FAIL 生成失败: ${finalState.errorReason}`);
  process.exit(1);
}
log(`PASS 实弹文生图完成 (耗时 ${Math.round((Date.now() - t0) / 1000)}s): ${finalState.resultUrl?.slice(0, 64)}…`);

// ---------- 5) 落库三件套核验 ----------
const evidence = await evaluate(`(() => {
  const studio = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
  const w = studio.workflows.find((x) => x.id === studio.activeWorkflowId);
  const node = w.nodes.filter((n) => n.type === 'generated').pop();
  const freedom = JSON.parse(localStorage.getItem('mystudio-freedom')).state;
  const history = freedom.imageHistory[0];
  return JSON.stringify({
    nodeResultUrl: node.resultUrl,
    nodeMediaId: node.resultMediaId ?? null,
    stableUrl: (node.resultUrl || '').startsWith('local-image://') || (node.resultUrl || '').startsWith('project-file://'),
    historyLatest: history ? { prompt: history.prompt.slice(0, 18), mediaId: history.mediaId ?? null, sameUrl: history.resultUrl === node.resultUrl } : null,
  });
})()`);
const parsedEvidence = JSON.parse(evidence);
log("落库证据: " + JSON.stringify(parsedEvidence, null, 1));
ws.close();
process.exit(0);
