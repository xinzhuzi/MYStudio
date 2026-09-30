#!/usr/bin/env node
/**
 * B4 对拍发3 驱动器(0930,配方=b4_duipai_plan_0930.md §二发3/§五):
 *   qi21 道劫多视图分张产线现役抽验——仓库真源 qi21-道劫-t2i.json 原样装载
 *   (loadGraphData 零注入),面板五控件设定(型选择=多视图/RGBA透明=跟随型/
 *   PE开关=开/速度档位=0·直出40步/seed=20260930)+主体句[24]=发1/2 角色(女面包师)
 *   的道劫画法转写(青珣示例句式+视图句字典「正」逐字),graphToPrompt 现读换算
 *   出 API prompt JSON → POST /prompt(API 直构面;引擎 userdata 零工作流落盘)。
 *
 * 干跑验 digest(工单令:实拍前先干跑验 digest——t2i 已含 S10 W1 收束句
 *   [215]/[216],收束句在剥离后拼接):①仓库 JSON 落盘预检([215]句身 md5+05 库
 *   逐字互锁+[216]/link51 改道/63/64 拓扑,S11 同款);②排队图含收束句节点项
 *   40:215+拼接×3+剥离件(scanW1Output 同款);③面板值直通(型/三态/档位/seed)。
 *   方案适配如实记:plan §二发3 原文「MyQi21DaojieBase combo=多视图+RGBA 开,
 *   3:4 4.2MP」——现役生产配置=S6 T2/S11 同款(跟随型+PE开+直出40步,0930 S11
 *   收束句条件下四型透明 4/4 关账口径),本轮照此拍,画幅由产线原生直出。
 *
 * 判定:b4_duipai_judge.py J6/J7(PIL 判据件)+本件并跑校准判定件
 *   qi21_s6_alpha_check_0930.py 第二路(0930 S11 校准:四角≤2+全透≥50%)。
 * 用法:node apps/build/scripts/b4_duipai_f3_0930.mjs
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17599)/CDP_PORT(默认 9384)。
 * 退出码:0=全绿;1=有失败项;2=环境错误;130=SIGINT。
 * 引擎生命周期在驱动外(引擎操作员);本驱动零改仓库工作流、零写引擎 userdata。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const CDP_PORT = Number(process.env.CDP_PORT || 9384);
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/b4-duipai-0930`;
const ALPHA_CHECKER = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/b4-f3-chrome-profile";
const WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const LIB05 = `${REPO}/docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`;
const CLIENT_ID = "b4-duipai-0930-f3";

const ASM = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"; // [40] 装配子图 uuid(t2i)
const ACCEL = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"; // [208] 加速子图 uuid(t2i)
const SPEED_DIRECT = "0 · 直出40步";
const SEED = 20260930;
// 主体句=发1/2 角色(女面包师)道劫画法转写,青珣示例句式(05库 §5 例一句架:
// 身份段+服饰/发/配饰)+视图句字典「正」逐字(05库:131)。
const SUBJECT = "性情爽朗的年轻女修饼师，齐肩黑发剪出整齐刘海，戴圆银框眼镜，月白短襦束袖外系苔绿围裙，颈间系一枚小红方巾；画面为正面全身像，人物正身正对观者站立。";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 500)}` : ""}`);
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
    send, close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 600);
      return r.result.value;
    },
  };
}

async function waitFor(fn, { timeout = 60_000, interval = 1500, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(interval); }
  throw new Error(`waitFor 超时: ${label}`);
}

function setNodeWidget(page, nodeId, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === ${JSON.stringify(String(nodeId))} && n.type === 'PrimitiveStringMultiline');
    if (!n) return 'node-missing:24';
    const w = (n.widgets || []).find(w => String(w.name || '') === ${JSON.stringify(wname)}) || (n.widgets || [])[0];
    if (!w) return 'no-widgets';
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:' + String(w.value).slice(0, 40);
  })()`);
}
function setSGWidget(page, sgType, wname, value) {
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing';
    const w = (n.widgets || []).find(w => String(w.name || '') === ${JSON.stringify(wname)});
    if (!w) return 'widget-not-found:' + (n.widgets || []).map(x => x.name).join(',');
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

// ── 仓库真源原样读入(零改图);W1 落盘在场预检(S11 同款) ──
const wfJson = JSON.parse(readFileSync(WF, "utf8"));
const asmSg = wfJson.definitions.subgraphs.find((s) => s.id === ASM);
const innerByType = (t) => asmSg.nodes.filter((n) => n.type === t);
const rgbaHead = innerByType("StringConstant").find((n) => (n.title || "").includes("官方头句")).widgets_values[0];
const rgbaTail = innerByType("StringConstant").find((n) => (n.title || "").includes("官方尾句")).widgets_values[0];
const stripNode = innerByType("RegexReplace")[0];
const stripPattern = stripNode.widgets_values[1];
const w1Node = asmSg.nodes.find((n) => n.id === 215 && n.type === "StringConstant" && (n.title || "").includes("W1收束句"));
if (!w1Node) { console.error("W1 落盘预检失败:仓库 JSON 无 [215] W1收束句 StringConstant"); process.exit(2); }
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
console.log(`W1 落盘预检: [215]句身 md5=${SENT_MD5.slice(0, 8)} | 05库逐字一致=${SENT === libSent} | 拓扑=${landedOk ? "齐" : "缺"}`);
if (!landedOk || SENT !== libSent) { console.error("W1 落盘预检失败:拓扑或缺或 05 库句身漂移"); process.exit(2); }

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

const report = {
  mode: "b4-duipai-f3", engine: ENGINE, wf: WF,
  wfNote: "仓库真源原样装载(loadGraphData 零注入);prompt JSON=graphToPrompt 现读换算→POST /prompt",
  startedAt: new Date().toISOString(),
  panel: { 型选择: "多视图", RGBA透明: "跟随型", PE开关: true, 速度档位: SPEED_DIRECT, seed: SEED, 主体句: SUBJECT },
  planAdaptation: "plan §二发3 原文 combo=多视图+RGBA 开 3:4 4.2MP;现役生产配置=跟随型+PE开+直出40步(S6 T2/S11 同款,0930 收束句条件下四型透明 4/4 口径);画幅产线原生直出",
  constitution: { sentence: SENT, sentenceMd5: SENT_MD5, landedTopology: { link51: `${l51.origin_id}→${l51.target_id}.${l51.target_slot}`, link63: `${l63.origin_id}→${l63.target_id}.${l63.target_slot}`, link64: `${l64.origin_id}→${l64.target_id}.${l64.target_slot}` } },
  consts: { rgbaHead, rgbaTail, stripPatternLen: stripPattern.length },
};

class EnvError extends Error {}
let page = null;

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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    for (const cls of ["MyQi21DaojieBase", "MyQi21RgbaSelect", "MyQi21SpeedSelect", "QwenImage21_T2IPromptRewrite", "RegexReplace", "easy showAnything"]) {
      const r = await fetch(`${ENGINE}/object_info/${encodeURIComponent(cls)}`);
      check(`A0 节点注册核: ${cls}`, r.status === 200, `HTTP ${r.status}`);
    }
    const peObj = await (await fetch(`${ENGINE}/object_info/CLIPLoader`)).json();
    const peOk = (peObj.CLIPLoader?.input?.required?.clip_name?.[0] || []).includes("qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors");
    check("A0 环境: PE-T2I 权重在盘", peOk, "");
    launchChrome();
    page = await getPageClient();
    await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
      { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
    check("A0 引擎前端就绪", true);
    await sleep(2000);
    const opened = await page.ev(`(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true) return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'b4-duipai-f3');
      return 'opened';
    })()`);
    check("B0 t2i 工作流载入(仓库真源原样·零注入)", opened === "opened", String(opened));
    await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${wfJson.nodes.length} ? 'ready' : null`)),
      { timeout: 40_000, interval: 1000, label: "画布切换" });
    await sleep(1500);
  } catch (e) {
    throw new EnvError(`A0/B0 环境段失败: ${e && e.message}`);
  }

  // 面板六设定:主体句[24] + 五控件
  const sets = [];
  sets.push([`主体句[24]=${SUBJECT.slice(0, 18)}…`, await setNodeWidget(page, 24, "string", SUBJECT)]);
  sets.push([`型选择=多视图`, await setSGWidget(page, ASM, "型选择", "多视图")]);
  sets.push([`RGBA透明=跟随型`, await setSGWidget(page, ASM, "RGBA透明", "跟随型")]);
  sets.push([`PE开关=true`, await setSGWidget(page, ASM, "PE开关", true)]);
  sets.push([`速度档位=${SPEED_DIRECT}`, await setSGWidget(page, ACCEL, "速度档位", SPEED_DIRECT)]);
  sets.push([`seed=${SEED}`, await setSGWidget(page, ACCEL, "seed", SEED)]);
  report.panelSets = sets.map(([n, r]) => `${n}: ${r}`);
  check("宿主面板六控件设定", sets.every(([, r]) => String(r).startsWith("set:")),
    sets.map(([n, r]) => `${n}=${String(r).slice(0, 50)}`).join(" | "));

  // ── 干跑验 digest(工单令)──
  const dryPromptRaw = await page.ev(`(async () => { try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); } catch (e) { return 'ERR:' + (e && e.message); } })()`);
  let dryScan = null;
  try { dryScan = scanW1Output(JSON.parse(String(dryPromptRaw))); } catch { dryScan = null; }
  report.dryW1Scan = dryScan;
  check("干跑①: 排队图含收束句节点项(40:215 值锚)+拼接×3+剥离件在场", !!dryScan && w1EvidenceOk(dryScan),
    dryScan ? `sentNode=${dryScan.sentNode} concat=${dryScan.concatNodes.join(",")} strip=${dryScan.stripNode} literalIds=${JSON.stringify(dryScan.literalIds)}` : String(dryPromptRaw).slice(0, 200));

  const dryBase = String(await promptDigest(page, "MyQi21DaojieBase", ["base"]));
  const dryRgba = String(await promptDigest(page, "MyQi21RgbaSelect", ["mode"]));
  const drySel = String(await promptDigest(page, "MyQi21SpeedSelect", ["mode"]));
  const drySeed = String(await promptDigest(page, "PrimitiveInt", ["value"]));
  // [24] PrimitiveStringMultiline 的 widget 字段名=value(探针实证:graphToPrompt
  // 出 inputs.value 直通 40:130 装配拼接① string_a←["24",0];旧断言字段名误写
  // string 致 dry-② 假红,设置机制本身一直生效)
  const drySubj = String(await promptDigest(page, "PrimitiveStringMultiline", ["value"]));
  const dryKs = String(await promptDigest(page, "KSampler", ["steps"]));
  const dryOk = dryBase.includes('"base":"多视图"') && dryRgba.includes('"mode":"跟随型"')
    && drySel.includes(`"mode":"${SPEED_DIRECT}"`) && (drySeed.includes(`"value":${SEED},`) || drySeed.includes(`"value":${SEED}}`))
    && drySubj.includes(SUBJECT.slice(0, 12)) && dryKs.includes('"steps":40');
  check("干跑②: 面板值直通排队图(型=多视图/三态=跟随型/档位=直出40/steps=40/seed/主体句)", dryOk,
    `${dryBase.slice(0, 80)} ${dryRgba.slice(0, 60)} ${drySel.slice(0, 80)} ${dryKs.slice(0, 80)} ${drySeed.slice(0, 80)} subj=${drySubj.slice(0, 80)}`);
  report.dryDigest = { base: dryBase.slice(0, 120), rgba: dryRgba.slice(0, 80), sel: drySel.slice(0, 120), ks: dryKs.slice(0, 120), seed: drySeed.slice(0, 80), subject: drySubj.slice(0, 160) };
  if (!dryOk || !dryScan || !w1EvidenceOk(dryScan)) throw new EnvError("干跑验 digest 失败(不发实弹)");

  // ── 提交:捕获排队图 → POST /prompt(API 直构面)──
  const promptObj = JSON.parse(String(dryPromptRaw));
  writeFileSync(join(OUT_DIR, "f3-prompt.json"), JSON.stringify(promptObj, null, 1));
  const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  const resp = await (await fetch(`${ENGINE}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptObj, client_id: CLIENT_ID }),
  })).json();
  if (resp.node_errors && Object.keys(resp.node_errors).length) {
    check("f3 POST /prompt 受理", false, JSON.stringify(resp.node_errors).slice(0, 400));
    throw new EnvError("节点校验失败");
  }
  const pid = resp.prompt_id;
  check("f3 POST /prompt 受理(prompt JSON=graphToPrompt 现读换算)", !!pid, `pid=${String(pid).slice(0, 8)}`);
  report.pid = pid;

  // 轮询 history(PE 开路 40 步 4.2MP,上限 30 分钟)
  const t0 = Date.now();
  let entry = null;
  while (Date.now() - t0 < 1_800_000) {
    const h = await (await fetch(`${ENGINE}/history/${pid}`)).json();
    if (h[pid]) { entry = h[pid]; break; }
    await sleep(5000);
  }
  if (!entry) { check("f3 引擎执行完成", false, "history 30 分钟超时"); throw new Error("history 超时"); }
  const status = entry.status?.status_str || "";
  report.secs = ((Date.now() - t0) / 1000).toFixed(0);
  check("f3 引擎执行完成", status === "success", `status=${status} ${report.secs}s`);
  if (status !== "success") {
    report.statusMessages = entry.status?.messages;
  } else {
    const imgs = [];
    const texts = {};
    for (const [nid, o] of Object.entries(entry.outputs || {})) {
      if (o.images) imgs.push(...o.images);
      if (o.text) texts[nid] = o.text;
    }
    const saveImg = imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || imgs[0];
    report.engineFile = saveImg;
    const buf = await fetchView(saveImg, join(OUT_DIR, "f3.png"));
    check("f3 出图落盘(/view)", buf.length > 50_000, `${saveImg.filename} ${(buf.length / 1024).toFixed(0)}KB`);
    // 第二路 PIL:校准判定件(S11 校准口径)
    const alpha = await alphaCheck(join(OUT_DIR, "f3.png"), "transparent");
    report.alphaChecker = alpha;
    const m = alpha?.metrics;
    if (m) {
      check("f3 校准判定件(第二路): 四角≤2+全透≥50%", alpha.pass === true,
        `corners=${m.corners.tl},${m.corners.tr},${m.corners.bl},${m.corners.br} ratio0=${(m.ratioAlpha0 * 100).toFixed(2)}% verdict=${alpha.verdict}`);
    } else {
      check("f3 校准判定件(第二路)", false, JSON.stringify(alpha).slice(0, 300));
    }
    // finaltext 取证([27] 装配预览;收束句按 S10 §9.6 边界注=结构性无显示捕获位,只记录不判)
    const textVals = Object.values(texts).flat().map(String);
    const finalText = textVals.find((t) => t.length > 40) || "";
    report.finalTextLen = finalText.length;
    if (finalText) writeFileSync(join(OUT_DIR, "f3-finaltext.txt"), finalText);
    report.finalTextHead = finalText.slice(0, 200);
    report.finalTextHasSubject = finalText.includes("女修饼师");
  }
}

function writeReport() {
  report.results = results;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT_DIR, "f3-record.json"), JSON.stringify(report, null, 2));
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
log("════ f3 汇总 ════");
for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}`);
process.exit(exitCode);
