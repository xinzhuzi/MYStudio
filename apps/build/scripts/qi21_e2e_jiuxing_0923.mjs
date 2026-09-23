#!/usr/bin/env node
/**
 * Q2-1 道劫·装配子图版(qi21-道劫-t2i.json)九型实拍 E2E(09-23):
 * 真前端载入含 [40] 装配子图(definitions.subgraphs)的新工作流,干跑 graphToPrompt
 * 验证子图装载;随后 canon 九型顺序逐型出图(全 1024²):
 *   每型 = 子图面板型选择开关一处切换(全关=①人物)+ [24] 主体句换库中该型例一
 *          (docs/prompts/道劫_九型主体句示例.md §1-§9 原文) + 排队出图。
 * 装配取证:每拍 history 里 [27] easy showAnything 服务端执行出的最终装配全文,
 * 与本地按工作流 JSON 重建的期望(主体句+型底座+锁层A,换行分层)逐字节比对。
 * 产物 /Users/zhengbingjin/Downloads/qi21-jiuxing/{1..9}-{型名}.png(按型名命名)。
 * 子图外露参数定位:装载后实测 [40] 节点 widgets 名集(以干跑实测为准,勿猜)。
 *
 * 用法:node apps/build/scripts/qi21_e2e_jiuxing_0923.mjs
 * 退出码 0=全绿;1=有失败项;2=环境错误。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require("/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws");
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9357);
const E2E_DIR = "/Users/zhengbingjin/Downloads/qi21-jiuxing";
const WF = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-jiuxing-chrome-profile";
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 900_000); // 15 min/张(bf16 20B 首拍含载入)

// ── canon 九型(daojie_bases.json zh 顺序)+ 库例一(docs/prompts/道劫_九型主体句示例.md §1-§9 原文) ──
// toggle: 子图面板 [40] 外露的型选择开关名(①人物=全关,无开关);sig: 该型主体句唯一指纹。
const TYPES = [
  { idx: 1, name: "人物", file: "1-人物.png", toggle: null, subjMark: "选型②",
    subject: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。",
    sig: "她立于山门石阶最上一级" },
  { idx: 2, name: "场景", file: "2-场景.png", toggle: "选型②场景", subjMark: "选型②",
    subject: "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。",
    sig: "九根断裂的石柱围成半圆" },
  { idx: 3, name: "道具", file: "3-道具.png", toggle: "选型③道具", subjMark: "选型③",
    subject: "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；细节特写一格聚焦剑身近格处的旧伤裂纹与缠绕其上的金色修补纹。",
    sig: "一柄传承千年的青铜剑" },
  { idx: 4, name: "美宣", file: "4-美宣.png", toggle: "选型④美宣", subjMark: "选型④",
    subject: "雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，周身剑气化作淡金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。",
    sig: "雷劫降临的至暗时刻" },
  { idx: 5, name: "三视图", file: "5-三视图.png", toggle: "选型⑤三视图", subjMark: "选型⑤",
    subject: "同一位青年刀修的角色转面设定板：横幅六格等分，从左到右依次为上半身像、正面全身、侧面全身、背面全身、正斜侧面全身、背斜侧面全身；第一格上半身像画面底缘止于腰部，其余五格皆为头顶至脚底的全身画像；各全身格同一自然站姿，双手拢袖，神情中性沉静，腰侧佩刀；玄色劲装束袖束腰，长发高束马尾，六格同一人。",
    sig: "横幅六格等分" },
  { idx: 6, name: "高清人脸", file: "6-高清人脸.png", toggle: "选型⑥高清人脸", subjMark: "选型⑥",
    subject: "一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；头顶至锁骨、正面平视，神情沉静，柔和顶光勾勒面部立体轮廓。",
    sig: "几缕碎发垂在颊边" },
  { idx: 7, name: "分镜剧情图", file: "7-分镜剧情图.png", toggle: "选型⑦分镜剧情图", subjMark: "选型⑦",
    subject: "山雨欲来的渡口，老船工收篙回望，身后的少年修士第一次背起行囊离乡；乌云压江，渡口一盏灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。",
    sig: "老船工收篙回望" },
  { idx: 8, name: "表情差分", file: "8-表情差分.png", toggle: "选型⑧表情差分", subjMark: "选型⑧",
    subject: "同一位红衣女修的九宫格表情差分，九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；各格头部角度与光源方向保持一致。",
    sig: "九宫格表情差分" },
  { idx: 9, name: "概念气氛图", file: "9-概念气氛图.png", toggle: "选型⑨概念气氛图", subjMark: "选型⑨",
    subject: "千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在青蓝色灵光中，万千萤火状灵尘随气流缓缓升腾；画面九成留给静谧的夜与雾，只余殿群一角与一株横生孤松的剪影。",
    sig: "灵潮涨落之夜" },
];
// 全部八个型选择开关(全关=①人物);PE/RGBA 保持默认 false(甲案直写/普通)。
const ALL_TOGGLES = ["选型②场景", "选型③道具", "选型④美宣", "选型⑤三视图", "选型⑥高清人脸", "选型⑦分镜剧情图", "选型⑧表情差分", "选型⑨概念气氛图"];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0;
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let chromeProc = null;

function launchChrome() {
  chromeProc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--window-size=1720,1050",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-reporter",
    "--disable-background-timer-throttling",
    ENGINE,
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
    async screenshot(name) {
      const path = join(E2E_DIR, `${name}.png`);
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* fallthrough */ }
      log(`📸 失败 ${path}`);
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

async function loadWorkflow(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 节点定位按 type+title 片段(勿按 JSON id)。 */
function setWidget(page, type, titlePart, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(type)}
      && (!${JSON.stringify(titlePart)} || String(n.title || '').includes(${JSON.stringify(titlePart)})));
    if (!n) return 'node-missing:' + ${JSON.stringify(type)} + '/' + ${JSON.stringify(titlePart)};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set:' + String(w.value);
  })()`);
}

/**
 * 子图面板开关一处切换:[40] 装配子图节点(type=子图UUID)的外露 widgets。
 * 定位方式=装载后实测:先按 name 含开关名寻址;寻不到回退按序
 * (widgets[0]=主体句字符串,widgets[1..8]=选型②..⑨,widgets[9]=PE,widgets[10]=RGBA)。
 */
function setSubgraphToggle(page, sgType, toggleName, on) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing:' + ${JSON.stringify(sgType)};
    if (!n.widgets || !n.widgets.length) return 'no-widgets:on-subgraph-node';
    let w = n.widgets.find(w => String(w.name || '').includes(${JSON.stringify(toggleName)}));
    if (!w) {
      const order = ['主体句','选型②场景','选型③道具','选型④美宣','选型⑤三视图','选型⑥高清人脸','选型⑦分镜剧情图','选型⑧表情差分','选型⑨概念气氛图','PE改写开关','RGBA透明开关'];
      const i = order.indexOf(${JSON.stringify(toggleName)});
      if (i >= 0 && n.widgets[i] && typeof n.widgets[i].value === 'boolean') w = n.widgets[i];
    }
    if (!w) return 'widget-not-found:' + n.widgets.map(x => x.name + ':' + typeof x.value).join(',');
    w.value = ${JSON.stringify(on)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:' + w.name + '=' + String(w.value);
  })()`);
}

function promptDigest(page, classType, fields) {
  return page.ev(`(async () => {
    try {
      const p = await window.app.graphToPrompt();
      const out = [];
      for (const k of Object.keys(p.output || {}).sort()) {
        if (p.output[k].class_type === ${JSON.stringify(classType)}) {
          const o = { node: k };
          for (const f of ${JSON.stringify(fields)}) o[f] = p.output[k].inputs[f];
          out.push(o);
        }
      }
      return out.length ? JSON.stringify(out) : 'class-not-found:' + ${JSON.stringify(classType)};
    } catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
}

function queuePrompt(page) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
}

async function waitHistory(feature, { timeout, knownPids = new Set() }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error(全量 messages): ${JSON.stringify(e.status?.messages || []).slice(0, 20000)}` };
        }
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, outputs: e.outputs, messages: e.status?.messages };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function fetchView(img, outPath) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf;
}

async function pngMagic(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
    return { w: Number(w), h: Number(h), raw: stdout.trim() };
  } catch (e) { return { err: String(e.message) }; }
}

/** 一拍通用:queuePrompt → 等 history → 取回验证 + [27] 装配全文比对。 */
async function genShot(page, t, expectedAssembly) {
  const tag = `${t.idx}-${t.name}`;
  const outPath = join(E2E_DIR, t.file);
  const report = { tag };
  let knownPids = new Set();
  try { knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { /* 尽力 */ }
  await sleep(800);
  const t0 = Date.now();
  const queued = await queuePrompt(page);
  check(`${tag}: queuePrompt 发出(真前端)`, queued === "queued", String(queued));
  if (queued !== "queued") throw new Error(`${tag} queuePrompt 失败: ${queued}`);

  const hist = await waitHistory((blob) => blob.includes(t.sig), { timeout: GEN_TIMEOUT, knownPids });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  report.secs = secs;
  report.pid = hist.pid;
  if (hist.error) {
    check(`${tag}: 引擎出图`, false, `${hist.error.slice(0, 4000)}(${secs}s)`);
    report.error = hist.error;
    return report;
  }
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const buf = await fetchView(saveImg, outPath);
  const magic = await pngMagic(buf);
  const size = await sipsSize(outPath);
  check(`${tag}: PNG 魔数`, magic === true, outPath);
  check(`${tag}: sips 尺寸 1024x1024`, size.w === 1024 && size.h === 1024, `${size.w}x${size.h}`);
  check(`${tag}: 引擎出图(/view 取回)`, buf.length > 50_000,
    `${saveImg.filename} → ${outPath} (${(buf.length / 1024).toFixed(0)}KB, 排队→完成 ${secs}s, pid=${String(hist.pid).slice(0, 8)})`);
  report.outPath = outPath;
  report.engineFile = saveImg.filename;
  report.size = size;
  report.hist = { outputs: hist.outputs, messages: hist.messages };
  // [27] easy showAnything 服务端执行出的最终装配全文(子图级联/装配硬证据)
  const texts = [];
  for (const o of Object.values(hist.outputs || {})) if (o && Array.isArray(o.text)) texts.push(...o.text);
  if (texts.length) {
    const finalText = texts.sort((a, b) => b.length - a.length)[0];
    report.assemblyText = finalText;
    writeFileSync(join(E2E_DIR, `${t.idx}-final-prompt.txt`), finalText);
    const eq = finalText === expectedAssembly;
    check(`${t.idx}-${t.name}: 装配全文 == 期望(主体句+型底座+锁层A)`, eq,
      eq ? `${finalText.length} 字符逐字节一致` :
        `不一致:实际头120=${finalText.slice(0, 120)};期望头120=${expectedAssembly.slice(0, 120)};len=${finalText.length}/${expectedAssembly.length}`);
  } else {
    check(`${t.idx}-${t.name}: 装配全文捕获([27] showAnything)`, false, "history outputs 无 text 字段");
  }
  return report;
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  const report = { engine: ENGINE, wf: WF, startedAt: new Date().toISOString(), cases: {} };
  if (!existsSync(WF)) { console.error("工作流缺失:", WF); process.exit(2); }
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) {
    console.error("引擎探活失败:", e.message); process.exit(2);
  }

  // 本地重建期望装配(真源=工作流 JSON 子图常量;[130]=主体句+级联, [131]=[130]+锁层A, 分隔符\n)
  const wf = JSON.parse(readFileSync(WF, "utf8"));
  const sg = wf.definitions.subgraphs[0];
  const sgNodes = {}; for (const n of sg.nodes) sgNodes[n.id] = n;
  const BASES = {}; for (let i = 1; i <= 9; i++) BASES[i] = sgNodes[100 + i].widgets_values[0];
  const LOCK_A = sgNodes[110].widgets_values[0];
  const SG_TYPE = sg.id; // [40] 装配子图节点 type=子图UUID
  for (const t of TYPES) t.expected = `${t.subject}\n${BASES[t.idx]}\n${LOCK_A}`;
  log(`期望装配长度: ${TYPES.map((t) => `${t.idx}${t.name}=${t.expected.length}`).join(" ")}`);

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", true);
  await sleep(2000);

  const graphJson = JSON.parse(readFileSync(WF, "utf8"));
  const nodeCount = graphJson.nodes.length;
  const opened = await loadWorkflow(page, "qi21-道劫-t2i-九型", graphJson);
  check("子图版: 工作流载入(前端 loadGraphData)", opened === "opened", String(opened));
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? ${nodeCount} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${nodeCount} 节点)` });
  await sleep(1500);

  // ── ① 干跑:graphToPrompt 无异常(子图装载验证) ──────────────────
  const dry = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return 'ok:nodes=' + Object.keys(p.output || {}).length; }
    catch (e) { return 'graphToPrompt-err:' + (e && e.message); }
  })()`);
  check("① 干跑: graphToPrompt 无异常(子图装载)", String(dry).startsWith("ok:"), String(dry).slice(0, 300));

  // 子图外露参数定位实测:dump [40] 节点(类型=子图UUID)的 widgets 名集
  const probe = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(SG_TYPE)});
    if (!n) return 'node-missing';
    return JSON.stringify({ title: n.title, widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: typeof w.value === 'string' ? w.value.slice(0, 30) + '…(' + w.value.length + ')' : w.value })) });
  })()`));
  log("[探测] [40] 子图节点 widgets:", String(probe).slice(0, 1200));
  check("① 探测: [40] 装配子图节点在前端可寻址(type=UUID)", String(probe).startsWith('{"title"'), String(probe).slice(0, 200));

  // 干跑级联取证:展开后 ComfySwitchNode(选型级联)与装配拼接的队列图
  const drySW = await promptDigest(page, "ComfySwitchNode", ["switch"]);
  log("[① 干跑] ComfySwitchNode 队列图取证:", String(drySW).slice(0, 600));
  const dryLatent = await promptDigest(page, "EmptyLatentImage", ["width", "height", "batch_size"]);
  log("[① 干跑] EmptyLatentImage 队列图取证:", String(dryLatent).slice(0, 300));
  await page.screenshot("0-loaded-default");

  // ── 画幅统一切 1024²(任务口径:九型全 1024²) ─────────────────────
  for (const s of [
    { type: "ResolutionSelector", titlePart: "", widget: "aspect_ratio", value: "1:1 (Square)" },
    { type: "ResolutionSelector", titlePart: "", widget: "megapixels", value: 1.0 },
  ]) {
    const r = await setWidget(page, s.type, s.titlePart, s.widget, s.value);
    check(`改参 ${s.type}.${s.widget}=${JSON.stringify(s.value)}`, String(r).startsWith("set:"), String(r).slice(0, 300));
    if (!String(r).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
  }
  await sleep(800);
  // 注:EmptyLatentImage 宽高是来自 [4] 的连线(展开为 ["4",0] 引用),字面 1024 只能看产物 sips;
  // 此处仅留证 batch=1 与连线在场,尺寸硬校验在每拍 sips 1024x1024。
  const latent = await promptDigest(page, "EmptyLatentImage", ["width", "height", "batch_size"]);
  log("[画幅] EmptyLatentImage 队列图取证(宽高=[4]连线):", String(latent).slice(0, 200));
  check("画幅: EmptyLatentImage 宽高接 [4] 连线·batch1", /"width":\["4",0\]/.test(String(latent)) && /"batch_size":1/.test(String(latent)), String(latent).slice(0, 200));

  // ── ② canon 九型顺序逐型出图 ───────────────────────────────────
  for (const t of TYPES) {
    // 型选择:全关后仅开该型开关(①人物=全关)
    for (const tg of ALL_TOGGLES) {
      const on = tg === t.toggle;
      const r = await setSubgraphToggle(page, SG_TYPE, tg, on);
      if (!String(r).startsWith("set:")) {
        check(`${t.idx}-${t.name}: 子图面板开关 ${tg}=${on}`, false, String(r).slice(0, 400));
        page.close(); killChrome(); process.exit(1);
      }
    }
    // 主体句:[24] 换库中该型例一(实测 PrimitiveStringMultiline 的 widget 名=value)
    const rs = await setWidget(page, "PrimitiveStringMultiline", "主体句", "value", t.subject);
    check(`${t.idx}-${t.name}: [24] 主体句=库${t.name}例一`, String(rs).startsWith("set:"), String(rs).slice(0, 160));
    if (!String(rs).startsWith("set:")) { page.close(); killChrome(); process.exit(1); }
    await sleep(900);
    // 干跑级联态取证(选型开关展开值)
    const swx = await promptDigest(page, "ComfySwitchNode", ["switch"]);
    const wantSw = t.toggle ? `"switch":true` : `"switch":false`;
    const trueCount = (String(swx).match(/"switch":true/g) || []).length;
    const expectedTrue = t.toggle ? 1 : 0; // 八级级联里仅该型一路 true(PE/RGBA 开关不在此类计数外——同 class,一并计入)
    check(`${t.idx}-${t.name}: 级联选型态(展开后 true 计数=${expectedTrue})`, String(swx).includes("switch") && trueCount === expectedTrue,
      `trueCount=${trueCount}; ${String(swx).slice(0, 400)}`);
    report.cases[`case${t.idx}`] = await genShot(page, t, t.expected);
    await sleep(1200);
    await page.screenshot(`${t.idx}-done`);
  }

  // ── console 留存与汇总 ─────────────────────────────────────
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt || 0).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(E2E_DIR, "console-jiuxing.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条见 console-jiuxing.json;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : "0 条");
  log(`控制台分流:load-noise=${consoleErrors.filter((e) => e.cls === "load-noise").length} / workflow-phase=${phaseErrs.length}`);
  report.consoleErrorCount = consoleErrors.length;
  report.consolePhaseErrorCount = phaseErrs.length;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(E2E_DIR, "jiuxing-report.json"), JSON.stringify(report, null, 2));

  page.close();
  killChrome();

  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ""}`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 九型实拍全部通过" : "❌ 九型实拍存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  try { writeFileSync(join(E2E_DIR, "console-jiuxing.json"), JSON.stringify(consoleErrors, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
