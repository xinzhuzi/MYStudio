/**
 * CDP 批量分镜生图驱动器(08-23 自动化生成第一章视频·阶段一)。
 *
 * 对无 mediaPath 的分镜逐镜驱动:分镜面板 tile 点击(画布自动建绑定工作流)
 * →「运行生成」→轮询完成(「写回目标」按钮解禁)→「写回目标」→返回→下一镜。
 * 可断点续跑(重跑自动跳过已有 mediaPath);单镜失败重试一次后跳过并记录。
 *
 * 用法:node cdp-batch-storyboard-images.mjs [--start 44] [--end 82] [--limit 1] [--dry]
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/zhengbingjin/Project/Github/MYStudio/apps/");
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const START = flag("start", 44);
const END = flag("end", 82);
const LIMIT = flag("limit", 999);
const DRY = args.includes("--dry");

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) throw new Error("找不到页面 target");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp-timeout')); }, 15_000);
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

// 确保在工作区+工作流 tab(幂等)
async function ensureWorkflowTab() {
  if (!(await evaluate(`document.querySelectorAll('.studio-nav-button').length > 5`))) {
    await evaluate(`document.querySelector('.dashboard-project-card')?.click()`);
    await sleep(9000);
  }
  await evaluate(`[...document.querySelectorAll('.studio-nav-button')].find(b=>b.textContent.trim()==='工作流')?.click()`);
  await sleep(2500);
}

// 找分镜面板里指定镜号的 tile 并点击;返回点击前 mediaPath 状态
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

// 画布内:等就绪→运行生成
async function clickRunGenerate() {
  return evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const run = btns.find(b => b.textContent.trim() === '运行生成' && !b.disabled);
    if (!run) return { ok: false, why: 'busy-or-missing' };
    run.click();
    return { ok: true };
  })()`);
}

// 轮询「写回目标」按钮状态:disabled=生成中/无结果;enabled=有 resultUrl 可写回
async function writebackState() {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '写回目标');
    if (!btn) return 'missing';
    return btn.disabled ? 'disabled' : 'ready';
  })()`);
}

async function clickWriteback() {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '写回目标' && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

async function clickBack() {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '返回');
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
}

// 分镜面板该镜是否已有图(mediaPath):tile 里 img 存在
async function tileHasImage(n) {
  return evaluate(`(() => {
    const panel = document.querySelector('[data-flow-node-id="storyboard"]');
    if (!panel) return null;
    const groups = [...panel.querySelectorAll('button')].filter(el => /进入分镜图片工作流/.test(el.textContent || ''));
    const target = groups.find(el => {
      const sib = el.closest('div')?.textContent || el.parentElement?.textContent || '';
      const m = sib.match(/S\\s*0*(\\d+)/);
      return m && Number(m[1]) === ${n};
    });
    if (!target) return null;
    // 最小 tile 容器 = 向上第一个只含单个 Sxx 的祖先(closest card 会爬到整面板误判)
    let el = target;
    while (el && el.parentElement) {
      el = el.parentElement;
      const all = (el.textContent || '').match(/S0*(\\d+)(?!\\d)/g);
      if (all && all.length === 1) break;
    }
    return Boolean((el || target).querySelector('img'));
  })()`);
}

async function generateOneShot(n) {
  await ensureWorkflowTab();
  const has = await tileHasImage(n);
  if (has === true) return "skip-has-image";
  if (has === null) return "fail-no-panel";
  const clicked = (await clickStoryboardTile(n)) ?? { ok: false, why: "eval-timeout" };
  if (!clicked.ok) return `fail-click-${clicked.why}`;
  await sleep(3500); // 画布建流
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const run = (await clickRunGenerate()) ?? { ok: false, why: "eval-timeout" };
    if (!run.ok && run.why === "busy-or-missing") {
      // 可能上一次生成仍在跑或按钮没渲染:等待后再试
      await sleep(8000);
      continue;
    }
    if (!run.ok) return `fail-run-${run.why}`;
    // 轮询写回按钮就绪(生成完成),上限 8 分钟
    let state = "disabled";
    for (let i = 0; i < 96; i += 1) {
      await sleep(5000);
      state = await writebackState();
      if (state === "ready") break;
      if (state === "missing") return "fail-canvas-lost";
    }
    if (state !== "ready") return "timeout-generating";
    let wrote = await clickWriteback();
    if (!wrote) { await sleep(5000); wrote = await clickWriteback(); }
    if (!wrote) return "fail-writeback";
    await sleep(4000); // 写回落库
    return "ok";
  }
  return "fail-run-retries";
}

await ensureWorkflowTab();
log(`批量生图驱动:镜 ${START}-${END},limit=${LIMIT}${DRY ? " [dry]" : ""}`);
let done = 0; let skipped = 0; const failures = [];
const restartApp = async () => {
  console.log("  [maint] 预防性重启应用...");
  const { execFile } = await import("node:child_process");
  const exec = (cmd, args) => new Promise((r) => { import("node:child_process").then(m => m.execFile(cmd, args, () => r())); });
  await exec("osascript", ["-e", 'quit app "漫影工作室"']);
  await sleep(4000);
  await exec("pkill", ["-x", "漫影工作室"]).catch(() => {});
  await sleep(2000);
  const fs = await import("node:fs");
  const os = await import("node:os");
  try { fs.rmSync(process.env.HOME + "/Library/Application Support/漫影工作室/SingletonLock", { force: true }); } catch {}
  const { spawn } = await import("node:child_process");
  spawn("/Applications/漫影工作室.app/Contents/MacOS/漫影工作室", [], {
    detached: true, stdio: "ignore",
    env: { ...process.env, MYSTUDIO_REMOTE_DEBUG: "1" },
  }).unref();
  await sleep(25000);
};
for (let n = START; n <= END && done < LIMIT; n += 1) {
  if (n > START && (n - START) % 5 === 0) await restartApp();
  if (DRY) {
    const has = await tileHasImage(n);
    log(`[dry] 镜 ${n}: hasImage=${has}`);
    continue;
  }
  log(`镜 ${n}: 开始`);
  let result;
  try { result = await generateOneShot(n); } catch (e) { result = 'fail-cdp-' + (e?.message || e); }
  log(`镜 ${n}: ${result}`);
  if (result === "ok") done += 1;
  else if (result === "skip-has-image") skipped += 1;
  else failures.push({ shot: n, result });
  await clickBack(); // 无论成败都回工作流
  await sleep(2000);
}
log(`完成:成功 ${done},跳过(已有图) ${skipped},失败 ${failures.length}`);
if (failures.length) console.log(JSON.stringify(failures));
ws.close();
process.exit(failures.length ? 2 : 0);
