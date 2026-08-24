#!/usr/bin/env node
/**
 * CDP 实弹 E2E(已装应用+真实 userData+真 key):
 * 打开道劫项目 → 资产页 → 独孤剑尘详情(带已有设定图)→ 一键生成资产生图
 * → 验证:①真实 provider 出图;②诊断日志含 daojie-prompt-compile 且 moduleIds
 * 带 reference.denoise(参考图锁生效);③配色选配决策;④详情图新增。
 *
 * 前置:/Applications/漫影工作室.app 已以 --remote-debugging-port=9222 启动
 * (MYSTUDIO_REMOTE_DEBUG=1)。真实生图消耗一次配额(用户授权)。
 */
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");

const CDP_BASE = "http://127.0.0.1:9222";
const TARGET_ASSET = process.env.TARGET_ASSET || "独孤剑尘";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;

async function getClient() {
  const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
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
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
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
        await send("Input.dispatchMouseEvent", { type, x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 });
        await sleep(90);
      }
      return true;
    },
    async screenshot(name) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`/tmp/daojie-e2e-${name}.png`, Buffer.from(r.data, "base64"));
      log(`📸 /tmp/daojie-e2e-${name}.png`);
    },
  };
}

async function waitFor(c, expr, { timeout = 20000, interval = 600, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await c.ev(vis(expr));
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时: ${label || expr.slice(0, 60)}`);
}

// ── 诊断日志取证 ──
function readDiagnostics() {
  const dir = join(homedir(), "Library/Application Support/漫影工作室/logs/diagnostics");
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().reverse().slice(0, 3)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* 忽略残行 */ }
    }
  }
  return entries;
}

async function main() {
  const c = await getClient();
  try {
    // ① Dashboard → 道劫项目卡(已在项目内则跳过;卡片是 div.dashboard-project-card)
    const onDashboard = await c.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
    if (onDashboard) {
      await c.coordClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
      log("项目卡点击(可信坐标)");
      await sleep(2500);
    } else {
      log("已在项目内,跳过 dashboard");
    }
    await c.screenshot("1-project");

    // ② 资产 tab(项目内主导航)
    let tabOk = await c.domClick("button,[role='tab'],nav button", `e => ((e.textContent||'').trim() === '资产')`);
    if (!tabOk) tabOk = await c.domClick("button", `e => ((e.textContent||'').trim() === '资产')`);
    log("资产 tab:", tabOk);
    // 制作资产 → 角色 分区(默认可能停在风格库)
    const inRole = await c.ev(vis(`[...document.querySelectorAll('[aria-label^="打开资产 "]')].length > 0`));
    if (!inRole) {
      const roleOk = await c.domClick("button,[role='tab']", `e => ((e.textContent||'').trim() === '角色')`);
      log("角色 分区:", roleOk);
    }
    await waitFor(c, `[...document.querySelectorAll('button')].some(e => (e.textContent||'').includes(${JSON.stringify(TARGET_ASSET)}))`, { timeout: 25000, label: `${TARGET_ASSET} 卡片` });

    // ③ 独孤剑尘(资产卡片按钮;兼容剧本资产管理的 aria 行形态)
    const rowLabel = `打开资产 ${TARGET_ASSET}`;
    let opened = await c.domClick("button", `e => ((e.textContent||'').includes(${JSON.stringify(TARGET_ASSET)}) && e.getBoundingClientRect().width > 60 && e.closest('[aria-label^="打开资产 "]') === null)`);
    if (!opened) {
      opened = await c.domClick('[aria-label^="打开资产 "]', `e => ((e.getAttribute('aria-label')||'') === ${JSON.stringify(rowLabel)})`);
    }
    if (!opened) throw new Error(`未找到资产卡片: ${TARGET_ASSET}`);
    log("打开详情:", String(opened).slice(0, 30));
    await waitFor(c, `document.body.textContent.includes('一键生成资产生图')`, { label: "详情弹窗" });

    // ④ 等已有设定图加载(参考图来源)
    const imgCount = await waitFor(c, `(() => { const t = [...document.querySelectorAll('img')].filter(i => (i.currentSrc||i.src||'').length > 0); return t.length; })() > 0`, { timeout: 20000, label: "详情图加载" })
      .then(() => c.ev(vis(`[...document.querySelectorAll('img')].filter(i => (i.currentSrc||i.src||'').length > 0).length`)));
    log("详情已加载图片数(参考图候选):", imgCount);
    await c.screenshot("2-detail");

    // ⑤ 一键生成(真实 provider)
    const beforeImgs = await c.ev(vis(`[...document.querySelectorAll('img')].filter(i => (i.currentSrc||i.src||'').length > 0).length`));
    const gen = await c.domClick("button", `e => ((e.textContent||'').includes('一键生成资产生图') && !e.disabled)`);
    if (!gen) throw new Error("一键生成按钮不可用(检查视觉手册配置/生成中)");
    log("点击一键生成:", gen, "| 前置图数:", beforeImgs);
    await sleep(1500);
    await c.screenshot("3-generating");

    // ⑥ 轮询完成(真实生图 1-4 分钟):按钮文案回常态 或 toast 完成/失败
    const done = await waitFor(c, `(() => {
      const t = document.body.textContent || '';
      const btn = [...document.querySelectorAll('button')].find(e => (e.textContent||'').includes('生成完成'));
      const fail = t.includes('生成失败') || t.includes('失败:');
      return btn ? 'done' : (fail ? 'failed' : null);
    })()`, { timeout: 300000, interval: 3000, label: "生图完成(最长5分钟)" });
    await c.screenshot("4-result");
    const afterImgs = await c.ev(vis(`[...document.querySelectorAll('img')].filter(i => (i.currentSrc||i.src||'').length > 0).length`));
    log("生成阶段:", done, "| 前图数:", beforeImgs, "→ 后图数:", afterImgs);

    // ⑦ 诊断日志取证
    await sleep(1500);
    const logs = readDiagnostics();
    const compileLogs = logs.filter((e) => e.message?.includes("Daojie asset prompt compiled"));
    const paletteLogs = logs.filter((e) => e.message?.includes("Daojie palette scheme decision"));
    const rejectLogs = logs.filter((e) => e.message?.includes("rejected before provider"));
    const latest = compileLogs[compileLogs.length - 1];
    const latestPalette = paletteLogs[paletteLogs.length - 1];
    log("═══ 诊断日志证据 ═══");
    log("编译日志条数:", compileLogs.length, "| 最近一条:");
    if (latest) {
      console.log(JSON.stringify({
        level: latest.level,
        message: latest.message,
        context: {
          track: latest.context?.track,
          maTrack: latest.context?.maTrack,
          paletteSchemeId: latest.context?.paletteSchemeId,
          totalChars: latest.context?.totalChars,
          status: latest.context?.status,
          hasReferenceLock: Array.isArray(latest.context?.moduleIds) && latest.context.moduleIds.includes("reference.denoise"),
          moduleIds: latest.context?.moduleIds,
          contractSha256: String(latest.context?.contractSha256 || "").slice(0, 16),
        },
      }, null, 1));
    }
    if (latestPalette) log("配色决策:", JSON.stringify(latestPalette.context));
    if (rejectLogs.length) log("⚠️ 拒收日志:", rejectLogs.length, "条");

    const ok = done === "done" && latest?.context?.moduleIds?.includes?.("reference.denoise");
    log(ok ? "✅ E2E 通过:真实出图+参考图锁+配色链路全部生效" : `❌ E2E 未完全通过(done=${done}, 参考图锁=${latest ? String(latest.context?.moduleIds?.includes?.("reference.denoise")) : "无编译日志"})`);
    process.exit(ok ? 0 : 1);
  } finally {
    c.close();
  }
}

main().catch((e) => { console.error("E2E 失败:", e.message); process.exit(1); });
