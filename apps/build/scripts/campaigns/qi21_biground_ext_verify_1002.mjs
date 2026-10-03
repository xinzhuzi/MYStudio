#!/usr/bin/env node
// qi21 大轮(1002)web 扩展实弹验证 —— 引擎管理员丁,腿2。
//
// 前提:引擎 17599 已起(腿1 保持运行;脚本只探活不自拉)。
// 验证对象:my_nodes/web/qi21-panel-linkage.js(1002 大轮重锚版:
//   显隐锚=[4012] PE启用? 外露 widget+型选择;⑲ debounce200/zoomQuiet400)。
// 手法先例:qi21_usertest_panel_linkage_1001.mjs(loadGraphData 真源装载+
//   onWidgetChanged/纯赋值双通路断言,widget 名随 1002 重锚改「PE启用?」)
//   + qi21_flicker_framegrab_1002.mjs(wheel 步进+每步 hidden 态+同步截图,
//   判据 ≥6 显=闪现帧;定位轮 on-ext 曾现闪现,本腿=修复后回归,期望 0)。
// 场景(ask 四场景,双通路):
//   S1 打开自恢复:九型(人物)+PE开 → 透明隐藏+手填隐藏(场景1 静态版);
//   S2 hook 切「自由」→ 透明显示(场景2);
//   S3 assign 切回九型「道具」→ 透明复隐藏(场景1 动作版,轮询兜底通路);
//   S4 assign PE关 → 手填显示(场景4);
//   S5 hook PE开 → 手填复隐藏(场景3)。
// ⑲缩放回归:S5 终态(九型+PE开=3 显)下 wheel 36 步缩出+12 步缩回,
//   每步读宿主可见控件名单+截图;≥6 显=闪现帧;判据=0 闪现+终态 3 显。
// 产物:apps/output/biground-1002/ext/{ext-s1..s5.png, ext-zoom-*.png,
//   ext-verify-report.json}。退出码 0=全绿;1=有红;2=环境错。
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = "http://127.0.0.1:17599";
const CDP_PORT = 9395;
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/biground-1002/ext`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91"; // [6] 装配子图宿主 type(当前 t2i 实核)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-biground-ext-${Date.now()}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleMsgs = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
};
class EnvError extends Error {}

let chromeProc = null;
const launchChrome = () => {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
};
const killChrome = () => { if (chromeProc) { try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { /* gone */ } } };

async function getPageClient() {
  let page = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch { /* retry */ }
    await sleep(1200);
  }
  if (!page) throw new EnvError("前端 page target 未出现(90s)");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleMsgs.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  return {
    send,
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
      return r.result.value;
    },
    async shot(name) {
      const r = await send("Page.captureScreenshot", { format: "png", maxWidth: 1280, maxHeight: 800 });
      if (r && r.data) { writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64")); log(`📸 ${name}`); }
    },
    close: () => ws.close(),
  };
}

async function waitFor(fn, { timeout = 90_000, interval = 1000, label = "" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new EnvError(`waitFor 超时: ${label}`);
}

// ── 页内探针(宿主=装配子图 [6];widget 名=1002 重锚终态) ──
const HOST = `window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)})`;
const panelState = `JSON.stringify((() => {
  const host = ${HOST}; if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  const dv = (name) => { const x = w[name]; return x ? { hidden: !!x.hidden, isVis: host.isWidgetVisible ? host.isWidgetVisible(x) : null } : null; };
  return {
    subgraph: String(host.subgraph?.name ?? ''),
    values: { 型选择: w['型选择']?.value, 'PE启用?': w['PE启用?']?.value, 透明: w['透明']?.value, 手动宽: w['手动宽']?.value, 手动高: w['手动高']?.value },
    widgetsCount: (host.widgets || []).length,
    visibleNames: (host.widgets || []).filter((x) => !x.hidden).map((x) => x.name),
    alpha: dv('透明'), manualW: dv('手动宽'), manualH: dv('手动高'),
    layoutNames: host.getLayoutWidgets ? host.getLayoutWidgets().map((x) => x.name) : null,
    serializedLen: Array.isArray(host.widgets_values) ? host.widgets_values.length : null,
  };
})())`;
const setViaHook = (name, val) => `(async () => {
  const host = ${HOST}; if (!host) return 'no-host';
  const w = host.widgets.find((x) => x.name === ${JSON.stringify(name)}); const old = w.value;
  w.value = ${JSON.stringify(val)};
  host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'hook:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;
const setViaAssign = (name, val) => `(async () => {
  const host = ${HOST}; if (!host) return 'no-host';
  host.widgets.find((x) => x.name === ${JSON.stringify(name)}).value = ${JSON.stringify(val)};
  return 'assign:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;

const zoomState = vis(`JSON.stringify((() => {
  const host = ${HOST}; if (!host) return null;
  return { scale: +(window.app.canvas.ds?.scale ?? 0).toFixed(3),
           vis: host.widgets.filter((w) => !w.hidden).map((w) => w.name) };
})())`);

let page = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  // 0. 引擎+扩展就绪(腿1 引擎,只探活)
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("0.1 引擎已列扩展 js(/api/extensions)", exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"),
    exts.filter((x) => x.includes("qi21-panel")).join(",") || "(未列)");

  // 1. 真前端装载(仓库真源原样,零注入)
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000);
  consoleMsgs.length = 0; // 启动期噪音冲刷,装载后才开始记 error
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const opened = await page.ev(`(async () => {
    if (!window.app || window.app.isGraphReady !== true) return 'app-not-ready';
    window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'biground-ext-verify');
    return 'opened';
  })()`);
  check("1.1 loadGraphData(t2i 仓库真源原样)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(2500); // 扩展轮询首轮(400ms)+布局落定
  const reg = await page.ev(vis(`(window.app.extensions || []).some((e) => e && e.name === 'my.qi21.panel.linkage')`));
  check("1.2 扩展注册于真前端(app.extensions)", reg === true, String(reg));

  await page.ev(`(() => { const h = ${HOST}; if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); window.app.canvas.setDirty(true, true); return 1; })()`);
  await sleep(600);

  // S1 打开自恢复:九型(人物)+PE开 → 透明隐藏+手填隐藏(ask 场景1 静态版)
  let st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S1.0 宿主面板就位(子图名锚+五控件)", st && st.subgraph.includes("文本提示词类型优化子图") && st.values.型选择 === "人物" && st.values["PE启用?"] === true,
    JSON.stringify({ subgraph: st?.subgraph, values: st?.values }));
  check("S1.1 九型 → 透明隐藏(hidden)", st.alpha.hidden === true, JSON.stringify(st.alpha));
  check("S1.2 九型 → 透明不可见(isWidgetVisible 双口径)", st.alpha.isVis === false, JSON.stringify(st.alpha));
  check("S1.3 PE开 → 手动宽/手动高隐藏", st.manualW.hidden === true && st.manualH.hidden === true, JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S1.4 布局件不含隐藏控件(getLayoutWidgets)", !(st.layoutNames || []).includes("透明") && !(st.layoutNames || []).includes("手动宽") && !(st.layoutNames || []).includes("手动高"), JSON.stringify(st.layoutNames));
  check("S1.5 序列化零污染(widgets_values 恒六值,hidden 不入保存)", st.serializedLen === 6, String(st.serializedLen));
  await page.shot("ext-s1-nine-pe-on-alpha-manual-hidden.png");

  // S2 hook 通路:切「自由」→ 透明显示(ask 场景2)
  const alphaValBefore = st.values.透明;
  check("S2.0 切自由(hook 通路)", (await page.ev(setViaHook("型选择", "自由"))).startsWith("hook:"));
  await sleep(700); // debounce 200ms 布局腿落定
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S2.1 自由 → 透明显示(hidden=false·即时)", st.alpha.hidden === false, JSON.stringify(st.alpha));
  check("S2.2 自由 → 透明可见(isWidgetVisible)", st.alpha.isVis === true, JSON.stringify(st.alpha));
  check("S2.3 只管显隐不管值(透明 value 恒存不被改写)", st.values.透明 === alphaValBefore, `${alphaValBefore} → ${st.values.透明}`);
  await page.shot("ext-s2-free-alpha-visible.png");

  // S3 assign 通路:切回九型「道具」→ 透明复隐藏(ask 场景1 动作版,轮询兜底)
  check("S3.0 切回九型道具(assign 通路)", (await page.ev(setViaAssign("型选择", "道具"))).startsWith("assign:"));
  await sleep(1500); // 兜底轮询 400ms×2+ 余量
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S3.1 九型(道具) → 透明复隐藏(轮询兜底通路)", st.alpha.hidden === true && st.alpha.isVis === false, JSON.stringify(st.alpha));
  check("S3.2 九型(道具) → 手填仍隐藏(PE 未动)", st.manualW.hidden === true && st.manualH.hidden === true, JSON.stringify({ w: st.manualW, h: st.manualH }));
  await page.shot("ext-s3-nine-again-alpha-hidden.png");

  // S4 assign 通路:PE 关 → 手填显示(ask 场景4)
  check("S4.0 PE关(assign 通路)", (await page.ev(setViaAssign("PE启用?", false))).startsWith("assign:"));
  await sleep(1500);
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S4.1 PE关 → 手动宽/手动高显示(hidden=false)", st.manualW.hidden === false && st.manualH.hidden === false, JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S4.2 PE关 → 手填可见(isWidgetVisible 双口径)", st.manualW.isVis === true && st.manualH.isVis === true, JSON.stringify({ w: st.manualW, h: st.manualH }));
  await page.shot("ext-s4-pe-off-manual-visible.png");

  // S5 hook 通路:PE 开 → 手填复隐藏(ask 场景3)
  check("S5.0 PE开(hook 通路)", (await page.ev(setViaHook("PE启用?", true))).startsWith("hook:"));
  await sleep(700);
  st = JSON.parse(String(await page.ev(panelState)) || "null");
  check("S5.1 PE开 → 手动宽/手动高复隐藏", st.manualW.hidden === true && st.manualH.hidden === true, JSON.stringify({ w: st.manualW, h: st.manualH }));
  check("S5.2 终态可见面=3(主体句/型选择/PE启用?)——缩放回归基态", JSON.stringify(st.visibleNames) === JSON.stringify(["主体句", "型选择", "PE启用?"]), JSON.stringify(st.visibleNames));
  await page.shot("ext-s5-pe-on-manual-hidden.png");

  // ── ⑲ 缩放回归:S5 终态(3 显)下 wheel 序列,每步读态+截图 ──
  const center = JSON.parse(String(await page.ev(vis(`JSON.stringify((() => {
    const c = document.querySelector('canvas'); if (!c) return { x: 860, y: 500 };
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })())`))));
  await page.ev(`(() => { const h = ${HOST}; if (h && window.app.canvas.centerOnNode) window.app.canvas.centerOnNode(h); window.app.canvas.setDirty(true, true); return 1; })()`);
  await sleep(500);
  const wheel = (dy) => page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: dy });
  const zoomSteps = [];
  let flickerFrames = 0;
  let midStates = 0;
  const stepShoot = async (i, dir) => {
    await sleep(70);
    const zs = JSON.parse(String(await page.ev(zoomState)) || "null");
    const n = zs?.vis?.length ?? -1;
    const six = n >= 6;
    if (six) flickerFrames++;
    if (n === 4 || n === 5) midStates++;
    zoomSteps.push({ step: i, dir, ...zs });
    await page.shot(`ext-zoom-${dir}-${String(i).padStart(2, "0")}-scale${zs?.scale}-${six ? "SIX-FLOCKER" : `vis${n}`}.png`);
    return zs;
  };
  for (let i = 0; i < 36; i++) { await wheel(90); await stepShoot(i, "out"); }
  for (let i = 0; i < 12; i++) { await wheel(-120); await stepShoot(i, "in"); }
  const stEnd = JSON.parse(String(await page.ev(panelState)) || "null");
  await sleep(600); // zoomQuiet 400ms 静默窗过后终态复查
  const stEnd2 = JSON.parse(String(await page.ev(panelState)) || "null");
  check("⑲.1 缩放序列零闪现帧(≥6 显=闪现;48 步)", flickerFrames === 0, `闪现帧=${flickerFrames}/48${midStates ? `,中间态(4-5显)=${midStates}` : ""}`);
  check("⑱.2 缩放后显隐终态守恒(3 显,静默窗后)", JSON.stringify(stEnd2?.visibleNames) === JSON.stringify(["主体句", "型选择", "PE启用?"]), JSON.stringify(stEnd2?.visibleNames));
  await page.shot("ext-zoom-final-3vis.png");

  // console error(装载后全程)
  check("附·装载后 console 零 error", consoleMsgs.length === 0, consoleMsgs.slice(0, 3).join(" | ") || "(零)");

  const fails = results.filter((r) => !r.pass);
  const report = {
    mode: "biground-ext-verify-1002", engine: ENGINE, wf: WF, hostType: ASM,
    finishedAt: new Date().toISOString(),
    results, zoomSteps, flickerFrames, zoomMidStates: midStates, consoleErrors: consoleMsgs,
  };
  writeFileSync(join(OUT_DIR, "ext-verify-report.json"), JSON.stringify(report, null, 2));
  log(`汇总:${results.length - fails.length}/${results.length} 绿;产物=${OUT_DIR}`);
  page.close(); killChrome();
  process.exit(fails.length ? 1 : 0);
} catch (e) {
  console.error("[FATAL]", e);
  writeFileSync(join(OUT_DIR, "ext-verify-report.json"), JSON.stringify({ fatal: String(e), results, finishedAt: new Date().toISOString() }, null, 2));
  killChrome();
  process.exit(e instanceof EnvError ? 2 : 1);
}
