#!/usr/bin/env node
/**
 * qi21 道劫·九型实弹(本役 type-N 单型驱动器)
 * ——————————————————————————————————————————————
 * 铁律(FACTS.md §3.2 + 任务书):
 *  - 只允许两处改动:「型选择」=目标型;「主体句」=FACTS 出处原句逐字。其余 widget 保持保存态。
 *  - 必须现场 graphToPrompt 转换投递,禁用历史 API 快照;投前在队列 prompt 对象上断言链形(核队列不核文件)。
 *  - 断言域=daojie-t2i-app-e2e.mjs db41519 D5 重锚三闸(PE.prompt←PE开关口0 / 主体句源含头18字 /
 *    BASE←型底座+锁层A 逐字739字),旧 cfg4 锚(MyQi21ChinesePE/[4015].prompt←[6:4014]旧形态/[4012].boolean)勿照抄。
 *  - 引擎:查三态复用现役(17000);本驱动绝不拉起/杀引擎。
 * 链路:headless Chrome 真前端 loadGraphData(仓库真源)→ 恰两处置值 → 读回核保存态 →
 *       graphToPrompt 干跑断言 → POST /prompt(断言过的同一对象)→ /history 轮询(sleep 轮询勿忙转)→
 *       三层收据(image-prompts 日志段 / PNG tEXt 元数据 / history prompt JSON)+ /view 下图。
 * 退出码:0=全绿;1=任何门红(响亮失败,保留现场证据)。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ── 配置(env) ──
const TYPE_KEY = process.env.TYPE_KEY || "人物";
const TYPE_IDX = Number(process.env.TYPE_IDX || 1);
// 破缓存通道(owner 2026-10-06 裁定①:合规拍 100% 节点缓存命中时,允许 seed=4100+型序号 作第三处改动重投一次;
// 先例=cfg4 战役固定 seed;诚实记账:R.deviation 记保存态偏差,总报告须列「与保存态偏差」节)
const SEED_OVERRIDE = process.env.SEED_OVERRIDE ? Number(process.env.SEED_OVERRIDE) : null;
const SUBJECT_FILE = process.env.SUBJECT_FILE || "";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const CAMPAIGN = "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/qi21-9xing-livefire";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const WF_T2I = join(REPO, "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json");
const COMFY_HOME = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui"; // realpath 归一后的引擎家(FACTS §4.1)
const VENV_PY = join(COMFY_HOME, "venv/bin/python3");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BUDGET_MIN = Number(process.env.BUDGET_MIN || 38); // 单型执行预算(45min 硬帽留 7min 取证)
const CDP_PORT = Number(process.env.CDP_PORT || 0) || await pickCdpPort();

const RUNS = join(CAMPAIGN, "runs");
const IMAGES = join(CAMPAIGN, "images");
const VERIFY = join(CAMPAIGN, "verify");
const LOGSD = join(CAMPAIGN, "logs");
for (const d of [RUNS, IMAGES, VERIFY, LOGSD]) mkdirSync(d, { recursive: true });
const SLUG = `type-${TYPE_IDX}-${TYPE_KEY}`; // 型名=中文,macOS 文件名合法(任务书:含非法字符才只用序号)

const t0 = Date.now();
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const log = (...a) => console.log(`[T+${Math.round((Date.now() - t0) / 1000)}s]`, ...a);

const R = { // raw 记录(成败都落盘)
  type: { idx: TYPE_IDX, key: TYPE_KEY, transparent: process.env.TYPE_TRANSPARENT === "1" },
  engine: { url: ENGINE, startedByUs: false, precheck: {} },
  subject: { file: SUBJECT_FILE, len: 0, md5: "" },
  workflow: { path: WF_T2I },
  changes: [], readbacks: {}, queueAsserts: [], timings: {}, receipts: {}, images: {},
  checks: [], ok: false,
};
const check = (name, pass, detail = "") => { R.checks.push({ name, pass, ok: !!pass, detail: String(detail).slice(0, 500) }); log(`${pass ? "✅" : "❌"} ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`); return !!pass; };
function dumpRaw(exitCode) {
  R.elapsedSec = Math.round((Date.now() - t0) / 1000);
  try { writeFileSync(join(RUNS, `${SLUG}.json`), JSON.stringify(R, null, 2)); } catch (e) { console.error("raw JSON 落盘失败:", e.message); }
  log(`raw → runs/${SLUG}.json (exit=${exitCode})`);
}

// ── CDP ──
async function pickCdpPort() {
  for (const p of [9310, 9311, 9312, 9313, 9314, 9315, 9316, 9317, 9318, 9319, 9320, 9321]) {
    try { await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(500) }); } catch (e) { if (String(e?.cause?.code || e?.message).includes("ECONNREFUSED")) return p; }
  }
  throw new Error("无空闲 CDP 口(9310-9321)");
}
let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/qi21-9xing-chrome-${Date.now()}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter", "--disable-background-timer-throttling", ENGINE],
    { detached: true, stdio: "ignore" });
  chromeProc.unref();
}
function killChrome() { if (!chromeProc) return; try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch {} } }
async function getPageClient() {
  for (let i = 0; i < 75; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0; const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(String(ev.data));
          if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
        });
        const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
        await send("Runtime.enable"); await send("Page.enable");
        return { close: () => ws.close(), async ev(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400); return r.result.value; } };
      }
    } catch {}
    await sleep(1200);
  }
  throw new Error("引擎前端 page target 未出现(90s)");
}
const vis = (x) => `(() => { try { const v = ${x}; return v === undefined || v === null || v === false ? null : v; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
async function waitFor(fn, { timeout = 90_000, interval = 1500, label = "" } = {}) {
  const s = Date.now();
  while (Date.now() - s < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

// ── 置值器(旧役验证过的原样机制) ──
const hostJs = (uuid) => `(() => {
  const host = window.app.graph._nodes.find((n) => n.type === ${JSON.stringify(uuid)});
  if (!host) return null;
  const w = {}; for (const x of host.widgets || []) w[x.name] = x;
  return { host, w, names: (host.widgets || []).map((x) => x.name) };
})()`;
const setViaHook = (uuid, name, val) => `(async () => {
  const h = ${hostJs(uuid)}; if (!h) return 'no-host';
  const w = h.w[${JSON.stringify(name)}]; if (!w) return 'no-widget:' + ${JSON.stringify(name)} + ';have=' + h.names.join(',');
  const old = w.value; w.value = ${JSON.stringify(val)};
  h.host.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + ':old=' + String(old);
})()`;
const setNodeWidget = (nid, name, val) => `(() => {
  const n = window.app.graph._nodes.find((x) => String(x.id) === ${JSON.stringify(String(nid))});
  if (!n) return 'node-missing:' + ${JSON.stringify(String(nid))};
  const w = (n.widgets || []).find((x) => x.name === ${JSON.stringify(name)});
  if (!w) return 'widget-missing:' + (n.widgets || []).map((x) => x.name).join(',');
  const old = w.value; w.value = ${JSON.stringify(val)};
  try { w.callback && w.callback(w.value); } catch (e) {}
  n.onWidgetChanged?.(${JSON.stringify(name)}, ${JSON.stringify(val)}, old, w);
  return 'set:' + ${JSON.stringify(name)} + ':oldLen=' + String(old).length;
})()`;

// ── D5 三闸(daojie-t2i-app-e2e.mjs peFedAssembly 同锚,1005 重锚版) ──
function peFedAssembly(prompt, keys, truth, domain) {
  const pe = keys.filter((k) => k.startsWith(domain) && prompt[k]?.class_type === "QwenImage21_T2IPromptRewrite");
  if (!pe.length) return { pe, ok: false, why: "无 PE 键" };
  const ref = prompt[pe[0]]?.inputs?.prompt;
  if (!Array.isArray(ref)) return { pe, ok: false, why: `prompt 非连线引用(实况「${String(JSON.stringify(ref)).slice(0, 24)}」)` };
  const sw = prompt[String(ref[0])];
  if (!sw || sw.class_type !== "MyQi21PESwitch" || String(ref[1]) !== "0")
    return { pe, ok: false, why: `引用非PE开关·PE路主体句口0(${ref[0]}:${ref[1]}→${sw?.class_type || "键缺"})` };
  const subj = sw.inputs?.主体句;
  const subjNode = Array.isArray(subj) ? prompt[String(subj[0])] : null;
  const subjOk = !!subjNode && String(subjNode.inputs?.value || "").includes(truth.subjHead);
  const asmKey = keys.find((k) => k.startsWith(domain) && prompt[k]?.class_type === "MyQi21PromptAssembly");
  const asm = asmKey ? prompt[asmKey] : null;
  const baseRef = asm?.inputs?.BASE;
  const baseNode = Array.isArray(baseRef) ? prompt[String(baseRef[0])] : null;
  const baseOk = !!baseNode && baseNode.class_type === "MyQi21DaojieBase" && String(baseRef[1]) === "0";
  const lockA = String(asm?.inputs?.锁层A全文 || "");
  const lockOk = lockA === truth.lockA;
  return { pe, subjFull: subjNode ? String(subjNode.inputs?.value || "") : null, asmKey, lockALen: lockA.length, ok: subjOk && baseOk && lockOk, why: `链=PE←PE开关${ref[0]}:0✓ 主体句源含头18字=${subjOk}/装配器${asmKey || "键缺"} BASE←型底座=${baseOk}/锁层A ${lockA.length} 字逐字=${lockOk}(真值 ${truth.lockA.length} 字)` };
}

// ── PNG/元数据(引擎 venv PIL) ──
function venvPy(code, args = []) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, ["-c", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", () => { try { resolve({ ok: true, data: JSON.parse(out) }); } catch { resolve({ ok: false, error: (err || out).slice(0, 400) }); } });
  });
}

// ═══════════════════ 主流程 ═══════════════════
let page = null;
try {
  // S1 引擎前置(复用现役;三查)
  log(`═ type ${TYPE_IDX}/9 「${TYPE_KEY}」 引擎=${ENGINE} CDP=${CDP_PORT} ═`);
  const ss = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  R.engine.precheck.system_stats = { comfyui_version: ss.system?.comfyui_version, python: ss.system?.python_version ?.trim?.() ?? ss.system?.python_version, device: ss.devices?.[0]?.name ? "mps" : "?" };
  check("S1 引擎在(/system_stats 200)", true, `comfyui_version=${ss.system?.comfyui_version}`);
  const ob = await (await fetch(`${ENGINE}/object_info/MyQi21DaojieBase`)).json();
  const combo = ob.MyQi21DaojieBase.input.required.base[0];
  R.engine.precheck.combo = combo;
  check(`S1 底座 combo 含「${TYPE_KEY}」(九型+自由十档)`, combo.includes(TYPE_KEY) && combo.length === 10, JSON.stringify(combo));
  const obPe = await (await fetch(`${ENGINE}/object_info/QwenImage21_T2IPromptRewrite`, { signal: AbortSignal.timeout(8000) })).json();
  check("S1 PE 件在册(QwenImage21_T2IPromptRewrite,1005 官方件)", !!obPe.QwenImage21_T2IPromptRewrite);
  const q0 = await (await fetch(`${ENGINE}/queue`)).json();
  R.engine.precheck.queueAtStart = { running: q0.queue_running?.length || 0, pending: q0.queue_pending?.length || 0 };

  // S2 主体句(FACTS 出处原句逐字;canon 文件由预检对账生成)
  const subject = readFileSync(SUBJECT_FILE, "utf8").replace(/\n+$/, "");
  R.subject = { file: SUBJECT_FILE, len: subject.length, md5: md5(subject), head: subject.slice(0, 24) };
  check(`S2 主体句读入(${SUBJECT_FILE})`, subject.length >= 50, `len=${subject.length} md5=${R.subject.md5}`);

  // S3 工作流真源 + truth
  const wfJson = JSON.parse(readFileSync(WF_T2I, "utf8"));
  const wfMd5 = md5(readFileSync(WF_T2I, "utf8"));
  R.workflow = { path: WF_T2I, md5: wfMd5, rootNodes: wfJson.nodes.length, mtime: null };
  const host6 = wfJson.nodes.find((n) => n.id === 6), host7 = wfJson.nodes.find((n) => n.id === 7);
  const ASM = host6.type, ACCEL = host7.type;
  const sg6 = wfJson.definitions.subgraphs.find((s) => s.id === ASM), sg7 = wfJson.definitions.subgraphs.find((s) => s.id === ACCEL);
  const asm4011 = sg6.nodes.find((n) => n.id === 4011);
  const lockA = String((asm4011.widgets_values || []).find((v) => typeof v === "string" && v.length > 500) || "");
  const truth = { ASM, ACCEL, lockA, subjHead: subject.slice(0, 18), savePrefix: wfJson.nodes.find((n) => n.id === 8).widgets_values[0], save2K: wfJson.nodes.find((n) => n.id === 504).widgets_values[0] };
  R.truth = { asmHostId: 6, accelHostId: 7, lockALen: lockA.length, lockAHead: lockA.slice(0, 18), savedHost6Widgets: host6.widgets_values, savedHost7Widgets: host7.widgets_values };
  check("S3 真源解析(锁层A>500字 / 宿主[6][7]在)", lockA.length > 500 && !!host6 && !!host7, `lockA=${lockA.length}字 宿主6存档=${JSON.stringify(host6.widgets_values)} 宿主7存档=${JSON.stringify(host7.widgets_values)}`);

  // S4 装载(headless Chrome 真前端;零插桩——[401] 正负双预览已在图)
  launchChrome();
  page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)), { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  const opened = await page.ev(`(async () => { const app = window.app; if (!app || app.isGraphReady !== true) return 'app-not-ready'; app.loadGraphData(${JSON.stringify(wfJson)}, true, true, ${JSON.stringify(`qi21-9xing-${SLUG}`)}); return 'opened'; })()`);
  if (opened !== "opened") throw new Error("loadGraphData 失败: " + opened);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)), { timeout: 40_000, interval: 1000, label: "画布切换" });
  await sleep(1500);
  check(`S4 仓库真源装载(画布根节点=${wfJson.nodes.length})`, true, `md5=${wfMd5}`);

  // S5 改前读回(保存态基线)
  const readPanel = async () => ({
    host6: await page.ev(`(() => { const h = ${hostJs(truth.ASM)}; const o = {}; for (const [k, w] of Object.entries(h.w)) o[k] = typeof w.value === 'object' ? JSON.stringify(w.value) : w.value; return o; })()`),
    host7: await page.ev(`(() => { const h = ${hostJs(truth.ACCEL)}; const o = {}; for (const [k, w] of Object.entries(h.w)) o[k] = typeof w.value === 'object' ? JSON.stringify(w.value) : w.value; return o; })()`),
    n400: await page.ev(`(() => { const n = window.app.graph._nodes.find(x => String(x.id) === '400'); const w = (n.widgets || []).find(w => w.name === 'value'); return w ? w.value : 'no-widget'; })()`),
    n404: await page.ev(`(() => { const n = window.app.graph._nodes.find(x => String(x.id) === '404'); const w = (n.widgets || []).find(w => w.name === 'value'); return w ? w.value : 'no-widget'; })()`),
  });
  const before = await readPanel();
  R.readbacks.before = before;
  log("改前保存态:", JSON.stringify({ host6: before.host6, host7: before.host7, n400len: String(before.n400).length, n404: JSON.stringify(before.n404) }));

  // S6 恰两处置值(型选择 / 主体句)——其余一概不碰
  const r1 = await page.ev(setViaHook(truth.ASM, "型选择", TYPE_KEY));
  R.changes.push({ where: `[6] 宿主面板.型选择`, to: TYPE_KEY, result: String(r1) });
  check(`S6 改动① 型选择=${TYPE_KEY}(setViaHook)`, String(r1).startsWith("set:型选择"), String(r1));
  const r2 = await page.ev(setNodeWidget(400, "value", subject));
  R.changes.push({ where: "[400] 正向主体句.value", to: `<subject ${subject.length}字 md5=${md5(subject)}>`, result: String(r2) });
  check("S6 改动② [400] 主体句=canon 原句(setNodeWidget)", String(r2).startsWith("set:value"), String(r2));
  if (SEED_OVERRIDE !== null) {
    const r3 = await page.ev(setViaHook(truth.ACCEL, "seed", SEED_OVERRIDE));
    R.changes.push({ where: "[7] 宿主面板.seed", to: SEED_OVERRIDE, result: String(r3) });
    R.deviation = { seed: { savedState: Number(before.host7?.seed ?? 0), used: SEED_OVERRIDE, reason: `100% 节点缓存碰撞破缓存(owner 裁定①;首拍 pid 见 attempt1 存档;先例=cfg4 战役固定 seed=4100+型序号)` } };
    check(`S6 改动③(裁定①破缓存) [7] seed=${SEED_OVERRIDE}(保存态=${R.deviation.seed.savedState})`, String(r3).startsWith("set:seed"), String(r3));
  }
  await sleep(800);

  // S7 改后读回:两处=目标,其余=与改前一致(保存态保持)
  const after = await readPanel();
  R.readbacks.after = after;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(`S7 读回:型选择=${TYPE_KEY} / PE启用?=true(保存态)`, after.host6["型选择"] === TYPE_KEY && after.host6["PE启用?"] === true, JSON.stringify(after.host6));
  check("S7 读回:[400] 主体句逐字=canon(md5 同)", after.n400 === subject, `md5(canvas)=${md5(String(after.n400))} vs md5(canon)=${md5(subject)}`);
  check("S7 读回:[404] 负向主体句保持空(保存态)", after.n404 === "" || after.n404 === before.n404, JSON.stringify(after.n404));
  const seedExpect = SEED_OVERRIDE !== null ? SEED_OVERRIDE : 0;
  check(`S7 读回:[7] 速度档位=0 · Fun-Acc 4步 / seed=${seedExpect}${SEED_OVERRIDE !== null ? "(裁定①破缓存)" : "(保存态未动)"}`, after.host7["速度档位"] === "0 · Fun-Acc 4步" && Number(after.host7["seed"]) === seedExpect, JSON.stringify(after.host7));
  check("S7 读回:除任务书两处(及裁定① seed)外宿主面板其余槽未漂移", same(before.host6["PE启用?"], after.host6["PE启用?"]) && same(before.host7["速度档位"], after.host7["速度档位"]) && (SEED_OVERRIDE !== null || same(before.host7, after.host7)) && same(before.n404, after.n404), "host6.PE启用?/host7.速度档位/404 改前后一致(seed 走裁定①通道时除外)");

  // S8 graphToPrompt 干跑 → 排队图断言(投前 gate;核队列不核文件)
  const dryRaw = await page.ev(`(async () => { try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); } catch (e) { return 'ERR:' + (e && (e.message || e)); } })()`);
  if (String(dryRaw).startsWith("ERR:")) throw new Error("graphToPrompt 失败: " + String(dryRaw).slice(0, 300));
  const P = JSON.parse(String(dryRaw));
  const keys = Object.keys(P);
  R.queue = { nodeCount: keys.length, prompt: P };
  const N = (k) => P[`6:${k}`];
  const A = (name, pass, detail = "") => { R.queueAsserts.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) }); log(`${pass ? "✅" : "❌"} Q ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`); return !!pass; };
  let allQ = true;
  allQ &= A(`[6:4010].base=「${TYPE_KEY}」(型值真进图)`, N(4010)?.inputs?.base === TYPE_KEY, JSON.stringify(N(4010)?.inputs?.base));
  const fed = peFedAssembly(P, keys, truth, "6:");
  R.queue.d5 = fed;
  allQ &= A("D5 三闸:PE←PE开关口0+主体句源含头18字+BASE←型底座+锁层A 逐字", fed.ok, fed.why);
  allQ &= A("D5 加严:主体句源=canon 全文逐字(非仅头18字)", fed.subjFull === subject, `len=${fed.subjFull?.length}/${subject.length} md5=${fed.subjFull ? md5(fed.subjFull) : "?"}`);
  allQ &= A("双编码接线:[4015].prompt←[6:4014,0] / [4016].prompt←[6:4014,1]", JSON.stringify(P["4015"]?.inputs?.prompt) === JSON.stringify(["6:4014", 0]) && JSON.stringify(P["4016"]?.inputs?.prompt) === JSON.stringify(["6:4014", 1]), `4015=${JSON.stringify(P["4015"]?.inputs?.prompt)};4016=${JSON.stringify(P["4016"]?.inputs?.prompt)}`);
  allQ &= A("宽高连线:[4].width/height←[4018,0/1](跟型/PE 画幅,非手填)", Array.isArray(P["4"]?.inputs?.width) && Array.isArray(P["4"]?.inputs?.height), `w=${JSON.stringify(P["4"]?.inputs?.width)} h=${JSON.stringify(P["4"]?.inputs?.height)}`);
  const gearVal = Object.entries(P).filter(([k]) => k.startsWith("7:")).flatMap(([k, v]) => Object.entries(v.inputs || {}).filter(([, val]) => val === "0 · Fun-Acc 4步").map(([slot]) => `${k}.${slot}`));
  allQ &= A("速度档=0 · Fun-Acc 4步(保存态;档0 FunAcc 无负槽,负向仅档1 生效)", gearVal.length > 0, gearVal.join(","));
  allQ &= A("档0 支路在图:[7:7013]=T8QwenImage21FunAccPDD4Step", P["7:7013"]?.class_type === "T8QwenImage21FunAccPDD4Step", String(P["7:7013"]?.class_type));
  const seedVal = P["7:7014"]?.inputs?.value ?? P["7:7014"]?.inputs?.seed;
  allQ &= A(`seed 单源=[7:7014] 值 ${seedExpect}${SEED_OVERRIDE !== null ? "(裁定①破缓存;保存态=0)" : "(保存态 fixed)"}`, String(seedVal) === String(seedExpect), JSON.stringify(seedVal));
  allQ &= A("保存前缀:[8]=QI21道劫文生图_ / [504]=MYStudio-2K", P["8"]?.inputs?.filename_prefix === truth.savePrefix && P["504"]?.inputs?.filename_prefix === truth.save2K, `${P["8"]?.inputs?.filename_prefix}/${P["504"]?.inputs?.filename_prefix}`);
  allQ &= A("[6:4010].透明覆盖=false(九型透明跟型默认)", N(4010)?.inputs?.透明覆盖 === false, JSON.stringify(N(4010)?.inputs?.透明覆盖));
  R.timings.dryRunAt = nowIso();
  if (!allQ) throw new Error("排队图断言红(见 R.queueAsserts)");

  // S9 投递(断言过的同一 P 对象)
  const clientId = `qi21-9xing-${TYPE_IDX}-${Date.now()}`;
  const tQueue = Date.now();
  const resp = await (await fetch(`${ENGINE}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: P, client_id: clientId }) })).json();
  if (resp.prompt_id === undefined || (resp.node_errors && Object.keys(resp.node_errors).length)) throw new Error("POST /prompt 拒绝: " + JSON.stringify(resp).slice(0, 800));
  const pid = resp.prompt_id;
  R.promptId = pid; R.clientId = clientId;
  R.timings.tQueue = new Date(tQueue).toISOString();
  log(`🚀 已排队 pid=${pid} client=${clientId}`);

  // S10 等待(sleep 轮询勿忙转;心跳 60s;超帽 → /interrupt + 响亮失败)
  let entry = null, statusStr = "", tRunningSeen = null, lastBeat = 0;
  const deadline = tQueue + BUDGET_MIN * 60_000;
  while (Date.now() < deadline) {
    let h = {};
    try { h = await (await fetch(`${ENGINE}/history/${pid}`, { signal: AbortSignal.timeout(8000) })).json(); } catch {}
    const e = h[pid];
    if (e && e.status) { entry = e; statusStr = e.status.status_str || ""; if (statusStr || e.status.completed) break; }
    if (!tRunningSeen) { try { const q = await (await fetch(`${ENGINE}/queue`, { signal: AbortSignal.timeout(5000) })).json(); if ((q.queue_running || []).some((x) => x[1] === pid)) tRunningSeen = nowIso(); } catch {} }
    if (Date.now() - lastBeat > 60_000) { lastBeat = Date.now(); let run = "?"; try { run = ((await (await fetch(`${ENGINE}/queue`, { signal: AbortSignal.timeout(5000) })).json()).queue_running || []).length; } catch {} log(`⏳ 执行中 T+${Math.round((Date.now() - tQueue) / 1000)}s(status=${statusStr || "无"};queue running=${run})`); }
    await sleep(5000);
  }
  R.timings.tRunningSeen = tRunningSeen;
  if (!entry) {
    try { await fetch(`${ENGINE}/interrupt`, { method: "POST" }); R.timings.interruptedAt = nowIso(); log("POST /interrupt(超预算清枪)"); } catch {}
    throw new Error(`等待超时 >${BUDGET_MIN}min 无终态(history 无 ${pid})`);
  }
  const tDone = Date.now();
  R.timings.tDone = new Date(tDone).toISOString();
  R.timings.durationMin = +( (tDone - tQueue) / 60000).toFixed(2);
  R.historyStatus = statusStr;
  if (statusStr !== "success") throw new Error(`history status=${statusStr}: ` + JSON.stringify(entry.status?.messages || []).slice(0, 1500));

  // 收据① history prompt JSON(全量落盘)
  writeFileSync(join(RUNS, `${SLUG}.history.json`), JSON.stringify(entry, null, 2));
  R.receipts.historyJson = `runs/${SLUG}.history.json`;
  const outputs = entry.outputs || {};
  // history outputs 的 ui 载荷在节点级(outputs[k].merged / .text),非 .ui 下——首轮实弹实拍纠正
  const previewText = outputs["401"]?.merged?.[0] ?? outputs["401"]?.ui?.merged?.[0] ?? outputs["401"]?.ui?.text?.[0] ?? null;
  const thinking = outputs["6:4020"]?.text?.[0] ?? outputs["6:4020"]?.ui?.text?.[0] ?? outputs["6:4020"]?.ui?.merged?.[0] ?? null;

  // 缓存回声侦测(2026-10-06 09:08 首轮实弹实拍:与 00:38 E2E 拍执行面全同 → execution_cached
  // 全节点 → 188ms success 零真渲染,图为旧文件。缓存回声≠实弹,默认响亮失败;ALLOW_CACHE_ECHO=1 才放行)
  const cachedMsg = (entry.status?.messages || []).find((m) => m[0] === "execution_cached");
  const cachedNodes = cachedMsg?.[1]?.nodes || [];
  const execKeys = Object.keys(entry.prompt?.[2] || P);
  const freshNodes = execKeys.filter((k) => !cachedNodes.includes(k));
  R.cacheEcho = { cachedCount: cachedNodes.length, promptNodes: execKeys.length, freshNodes, isFullEcho: cachedNodes.length > 0 && freshNodes.length === 0 };
  if (R.cacheEcho.isFullEcho && process.env.ALLOW_CACHE_ECHO !== "1")
    throw new Error(`全节点缓存命中(${cachedNodes.length}/${execKeys.length}),零真渲染——非实弹(旧拍产物被缓存回放;裁定放行须 ALLOW_CACHE_ECHO=1)`);
  if (cachedNodes.length > 0) log(`⚠️ 部分缓存:cached=${cachedNodes.length} fresh=${freshNodes.length}(${freshNodes.join(",")})`);
  if (typeof previewText !== "string" || !previewText.includes("═══ 正向提示词 ═══")) throw new Error("history [401] 无正负双预览文本(ui.merged)");
  const posHeader = "═══ 正向提示词 ═══\n", negHeader = "\n\n═══ 负向提示词 ═══\n";
  const iNeg = previewText.indexOf(negHeader);
  const finalPos = iNeg >= 0 ? previewText.slice(posHeader.length, iNeg) : previewText.slice(posHeader.length);
  const finalNeg = iNeg >= 0 ? previewText.slice(iNeg + negHeader.length) : "";
  R.prompts = { inputSubject: subject, peRewrite: finalPos.split("\n")[0] || "", finalPositive: finalPos, finalNegative: finalNeg, thinkingPreview: typeof thinking === "string" ? thinking.slice(0, 20000) : thinking };
  if (cachedNodes.includes("6:4013")) R.prompts.peRewriteProvenance = "缓存回放:6:4013 在 execution_cached 名单(本拍 seed 破缓存只作用于加速链,PE 链输入未变→引擎沿用缓存条目,与 00:38 拍 ebe48f94 同源逐字,非本拍新鲜推理)——owner 裁定②如实记账";
  check("S10 [401] 终稿:正向含主体句或其 PE 扩写链(非空长文)", finalPos.length > 100, `posLen=${finalPos.length} negLen=${finalNeg.length} thinkLen=${String(thinking || "").length}`);
  // PE 改写输出=装配全文首段(PE 开时 [4021] 选 PE 出文,装配=选定主体句+BASE+锁层A 换行拼合)
  R.prompts.peRewriteSource = "装配全文首行(PE启用?=true → [6:4021] 选 [6:4013].positive_prompt;[4011] 换行拼合=首行逐字)";

  // 下图:[8] 直出 + [504] 2K(/view)
  const imgEntries = [];
  for (const nodeKey of ["8", "504"]) {
    const im = outputs[nodeKey]?.images?.[0];
    if (im) imgEntries.push({ nodeKey, ...im });
  }
  if (!imgEntries.length) throw new Error("history outputs 无图([8]/[504] 皆空)");
  for (const im of imgEntries) {
    const url = `${ENGINE}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || "")}&type=${encodeURIComponent(im.type || "output")}`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const localName = im.nodeKey === "8" ? `${SLUG}.direct.png` : `${SLUG}.2k.png`;
    writeFileSync(join(IMAGES, localName), buf);
    const enginePath = join(COMFY_HOME, "output", im.subfolder || "", im.filename);
    let engineMtime = null; try { engineMtime = statSync(enginePath).mtime.toISOString(); } catch {}
    R.images[im.nodeKey] = { engineFile: `${im.subfolder ? im.subfolder + "/" : ""}${im.filename}`, engineFileMtime: engineMtime, type: im.type, bytes: buf.length, local: `images/${localName}`, pngMagic: buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 };
    log(`🖼 [${im.nodeKey}] ${im.filename} → images/${localName} (${buf.length}B, 引擎侧 mtime=${engineMtime})`);
  }

  // S11 机器判据
  for (const [nodeKey, img] of Object.entries(R.images)) {
    check(`S11 产物图存在且>0字节([${nodeKey}] ${img.local})`, img.bytes > 0 && existsSync(join(CAMPAIGN, img.local)), `${img.bytes}B`);
    check(`S11 PNG 魔数([${nodeKey}])`, img.pngMagic === true);
    const p = await venvPy(`import sys,json
from PIL import Image
im = Image.open(sys.argv[1]); im.load()
r = {"mode": im.mode, "size": list(im.size), "format": im.format}
print(json.dumps(r))`, [join(CAMPAIGN, img.local)]);
    R.images[nodeKey].pil = p;
    check(`S11 PNG 可解析(PIL,[${nodeKey}])`, p.ok === true, JSON.stringify(p.ok ? p.data : p.error));
  }

  // 收据② PNG tEXt 元数据(产物图上的 API prompt 全量)
  const metaPrimary = R.images["504"]?.local || R.images["8"]?.local;
  const meta = await venvPy(`import sys,json
from PIL import Image
im = Image.open(sys.argv[1])
txt = None
try: txt = im.text.get("prompt")
except Exception: pass
if txt is None: txt = im.info.get("prompt")
print(json.dumps({"found": txt is not None, "len": len(txt) if txt else 0, "json": txt}, ensure_ascii=False))`, [join(CAMPAIGN, metaPrimary)]);
  if (!meta.ok || !meta.data.found) { check("S11 PNG 元数据 tEXt prompt 在", false, JSON.stringify(meta).slice(0, 300)); }
  else {
    let parsed = null; try { parsed = JSON.parse(meta.data.json); } catch {}
    writeFileSync(join(VERIFY, `${SLUG}.png-prompt-metadata.json`), JSON.stringify(parsed ?? { parseError: true, raw: meta.data.json.slice(0, 2000) }, null, 2));
    R.receipts.pngMeta = { from: metaPrimary, len: meta.data.len, parseable: !!parsed, path: `verify/${SLUG}.png-prompt-metadata.json` };
    check("S11 PNG 元数据 tEXt prompt 可解析且含本拍 PE 键(6:4013)", !!parsed && Object.keys(parsed).some((k) => k === "6:4013"), `len=${meta.data.len} nodes=${parsed ? Object.keys(parsed).length : 0}`);
    const stable = (o) => { const s = (v) => { if (Array.isArray(v)) return "[" + v.map(s).join(",") + "]"; if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + s(v[k])).join(",") + "}"; return JSON.stringify(v); }; return s(o); };
    const histPrompt = Array.isArray(entry.prompt) ? (entry.prompt[2] || {}) : (entry.prompt || {});
    R.receipts.pngMeta.matchHistoryPrompt = stable(parsed) === stable(histPrompt);
    R.receipts.pngMeta.pngMetaMd5 = md5(stable(parsed)); R.receipts.pngMeta.historyPromptMd5 = md5(stable(histPrompt));
    check("S11 PNG 元数据=history prompt(稳态同:键序无关逐值同)", R.receipts.pngMeta.matchHistoryPrompt === true, `pngMd5=${R.receipts.pngMeta.pngMetaMd5} histMd5=${R.receipts.pngMeta.historyPromptMd5}`);
  }

  // S12 实际参数回读(seed/步数/cfg 以 history 回读为准)
  // history entry.prompt=五元组 [number,pid,promptDict,extra_data,outputs_to_execute](attempt-2 实拍纠正)
  const hp = Array.isArray(entry.prompt) ? (entry.prompt[2] || {}) : (entry.prompt || {});
  const acc = { seed7014: hp["7:7014"]?.inputs ?? null, t8_7013_inputs: hp["7:7013"]?.inputs ?? null, t8_class: hp["7:7013"]?.class_type, latent4: hp["4"]?.inputs ?? null, ks7010_present: !!hp["7:7010"], ks7012_present: !!hp["7:7012"], te4015: hp["4015"]?.inputs ?? null };
  R.effectiveParams = { ...acc, gearNote: "档0 Fun-Acc 4步:步数4/cfg 内置于 [7:7013] T8 件(面板无外接采样器;负向仅档1 生效,本档负槽未接)——以 history 回读与 FACTS §1 档位表为准" };
  check(`S12 实际参数回读在档(seed=${seedExpect} / T8 件在拍)`, String(acc.seed7014?.value ?? acc.seed7014?.seed) === String(seedExpect) && acc.t8_class === "T8QwenImage21FunAccPDD4Step", JSON.stringify({ seed: acc.seed7014, t8: acc.t8_class }));

  // 收据③ image-prompts 日志段(该时间窗摘录)
  const logDir = join(COMFY_HOME, "logs");
  const logFiles = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.startsWith("image-prompts-") && f.endsWith(".log")).sort() : [];
  let excerpt = null, excerptLines = [];
  for (const f of [...logFiles].reverse()) {
    const lines = readFileSync(join(logDir, f), "utf8").split("\n");
    const iStart = lines.findIndex((l) => l.includes(`prompt_id=${pid}`));
    if (iStart < 0) continue;
    let j = iStart;
    while (j + 1 < lines.length && lines[j + 1].includes("[MY出图]") && !lines[j + 1].includes("[MY出图][入队]")) j++;
    excerpt = { file: f, fromLine: iStart + 1, toLine: j + 1 };
    excerptLines = lines.slice(iStart, j + 1).filter((l) => l.trim().length > 0);
    break;
  }
  if (!excerpt) { check("S12 image-prompts 日志段在(该 pid)", false, `logs 扫描=${logFiles.join(",") || "无"}`); }
  else {
    const fullText = `# ${SLUG} 引擎日志摘录(image-prompts) 源=${excerpt.file} 行${excerpt.fromLine}-${excerpt.toLine} 抓取=${nowIso()}\n` + excerptLines.map((l) => (l.includes("[全量JSON]") ? l.slice(0, 200) + ` …[全长 ${l.length} 字符,全文见引擎源日志 ${excerpt.file}]` : l)).join("\n") + "\n";
    writeFileSync(join(LOGSD, `${SLUG}.image-prompts.excerpt.log`), fullText);
    R.receipts.imagePrompts = { file: excerpt.file, lines: [excerpt.fromLine, excerpt.toLine], hasSummary: excerptLines.some((l) => l.includes("[摘要]")), hasFullJson: excerptLines.some((l) => l.includes("[全量JSON]")), hasQueue: excerptLines.some((l) => l.includes("[入队]")), excerptPath: `logs/${SLUG}.image-prompts.excerpt.log` };
    check("S12 image-prompts 日志段(入队+摘要+全量JSON 三行俱在)", R.receipts.imagePrompts.hasQueue && R.receipts.imagePrompts.hasSummary && R.receipts.imagePrompts.hasFullJson, `${excerpt.file}:${excerpt.fromLine}-${excerpt.toLine}`);
    R.engineLogExcerpt = excerptLines.filter((l) => !l.includes("[全量JSON]")).join("\n").slice(0, 3000);
  }

  // 终判
  const hardGates = R.checks.filter((c) => c.name.startsWith("S1") || c.name.startsWith("S2") || c.name.startsWith("S11") || c.name.startsWith("S10") || c.name.startsWith("S12"));
  const soft = R.checks.filter((c) => !hardGates.includes(c));
  R.ok = hardGates.every((c) => c.ok) && R.queueAsserts.every((c) => c.pass) && Object.keys(R.images).length > 0;
  check("★ 终判:三层收据齐全+图在+PNG 可解析+排队图断言全绿", R.ok, `收据={image-prompts:${!!R.receipts.imagePrompts?.hasFullJson},pngMeta:${!!R.receipts.pngMeta?.parseable},history:${!!R.receipts.historyJson}} 图=${Object.keys(R.images).join(",")}`);
  dumpRaw(R.ok ? 0 : 1);
  if (page) try { page.close(); } catch {}
  killChrome();
  process.exit(R.ok ? 0 : 1);
} catch (e) {
  R.fatal = String(e && e.message || e);
  R.ok = false;
  console.error(`❌ ${R.fatal}`);
  dumpRaw(1);
  if (page) try { page.close(); } catch {}
  killChrome();
  process.exit(1);
}
