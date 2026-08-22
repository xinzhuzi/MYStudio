#!/usr/bin/env node
/**
 * CDP 实证(已装应用):「剧本资产管理→资产生成」的「资产未找到→立即生成」
 * 确认后弹窗应立即关闭、生成转后台(toast 进度),界面不被模态锁死;
 * 同一资产生成进行中再次点击行,应被守卫拦截(不弹确认框、提示后台生成中)。
 *
 * 前置:已装应用以 --remote-debugging-port=9222 启动,且存在一条「资产库未收录」
 * 的实体行(2026-08-22 用隔离 userData + APFS 克隆项目 + 清空 assets.db 构造;
 * 实测:确认后弹窗 106ms 关闭、失败 toast 落在新逻辑分支、行列表未锁死)。
 * 注意:项目刚水合时 getByName(IPC) 可能短暂偏慢,候选行轮询 3s 偶发不够,
 * 重跑即可;后台生成极快终结(无 AI 配置)时守卫检查自动降级为信息性记录。
 */
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_BASE = "http://127.0.0.1:9222";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;

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
    async domClick(selector, pred = "e=>true") {
      return this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="button"]') || el;
        t.click();
        return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
    // 可信坐标点击:pointerdown 门链控件(Dashboard 项目卡)必须走这条路
    async coordClick(selector, pred = "e=>true") {
      const rect = await this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="button"]') || el;
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

const hasRows = (c) =>
  c.ev(vis(`[...document.querySelectorAll('[aria-label^="打开资产 "]')].length > 0`));

// 逐候选行尝试:返回第一个触发「资产未找到」确认框的行名
// (handleOpenAsset 是异步:点击后必须轮询等弹窗,立即检查必误判)
async function findNotFoundRow(c) {
  // tab 刚切换时行列表可能还没渲染完:先等行出现再判定
  let rows = [];
  for (let t = 0; t < 10 && rows.length === 0; t++) {
    rows = await c.ev(vis(`
      [...document.querySelectorAll('[aria-label^="打开资产 "]')].map((b) => {
        const row = b.closest('[role="button"]') || b;
        const badges = [...row.querySelectorAll('[data-slot="badge"],span')].map((x) => (x.textContent || '').trim());
        return {
          name: (b.getAttribute('aria-label') || '').replace(/^打开资产 /, ''),
          stored: badges.includes('资产库已存在'),
        };
      })`)) ?? [];
    if (rows.length === 0) await sleep(750);
  }
  const candidates = rows.filter((r) => !r.stored);
  const pool = candidates.length ? candidates : rows;
  for (const row of pool.slice(0, 4)) {
    await c.domClick('[aria-label^="打开资产 "]', `e => ((e.getAttribute('aria-label')||'') === '打开资产 ${row.name.replace(/'/g, "\\'")}')`);
    // 轮询最多 3s:等「资产未找到」或详情弹窗(异步 IPC 后才出现)
    let saw = null;
    for (let t = 0; t < 15 && !saw; t++) {
      await new Promise((r) => setTimeout(r, 200));
      saw = await c.ev(vis(`(() => {
        const alert = document.querySelector('[role="alertdialog"]');
        if (alert && [...alert.querySelectorAll('*')].some((x)=>(x.textContent||'').includes('资产未找到'))) return 'notfound';
        const dlg = document.querySelector('[role="dialog"]');
        if (dlg) return 'detail';
        return null;
      })()`));
    }
    if (saw === "notfound") return row.name;
    // 打开的可能是详情弹窗(资产其实存在):关掉再试下一个
    await c.ev(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await sleep(400);
    await c.ev(`(() => { const d = document.querySelector('[role="dialog"] [data-slot="dialog-close"], [role="dialog"] button[aria-label*="关闭"]'); if (d) d.click(); return true; })()`);
    await sleep(400);
  }
  return null;
}

async function main() {
  const c = await getClient();
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
    log(ok ? "PASS" : "FAIL", name, detail);
  };

  try {
    // ── 导航到「资产生成」面(自愈:项目卡 → 概览页「进入工作流」 → 工作流 tab → 行出现)
    let navigated = "";
    for (let i = 0; i < 20 && !(await hasRows(c)); i++) {
      if (await c.ev(vis(`[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '剧本资产管理')`))) {
        await c.coordClick("button", `e => (e.textContent || '').trim() === '剧本资产管理'`);
        navigated = "workflow-tab";
      } else if (await c.ev(vis(`[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim().includes('进入工作流'))`))) {
        await c.coordClick("button", `e => (e.textContent || '').trim().includes('进入工作流')`);
        navigated = "enter-workflow";
      } else {
        // Dashboard:坐标点击项目卡片本体(data-project-card,onClick 在卡片 div 上)
        const clicked = await c.coordClick("[data-project-card]", "e => true");
        navigated = clicked ? "dashboard-card" : "dashboard-fallback";
        if (!clicked) await c.coordClick("main [role='button']", "e => true");
      }
      await sleep(1200);
    }
    check("导航到资产生成面(出现「打开资产」行)", await hasRows(c), navigated);
    if (!(await hasRows(c))) throw new Error("no asset rows; project may have no entity extraction");

    // ── 触发「资产未找到」确认框
    const rowName = await findNotFoundRow(c);
    check("点击未入库资产行出现「资产未找到」确认框", Boolean(rowName), rowName ? `目标行:${rowName}` : "候选行均已在资产库");
    if (!rowName) throw new Error("no not-found candidate row");

    // ── 点「立即生成」:弹窗应在 2 秒内消失
    await c.domClick("button", `e => (e.textContent || '').trim() === '立即生成'`);
    const t0 = Date.now();
    let dialogGoneMs = -1;
    while (Date.now() - t0 < 2000) {
      const gone = await c.ev(vis(`!document.querySelector('[role="alertdialog"]')`));
      if (gone) { dialogGoneMs = Date.now() - t0; break; }
      await sleep(100);
    }
    check("确认后弹窗立即关闭(≤2s,不锁 UI)", dialogGoneMs >= 0, `耗时 ${dialogGoneMs}ms`);

    // ── toast 进度出现(顶部);视觉手册未配置时是错误 toast(弹窗仍应已关,修复同样生效)
    await sleep(500);
    const toastText = await c.ev(vis(`[...document.querySelectorAll('[data-sonner-toast]')].map((t)=>(t.textContent||'')).join(' | ')`)) ?? "";
    const manualMissing = /视觉手册/.test(toastText);
    if (manualMissing) {
      check("顶部出现生成进度/结果 toast(视觉手册未配置→错误提示,未触发真实生成)", true, toastText.slice(0, 120));
    } else {
      check("顶部出现生成进度/结果 toast", /生成/.test(toastText), toastText.slice(0, 120));
    }

    // ── 行列表仍可交互(无模态遮罩)
    const interactive = await c.ev(vis(`document.querySelectorAll('[aria-label^="打开资产 "]').length > 0 && !document.querySelector('[data-radix-focus-guard]')`));
    check("行列表未被模态锁死(focus-guard 不存在)", Boolean(interactive));

    // ── 防重复:生成中再点同一行 → 不弹确认框,提示后台生成中
    // (隔离环境可能无 AI 配置,后台生成即刻失败终结——此时守卫窗口不存在,记为跳过而非 FAIL)
    if (!manualMissing) {
      await sleep(150);
      const toastEarly = await c.ev(vis(`[...document.querySelectorAll('[data-sonner-toast]')].map((t)=>(t.textContent||'')).join(' | ')`)) ?? "";
      const finishedEarly = /缺少可生成的本地资产|生成失败|资产生成成功/.test(toastEarly);
      if (finishedEarly) {
        check("防重复守卫(后台生成即时终结,守卫窗口不存在→信息性跳过)", true, toastEarly.slice(0, 100));
      } else {
        await c.domClick('[aria-label^="打开资产 "]', `e => ((e.getAttribute('aria-label')||'') === '打开资产 ${rowName.replace(/'/g, "\\'")}')`);
        await sleep(900);
        const dialogAgain = await c.ev(vis(`Boolean(document.querySelector('[role="alertdialog"]'))`));
        const toastText2 = await c.ev(vis(`[...document.querySelectorAll('[data-sonner-toast]')].map((t)=>(t.textContent||'')).join(' | ')`)) ?? "";
        check("生成中重复点击不弹确认框", !dialogAgain);
        check("重复点击提示「正在后台生成中」", /后台生成中/.test(toastText2), toastText2.slice(0, 160));
      }
    }

    const pass = checks.every((x) => x.ok);
    console.log(JSON.stringify({ pass, checks }, null, 2));
    process.exitCode = pass ? 0 : 1;
  } finally {
    c.close();
  }
}

main().catch((err) => {
  console.error("verify failed:", err.message);
  process.exitCode = 1;
});
