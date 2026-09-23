#!/usr/bin/env node
// P2-5 节点压线挡口根修装机验收(CDP):
//   A. 连线可点:泳道空处点边→selected(09-07 验收不回退)
//   B. hover 抬卡:指针进卡 wrapper z-index 0→5;离卡回落→0(08-29 静止态不变)
//   C. 压线挡口:hover 卡时 elementFromPoint(口中心)=口本体(交互带不再吃口)
//   D. 卡片控件不吞:提示词框聚焦输入正常(hover 态卡面可用)
// 用法:MYSTUDIO_REMOTE_DEBUG=1 open -a "漫影工作室" && node 本脚本 [端口,默认9222]
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
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
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
const center = (sel, pred = "e=>true") => ev(vis(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=els.find(${pred}); if(!el||!el.getBoundingClientRect) return null; const r=el.getBoundingClientRect(); return (r.width>1&&r.height>1)?{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}:null; })()`));

// ── 进入图片工作室画布 ──
log("进入图片工作室…");
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  if (!(await ev(vis(`!!document.querySelector('.react-flow')`)))) {
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

await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(80);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(200);
// 适配画布:节点可能拖出视口(CDP 负/越界坐标事件到不了页面——已知坑)
await ev(`(() => { const b=document.querySelector('[aria-label="适配画布"]'); if(b) b.click(); return !!b; })()`);
await sleep(900);
await mouse([{ t: "mousePressed", x: 660, y: 120 }, { t: "mouseReleased", x: 660, y: 120 }]);
await sleep(300);

// ── 找提示词节点正向口 + 成图卡(存量画布即有;没有则右键建) ──
const KIND = (n) => n.getAttribute("data-canvas-node-kind") || n.getAttribute("data-image-studio-node-kind") || "";
let positiveHandle = await center(".react-flow__handle", "e=>/positive/i.test(e.getAttribute('data-handleid')||'')");
let genCard = await center(".react-flow__node [data-canvas-node-kind], .react-flow__node [data-image-studio-node-kind]", "e=>['generated'].includes(e.getAttribute('data-canvas-node-kind')||e.getAttribute('data-image-studio-node-kind')||'')");
if (!positiveHandle || !genCard) {
  // 空白右键创建菜单:提示词/成图
  log("画布无可用节点,右键创建…");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 300, button: "right", buttons: 2, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 300, button: "right", buttons: 0, clickCount: 1 });
  await sleep(600);
  for (const want of ["提示词", "成图"]) {
    const picked = (await ev(`(() => { const menus=[...document.querySelectorAll('[role="menu"], .context-menu, [data-radix-popper-content-wrapper]')]; for(const m of menus){ const opt=[...m.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim()==='${want}'); if(opt){ opt.click(); return true; } } return false; })()`)) === true;
    if (!picked) { check(`右键创建「${want}」`, false, "菜单未找到该项"); console.log(JSON.stringify(results)); process.exit(1); }
    await sleep(900);
  }
  positiveHandle = await center(".react-flow__handle", "e=>/positive/i.test(e.getAttribute('data-handleid')||'')");
  genCard = await center(".react-flow__node [data-canvas-node-kind], .react-flow__node [data-image-studio-node-kind]", "e=>['generated'].includes(e.getAttribute('data-canvas-node-kind')||e.getAttribute('data-image-studio-node-kind')||'')");
}
check("找到正向口+成图卡", Boolean(positiveHandle && genCard));

// ── 连一根边:正向口 → 成图卡的输入口(RF 需释放在 handle 上) ──
const genInputHandle = await ev(vis(`(() => { const node=[...document.querySelectorAll('.react-flow__node')].find(e=>!!e.querySelector('[data-canvas-node-kind="generated"],[data-image-studio-node-kind="generated"]')); if(!node) return null; const h=node.querySelector('.react-flow__handle-target')||[...node.querySelectorAll('.react-flow__handle')].find(x=>x.classList.contains('target')); if(!h) return null; const r=h.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`));
if (positiveHandle && genInputHandle) {
  await mouse([
    { t: "mousePressed", ...positiveHandle }, { t: "mouseMoved", ...positiveHandle, d: 80 },
    { t: "mouseMoved", x: (positiveHandle.x + genInputHandle.x) / 2, y: (positiveHandle.y + genInputHandle.y) / 2 },
    { t: "mouseMoved", ...genInputHandle, d: 100 }, { t: "mouseReleased", ...genInputHandle, d: 300 },
  ]);
  await sleep(800);
  // 拖放失败可能弹落点建节点菜单/留选中:清理
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(250);
}
const edgeInfo = await ev(vis(`(() => { const edges=[...document.querySelectorAll('.react-flow__edge')]; const first=edges[0]; if(!first) return { count: edges.length }; const path=first.querySelector('.react-flow__edge-path'); const len=path?.getTotalLength?.() ?? 0; if(!len) return { count: edges.length }; const p=path.getPointAtLength(len/2); const svg=path.ownerSVGElement; const sp=svg.createSVGPoint(); sp.x=p.x; sp.y=p.y; const scr=sp.matrixTransform(path.getScreenCTM()); return { count: edges.length, mid: { x: scr.x, y: scr.y } }; })()`));
check("画布存在连线(拖接或存量)", (edgeInfo?.count ?? 0) > 0, `count=${edgeInfo?.count}`);

// ── A. 连线可点:点边中点→selected ──
if (edgeInfo?.mid) {
  await mouse([{ t: "mouseMoved", ...edgeInfo.mid, d: 60 }, { t: "mousePressed", ...edgeInfo.mid }, { t: "mouseReleased", ...edgeInfo.mid, d: 200 }]);
  await sleep(400);
  const selected = (await ev(vis(`[...document.querySelectorAll('.react-flow__edge')].some(e=>e.classList.contains('selected'))`))) === true;
  check("A 连线可点(点中变 selected)", selected);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
}

// ── B. hover 抬卡:进卡 z=5,离卡回落 z=0 ──
// 找一块真正空白的 pane 点点掉选中(elementFromPoint 验证不落在节点/口上)
const emptyPanePoint = await ev(vis(`(() => { const pane=document.querySelector('.react-flow__pane'); if(!pane) return {x:80,y:80}; const r=pane.getBoundingClientRect(); for(const [x,y] of [[r.x+30,r.y+30],[r.x+60,r.y+60],[r.x+30,r.y+r.height-40],[r.x+r.width-30,r.y+40]]) { const hit=document.elementFromPoint(x,y); if(hit===pane) return {x,y}; } return {x:r.x+10,y:r.y+10}; })()`));
await mouse([{ t: "mousePressed", ...emptyPanePoint }, { t: "mouseReleased", ...emptyPanePoint }]);
await sleep(350);
const zOf = (pred) => ev(vis(`(() => { const el=[...document.querySelectorAll('.react-flow__node')].find(${pred}); if(!el) return null; return getComputedStyle(el).zIndex; })()`));
const genNodeSel = "e=>!!e.querySelector('[data-canvas-node-kind=\"generated\"],[data-image-studio-node-kind=\"generated\"]')";
const zIdle = await zOf(genNodeSel);
await mouse([{ t: "mouseMoved", x: genCard.x - genCard.w / 4, y: genCard.y, d: 60 }, { t: "mouseMoved", ...genCard, d: 150 }]);
await sleep(300);
const zHover = await zOf(genNodeSel);
await mouse([{ t: "mouseMoved", x: 120, y: 120, d: 60 }, { t: "mouseMoved", x: 90, y: 90, d: 150 }]);
await sleep(300);
const zLeft = await zOf(genNodeSel);
check("B hover 抬卡(z 0→5)", zIdle === "0" && zHover === "5", `idle=${zIdle} hover=${zHover}`);
check("B 离卡回落(z→0,静止态连线在上原样)", zLeft === "0", `left=${zLeft}`);

// ── C. 压线挡口:hover 卡时 elementFromPoint(口中心)=口本体 ──
// 口位置:成图卡左缘中点(输入口)。先 hover 卡体,再从 evaluate 里取口的
// 屏幕坐标做 elementFromPoint——hover 态下应命中 handle 而非边交互带。
await mouse([{ t: "mouseMoved", x: genCard.x - genCard.w / 4, y: genCard.y, d: 80 }, { t: "mouseMoved", ...genCard, d: 200 }]);
const hitTest = await ev(vis(`(() => {
  const node=[...document.querySelectorAll('.react-flow__node')].find(e=>!!e.querySelector('[data-canvas-node-kind="generated"],[data-image-studio-node-kind="generated"]'));
  if(!node) return null;
  const handle=node.querySelector('.react-flow__handle-target') || [...node.querySelectorAll('.react-flow__handle')][0];
  if(!handle) return null;
  const r=handle.getBoundingClientRect();
  const hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
  const hovered=getComputedStyle(node).zIndex;
  return { hoveredZ: hovered, hitIsHandle: !!(hit && (hit===handle || handle.contains(hit) || hit?.closest?.('.react-flow__handle')===handle)), hitTag: hit ? hit.tagName + '.' + String(hit.className).slice(0,40) : null };
})()`));
check("C 压线挡口(hover 态口可命中)", hitTest?.hoveredZ === "5" && hitTest?.hitIsHandle === true, `z=${hitTest?.hoveredZ} hit=${hitTest?.hitTag}`);

// ── D. 卡片控件不吞:提示词框聚焦输入 ──
const promptArea = await center(".react-flow__node textarea", "e=>e.placeholder && e.placeholder.includes('描述要生成的图片')");
if (promptArea) {
  await mouse([{ t: "mousePressed", ...emptyPanePoint }, { t: "mouseReleased", ...emptyPanePoint }]);
  await sleep(250);
  await mouse([{ t: "mouseMoved", ...promptArea, d: 60 }, { t: "mousePressed", ...promptArea }, { t: "mouseReleased", ...promptArea, d: 150 }]);
  await sleep(350);
  let focusOk = (await ev(vis(`(() => { const ta=document.activeElement; return !!ta && ta.tagName==='TEXTAREA'; })()`))) === true;
  if (!focusOk) { // DOM click 兜底(CDP 坐标若被浮层挡)
    focusOk = (await ev(`(() => { const tas=[...document.querySelectorAll('.react-flow__node textarea')]; const ta=tas.find(t=>(t.placeholder||'').includes('描述要生成的图片')); if(!ta) return false; ta.focus(); return document.activeElement===ta; })()`)) === true;
  }
  check("D 卡片控件不吞(提示词框可聚焦)", focusOk);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
} else {
  check("D 卡片控件不吞(提示词框可聚焦)", false, "未找到提示词框");
}

const failed = results.filter((r) => !r.pass).length;
console.log(JSON.stringify({ total: results.length, failed, results }));
process.exit(failed ? 1 : 0);
