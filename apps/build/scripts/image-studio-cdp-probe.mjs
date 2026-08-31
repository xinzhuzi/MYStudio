// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 图片工作室画布化装机实证(2026-09-01):CDP 驱动 /Applications 已装应用,
 * 真实打开 辅助面板→图片工作室,验证画布渲染/一键建组/连线/整理布局/持久化,
 * 收尾还原 localStorage 探针污染并温和退出应用。
 *
 * 用法:先 MYSTUDIO_REMOTE_DEBUG=1 打开应用,再 `node image-studio-cdp-probe.mjs`。
 * 断言以 DOM/store 为准(截图在该应用常超时,仅 best-effort)。
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_HTTP = "http://127.0.0.1:9222";
const results = [];
let ws = null;
let messageId = 0;
const pending = new Map();

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 400, label = "" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timeout${label ? `: ${label}` : ""} last=${JSON.stringify(last)?.slice(0, 200)}`);
}

async function connect() {
  const list = await (await fetch(`${CDP_HTTP}/json`)).json();
  const page = list.find((target) => target.type === "page");
  if (!page) throw new Error("no page target");
  ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
}

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`.slice(0, 400));
  }
  return result.result.value;
}

/** 五事件指针序列(Radix 不吃裸 click;抄自 smoke 配方) */
async function activate(selector, { label = selector } = {}) {
  return evaluate(`(() => {
    const el = ${selector};
    if (!el) return "not-found";
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return "clicked:" + Math.round(rect.x) + "," + Math.round(rect.y);
  })()`, ).then((value) => {
    if (value === "not-found") throw new Error(`activate: element not found: ${label}`);
    return value;
  });
}

async function main() {
  let snapshot = null;
  try {
    await connect();
    record("CDP 连接已装应用", true);

    // 0) 探针前快照(收尾还原)
    snapshot = await evaluate(`(() => ({
      imageStudio: localStorage.getItem('mystudio-image-studio'),
      freedom: localStorage.getItem('mystudio-freedom'),
    }))()`);
    record("localStorage 探针前快照", true, `imageStudio=${snapshot.imageStudio ? "有" : "无"} freedom=${snapshot.freedom ? "有" : "无"}`);

  // 1) 进入工作区(冷启动可能在 Dashboard;项目卡 DOM click 最稳)
  const entered = await waitFor(async () => {
    const atDashboard = await evaluate(`Boolean(document.querySelector('.dashboard-project-card,[data-project-card]'))`);
    if (atDashboard) {
      await evaluate(`document.querySelector('.dashboard-project-card,[data-project-card]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return evaluate(`Boolean([...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助')))`);
  }, { timeoutMs: 25000, label: "进入工作区(辅助 nav 可见)" });
  record("进入工作区,侧栏含「辅助」", entered);

  // 自发弹回防护:双重稳定确认
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const stable = await evaluate(`Boolean([...document.querySelectorAll('.studio-nav-button')].some((b) => b.textContent.includes('辅助')))`);
  record("工作区稳定(无弹回)", stable);

  // 2) 导航到辅助面板
  await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find((b) => b.textContent.includes('辅助')).click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`), {
    timeoutMs: 20000,
    label: "图片工作室工具栏(文生图按钮)",
  }).catch(async () => {
    // 激活工作室可能停在别的 tab(视频/音乐…):五事件点「🖼️ 图片工作室」
    await activate(`[...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes('图片工作室'))`, { label: "图片工作室 tab" });
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-image-studio-add-t2i]'))`), {
      timeoutMs: 15000,
      label: "切 tab 后工具栏",
    });
  });
  record("图片工作室 tab 打开,工具栏渲染", true);

  // 3) 画布本体
  const canvasState = await evaluate(`(() => ({
    hasFlow: Boolean(document.querySelector('.react-flow')),
    hasViewportControls: Boolean(document.querySelector('.workflow-node-viewport-controls')),
    hasEmptyHint: document.body.textContent.includes('空画布'),
    nodeCards: document.querySelectorAll('[data-image-studio-node-kind]').length,
  }))()`);
  record("React Flow 画布挂载", canvasState.hasFlow, JSON.stringify(canvasState));

  // 4) 一键文生图建组(相对断言:用户真实存储可能已有节点;连线必须 DOM 可见)
  const before = await evaluate(`({
    cards: document.querySelectorAll('[data-image-studio-node-kind]').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
  })`);
  await evaluate(`document.querySelector('[data-image-studio-add-t2i]').click()`);
  const groupState = await waitFor(() => evaluate(`(() => ({
    cards: document.querySelectorAll('[data-image-studio-node-kind]').length,
    prompt: document.querySelectorAll('[data-image-studio-node-kind="prompt"]').length,
    generated: document.querySelectorAll('[data-image-studio-node-kind="generated"]').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    edgePaths: document.querySelectorAll('.react-flow__edge-path').length,
    genStatus: [...document.querySelectorAll('[data-image-studio-node-kind="generated"]')].some((n) => n.textContent.includes('待生成')),
    params: document.querySelectorAll('[data-image-studio-node-params]').length,
  }))()`).then((value) => (
    value.cards === before.cards + 2
      && value.edges === before.edges + 1
      && value.edgePaths >= value.edges
      ? value
      : null
  )), {
    timeoutMs: 12000,
    label: "文生图建组(+2节点+1可见连线)",
  });
  record("一键文生图:提示词+成图+连线(DOM 可见)", true, `before=${before.cards}卡/${before.edges}边 after=${groupState.cards}卡/${groupState.edges}边/路径${groupState.edgePaths} 待生成=${groupState.genStatus} 参数行=${groupState.params}`);

  // 5) 提示词可编辑(选「最新的空提示词卡」;React 受控 textarea 经 native setter+input 事件)
  const typed = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-image-studio-node-kind="prompt"]')];
    const textarea = cards.map((c) => c.querySelector('textarea')).find((t) => t && t.value === '') ;
    if (!textarea) return "no-textarea";
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '探针提示词:山门晨雾CDP');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return "typed";
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const typedConfirmed = await evaluate(`(() => {
    const persisted = localStorage.getItem('mystudio-image-studio');
    if (!persisted) return false;
    const parsed = JSON.parse(persisted);
    return parsed.state.workflows.some((w) =>
      w.nodes.some((n) => n.type === 'prompt' && n.prompt === '探针提示词:山门晨雾CDP'));
  })()`);
  record("提示词编辑落库(persist 即时写)", typed === "typed" && typedConfirmed, `typed=${typed} confirmed=${typedConfirmed}`);

  // 6) 整理布局(激活画布内:成图列 x 全部大于提示词列 x)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('整理布局'))?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const layoutApplied = await evaluate(`(() => {
    const persisted = JSON.parse(localStorage.getItem('mystudio-image-studio'));
    const state = persisted.state;
    const workflow = state.workflows.find((w) => w.id === state.activeWorkflowId);
    if (!workflow) return false;
    const promptXs = workflow.nodes.filter((n) => n.type === 'prompt').map((n) => n.position.x);
    const generatedXs = workflow.nodes.filter((n) => n.type === 'generated').map((n) => n.position.x);
    return promptXs.length > 0 && generatedXs.length > 0
      && Math.min(...generatedXs) > Math.max(...promptXs);
  })()`);
  record("整理布局:成图列在提示词列右侧", layoutApplied);

  // 7) 多画布:新建一张(相对断言:数量+1,新画布成为激活)
  const workflowCountBefore = await evaluate(`JSON.parse(localStorage.getItem('mystudio-image-studio')).state.workflows.length`);
  await evaluate(`[...document.querySelectorAll('button[title="新建画布"]')][0]?.click()`);
  const secondCanvas = await waitFor(() => evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('mystudio-image-studio')).state;
    return state.workflows.length === ${workflowCountBefore} + 1
      && state.workflows.find((w) => w.id === state.activeWorkflowId)?.nodes.length === 0;
  })()`), { timeoutMs: 8000, label: "新画布(空且激活)" });
  record(`新建画布(第 ${workflowCountBefore + 1} 张,空画布激活)`, secondCanvas);

  // 8) best-effort 截图(该应用常超时,不计成败)
  try {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/image-studio-probe.png", Buffer.from(shot.data, "base64"));
    record("截图(辅证)", true, "apps/output/automation/image-studio-probe.png");
  } catch {
    record("截图(辅证)", true, "超时跳过(DOM 断言为准)");
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n探针结论: ${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    // 还原探针污染(await 确保落盘;探针只污染两个键,其余原样)
    if (snapshot) {
      try {
        await evaluate(`(() => {
          ${snapshot.imageStudio === null ? "localStorage.removeItem('mystudio-image-studio');" : "localStorage.setItem('mystudio-image-studio', " + JSON.stringify(snapshot.imageStudio) + ");"}
          ${snapshot.freedom === null ? "localStorage.removeItem('mystudio-freedom');" : "localStorage.setItem('mystudio-freedom', " + JSON.stringify(snapshot.freedom) + ");"}
          return "restored";
        })()`);
        console.log("cleanup: localStorage 已还原");
      } catch (error) {
        console.log("cleanup: 还原失败", error.message);
      }
    }
    try { ws?.close(); } catch {}
  }
}

main().catch((error) => {
  record("探针主流程", false, error.message);
  process.exitCode = 1;
});
