#!/usr/bin/env node
// qi21 thinking 预览 mode0/4 联动×graphToPrompt 剪枝机理实测(2026-10-02,
// usertest 档在册遗留定谳:段A·零生图,分钟级)。
//
// 测法(档内口径,资产全在仓):
//   1) 隔离引擎 17599(引擎家 venv 直启,qi21_biground_engine_up_1002.py 同 argv);
//      GET /api/extensions 验 /extensions/my-nodes/qi21-panel-linkage.js 在列;
//   2) CDP 真前端(panel-linkage_1001 同款形态,CDP_PORT 默认 9391):
//      loadGraphData 装载仓库真源 t2i → [4020].mode==0(装载即归位,真源静态=4)
//      → onWidgetChanged 切 PE启用?=false → [4020].mode==4 且 graphToPrompt 队列
//      无 6:4020/6:4013/6:4019(剪枝+懒)→ 切回 true → mode==0 且队列含 6:4020
//      (anything←[6:4013 槽3])。
//      寻址=host.subgraph._nodes 内 type='easy showAnything'+title 含「PE思考」
//      (与 my_nodes/web/qi21-panel-linkage.js:131 syncThinkingPreviewMode 同款)。
//   Q3 补:真源静态 mode=4 硬读在案(无前端/API 直构保守面);[4020].widgets_values
//      两态恒 [""](mode=执行态开关零 widget 值写入);宿主 serialize 六值(PE 切换
//      只动 wv[1]);graph.serialize() 零 widget 值污染。
// 产物:apps/output/thinking-preview-1002/segA-*(png+report.json)。
// 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9391)。
// 退出码:0=全绿;1=有失败;2=环境错误。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9391);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/thinking-preview-1002`;
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91"; // [6] 装配宿主子图实例 uuid
const THINK_HINT = "PE思考";                          // 与扩展 TOKENS.thinkNodeTitleHint 同款
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-thinking-1002-chrome-${Date.now()}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleMsgs = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};
const jq = (v) => JSON.stringify(v);
const safeParse2 = (r) => { try { return JSON.parse(String(r)); } catch { return { err: String(r).slice(0, 200) }; } };

// ── 页内探针(与扩展/先例同款寻址)──
const HOST_JS = `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w };
})()`;
// [4020] thinking 预览件(syncThinkingPreviewMode 同款:type+title 锚)
const THINK_JS = `(() => {
  const h = ${HOST_JS}; if (!h) return null;
  const inner = h.host.subgraph && h.host.subgraph._nodes;
  if (!Array.isArray(inner)) return null;
  const n = inner.find((x) => x && x.type === 'easy showAnything'
    && String(x.title ?? '').includes(${JSON.stringify(THINK_HINT)}));
  return n ? { mode: n.mode, wv: n.widgets ? n.widgets.map((x) => x.value) : null,
               serializeWv: (n.serialize ? n.serialize() : {}).widgets_values ?? null } : null;
})()`;
const setPeViaHook = (val) => `(async () => {
  const h = ${HOST_JS}; if (!h) return 'no-host';
  const w = h.w['PE启用?']; if (!w) return 'no-widget';
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.('PE启用?', ${JSON.stringify(val)}, old, w);
  return 'set:PE启用?=' + ${JSON.stringify(val)};
})()`;
const dryPrompt = async (page) => {
  const raw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'ERR:' + (e && (e.message || e)); }
  })()`);
  if (String(raw).startsWith("ERR:")) throw new Error("graphToPrompt 干跑失败: " + String(raw).slice(0, 300));
  return JSON.parse(String(raw));
};

class EnvError extends Error {}

let chromeProc = null, page = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timer-throttling", ENGINE], { detached: true, stdio: "ignore" });
  chromeProc.unref();
}
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch {} }
}
async function getPageClient() {
  let target = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (target) break;
    } catch {}
    await sleep(1200);
  }
  if (!target) throw new EnvError("引擎前端 page target 未出现(90s)");
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Runtime.consoleAPICalled") {
      consoleMsgs.push(`[console.${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  return {
    send, close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
      return r.result.value;
    },
    async screenshot(name) {
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64")); log(`📸 ${name}`); }
      } catch {}
    },
  };
}
async function waitFor(fn, { timeout = 30_000, interval = 500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

const report = { mode: "segA-thinking-mode-linkage", engine: ENGINE, wf: WF, startedAt: new Date().toISOString() };
try {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── 0. 引擎+扩展就绪(档内段A 第1步)──
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version, "fe", stats.system?.required_frontend_version);
  const exts = await (await fetch(`${ENGINE}/api/extensions`)).json();
  check("A0.1 引擎已列 /extensions/my-nodes/qi21-panel-linkage.js",
    exts.some((x) => x === "/extensions/my-nodes/qi21-panel-linkage.js"),
    exts.filter((x) => x.includes("qi21-panel")).join(",") || "(未列)");

  // ── Q3 静态面:真源硬读(无前端/API 直构口径的保守基线)──
  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const sgDef = (wfJson.definitions?.subgraphs || []).find((s) => s.id === ASM);
  const staticThink = sgDef?.nodes?.find((n) => n.type === "easy showAnything" && String(n.title ?? "").includes(THINK_HINT));
  check("Q3.1 真源静态 [4020] mode=4(保守默认,无前端零强拉)", staticThink?.mode === 4, `mode=${staticThink?.mode}`);
  check("Q3.2 真源静态 [4020] widgets_values=[\"\"](零值面)", jq(staticThink?.widgets_values) === jq([""]), jq(staticThink?.widgets_values));

  // ── 1. 真前端装载(panel-linkage_1001 同款形态)──
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000); // 启动期 console 噪音冲刷
  const preLoadCount = consoleMsgs.length;
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'thinking-mode-linkage-1002');
    return 'opened';
  })()`);
  check("A1.1 loadGraphData(仓库真源原样)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
    { timeout: 40_000, interval: 1000, label: "画布切换" });

  // A1.2 装载即归位:PE启用? 默认 true → 扩展把 [4020] 从静态 4 归位 0
  const modeAfterLoad = await waitFor(async () => {
    const t = JSON.parse(String(await page.ev(vis(`JSON.stringify(${THINK_JS})`))) || "null");
    return t && t.mode === 0 ? t : null;
  }, { timeout: 20_000, interval: 400, label: "[4020] 装载即归位 mode==0" });
  check("A1.2 装载即归位:[4020].mode==0(静态4→PE开默认归0)", modeAfterLoad?.mode === 0, jq(modeAfterLoad));
  const hostSer = () => page.ev(vis(`(() => {
    try {
      const h = ${HOST_JS}; if (!h) return JSON.stringify(null);
      if (typeof h.host.serialize !== 'function') return JSON.stringify({ err: 'no-serialize-fn' });
      const s = h.host.serialize();
      return JSON.stringify({ wv: s?.widgets_values ?? null });
    } catch (e) { return JSON.stringify({ err: String(e && (e.message || e)).slice(0, 200) }); } })()`))
    .then((r) => { try { return JSON.parse(String(r)); } catch { return { err: String(r).slice(0, 200) }; } });
  const hostSer0 = await hostSer();
  // 宿主六值序=[主体句,型选择,PE启用?,透明,手动宽,手动高](PE启用?=wv[2],首跑实测勘误)
  check("Q3.3 宿主 serialize 六值(装载态·PE启用?=true 在 wv[2])",
    Array.isArray(hostSer0?.wv) && hostSer0.wv.length === 6 && hostSer0.wv[2] === true, jq(hostSer0?.wv));
  check("Q3.4 [4020] widgets_values 恒 [\"\"](mode0 态零值写)",
    jq(modeAfterLoad?.serializeWv) === jq([""]) || jq(modeAfterLoad?.wv) === jq([""]),
    `serialize=${jq(modeAfterLoad?.serializeWv)} live=${jq(modeAfterLoad?.wv)}`);
  await page.screenshot("segA-mode0-peon-loaded.png");

  // tick 活性·基线(装载后立即):破坏手动宽 hidden,400ms 轮询活着必恢复
  {
    const b = await page.ev(`(() => { const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); const w = (host && host.widgets || []).find((x) => x.name === "手动宽"); if (!w) return "no-w"; w.hidden = false; return "broken"; })()`);
    const seq = [];
    for (let i = 0; i < 8; i++) {
      await sleep(300);
      const st = safeParse2(await page.ev(`(() => { const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); const w = (host && host.widgets || []).find((x) => x.name === "手动宽"); return JSON.stringify({ hid: w ? !!w.hidden : null }); })()`));
      seq.push(st?.hid);
      if (st?.hid === true) break;
    }
    report.tickAliveBaseline = { break: b, seq, alive: seq.includes(true) };
    log(`🔎 tick 活性·基线(装载后立即破坏→恢复):${jq(seq)} → ${report.tickAliveBaseline.alive ? "tick 在跑" : "tick 已停"}`);
  }

  // PE 开态排队图:6:4020 在队列且 anything←[6:4013 槽3]
  let pOn = await dryPrompt(page);
  const linkOn = pOn["6:4020"]?.inputs?.anything;
  check("A2.1 PE开:graphToPrompt 队列含 6:4020(anything←[6:4013,3])",
    Array.isArray(linkOn) && linkOn[0] === "6:4013" && linkOn[1] === 3, jq(linkOn));
  check("A2.2 PE开:队列含 6:4013/6:4019(PE 支路在执行图)",
    "6:4013" in pOn && "6:4019" in pOn, `4013=${"6:4013" in pOn} 4019=${"6:4019" in pOn}`);

  // ── 3. onWidgetChanged 切 PE启用?=false → mode4 + 剪枝+懒 ──
  const setOff = await page.ev(setPeViaHook(false));
  check("A3.0 onWidgetChanged 切 PE启用?=false", setOff === "set:PE启用?=false", String(setOff));
  const tOff = JSON.parse(String(await page.ev(vis(`JSON.stringify(${THINK_JS})`))) || "null");
  check("A3.1 PE关:[4020].mode==4(联动即时,钩子内同步)", tOff?.mode === 4, jq(tOff));
  let pOff = await dryPrompt(page);
  check("A3.2 PE关:graphToPrompt 队列无 6:4020(mode4 旁路剪枝)", !("6:4020" in pOff), `keys4020=${Object.keys(pOff).filter((k) => k.includes("4020"))}`);
  // ── 机理观察(非门):PE关排队图对 6:4013/6:4019 的形态 ──
  // 首跑实测:mode4 只把 OUTPUT_NODE [4020] 本体剪出排队图;[4013] 因 lazy
  // 消费者连线([4014].PE出文←[4013,0]/[4018].wh_ratio←[4013,2])静态保留在
  // 排队图——懒执行剪枝在引擎执行级(lazy 槽不求值不拉起),非 graphToPrompt
  // 层。与档内预期「队列无 6:4013」差异如实记录,执行级定谳归段B s4。
  report.pOffLazyShape = {
    has4013: "6:4013" in pOff, has4019: "6:4019" in pOff,
    link4014pe: jq(pOff["6:4014"]?.inputs?.PE出文), link4018wh: jq(pOff["6:4018"]?.inputs?.wh_ratio),
  };
  log(`🔎 机理观察:PE关排队图 6:4013=${report.pOffLazyShape.has4013} 6:4019=${report.pOffLazyShape.has4019}`
    + `(lazy 消费者连线在:${report.pOffLazyShape.link4014pe}/${report.pOffLazyShape.link4018wh};执行级剪枝归段B)`);
  check("A3.5 PE关:主链无伤(6:4011 装配/6:4015 主编码/7:7015 速度选择仍在)",
    "6:4011" in pOff && "6:4015" in pOff && "7:7015" in pOff,
    `4011=${"6:4011" in pOff} 4015=${"6:4015" in pOff} 7015=${"7:7015" in pOff}`);
  check("Q3.5 [4020] widgets_values 恒 [\"\"](mode4 态零值写)",
    jq(tOff?.serializeWv) === jq([""]) || jq(tOff?.wv) === jq([""]),
    `serialize=${jq(tOff?.serializeWv)} live=${jq(tOff?.wv)}`);
  const hostSerOff = await hostSer();
  check("Q3.6 PE 切换只动宿主 wv[2](PE启用? 面板值),其余五值零动",
    Array.isArray(hostSerOff?.wv) && hostSerOff.wv.length === 6 && hostSerOff.wv[2] === false
      && [0, 1, 3, 4, 5].every((i) => hostSerOff.wv[i] === hostSer0.wv[i]),
    `wv[2]: ${hostSer0?.wv?.[2]} → ${hostSerOff?.wv?.[2]};其余五值零动=${[0, 1, 3, 4, 5].every((i) => hostSerOff?.wv?.[i] === hostSer0?.wv?.[i])}`);
  await page.screenshot("segA-mode4-peoff.png");

  // ── Q3.7 整图序列化:[4020] 值面零污染(mode 是 litegraph 原生节点属性,如实记录)──
  const serGraph = await page.ev(vis(`(() => {
    try { const s = window.app.graph.serialize();
      const sg = (s.definitions?.subgraphs || []).find((x) => x.id === ${JSON.stringify(ASM)});
      const n = sg?.nodes?.find((x) => String(x.title ?? '').includes(${JSON.stringify(THINK_HINT)}));
      return JSON.stringify(n ? { mode: n.mode, wv: n.widgets_values ?? null } : null);
    } catch (e) { return JSON.stringify({ err: String(e && (e.message || e)).slice(0, 200) }); } })()`))
    .then((r) => { try { return JSON.parse(String(r)); } catch { return { err: String(r).slice(0, 200) }; } });
  check("Q3.7 graph.serialize():[4020] widgets_values==[\"\"](值面零污染)",
    jq(serGraph?.wv) === jq([""]), jq(serGraph));
  report.serGraph4020 = serGraph; // mode 序列化行为如实记录(litegraph 原生,执行态属性)

  // ── Q3.8 竞态尽力补:PE 开态手置 mode=4(模拟无扩展未归位)→ 立即干跑 ──
  // (400ms 兜底轮询会把 mode 拉回 0,读窗窄;若竞态失手如实记录,A3.2/A3.3 已同构证明)
  const raceProbe = await page.ev(`(async () => {
    const h = ${HOST_JS}; if (!h) return 'no-host';
    const inner = h.host.subgraph && h.host.subgraph._nodes;
    const n = inner && inner.find((x) => x && x.type === 'easy showAnything'
      && String(x.title ?? '').includes(${JSON.stringify(THINK_HINT)}));
    if (!n) return 'no-think';
    n.mode = 4;
    try { const p = await window.app.graphToPrompt();
      return JSON.stringify({ has4020: '6:4020' in (p.output || {}), has4013: '6:4013' in (p.output || {}) });
    } catch (e) { return 'ERR:' + (e && e.message); }
  })()`);
  let raceParsed = null;
  try { raceParsed = JSON.parse(String(raceProbe)); } catch {}
  report.q38Race = raceParsed ?? String(raceProbe).slice(0, 200);
  check("Q3.8 PE开×手置mode4(API 直构同构面):干跑无 6:4020(mode 决定,与面板值无关)",
    raceParsed ? raceParsed.has4020 === false : false,
    `has4020=${raceParsed?.has4020} has4013=${raceParsed?.has4013}(lazy 连线静态保留,同 A3 观察)`);
  // 诊断0:先证轮询活着——纯 assign(非钩子)切型选择=自由,「透明」显隐只有
  // 400ms 兜底轮询能管(panel-linkage 1001 S3 同款);变=轮询在跑。
  const setViaAssign = (name, val) => `(async () => {
    const h = ${HOST_JS}; if (!h) return 'no-host';
    h.w[${JSON.stringify(name)}].value = ${JSON.stringify(val)};
    return 'assign:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
  })()`;
  const assignFree = await page.ev(setViaAssign("型选择", "自由"));
  const safeParse = (r) => { try { return JSON.parse(String(r)); } catch { return { err: String(r).slice(0, 300) }; } };
  // 单行极简探针(前版嵌套模板在页内报 SyntaxError,弃用)
  const ALPHA1 = `(() => { const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); const w = (host && host.widgets || []).find((x) => x.name === "透明"); return JSON.stringify({ hid: w ? !!w.hidden : null, wcount: host ? host.widgets.length : -1 }); })()`;
  let alphaShownSeq = [];
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const st = safeParse(await page.ev(ALPHA1));
    alphaShownSeq.push(st?.err ? "ERR" : st?.hid);
    if (st?.hid === false) break;
  }
  const pollAlive = alphaShownSeq.includes(false);
  report.pollAliveProbe = { assignFree, alphaShownSeq, pollAlive };
  log(`🔎 轮询活性·alpha(assign型选择=自由→透明显隐):${jq(alphaShownSeq)}(注:w.value 赋值疑似 setter 即时通路,此探针只作辅证)`);
  await page.ev(setViaAssign("型选择", "人物")); // 复位(轮询自会复隐藏)
  // 轮询活性·决定性探针:直接破坏「手动宽」hidden(纯属性赋值零回调,只有
  // 400ms 兜底轮询的 applyLinkage 能恢复);PE 开→手动宽应复 hidden=true
  const breakHid = await page.ev(`(() => { const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); const w = (host && host.widgets || []).find((x) => x.name === "手动宽"); if (!w) return "no-w"; w.hidden = false; return "broken"; })()`);
  const MW1 = `(() => { const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(ASM)}); const w = (host && host.widgets || []).find((x) => x.name === "手动宽"); return JSON.stringify({ hid: w ? !!w.hidden : null }); })()`;
  let mwSeq = [];
  for (let i = 0; i < 8; i++) {
    await sleep(300);
    const st = safeParse(await page.ev(MW1));
    mwSeq.push(st?.err ? "ERR" : st?.hid);
    if (st?.hid === true) break;
  }
  const tickAlive = mwSeq.includes(true);
  report.tickAliveProbe = { breakHid, mwSeq, tickAlive };
  log(`🔎 轮询活性·决定性(破坏手动宽hidden→tick恢复):${jq(mwSeq)} → ${tickAlive ? "tick 在跑" : "tick 未恢复(2.4s)"}`);

  // 诊断:手置 mode4 后兜底轮询是否归位(400ms tick×syncThinkingPreviewMode);
  // 不归位则验钩子通路兜底,如实记录轮询路径形态(Q3「mode 残留错态」证据面)
  const pollSeq = [];
  for (let i = 0; i < 12; i++) {
    await sleep(300);
    const t = JSON.parse(String(await page.ev(vis(`JSON.stringify(${THINK_JS})`))) || "null");
    pollSeq.push(t?.mode);
    if (t?.mode === 0) break;
  }
  let hookBack = null;
  if (!pollSeq.includes(0)) {
    hookBack = await page.ev(setPeViaHook(true)); // 钩子通路兜底(值本已 true,重发钩子)
  }
  const tAfter = JSON.parse(String(await page.ev(vis(`JSON.stringify(${THINK_JS})`))) || "null");
  report.mode4Recovery = { pollSeq, hookBack, modeAfter: tAfter?.mode };
  check("A4.0 手置扰动后可归位 mode==0(轮询或钩子兜底)",
    tAfter?.mode === 0, `pollSeq=${jq(pollSeq)} hook=${jq(hookBack)} → mode=${tAfter?.mode}`);

  // ── 4. 切回 true → mode0 + 队列复含 6:4020 ──
  const setOn = await page.ev(setPeViaHook(true));
  check("A4.1 onWidgetChanged 切回 PE启用?=true", setOn === "set:PE启用?=true", String(setOn));
  const tOn = JSON.parse(String(await page.ev(vis(`JSON.stringify(${THINK_JS})`))) || "null");
  check("A4.2 PE开:[4020].mode==0(联动恢复)", tOn?.mode === 0, jq(tOn));
  let pOn2 = await dryPrompt(page);
  const linkOn2 = pOn2["6:4020"]?.inputs?.anything;
  check("A4.3 PE开:队列复含 6:4020(anything←[6:4013,3])",
    Array.isArray(linkOn2) && linkOn2[0] === "6:4013" && linkOn2[1] === 3, jq(linkOn2));
  check("A4.4 PE开:队列复含 6:4013/6:4019", "6:4013" in pOn2 && "6:4019" in pOn2,
    `4013=${"6:4013" in pOn2} 4019=${"6:4019" in pOn2}`);

  // ── 5. 装载后 console 零 error ──
  await sleep(1200);
  const postLoad = consoleMsgs.slice(preLoadCount);
  const errs = postLoad.filter((m) => /error|uncaught|failed to/i.test(m));
  check("A5.1 装载后 console 零 error(联动扩展不炸)", errs.length === 0, errs.slice(0, 3).join(" | ").slice(0, 300) || "(clean)");
} catch (e) {
  if (e instanceof EnvError) { check("环境段", false, e.message); process.exitCode = 2; }
  else { results.push({ name: "驱动异常", pass: false, detail: String(e && e.message) }); log("驱动异常:", e); }
} finally {
  report.finishedAt = new Date().toISOString();
  report.results = results;
  report.pass = results.length > 0 && results.every((r) => r.pass);
  try { writeFileSync(join(OUT_DIR, "segA-mode-linkage-report.json"), JSON.stringify(report, null, 2)); } catch {}
  try { page?.close(); } catch {}
  killChrome();
}
log("════ 段A thinking 联动×剪枝汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
