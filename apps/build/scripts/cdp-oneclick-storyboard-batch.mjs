/**
 * CDP 一键生图批量守护器(08-24 分镜全量审计修复配套)。
 *
 * 驱动应用原生「一键生图」批量入口(与分镜面板同一 hook 实例,e9b0d41):
 * 串行生成所有未生成分镜、已生成自动跳过、失败跳过。本脚本只负责:
 * 打开项目→进入工作流画布→点击节点卡批量按钮→轮询 done/total 直到结束。
 *
 * 用法: node cdp-oneclick-storyboard-batch.mjs [--timeout-min 60]
 * 前置: 应用以 MYSTUDIO_REMOTE_DEBUG=1 启动(CDP 9222)。
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const TIMEOUT_MIN = flag("timeout-min", 75);

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) throw new Error("找不到页面 target");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("cdp-timeout")); }, 30_000);
  pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.on("open", r));
const evaluate = async (expression) => {
  try {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  } catch { return undefined; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

// 1) 确保项目已打开(dashboard 卡片点击)
if (await evaluate(`document.querySelectorAll('.dashboard-project-card').length > 0`)) {
  await evaluate(`document.querySelector('.dashboard-project-card')?.click()`);
  log("点击项目卡片,等待载入…");
  await sleep(9000);
}
// 2) 进入工作流 tab
await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
await sleep(2500);

// 3) 等批量按钮就绪(fresh boot 水合慢,轮询至 90s;含编辑视图「返回」校正)
const findBatchButton = () => evaluate(`(() => {
  const b = document.querySelector('[data-storyboard-node-batch-generate]');
  return b ? true : false;
})()`);
{
  const waitDeadline = Date.now() + 90_000;
  while (Date.now() < waitDeadline && !(await findBatchButton())) {
    // 编辑视图→返回;或切工作流 tab(幂等)
    await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回'); if(b){b.click();return true;} return false; })()`);
    await sleep(2500);
    await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
    await sleep(4000);
  }
}
if (!(await findBatchButton())) {
  log("⚠️ 90s 内未等到一键生图入口(可能全部已生成或 UI 变化)");
  process.exit(2);
}

// 4) 点击启动
const started = await evaluate(`(() => {
  const b = document.querySelector('[data-storyboard-node-batch-generate]');
  if (!b) return false;
  b.click();
  return true;
})()`);
if (!started) { log("⚠️ 按钮不可点"); process.exit(3); }
log("已点击一键生图,开始守护…");

// 5) 轮询进度直到结束
const deadline = Date.now() + TIMEOUT_MIN * 60_000;
let last = "";
while (Date.now() < deadline) {
  await sleep(15_000);
  const state = await evaluate(`(() => {
    const run = document.querySelector('[data-storyboard-node-batch-running]')
      || [...document.querySelectorAll('span,button')].find(x => /一键生图\\s*\\d+\\/\\d+/.test(x.textContent || ''));
    if (!run) return { phase: 'idle' };
    const m = (run.textContent || '').match(/(\\d+)\\/(\\d+)/);
    if (!m) return { phase: 'running', text: run.textContent.trim().slice(0, 40) };
    return { phase: 'running', done: Number(m[1]), total: Number(m[2]) };
  })()`);
  const line = JSON.stringify(state);
  if (line !== last) { log(line); last = line; }
  if (state?.phase === "idle") {
    // 结束:running 元素消失。确认没有失败弹层
    log("批量运行指示消失,判定结束。");
    break;
  }
  if (state?.done != null && state?.total != null && state.done >= state.total) {
    log(`完成 ${state.done}/${state.total}`);
    await sleep(3000);
    break;
  }
}
log("守护结束。请复查 store。");
process.exit(0);
