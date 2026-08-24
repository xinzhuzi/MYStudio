/**
 * CDP 实证:装机版 asset-file:// 虚拟引用显示链(08-24 路径裁定装机验证)。
 * 前置:MYSTUDIO_REMOTE_DEBUG=1 启动装机版。导航 主页→工作流→资产,统计
 * asset-file:// <img> 的加载成功率。只读探针,无写入。
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) throw new Error("找不到页面 target");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("cdp-timeout")); }, 15_000);
  pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.on("open", r));
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click(); 'ok'`);
await sleep(3000);
await evaluate(`[...document.querySelectorAll('button,[role=tab]')].find(b=>b.textContent.trim()==='资产')?.click(); 'ok'`);
await sleep(3500);
await sleep(1500);

const stats = await evaluate(`(() => {
  const imgs=[...document.querySelectorAll('img')];
  const af=imgs.filter(i=>(i.getAttribute('src')||'').startsWith('asset-file://'));
  return {
    route: document.querySelector('.studio-nav-button.active')?.textContent?.trim() || location.hash || '?',
    totalImgs: imgs.length,
    assetFileCount: af.length,
    assetFileLoaded: af.filter(i=>i.complete&&i.naturalWidth>0).length,
    sample: af[0]?.getAttribute('src')?.slice(0,96)||null,
    sampleNaturalWidth: af[0]?.naturalWidth ?? null
  };
})()`);
console.log(JSON.stringify(stats, null, 1));
ws.close();
process.exit(0);
