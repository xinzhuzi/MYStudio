#!/usr/bin/env node
// ============================================================================
// ⛔ 1001 退役警示(Trellis 10-01-qi21-assembly-blueprint)——勿再运行本脚本!
// 2026-10-01 退役:0930 P2 回归补拍役已收官入库;锚定件 [215][216][206][207][160][161]
// +[209] 在 1001 S2 换型后已 StringConstant 查找失配、S8 集成轮删件换自研装配器后
// 彻底无源——重跑必红(预检 exit(2))。
// ============================================================================

/**
 * qi21 S10 宪法改写轮·P2 回归补拍(09-30 立账 10-01 实弹,Trellis 09-29-qi21-canvas-batch):
 *   W1 收束句已落盘进仓库真源 t2i JSON(S10 P3 落盘+落盘终验 9601 双过门;S11 判据校准
 *   +四型透明 4/4 关账)。本驱动=**零注入直跑**(loadGraphData 仓库 JSON 原样装载,
 *   驱动侧零改图,S10 落盘终验/S11 收尾同款对偶),补齐 plan-宪法改写轮.md §三 P2
 *   回归五拍 + prop 红拍换 seed 补拍一发(commit-plan-constitution.md §五-1:
 *   prop-regress 9402 md5=7f534c87 新变体→B7 口径判读降级参考值,须重拍或换 seed 补位):
 *
 * 六拍(全部 PE开+速度档 0·直出40步+画幅随型原生档):
 *   prop-reshoot:道具+跟随型+seed 9801(换 seed 补位)→ 透明判据(W1 路);
 *   p2-prop-9201:道具+跟随型+seed 9201(f1r 同条件)→ 透明判据;
 *   p2-face-9203:高清人脸+跟随型+seed 9203(f3r 同条件)→ 透明判据;
 *   p2-expr-9104:表情差分+跟随型+seed 9104(f4 同条件)→ 透明判据;
 *   p2-char-9204:人物+跟随型+seed 9204(r1r 同条件)→ 不透明判据(零真透明区;
 *     人物 rgba_default=false→RGBA 关→W1 支路懒旁路,执行集成员资格记录不判,
 *     S10 第一轮 char 拍断言未分型红的前科教训);
 *   p2-propoff-9205:道具+强制关+seed 9205(r2r 同条件)→ 不透明+D7 主路文证
 *     (最终文本 bgHits 在场=带背景完整文+官方头尾不在场+收束句不在场;结构性断言:
 *     W1 只喂 [209].on_true,主路与最终文本零沾)。
 *
 * 判据=校准后判定件 qi21_s6_alpha_check_0930.py(0930 S11 校准,用户 0930 拍板采纳):
 *   透明过门=四角 alpha ≤2(CAL_TRANSPARENT_CORNER_MAX,插值级残值容差)+全透占比≥50%;
 *   严口径(四角严格==0)结果并报于 verdict,不抹历史(s11-calibration.md)。
 *   不透明=零真透明区(全透<0.1%+四角≥250+均值≥250;严口径 alphaMin==255 并报)。
 *   PIL 双路=驱动内 alphaCheck(第一路)+引擎操作员事后独立复跑判定件(第二路)。
 *
 * 语义寻址纪律(s10 驱动同款):宿主面板控件按子图 uuid+widget 名寻址(型选择/RGBA透明/
 *   PE开关/速度档位/seed);运行态取证靶按排队图 class_type+域前缀发现(勿锚 JSON id);
 *   W1 文证按值锚扫描(收束句 widget 值=句身,防装载重编号)。
 *
 * 产物:apps/output/s10-p2-0930/{六拍 PNG+finaltext+done 截图+s10-p2-report.json}。
 * 用法:node apps/build/scripts/qi21_s10_p2_0930.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9381)/
 *   SKIP(逗号分隔拍 key 跳过)。
 * 退出码 0=六拍全绿;1=有失败项或驱动异常(证据随 finally 落盘);2=环境错误
 *   (探活+A0/B0);130=SIGINT(同钩落盘+清理)。
 * 引擎生命周期:零自拉(引擎操作员自拉 17599;收摊 pkill 自拉全家+双口验 down)。
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
const CDP_PORT = Number(process.env.CDP_PORT || 9381);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/s10-p2-0930`;
const ENGINE_LOG = process.env.ENGINE_LOG || "/tmp/s10-p2-0930/engine.log";
const ALPHA_CHECKER = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`; // 0930 S11 校准版判定件(角≤2 容差,严口径并报)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-s10-p2-chrome-profile";
// WF_PATH 旋钮(腿二冻结图):并行会话 1001 装配蓝图化轮(3e93c69)改了仓库真源形态,
// 六拍电池须同图可比——腿一(79aeb3b 图)既成,腿二以 WF_PATH 指冻结图 apps/output/
// s10-p2-0930/wf-frozen-79aeb3b.json(b8e0e43 wf-frozen 先例);不设 env 时仍读仓库真源。
const WF = process.env.WF_PATH || `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const LIB05 = `${REPO}/docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`;

const ASM = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"; // [40] 装配子图 uuid(t2i)
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"; // [208] 加速子图 uuid(t2i)
const SPEED_DIRECT = "0 · 直出40步";
const MD5_LEDGER = [["73f7c446", "majority(4052字众数)"], ["77ea6a67", "variant(3442字偶发变体)"], ["7f534c87", "s10新变体(4329字,prop拍)"], ["114d98f5", "s10新变体(4032字,char拍)"], ["27e318e1", "s11新变体(4124字,expr拍)"]];

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

// ── 仓库真源原样读入(零改图);W1 落盘在场预检 ──
const wfJson = JSON.parse(readFileSync(WF, "utf8"));
const asmSg = wfJson.definitions.subgraphs.find((s) => s.id === ASM);
const innerByType = (t) => asmSg.nodes.filter((n) => n.type === t);
const rgbaHead = innerByType("StringConstant").find((n) => (n.title || "").includes("官方头句")).widgets_values[0];
const rgbaTail = innerByType("StringConstant").find((n) => (n.title || "").includes("官方尾句")).widgets_values[0];
const stripNode = innerByType("RegexReplace")[0];
const stripPattern = stripNode.widgets_values[1];
// 收束句=仓库 JSON [215] widget(落盘真源);与 05 库条款句身逐字互锁(生成器同款纪律)
const w1Node = asmSg.nodes.find((n) => n.id === 215 && n.type === "StringConstant" && (n.title || "").includes("W1收束句"));
if (!w1Node) { console.error("W1 落盘预检失败:仓库 JSON 无 [215] W1收束句 StringConstant(落盘未就位,无可终验)"); process.exit(2); }
const SENT = w1Node.widgets_values[0];
const SENT_MD5 = createHash("md5").update(SENT).digest("hex");
const libText = readFileSync(LIB05, "utf8");
const libSent = (libText.match(/主候选句在案\((The subject[^)]*?)\)/) || [])[1];
const w1Cat = asmSg.nodes.find((n) => n.id === 216 && n.type === "StringConcatenate");
const l51 = asmSg.links.find((l) => l.id === 51);
const l63 = asmSg.links.find((l) => l.id === 63);
const l64 = asmSg.links.find((l) => l.id === 64);
const landedOk = !!w1Cat && !!l63 && !!l64 && l51.origin_id === 206 && l51.target_id === 216 && l51.target_slot === 0
  && l63.origin_id === 215 && l63.target_id === 216 && l63.target_slot === 1
  && l64.origin_id === 216 && l64.target_id === 207 && l64.target_slot === 1;
console.log(`W1 落盘预检: [215]句身 md5=${SENT_MD5.slice(0, 8)} 词数=${SENT.split(" ").length} | 05库句身逐字一致=${SENT === libSent} | [216]/link51改道/63/64 拓扑=${landedOk ? "齐" : "缺"}`);
if (!landedOk || SENT !== libSent) { console.error("W1 落盘预检失败:拓扑或缺或 05 库句身漂移(生成器真源链断)"); process.exit(2); }
log(`真源常量: 官方头=${rgbaHead.slice(0, 40)}… / 剥离 pattern 长=${stripPattern.length}(RegexReplace id=${stripNode.id})`);

// 六拍:prop 补拍(换 seed 9801)+ P2 五拍(plan §三 P2 表;判据分型)
const SHOTS = [
  { key: "prop-reshoot",  type: "道具",     rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9801, expect: "transparent", timeout: 2_700_000, gate: "transparent" },
  { key: "p2-prop-9201",  type: "道具",     rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9201, expect: "transparent", timeout: 2_700_000, gate: "transparent" },
  { key: "p2-face-9203",  type: "高清人脸", rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9203, expect: "transparent", timeout: 2_700_000, gate: "transparent" },
  { key: "p2-expr-9104",  type: "表情差分", rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9104, expect: "transparent", timeout: 5_400_000, gate: "transparent" },
  { key: "p2-char-9204",  type: "人物",     rgba: "跟随型", pe: true, speed: SPEED_DIRECT, seed: 9204, expect: "opaque",     timeout: 5_400_000, gate: "opaque" },
  { key: "p2-propoff-9205", type: "道具",   rgba: "强制关", pe: true, speed: SPEED_DIRECT, seed: 9205, expect: "opaque",     timeout: 2_700_000, gate: "opaque-d7-text" },
];

const report = {
  mode: "s10-p2-regress", engine: ENGINE, engineNote: "引擎操作员自拉 17599(S6 §一同源配方),收摊 pkill 自拉全家+双口验 down",
  wf: WF, wfNote: "仓库真源原样装载(loadGraphData),驱动侧零改图(零注入,S10 落盘版/S11 收尾同款)",
  startedAt: new Date().toISOString(),
  gate: "校准后判定件 qi21_s6_alpha_check_0930.py(0930 S11 校准,用户拍板采纳):透明过门=四角 alpha≤2(插值级残值容差)+全透≥50%;不透明=零真透明区(全透<0.1%+四角≥250+均值≥250);严口径并报于 verdict 不抹历史(s11-calibration.md);plan §三 P2 回归口径=W1 后各型产物不劣化(透明型走透明判据/人物走不透明判据/强制关走带背景完整文 D7 主路文证)",
  constitution: {
    sentence: SENT, sentenceMd5: SENT_MD5, sentenceWords: SENT.split(" ").length,
    source: "仓库 t2i JSON [215] W1收束句 widget(生成器落盘真源);与 05 库 §一 0930 条款句身逐字互锁",
    landedTopology: { w1Cat: !!w1Cat, link51: `${l51.origin_id}→${l51.target_id}.${l51.target_slot}`, link63: `${l63.origin_id}→${l63.target_id}.${l63.target_slot}`, link64: `${l64.origin_id}→${l64.target_id}.${l64.target_slot}` },
  },
  consts: { rgbaHead, rgbaTail, stripPattern, stripPatternLen: stripPattern.length },
  shots: {},
};

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
const w1EvidenceOk = (sc) => !!sc.sentNode && sc.concatNodes.length >= 3 && !!sc.stripNode;
const md5Of = (s) => createHash("md5").update(s, "utf8").digest("hex");
const md5LedgerHit = (md5) => MD5_LEDGER.find(([p]) => md5.startsWith(p));

class EnvError extends Error {}
let page = null;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
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

    const nodeCount = wfJson.nodes.length;
    const opened = await page.ev(`(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 's10-p2-regress');
      return 'opened';
    })()`);
    check("B0 t2i 工作流载入(loadGraphData,仓库真源原样·零注入)", opened === "opened", String(opened));
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${nodeCount} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: "画布切换" });
    await sleep(1500);
  } catch (e) {
    throw new EnvError(`A0/B0 环境段失败: ${e && e.message}`);
  }

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
  check("B0 运行态取证靶发现(干跑排队图实况)", rtOk, JSON.stringify(NID));
  report.targets = NID;
  if (!rtOk) throw new EnvError(`B0 运行态取证靶发现失败: ${JSON.stringify(NID)}`);

  // 文证在场·干跑腿(默认态:人物例一→rgba_default=false→融合链懒旁路;排队图仍须含 W1 节点项——
  // S10 第一轮实证:blob 含 40:216 而执行集不含。此腿失败=环境/装载问题,一发不打)
  const dryPromptRaw = await page.ev(`(async () => { try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); } catch (e) { return 'ERR:' + (e && e.message); } })()`);
  let dryScan = null;
  try { dryScan = scanW1Output(JSON.parse(String(dryPromptRaw))); } catch { dryScan = null; }
  report.dryW1Scan = dryScan;
  check("B0 文证在场·干跑: 排队图 prompt 含收束句节点项(值锚)+拼接×3+剥离件在场",
    !!dryScan && w1EvidenceOk(dryScan),
    dryScan ? `sentNode=${dryScan.sentNode} concat=${dryScan.concatNodes.join(",")} strip=${dryScan.stripNode} literalIds=${JSON.stringify(dryScan.literalIds)}` : String(dryPromptRaw).slice(0, 200));
  if (!dryScan || !w1EvidenceOk(dryScan)) throw new EnvError(`文证在场·干跑腿失败: ${JSON.stringify(dryScan)}`);

  const SKIP = new Set((process.env.SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const shot of SHOTS) {
    if (SKIP.has(shot.key)) { log(`(skip ${shot.key})`); continue; }
    const pr = { ...shot, startedAt: new Date().toISOString() };
    report.shots[shot.key] = pr;
    log(`\n════════ ${shot.key}: 型=${shot.type} RGBA=${shot.rgba} PE=${shot.pe} seed=${shot.seed} 门=${shot.gate}(零注入直跑) ════════`);
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

      // ── 源④:干跑排队图摘要(面板值直通证) ──
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

      // ── 文证在场·真跑腿(history prompt[2] 排队图;值锚防装载重编号) ──
      let histScan = null;
      try { histScan = scanW1Output(JSON.parse(hist.promptBlob)); } catch { histScan = null; }
      pr.histW1Scan = histScan;
      check(`[${shot.key}] 文证在场·真跑: 排队图 prompt 含收束句节点项(值锚)+拼接×3+剥离件在场`,
        !!histScan && w1EvidenceOk(histScan),
        histScan ? `sentNode=${histScan.sentNode} concat=${histScan.concatNodes.join(",")} strip=${histScan.stripNode} literalIds=${JSON.stringify(histScan.literalIds)}` : "blob 解析失败");

      // ── 产物落盘 + PIL alpha 程序验证(第一路,校准口径判定件) ──
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
          check(`[${shot.key}] PIL alpha(校准口径): IHDR色型=${alpha.ihdr.color_type} PIL=${alpha.pil_mode} 尺寸=${alpha.ihdr.w}x${alpha.ihdr.h} 四角=[${corners}] 全透占比=${pct.toFixed(2)}%${shot.expect === "transparent" ? (band7690 ? "(带内76-90)" : "(带外76-90,记录不阻断)") : ""}`,
            alpha.pass, `全透px=${m.transparentPx}/${m.totalPx} 半透占比=${(m.ratioSemi * 100).toFixed(2)}% alpha[min=${m.alphaMin},max=${m.alphaMax},mean=${m.alphaMean}] 判定=${alpha.verdict}`);
        }
      }

      // ── 最终文本([27] 装配预览)取证+存盘+md5 对照(B7)+分型主路文证 ──
      const textVals = Object.values(hist.texts || {}).flat().map(String);
      const finalText = textVals.find((t) => t.length > 40) || textVals[0] || "";
      pr.finalTextLen = finalText.length;
      pr.finalTextHead = finalText.slice(0, 300);
      pr.finalTextTail = finalText.slice(-200);
      if (finalText) { try { writeFileSync(join(OUT_DIR, `${shot.key}-finaltext.txt`), finalText); } catch { /* 尽力 */ } }
      if (finalText) {
        pr.finalTextMd5 = md5Of(finalText);
        const hit = md5LedgerHit(pr.finalTextMd5);
        pr.md5Compare = hit ? `${hit[1]}:${hit[0]}(B7 台账命中,同句定死成立)` : `new-variant(${pr.finalTextMd5.slice(0, 8)},len=${finalText.length}):PE 出文再添变体,如实记`;
        const hasSent = finalText.includes(SENT);
        const hasHead = finalText.includes(rgbaHead), hasTail = finalText.includes(rgbaTail);
        let bgHits = 0;
        try { bgHits = (finalText.toLowerCase().match(new RegExp(stripPattern, "g")) || []).length; } catch { bgHits = -1; }
        pr.textCheck = { hasW1Sentence: hasSent, hasOfficialHead: hasHead, hasOfficialTail: hasTail, bgSentenceHits: bgHits };
        if (shot.gate === "opaque-d7-text") {
          // P2 拍5(plan §三):强制关走带背景完整文——bgHits 在场+官方头尾不在场+收束句不在场
          check(`[${shot.key}] D7 主路文证: 带背景完整文(bgHits>0)+官方头尾不在场+收束句不在场(W1 只喂 [209].on_true,主路零沾)`,
            bgHits > 0 && !hasHead && !hasTail && !hasSent,
            `bgHits=${bgHits} head=${hasHead} tail=${hasTail} sent=${hasSent};len=${finalText.length} md5=${pr.finalTextMd5.slice(0, 8)} ${pr.md5Compare}`);
        } else {
          // 透明/人物拍:主路文本洁净(结构性:收束句只作用于 RGBA 编码支路);bgHits=信息项(主路未剥离如实保留)
          check(`[${shot.key}] 主路文本洁净: 最终文本无官方头尾+W1收束句不在场(收束句只作用于 RGBA 编码支路)`,
            !hasHead && !hasTail && !hasSent,
            `len=${finalText.length} md5=${pr.finalTextMd5.slice(0, 8)} bgHits=${bgHits}(信息项:主路未剥离如实保留) ${pr.md5Compare}`);
        }
      } else {
        check(`[${shot.key}] 最终文本取证([27]装配预览)`, false, "history 无 text 输出");
      }

      // ── 源①:socket tee 执行帧 ──
      const teeRaw = await page.ev(vis(`JSON.stringify(window.__tee || [])`));
      let teeArr = null; try { teeArr = JSON.parse(String(teeRaw)); } catch { /* null */ }
      const rec = teeArr ? teeFramesOf(teeArr, hist.pid) : null;
      const executedNodes = rec ? [...new Set([...rec.executed, ...rec.executing])] : [];
      pr.executedNodes = executedNodes;
      pr.frameStats = rec ? { executing: rec.executing.size, executed: rec.executed.size } : null;
      const sawFrames = !!rec && executedNodes.length > 0;
      check(`[${shot.key}] 源①socket tee 帧源活性`, sawFrames, rec ? `executing=${rec.executing.size}/executed=${rec.executed.size}` : "tee 未捕获该拍");
      if (sawFrames) {
        check(`[${shot.key}] PE 支路执行集成员资格: QwenImage21_T2IPromptRewrite=须在`, executedNodes.includes(NID.PERW) === true, `PERW=${NID.PERW}`);
        if (histScan?.sentNode) {
          const sentRan = executedNodes.includes(histScan.sentNode);
          pr.sentNodeInExec = sentRan;
          if (shot.gate === "transparent") {
            // 透明拍:W1 支路在执行集(收束句真进了生效文链)
            check(`[${shot.key}] W1 收束句节点执行集成员资格(${histScan.sentNode}=须在)`, sentRan === true, "");
          } else {
            // 人物/强制关拍:rgba 关→W1 支路懒旁路不进执行集=设计态,S10 第一轮断言未分型红的前科;
            // 记录不判(在场=异常信号如实注)
            log(`(info) [${shot.key}] W1 收束句节点执行集成员资格=${sentRan ? "在(rgba关拍=异常信号,如实注)" : "不在(懒旁路设计态,记录不判)"} node=${histScan.sentNode}`);
          }
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
  writeFileSync(join(OUT_DIR, "s10-p2-report.json"), JSON.stringify(report, null, 2));
}
function cleanup() {
  try { page?.close(); } catch { /* gone */ }
  killChrome();
}

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
log("════ S10 P2 回归补拍六拍汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(exitCode);
