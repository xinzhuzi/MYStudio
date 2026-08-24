/**
 * CDP 指定镜重生成驱动(08-24 审计修复配套:L3 定罪镜 S56/S70/S75 等)。
 *
 * 对已有图但内容定罪的镜:tile 点击(打开绑定工作流)→「运行生成」→
 * 轮询「写回目标」解禁→「写回目标」→「返回」→下一镜。
 * 复用 08-23 cdp-batch-storyboard-images.mjs 的已验证流程。
 *
 * 用法: node cdp-regen-storyboard-shots.mjs --shots 56,70,75 [--limit N]
 * 前置: 应用以 MYSTUDIO_REMOTE_DEBUG=1 启动,且当前在项目内。
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const args = process.argv.slice(2);
const shotsArg = args[args.indexOf("--shots") + 1] ?? "56,70,75";
const SHOTS = shotsArg.split(",").map(Number).filter(Boolean);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 999;

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) throw new Error("找不到页面 target");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("cdp-timeout")); }, 30_000);
  pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
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

async function ensureWorkflowTab() {
  if (!(await evaluate(`document.querySelectorAll('.studio-nav-button').length > 5`))) {
    await evaluate(`document.querySelector('.dashboard-project-card')?.click()`);
    await sleep(9000);
  }
  await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
  await sleep(2500);
}

async function clickStoryboardTile(n) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-flow-node-id]')];
    const panel = nodes.find(el => el.getAttribute('data-flow-node-id') === 'storyboard');
    if (!panel) return { ok: false, why: 'no-panel' };
    const tiles = [...panel.querySelectorAll('button')];
    const target = tiles.find(el => /进入分镜图片工作流/.test(el.textContent || '') && (() => {
      const sib = el.closest('div')?.textContent || el.parentElement?.textContent || '';
      const m = sib.match(/S\\s*0*(\\d+)/);
      return m && Number(m[1]) === ${n};
    })());
    if (!target) return { ok: false, why: 'no-tile' };
    target.click();
    return { ok: true };
  })()`);
}

const runState = () => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '写回目标');
  if (!btn) return 'missing';
  return btn.disabled ? 'disabled' : 'ready';
})()`);

let done = 0;
for (const n of SHOTS) {
  if (done >= LIMIT) break;
  await ensureWorkflowTab();
  const click = await clickStoryboardTile(n);
  if (!click?.ok) { log(`S${n}: tile 点击失败 ${click?.why},跳过`); continue; }
  await sleep(6000);
  // 若打开的是已就绪工作流,直接点运行生成(会以现参考+提示词重跑)
  const run = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const run2 = btns.find(b => b.textContent.trim() === '运行生成' && !b.disabled);
    if (!run2) return false;
    run2.click();
    return true;
  })()`);
  if (!run) { log(`S${n}: 运行生成不可用,跳过`); await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回')?.click()`); continue; }
  log(`S${n}: 已开始生成,轮询写回…`);
  const deadline = Date.now() + 8 * 60_000;
  let state = "disabled";
  while (Date.now() < deadline) {
    await sleep(12_000);
    state = await runState();
    if (state === "ready" || state === "missing") break;
  }
  if (state !== "ready") { log(`S${n}: 写回未就绪(${state}),放弃本镜`); }
  else {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '写回目标' && !b.disabled)?.click()`);
    await sleep(2500);
    log(`S${n}: 已写回 ✓`);
    done += 1;
  }
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回')?.click()`);
  await sleep(2500);
}
log(`重生成结束: 成功 ${done}/${SHOTS.length}`);
process.exit(0);
