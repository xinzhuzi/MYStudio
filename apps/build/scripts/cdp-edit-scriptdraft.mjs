#!/usr/bin/env node
/**
 * CDP 驱动「可编辑」正门修订:把 /tmp/scriptdraft-v9.txt 注入剧本编辑器并保存为新版本。
 * 路径:Dashboard→道劫→工作流→(切换阶段)剧本生产阶段→3.剧本→一键生成页→可编辑
 *      →CodeMirror 全选替换→保存→store 验证 scriptDraft 新版本。
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const NEW_TEXT = readFileSync("/tmp/scriptdraft-v9.txt", "utf8");
const AWD_DIR = "/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
function storeCount(key) {
  try {
    const cands = readdirSync(AWD_DIR).filter((f) => /^agent-work-data-.*\.json$/.test(f))
      .map((f) => ({ f, m: statSync(`${AWD_DIR}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m);
    const d = JSON.parse(readFileSync(`${AWD_DIR}/${cands[0].f}`, "utf8"));
    return (d.state ?? d).agentWorkData.filter((x) => x.key === key).length;
  } catch { return -1; }
}

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r, rej) => { ws.once("open", r); ws.once("error", rej); });
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? null : r.result.value; };
const domClick = async (sel, pred) => (await ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=els.find(${pred||"e=>true"}); if(!el) return null; (el.closest('button,[role="menuitem"]')||el).click(); return true; })()`)) === true;
const coordAt = async (x, y) => { for (const t of ["mousePressed","mouseReleased"]) { await send("Input.dispatchMouseEvent", { type: t, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 }); await sleep(90); } };

async function ensureScriptStage() {
  for (let i = 0; i < 30; i++) {
    if (await ev(vis(`[...document.querySelectorAll('button')].some(b=>/^1\\. 故事骨架/.test((b.textContent||'').trim()))`))) return true;
    if (await ev(vis(`!!document.querySelector('.dashboard-project-card')`))) {
      await domClick(".dashboard-project-card", `e=>(e.textContent||'').includes('道劫')`);
      let stable = 0;
      for (let k = 0; k < 14 && stable < 3; k++) { await sleep(1500); stable = (await ev(vis(`!!document.querySelector('.dashboard-project-card')`))) ? 0 : stable + 1; }
      continue;
    }
    const sw = await ev(vis(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('切换阶段')); if(!b) return null; const r=b.getBoundingClientRect(); return r.width>2?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`));
    if (sw) {
      await coordAt(sw.x, sw.y); await sleep(900);
      const mi = await ev(vis(`(() => { const m=[...document.querySelectorAll('[role="menuitem"]')].find(x=>(x.textContent||'').includes('剧本生产阶段')); if(!m) return null; const r=m.getBoundingClientRect(); return r.width>2?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`));
      if (mi) { await coordAt(mi.x, mi.y); await sleep(2200); continue; }
    }
    await domClick(".studio-nav-button", `e=>(e.textContent||'').includes('工作流')`);
    await sleep(2200);
  }
  return false;
}

if (!(await ensureScriptStage())) throw new Error("cannot reach script stage");
log("script stage reached. scriptDraft versions before:", storeCount("scriptDraft"));

// 3.剧本 tab → 一键生成控制页 → 可编辑
if (!(await domClick("button", `e=>/^3\\. 剧本/.test((e.textContent||'').trim())`))) throw new Error("stage tab 3 not found");
await sleep(700);
if (!(await domClick(".script-stage-control-tabs button", `e=>(e.textContent||'').includes('一键生成')`))) throw new Error("control tab not found");
await sleep(700);
if (!(await domClick(".script-stage-detail-panel button", `e=>(e.textContent||'').includes('可编辑')`))) throw new Error("可编辑 btn not found");
await sleep(1500);

// CodeMirror 注入:聚焦→Cmd+A→insertText
const cmOk = await ev(vis(`(() => { const c=document.querySelector('.cm-content'); if(!c) return false; c.focus(); return document.activeElement===c; })()`));
if (!cmOk) throw new Error("cm-content not focusable");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4, nativeVirtualKeyCode: 65 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4, nativeVirtualKeyCode: 65 });
await sleep(400);
await send("Input.insertText", { text: NEW_TEXT });
await sleep(1200);
// 校验编辑器内容已含修订标记
const markerOk = await ev(vis(`!!(document.querySelector('.cm-content')?.textContent||'').includes('从头到脚记了一遍')`));
log("editor contains revision marker:", markerOk);
if (!markerOk) throw new Error("injection failed");

// 保存
if (!(await domClick("button", `e=>(e.textContent||'').trim()==='保存'`))) throw new Error("保存 btn not found");
await sleep(2500);

const after = storeCount("scriptDraft");
log("scriptDraft versions after:", after);
console.log("RESULT_JSON " + JSON.stringify({ ok: after > 0 ? true : false, before: null, after }));
ws.close();
process.exit(0);
