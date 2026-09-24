#!/usr/bin/env node
/**
 * 九型 PE 实拍驱动(0924;用户令「必须要用提示词增强」;17002 手动引擎 + headless Chrome
 * 真前端;派生自 qi21_fullpower_live_0924.mjs CDP/loadGraphData/运行态改开关/queuePrompt 范式
 * + qi21_e2e_jiuxing_0923.mjs 九型逐拍范式)。
 *
 * 验什么(任务令「九型 PE 实拍」):
 *   qi21-道劫-t2i 在 17002 真前端,九型顺序(人物→场景→道具→美宣→三视图→高清人脸→
 *   分镜剧情图→表情差分→概念气氛图)各出 1 张,**PE 改写开关=true 开路**(提示词经 PE
 *   改写后才编码),同时 [30] 满血一拨(steps 链=6 + LoRA v0.2.1 在链)。
 *   每拍步骤(任务令口径):
 *     ① 运行态设 [40] 子图「型选择」combo=当前型;
 *     ② 运行态设 PE 改写开关=true;
 *     ③ 干跑 graphToPrompt 取证:40:150 base=当前型 + 40:141 switch=true +
 *        steps 链解析=6 + 懒执行集含 [31] LoRA 与 40:140 PE 节点(PE 链路开路);
 *     ④ queuePrompt→等出图(/history;GEN_TIMEOUT_MS 给足 1200000);
 *     ⑤ /history 取 PE 改写后文本(outputs["27"] easy showAnything text)前 80 字;
 *     ⑥ sips 尺寸 + PNG 魔数;落 ~/Downloads/q21-nine-pe-0924/{idx}-{型名}.png;
 *     ⑦ POST /free 后进下一型(防 MPS OOM)。
 *   引擎日志取证(每拍窗口):heretic 主 TE 加载行 + [MY出图][摘要](LoRA×1.0) +
 *   Prompt executed 秒数;PE 改写耗时=history messages 时间戳(executing 40:140 起→
 *   下一 executing 止)。
 *
 *   PE 种子(任务令未列,依 canon 自定并如实报备):PE 路提示词真源=[40] 子图内
 *   [140] QwenImage21_T2IPromptRewrite 的 prompt widget(装配链在 PE 开时被 [141] 旁路,
 *   04-道劫风格适配.md「开 PE 即由此扩写」)。每拍运行态把该 widget 设为
 *   「水墨国风修仙:」前缀(逐字=工作流自带样本种子前缀)+ 该型库主体句全文
 *   (docs/prompts/道劫_九型主体句示例.md §1-§9 原文)。型间内容差异由此而来
 *   (型选择另驱分辨率随型);否则九拍同种子只换画幅,无九型意义。
 *
 * 产物:~/Downloads/q21-nine-pe-0924/{1..9}-{型名}.png(按型名命名)+
 *   仓库 apps/out/q21-final-0924/nine-pe-driver-report.json。九宫格拼图与汇总表
 *   由驱动外的收官脚本写(nine-pe-grid.png / nine-pe-results.json)。
 *
 * 用法:node apps/build/scripts/qi21_nine_pe_0924.mjs all
 * 环境变量:ENGINE_URL(默认 http://127.0.0.1:17002)/ CDP_PORT(默认 9369)/
 *   GEN_TIMEOUT_MS(默认 1200000=20min;PE 改写+双 TE 加载,单拍 3-8 分钟量级)/
 *   ENGINE_LOG(默认 /tmp/qi21-ninepe-0924/engine.log)
 * 退出码 0=全绿;1=有失败项;2=环境错误。引擎生命周期与 pkill 在驱动外管理。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const execFileP = promisify(execFile);

const PHASE = process.argv[2] || "all";
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17002";
const CDP_PORT = Number(process.env.CDP_PORT || 9369);
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_200_000); // 20min/拍(任务令给足口径)
const ENGINE_LOG = process.env.ENGINE_LOG || "/tmp/qi21-ninepe-0924/engine.log";
const ENGINE_OUT = process.env.ENGINE_OUT || `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/output`;
const OUT_DIR = `${process.env.HOME}/Downloads/q21-nine-pe-0924`;                       // 图证目录(ask 指定)
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`; // 相位报告目录(ask 指定)
const WF = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE = "/tmp/qi21-ninepe-17002-profile";
const LORA_NAME = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors";
const HERETIC_TE = "qwen3vl_8b_bf16_heretic.safetensors";
const PE_TE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors";
const TOL_PX = 16; // 引擎 16 倍数 round-half-even 归整 ±8px(7842d6d 在档),给 16 余量

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
const runtimeWrites = []; // 运行态写入台账(铁证)
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ── canon 九型(顺序=任务令;主体句=docs/prompts/道劫_九型主体句示例.md §1-§9 原文;
      sig=主体句唯一指纹(排队图/PE 种子取证锚);dims=native_px 公式预期(三视图 override)── */
const SEED_PREFIX = "水墨国风修仙:"; // 逐字=工作流 [140] 自带样本种子前缀
const TYPES = [
  { idx: 1, name: "人物", sig: "她立于山门石阶最上一级", dims: [1816, 2424],
    subject: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，腰侧石青剑绦悬一柄长剑，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂暗红剑穗，剑身完整收在鞘中，右手轻按剑柄，视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。" },
  { idx: 2, name: "场景", sig: "九根断裂的石柱围成半圆", dims: [2800, 1576],
    subject: "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。" },
  { idx: 3, name: "道具", sig: "一柄传承千年的青铜剑", dims: [1024, 1024],
    subject: "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；细节特写一格聚焦剑身近格处的旧伤裂纹与缠绕其上的金色修补纹。" },
  { idx: 4, name: "美宣", sig: "雷劫降临的至暗时刻", dims: [3208, 1376],
    subject: "雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，周身剑气化作淡金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。" },
  { idx: 5, name: "三视图", sig: "横幅六格等分", dims: [3072, 1024],
    subject: "同一位青年刀修的角色转面设定板：横幅六格等分，从左到右依次为上半身像、正面全身、侧面全身、背面全身、正斜侧面全身、背斜侧面全身；第一格上半身像画面底缘止于腰部，其余五格皆为头顶至脚底的全身画像；各全身格同一自然站姿，双手拢袖，神情中性沉静，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中；玄色劲装束袖束腰，长发高束马尾，六格同一人。" },
  { idx: 6, name: "高清人脸", sig: "几缕碎发垂在颊边", dims: [1024, 1024],
    subject: "一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；头顶至锁骨、正面平视，神情沉静，柔和顶光勾勒面部立体轮廓。" },
  { idx: 7, name: "分镜剧情图", sig: "老船工收篙回望", dims: [2800, 1576],
    subject: "山雨欲来的渡口，老船工收篙回望，身后的少年修士第一次背起行囊离乡；乌云压江，渡口一盏灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。" },
  { idx: 8, name: "表情差分", sig: "九宫格表情差分", dims: [2096, 2096],
    subject: "同一位红衣女修的九宫格表情差分，九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；各格头部角度与光源方向保持一致。" },
  { idx: 9, name: "概念气氛图", sig: "灵潮涨落之夜", dims: [2800, 1576],
    subject: "千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在青蓝色灵光中，万千萤火状灵尘随气流缓缓升腾；画面九成留给静谧的夜与雾，只余殿群一角与一株横生孤松的剪影。" },
];
for (const t of TYPES) { t.seed = SEED_PREFIX + t.subject; t.file = `${t.idx}-${t.name}.png`; }

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
      consoleErrors.push({ src: "console", type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500), ts: new Date().toISOString() });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500), ts: new Date().toISOString() });
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    send,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 400);
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

/* ── 真前端工作流载入 + 运行态 widget 写(照 fullpower/jiuxing 范式)── */
async function loadWorkflow(page, wfJson, label) {
  const n = wfJson.nodes.length;
  const opened = await page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true) return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(wfJson)}, true, true, ${JSON.stringify(label)});
    return 'opened';
  })()`);
  await waitFor(() => page.ev(vis(`window.app.graph && window.app.graph._nodes.length === ${n} ? ${n} : null`)),
    { timeout: 40_000, interval: 1000, label: `画布切换(${n} 节点)` });
  await sleep(1500);
  return opened;
}

/** 运行态设顶层节点 widget(按节点 type 寻址;型选择/PE 开关在 [40] 子图宿主节点上) */
function setHostWidget(page, sgType, wname, value) {
  runtimeWrites.push({ where: `[40]面板`, widget: wname, value: typeof value === "string" ? value.slice(0, 40) + (value.length > 40 ? "…" : "") : value, ts: new Date().toISOString() });
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!n) return 'node-missing';
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:' + w.name + '=' + String(w.value).slice(0, 60);
  })()`);
}

/** 运行态设顶层节点 widget(按数字 id 寻址,如 [30] 开关源) */
function setWidgetById(page, nid, wname, value) {
  runtimeWrites.push({ where: `[${nid}]`, widget: wname, value, ts: new Date().toISOString() });
  return page.ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === String(${nid}));
    if (!n) return 'node-missing:' + ${nid};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:[' + n.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value);
  })()`);
}

/** 运行态设子图内节点 widget([40] 子图内 [140] PE 种子;经宿主 subgraph 内节点表寻址) */
function setSubgraphInnerWidget(page, sgType, innerId, wname, value) {
  runtimeWrites.push({ where: `[40]内[140]`, widget: wname, value: String(value).slice(0, 40) + "…", ts: new Date().toISOString() });
  return page.ev(`(() => {
    const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!host) return 'host-missing';
    const sg = host.subgraph || (host.graph && host.graph.subgraph) || null;
    const nodes = sg ? (sg._nodes || sg.nodes) : null;
    if (!nodes) return 'no-inner-nodes:' + Object.keys(host).filter(k => /sub|graph/i.test(k)).join(',');
    const inner = nodes.find(m => String(m.id) === String(${JSON.stringify(innerId)}));
    if (!inner) return 'inner-missing:' + nodes.map(m => String(m.id)).join(',').slice(0, 300);
    if (!inner.widgets) return 'inner-no-widgets:' + inner.type;
    const w = inner.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + inner.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* 可选 */ }
    return 'set:inner[' + inner.id + ']' + ${JSON.stringify(wname)} + '=' + String(w.value).slice(0, 40);
  })()`);
}

async function dryRun(page) {
  const raw = await page.ev(`(async () => {
    try { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output || {}); }
    catch (e) { return 'err:' + e.message; }
  })()`);
  if (String(raw).startsWith("err:") || String(raw).startsWith("EXC:")) return { error: String(raw) };
  return { blob: String(raw) };
}
function parseBlob(blob) { try { return JSON.parse(blob); } catch { return null; } }

/* ── 排队图解析(steps 链=fullpower 同款谓词;懒执行走查=SaveImage 回溯)──
   勘正(本轮实录):子图内开关(40:141/40:144/40:157/40:158)的 switch 在排队图是
   **字面布尔**(外露 widget 展开值,非连线);顶层 [32]/[177] 才是 PrimitiveBoolean
   连线。resolveSwitchBool 须两态都认,缺 switch 概念时不剪枝。 */
function resolveSwitchBool(d, node) {
  const sw = node.inputs?.switch;
  if (Array.isArray(sw)) {
    const src = d[sw[0]];
    if (src?.class_type === "PrimitiveBoolean") return Boolean(src.inputs?.value);
    return true; // 连线在而源不可解——保守走 true 臂(不剪枝)
  }
  if (typeof sw === "boolean") return sw; // 子图外露开关=字面布尔
  return true; // 无 switch 概念——不剪枝
}
function resolveSteps(d) {
  const ks = d["7"];
  if (!ks || ks.class_type !== "KSampler") return { err: "KSampler 不在排队图" };
  const steps = ks.inputs?.steps;
  if (!Array.isArray(steps)) return { err: `KSampler.steps 非链接(${JSON.stringify(steps)})` };
  const sw = d[steps[0]];
  if (!sw || sw.class_type !== "ComfySwitchNode") return { err: "steps 上游非 ComfySwitchNode" };
  const on = resolveSwitchBool(d, sw);
  const arm = on ? sw.inputs?.on_true : sw.inputs?.on_false;
  if (!Array.isArray(arm)) return { err: `steps 开关 ${on ? "on_true" : "on_false"} 臂非链接` };
  const c = d[arm[0]];
  if (!c || c.class_type !== "PrimitiveInt") return { err: "steps 臂上游非 PrimitiveInt" };
  return { value: c.inputs?.value, on };
}
function executedSet(d) {
  const reach = new Set();
  const stack = ["9"]; // [9] SaveImage
  while (stack.length) {
    const nid = stack.pop();
    if (reach.has(nid) || !d[nid]) continue;
    reach.add(nid);
    const node = d[nid];
    if (node.class_type === "ComfySwitchNode") {
      const on = resolveSwitchBool(d, node);
      const arm = on ? node.inputs?.on_true : node.inputs?.on_false;
      if (Array.isArray(arm)) stack.push(String(arm[0]));
      continue;
    }
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v)) stack.push(String(v[0]));
    }
  }
  return reach;
}

/** 干跑取证(任务令③):型=当前型 + PE 开关=true + steps=6 + LoRA 在链 + PE 节点在执行集 */
function forensicsDry(t, blob) {
  const d = parseBlob(blob);
  check(`[${t.idx}-${t.name}] 干跑排队图可解析`, Boolean(d), "");
  if (!d) return null;
  check(`[${t.idx}-${t.name}] ①型选择:40:150 base=${t.name}`,
    d["40:150"]?.class_type === "MyQi21DaojieBase" && d["40:150"]?.inputs?.base === t.name,
    JSON.stringify(d["40:150"]?.inputs));
  check(`[${t.idx}-${t.name}] ②PE 开关:40:141 switch=true(链路开路)`,
    d["40:141"]?.class_type === "ComfySwitchNode" && d["40:141"]?.inputs?.switch === true,
    JSON.stringify(d["40:141"]?.inputs?.switch));
  check(`[${t.idx}-${t.name}] PE 种子入图:40:140 prompt 含该型主体句指纹`,
    d["40:140"]?.class_type === "QwenImage21_T2IPromptRewrite" && String(d["40:140"]?.inputs?.prompt || "").includes(t.sig),
    `prompt 头60=${String(d["40:140"]?.inputs?.prompt || "").slice(0, 60)}`);
  const st = resolveSteps(d);
  check(`[${t.idx}-${t.name}] ③steps 链解析=6([30] 加速开)`, st.value === 6, JSON.stringify(st));
  const pb = d["30"];
  check(`[${t.idx}-${t.name}] [30] 开关源 value=true(一拨全配)`,
    pb?.class_type === "PrimitiveBoolean" && pb.inputs?.value === true, JSON.stringify(pb?.inputs));
  const reach = executedSet(d);
  check(`[${t.idx}-${t.name}] LoRA [31] 在懒执行集(LoraLoaderModelOnly 真入链)`,
    reach.has("31") && d["31"]?.class_type === "LoraLoaderModelOnly" && String(d["31"]?.inputs?.lora_name || "").includes(LORA_NAME),
    `lora_name=${JSON.stringify(d["31"]?.inputs?.lora_name)}`);
  check(`[${t.idx}-${t.name}] PE 节点 40:140 在懒执行集(PE 改写真执行,提示词经 PE 才编码)`,
    reach.has("40:140"), `executed 数=${reach.size}`);
  check(`[${t.idx}-${t.name}] 主编码 40:142 prompt 接 40:141(PE 输出进编码)`,
    JSON.stringify(d["40:142"]?.inputs?.prompt) === JSON.stringify(["40:141", 0]),
    JSON.stringify(d["40:142"]?.inputs?.prompt));
  check(`[${t.idx}-${t.name}] 画幅联动关:40:157/40:158 switch=false(九型随型分辨率)`,
    d["40:157"]?.inputs?.switch === false && d["40:158"]?.inputs?.switch === false,
    `宽开关=${JSON.stringify(d["40:157"]?.inputs?.switch)} 高开关=${JSON.stringify(d["40:158"]?.inputs?.switch)}`);
  return { base: d["40:150"]?.inputs?.base, peSwitch: d["40:141"]?.inputs?.switch, steps: st.value, peInExecuted: reach.has("40:140"), loraInExecuted: reach.has("31"), dryBlob: blob };
}

/* ── 服务端 history 轮询 + 逐节点耗时(messages 时间戳)── */
async function waitHistory(feature, { timeout, knownPids = new Set() }) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const blob = JSON.stringify(e.prompt?.[2] || {});
        if (!feature(blob, pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 6000)}` };
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        if (imgs.length) return { pid, imgs, status: st, promptBlob: blob, outputs: e.outputs, messages: e.status?.messages || [] };
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}
/** messages(带时间戳)→ 关键节点耗时:40:140(PE 改写)与 40:142(主编码)/7(KSampler)起止 */
function nodeDurations(messages) {
  const events = [];
  for (const m of (messages || [])) {
    if (!Array.isArray(m) || m[0] !== "executing") continue;
    const v = m[1] || {};
    if (v.node === undefined && v.display_node_id === undefined) continue;
    events.push({ node: String(v.node ?? v.display_node_id), ts: v.timestamp });
  }
  const dur = {};
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    if (!next) continue;
    if (cur.node === "null" || cur.node === "undefined") continue;
    if (cur.ts && next.ts && (dur[cur.node] === undefined)) {
      dur[cur.node] = (next.ts - cur.ts) / 1000;
    }
  }
  return dur;
}
function execDurationSec(messages) {
  let start = null, end = null;
  for (const m of (messages || [])) {
    if (!Array.isArray(m)) continue;
    if (m[0] === "execution_start" && m[1]?.timestamp) start = m[1].timestamp;
    if (m[0] === "execution_success" && m[1]?.timestamp) end = m[1].timestamp;
  }
  return start && end ? ((end - start) / 1000).toFixed(0) : null;
}

async function freeEngine() {
  try {
    await fetch(`${ENGINE}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    log("POST /free(拍间清场)");
  } catch (e) { log("/free 失败(非致命):", e.message); }
}

/* ── 文件级取证(禁视觉读图):PNG 魔数 + sips 尺寸 ── */
function pngMagicBuf(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
async function sipsSize(path) {
  try {
    const { stdout } = await execFileP("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    return { w: Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]) };
  } catch (e) { return { err: String(e.message) }; }
}
async function fetchViewRetry(img, outPath, tries = 3) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${ENGINE}/view?${q}`, { signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`/view ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(outPath, buf);
      return buf;
    } catch (e) { lastErr = String(e.message); log(`fetch /view 第${i}拍失败:`, lastErr); await sleep(2000); }
  }
  throw new Error(`fetch /view 三拍皆败: ${lastErr}`);
}

/* ── 引擎日志窗口取证:每拍记 offset,拍后从窗口内取 heretic 加载/摘要/Prompt executed ── */
function logSize() { try { return require("node:fs").statSync(ENGINE_LOG).size; } catch { return 0; } }
function logWindow(from) {
  try {
    const fd = require("node:fs").openSync(ENGINE_LOG, "r");
    const len = Math.max(0, logSize() - from);
    const buf = Buffer.alloc(len);
    require("node:fs").readSync(fd, buf, 0, len, from);
    require("node:fs").closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}

/* ══════════ 一拍:①型选择 ②PE 开 ③干跑取证 ④排队出图 ⑤PE 文本 ⑥落盘取证 ⑦/free ══════════ */
async function shot(page, sgType, wfJson, t, report) {
  const tag = `${t.idx}-${t.name}`;
  const outPath = join(OUT_DIR, t.file);
  const caseData = { tag, type: t.name, idx: t.idx, seedHead: t.seed.slice(0, 60) };

  // ① 型选择 combo=当前型(运行态)
  const r1 = await setHostWidget(page, sgType, "型选择", t.name);
  check(`[${tag}] ①运行态设 [40]「型选择」=${t.name}`, String(r1) === `set:型选择=${t.name}`, String(r1));
  // ② PE 改写开关=true(运行态;每拍重申,幂等)
  const r2 = await setHostWidget(page, sgType, "PE改写开关", true);
  check(`[${tag}] ②运行态设 PE 改写开关=true`, String(r2) === "set:PE改写开关=true", String(r2));
  // PE 种子=[140] prompt widget ← 前缀+该型库主体句(canon;报备在案)
  const r3 = await setSubgraphInnerWidget(page, sgType, "140", "prompt", t.seed);
  const seedSetRuntime = String(r3).startsWith("set:inner");
  log(`[${tag}] PE 种子写入(${seedSetRuntime ? "运行态子图内节点" : "回退:重载改种 JSON"}):`, String(r3).slice(0, 120));
  await sleep(1000);

  // ③ 干跑取证(运行态子图内寻址失败/干跑异常 → 回退:重载改种 JSON,等价效果并报备)
  let dry = await dryRun(page);
  if (!seedSetRuntime || dry.error) {
    const patched = JSON.parse(JSON.stringify(wfJson));
    for (const n of patched.nodes) {
      if (String(n.id) === "40") { n.widgets_values[1] = t.name; n.widgets_values[2] = true; }
      if (String(n.id) === "30") n.widgets_values = [true];
    }
    const sg = patched.definitions.subgraphs[0];
    for (const n of sg.nodes) if (String(n.id) === "140") n.widgets_values[0] = t.seed;
    const opened = await loadWorkflow(page, patched, `qi21-九PE-${t.name}`);
    check(`[${tag}] 回退:改种 JSON 重载(loadGraphData)`, opened === "opened", String(opened));
    const r30 = await setWidgetById(page, 30, "value", true);
    check(`[${tag}] 回退后 [30]=true 重申`, String(r30).startsWith("set:"), String(r30));
    await sleep(1000);
    dry = await dryRun(page);
  }
  check(`[${tag}] ③干跑 graphToPrompt 成功`, !dry.error, dry.error || `${(dry.blob || "").length} 字符`);
  if (!dry.error) caseData.dry = forensicsDry(t, dry.blob);
  if (dry.error) { await freeEngine(); caseData.error = "干跑失败:" + dry.error; return caseData; }

  // ④ queuePrompt → 等出图(签名=种子指纹+PE 开+开关源 true)
  const sig = (blob) => {
    const d = parseBlob(blob);
    return Boolean(d) && d["40:140"]?.class_type === "QwenImage21_T2IPromptRewrite"
      && String(d["40:140"]?.inputs?.prompt || "").includes(t.sig)
      && d["40:141"]?.inputs?.switch === true && d["30"]?.inputs?.value === true;
  };
  const knownPids = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await sleep(600);
  const logOff = logSize();
  const t0 = Date.now();
  const queued = await page.ev(`(async () => {
    const app = window.app;
    if (!app || typeof app.queuePrompt !== 'function') return 'no-queuePrompt';
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check(`[${tag}] ④queuePrompt 发出(真前端序列化+排队)`, queued === "queued", String(queued));
  if (queued !== "queued") { caseData.error = "queuePrompt 失败:" + queued; await freeEngine(); return caseData; }

  const hist = await waitHistory(sig, { timeout: GEN_TIMEOUT, knownPids });
  const wallSecs = ((Date.now() - t0) / 1000).toFixed(0);
  caseData.wallSecs = wallSecs;
  if (hist.error) {
    check(`[${tag}] 引擎出图(/history 完成含图)`, false, `${hist.error.slice(0, 600)}(${wallSecs}s)`);
    caseData.error = hist.error.slice(0, 600);
    await freeEngine();
    return caseData;
  }
  caseData.pid = hist.pid;
  const execSecs = execDurationSec(hist.messages);
  const durations = nodeDurations(hist.messages);
  caseData.execSecs = execSecs;
  caseData.peNodeSecs = durations["40:140"] !== undefined ? durations["40:140"].toFixed(0) : null;
  caseData.encodeSecs = durations["40:142"] !== undefined ? durations["40:142"].toFixed(0) : null;
  caseData.samplerSecs = durations["7"] !== undefined ? durations["7"].toFixed(0) : null;
  caseData.nodeDurations = durations;
  check(`[${tag}] 引擎执行成功(execution_success;墙钟 ${wallSecs}s/执行段 ${execSecs ?? "?"}s)`,
    JSON.stringify(hist.messages).includes("execution_success"),
    `PE 节点=${caseData.peNodeSecs ?? "?"}s 主编码=${caseData.encodeSecs ?? "?"}s 采样=${caseData.samplerSecs ?? "?"}s`);

  // 服务端排队图复核(执行的就是验过的)
  const hd = parseBlob(hist.promptBlob);
  check(`[${tag}] 服务端排队图:40:150 base=${t.name} + 40:141 switch=true + 40:140 种子指纹`,
    hd?.["40:150"]?.inputs?.base === t.name && hd?.["40:141"]?.inputs?.switch === true && String(hd?.["40:140"]?.inputs?.prompt || "").includes(t.sig),
    `base=${JSON.stringify(hd?.["40:150"]?.inputs?.base)} switch=${JSON.stringify(hd?.["40:141"]?.inputs?.switch)}`);
  const hst = hd ? resolveSteps(hd) : { err: "排队图不可解析" };
  check(`[${tag}] 服务端排队图 steps 链解析=6`, hst.value === 6, JSON.stringify(hst));
  const hReach = hd ? executedSet(hd) : new Set();
  check(`[${tag}] 服务端排队图懒执行集含 40:140 PE+[31] LoRA(执行的就是验过的)`,
    hReach.has("40:140") && hReach.has("31"), `executed 数=${hReach.size}`);
  check(`[${tag}] 服务端排队图 LoRA 字段(${LORA_NAME})`,
    hd?.["31"]?.class_type === "LoraLoaderModelOnly" && String(hd?.["31"]?.inputs?.lora_name || "").includes(LORA_NAME),
    JSON.stringify(hd?.["31"]?.inputs?.lora_name));
  caseData.serverQueueBlob = hist.promptBlob;

  // ⑤ PE 改写后文本(outputs["27"] easy showAnything text)前 80 字
  let peText = null;
  {
    const texts = [];
    for (const [nid, o] of Object.entries(hist.outputs || {})) {
      if (o && Array.isArray(o.text)) for (const x of o.text) texts.push({ nid, text: String(x) });
    }
    texts.sort((a, b) => b.text.length - a.text.length);
    peText = texts[0]?.text ?? null;
    caseData.showAnythingNode = texts[0]?.nid ?? null;
  }
  check(`[${tag}] ⑤PE 改写后文本捕获([27] showAnything 服务端执行值)`,
    Boolean(peText) && peText.length > 40 && !peText.includes(t.sig),
    peText ? `长度=${peText.length} 字符;前80=${peText.slice(0, 80)}` : "history outputs 无 text");
  caseData.peTextHead80 = peText ? peText.slice(0, 80) : null;
  caseData.peTextLen = peText ? peText.length : 0;
  writeFileSync(join(OUT_DIR, `${t.idx}-pe-rewritten.txt`), peText || "(未捕获)");

  // ⑥ 落盘取证:PNG 魔数 + sips 尺寸(对型档预期,±16px 容差)
  const saveImg = hist.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || hist.imgs[0];
  const buf = await fetchViewRetry(saveImg, outPath);
  caseData.image = outPath;
  caseData.engineFile = saveImg.filename;
  caseData.bytes = buf.length;
  check(`[${tag}] ⑥PNG 魔数+体积合理(>50KB)`, pngMagicBuf(buf) && buf.length > 50_000, `${outPath}(${(buf.length / 1024).toFixed(0)}KB)`);
  const size = await sipsSize(outPath);
  caseData.size = size.err ? String(size.err) : `${size.w}x${size.h}`;
  const dw = Math.abs((size.w ?? 0) - t.dims[0]), dh = Math.abs((size.h ?? 0) - t.dims[1]);
  check(`[${tag}] sips 尺寸=${t.dims[0]}x${t.dims[1]}(型档预期,±${TOL_PX}px 容差)`,
    !size.err && dw <= TOL_PX && dh <= TOL_PX,
    size.err ? String(size.err) : `实际 ${size.w}x${size.h}(维差 ${dw}/${dh}px)`);

  // 引擎日志窗口取证:heretic TE 加载 + PE TE 加载 + 摘要(LoRA×1.0) + Prompt executed
  {
    const win = logWindow(logOff);
    const hereticLines = win.split("\n").filter((l) => l.includes(HERETIC_TE));
    const peTeLines = win.split("\n").filter((l) => l.includes(PE_TE));
    const digestLines = win.split("\n").filter((l) => l.includes("[MY出图][摘要]"));
    const digest = digestLines[digestLines.length - 1] || "";
    const execMatch = win.match(/Prompt executed in (\d+(?:\.\d+)?) seconds/g) || [];
    caseData.engineLog = {
      hereticLineCount: hereticLines.length,
      hereticSample: hereticLines[0]?.slice(0, 200) || null,
      peTeLineCount: peTeLines.length,
      digest: digest.slice(0, 400),
      promptExecuted: execMatch.map((s) => s.match(/(\d+(?:\.\d+)?) seconds/)?.[1]),
    };
    check(`[${tag}] 引擎日志窗口含 heretic 主 TE 加载行`,
      hereticLines.length > 0, hereticLines[0]?.slice(0, 160) || "窗口内无该行");
    check(`[${tag}] 引擎日志窗口含 PE TE(${PE_TE.slice(0, 24)}…)加载行`,
      peTeLines.length > 0, peTeLines[0]?.slice(0, 160) || "窗口内无该行");
    check(`[${tag}] 引擎日志[摘要]含 LoRA v0.2.1 ×1.0`,
      digest.includes(LORA_NAME) && digest.includes("×1.0"), digest.slice(0, 240));
    check(`[${tag}] 引擎日志 Prompt executed(${execMatch.length} 条)`,
      execMatch.length > 0, execMatch.join(" | "));
  }

  // ⑦ 拍间清场
  await freeEngine();
  return caseData;
}

async function main() {
  if (PHASE !== "all") { console.error("用法: node qi21_nine_pe_0924.mjs all"); process.exit(2); }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: PHASE, engine: ENGINE, wf: WF, startedAt: new Date().toISOString(), genTimeoutMs: GEN_TIMEOUT, engineLog: ENGINE_LOG, cases: [] };

  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  const wfJson = JSON.parse(readFileSync(WF, "utf8"));
  const sgType = wfJson.definitions.subgraphs[0].id; // [40] 宿主 type=子图 UUID

  launchChrome();
  const page = await getPageClient();
  await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  check("真前端就绪(app.isGraphReady,Chrome 开引擎前端)", true);

  const opened = await loadWorkflow(page, wfJson, "qi21-道劫-t2i-九型PE实拍");
  check("工作流载入(真前端 loadGraphData)", opened === "opened", String(opened));

  // 满血一拨:[30]=true(steps 自动 6 + LoRA 挂链)——九拍全程保持(任务令③口径)
  const r30 = await setWidgetById(page, 30, "value", true);
  check("[全局] [30]=true 满血一拨(steps 链=6+LoRA 在链,九拍保持)", String(r30).startsWith("set:"), String(r30));

  // 子图内节点寻址探测(回退判据用)
  const probe = await page.ev(vis(`(() => {
    const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(sgType)});
    if (!host) return 'host-missing';
    const sg = host.subgraph || (host.graph && host.graph.subgraph) || null;
    const nodes = sg ? (sg._nodes || sg.nodes) : null;
    if (!nodes) return 'no-inner-nodes';
    return 'inner-count:' + nodes.length;
  })()`));
  log("[探测] 子图内节点寻址:", String(probe));
  check("子图内节点可寻址(运行态写 PE 种子路)", String(probe).startsWith("inner-count:"), String(probe));

  for (const t of TYPES) {
    report.cases.push(await shot(page, sgType, wfJson, t, report));
    await sleep(1200);
  }

  report.results = results;
  report.runtimeWrites = runtimeWrites;
  report.consoleErrors = consoleErrors;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, "nine-pe-driver-report.json"), JSON.stringify(report, null, 2));
  page.close();
  killChrome();
  log("════ 汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 200)}` : ""}`);
  if (consoleErrors.length) log(`⚠ 前端 console 错误 ${consoleErrors.length} 条(R26 口径=报备不计红)`);
  const allPass = results.every((r) => r.pass);
  log(allPass ? "✅ 九型 PE 实拍 全绿" : "❌ 存在失败项");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("驱动失败:", e.message);
  try { writeFileSync(join(REPORT_DIR, "nine-pe-driver-report.json"), JSON.stringify({ fatal: String(e.message), results, consoleErrors, runtimeWrites }, null, 2)); } catch { /* best effort */ }
  killChrome();
  process.exit(1);
});
