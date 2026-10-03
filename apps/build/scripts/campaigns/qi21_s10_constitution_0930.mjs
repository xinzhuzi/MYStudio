#!/usr/bin/env node
// ============================================================================
// ⛔ 1001 退役警示(Trellis 10-01-qi21-assembly-blueprint)——勿再运行本脚本!
// 2026-10-01 退役:0930 宪法改写役已收官入库;锚定件 [215][216][206][207][160][161]
// +link51/63/64 在 1001 S2 换型后已 StringConstant 查找失配、S8 集成轮删件换自研
// 装配器后彻底无源——重跑必红(预检 exit(2))。
// ============================================================================

/**
 * qi21 S10 宪法改写轮·实弹第一轮(09-30,Trellis 09-29-qi21-canvas-batch,
 * 方案=research/plan-宪法改写轮.md 主案「W1 收束句」;05 库 §一 0930 W1 条款已立):
 *   主案=在 t2i 装配子图 D7 融合链官方头尾包裹(W1)里注入一句型盲静态收束句——
 *   W1 四段=官方头[160]+剥离文[206]+收束句[215·新]+官方尾[161],链序铁律=收束句在
 *   剥离之后拼接(对词族结构性免疫)。**驱动器临时图构造=内存注入,零碰生产件**
 *   (读仓库 t2i JSON→内存加 215/216 两节点+重锚 link51+新链 63/64→loadGraphData;
 *   B2 役「测试工作流临时构造」先例;生产 JSON 在门禁全过前零改动,生成器落盘=P3
 *   另腿)。
 *
 * 三拍(全部 PE开+速度档=0·直出40步+画幅随型原生档):
 *   主攻 mv-main:多视图+RGBA跟随型+seed 9401 → PIL 验 alpha,
 *        判据(与 S6/S7 同口径)=四角 alpha 全 0 且全透占比≥50%;
 *   回归 prop-regress:道具+跟随型+seed 9402(已过型防破)→ 同上透明判据;
 *   回归 char-regress:人物+跟随型+seed 9403 → 须不透明(零真透明区;五型默认关)。
 *   每拍 finaltext 存盘+md5 对照(B7:在档众数变体 73f7c446(4052字)/偶发变体
 *   77ea6a67(3442字);md5 异=PE 偶发变体,该拍判读降级参考值,如实注)。
 *
 * 文证在场断言(判读前置门,plan §P1 v2):干跑排队图与真跑 history prompt[2] 双处
 *   须含①收束句逐字子串(StringConstant widget 值进了执行图)②StringConcatenate
 *   ×3 在 40: 域(207/208/216 结构性在场,防装载重编号)③剥离 RegexReplace 在
 *   40: 域(40:206)④PE 改写件在场。文证不在场=拍废归驱动器,不计入判读。
 *
 * 用法:node apps/build/scripts/qi21_s10_constitution_0930.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599,引擎操作员自拉口)/
 *   CDP_PORT(默认 9375)/SKIP(逗号分隔拍 key 跳过)。
 * 退出码 0=三拍全绿;1=有失败项或驱动异常(证据随 finally 落盘);2=环境错误
 *   (探活+A0/B0);130=SIGINT(同钩落盘+清理)。
 * 引擎生命周期:本驱动零自拉(引擎操作员编排,17599 自拉起/停)。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9375);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/s10-constitution-0930`;
const ENGINE_LOG = process.env.ENGINE_LOG || "/tmp/s10-engine-0930/engine.log";
const ALPHA_CHECKER = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`; // S6/S7 同款判定件(口径=四角0+≥50%/零真透明区,未改)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-s10-chrome-profile";
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const LIB05 = `${REPO}/docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`; // 宪法条款真源(0930 W1 收束句)

const ASM = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"; // [40] 装配子图 uuid(t2i)
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"; // [208] 加速子图 uuid(t2i)
const SPEED_DIRECT = "0 · 直出40步";
// B7 在档对照(法医 §3.1 实算:同种子文跨拍众数 4052 字=73f7c446;偶发变体 3442 字=77ea6a67)
const MD5_MAJORITY = "73f7c446", MD5_VARIANT = "77ea6a67";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 600)}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "--window-size=1720,1050", "--no-first-run",
    "--no-default-browser-check", "--disable-crash-reporter", "--disable-background-timer-throttling",
    ENGINE], { detached: true, stdio: "ignore" });
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
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 600);
      return r.result.value;
    },
    async screenshot(name) {
      const path = join(OUT_DIR, `${name}.png`);
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
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

function setSGWidget(page, sgType, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing';
    if (!n.widgets || !n.widgets.length) return 'no-widgets';
    const w = n.widgets.find(w => String(w.name || '') === ${JSON.stringify(wname)});
    if (!w) return 'widget-not-found:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
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

/** 懒取证源①:页面自身 socket tee(S3/S6/S7 同款;per-node 事件 sid 定向提交客户端) */
async function installTee(page) {
  const rc = await page.ev(`(() => {
    try {
      const sock = window.app.api.socket;
      if (!sock || typeof sock.addEventListener !== 'function') return 'no-socket:' + String(sock);
      window.__tee = [];
      window.__teeInstalledAt = Date.now();
      sock.addEventListener('message', (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if ((m.type === 'executing' || m.type === 'executed') && m.data && m.data.prompt_id && m.data.node != null) {
          window.__tee.push({ t: m.type, pid: m.data.prompt_id, node: String(m.data.node) });
        }
      });
      return 'tee-installed';
    } catch (e) { return 'EXC:' + e.message; }
  })()`);
  check("B0 懒取证源①装订:页面 socket tee", rc === "tee-installed", String(rc).slice(0, 200));
  return rc === "tee-installed";
}
function teeFramesOf(teeArr, pid) {
  const rec = { executing: new Set(), executed: new Set() };
  for (const f of teeArr || []) {
    if (f.pid !== pid || (f.t !== "executing" && f.t !== "executed")) continue;
    rec[f.t].add(String(f.node));
  }
  return rec;
}

async function historyPids() { try { return new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json())); } catch { return new Set(); } }
function logSize() { try { return readFileSync(ENGINE_LOG).length; } catch { return 0; } }
function logWindow(fromOffset) { try { return readFileSync(ENGINE_LOG, "utf8").slice(fromOffset); } catch { return ""; } }
function distillLog(win) {
  return win.split("\n").filter((l) => /got prompt|Prompt executed|loading|Loading|Requested|unload|lora|LoRA|text_encoder|clip|failed|Error|error/i.test(l)).slice(0, 100);
}
function logExecLines(win) { return (win.match(/Prompt executed in [0-9:.]+/g) || []); }

async function waitHistory(feature, { timeout, knownPids }) {
  const t0 = Date.now(); let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob, pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 8000)}` };
        const imgs = []; const texts = {};
        for (const [nid, o] of Object.entries(e.outputs || {})) {
          if (o.images) imgs.push(...o.images);
          if (o.text) texts[nid] = o.text;
        }
        if (imgs.length) return { pid, imgs, texts, status: st, outputs: e.outputs, messages: e.status?.messages, promptBlob: blob };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(4000);
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

/** PIL alpha 程序验证(独立 python 件,stdout=JSON) */
function alphaCheck(pngPath, expect) {
  return new Promise((resolve) => {
    const p = spawn("python3", [ALPHA_CHECKER, pngPath, expect], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", (e) => resolve({ checker_error: String(e) }));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, parse_error: out.slice(0, 500) }); }
    });
  });
}

// ── W1 收束句:从 05 库宪法条款程序提取(零转录;提取失败=环境错误,不手抄) ──
const libText = readFileSync(LIB05, "utf8");
const sentMatch = libText.match(/主候选句在案\((The subject[^)]*?)\)/);
if (!sentMatch) { console.error("收束句提取失败:05 库 0930 W1 条款主候选句不在案"); process.exit(2); }
const SENT = sentMatch[1];
const SENT_MD5 = createHash("md5").update(SENT).digest("hex");

// ── 工作流真源常量(装载前从 JSON 解析,零转录) ──
const wfJson = JSON.parse(readFileSync(WF, "utf8"));
const asmSg = wfJson.definitions.subgraphs.find((s) => s.id === ASM);
const innerByType = (t) => asmSg.nodes.filter((n) => n.type === t);
const rgbaHead = innerByType("StringConstant").find((n) => (n.title || "").includes("官方头句")).widgets_values[0];
const rgbaTail = innerByType("StringConstant").find((n) => (n.title || "").includes("官方尾句")).widgets_values[0];
const stripNode = innerByType("RegexReplace")[0];
const stripPattern = stripNode.widgets_values[1];
log(`真源常量: 官方头=${rgbaHead.slice(0, 40)}… / 剥离 pattern 长=${stripPattern.length}(RegexReplace id=${stripNode.id})`);
log(`W1 收束句(05库程序提取): "${SENT.slice(0, 60)}…" md5=${SENT_MD5.slice(0, 8)} 词数=${SENT.split(" ").length}`);

// ── W1 收束句内存注入(零碰生产件;B2 临时图构造先例) ──
// 现链:[206]剥离 --link51--> [207].string_b;注入后:[206] --link51--> [216].string_a,
// [215]收束句 --link63--> [216].string_b,[216] --link64--> [207].string_b
// (W1 四段=官方头[160]+([206]剥离文+收束句[215])+官方尾[161],delimiter=空格同 [207][208] 款)
const nodeIds = new Set(asmSg.nodes.map((n) => n.id));
const linkIds = new Set(asmSg.links.map((l) => l.id));
if (nodeIds.has(215) || nodeIds.has(216)) { console.error(`注入前置失败:节点 id 215/216 已占用(${[...nodeIds].filter((i) => i === 215 || i === 216).join(",")});生产件可能已被生成器落盘 W1,勿重复注入`); process.exit(2); }
if (linkIds.has(63) || linkIds.has(64)) { console.error("注入前置失败:链 id 63/64 已占用"); process.exit(2); }
const l51 = asmSg.links.find((l) => l.id === 51);
if (!l51 || l51.origin_id !== 206 || l51.target_id !== 207 || l51.target_slot !== 1) {
  console.error(`注入前置失败:link51 非预期形态(得 ${JSON.stringify(l51)},期望 206→207.slot1)`); process.exit(2);
}
l51.target_id = 216; l51.target_slot = 0; // 剥离文改喂 [216].string_a
asmSg.links.push({ id: 63, origin_id: 215, origin_slot: 0, target_id: 216, target_slot: 1, type: "STRING" });
asmSg.links.push({ id: 64, origin_id: 216, origin_slot: 0, target_id: 207, target_slot: 1, type: "STRING" });
const n207 = asmSg.nodes.find((n) => n.id === 207);
n207.inputs.find((i) => i.name === "string_b").link = 64;
asmSg.nodes.push({
  id: 215, type: "StringConstant", title: "W1收束句(宪法改写轮S10·型盲静态·内存注入)",
  pos: [2150, 2900], size: [380, 120], flags: {}, order: 0, mode: 0,
  inputs: [],
  outputs: [{ name: "STRING", type: "STRING", links: [63] }],
  properties: { "Node name for S&R": "StringConstant" },
  widgets_values: [SENT],
});
asmSg.nodes.push({
  id: 216, type: "StringConcatenate", title: "W1收束拼(剥离文+收束句;delimiter=空格)",
  pos: [3250, 2900], size: [380, 180], flags: {}, order: 0, mode: 0,
  inputs: [
    { name: "string_a", type: "STRING", widget: { name: "string_a" }, link: 51 },
    { name: "string_b", type: "STRING", widget: { name: "string_b" }, link: 63 },
  ],
  outputs: [{ name: "STRING", type: "STRING", links: [64] }],
  properties: { "Node name for S&R": "StringConcatenate" },
  widgets_values: ["", "", " "],
  widgets_values_named: { delimiter: " " },
});
log(`内存注入完成:+节点215(StringConstant·收束句)/+节点216(StringConcatenate·delimiter=空格)/link51 重锚 207→216.slot0/+link63/+link64(生产件零写)`);

const SHOTS = [
  { key: "mv-main",       type: "多视图", rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9401, expect: "transparent", timeout: 5_400_000 },
  { key: "prop-regress",  type: "道具",   rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9402, expect: "transparent", timeout: 2_700_000 },
  { key: "char-regress",  type: "人物",   rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9403, expect: "opaque",     timeout: 5_400_000 },
];

const report = {
  mode: "s10-constitution", engine: ENGINE, engineNote: "引擎操作员自拉 17599(S6 §一同源配方),收摊 pkill 自拉全家+双口验 down",
  wf: WF, lib05: LIB05, startedAt: new Date().toISOString(),
  constitution: {
    sentence: SENT, sentenceMd5: SENT_MD5, sentenceWords: SENT.split(" ").length,
    source: "05 库 §一 0930 W1 收束句条款·主候选句(程序提取零转录)",
    injection: "内存注入(loadGraphData 前改 wfJson 副本):+215 StringConstant/+216 StringConcatenate(delimiter=空格)/link51 重锚 206→216.slot0/link63 215→216.slot1/link64 216→207.slot1;W1 四段=官方头[160]+([206]剥离文+[215]收束句)+官方尾[161];生产 JSON 零写",
  },
  consts: { rgbaHead, rgbaTail, stripPattern, stripPatternLen: stripPattern.length },
  shots: {},
};

/** W1 文证在场扫描(防装载重编号:按值/结构锚,不锚 JSON id;plan §P1 v2) */
function scanW1Output(outputObj) {
  const r = { sentNode: null, concatNodes: [], stripNode: null, literalIds: {} };
  for (const [k, v] of Object.entries(outputObj || {})) {
    if (!String(k).startsWith("40:")) continue;
    if (v?.class_type === "StringConstant" && v?.inputs?.string === SENT) r.sentNode = k;
    if (v?.class_type === "StringConcatenate") r.concatNodes.push(k);
    if (v?.class_type === "RegexReplace") r.stripNode = k;
  }
  r.literalIds["40:215"] = !!outputObj?.["40:215"];
  r.literalIds["40:216"] = !!outputObj?.["40:216"];
  return r;
}
function w1EvidenceOk(sc) {
  return !!sc.sentNode && sc.concatNodes.length >= 3 && !!sc.stripNode;
}
const md5Of = (s) => createHash("md5").update(s, "utf8").digest("hex");

// 0930 修复官 D-2 同款:环境段(A0/B0)失败专用标记→退出码 2;page 提升模块级供 finally/SIGINT
class EnvError extends Error {}
let page = null;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    // 环境:节点注册核(S2/S3/S6/S7 载荷件)
    for (const cls of ["MyQi21DaojieBase", "MyQi21RgbaSelect", "MyQi21SpeedSelect", "QwenImage21_T2IPromptRewrite", "T8QwenImage21FunAccPDD4Step", "RegexReplace", "easy showAnything"]) {
      const r = await fetch(`${ENGINE}/object_info/${encodeURIComponent(cls)}`);
      check(`A0 节点注册核: ${cls}`, r.status === 200, `HTTP ${r.status}`);
    }
    const peObj = await (await fetch(`${ENGINE}/object_info/CLIPLoader`)).json();
    const peOk = (peObj.CLIPLoader?.input?.required?.clip_name?.[0] || []).includes("qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors");
    check("A0 环境: PE-T2I 权重在盘(CLIPLoader 可选集)", peOk, "");

    launchChrome();
    page = await getPageClient();
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
    check("A0 引擎前端就绪(app.isGraphReady)", true);
    await sleep(2000);
    await installTee(page);

    const nodeCount = wfJson.nodes.length; // 主图层节点数(注入只动子图定义,主图零变)
    const opened = await page.ev(`(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 's10-constitution');
      return 'opened';
    })()`);
    check("B0 t2i 工作流载入(loadGraphData,仓库真源+内存注入 W1 收束句)", opened === "opened", String(opened));
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: "画布切换" });
    await sleep(1500);
  } catch (e) {
    throw new EnvError(`A0/B0 环境段失败: ${e && e.message}`);
  }

  // 运行态靶发现(干跑排队图实况;子图内节点装载可重编号,勿锚 JSON id)
  const parseDigest = async (cls, fields) => { try { return JSON.parse(String(await promptDigest(page, cls, fields))); } catch { return null; } };
  const selArr = await parseDigest("MyQi21SpeedSelect", ["mode"]);
  const ksArr = await parseDigest("KSampler", ["steps"]);
  const seedArr = await parseDigest("PrimitiveInt", ["value"]);
  const perwArr = await parseDigest("QwenImage21_T2IPromptRewrite", ["clip"]);
  const rgbaArr = await parseDigest("MyQi21RgbaSelect", ["mode"]);
  const NID = {
    SEL: selArr?.find((o) => String(o.node).startsWith("208:"))?.node,
    KS_DIR: ksArr?.find((o) => String(o.node).startsWith("208:") && o.steps === 40)?.node,
    SEED: seedArr?.find((o) => String(o.node).startsWith("208:") && typeof o.value === "number")?.node,
    PERW: perwArr?.find((o) => String(o.node).startsWith("40:"))?.node,
    RGBASEL: rgbaArr?.find((o) => String(o.node).startsWith("40:"))?.node,
  };
  const rtOk = Object.values(NID).every((v) => !!v);
  check("B0 运行态取证靶发现(干跑排队图实况:选择/直出KS/seed/PE改写/三态件)", rtOk, JSON.stringify(NID));
  report.targets = NID;
  if (!rtOk) throw new EnvError(`B0 运行态取证靶发现失败: ${JSON.stringify(NID)}`);

  // 文证在场断言·干跑腿(plan §P1 v2 判读前置门:不在场=拍废归驱动器,一发不打)
  const dryPromptRaw = await page.ev(`(async () => { try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); } catch (e) { return 'ERR:' + (e && e.message); } })()`);
  let dryScan = null;
  try { dryScan = scanW1Output(JSON.parse(String(dryPromptRaw))); } catch { dryScan = null; }
  report.dryW1Scan = dryScan;
  check("B0 文证在场·干跑: 收束句 StringConstant 进执行图 + StringConcatenate×3 在 40: 域 + 剥离 RegexReplace 在 40: 域",
    !!dryScan && w1EvidenceOk(dryScan),
    dryScan ? `sentNode=${dryScan.sentNode} concat=${dryScan.concatNodes.join(",")} strip=${dryScan.stripNode} literalIds=${JSON.stringify(dryScan.literalIds)}` : String(dryPromptRaw).slice(0, 200));
  if (!dryScan || !w1EvidenceOk(dryScan)) throw new EnvError(`文证在场·干跑腿失败: ${JSON.stringify(dryScan)}`);

  const SKIP = new Set((process.env.SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const shot of SHOTS) {
    if (SKIP.has(shot.key)) { log(`(skip ${shot.key})`); continue; }
    const pr = { ...shot, startedAt: new Date().toISOString() };
    report.shots[shot.key] = pr;
    log(`\n════════ ${shot.key}: 型=${shot.type} RGBA=${shot.rgba} PE=${shot.pe} seed=${shot.seed} ════════`);
    try {
      // ── 面板设定(真前端 widget 值=权威值源;画幅随型=MyQi21DaojieBase 直驱 [5]) ──
      const sets = [];
      sets.push([`型选择=${shot.type}`, await setSGWidget(page, ASM, "型选择", shot.type)]);
      sets.push([`RGBA透明=${shot.rgba}`, await setSGWidget(page, ASM, "RGBA透明", shot.rgba)]);
      sets.push([`PE开关=${shot.pe}`, await setSGWidget(page, ASM, "PE开关", shot.pe)]);
      sets.push([`速度档位=${shot.speed}`, await setSGWidget(page, ACCEL, "速度档位", shot.speed)]);
      sets.push([`seed=${shot.seed}`, await setSGWidget(page, ACCEL, "seed", shot.seed)]);
      pr.panelSets = sets.map(([n, r]) => `${n}: ${r}`);
      const setOk = sets.every(([, r]) => String(r).startsWith("set:"));
      check(`[${shot.key}] 宿主面板五控件设定`, setOk, sets.map(([n, r]) => `${n}=${String(r).slice(0, 60)}`).join(" | "));
      if (!setOk) { pr.fatal = "面板设定失败"; continue; }

      // ── 源④:干跑排队图摘要(面板值直通证 + 文证在场逐拍复验) ──
      const dryRgba = String(await promptDigest(page, "MyQi21RgbaSelect", ["mode"]));
      const dryBase = String(await promptDigest(page, "MyQi21DaojieBase", ["base"]));
      const drySel = String(await promptDigest(page, "MyQi21SpeedSelect", ["mode"]));
      const drySeed = String(await promptDigest(page, "PrimitiveInt", ["value"]));
      const dryLat = String(await promptDigest(page, "EmptyLatentImage", ["width", "height"]));
      const dryOk = dryRgba.includes(`"mode":"${shot.rgba}"`) && dryBase.includes(`"base":"${shot.type}"`)
        && drySel.includes(`"mode":"${shot.speed}"`) && (drySeed.includes(`"value":${shot.seed},`) || drySeed.includes(`"value":${shot.seed}}`));
      check(`[${shot.key}] 源④干跑: 面板值直通排队图(型/三态/档位/seed)`, dryOk,
        `${dryBase.slice(0, 80)} ${dryRgba.slice(0, 60)} ${drySel.slice(0, 80)} ${drySeed.slice(0, 80)}`);
      pr.dryDigest = { base: dryBase.slice(0, 120), rgba: dryRgba.slice(0, 80), sel: drySel.slice(0, 120), seed: drySeed.slice(0, 80), latent: dryLat.slice(0, 120) };

      // ── 真跑 ──
      const logBefore = logSize();
      const knownPids = await historyPids();
      await sleep(800);
      const queued = await page.ev(`(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); } })()`);
      check(`[${shot.key}] queuePrompt 发出(真前端)`, queued === "queued", String(queued));
      if (queued !== "queued") { pr.fatal = "queuePrompt 失败"; continue; }
      const sig = (blob) => blob.includes(`"mode":"${shot.rgba}"`) && blob.includes(`"base":"${shot.type}"`)
        && blob.includes(`"mode":"${shot.speed}"`) && (blob.includes(`"value":${shot.seed},`) || blob.includes(`"value":${shot.seed}}`));
      const t0 = Date.now();
      const hist = await waitHistory(sig, { timeout: shot.timeout, knownPids });
      pr.secs = ((Date.now() - t0) / 1000).toFixed(0);
      const logWin = logWindow(logBefore);
      pr.engineLog = distillLog(logWin);
      pr.execLines = logExecLines(logWin);
      if (hist.error) {
        check(`[${shot.key}] 引擎执行完成`, false, String(hist.error).slice(0, 3000));
        pr.error = hist.error;
        continue;
      }
      pr.pid = hist.pid;
      check(`[${shot.key}] 引擎执行完成`, hist.status === "success", `status=${hist.status} ${pr.secs}s pid=${String(hist.pid).slice(0, 8)} exec=${pr.execLines.join(",")}`);

      // ── 文证在场断言·真跑腿(history prompt[2] 排队图;判读前置门) ──
      let histScan = null;
      try { histScan = scanW1Output(JSON.parse(hist.promptBlob)); } catch { histScan = null; }
      pr.histW1Scan = histScan;
      check(`[${shot.key}] 文证在场·真跑: 收束句进排队图 + StringConcatenate×3 + 剥离件在场`,
        !!histScan && w1EvidenceOk(histScan),
        histScan ? `sentNode=${histScan.sentNode} concat=${histScan.concatNodes.join(",")} strip=${histScan.stripNode} literalIds=${JSON.stringify(histScan.literalIds)}` : "blob 解析失败");

      // ── 产物落盘 + PIL alpha 程序验证 ──
      const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
      const pngPath = join(OUT_DIR, `${shot.key}-seed${shot.seed}.png`);
      let buf = null;
      try { buf = await fetchView(saveImg, pngPath); } catch (e) { check(`[${shot.key}] 出图落盘(/view)`, false, String(e.message)); }
      if (buf) {
        check(`[${shot.key}] 出图落盘(/view)`, buf.length > 50_000, `${saveImg.filename} ${(buf.length / 1024).toFixed(0)}KB`);
        const alpha = await alphaCheck(pngPath, shot.expect);
        const m = alpha?.metrics;
        if (!m || !alpha?.ihdr) { check(`[${shot.key}] PIL alpha 程序验证`, false, JSON.stringify(alpha).slice(0, 300)); pr.alpha = alpha; }
        else {
          const corners = `${m.corners.tl},${m.corners.tr},${m.corners.bl},${m.corners.br}`;
          const pct = m.ratioAlpha0 * 100;
          const band7690 = pct >= 76 && pct <= 90;
          alpha.band7690 = band7690;
          pr.alpha = alpha;
          check(`[${shot.key}] PIL alpha: IHDR色型=${alpha.ihdr.color_type} PIL=${alpha.pil_mode} 尺寸=${alpha.ihdr.w}x${alpha.ihdr.h} 四角=[${corners}] 全透占比=${pct.toFixed(2)}%${shot.expect === "transparent" ? (band7690 ? "(带内76-90)" : "(带外76-90,记录不阻断)") : ""}`,
            alpha.pass, `全透px=${m.transparentPx}/${m.totalPx} 半透占比=${(m.ratioSemi * 100).toFixed(2)}% alpha[min=${m.alphaMin},max=${m.alphaMax},mean=${m.alphaMean}] 判定=${alpha.verdict}`);
        }
      }

      // ── 最终文本([27] 装配预览=将进主编码的文)取证 + 存盘 + md5 对照(B7) ──
      const textVals = Object.values(hist.texts || {}).flat().map(String);
      const finalText = textVals.find((t) => t.length > 40) || textVals[0] || "";
      pr.finalTextLen = finalText.length;
      pr.finalTextHead = finalText.slice(0, 300);
      pr.finalTextTail = finalText.slice(-200);
      if (finalText) { try { writeFileSync(join(OUT_DIR, `${shot.key}-finaltext.txt`), finalText); } catch { /* 尽力 */ } }
      if (finalText) {
        pr.finalTextMd5 = md5Of(finalText);
        pr.md5Compare = pr.finalTextMd5.startsWith(MD5_MAJORITY) ? "majority(4052字众数,73f7c446):同句定死成立,唯一变量=收束句"
          : pr.finalTextMd5.startsWith(MD5_VARIANT) ? "variant(3442字偶发变体,77ea6a67):同句定死成立(变体在档),判读可用"
          : `new-variant:PE 出文新变体(B7),配对判读降级参考值,如实注`;
        const hasHead = finalText.includes(rgbaHead), hasTail = finalText.includes(rgbaTail);
        const hasSent = finalText.includes(SENT); // 结构性断言:收束句只喂 [209].on_true→[143] 透明支路,主路最终文本须零沾
        let bgHits = 0;
        try { bgHits = (finalText.toLowerCase().match(new RegExp(stripPattern, "g")) || []).length; } catch { bgHits = -1; }
        pr.textCheck = { hasOfficialHead: hasHead, hasOfficialTail: hasTail, hasW1Sentence: hasSent, bgSentenceHits: bgHits };
        check(`[${shot.key}] 主路文本洁净: 最终文本无官方头尾+W1收束句不在场(收束句只作用于 RGBA 编码支路)且 md5 对照=${pr.md5Compare}`,
          !hasHead && !hasTail && !hasSent,
          `len=${finalText.length} md5=${pr.finalTextMd5.slice(0, 8)} bgHits=${bgHits}(信息项:主路未剥离如实保留)`);
      } else {
        check(`[${shot.key}] 最终文本取证([27]装配预览)`, false, "history 无 text 输出");
      }

      // ── 源①:socket tee 执行帧(PE 改写真跑取证) ──
      const teeRaw = await page.ev(vis(`JSON.stringify(window.__tee || [])`));
      let teeArr = null; try { teeArr = JSON.parse(String(teeRaw)); } catch { /* null */ }
      const rec = teeArr ? teeFramesOf(teeArr, hist.pid) : null;
      const executedNodes = rec ? [...new Set([...rec.executed, ...rec.executing])] : [];
      pr.executedNodes = executedNodes;
      pr.frameStats = rec ? { executing: rec.executing.size, executed: rec.executed.size } : null;
      const sawFrames = !!rec && executedNodes.length > 0;
      check(`[${shot.key}] 源①socket tee 帧源活性(>0 帧,防零帧空集假证)`, sawFrames,
        rec ? `executing=${rec.executing.size}/executed=${rec.executed.size}` : "tee 未捕获该拍");
      if (sawFrames) {
        const peRan = executedNodes.includes(NID.PERW);
        check(`[${shot.key}] PE 支路执行集成员资格: QwenImage21_T2IPromptRewrite=须在(实测${peRan ? "在" : "不在"})`,
          peRan === true, `PERW=${NID.PERW}`);
        if (histScan?.sentNode) {
          const sentRan = executedNodes.includes(histScan.sentNode);
          pr.sentNodeInExec = sentRan;
          check(`[${shot.key}] W1 收束句节点执行集成员资格(${histScan.sentNode}=须在,实测${sentRan ? "在" : "不在"})`, sentRan === true, "");
        }
      }
      await page.screenshot(`${shot.key}-done`);
      // 拍间释放(0924 OOM 复盘配方;自拉引擎独占,排队中任务会自动重载)
      try {
        const r = await fetch(`${ENGINE}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
        check(`[${shot.key}] 拍间释放 POST /free`, r.status === 200, `HTTP ${r.status}`);
      } catch (e) { check(`[${shot.key}] 拍间释放 POST /free`, false, String(e.message)); }
      await sleep(6000);
    } catch (e) {
      check(`[${shot.key}] 拍级异常捕获(如实记,不断批)`, false, String(e && e.message).slice(0, 400));
      pr.exception = String(e && e.message);
    }
    pr.finishedAt = new Date().toISOString();
    writeReport();
  }
}

function writeReport() {
  report.results = results;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT_DIR, "s10-constitution-report.json"), JSON.stringify(report, null, 2));
}
function cleanup() {
  try { page?.close(); } catch { /* gone */ }
  killChrome();
}

// 退出码语义(S7 家族同款):0=三拍全绿;1=有失败项或驱动异常(证据随 finally 落盘);
// 2=环境错误(探活+A0/B0+文证干跑腿);130=SIGINT(同钩清理)。
process.on("SIGINT", () => {
  log("SIGINT:落盘已取得证据并清理后退出");
  try { writeReport(); } catch { /* 尽力 */ }
  cleanup();
  process.exit(130);
});

try {
  const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", alive.system?.comfyui_version);
} catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

let exitCode = 0;
try {
  await main();
  if (!results.every((r) => r.pass)) exitCode = 1;
} catch (e) {
  exitCode = e instanceof EnvError ? 2 : 1;
  console.error(e instanceof EnvError ? "环境错误(退出码 2):" : "驱动异常(退出码 1,已取得证据随 finally 落盘):", e && e.message);
} finally {
  try { writeReport(); } catch (e) { console.error("报告落盘失败:", e && e.message); }
  cleanup();
}
log("════ S10 宪法改写轮·实弹第一轮三拍汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(exitCode);
