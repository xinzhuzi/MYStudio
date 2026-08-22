#!/usr/bin/env node
/**
 * dev 模式(HMR 页面 reload 常发)容错版:CDP 驱动「漫影工作室」按正门流程重生成剧本三阶段。
 * - 导航全部用 DOM click(React onClick 直通,坐标点击在 dev 侧边栏不稳)
 * - 每步自愈:reload 弹回 Dashboard/概览时自动重新进入
 * - 阶段一发起前先验证 AI提示词面板含 原著圣经/作者偏好(所见即所发)
 * - 完成判据=store 分片新增版本条目;单阶段失败(含 reload 中断)自动重试
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_BASE = "http://127.0.0.1:9222";
const AWD_DIR =
  "/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001";
const STAGES = [
  { n: 1, key: "storySkeleton", tab: "1. 故事骨架" },
  { n: 2, key: "adaptationStrategy", tab: "2. 改编策略" },
  { n: 3, key: "scriptDraft", tab: "3. 剧本" },
];
const STAGE_TIMEOUT_MS = 15 * 60 * 1000;
const STAGE_MAX_RETRY = 3;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function awdPath() {
  const cands = readdirSync(AWD_DIR)
    .filter((f) => /^agent-work-data-.*\.json$/.test(f))
    .map((f) => ({ f, m: statSync(`${AWD_DIR}/${f}`).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!cands.length) throw new Error("no agent-work-data shard");
  return `${AWD_DIR}/${cands[0].f}`;
}
function storeVersions() {
  try {
    const d = JSON.parse(readFileSync(awdPath(), "utf8"));
    const awd = (d.state ?? d).agentWorkData ?? [];
    const out = {};
    for (const x of awd) (out[x.key] ??= []).push(x.updatedAt);
    for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
    return out;
  } catch {
    return {};
  }
}

async function getClient() {
  const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    perMessageDeflate: false,
    maxPayload: 256 * 1024 * 1024,
  });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
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
    async ev(expression) {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) return null;
      return r.result.value;
    },
    async domClick(selector, pred = "e=>true", label = selector) {
      return this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="menuitem"]') || el;
        t.click();
        return (t.textContent || '').trim().slice(0, 40);
      })()`) ?? label;
    },
    // 坐标点击(可信事件):Dashboard 项目卡等带 pointerdown 门链的控件必须走这条路
    async coordAt(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type, x: Math.round(x), y: Math.round(y),
          button: "left", clickCount: 1,
        });
        await sleep(80);
      }
      return true;
    },
    async coordClick(selector, pred = "e=>true") {
      const rect = await this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="menuitem"]') || el;
        const r = t.getBoundingClientRect();
        return r.width > 2 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      })()`);
      if (!rect) return false;
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type, x: Math.round(rect.x), y: Math.round(rect.y),
          button: "left", clickCount: 1,
        });
        await sleep(80);
      }
      return true;
    },
  };
}

const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;

async function ensureScriptStage(c) {
  let lastState = "";
  for (let i = 0; i < 30; i++) {
    // 已在剧本阶段?
    if (await c.ev(vis(`[...document.querySelectorAll('button')].some(b=>/^1\\. 故事骨架/.test((b.textContent||'').trim()))`)))
      return true;
    const dash = await c.ev(vis(`!!document.querySelector('.dashboard-project-card')`));
    const state = dash ? "dashboard" : "workspace";
    if (state !== lastState) { lastState = state; log(`ensure[${i}] at ${state}`); }
    // Dashboard → 进项目(卡片:DOM click 稳定,坐标/合成序列均可能被 pointerdown 门链吞)
    if (dash) {
      await c.domClick(".dashboard-project-card", `e=>(e.textContent||'').includes('道劫')`);
      // 实测进入后有一次自发弹回(workspace→dashboard→workspace,~6s 稳定),静置到双检稳定
      let stable = 0;
      for (let k = 0; k < 14 && stable < 2; k++) {
        await sleep(1500);
        const d2 = await c.ev(vis(`!!document.querySelector('.dashboard-project-card')`));
        stable = d2 ? 0 : stable + 1;
      }
      continue;
    }
    // 工作区 → 「切换阶段」下拉(Radix 需坐标点击) → 剧本生产阶段
    const sw = await c.ev(vis(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('切换阶段')); if(!b) return null; const r=b.getBoundingClientRect(); return r.width>2?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`));
    if (sw) {
      await c.coordAt(sw.x, sw.y);
      await sleep(900);
      const mi = await c.ev(vis(`(() => { const m=[...document.querySelectorAll('[role="menuitem"]')].find(x=>(x.textContent||'').includes('剧本生产阶段')); if(!m) return null; const r=m.getBoundingClientRect(); return r.width>2?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`));
      if (mi) {
        await c.coordAt(mi.x, mi.y);
        await sleep(2200);
        continue;
      }
    }
    // 下拉不可用时兜底:概览页「进入阶段」
    await c.domClick(".studio-nav-button", `e=>(e.textContent||'').includes('概览')`);
    await sleep(1500);
    await c.domClick(
      "button",
      `e=>(e.textContent||'').includes('进入阶段') && (e=>{let p=e.parentElement;for(let k=0;k<6&&p;k++){if((p.textContent||'').includes('剧本生产'))return true;p=p.parentElement;}return false;})(e)`,
    );
    await sleep(2500);
  }
  return false;
}

async function promptPanelVerdict(c) {
  return c.ev(vis(`(() => {
    const panel = document.querySelector('.script-stage-detail-panel');
    if (!panel) return null;
    const text = panel.innerText || '';
    return { loading: text.includes('正在组装提示词'),
      bible: text.includes('原著圣经'), pref: text.includes('作者偏好'),
      archive: text.includes('原著档案检索'), mem: text.includes('项目记忆'),
      summary: panel.querySelector('p')?.textContent?.trim().slice(0,170) || '' };
  })()`));
}

async function main() {
  const fromIdx = Math.max(0, (parseInt(process.argv[2] ?? "1", 10) || 1) - 1);
  const c = await getClient();
  if (!(await ensureScriptStage(c))) throw new Error("cannot reach script stage");
  log("script stage reached.");

  // 发起前验证:AI提示词面板必须含 原著圣经+作者偏好(所见即所发)
  await c.domClick("button", `e=>/^1\\. 故事骨架/.test((e.textContent||'').trim())`);
  await sleep(600);
  await c.domClick(".script-stage-control-tabs button", `e=>(e.textContent||'').includes('AI提示词')`);
  let verdict = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    verdict = await promptPanelVerdict(c);
    if (verdict && !verdict.loading) break;
    if (!(await c.ev(vis(`!!document.querySelector('.script-stage-control-tabs')`)))) {
      await ensureScriptStage(c);
      await c.domClick(".script-stage-control-tabs button", `e=>(e.textContent||'').includes('AI提示词')`);
    }
  }
  log("PROMPT VERDICT:", JSON.stringify(verdict));
  // 本轮双硬门:偏好文件已存在(用户已填),pref 仍缺=真异常,须停
  if (!verdict || !verdict.bible || !verdict.pref) {
    console.log("RESULT_JSON " + JSON.stringify({ ok: false, reason: "prompt missing bible/preference", verdict }));
    c.close();
    process.exit(3);
  }

  const results = [];
  for (const stage of STAGES.slice(fromIdx)) {
    let done = false, note = "";
    for (let attempt = 1; attempt <= STAGE_MAX_RETRY && !done; attempt++) {
      const before = storeVersions()[stage.key]?.length ?? 0;
      if (!(await ensureScriptStage(c))) { note = "nav lost"; continue; }
      await c.domClick("button", `e=>new RegExp('^${stage.n}\\\\.').test((e.textContent||'').trim())`);
      await sleep(600);
      await c.domClick(".script-stage-control-tabs button", `e=>(e.textContent||'').includes('一键生成')`);
      await sleep(500);
      const clicked = await c.domClick(
        ".script-stage-detail-panel button",
        `e=>(e.textContent||'').includes('一键生成') && !(e.textContent||'').includes('编辑')`,
      );
      if (!clicked) { note = "generate btn not found"; await sleep(1500); continue; }
      log(`[${stage.key}] attempt ${attempt} generate clicked.`);
      const t0 = Date.now();
      while (Date.now() - t0 < STAGE_TIMEOUT_MS) {
        await sleep(3000);
        const nowCount = storeVersions()[stage.key]?.length ?? 0;
        if (nowCount > before) { done = true; note = `v${nowCount}`; break; }
        // 页面被 reload?自愈后视为本次失败,重试
        const alive = await c.ev(vis(`!!document.querySelector('.script-stage-control-tabs')`));
        if (!alive) {
          await ensureScriptStage(c);
          if (Date.now() - t0 > 20000) { note = "page reloaded mid-stream"; break; }
        }
      }
      if (!done && !note) note = "timeout";
      log(`[${stage.key}] attempt ${attempt} → ${done ? "OK " + note : "FAIL " + note}`);
    }
    results.push({ stage: stage.key, done, note });
    if (!done) break;
    await sleep(2500);
  }

  const v = storeVersions();
  const summary = {};
  for (const s of STAGES) {
    const arr = v[s.key] ?? [];
    summary[s.key] = { versions: arr.length, latest: arr.length ? new Date(arr.at(-1)).toLocaleString("zh-CN") : "-" };
  }
  log("SUMMARY", JSON.stringify(summary));
  console.log("RESULT_JSON " + JSON.stringify({ ok: results.every((r) => r.done), results, summary }));
  c.close();
  process.exit(results.every((r) => r.done) ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
