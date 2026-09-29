#!/usr/bin/env node
/**
 * 0929 6/8 多彩天花板·非词法杠杆探索役 A/B 实弹驱动 v2(任务 09-29-q21-68-color-lever)。
 *
 * v2 变更(移动靶教训):并行会话在途活改仓库 t2i 工作流(16:13 代顶层 [7]/[207] → 16:22 代
 * 加速区子图化 [208]),A/B 六拍必须同图——冻结快照 /tmp/q21-colorlever-0929/wf-frozen.json
 * (00:2x 代:[40] rgba 融合子图 + [208] 加速子图,面板=[速度档,seed] 且默认值=本役目标值
 * 「0 · 直出40步」/0,免拨杆只断言)。PE 种子喂法=装载前写 [40:140] widget(夜空锚轮实跑
 * 史证:该输入 link=null,陈旧占位种子会顶替主体句进采样→废片,16:09 首拍实证已弃)。
 *
 * 范式=fire0929_i2e_edit.mjs(真前端实弹):headless Chrome CDP 连引擎 ComfyUI 真前端,
 * loadGraphData 装载冻结图(装件臂=注入 LoraLoaderModelOnly [1]→9001→[208].model 的
 * 冻结副本,等价用户画布手工加件;词法零动)→ 拨控件(型选择/RGBA 三态/PE/主体句/前缀)
 * → app.queuePrompt()(前端自身 graphToPrompt,禁自写 GUI→API 转换)→ /history 等完
 * → /view 取产物落 apps/output;每拍重载页面=净画布。
 *
 * 臂表(seed 恒 0,PE 恒开,速度档恒 0·直出40步,冻结图恒一):
 *   6t/8t = 6号/8号例一·跟随型(透明底座现挂态)  基线
 *   6bg   = 6号例一·强制关(带背景;0929 宪法合法档,borderSAT 带宽校准臂)
 *   *L    = 同型同态装件臂(LORA_FILE/LORA_STRENGTH env)
 *
 * 产物纪律:apps/output/;日志/中间件 /tmp/q21-colorlever-0929/。
 * 用法:node apps/build/scripts/campaigns/q21_68_colorlever_ab_0929.mjs <shots 逗号>
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const CDP_PORT = Number(process.env.CDP_PORT || 9379);
const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output`;
const TMP = "/tmp/q21-colorlever-0929";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/colorlever-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 3_600_000);
const WF = process.env.FROZEN_WF || `${TMP}/wf-frozen.json`;
const LORA_FILE = process.env.LORA_FILE || "";
const LORA_STRENGTH = Number(process.env.LORA_STRENGTH || 1.0);

// 05 库例句逐字(0927 二轮形态定稿;词法冻结 R6)——现场读,禁第三份常量
const LIB = `${process.env.HOME}/Project/Github/MYStudio/docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`;
function subjectFromLib(marker) {
  const lib = readFileSync(LIB, "utf8");
  for (const line of lib.split("\n")) {
    if (line.includes(marker)) {
      const m = line.match(/「(.+?)」/);
      if (m) return m[1];
    }
  }
  throw new Error(`05 库未找到例句 marker=${marker}`);
}
const SUBJ_6 = subjectFromLib("例一(《道劫_九型主体句示例》§6 原文");
const SUBJ_8 = subjectFromLib("例一(《道劫_九型主体句示例》§8 原文");

const SHOTS_ALL = [
  { key: "6t",  type: "高清人脸", rgba: "跟随型", subject: SUBJ_6, withLora: false,
    out: `${OUT_DIR}/q21-0929-6号人脸_基线_PE开40步_seed0_透明款.png` },
  { key: "8t",  type: "表情差分", rgba: "跟随型", subject: SUBJ_8, withLora: false,
    out: `${OUT_DIR}/q21-0929-8号表情_基线_PE开40步_seed0_透明款.png` },
  { key: "6bg", type: "高清人脸", rgba: "强制关", subject: SUBJ_6, withLora: false,
    out: `${OUT_DIR}/q21-0929-6号人脸_基线_PE开40步_seed0_带背景款.png` },
  { key: "6tL",  type: "高清人脸", rgba: "跟随型", subject: SUBJ_6, withLora: true,
    out: `${OUT_DIR}/q21-0929-6号人脸_装件_PE开40步_seed0_透明款.png` },
  { key: "8tL",  type: "表情差分", rgba: "跟随型", subject: SUBJ_8, withLora: true,
    out: `${OUT_DIR}/q21-0929-8号表情_装件_PE开40步_seed0_透明款.png` },
  { key: "6bgL", type: "高清人脸", rgba: "强制关", subject: SUBJ_6, withLora: true,
    out: `${OUT_DIR}/q21-0929-6号人脸_装件_PE开40步_seed0_带背景款.png` },
];
const ONLY = (process.argv[2] || process.env.SHOTS || "");
const SHOTS = ONLY ? SHOTS_ALL.filter((s) => ONLY.split(",").includes(s.key)) : SHOTS_ALL.filter((s) => !s.withLora);
if (!SHOTS.length) { console.error("SHOTS 过滤后为空:", ONLY); process.exit(2); }
if (SHOTS.some((s) => s.withLora) && !LORA_FILE) { console.error("装件臂需要 LORA_FILE env"); process.exit(2); }
mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 冻结图变体构造:写 PE 种子([40:140] widget)+ 装件臂注入 LoraLoaderModelOnly。 */
function buildGraphFor(shot) {
  const g = JSON.parse(readFileSync(WF, "utf8"));
  const sg40 = g.definitions.subgraphs.find((s) => String(s.name).includes("装配"));
  if (!sg40) throw new Error("冻结图缺 [40] 装配子图");
  const n140 = sg40.nodes.find((n) => n.id === 140);
  const staleSeed = String(n140.widgets_values[0]);
  const prefix = staleSeed.slice(0, staleSeed.indexOf(":") + 1);
  n140.widgets_values[0] = prefix + shot.subject;
  if (shot.withLora) {
    // 注入装件:[1]UNET → 9001 LoraLoaderModelOnly → [208].model(顶替 link97)
    const maxLink = Math.max(...g.links.map((l) => l[0]));
    const n1 = g.nodes.find((n) => n.id === 1);
    const n208 = g.nodes.find((n) => n.id === 208);
    const old = g.links.find((l) => l[1] === 1 && l[2] === 0 && l[3] === 208 && l[4] === 0);
    if (!old) throw new Error("冻结图缺 link97([1]→[208].model)");
    const lA = [maxLink + 1, 1, 0, 9001, 0, "MODEL"];
    const lB = [maxLink + 2, 9001, 0, 208, 0, "MODEL"];
    g.links = g.links.filter((l) => l !== old).concat([lA, lB]);
    n1.outputs[0].links = (n1.outputs[0].links || []).filter((x) => x !== old[0]).concat([lA[0]]);
    n208.inputs[0].link = lB[0];
    g.nodes.push({
      id: 9001, type: "LoraLoaderModelOnly", pos: [n1.pos[0], n1.pos[1] + 300],
      size: { 0: 320, 1: 100 }, flags: {}, order: 2, mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: lA[0] },
        { name: "lora_name", type: "COMBO", link: null, widget: { name: "lora_name" } },
        { name: "strength_model", type: "FLOAT", link: null, widget: { name: "strength_model" } },
      ],
      outputs: [{ name: "MODEL", type: "MODEL", links: [lB[0]], slot_index: 0 }],
      properties: { "Node name for S&R": "LoraLoaderModelOnly" },
      widgets_values: [LORA_FILE, LORA_STRENGTH],
      title: "多彩杠杆件(实验臂)",
    });
  }
  return g;
}

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_PROFILE}`,
    "--window-size=1720,1050", "--no-first-run", "--no-default-browser-check",
    "--disable-crash-reporter", "--disable-background-timer-throttling", ENGINE,
  ], { detached: true, stdio: "ignore" });
  chromeProc.unref();
  log("chrome spawned pid", chromeProc.pid);
}
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { try { chromeProc.kill("SIGTERM"); } catch { /* gone */ } }
  log("chrome killed (self-spawned)");
}

async function getPageClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch { /* port not ready */ }
    await sleep(1200);
  }
  if (!page) throw new Error("引擎前端 page target 未出现(90s)");
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
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
      consoleErrors.push({ src: "console", type: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 2000),
        ts: new Date().toISOString() });
    } else if (m.method === "Log.entryAdded" && (m.params.entry?.level === "error")) {
      consoleErrors.push({ src: "log", text: m.params.entry.text, url: m.params.entry.url, ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 2000), ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 800);
      return r.result.value;
    },
  };
}

async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时: ${label}`);
}

function setWidgetById(page, nodeId, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === ${JSON.stringify(String(nodeId))});
    if (!n) return 'node-missing:' + ${JSON.stringify(String(nodeId))};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:' + String(w.value).slice(0, 60);
  })()`);
}

/** [40] 宿主提升控件按语义寻址:combo 选项含「高清人脸」=型选择;含「跟随型」=RGBA三态;boolean=PE。 */
async function setAssemblyWidgets(page, { type, rgba, pe }) {
  const rosterRaw = await page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === '40');
    if (!n) return null;
    return JSON.stringify((n.widgets || []).map(w => ({
      name: w.name, type: w.type || (typeof w.value),
      value: typeof w.value === 'boolean' ? w.value : String(w.value).slice(0, 36),
      values: (w.options && w.options.values || []).slice(0, 14),
    })));
  })()`);
  if (!rosterRaw) throw new Error("[40] 子图宿主节点缺失");
  const roster = JSON.parse(rosterRaw);
  const wType = roster.find((w) => (w.values || []).includes("高清人脸") && (w.values || []).includes("表情差分"));
  const wRgba = roster.find((w) => (w.values || []).includes("跟随型"));
  const wPe = roster.find((w) => w.type === "toggle" || typeof w.value === "boolean");
  if (!wType || !wRgba || !wPe) throw new Error(`[40] 提升控件寻址失败: ${JSON.stringify(roster).slice(0, 400)}`);
  const r1 = await setWidgetById(page, 40, wType.name, type);
  const r2 = await setWidgetById(page, 40, wRgba.name, rgba);
  const r3 = await setWidgetById(page, 40, wPe.name, pe);
  return { roster, sets: [r1, r2, r3], names: { type: wType.name, rgba: wRgba.name, pe: wPe.name } };
}

function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

async function historyPids() {
  try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); }
  catch { return new Set(); }
}

async function waitNewHistory(knownPids, { timeout } = {}) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 12000)}` };
        }
        if (st === "success" || e.status?.completed) {
          return { pid, entry: e, status: st };
        }
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function captureServerPrompt(knownPids, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const qs = await (await fetch(`${ENGINE}/queue`)).json();
      for (const running of qs.queue_running || []) {
        const pid = running[1];
        if (!knownPids.has(pid)) return { pid, prompt: running[2] };
      }
    } catch { /* 引擎忙 */ }
    await sleep(2000);
  }
  return { pid: null, prompt: null };
}

async function fetchView(img, savePath) {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(savePath, buf);
  return buf;
}

const pngMagic = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function runShot(page, shot) {
  const tag = shot.key;
  log(`──── 拍 ${tag} (${shot.type}/${shot.rgba}${shot.withLora ? "/装件" : "/基线"}) ────`);
  const graphJson = buildGraphFor(shot);
  const openRes = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(`colorlever-${tag}`)});
    return 'opened';
  })()`);
  if (openRes !== "opened") { check(`${tag}: 工作流装载`, false, String(openRes)); return { tag, fatal: openRes }; }
  await sleep(2500);

  const asm = await setAssemblyWidgets(page, { type: shot.type, rgba: shot.rgba, pe: true });
  if (asm.sets.some((r) => !String(r).startsWith("set:"))) {
    check(`${tag}: 装配控件拨杆`, false, JSON.stringify(asm.sets));
    return { tag, fatal: "assembly-widgets" };
  }
  log(`[40] 面板控件: ${JSON.stringify(asm.names)}`);
  const rSubj = await setWidgetById(page, 24, "value", shot.subject);
  const rPre = await setWidgetById(page, 9, "filename_prefix", `colorlever0929/${tag}`);
  for (const [nm, r] of [["主体句[24]", rSubj], ["前缀[9]", rPre]]) {
    if (!String(r).startsWith("set:")) { check(`${tag}: ${nm}`, false, String(r)); return { tag, fatal: nm }; }
  }

  const known = await historyPids();
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  if (queued !== "queued") { check(`${tag}: queuePrompt`, false, String(queued)); return { tag, fatal: "queue" }; }
  const serverCap = await captureServerPrompt(known, 20_000);
  if (serverCap.prompt) {
    writeFileSync(`${TMP}/${tag}-server-prompt.json`, JSON.stringify(serverCap.prompt, null, 1));
    const nodes = Object.keys(serverCap.prompt || {});
    // 子图扁平键探测:加速子图化后 KSampler=「208:7」,旧代=「7」
    const ksKey = nodes.find((k) => k === "208:7" || k === "7");
    const ks = serverCap.prompt?.[ksKey]?.inputs || {};
    const seedKey = Array.isArray(ks.seed) ? String(ks.seed[0]) : null;
    const seedRaw = seedKey ? serverCap.prompt?.[seedKey]?.inputs?.value : ks.seed;
    const pe140 = serverCap.prompt?.["40:140"];
    const peSeed = pe140?.inputs?.prompt;
    const subjHead = shot.subject.slice(0, 18);
    log(`server 图 ${nodes.length} 节;KSampler=${ksKey} steps=${ks.steps};PE[40:140] ${pe140 ? "在场" : "缺"}`);
    check(`${tag}: 服务端图直出40步`, String(ks.steps) === "40", `steps=${ks.steps}(${ksKey})`);
    check(`${tag}: 服务端图 seed=0`, String(seedRaw) === "0", `seed=${JSON.stringify(ks.seed)}→${seedKey}.value=${JSON.stringify(seedRaw)}`);
    check(`${tag}: PE 改写器在链([40:140] 在场)`, Boolean(pe140), pe140 ? "" : "缺");
    check(`${tag}: PE 种子文=前缀+例句(主体句真进采样)`,
      typeof peSeed === "string" && peSeed.includes(subjHead),
      typeof peSeed === "string" ? `head=${peSeed.slice(0, 60)}` : `peSeed=${JSON.stringify(peSeed)}`);
    if (shot.withLora) {
      const loraNode = nodes.find((n) => serverCap.prompt?.[n]?.class_type === "LoraLoaderModelOnly"
        && serverCap.prompt?.[n]?.inputs?.lora_name === LORA_FILE);
      check(`${tag}: 装件在链(lora_name 命中)`, Boolean(loraNode), loraNode || `未命中 ${LORA_FILE}`);
    } else {
      const anyLora = nodes.find((n) => serverCap.prompt?.[n]?.class_type === "LoraLoaderModelOnly"
        && String(serverCap.prompt?.[n]?.inputs?.lora_name || "").includes("cine1p"));
      check(`${tag}: 基线臂零装件(cine1p 不在链)`, !anyLora, anyLora || "");
    }
  } else {
    check(`${tag}: 服务端排队图抓取`, false, "执行期未捕到(可能秒完/过快)");
  }

  const h = await waitNewHistory(known, { timeout: GEN_TIMEOUT });
  const wallSecs = Math.round((Date.now() - t0) / 1000);
  if (h.error) { check(`${tag}: 引擎执行`, false, h.error); return { tag, fatal: h.error }; }
  writeFileSync(`${TMP}/${tag}-history.json`, JSON.stringify(h.entry, null, 1));

  const finalText = Object.values(h.entry.outputs || {}).flatMap((o) => o.text || []).join("\n");
  if (finalText) writeFileSync(`${TMP}/${tag}-final-text.txt`, finalText);

  const imgs = [];
  for (const o of Object.values(h.entry.outputs || {})) if (o.images) imgs.push(...o.images.filter((i) => (i.type || "output") === "output"));
  if (!imgs.length) { check(`${tag}: 引擎出图`, false, "history outputs 无 output 图"); return { tag, fatal: "no-output-images" }; }
  const saveImg = imgs.find((i) => /\.png$/i.test(i.filename)) || imgs[0];
  const buf = await fetchView(saveImg, shot.out);
  const colorType = buf.length > 26 ? buf[25] : 0;
  const expectRGBA = shot.rgba === "跟随型";
  // 透明款=色型6;强制关=容器可仍 6(VAE/saver 写全 255 alpha,6bg 实证 alpha0=0.00%)——
  // 带背景真值判定归 metrics_68(alpha0%),此处只硬验透明款必须 6
  check(`${tag}: RGBA 路由硬验(IHDR 色型=${colorType}${expectRGBA ? " 期望6" : "(强制关:容器 2/6 皆可,alpha 真值归 metrics)"})`,
    expectRGBA ? colorType === 6 : true, `${saveImg.filename}`);
  check(`${tag}: PNG 魔数+产物落 apps/output`, pngMagic(buf) && buf.length > 50_000,
    `${saveImg.filename} → ${shot.out.split("/").pop()} (${(buf.length / 1024 / 1024).toFixed(1)}MB, ${wallSecs}s, pid=${String(h.pid).slice(0, 8)})`);
  return { tag, pid: h.pid, outPath: shot.out, engineFile: saveImg.filename, wallSecs };
}

async function main() {
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }
  if (!existsSync(WF)) { console.error("冻结图缺失:", WF); process.exit(2); }
  log(`冻结图=${WF};例句: 6号=${SUBJ_6.length}字 8号=${SUBJ_8.length}字`);

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const shots = [];
  for (const s of SHOTS) {
    if (shots.length) {
      await page.send("Page.navigate", { url: ENGINE });
      await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
        { timeout: 120_000, interval: 2000, label: `拍 ${s.key} 前端重载就绪` });
      await sleep(1500);
    }
    const r = await runShot(page, s);
    shots.push(r);
    await sleep(3000);
  }

  writeFileSync(join(TMP, "console-errors.json"), JSON.stringify(consoleErrors, null, 1));
  writeFileSync(join(TMP, "report.json"), JSON.stringify({ results, shots }, null, 1));
  page.close();
  killChrome();
  log("════ 实弹汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 240)}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error("实弹失败:", e.message);
  killChrome();
  process.exit(1);
});
