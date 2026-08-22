#!/usr/bin/env node
/**
 * CDP 驱动已装应用「漫影工作室」,按正门流程依序重生成道劫第1章剧本三阶段:
 * 故事骨架 → 改编策略 → 剧本(真实点击 ScriptTab「一键生成」)。
 *
 * 用法:先 MYSTUDIO_REMOTE_DEBUG=1 启动应用,再 node cdp-regen-script-stages.mjs
 * 依据 .zcode 记忆 installed-app-cdp-probing:坐标点击(CDP Input)最可信;
 * 取证以 DOM/Runtime.evaluate 为准;完成判据=按钮态+store 分片新条目双证。
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_BASE = "http://127.0.0.1:9222";
const AWD_DIR =
  "/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001";
// 增量写会换哈希文件名,动态取 mtime 最新的 agent-work-data-*.json
function awdPath() {
  const cands = readdirSync(AWD_DIR)
    .filter((f) => /^agent-work-data-.*\.json$/.test(f))
    .map((f) => ({ f, m: statSync(`${AWD_DIR}/${f}`).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!cands.length) throw new Error("no agent-work-data shard in " + AWD_DIR);
  return `${AWD_DIR}/${cands[0].f}`;
}
const STAGES = [
  { n: 1, key: "storySkeleton", tab: "1. 故事骨架", label: "故事骨架" },
  { n: 2, key: "adaptationStrategy", tab: "2. 改编策略", label: "改编策略" },
  { n: 3, key: "scriptDraft", tab: "3. 剧本", label: "剧本" },
];
const STAGE_TIMEOUT_MS = 15 * 60 * 1000;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function storeVersions() {
  try {
    const d = JSON.parse(readFileSync(awdPath(), "utf8"));
    const awd = (d.state ?? d).agentWorkData ?? [];
    const out = {};
    for (const x of awd) {
      (out[x.key] ??= []).push(x.updatedAt);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
    return out;
  } catch (e) {
    return { __error: String(e) };
  }
}

async function getPageWs() {
  const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target: " + JSON.stringify(list.map((t) => t.type)));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  return ws;
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    async eval(expression) {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error("eval exception: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    },
    async clickAt(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type, x: Math.round(x), y: Math.round(y),
          button: "left", clickCount: 1,
        });
        await sleep(60);
      }
    },
    // 按选择器找元素中心并坐标点击;clickable=向上找最近的可点祖先
    async clickSelector(selector, { timeout = 20000, textFilter } = {}) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const hit = await this.eval(`(() => {
          const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
          const el = ${textFilter ? `els.find(e => (${textFilter})(e.textContent||''))` : "els[0]"};
          if (!el) return null;
          const t = el.closest('button,[role="menuitem"],[role="tab"],a') || el;
          const r = t.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return null;
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (t.textContent||'').trim().slice(0,60) };
        })()`);
        if (hit) {
          await this.clickAt(hit.x, hit.y);
          return hit;
        }
        await sleep(700);
      }
      throw new Error(`clickSelector timeout: ${selector}`);
    },
  };
}

const visible = (expr) => `(() => { try { return ${expr}; } catch (e) { return null; } })()`;

async function waitFor(client, expr, desc, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await client.eval(visible(expr));
    if (v) return v;
    await sleep(800);
  }
  throw new Error("waitFor timeout: " + desc);
}

async function grabToasts(client) {
  return (await client.eval(visible(`[...document.querySelectorAll('[data-sonner-toast],.sonner-toast')].map(t=>(t.textContent||'').trim()).join(' | ')`))) || "";
}

async function main() {
  const versions0 = storeVersions();
  if (versions0.__error) throw new Error("store read failed: " + versions0.__error);
  log("store baseline versions:", Object.fromEntries(STAGES.map((s) => [s.key, versions0[s.key]?.length ?? 0])));

  const ws = await getPageWs();
  const c = makeClient(ws);
  await c.send("Runtime.enable");

  // A. Dashboard → 道劫项目卡(若已在工作区则跳过;Dashboard 侧栏也是 .studio-nav-button,须按「工作流」文本判)
  const inWorkspace = await c.eval(
    visible(`!![...document.querySelectorAll('.studio-nav-button')].find(b=>(b.textContent||'').includes('工作流'))`),
  );
  if (!inWorkspace) {
    log("clicking 道劫 project card on dashboard…");
    await c.clickSelector(".dashboard-project-card", { timeout: 45000, textFilter: `t => t.includes('道劫')` });
    await waitFor(
      c,
      `!![...document.querySelectorAll('.studio-nav-button')].find(b=>(b.textContent||'').includes('工作流'))`,
      "workspace sidebar",
      30000,
    );
  }
  log("in workspace.");

  // B. 侧边栏 → 工作流(点击后验证 active 态,被吞则重试)
  const navActiveExpr = `[...document.querySelectorAll('.studio-nav-button')].filter(b=>b.getAttribute('data-active')||/active/.test(b.className)).map(b=>(b.textContent||'').trim()).join(',')`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const active = await c.eval(visible(navActiveExpr));
    if ((active || "").includes("工作流")) break;
    log(`clicking 工作流 nav (attempt ${attempt}, active="${active}")…`);
    await c.clickSelector(".studio-nav-button", { textFilter: `t => t.includes('工作流')` });
    await sleep(2500);
  }
  await waitFor(c, `(${navActiveExpr}).includes('工作流')`, "工作流 nav active", 30000);
  log("workflow view loaded.");

  // C. 切换阶段 → 剧本生产阶段(若已激活则跳过)
  const scriptActive = () =>
    c.eval(visible(`!![...document.querySelectorAll('button')].find(b=>/^1\\. 故事骨架/.test((b.textContent||'').trim()))`));
  if (!(await scriptActive())) {
    await c.clickSelector("button", { textFilter: `t => t.includes('切换阶段')` });
    await c.clickSelector('[role="menuitem"]', { timeout: 10000, textFilter: `t => t.includes('剧本生产阶段')` });
  }
  await waitFor(c, `!![...document.querySelectorAll('button')].find(b=>/^1\\. 故事骨架/.test((b.textContent||'').trim()))`, "script stage tabs", 20000);
  log("script stage active.");

  const results = [];
  const fromIdx = Math.max(0, (parseInt(process.argv[2] ?? "1", 10) || 1) - 1);
  for (const stage of STAGES.slice(fromIdx)) {
    const before = storeVersions()[stage.key]?.length ?? 0;
    // 1) 激活阶段 tab
    await c.clickSelector("button", { textFilter: `t => /^${stage.n}\\\\./.test(t.trim()) || t.trim().startsWith('${stage.tab}')` });
    await waitFor(c, `[...document.querySelectorAll('button')].some(b=>(b.textContent||'').trim().startsWith('${stage.tab}')&&b.className.includes('border-primary'))`, `stage tab active ${stage.tab}`, 15000);
    // 2) 控制页 → 一键生成
    await c.clickSelector(".script-stage-control-tabs button", { textFilter: `t => t.includes('一键生成')` });
    await waitFor(c, `!!document.querySelector('.script-stage-detail-panel')`, "generate panel", 10000);
    // 3) 生成按钮(控制页之外那个「一键生成」)
    const genBtn = await c.clickSelector(".script-stage-detail-panel button", {
      textFilter: `t => t.includes('一键生成') && !t.includes('编辑')`,
    });
    log(`[${stage.key}] generate clicked ("${genBtn.text}"). streaming…`);
    // 4) 轮询:按钮态 + store 新条目 + toast
    const t0 = Date.now();
    let done = false, failToast = "", lastState = "";
    while (Date.now() - t0 < STAGE_TIMEOUT_MS) {
      await sleep(3000);
      const state = await c.eval(visible(`(() => {
        const btns=[...document.querySelectorAll('.script-stage-detail-panel button')];
        const b=btns.find(x=>(x.textContent||'').includes('一键生成')||(x.textContent||'').includes('生成中'));
        return b ? (b.textContent||'').trim() : '(btn gone)';
      })()`));
      const toasts = await grabToasts(c);
      const nowCount = storeVersions()[stage.key]?.length ?? 0;
      if (nowCount > before) {
        log(`[${stage.key}] store entry +${nowCount - before} (v${nowCount}), btn="${state}", toasts="${toasts}"`);
        done = true; break;
      }
      if (/失败|错误|Error/.test(toasts)) failToast = toasts;
      if (state !== lastState) { lastState = state; log(`[${stage.key}] btn="${state}" (${Math.round((Date.now()-t0)/1000)}s)`); }
      if (/生成中/.test(state)) continue; // 仍在流式
      // 按钮恢复:成功 toast(「XX」已生成)或新 store 条目都算完成,给落盘 15s 缓冲
      if (Date.now() - t0 > 15000) {
        for (let g = 0; g < 5 && !done; g++) {
          await sleep(3000);
          if ((storeVersions()[stage.key]?.length ?? 0) > before) done = true;
        }
        if (!done && toasts.includes("已生成")) { done = true; log(`[${stage.key}] accepted by success toast: ${toasts}`); }
        if (!done) failToast = failToast || toasts || "button re-enabled without new store entry";
        break;
      }
    }
    results.push({ stage: stage.key, done, failToast });
    log(`[${stage.key}] ${done ? "OK" : "FAIL: " + failToast}`);
    if (!done) break;
    await sleep(2500);
  }

  // 汇总:各阶段最新版本时间+长度
  const v = storeVersions();
  const summary = {};
  for (const s of STAGES) {
    const arr = v[s.key] ?? [];
    summary[s.key] = { versions: arr.length, latest: arr.length ? new Date(arr[arr.length - 1]).toLocaleString("zh-CN") : "-" };
  }
  log("SUMMARY", JSON.stringify(summary, null, 1));
  console.log("RESULT_JSON " + JSON.stringify({ results, summary }));
  c.close();
  process.exit(results.every((r) => r.done) ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
