#!/usr/bin/env node
// qi21 单口战役(10-02-qi21-subgraph-singleport)真前端 loadGraphData 三件验证
// — implement.md 步4 前半:真前端 loadGraphData 三件 missing=0 + 圆点连线目验(坑3)。
//
// 口径(missing=0 的可执行化,先例 qi21_usertest_loadgraph_1001.mjs A-G):
//   A. object_info 单口面在引擎(Select 单口/7 槽;件级已由 engine_up 验,此处免);
//   B. 三件仓库真源 JSON 原样 loadGraphData(零注入);
//   C. 画布节点数/活链数 == JSON 声明(丢件丢线=红);
//   D. 干跑 graphToPrompt 成功(缺类型/缺输入/断链即抛=转换层 missing=0)
//      + 展开计数(装配子图=子图件数-Note;根=主图-Note-宿主);
//   E. 单口接线数据面(圆点连线判据):
//      E1 装配子图内 MyQi21PromptSelect 恰 1 件;inputs 7 槽
//         (装配全文/PE出文/pe开关/透明模式=链;头/尾/W1=widget 值);
//      E2 [4015].prompt ← ["6:4014",0](单口进编码,t2i/edit;i2i 另验 [171]);
//      E3 [4014].outputs 恰 1 口「进编码文本」且 links 扇出含编码器+边界出口;
//      E4 子图 links 对象格式(origin_id/origin_slot/target_id/target_slot)+
//          边界 io linkIds 反向登记(坑3:圆点持有连线的数据面);
//   F. 装载后 console 零 missing/error 级告警;
//   G. 三件主图截图(圆点连线目验留档)。
// 产物:apps/output/singleport-1002/loadgraph/{report.json,*-canvas.png}。
// 环境变量:ENGINE_URL(默认 17599)/CDP_PORT(默认 9379)。退出码 0=全绿;1=有红;2=环境错。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9379);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/singleport-1002/loadgraph`;
const WF = {
  t2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  i2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
  edit: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`,
};
// 装配子图 uuid(宿主 [6];t2i 同大轮 HOSTS)
const ASM_SG = {
  t2i: "96937bbe-99d1-4f16-a06c-d86b57815d91",
  i2i: "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d",
  edit: "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01",
};
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-singleport-loadgraph-chrome-${Date.now()}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleMsgs = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
  return Boolean(pass);
};
const SEL_LINK_SLOTS = ["装配全文", "PE出文", "pe开关", "透明模式"];
const SEL_VALUE_SLOTS = ["RGBA官方头句", "RGBA官方尾句", "W1收束句"];
// 按件连线性期望(手术终态;i2i=[4014] 指令选择路+[153] 单图进编码路 两件):
//   t2i [4014]:四连线槽全链;edit [4014]:透明模式 None(edit 无透明文本路);
//   i2i [4014]:透明模式断线(择文上位件禁透明包裹,边界唯一驻 [153]);
//   i2i [153]:PE出文/pe开关 None(单图路 pe 恒关 widget)。
const SEL_EXPECT = {
  t2i: [{ id: 4014, links: { 装配全文: 1, PE出文: 1, pe开关: 1, 透明模式: 1 } }],
  i2i: [
    { id: 4014, links: { 装配全文: 1, PE出文: 1, pe开关: 1, 透明模式: 0 } },
    { id: 153, links: { 装配全文: 1, PE出文: 0, pe开关: 0, 透明模式: 1 } },
  ],
  edit: [{ id: 4014, links: { 装配全文: 1, PE出文: 1, pe开关: 1, 透明模式: 0 } }],
};

let chromeProc = null;
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
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch {}
    await sleep(1200);
  }
  if (!page) throw new Error("引擎前端 page target 未出现(90s)");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Log.entryAdded") consoleMsgs.push(`[log] ${m.params.entry.level} ${m.params.entry.text}`);
    if (m.method === "Runtime.consoleAPICalled") {
      consoleMsgs.push(`[console.${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Log.enable").catch(() => {});
  return {
    send,
    close: () => ws.close(),
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
async function waitFor(fn, { timeout = 90_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

// ── 静态面:仓库 JSON 单口结构断言(圆点连线的数据面前提) ──
function staticSingleportChecks(key, wf) {
  const sg = (wf.definitions?.subgraphs || []).find((s) => s.id === ASM_SG[key]);
  if (!check(`[${key}] 静态·装配子图定义在位(${sg?.nodes?.length ?? 0} 件/${sg?.links?.length ?? 0} 线)`, !!sg, `uuid=${ASM_SG[key]}`)) return null;
  // E4a links 对象格式(坑3)
  const badLinks = (sg.links || []).filter((l) => typeof l === "object"
    && !("origin_id" in l && "origin_slot" in l && "target_id" in l && "target_slot" in l));
  check(`[${key}] 静态·子图 links 全对象格式(origin/target 四字段,坑3)`, badLinks.length === 0, `异常 ${badLinks.length} 条`);
  // E1 件面(按件期望集:i2i 两件)
  const sels = (sg.nodes || []).filter((n) => n.type === "MyQi21PromptSelect");
  const expectSels = SEL_EXPECT[key];
  check(`[${key}] 静态·MyQi21PromptSelect ${expectSels.length} 件在位`, sels.length === expectSels.length,
    `得 ${sels.length}:[${sels.map((s) => s.id).join(",")}]`);
  for (const exp of expectSels) {
    const sel = sels.find((s) => s.id === exp.id);
    if (!sel) { check(`[${key}] 静态·[${exp.id}] 在场`, false, "缺件"); continue; }
    const out = sel.outputs || [];
    check(`[${key}] 静态·[${exp.id}] 输出面恰 1 口「进编码文本」`,
      out.length === 1 && out[0].name === "进编码文本" && out[0].slot_index === 0 && (out[0].links || []).length >= 1,
      `outs=${JSON.stringify(out.map((o) => `${o.slot_index}:${o.name}→${JSON.stringify(o.links)}`))}`);
    const inNames = (sel.inputs || []).map((i) => i.name);
    check(`[${key}] 静态·[${exp.id}] inputs 7 槽序(2连线+2布尔+3固定句)`,
      JSON.stringify(inNames) === JSON.stringify([...SEL_LINK_SLOTS, ...SEL_VALUE_SLOTS]),
      JSON.stringify(inNames));
    const linksOk = [];
    for (const [nm, want] of Object.entries(exp.links)) {
      const got = (sel.inputs || []).find((i) => i.name === nm)?.link ?? null;
      const isLink = typeof got === "number" && got >= 0;
      linksOk.push(`${nm}=${want ? (isLink ? "链✓" : `期望链实无(${got})`) : (got === null ? "无✓" : `期望无实链(${got})`)}`);
    }
    check(`[${key}] 静态·[${exp.id}] 连线性按件期望(圆点持线)`, linksOk.every((s) => s.endsWith("✓")), linksOk.join(";"));
    const valueNoLink = SEL_VALUE_SLOTS.every((nm) => ((sel.inputs || []).find((i) => i.name === nm)?.link ?? null) === null);
    check(`[${key}] 静态·[${exp.id}] 三固定句=widget 无链`, valueNoLink, "");
    const wv = sel.widgets_values || [];
    check(`[${key}] 静态·[${exp.id}] wv=7 值形且头部 2 空串占位(坑1)`,
      wv.length === 7 && wv[0] === "" && wv[1] === "" && typeof wv[2] === "boolean" && typeof wv[3] === "boolean",
      `len=${wv.length};head=${JSON.stringify(wv.slice(0, 4))}`);
  }
  // E4b 边界 io linkIds(坑3)
  const ioLinkIds = [...(sg.inputs || []).flatMap((i) => i.linkIds || []), ...(sg.outputs || []).flatMap((o) => o.linkIds || [])];
  const ioMissing = ioLinkIds.filter((lid) => !(sg.links || []).some((l) => l.id === lid));
  check(`[${key}] 静态·边界 io linkIds 全部落到 links 表(坑3,${ioLinkIds.length} 条)`,
    ioLinkIds.length > 0 && ioMissing.length === 0, `悬空=${JSON.stringify(ioMissing)}`);
  return sg;
}

// ── 排队图单口断言(D+E 段合流)──
function promptSingleportChecks(key, prompt, sg, wfJson) {
  const keys = Object.keys(prompt);
  const sub = Object.entries(prompt).filter(([k]) => /^6:\d+$/.test(k));
  const acc = Object.entries(prompt).filter(([k]) => /^7:\d+$/.test(k));
  const root = keys.filter((k) => !k.includes(":"));
  const noteCount = (sg.nodes || []).filter((n) => n.type === "MarkdownNote").length;
  const expectAsm = (sg.nodes || []).length - noteCount;
  const mainNotes = wfJson.nodes.filter((n) => n.type === "MarkdownNote").length;
  const reroutes = wfJson.nodes.filter((n) => n.type === "Reroute").length; // Reroute=画布布线件,转换层内联不生成键
  const expectRoot = wfJson.nodes.length - mainNotes - reroutes - 2; // -两宿主([6][7] 展开成 6:/7: 键)
  check(`[${key}] D1 graphToPrompt 成功(零 missing,缺类型/缺输入/断链即抛)`, true, `keys=${keys.length}`);
  check(`[${key}] D2 装配子图展开=${expectAsm}(件${sg.nodes.length}-Note${noteCount})`,
    sub.length === expectAsm, `得 ${sub.length}:${JSON.stringify(sub.map(([k]) => k))}`);
  check(`[${key}] D3 根节点=${expectRoot}(主图${wfJson.nodes.length}-Note${mainNotes}-Reroute${reroutes}-两宿主)`,
    root.length === expectRoot, `得 ${root.length}:${JSON.stringify(root)}`);
  log(`   (加速子图展开 ${acc.length}:${JSON.stringify(acc.map(([k]) => k))})`);
  // E1/E2 排队图面:每件 Select 四连线槽=链引用+三固定句=值
  for (const exp of SEL_EXPECT[key]) {
    const selKey = `6:${exp.id}`;
    const sel = prompt[selKey];
    if (!check(`[${key}] E1 排队图 ${selKey} 在场`, !!sel, `键集=${JSON.stringify(keys.filter((k) => k.includes(String(exp.id))))}`)) continue;
    const si = sel.inputs || {};
    const linksOk = Object.entries(exp.links).every(([nm, want]) => want === (Array.isArray(si[nm]) ? 1 : 0));
    const valueOk = SEL_VALUE_SLOTS.every((nm) => typeof si[nm] === "string" && si[nm].length > 10);
    check(`[${key}] E1b ${selKey} 连线槽=链引用(按件期望)+固定句=值`,
      linksOk && valueOk,
      `slots=${JSON.stringify(Object.fromEntries(Object.entries(exp.links).map(([nm]) => [nm, Array.isArray(si[nm]) ? "链" : typeof si[nm]])))};头句len=${(si.RGBA官方头句 || "").length}`);
  }
  // E2 单口进编码接线(按件)
  const e2 = {
    t2i: [["6:4015", "prompt", "6:4014"]],
    i2i: [["6:4015", "prompt", "6:153"], ["6:171", "prompt", "6:153"], ["6:4011", "主体句", "6:4014"]],
    edit: [["6:4015", "prompt", "6:4014"], ["6:4016", "prompt", "6:4014"]],
  }[key];
  for (const [target, slot, source] of e2) {
    const got = prompt[target]?.inputs?.[slot];
    check(`[${key}] E2 单口接线:${target}.${slot} ← ["${source}",0]`,
      JSON.stringify(got) === JSON.stringify([source, 0]), `得 ${JSON.stringify(got)}`);
  }
}

let page = null;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  const stats = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", stats.system?.comfyui_version);
  const selInfo = (await (await fetch(`${ENGINE}/object_info/MyQi21PromptSelect`)).json()).MyQi21PromptSelect;
  check("A1 引擎单口面 output_name=['进编码文本']", JSON.stringify(selInfo?.output_name) === JSON.stringify(["进编码文本"]),
    JSON.stringify(selInfo?.output_name));

  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  await sleep(3000);

  for (const key of Object.keys(WF)) {
    const wfJson = JSON.parse(readFileSync(WF[key], "utf8"));
    const sg = staticSingleportChecks(key, wfJson);
    if (!sg) continue;
    const preLoadCount = consoleMsgs.length;
    const opened = await page.ev(`(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'singleport-loadgraph-${key}');
      return 'opened';
    })()`);
    check(`[${key}] B1 loadGraphData(仓库真源原样·零注入)`, opened === "opened", String(opened));
    if (opened !== "opened") continue;
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: `画布切换(${key})` });
    await sleep(2000);

    const canvasCounts = await page.ev(vis(`JSON.stringify({
      nodes: window.app.graph._nodes.length,
      liveLinks: Object.keys(window.app.graph.links || {}).length,
    })`));
    const cc = JSON.parse(String(canvasCounts));
    check(`[${key}] C1 画布节点数=${wfJson.nodes.length}(零丢件)`, cc.nodes === wfJson.nodes.length, canvasCounts);
    check(`[${key}] C2 画布活链=${wfJson.links.length}(零丢线,圆点连线全持)`, cc.liveLinks === wfJson.links.length, canvasCounts);

    const dryRaw = await page.ev(`(async () => {
      try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
      catch (e) { return 'ERR:' + (e && (e.message || e)); }
    })()`);
    if (String(dryRaw).startsWith("ERR:")) {
      check(`[${key}] D1 干跑 graphToPrompt 成功(零 missing)`, false, String(dryRaw).slice(0, 400));
      continue;
    }
    const prompt = JSON.parse(String(dryRaw));
    promptSingleportChecks(key, prompt, sg, wfJson);

    const postLoad = consoleMsgs.slice(preLoadCount);
    const bad = postLoad.filter((m) => /missing|not found|unknown node|failed to|error/i.test(m));
    check(`[${key}] F1 装载后零 missing/error 级告警`, bad.length === 0,
      bad.slice(0, 5).join(" | ").slice(0, 400) || `(clean;装载后窗口 ${postLoad.length} 条全无告警)`);
    await page.screenshot(`${key}-canvas.png`);
  }
} catch (e) {
  results.push({ name: "驱动异常", pass: false, detail: String(e && e.message) });
  log("驱动异常:", e);
} finally {
  const report = {
    mode: "singleport-1002-loadgraph", engine: ENGINE, wf: { ...WF },
    wfNote: "三件仓库真源原样装载(loadGraphData 零注入);单口数据面+坑3 links对象格式/linkIds",
    finishedAt: new Date().toISOString(),
    results,
    consoleMsgs: consoleMsgs.slice(0, 120),
  };
  try { writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2)); } catch {}
  try { page?.close(); } catch {}
  killChrome();
}
log("\n════ 单口 loadGraphData 三件验证汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
const failed = results.filter((r) => !r.pass);
log(failed.length === 0 ? "全绿" : `失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
