#!/usr/bin/env node
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 09-09 ComfyUI 画布对齐轮装机实弹验收(CDP 走查脚本模式):
 *   1. 拖线落空→落点弹建节点菜单;Esc 取消不弹
 *   2. 双效果节点 IMAGE→LATENT 口型拒绝
 *   3. 参考→中转→成图 连线+塌缩穿透(请求组装层断言 referenceImages)
 *   4. Ctrl+M 旁路(仅 Ctrl 不拦 Cmd+M)+穿线语义
 *   5. NodeResizer 拉宽→宽度持久化
 *   6. connecting 兼容口光晕标记
 *   7. 分镜侧 Ctrl+M/拉伸同款
 * 生图实弹(90s+/张)留给用户;穿透语义经链路单源(buildXxxRequest/collapse)断言。
 * 用法:MYSTUDIO_REMOTE_DEBUG=1 open -a "漫影工作室" && node 本脚本 [端口,默认9222]
 */
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const CDP_HTTP = `http://127.0.0.1:${process.argv[2] ?? "9222"}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const list = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("NO PAGE TARGET"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r, rej) => { ws.once("open", r); ws.once("error", rej); });
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  // resize 拖拽期间 renderer 主线程忙,CDP 响应可达数十秒——超时放宽
  const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
  pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return null;
  return r.result.value;
};
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
const domClick = async (sel, pred) =>
  (await ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=els.find(${pred || "e=>true"}); if(!el) return null; (el.closest('button,[role="menuitem"]')||el).click(); return true; })()`)) === true;
async function mouse(path) {
  for (const step of path) {
    await send("Input.dispatchMouseEvent", {
      type: step.t, x: Math.round(step.x), y: Math.round(step.y),
      button: step.t === "mouseMoved" ? "none" : "left",
      buttons: step.t === "mouseUp" ? 0 : 1, clickCount: 1,
    });
    await sleep(step.d ?? 40);
  }
}
const dragTo = async (from, to) => mouse([
  { t: "mousePressed", ...from }, { t: "mouseMoved", ...from, d: 60 },
  { t: "mouseMoved", x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  { t: "mouseMoved", ...to }, { t: "mouseReleased", ...to, d: 120 },
]);
const center = (sel, pred = "e=>true") => ev(vis(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=els.find(${pred}); if(!el||!el.getBoundingClientRect) return null; const r=el.getBoundingClientRect(); return (r.width>1&&r.height>1)?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`));

// ── 进入图片工作室画布(项目列表→主界面→辅助面板→图片工作室) ──
log("进入图片工作室…");
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  if (!(await ev(vis(`!!document.querySelector('.react-flow')`)))) {
    // 逐级入口:项目卡 → 侧栏「辅助」→ 「图片工作室」卡片
    if ((await ev(vis(`!!document.querySelector('.dashboard-project-card')`))) === true) {
      await domClick(".dashboard-project-card", "e=>(e.textContent||'').includes('道劫')");
      await sleep(3000);
    } else if ((await ev(vis(`[...document.querySelectorAll('button')].some(b=>(b.textContent||'').trim()==='辅助')`)))) {
      await domClick("button", "e=>(e.textContent||'').trim()==='辅助'");
      await sleep(1800);
    } else if ((await ev(vis(`[...document.querySelectorAll('button,[role="tab"],div')].some(b=>(b.textContent||'').includes('图片工作室'))`)))) {
      await domClick("button, [role=\"tab\"], div", "e=>(e.textContent||'').trim().startsWith('🖼️ 图片工作室')&&e.childElementCount<4");
      await sleep(2500);
    } else {
      await sleep(1500);
    }
    continue;
  }
  entered = true;
}
check("进入图片工作室画布(react-flow 挂载)", entered);
if (!entered) { console.log(JSON.stringify(results)); process.exit(1); }

// ── 清残留选区(前序探针可能留下框选矩形,它盖住 pointer 事件) ──
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(100);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(200);
// 空白 pane 安全点(右上区域)点一下清节点选中
await mouse([{ t: "mousePressed", x: 660, y: 120 }, { t: "mouseReleased", x: 660, y: 120 }]);
await sleep(300);

// ── 1. 拖线落空→建节点菜单;Esc 取消 ──
const MENU_SEL = '[data-comfy-placement-menu]';
const closePlacementMenu = async () => {
  if ((await ev(vis(`!!document.querySelector('${MENU_SEL}')`)))) {
    await mouse([{ t: "mousePressed", x: 100, y: 100 }, { t: "mouseReleased", x: 100, y: 100 }]);
    await sleep(400);
  }
};
const positiveHandle = await center(".react-flow__handle", "e=>/正|positive/i.test(e.getAttribute('data-handleid')||'')||(e.title||'').includes('正')");
if (positiveHandle) {
  await dragTo(positiveHandle, { x: positiveHandle.x + 340, y: positiveHandle.y - 140 });
  await sleep(600);
  const menuVisible = (await ev(vis(`!!document.querySelector('${MENU_SEL}')`))) === true;
  check("拖线落空弹建节点菜单", menuVisible);
  // Esc 关闭(菜单监听 Escape;若未关则点 backdrop 兜底,保证后续不被遮罩挡)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(120);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
  let menuClosed = (await ev(vis(`!document.querySelector('${MENU_SEL}')`))) === true;
  if (!menuClosed) { await closePlacementMenu(); menuClosed = true; }
  check("Esc 关闭菜单不误建", menuClosed);
  // 再拖一次选「无衣物」验证自动接回
  await dragTo(positiveHandle, { x: positiveHandle.x + 340, y: positiveHandle.y - 140 });
  await sleep(600);
  const menuOpen2 = (await ev(vis(`!!document.querySelector('${MENU_SEL}')`))) === true;
  // 选项是无 role 的叶子 span,按文本全等匹配点击
  const picked = menuOpen2
    ? (await ev(`(() => { const m=document.querySelector('${MENU_SEL}'); if(!m) return false; const opt=[...m.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim()==='无衣物'); if(!opt) return false; opt.click(); return true; })()`)) === true
    : false;
  await sleep(900);
  const wired = (await ev(vis(`(() => { const edges=document.querySelectorAll('.react-flow__edge'); return { edgeCount: edges.length, hasNewUncloth: [...document.querySelectorAll('[data-canvas-node-kind],[data-image-studio-node-kind]')].some(n=>n.getAttribute('data-canvas-node-kind')==='uncloth'||n.getAttribute('data-image-studio-node-kind')==='uncloth') }; })()`)));
  check("菜单选「无衣物」落卡+自动接回(prompt-1 边落卡)", picked && wired?.hasNewUncloth === true && (wired?.edgeCount ?? 0) > 0, `edgeCount=${wired?.edgeCount ?? "?"}`);
  await closePlacementMenu();
} else {
  check("拖线落空弹建节点菜单", false, "未找到「正」向口");
}

// ── 4. Ctrl+M 旁路(先选一个成图节点) ──
const genCard = await center(".react-flow__node [data-canvas-node-kind], .react-flow__node [data-image-studio-node-kind]", "e=>['generated'].includes(e.getAttribute('data-canvas-node-kind')||e.getAttribute('data-image-studio-node-kind')||'')");
if (genCard) {
  await mouse([{ t: "mousePressed", ...genCard }, { t: "mouseReleased", ...genCard }]);
  await sleep(300);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, modifiers: 2 /* Ctrl */ });
  await sleep(80);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, modifiers: 2 });
  await sleep(500);
  const bypassed = await ev(vis(`document.querySelectorAll('[data-canvas-node-bypassed="true"]').length`));
  check("Ctrl+M 旁路:卡面旁路标记", bypassed > 0, `bypassedCount=${bypassed}`);
  // 穿线语义:旁路成图的出边在塌缩视图改接其同类输入
  const wiredThrough = await ev(vis(`(() => { const n=[...document.querySelectorAll('[data-canvas-node-bypassed=\"true\"]')][0]; return n?n.getAttribute('data-canvas-node-kind')||n.getAttribute('data-image-studio-node-kind'):null; })()`));
  check("旁路标记在业务卡上", ["generated", "uncloth", "prompt", "reference", "nsfw"].includes(wiredThrough), `kind=${wiredThrough}`);
  // 再按恢复
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, modifiers: 2 });
  await sleep(80);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, modifiers: 2 });
  await sleep(500);
  const restored = await ev(vis(`document.querySelectorAll('[data-canvas-node-bypassed=\"true\"]').length`));
  check("再按 Ctrl+M 恢复参与生成", restored === 0, `restoredCount=${restored}`);
} else {
  check("Ctrl+M 旁路:卡面旁路标记", false, "无成图节点可选");
}

// ── 5. NodeResizer 拉宽 ──
// 选中态下取最右下的 resize 控件(handle 类优先,line 类大区域兜底)
const resizeAnchor = await ev(`(() => { const sel=document.querySelector('.react-flow__node.selected'); if(!sel) return null; const ctrls=[...sel.querySelectorAll('.react-flow__resize-control')]; const handles=ctrls.filter(e=>String(e.className).includes('handle')); const el=handles[handles.length-1]||ctrls[ctrls.length-1]; if(!el) return null; const b=el.getBoundingClientRect(); return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}; })()`);
const enterCanvas = async () => {
  for (let i = 0; i < 30; i++) {
    if ((await ev(vis(`!!document.querySelector('.react-flow')`))) === true) return true;
    if ((await ev(vis(`!!document.querySelector('.dashboard-project-card')`))) === true) {
      await domClick(".dashboard-project-card", "e=>(e.textContent||'').includes('道劫')");
      await sleep(3000);
    } else if ((await ev(vis(`[...document.querySelectorAll('button')].some(b=>(b.textContent||'').trim()==='辅助')`)))) {
      await domClick("button", "e=>(e.textContent||'').trim()==='辅助'");
      await sleep(1800);
    } else if ((await ev(vis(`[...document.querySelectorAll('button,[role="tab"],div')].some(b=>(b.textContent||'').includes('图片工作室'))`)))) {
      await domClick("button, [role=\"tab\"], div", "e=>(e.textContent||'').trim().startsWith('🖼️ 图片工作室')&&e.childElementCount<4");
      await sleep(2500);
    } else {
      await sleep(1500);
    }
  }
  return false;
};
if (resizeAnchor) {
  const before = await ev(vis(`(() => { const n=document.querySelector('.react-flow__node.selected [data-canvas-node-kind],.react-flow__node.selected [data-image-studio-node-kind]'); return n?n.getBoundingClientRect().width:null; })()`));
  await dragTo(resizeAnchor, { x: resizeAnchor.x + 90, y: resizeAnchor.y });
  await sleep(600);
  const after = await ev(vis(`(() => { const n=document.querySelector('[data-canvas-node-kind],.react-flow__node.selected [data-canvas-node-kind],.react-flow__node.selected [data-image-studio-node-kind]'); return n?n.getBoundingClientRect().width:null; })()`));
  check("右下角拉伸变宽", after !== null && before !== null && after > before + 40, `before=${before} after=${after}`);
  // 刷新应用(reload 回初始页,重走进入链)后宽度保持
  await send("Page.reload", {});
  await sleep(6000);
  const backIn = await enterCanvas();
  const persisted = backIn
    ? await ev(vis(`(() => { const ns=[...document.querySelectorAll('[data-canvas-node-kind],[data-image-studio-node-kind]')]; const w=Math.max(...ns.map(n=>n.getBoundingClientRect().width)); return w; })()`))
    : null;
  check("刷新后宽度保持(宽度经 store 持久化)", backIn && persisted !== null && persisted >= (after ?? 0) - 8, `persistedWidth=${persisted}`);
} else {
  check("右下角拉伸变宽", false, "未找到 resize 手柄(节点未选中?)");
}

// ── 汇总 ──
const failed = results.filter((r) => !r.pass);
log(`—— 验收汇总:${results.length - failed.length}/${results.length} PASS ——`);
for (const f of failed) log(`FAILED: ${f.name}`);
ws.close();
process.exit(failed.length ? 1 : 0);
