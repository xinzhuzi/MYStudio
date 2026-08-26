/** 自愈批量点击器 v2:整页 reload(重挂载吃水合后 store)→进项目→等按钮→点击。 */
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) process.exit(1);
const { createRequire } = await import("node:module");
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let seq = 0; const handlers = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m.result); handlers.delete(m.id); } });
const send2 = (method, params = {}) => new Promise((resolve) => { const id = 1000 + (++seq); handlers.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (e) => { try { return (await Promise.race([send2("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }), new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 25000))]))?.result?.value; } catch { return undefined; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 先看是否已在项目里(有工作流 nav);否则 reload 后进项目
const inApp = await evaluate(`document.querySelectorAll('.studio-nav-button').length > 5`);
await evaluate(`location.reload()`);
await sleep(14000);
if (await evaluate(`document.querySelectorAll('.dashboard-project-card,[data-project-card]').length`) > 0) {
  await evaluate(`document.querySelector('[data-project-card],.dashboard-project-card')?.click()`);
  await sleep(15000);
}
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
await sleep(4000);
for (let i = 0; i < 12; i++) {
  if (await evaluate(`!!document.querySelector('[data-storyboard-node-batch-generate]')`) === true) break;
  if (i === 2) {
    // 视图纠偏: 分镜面板/图像工作流视图 → 返回节点图
    await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回节点图'); if(b) b.click(); return true; })()`);
    await sleep(4000);
  }
  await sleep(5000);
}
const clicked = await evaluate(`(() => {
  const b = document.querySelector('[data-storyboard-node-batch-generate]');
  if (b) { b.click(); return 'node'; }
  // 分镜面板视图回退: 文本匹配的一键生图按钮(非运行态)
  const p = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('一键生图') && !x.disabled);
  if (p) { p.click(); return 'panel'; }
  return false;
})()`);
console.log("clicked:", clicked, new Date().toISOString().slice(11, 19));
process.exit(clicked ? 0 : 2);
