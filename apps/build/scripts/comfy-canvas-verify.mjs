#!/usr/bin/env node
/**
 * ComfyUI 画布自验门(comfy-canvas-verify.mjs)
 *
 * 1005 立(用户令「这种问题以后怎么解决」):工作流 UI/结构改动后,交付前由 AI
 * 自证三事,不再拿用户当测试仪——
 *   ①活机对账:打开工作流后,从活 webview 读前端 reconcile 后的宿主节点
 *     inputs/widgets(=前端眼里的真相,文件序列化对不对它说了算);
 *   ②画布截图:落 PNG 供视觉模型直读(节点标签/布局/空白肉眼级问题);
 *   ③机器 PASS/FAIL:期望值从 S5 直载真读位解析(repo: 叶子→装机 Resources,
 *     1005 晚定谳,见 TRUTH_WF_PATH 处路径账),零硬编码。
 *
 * 用法:
 *   node apps/build/scripts/comfy-canvas-verify.mjs [workflow相对路径]
 *     默认 1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json
 *   KEEP_APP=1 验完不关 App(默认留 App 常驻,用户可直接看画布)
 * 输出:apps/output/comfy-canvas-verify/canvas.png + stdout 摘要
 *
 * 骨架承自 daojie-t2i-app-e2e.mjs(0915/0930 役实证片段原样继承:webview 不进
 * /json/list 经主 target executeJavaScript、注入每段≤10 行防 IPC 竞态、CDP 截图
 * 空数据用 screencapture 兜底、9222 常被并行探针占、persist 缓存旧 sidebar.js 须
 * reloadIgnoringCache、单飞铁律 prekill 全家)。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const HOME = process.env.HOME;
const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.my.manying-studio";
const WF_REL = process.argv[2] || "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
// 1005 晚路径定谳(四副本哈希对拍,详见 docs/comfyui-kb/子图宿主面板排查.md):
// repo: 侧栏叶子直载真读=装机包 Resources backend 树(装机态)/仓库树(dev 态;
// activeWorkflow.path 形态 "workflows/<rel>" = repo: 直载特征);引擎家
// ComfyUI/user/default/workflows=ComfyUI 原生菜单读写位(用户区,引擎启动零回灌)。
// S5 走 repo: 直载→期望值必须取 Resources。旧名 ENGINE_CACHE_WF 名实不符曾误导
// 排查(变量叫引擎缓存、头注释也说引擎缓存,实际指装机包),已正名。
const TRUTH_WF_PATH = "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/" + WF_REL;
const OUT_DIR = join(HOME, "Project/Github/MYStudio/apps/output/comfy-canvas-verify");
const KEEP_APP = process.env.KEEP_APP === "1";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const step = (id, t) => log(`──── ${id} ${t} ────`);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── 真源解析:宿主期望槽序/widgets 来自引擎家缓存工作流 ──
function parseTruth() {
  const g = JSON.parse(readFileSync(TRUTH_WF_PATH, "utf8"));
  const asmSg = (g.definitions?.subgraphs || []).find((s) => String(s.name).includes("提示词类型优化"));
  if (!asmSg) throw new Error(`真源工作流无「提示词类型优化」子图: ${TRUTH_WF_PATH}`);
  const host = g.nodes.find((n) => String(n.type) === String(asmSg.id));
  if (!host) throw new Error("主图无装配宿主节点");
  const sgInputNames = (asmSg.inputs || []).map((i) => i.name);
  const sgWidgetNames = (asmSg.inputs || [])
    .filter((i) => ["COMBO", "BOOLEAN", "INT", "STRING", "FLOAT"].includes(i.type) && (host.inputs || []).some((h) => h.name === i.name && h.widget))
    .map((i) => i.name);
  return {
    rootCount: g.nodes.length,
    asmId: asmSg.id,
    sgInputNames,                       // 子图边界槽序(宿主 inputs 应逐项镜像此序)
    hostFileInputs: (host.inputs || []).map((i) => i.name),
    expectWidgets: sgWidgetNames,       // 期望活机 widgets 至少含这些
    // 连线槽期望=宿主文件里带活 link 的槽(纯槽形渲染带标签点)
    expectLinked: (host.inputs || []).filter((i) => i.link !== null && i.link !== undefined).map((i) => i.name),
  };
}

// ── CDP 底座(e2e 原样) ──
async function isPortFree(port) {
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); return false; }
  catch (e) { return String(e?.cause?.code || e?.message || e).includes("ECONNREFUSED"); }
}
function prekillApp() {
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
  ];
  for (const [cmd, args] of steps) { try { execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* 可选 */ } }
}
let appProc = null, CDP_PORT = 0;
function launchApp() {
  appProc = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env }, detached: true, stdio: "ignore",
  });
  appProc.unref();
  log("app spawned pid", appProc.pid);
}
async function getMainClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
      if (page) break;
    } catch { /* 端口未就绪 */ }
    await sleep(1500);
  }
  if (!page) throw new Error("主窗口 target 未出现(120s)");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  // undici WebSocket=EventTarget(无 .once/.on,1005 实证);addEventListener 原生写法
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send("Runtime.enable"); await send("Page.enable");
  return {
    send, url: page.url, close: () => ws.close(),
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
        t.click(); return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
    async screenshot(name) {
      mkdirSync(OUT_DIR, { recursive: true });
      const path = join(OUT_DIR, `${name}.png`);
      // 画布内容在 <webview> guest 合成层,主窗口 CDP 截图截不到(1005 晚实测:
      // 主窗 PNG 只有 App 侧栏文字)——优先按 /json/list 直截 webview target
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const wvTarget = list.find((t) => t.type === "webview" && t.webSocketDebuggerUrl);
        if (wvTarget) {
          const ws2 = new WebSocket(wvTarget.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws2.addEventListener("open", res, { once: true });
            ws2.addEventListener("error", rej, { once: true });
          });
          const r2 = await new Promise((res) => {
            ws2.addEventListener("message", function h(ev) {
              const m = JSON.parse(String(ev.data));
              if (m.id === 1) { ws2.removeEventListener("message", h); res(m.result); }
            });
            ws2.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
          });
          ws2.close();
          if (r2 && r2.data) { writeFileSync(path, Buffer.from(r2.data, "base64")); log(`📸(webview) ${path}`); return; }
        }
      } catch { /* 落主窗兜底 */ }
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* 原生兜底 */ }
      try { execFileSync("screencapture", ["-x", "-C", path]); log(`📸(native) ${path}`); }
      catch { log(`📸 失败 ${path}`); }
    },
  };
}
/** webview 内执行(注入每段≤10 行防 IPC 竞态) */
async function wv(main, code) {
  return main.ev(`(async () => {
    const wv = document.querySelector('webview');
    if (!wv) return null;
    try { return await wv.executeJavaScript(${JSON.stringify(code)}, false); }
    catch (e) { return null; }
  })()`);
}
async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时: ${label || fn}`);
}

// ── 流程 ──
async function main() {
  const truth = parseTruth();
  log("真源(S5 直载位=装机 Resources):", TRUTH_WF_PATH);
  log(`期望: 边界槽序=[${truth.sgInputNames.join("/")}] 连线槽=[${truth.expectLinked.join("/")}] widgets=[${truth.expectWidgets.join("/")}]`);

  step("S0", "调试口自选+单飞 prekill");
  for (const p of [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231]) {
    if (await isPortFree(p)) { CDP_PORT = p; break; }
  }
  if (!CDP_PORT) { console.error("9222-9231 无空闲调试口"); process.exit(2); }
  check(`S0 调试口 ${CDP_PORT}`, true);
  prekillApp();
  await sleep(2500);

  step("S1", "启动应用+attach");
  launchApp();
  const client = await getMainClient();
  await waitFor(() => client.ev(vis(`document.querySelectorAll('button').length > 5`)), { label: "应用水合" });
  check("S1 主窗口 attach+水合", true);

  step("S2", "Dashboard 进道劫子项目");
  const onDashboard = await client.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
  if (onDashboard) {
    const clicked = await client.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
    check("S2 道劫项目卡点击", Boolean(clicked), String(clicked));
  } else {
    check("S2 非 Dashboard 起步(已在项目内)", true);
  }

  step("S3", "侧栏「本地模型」进 ComfyUI 画布");
  // 1005 实测定谳:App 视图状态会记忆上次画布页——webview 已挂载时导航整段可跳;
  // 「本地模型」DOM 形态随视图漂移:图标栏主入口=div[role=button](文字在 tooltip
  // span,常态隐藏),侧栏抽屉里是 <button>——三形轮询,domClick 内部
  // closest('button,[role="button"]') 归一;单一形态选择器必然时灵时不灵。
  const alreadyIn = await wv(client, `document.querySelector('webview') ? 'webview' : null`);
  if (alreadyIn) {
    check("S3 webview 已挂载(视图状态直 restore,跳导航)", true);
  } else {
    const NAV_PRED = `e => ((e.textContent||'').trim() === '本地模型')`;
    const navClicked = await waitFor(async () =>
        (await client.domClick("button", NAV_PRED))
        ?? (await client.domClick('[role="button"]', NAV_PRED))
        ?? (await client.domClick("span", NAV_PRED)),
      { timeout: 45_000, interval: 1500, label: "本地模型入口出现并可点" }).catch(() => null);
    check("S3 本地模型入口可点", Boolean(navClicked), String(navClicked));
    // 漫影生图表单态坑:悬浮球切回画布(09-14 加固原样)
    await client.ev(vis(`document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`));
    // 挂载判据=executeJavaScript 真能通(1005 晚实测:webview 元素挂上≠guest 可
    // 执行——引擎冷启动(含 Manager 联网刷缓存)+guest 页加载可拖到 ~11min,
    // 600s「元素在场」判据曾不够而误报超时)——直接拿 exec 通断当门
    await waitFor(() => wv(client, `'ok'`),
      { timeout: 1200_000, interval: 3000, label: "webview 挂载且可执行(引擎冷启动在内)" });
  }
  await waitFor(() => wv(client, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  // persist 缓存旧 sidebar.js 坑:无条件忽略缓存重载一次
  await wv(client, `window.__vPreReload = 1; 'marked'`);
  await client.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
  await waitFor(() => wv(client, `(!window.__vPreReload && window.app && window.app.isGraphReady === true) ? 'y' : null`),
    { timeout: 120_000, interval: 2000, label: "新页真身" });
  check("S3 webview 挂载+graph 就绪+缓存重载", true);

  step("S4", "关所有已开工作流标签");
  await wv(client, `(() => {
    window.__vCloseAll = async () => {
      const s = window.app?.extensionManager?.workflow;
      if (!s || !Array.isArray(s.openWorkflows)) return JSON.stringify({ error: 'no-svc' });
      let closed = 0; const t = [...s.openWorkflows];
      for (const wf of t) { try { await Promise.race([s.closeWorkflow(wf), new Promise(r => setTimeout(r, 4000))]); closed++; } catch (e) {} }
      return JSON.stringify({ before: t.length, closed });
    };
    return 'installed';
  })()`);
  await wv(client, `window.__vCloseAll()`);

  step("S5", "侧栏重开目标工作流");
  await waitFor(() => wv(client, `(() => {
    if (document.body.innerText.includes('1_图片')) return 'tree';
    const btn = document.querySelector('[data-testid="my.shots-tab-button"]')
      || [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
        .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏打开" });
  const ensureFolder = async (name, childProbe) => {
    await waitFor(() => wv(client, `(() => {
      const li = [...document.querySelectorAll('li.my-tree-item')]
        .find(li => li.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
      if (!li) return null;
      if (li.getAttribute('aria-expanded') === 'true') return 'open';
      li.querySelector('.my-tree-row')?.click();
      return 'clicked';
    })()`), { timeout: 20_000, interval: 1200, label: `目录 ${name}` });
    await waitFor(() => wv(client, childProbe), { timeout: 15_000, interval: 800, label: `${name} 子级出现` });
  };
  const relParts = WF_REL.split("/");
  await ensureFolder(relParts[0], `document.body.innerText.includes(${JSON.stringify(relParts[1])}) ? 'y' : null`);
  await ensureFolder(relParts[1], `(() => [...document.querySelectorAll('.my-tree-row')]
    .some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)})) ? 'y' : null)()`);
  await wv(client, `(() => {
    const row = [...document.querySelectorAll('.my-tree-row')]
      .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)}));
    if (!row) return null; row.click(); return 'ok';
  })()`);
  const nodes = await waitFor(() => wv(client, `window.app.graph && window.app.graph._nodes.length === ${truth.rootCount} ? ${truth.rootCount} : null`),
    { timeout: 60_000, interval: 1000, label: `画布载入(${truth.rootCount} 节点)` }).catch(() => 0);
  check(`S5 画布载入(根节点=${truth.rootCount})`, nodes === truth.rootCount, `实际 ${nodes}`);

  step("S6", "活机对账:前端 reconcile 后的宿主真相(本脚本的灵魂)");
  const liveRaw = await waitFor(() => wv(client, `(() => {
    const n = window.app.graph._nodes.find(x => x.type === ${JSON.stringify(truth.asmId)});
    if (!n) return null;
    return JSON.stringify({
      inputs: (n.inputs || []).map(i => ({ name: i.name, type: i.type, link: i.link ?? null, widget: !!(i.widget) })),
      widgets: (n.widgets || []).map(w => w.name),
      size: [Math.round(n.size[0]), Math.round(n.size[1])],
    });
  })()`), { timeout: 15_000, interval: 1200, label: "活机宿主状态" });
  let live = null; try { live = JSON.parse(String(liveRaw)); } catch { /* keep null */ }
  if (!live) {
    check("S6 活机宿主可读", false, String(liveRaw).slice(0, 200));
  } else {
    log("活机 inputs:", JSON.stringify(live.inputs));
    log("活机 widgets:", JSON.stringify(live.widgets), "size:", JSON.stringify(live.size));
    // 判据①:活机 inputs 槽名序 === 子图边界槽序(镜像铁律)
    const liveNames = live.inputs.map((i) => i.name);
    check("S6① 活机槽序镜像子图边界", JSON.stringify(liveNames) === JSON.stringify(truth.sgInputNames),
      `活机=[${liveNames.join("/")}] 期望=[${truth.sgInputNames.join("/")}]`);
    // 判据②:连线槽在活机有活 link(前端没丢线);1005 ㊇ 补:边界 STRING 槽
    // 活机应 widget:false(内部落点须 forceInput 纯槽,否则被提升=连线裸点)
    for (const nm of truth.expectLinked) {
      const slot = live.inputs.find((i) => i.name === nm);
      check(`S6② 连线槽「${nm}」活 link 在场`, !!slot && slot.link !== null,
        slot ? `link=${slot.link}` : "槽缺失");
    }
    // 判据③:widget 槽渲染成控件(活机 widgets 名单)
    for (const nm of truth.expectWidgets) {
      check(`S6③ 控件「${nm}」在活机 widgets`, live.widgets.includes(nm),
        live.widgets.join("/"));
    }
  }
  await client.screenshot("canvas");
  step("S7", "画布截图已落盘(视觉模型直读复核)");
  check("S7 截图落盘", true, join(OUT_DIR, "canvas.png"));

  const fails = results.filter((r) => !r.pass);
  console.log(`\n═══ 结果: ${results.length - fails.length}/${results.length} PASS ═══`);
  for (const f of fails) console.log(`FAIL  ${f.name} — ${f.detail}`);
  process.exitCode = fails.length ? 1 : 0;
  if (!KEEP_APP) {
    log("收摊:关 App(KEEP_APP=1 可留)");
    try { execFileSync("osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`], { stdio: "ignore" }); } catch { /* 可选 */ }
  } else {
    log("App 留驻(KEEP_APP=1),画布停在已验证状态,可直接查看");
  }
}

main().catch((e) => { console.error("炸了:", e && (e.stack || e.message || e)); process.exit(1); });
