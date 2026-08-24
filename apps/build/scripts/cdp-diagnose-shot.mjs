/** CDP 单镜重生成+console 捕获(失败镜根因诊断)。用法: node cdp-diagnose-shot.mjs 14 */
import { createRequire } from "node:module";
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const N = Number(process.argv[2] || 14);

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map(); const consoleLogs = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("cdp-timeout")); }, 30_000);
  pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    consoleLogs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 220));
  }
  if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level)) {
    consoleLogs.push(`[log:${m.params.entry.level}] ` + (m.params.entry.text || "").slice(0, 220));
  }
});
await new Promise((r) => ws.on("open", r));
await send("Runtime.enable"); await send("Log.enable");
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (l) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${l}`);

// 进入工作流
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
await sleep(2500);
// tile 点击
const click = await evaluate(`(() => {
  const panel = [...document.querySelectorAll('[data-flow-node-id]')].find(el => el.getAttribute('data-flow-node-id') === 'storyboard');
  if (!panel) return { ok: false, why: 'no-panel' };
  const target = [...panel.querySelectorAll('button')].find(el => /进入分镜图片工作流/.test(el.textContent || '') && (() => {
    const sib = el.closest('div')?.textContent || el.parentElement?.textContent || '';
    const m = sib.match(/S\\s*0*(\\d+)/);
    return m && Number(m[1]) === ${N};
  })());
  if (!target) return { ok: false, why: 'no-tile' };
  target.click();
  return { ok: true };
})()`);
log(`tile click: ${JSON.stringify(click)}`);
await sleep(6000);
// 读画布状态:提示词/参考/按钮
const canvasState = await evaluate(`(() => {
  const runBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '运行生成' && !b.disabled);
  const wb = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '写回目标');
  const refs = [...document.querySelectorAll('*')].filter(e => e.className && String(e.className).includes && /reference/i.test(String(e.className))).length;
  return { runAvailable: !!runBtn, writeback: wb ? (wb.disabled ? 'disabled' : 'ready') : 'missing', refNodes: refs };
})()`);
log(`canvas: ${JSON.stringify(canvasState)}`);
const run = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='运行生成'&&!b.disabled); if(!b) return false; b.click(); return true; })()`);
log(`run clicked: ${run}`);
// 轮询 4 分钟
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  await sleep(10_000);
  const st = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='写回目标'); return b ? (b.disabled ? 'disabled' : 'ready') : 'missing'; })()`);
  log(`writeback=${st} | console尾3: ${consoleLogs.slice(-3).join(' || ') || '(无)'}`);
  if (st === 'ready' || st === 'missing') break;
}
consoleLogs.forEach((l) => console.log('CONSOLE', l));
process.exit(0);
