// qi21 补强实验第1轮(10-02,Q1=补强·用户令)R1 双语透明强化直排单发。
//
// 缘起:s5b 实测 pe关×透明开(单英文包裹)→模型出 opaque(corners=255,
// ratioAlpha0=0);pe开路同包裹正文=剥离(PE英文)→四型 4/4 过门。
// R1 改法=MyQi21PromptSelect.compose pe关路透明包裹头句后追加官方中文透明声明
// (_ZH_ALPHA_DECL,速查卡在档原文逐字),pe开路零动。
//
// 单发(先例骨架=qi21_singleport_fire_1002.mjs f2,改点=seed3005+期望文本
// 插中文声明+alpha 由记录项升为**本轮门**(任务令「ok(过50门?)」)):
//   r1zh 自由型·pe关·透明开·seed3005(直出40步):
//     进编码文本 = 头句+" "+中文声明+" "+装配全文+" "+W1+" "+尾句(逐字);
//     门 = qi21_s6_alpha_check_0930.py expect=transparent(校准口径:四角≤2
//     且 ratioAlpha0≥0.50)退出码 0。
//
// 三证法(文证为主,先例口径):证1 排队图传导(单口链)/证2 compose 实调
// (引擎家部署副本 importlib 现读,R1 版)md5/证3 [401] 预览 md5==证2 md5。
// 产物:apps/output/reinforce-r1-1002/{fire-report.json,*.png,alpha-*.json}。
// 退出码:0=全绿含 alpha 门;1=有红(alpha 门红=模型仍不配合,如实报);2=环境错。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9382);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/reinforce-r1-1002`;
const WF_T2I = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const ENGINE_HOME = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui`;
const VENV_PY = `${ENGINE_HOME}/venv/bin/python`;
const COMPOSE_PROBE = `${REPO}/apps/build/scripts/qi21_singleport_compose_probe_1002.py`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const BASES_JSON = `${ENGINE_HOME}/ComfyUI/custom_nodes/my-nodes/nodes/qi21_bases.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = `/tmp/qi21-r1-fire-chrome-${Date.now()}`;
const ASM = "96937bbe-99d1-4f16-a06c-d86b57815d91";
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e";
const DIRECT40 = "1 · 直出40步";
const SEED = 3005;
// R1 中文透明声明(件常量逐字;与部署副本 _ZH_ALPHA_DECL 同源核对在证2)
const ZH_DECL = "这是一张带有透明度的RGBA图像 该图像具有alpha通道,背景是透明的";
const CLIENT_ID = `r1zh-fire-${Date.now()}`;
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const report = {
  mode: "reinforce-r1-1002-fire", engine: ENGINE, clientId: CLIENT_ID, wf: WF_T2I,
  wfNote: "仓库真源原样装载(loadGraphData 零注入);R1=pe关透明路头句后追加官方中文透明声明,pe开路零动",
  gate: "本轮门=alpha transparent(校准口径 四角≤2 且 ratio0≥0.50,任务令过50门)+三证法文证",
  startedAt: new Date().toISOString(), results: [], zhDecl: ZH_DECL, seed: SEED,
};
const check = (name, pass, detail = "") => {
  report.results.push({ name, pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter",
    "--disable-background-timering-throttling", ENGINE], { detached: true, stdio: "ignore" });
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
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  return {
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
      return r.result.value;
    },
  };
}
async function waitFor(fn, { timeout = 90_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}
const hostJs = (uuid) => `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(uuid)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w, names: (host.widgets || []).map((x) => x.name) };
})()`;
const setViaHook = (uuid, name, val) => `(async () => {
  const h = ${hostJs(uuid)}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; if (!w) return 'no-widget:' + ${JSON.stringify(name)};
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + '=' + ${JSON.stringify(val)};
})()`;
async function waitIdle() {
  for (let i = 0; i < 720; i++) {
    const q = await (await fetch(`${ENGINE}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(5000);
  }
  throw new Error("引擎队列 60min 未空闲");
}
function composeProbe(payload) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [COMPOSE_PROBE], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: (err || out).slice(0, 400) }); }
    });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}
async function watchExecution(pid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${ENGINE.replace("http", "ws")}/ws?clientId=${CLIENT_ID}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const state = { executedNodes: [], executedCount: 0, errors: [], lastActivity: Date.now(), done: false };
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - state.lastActivity > 20 * 60_000) { cleanup(); reject(new Error("执行停滞:>20min 无事件")); }
      if (Date.now() - startedAt > 70 * 60_000) { cleanup(); reject(new Error("单发超时 70min")); }
    }, 30_000);
    const cleanup = () => { clearInterval(timer); try { ws.close(); } catch {} };
    ws.on("error", (e) => { cleanup(); reject(new Error("ws 错误: " + e.message)); });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      state.lastActivity = Date.now();
      const d = m.data || {};
      if (m.type === "executing" && d.prompt_id === pid) {
        if (d.node === null) { state.done = true; cleanup(); resolve(state); }
        else if (!state.executedNodes.includes(d.node)) state.executedNodes.push(d.node);
      } else if (m.type === "executed" && d.prompt_id === pid) state.executedCount += 1;
      else if (m.type === "execution_error" && (d.prompt_id === pid || !d.prompt_id)) {
        state.errors.push(`${d.node}: ${d.exception_type} ${d.exception_message}`.slice(0, 400)); cleanup(); resolve(state);
      } else if (m.type === "execution_interrupted" && d.prompt_id === pid) {
        state.errors.push("interrupted"); cleanup(); resolve(state);
      }
    });
  });
}
function alphaCheck(png, expect) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [ALPHA_PY, png, expect], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: err.slice(0, 300), raw: out.slice(0, 300) }); }
    });
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let page = null;
  try {
    // ── 环境门:引擎在跑且部署副本=R1 版(探针实调应出中文声明形) ──
    const st = await fetch(`${ENGINE}/system_stats`).then((r) => r.status).catch(() => null);
    if (st !== 200) throw new Error(`引擎 ${ENGINE} 未就绪(system_stats=${st})`);
    const preProbe = await composeProbe({
      mode: "compose", 装配全文: "装配X", PE出文: null,
      pe开关: false, 透明模式: true,
      RGBA官方头句: "H", RGBA官方尾句: "T", W1收束句: "W",
    });
    check("前置·部署副本=R1 版(compose 实调头40 含中文声明)",
      preProbe.exit === 0 && preProbe.head40 && preProbe.head40.includes(ZH_DECL.slice(0, 12)),
      `head40=${preProbe.head40 ?? JSON.stringify(preProbe).slice(0, 200)}`);

    launchChrome();
    page = await getPageClient();
    log("🖱 CDP page 已接");
    // 前端就绪等待(先例 fire_1002:515-517——page target 出现≠app 就绪,
    // loadGraphData 前须等 isGraphReady===true,否则 app-not-ready)
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 90_000, interval: 1000, label: "前端 app 就绪" });
    await sleep(2000);

    // ── 装载 t2i 真源(零注入) ──
    const wfJson = JSON.parse(readFileSync(WF_T2I, "utf8"));
    const opened = await page.ev(`(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'r1zh-fire-t2i');
      return 'opened';
    })()`);
    if (opened !== "opened") throw new Error(`loadGraphData(t2i) 失败: ${opened}`);
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: "画布切换(t2i)" });
    await sleep(1500);
    log(`📂 t2i 真源已装载(${wfJson.nodes.length} 节点)`);
    // [505] 旁路(画布操作非排队图注入;衔接批 c4ee942 在册引擎侧缺口绕行:
    // 工作流 [505].type='ImageComparer (rgthree)' 引擎侧 rgthree py 注册名=
    // 'Image Comparer (rgthree)'(py/image_comparer.py:9 get_name('Image Comparer'),
    // 带空格)→POST missing_node_type;[505]=纯预览对比件(display_endpoints,
    // 不落盘零下游)旁路对本发判据([8] 直出图 alpha)零影响;域外不修真源)
    const byp = await page.ev(`(() => {
      const n = window.app.graph._nodes_by_id['505'];
      if (!n) return 'no-505';
      n.mode = 4; window.app.graph.setDirtyCanvas(true, true);
      return 'bypassed:' + n.mode;
    })()`);
    check("画布·[505] 旁路(mode=4,引擎侧未注册件绕行)", String(byp).startsWith("bypassed:4"), byp);
    await waitIdle();

    // ── 面板:自由型·pe关·透明开·直出40步·seed3005 ──
    const panelEntries = [["asm", "型选择", "自由"], ["asm", "PE启用?", false], ["asm", "透明", true],
      ["asm", "手动宽", 0], ["asm", "手动高", 0], ["acc", "速度档位", DIRECT40], ["acc", "seed", SEED]];
    for (const [which, name, val] of panelEntries) {
      const uuid = which === "asm" ? ASM : ACCEL;
      const r = await page.ev(setViaHook(uuid, name, val));
      check(`面板 ${which}.${name}=${val}`, String(r) === `set:${name}=${val}`, r);
    }

    // ── 干跑取排队图 ──
    const dryRaw = await page.ev(`(async () => {
      try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
      catch (e) { return 'ERR:' + (e && (e.message || e)); }
    })()`);
    if (String(dryRaw).startsWith("ERR:")) throw new Error("graphToPrompt 干跑失败: " + String(dryRaw).slice(0, 300));
    const prompt = JSON.parse(String(dryRaw));
    check("画布·排队图无 505 键(旁路生效,不可注册件离执行图)",
      !("505" in prompt), `keys505=${"505" in prompt};nodes=${Object.keys(prompt).length}`);
    const N = (p, k) => p[`6:${k}`];
    const isLink = (v, node, slot) => Array.isArray(v) && v[0] === `6:${node}` && v[1] === slot;
    const b = N(prompt, 4010), sel = N(prompt, 4014), pb = N(prompt, 4012);
    const peVal = typeof pb?.inputs?.boolean === "boolean" ? pb.inputs.boolean : pb?.inputs?.value;
    check("证1·排队图 [4010].base=自由/透明覆盖=true", b?.inputs?.base === "自由" && b?.inputs?.透明覆盖 === true,
      JSON.stringify({ base: b?.inputs?.base, 透明覆盖: b?.inputs?.透明覆盖 }));
    check("证1·[4012] PrimitiveBoolean=面板PE值(false)", peVal === false, String(peVal));
    check("证1·[4014].pe开关 ← [4012,0](单源扇出)", isLink(sel?.inputs?.pe开关, 4012, 0), JSON.stringify(sel?.inputs?.pe开关));
    check("证1·[4014].透明模式 ← [4010,3](透明值,纯布尔跨界)", isLink(sel?.inputs?.透明模式, 4010, 3), JSON.stringify(sel?.inputs?.透明模式));
    check("证1·单口进编码:6:4015.prompt ← [6:4014,0]", isLink(N(prompt, 4015)?.inputs?.prompt, 4014, 0), JSON.stringify(N(prompt, 4015)?.inputs?.prompt));
    check("证1·预览=实况链:主图 401.anything ← [6:4014,0]", isLink(prompt["401"]?.inputs?.anything, 4014, 0), JSON.stringify(prompt["401"]?.inputs?.anything));
    check("证1·速度档=直出40步", prompt["7:7015"]?.inputs?.mode === DIRECT40, String(prompt["7:7015"]?.inputs?.mode));
    if (!(b?.inputs?.base === "自由" && peVal === false && b?.inputs?.透明覆盖 === true)) {
      throw new Error("面板锚失配,止发(不烧采样)");
    }

    // ── 期望文本:头句+中文声明+装配全文+W1+尾句(装配全文=主体句+锁层A,BASE 现读) ──
    const subject = prompt["400"]?.inputs?.value ?? "";
    const lockA = N(prompt, 4011)?.inputs?.锁层A全文 ?? "";
    const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
    const entry = bases.find((e) => e && e.zh === "自由");
    const baseText = entry?.base_text ?? "";
    const assembly = baseText.trim() ? `${subject}\n${baseText}\n${lockA}` : `${subject}\n${lockA}`;
    const selW = sel?.inputs || {};
    const expectText = `${selW.RGBA官方头句} ${ZH_DECL} ${assembly} ${selW.W1收束句} ${selW.RGBA官方尾句}`;
    const probe = await composeProbe({
      mode: "compose", 装配全文: assembly, PE出文: null,
      pe开关: false, 透明模式: true,
      RGBA官方头句: selW.RGBA官方头句, RGBA官方尾句: selW.RGBA官方尾句, W1收束句: selW.W1收束句,
    });
    check("证2·compose 实调(R1 版)== 头句+中文声明+装配+W1+尾句 公式逐字",
      probe.exit === 0 && probe.md5 === md5(expectText),
      `probe md5=${probe.md5};公式 md5=${md5(expectText)};len=${probe.len}/${expectText.length}${probe.error ? ";ERR=" + probe.error : ""}`);
    report.expectMd5 = probe.md5;
    report.assemblyLen = assembly.length;

    // ── POST /prompt ──
    const resp = await (await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: CLIENT_ID }),
    })).json();
    if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) {
      throw new Error("POST /prompt 受理失败: " + JSON.stringify(resp).slice(0, 400));
    }
    log(`🚀 已排队(pid=${resp.prompt_id.slice(0, 8)}…,seed=${SEED})`);
    const exec = await watchExecution(resp.prompt_id);
    report.executedNodes = exec.executedNodes;
    if (exec.errors.length) check("执行零错误", false, exec.errors.join(" | "));
    else check("执行零错误", true, `执行节点 ${exec.executedNodes.length}`);

    const hist = await (await fetch(`${ENGINE}/history/${resp.prompt_id}`)).json();
    const h = hist[resp.prompt_id] || {};
    report.historyStatus = h.status?.status_str || "(missing)";
    const outputs = h.outputs || {};
    // alpha 检验对象=[8] 直出图(衔接批加 [504] 2K 落盘后 history 有两 SaveImage;
    // 直出图=[5] VAEDecode 原样存盘,alpha 属直出域,取 outputs["8"])
    const saveOut = outputs["8"];
    if (!saveOut || !saveOut.images || !saveOut.images.length) {
      throw new Error("history [8] 直出图缺失: " + JSON.stringify(Object.keys(outputs)));
    }
    report.saveKeys = Object.keys(outputs);
    const img = saveOut.images[0];
    report.pngFrom = { node: "8", filename: img.filename };
    const pngPath = join(OUT_DIR, `r1zh-free-peoff-alpha-seed${SEED}.png`);
    const buf = Buffer.from(await (await fetch(`${ENGINE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`)).arrayBuffer());
    writeFileSync(pngPath, buf);
    report.png = pngPath; report.pngBytes = buf.length;
    log(`🖼 [8] 直出图 ${buf.length}B → ${pngPath.split("/").pop()}`);

    // ── 证3:[401] 预览 md5 == 证2 md5 ──
    // textOf 两级 fallback(先例 fire_1002:text 可住 ui.text 或平级 text——
    // 本役实录 401 出 text 平级;单级取数=驱动器缺陷非链路红)
    const textOf = (k) => { const o = outputs[k]; return o?.ui?.text?.[0] ?? o?.text?.[0] ?? null; };
    const finalText = textOf("401");
    if (typeof finalText === "string") {
      report.finalTextLen = finalText.length;
      report.finalTextMd5 = md5(finalText);
      check("证3·[401] 预览 md5 == 进编码文本 md5(R1 包裹式逐字)",
        report.finalTextMd5 === report.expectMd5,
        `预览 md5=${report.finalTextMd5};期望 md5=${report.expectMd5};len=${report.finalTextLen}/${expectText.length}`);
      check("证3·结构文证:预览=头句前缀+中文声明紧随+尾句后缀",
        finalText.startsWith(selW.RGBA官方头句)
        && finalText.slice(selW.RGBA官方头句.length + 1).startsWith(ZH_DECL)
        && finalText.endsWith(selW.RGBA官方尾句),
        `head20=${finalText.slice(0, 20)}…;声明位=${finalText.includes(ZH_DECL)}`);
    } else {
      check("证3·[401] 预览文本在位", false, JSON.stringify(Object.keys(outputs)));
    }

    // ── 本轮门:alpha transparent(校准口径 四角≤2 且 ratio0≥0.50) ──
    const alpha = await alphaCheck(pngPath, "transparent");
    writeFileSync(join(OUT_DIR, `alpha-r1zh-seed${SEED}.json`), JSON.stringify(alpha, null, 2));
    report.alpha = { expect: "transparent", pass: alpha.pass === true, verdict: alpha.verdict ?? "",
      ratio0: alpha?.metrics?.ratioAlpha0 ?? null, corners: alpha?.metrics?.corners ?? null };
    check("本轮门·alpha=transparent(qi21_s6_alpha_check 校准口径:四角≤2 且 ratio0≥0.50)",
      alpha.pass === true,
      `verdict=${alpha.verdict};ratio0=${alpha?.metrics?.ratioAlpha0};corners=${JSON.stringify(alpha?.metrics?.corners)}`);
  } catch (e) {
    check("驱动异常", false, String(e && e.message));
    report.error = String(e && e.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.allPass = report.results.every((r) => r.pass);
    writeFileSync(join(OUT_DIR, "fire-report.json"), JSON.stringify(report, null, 2));
    if (page) try { page.close(); } catch {}
    killChrome();
  }
  log(`══ 汇总:${report.allPass ? "全绿(含 alpha 门)" : "有红"} ══`);
  return report.allPass ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error(e); process.exit(2); });
