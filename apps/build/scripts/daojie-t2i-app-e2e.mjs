#!/usr/bin/env node
/**
 * 道劫 t2i App级出图回归E2E —— 常驻测试工作流(2026-09-30 立,Trellis 09-30-daojie-t2i-app-e2e)。
 *
 * 用户令固化的链路(原话):打开项目 → 进入道劫子项目 → 打开 ComfyUI 界面 →
 * 关闭所有的界面 → 重新打开 qi21-道劫-t2i → 测试出图。
 * 步骤段:S0 预检/prekill/选口 → S1 启动装机应用 → S2 道劫项目 →
 *   S3 本地模型画布(引擎幂等 ensure)→ S4 关闭全部工作流标签 →
 *   S5 漫影侧栏重开 qi21-道劫-t2i → S6 真前端 queuePrompt 出图(纯默认)→
 *   S6b 装配全文进 PE 硬闸(Q1=B+:装配器参数对拍+排队图 40:140.prompt=装配全文,真出图)→
 *   S7 收摊+报告。全链双拍(S6+S6b)≈50-65min(次拍模型已热,采样各 ≈23-30min)。
 *
 * 骨架=cdp-daojie-krea2-ink-e2e.mjs(0915 役;踩坑注释原样继承:webview 不进
 * /json/list 须走主 target executeJavaScript、注入每段≤10 行防 IPC 竞态、
 * persist 缓存旧 sidebar.js 须 reloadIgnoringCache、装机 smoke 残留抢 9222、
 * CDP 截图偶发空数据原生兜底);断言层=装机 App 的 qi21-道劫-t2i 真源
 * (装机 Resources backend 树,S0 动态解析,零硬编码节点数/控件值)。
 *
 * [扩展协议] 后续测试点=段内加 check("点名",断言) 或插新段(段=async 函数,
 * main() 按序 await);拨控件/入子图参考 qi21_s3_gate_0930.mjs 已证形态
 * (宿主面板语义寻址/真实双击入图改内件值;S6b 已内置程序化 setGraph 入图形态);
 * 画质判据(borderSAT/GLM)归战役域不进本链;第二批(S6b+加固四条+装机面漂移
 * 软提醒)规格=.trellis/tasks/09-30-daojie-t2i-e2e-pt2/design.md,锚点字典=
 * .trellis/tasks/archive/2026-09/09-30-daojie-t2i-app-e2e/research/anchors.md。
 *
 * 环境变量:CDP_PORT(默认自选 9222-9239 空闲口;9222 常被并行探针 Chrome
 *   占用,禁杀别人)/GEN_TIMEOUT_MS(默认 3_600_000=60min,0930 实测 40步+PE≈30-35min 口径)/
 *   SKIP_GEN=1 免生图段(连 S6+S6b 两拍一起跳,链路调试)/SKIP_PE=1 只跳 S6b/KEEP_APP=1 收摊保留应用。
 * 退出码:0=全过;1=有失败项;2=环境错误。
 * 产物:apps/output/daojie-t2i-app-e2e/(report.json+t2i-result.png+t2i-result-pe.png);
 *   截图/中间件 /tmp/daojie-t2i-e2e/。
 *
 * [1001 S8 适配(Trellis 10-01-qi21-assembly-blueprint S8 L2-2 步骤10)]
 *   子图名锚 includes("装配")→includes("提示词类型优化")(Part-A S1 改名);S6/S6b
 *   随 Q1=B+ 换语义:[140].prompt=装配器 MyQi21PromptAssembly「装配全文」输出直喂
 *   (主体句+BASE+美术风格底座),种子文 widget 清空退役(摆设)——旧「程序化改种子=前缀+
 *   主体句」硬闸机制失效,新硬闸=装配器参数面美术风格底座逐字对拍+排队图 40:140.prompt
 *   链化判据(1001 装机红修:API 排队图不内联连线文本,prompt=引用 [装配器,0]——
 *   判 PE←装配器口0 直喂且构词三段在场,旧「字面含双特征头」恒 false;1005 退役:
 *   管线重序后PE只吃主体句,判据改 PE开关口0,见 [1005] 块);panel40
 *   期望集零变(§10.7 子图 inputs 仍 8 口)。
 *
 * [1002 大轮终态适配(Trellis 10-01-qi21-usetest-batch implement 步骤10)]
 *   design §1 编号重排+§2 六手术后的终态面:①宿主/主体句全动态寻址(宿主 type=
 *   子图 uuid、主体句 type=PrimitiveStringMultiline,旧 [40]/[208]/[24] id 锚废);
 *   ②子图名锚 includes("提示词类型优化")命中新名「[6] 文本提示词类型优化子图」;
 *   ③panel 期望集=宿主 node.inputs widget 条目(含 ㉑ 提升控件 PE启用?/透明/手动宽高
 *   六控件新面板序,Q3 裁定);④S6 排队图三断言域前缀改 truth.accDomain(旧硬编码
 *   "208:" 废,加速宿主重排 [7],键形 "7:7010" 系;S6b 本就动态)。
 *   默认档随 ⑱=「0 · Fun-Acc 4步」(truth.speedMode 自装机面现读,零硬编码)。
 *
 * [1003 S6b 缓存盲区修(破缓存)] S6(纯默认)与 S6b 两发排队输入全同 ⇒ ComfyUI 全节点
 *   缓存命中,3s 秒回不落新文件,S6b「output 目录新增」断言恒 FAIL(非 App 缺陷)。修=
 *   S6b 排队前加速宿主 seed widget +1(真用户重出图行为;PrimitiveInt 7014 control=
 *   'fixed' 两发间无人拨 seed 是根源),每发真出图,判据不弱化。
 *
 * [1005 D5 重锚(管线重序:主体句先过PE)] 装配子图重序后 PE改写[4013].prompt 改吃
 *   PE开关 MyQi21PESwitch 口0「PE路主体句」(装机 JSON 子图 link#304 4012:0→4013:1;
 *   排队图实拍 6:4013.prompt=["6:4012",0]),PE开关.主体句←正向主体句边界(link#302
 *   -10:0→4012:0,排队图把子图边界内联为根级主体句件,实拍 ["400",0]);装配器[4011]
 *   在 PE 之后经 SubjectSelect 收文(link#317 4021:0→4011:2)。D5 peFedAssembly 旧
 *   「prompt=装配器口0直喂」判据整体退役(10-05 实弹 FAIL 实锤:引用非装配器装配
 *   全文口 6:4012:0→MyQi21PESwitch),新判据=①PE.prompt 引用PE开关口0;②正向主体句
 *   源含头18字;③构词三段改到装配器侧(BASE←型底座 MyQi21DaojieBase 口0 link#312+
 *   美术风格底座字面逐字=装机真源,739 字实拍对拍;旧「含头+>1000」魔数按 1001 时代 1174 字
 *   旧内容标定随重序废)。S6b captureOurShot peChain 判别同锚改 PE开关口0——
 *   1005 重锚:管线重序后PE只吃主体句。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.my.manying-studio";
const ENGINE_HOME = join(homedir(), "Library/Application Support/漫影工作室/comfyui");
const ENGINE_OUTPUT = join(ENGINE_HOME, "output");
// 装机 App 的 repo: 工作流真源(引擎 manifest.repo_workflows_dir=装机 backend 树;
// 与仓库 dirty 树可能分叉,断言恒以装机面为准——本测=装机产品回归)
const INST_T2I = "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
// D4 装机面漂移软提醒的对端:仓库树同名 t2i(仓库并行在改≠测试错,恒不设门)
const REPO_T2I = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const WF_REL = "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
const OUT_DIR = join(process.env.HOME, "Project/Github/MYStudio/apps/output/daojie-t2i-app-e2e");
const TMP = "/tmp/daojie-t2i-e2e";
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 3_600_000);
// 60min 口径=0930 首跑实测:PE 开直出 40 步@双 TE 驻留(MPS 内存压力)全链
// ≈30-35min(模型加载~8min+PE 改写 token 生成+采样 34s/it×40≈23min);与
// q21 战役驱动器同口径(其 GEN_TIMEOUT 亦 3_600_000)。SKIP_GEN 可免此段。
// 1001 S8 适配:implement S8 L2-2 步骤10 验收命令=「--skip-gen 干跑绿」(CLI flag),
// 原脚本只认 env(SKIP_GEN=1)——flag 与 env 同义化,免验收命令原样跑被忽略变全链实弹
const SKIP_GEN = process.env.SKIP_GEN === "1" || process.argv.includes("--skip-gen");
const SKIP_PE = process.env.SKIP_PE === "1" || process.argv.includes("--skip-pe"); // 只跳 S6b(SKIP_GEN=1 时两拍连跳,S6b 无独立成活路径)
const KEEP_APP = process.env.KEEP_APP === "1";
const CDP_PORT_ENV = Number(process.env.CDP_PORT || 0);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const step = (id, title) => log(`──── ${id} ${title} ────`);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
const results = [];
const consoleErrors = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── S0:装机 t2i 真源解析(全部断言值从此来,零硬编码) ──
function parseTruth() {
  const g = JSON.parse(readFileSync(INST_T2I, "utf8"));
  const sgs = g.definitions?.subgraphs || [];
  const asmSg = sgs.find((s) => String(s.name).includes("提示词类型优化")); // 1001 S8:Part-A S1 改名后的新名锚
  const accSg = sgs.find((s) => String(s.name).includes("加速"));
  if (!asmSg || !accSg) throw new Error(`装机 t2i 子图不全: ${sgs.map((s) => s.name).join(" | ")}`);
  // 1002 大轮编号重排适配:宿主/主体句全动态寻址(type/子图 uuid),新旧装机面通吃
  // (旧面=[40]/[208]/[24] id 锚已随 design §1 重排为 [6]/[7]/[400]——按 id 找必空)
  const host40 = g.nodes.find((n) => String(n.type) === String(asmSg.id)); // 装配宿主(主图 type=子图 uuid)
  const host208 = g.nodes.find((n) => String(n.type) === String(accSg.id)); // 加速宿主(同法)
  const ksDirect = accSg.nodes.find((n) => n.type === "KSampler" && n.widgets_values?.[2] === 40);
  const peNode = asmSg.nodes.find((n) => n.type === "MyQi21ApiPE"); // 1009 重锚:4013 ApiPE(官方 QwenImage21_T2IPromptRewrite 1006 起退役)
  const asmNode = asmSg.nodes.find((n) => n.type === "MyQi21美术风格底座"); // 1009 重锚:美术风格底座 参数面真源=4032 四件+协议文(独立 MyQi21PromptAssembly 已出 t2i 线,装配内置进 ApiPE)
  const save = g.nodes.find((n) => n.type === "SaveImage");
  const subjNode = g.nodes.find((n) => n.type === "PrimitiveStringMultiline"); // 主体句(大轮后 [400];主图唯一)
  if (!host40 || !host208 || !ksDirect || !peNode || !asmNode || !save || !subjNode) {
    throw new Error(`装机 t2i 关键件缺失: hostAsm=${!!host40} hostAcc=${!!host208} ks40=${!!ksDirect} pe=${!!peNode} asm=${!!asmNode} save=${!!save} subj=${!!subjNode}`);
  }
  // 宿主面板期望控件(1002 大轮适配):宿主 node.inputs 的 widget 型条目=面板全量
  // (含子图内件提升控件:PE启用?[4012]/透明/手动宽高——旧口径只算子图 IO widget 槽,
  // 提升控件不在 sg.inputs 会漏;旧「−已连线」过滤同废:面板控件本身可既连线又外露)
  const hostPanel = (sg, host) => {
    const fromHost = (host.inputs || []).filter((i) => i.widget).map((i) => i.name);
    if (fromHost.length) return fromHost;
    const linked = new Set((host.inputs || []).filter((i) => i.link !== null && i.link !== undefined).map((i) => i.name));
    return (sg.inputs || []).filter((i) => ["COMBO", "BOOLEAN", "INT", "STRING", "FLOAT"].includes(i.type))
      .map((i) => i.name).filter((nm) => !linked.has(nm));
  };
  // D1 PE 喂法真值(1005 重锚;1009 拓扑再锚:PE=[4013] MyQi21ApiPE 装配内置,
  // 底座真源=[4032] 四段协议文由其主口喂 4013 美术风格底座-正向;
  // ApiPE 无种子控件(种子住加速宿主面板/采样器)——peSeed 退役删除):
  // 链化判据(D5 peFedAssembly)见 S6b 段(旧拓扑锚,候实弹重锚警示在彼处)
  const subj24 = String(subjNode.widgets_values?.[0] || "");
  const lockA = String((asmNode.widgets_values || []).find((v) => typeof v === "string" && v.length > 500) || ""); // 4032 五槽中唯一>500字=协议文 wv[4]
  const subjHead = subj24.slice(0, 18); // 主体句头 18 字
  const lockAHead = lockA.slice(0, 18); // 美术风格底座 首段头 18 字
  // D4 装机/仓库双哈希头(12 位;仓库缺失=并行在改或未打包,软提醒不设门)
  const sha12 = (p) => { try { return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12); } catch { return null; } };
  return {
    rootCount: g.nodes.length,
    asmId: asmSg.id, accId: accSg.id,
    panel40: hostPanel(asmSg, host40), panel208: hostPanel(accSg, host208),
    speedMode: host208.widgets_values?.[0], seedDefault: host208.widgets_values?.[1],
    ksSteps: ksDirect.widgets_values?.[2],
    savePrefix: save.widgets_values?.[0] || "",
    subj24, lockA, subjHead, lockAHead,
    // 排队图子图内键按「宿主域前缀+class_type」动态寻址(anchors §F;域前缀自真源派生)
    asmDomain: `${host40.id}:`, accDomain: `${host208.id}:`,
    instSha: sha12(INST_T2I), repoSha: sha12(REPO_T2I),
  };
}

function prekillApp() {
  const cp = require("node:child_process");
  // 照 smoke-desktop.mjs stopExistingMYStudioInstances 官方惯例(0915 模板原样)
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
    // 引擎是应用托管子进程;孤儿引擎占口毒化下一轮(09-10 教训)
    ["pkill", ["-f", "漫影工作室/comfyui/ComfyUI/main.py"]],
  ];
  for (const [cmd, args] of steps) {
    try { cp.execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* 可选步骤 */ }
  }
}

async function isPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) });
    return false; // 有服务应答=被占
  } catch (e) {
    return String(e?.cause?.code || e?.message || e).includes("ECONNREFUSED");
  }
}

let appProc = null;
let CDP_PORT = 0;
function launchApp() {
  appProc = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env }, // 不设 MYSTUDIO_REMOTE_DEBUG:main.ts 会 appendSwitch 固定 9222,与自选口双开关竞态
    detached: true, stdio: "ignore",
  });
  appProc.unref();
  log("app spawned pid", appProc.pid);
}

async function getMainClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
      if (page) break;
    } catch { /* 端口未就绪 */ }
    await sleep(1500);
  }
  if (!page) throw new Error("主窗口 target 未出现(120s)");
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
      consoleErrors.push({ src: "console", text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500) });
    } else if (m.method === "Log.entryAdded" && m.params.entry?.level === "error") {
      consoleErrors.push({ src: "log", text: String(m.params.entry.text).slice(0, 500) });
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ src: "exception", text: String(m.params.exceptionDetails?.text).slice(0, 500) });
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
    send, url: page.url,
    close: () => ws.close(),
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return null;
      return r.result.value;
    },
    async domClick(selector, pred = "e=>true") {
      return this.ev(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = els.find(${pred});
        if (!el) return null;
        const t = el.closest('button,[role="button"]') || el;
        t.click();
        return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
    async screenshot(name) {
      const path = join(TMP, `${name}.png`);
      // 踩坑(0915 交接):CDP 截图偶发返回空数据,macOS 原生 screencapture 兜底
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* 落入原生截屏兜底 */ }
      try {
        require("node:child_process").execFileSync("screencapture", ["-x", "-C", path]);
        log(`📸(native) ${path}`);
      } catch { log(`📸 失败 ${path}`); }
    },
  };
}

/** webview 内执行(<webview> 不进 /json/list,经主 target executeJavaScript;注入每段≤10 行防 IPC 竞态)。 */
async function wv(main, code) {
  return main.ev(`(async () => {
    const wv = document.querySelector('webview');
    if (!wv) return null;
    try { return await wv.executeJavaScript(${JSON.stringify(code)}, false); }
    catch (e) { return null; }
  })()`);
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

function countOutput(prefix) {
  if (!existsSync(ENGINE_OUTPUT)) return 0;
  return readdirSync(ENGINE_OUTPUT).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).length;
}

const pngMagic = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/**
 * D5 排队图「主体句先过PE」判定(1005 重锚:管线重序后PE只吃主体句):重序后
 * PE.prompt=引用 [PE开关key, 0](MyQi21PESwitch 口0=PE路主体句;JSON link#304
 * 4012:0→4013:1,排队图实拍 6:4013.prompt=["6:4012",0]),装配器(MyQi21PromptAssembly)
 * 在 PE 之后经 SubjectSelect 收文(link#317)——旧「prompt=装配器口0直喂」判据随重序
 * 整体退役(10-05 实弹 FAIL 实锤)。新判据=①喂源:PE.prompt 引用 PE开关口0;
 * ②主体句来源:PE开关.主体句 上游=正向主体句边界路径(JSON link#302 -10:0→4012:0;
 * 排队图把子图 -10 边界内联为根级主体句件,实拍 6:4012.主体句=["400",0])→解析件
 * value 含主体句头18字;③构词三段改到装配器侧:BASE 引用型底座 MyQi21DaojieBase 口0
 * (JSON link#312 4010:0→4011:0)+美术风格底座字面逐字=装机真源(旧「含首段头且>1000字」魔数
 * 按 1001 时代 1174 字内容标定,重序后内容重写真值 739 字、10-05 实拍逐字相等,魔数门废)。
 */
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
  // ⚠ 1009 拓扑警示:本函数排队图判据仍锚旧拓扑(独立 MyQi21PromptAssembly+锁层A全文
  // 输入)——t2i 现行=ApiPE 装配内置+[4032] 协议文喂底座口;非 SKIP_GEN 全实弹前须重锚
  // (SKIP_GEN=1 时 S6/S6b 连跳不经过此处;勿在无实弹收据下盲改判据)
  const asmKey = keys.find((k) => k.startsWith(domain) && prompt[k]?.class_type === "MyQi21PromptAssembly");
  const asm = asmKey ? prompt[asmKey] : null;
  const baseRef = asm?.inputs?.BASE;
  const baseNode = Array.isArray(baseRef) ? prompt[String(baseRef[0])] : null;
  const baseOk = !!baseNode && baseNode.class_type === "MyQi21DaojieBase" && String(baseRef[1]) === "0";
  const lockA = String(asm?.inputs?.锁层A全文 || "");
  const lockOk = lockA === truth.lockA; // 1005 重锚:逐字=装机真源;旧「含头+>1000」魔数按 1001 时代 1174 字内容标定,重序后真值 739 字会健康假 FAIL,已废
  return { pe, ok: subjOk && baseOk && lockOk, why: `链=PE←PE开关${ref[0]}:0✓ 主体句源含头=${subjOk}/装配器${asmKey || "键缺"} BASE←型底座=${baseOk}/美术风格底座 ${lockA.length} 字逐字=${lockOk}` };
}

/**
 * D3.2 /queue 内容过滤抓取:在 running 里找「装配域 PE 改写器在场 且 SaveImage
 * 前缀=本产线」的拍,首匹即取——防应用侧异拍(前役 08:47:26 挂账:同 t2i 工作流
 * 第二拍非本脚本所发)抢位误断言。peNeedle(可空)=再加一层 PE prompt 链化判别
 * (1005 重锚:管线重序后PE只吃主体句——PE.prompt 须为引用 PE开关 MyQi21PESwitch
 * 口0=PE路主体句;1001 旧判「引用装配器口0」随重序永不相配,S6b 会全程漏抓)。
 */
async function captureOurShot(engineBase, knownPids, truth, peChain, deadlineMs = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const q = await (await fetch(`${engineBase}/queue`, { signal: AbortSignal.timeout(8000) })).json();
      for (const running of q.queue_running || []) {
        if (knownPids.has(running[1])) continue;
        const p = running[2] || {};
        const keys = Object.keys(p);
        const peKeys = keys.filter((k) => k.startsWith(truth.asmDomain) && p[k]?.class_type === "QwenImage21_T2IPromptRewrite");
        const hasSave = keys.some((k) => p[k]?.class_type === "SaveImage" && p[k]?.inputs?.filename_prefix === truth.savePrefix);
        // peNeedle 链化判别(1005 重锚:管线重序后PE只吃主体句):PE.prompt=引用 PE开关口0(PE路主体句直喂)才算本拍
        const peChainOk = (k) => {
          const ref = p[k]?.inputs?.prompt;
          if (!Array.isArray(ref)) return false;
          const src = p[String(ref[0])];
          return !!src && src.class_type === "MyQi21PESwitch" && String(ref[1]) === "0";
        };
        if (peKeys.length > 0 && hasSave && (!peChain || peKeys.some(peChainOk))) {
          return { pid: running[1], prompt: p };
        }
      }
    } catch { /* 引擎忙 */ }
    await sleep(2000);
  }
  return { pid: null, prompt: null };
}

/** /history 等新终态拍(S6 同款口径:60s 心跳防黑盒等待+GEN_TIMEOUT 预算;S6b 复用)。 */
async function waitTerminal(engineBase, knownPids, tag, expectPid) {
  const hs = Date.now();
  let lastErr = null;
  let lastBeat = 0;
  while (Date.now() - hs < GEN_TIMEOUT_MS) {
    try {
      const h = await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        if (expectPid && pid !== expectPid) continue; // 只认抓拍锁定的拍(审读发现:防应用侧异拍先出终态被误采)
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 4000)}` };
        if (st === "success" || e.status?.completed) return { pid, entry: e };
      }
    } catch (e) { lastErr = String(e); }
    if (Date.now() - lastBeat > 60_000) {
      lastBeat = Date.now();
      let running = "?";
      try { running = ((await (await fetch(`${engineBase}/queue`, { signal: AbortSignal.timeout(5000) })).json()).queue_running || []).length; }
      catch { /* 心跳尽力 */ }
      log(`${tag} 执行中 T+${Math.round((Date.now() - hs) / 1000)}s(队列 running=${running},history 未出终态)`);
    }
    await sleep(3000);
  }
  return { error: `history 超时 ${GEN_TIMEOUT_MS / 1000}s(lastErr=${lastErr})` };
}

// ═══════════ S0 环境预检+prekill+选口 ═══════════
async function s0Precheck(truth) {
  step("S0", "环境预检+prekill+选口");
  check("S0 装机应用在(/Applications/漫影工作室.app)", existsSync(APP_BIN));
  check("S0 装机 t2i 真源解析(双子图/宿主40,208/直出KS40/PE改写器/SaveImage 齐)",
    truth.rootCount > 0 && truth.panel40.length > 0 && truth.panel208.length > 0,
    `根节点=${truth.rootCount} 装配面板=[${truth.panel40.join("/")}] 加速面板=[${truth.panel208.join("/")}] 前缀=${truth.savePrefix}`);
  // D4 装机面漂移软提醒:sha256 比对装机 t2i 与仓库树同名件;恒 pass 不设门——
  // 不一致=仓库并行在改(打包滞后),测试恒以装机面为准,勿改测试凑绿(anchors §I)
  {
    const same = truth.instSha && truth.repoSha && truth.instSha === truth.repoSha;
    check("S0 装机/仓库 t2i 哈希比对(漂移软提醒,不设门)", true,
      same ? `一致(sha256 头 ${truth.instSha})` : `不一致——测的是装机面,仓库并行在改(装机 ${truth.instSha ?? "读失败"}/仓库 ${truth.repoSha ?? "缺失"})`);
  }
  if (CDP_PORT_ENV) {
    CDP_PORT = CDP_PORT_ENV;
    if (!(await isPortFree(CDP_PORT))) { console.error(`指定 CDP_PORT=${CDP_PORT} 被占`); process.exit(2); }
  } else {
    for (const p of [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231, 9232, 9233, 9234, 9235, 9236, 9237, 9238, 9239]) {
      if (await isPortFree(p)) { CDP_PORT = p; break; }
    }
    if (!CDP_PORT) { console.error("9222-9239 无空闲调试口"); process.exit(2); }
  }
  check(`S0 调试口自选 ${CDP_PORT}(空闲;9222 常被并行探针占,不杀别人)`, true);
  prekillApp();
  await sleep(2500); // SIGTERM 送达+单实例锁释放窗口,防新实例抢锁失败静默退出
  log("prekill 完成(应用/残留 smoke/孤儿引擎)");
}

// ═══════════ S1 启动装机应用+attach ═══════════
async function s1Launch(mainPromise) {
  step("S1", "启动装机应用(真实 userData)+attach 主窗口");
  launchApp();
  const main = await mainPromise;
  log("主窗口:", String(main.url || "").slice(0, 60));
  await waitFor(() => main.ev(vis(`document.querySelectorAll('button').length > 5`)), { label: "应用水合" });
  check("S1 主窗口 attach+水合", true, String(main.url || "").slice(0, 60));
  return main;
}

// ═══════════ S2 Dashboard 进道劫子项目 ═══════════
async function s2EnterProject(main) {
  step("S2", "Dashboard 进道劫子项目");
  const onDashboard = await main.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
  if (onDashboard) {
    const clicked = await main.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
    check("S2 道劫项目卡点击", Boolean(clicked), String(clicked));
    await waitFor(() => main.ev(vis(`[...document.querySelectorAll('button')].some(b => ((b.textContent||'').trim() === '本地模型'))`)),
      { timeout: 30_000, label: "项目内导航出现" });
  } else {
    check("S2 道劫项目卡点击", true, "非 Dashboard 起步(上次会话态),已在项目内");
    // D3.1 加固:非 Dashboard 起步不再静默 pass——宿主页 fileStorage 通道(visible-workflow-smoke
    // 已证)读项目 store(zustand persist:{state:{projects:[{id,name}],activeProjectId},version}),
    // 验真激活项目=道劫;错项目/store 不可读=FAIL(detail 载实际项目名/原因)
    const storeRaw = await main.ev(`(async () => {
      try { const v = await window.fileStorage?.getItem?.('mystudio-project-store'); return v == null ? null : String(v); }
      catch (e) { return 'ERR:' + (e && e.message); }
    })()`);
    let projName = null;
    let why = `store 不可读(fileStorage 通道): ${String(storeRaw).slice(0, 100)}`;
    try {
      const st = JSON.parse(String(storeRaw))?.state;
      const pid = st?.activeProjectId;
      const proj = (st?.projects || []).find((p) => p && p.id === pid);
      if (proj?.name != null) projName = proj.name;
      else why = `store 在场但 activeProjectId=${JSON.stringify(pid)} 无对应 project(projects=${(st?.projects || []).length} 项)`;
    } catch { /* 落 why 默认(store 不可读) */ }
    check("S2 非 Dashboard 起步验真(激活项目含「道劫」)", projName !== null && projName.includes("道劫"),
      projName !== null ? `activeProject=${projName}` : why);
  }
  await main.screenshot("1-project-entered");
}

// ═══════════ S3 本地模型进 ComfyUI 画布 ═══════════
async function s3OpenCanvas(main) {
  step("S3", "侧栏「本地模型」进 ComfyUI 画布(引擎幂等 ensure)");
  const navClicked = await main.domClick("button", `e => ((e.textContent||'').trim() === '本地模型')`);
  check("S3 侧栏「本地模型」入口可点", Boolean(navClicked), String(navClicked));
  await sleep(1200);
  // 09-14 加固:freedom persist 可能记住非画布模式(漫影生图表单态),须借悬浮球切回画布,否则 webview 永不挂载
  const inForm = await main.ev(vis(`!!document.querySelector('[data-local-model-studio]')`));
  if (inForm) {
    log("检测到生图表单态,切回 ComfyUI 画布(悬浮球模式直达)");
    await main.ev(vis(`document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`));
    await waitFor(() => main.ev(vis(`(() => {
      const sec = document.querySelector('[data-orb-section="local-models"]');
      if (sec && sec.getAttribute('data-state') === 'closed') sec.querySelector('button')?.click();
      return !!document.querySelector('[data-orb-nav-mode="comfy"]');
    })()`)), { timeout: 15_000, interval: 800, label: "本地模型分区展开" });
    await main.ev(vis(`document.querySelector('[data-orb-nav-mode="comfy"]')?.click()`));
    await sleep(1500);
  }
  await main.screenshot("2-nav-clicked");
  // 引擎 ensure 状态机(0929 幂等静默 ensure:冷态自动拉起,need-start 钮可不再出现;出现则点,幂等)
  {
    const t0 = Date.now();
    let lastShot = 0;
    while (Date.now() - t0 < 600_000) {
      const state = await main.ev(vis(`(() => {
        if (document.querySelector('webview')) return 'webview';
        const startBtn = document.querySelector('[data-comfy-canvas-start]');
        if (startBtn) return 'need-start';
        if (document.querySelector('[data-comfy-canvas-starting]')) return 'starting';
        return 'waiting';
      })()`));
      if (state === "need-start") {
        const clicked = await main.domClick("[data-comfy-canvas-start]", "e=>true");
        log("点击「启动 ComfyUI」:", clicked);
      }
      if (state === "webview") break;
      if (Date.now() - lastShot > 45_000) { lastShot = Date.now(); log("引擎状态:", state); await main.screenshot(`3-engine-${state}`); }
      await sleep(3000);
    }
    if (!(await main.ev(vis(`!!document.querySelector('webview')`)))) throw new Error("waitFor 超时: webview 元素挂载(600s)");
  }
  check("S3 webview 挂载(引擎 ensure 状态机走通)", true);
  await waitFor(
    () => wv(main, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  check("S3 ComfyUI 画布就绪(webview.app.isGraphReady)", true);
  // persist 缓存旧 sidebar.js 坑(0915 踩坑③):无条件忽略缓存重载一次再进侧栏段;
  // 重载是异步的——先落标记,「标记消失+graph 就绪」才是新页真身
  await wv(main, `window.__e2ePreReload = 1; 'marked'`);
  await main.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
  await waitFor(() => wv(main, `(!window.__e2ePreReload && window.app && window.app.isGraphReady === true) ? 'y' : null`),
    { timeout: 120_000, interval: 2000, label: "新页真身(标记消失+graph 就绪)" });
  check("S3 webview 忽略缓存重载(侧栏代码保鲜)", true);
  await main.screenshot("4-canvas-ready");
  const engineBase = await wv(main, `location.origin`);
  log("引擎口(webview location.origin):", engineBase);
  check("S3 引擎口动态取得(禁抄旧端口常量)", Boolean(engineBase && /^http:\/\/127\.0\.0\.1:\d+$/.test(engineBase)), String(engineBase));
  return engineBase;
}

// ═══════════ S4 关闭所有已开工作流标签 ═══════════
async function s4CloseAllTabs(main) {
  step("S4", "关闭所有已开工作流标签(svc.closeWorkflow=侧栏右键「关闭标签」同款 API)");
  // 装一次 close-all 助手(≤10 行注入纪律),关完原样回报 before/closed/after
  const installed = await wv(main, `(() => {
    window.__e2eCloseAll = async () => {
      const s = window.app?.extensionManager?.workflow;
      if (!s || !Array.isArray(s.openWorkflows)) return JSON.stringify({ error: 'no-svc' });
      let closed = 0; const t = [...s.openWorkflows];
      for (const wf of t) { try { await Promise.race([s.closeWorkflow(wf), new Promise(r => setTimeout(r, 4000))]); closed++; } catch (e) {} }
      return JSON.stringify({ before: t.length, closed, after: (s.openWorkflows || []).map(x => x && x.path) });
    };
    return 'installed';
  })()`);
  if (installed !== "installed") throw new Error("close-all 助手装订失败(webview 通道)");
  const before = await wv(main, `(() => {
    const s = window.app?.extensionManager?.workflow;
    return JSON.stringify(((s && s.openWorkflows) || []).map(x => x && x.path));
  })()`);
  log("关闭前标签清单:", String(before));
  const raw = await wv(main, `window.__e2eCloseAll()`);
  let r = null; try { r = JSON.parse(String(raw)); } catch { /* keep null */ }
  if (!r) { check("S4 关闭全部工作流标签(命名标签清零)", false, String(raw).slice(0, 300)); return; }
  if (r.error) { check("S4 关闭全部工作流标签(命名标签清零)", false, `svc 缺席: ${r.error}`); return; }
  // 「命名标签」=非空 .json 路径且非 Unsaved 系(原生服务关最后一张自建空签,path=null/Unsaved 不算)
  const namedLeft = (r.after || []).filter((p) => typeof p === "string" && p.endsWith(".json") && !/^Unsaved Workflow/.test(p));
  check("S4 关闭全部工作流标签(命名标签清零)", namedLeft.length === 0,
    `before=${r.before} closed=${r.closed} 剩余=${JSON.stringify(r.after)}`);
  await main.screenshot("5-tabs-closed");
}

// ═══════════ S5 漫影侧栏重新打开 qi21-道劫-t2i ═══════════
async function s5ReopenT2I(main, truth) {
  step("S5", "漫影侧栏重新打开 qi21-道劫-t2i(真实路径:目录展开+叶子行点击→openMyWorkflow v3)");
  // 收敛式开侧栏:树在场才退出;不在则点 dock 钮(点完不退出,下一轮见树才算数)
  await waitFor(() => wv(main, `(() => {
    if (document.body.innerText.includes('1_图片')) return 'tree';
    const btn = document.querySelector('[data-testid="my.shots-tab-button"]')
      || [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
        .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏打开(树在场)" });
  check("S5 漫影侧栏打开(repo: 工作流树在场)", true);
  // 目录智能展开:aria-expanded 只在折叠态点一次(点开着的=收起)
  const ensureFolder = async (name, childProbe) => {
    await waitFor(() => wv(main, `(() => {
      const li = [...document.querySelectorAll('li.my-tree-item')]
        .find(li => li.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
      if (!li) return null;
      if (li.getAttribute('aria-expanded') === 'true') return 'open';
      li.querySelector('.my-tree-row')?.click();
      return 'clicked';
    })()`), { timeout: 20_000, interval: 1200, label: `目录 ${name}` });
    await waitFor(() => wv(main, childProbe), { timeout: 15_000, interval: 800, label: `${name} 子级出现` });
  };
  const leafProbe = () => wv(main, `(() => [...document.querySelectorAll('.my-tree-row')]
    .some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)})) ? 'y' : null)()`);
  const leafClick = () => wv(main, `(() => {
    const row = [...document.querySelectorAll('.my-tree-row')]
      .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)}));
    if (!row) return null; row.click(); return 'ok';
  })()`);
  await ensureFolder("Q2-1图像", `document.body.innerText.includes('1_文生图') ? 'y' : null`);
  await ensureFolder("1_文生图", `(() => [...document.querySelectorAll('.my-tree-row')]
    .some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)})) ? 'y' : null)()`);
  const leafThere = await leafProbe();
  check("S5 侧栏树含 qi21-道劫-t2i 叶子行(repo: 合并)", leafThere === "y");
  await leafClick();
  const nodes = await waitFor(() => wv(main, `window.app.graph && window.app.graph._nodes.length === ${truth.rootCount} ? ${truth.rootCount} : null`),
    { timeout: 60_000, interval: 1000, label: `画布切 t2i(${truth.rootCount} 节点)` }).catch(() => 0);
  check(`S5 侧栏重开→画布载入(根节点=${truth.rootCount},装机真源动态)`, nodes === truth.rootCount, `实际 ${nodes}`);
  // 打开并激活=激活签或标签清单任一三形态命中(0930 实弹定谳:当前前端 repo:
  // 带名直载=activeWorkflow.path 置 "workflows/<rel>" 但不进 openWorkflows 清单,
  // 只查清单会比实现更严而误报;两处都查,镜像 sidebar.js findRepoTab 三形态)。
  // 0930 根治后第二态:8f41980 null-reset 防御在上游裸调炸时降级**无名临时页**
  // (保点开必有图)——active 变 Unsaved Workflow.json;此时判据=画布已载入该工作流
  // (nodes===rootCount,与上行 check 同源)+ active 落 Unsaved 系,两条都成才算过
  const tabsRaw = await wv(main, `(() => {
    const s = window.app?.extensionManager?.workflow;
    return JSON.stringify({ open: ((s && s.openWorkflows) || []).map(x => x && x.path), active: s?.activeWorkflow?.path || null });
  })()`);
  let tabs = { open: [], active: null }; try { tabs = JSON.parse(String(tabsRaw)) || tabs; } catch { /* keep default */ }
  const threeForm = (p) => p === WF_REL || p === "repo:" + WF_REL || String(p || "").replace(/^workflows\//, "") === WF_REL;
  const hit = tabs.open.some(threeForm) || threeForm(tabs.active);
  const degraded = !hit && nodes === truth.rootCount && /^workflows\/Unsaved Workflow/.test(String(tabs.active || ""));
  check("S5 侧栏重开→工作流打开并激活(三形态命中;或 8f41980 防御降级临时页=画布已载入)",
    hit || degraded,
    `${hit ? "路径:三形态命中" : degraded ? "路径:防御降级临时页(上游裸 reset,画布已载入)" : "两态皆未命中"} active=${tabs.active} open=${JSON.stringify(tabs.open).slice(0, 200)}`);
  // 双宿主面板控件在位(动态名单=装机 JSON 子图 widget 输入−连线槽)。
  // 1001 修:包 waitFor 重试(15s)消一次性竞态——全链轮实弹曾单发归 null(wv 注入
  // reject 被静默 catch / 宿主 type 解析窗),SKIP_GEN 复跑同环境即绿;轮询到名单齐
  const rosterRaw = await waitFor(() => wv(main, `(() => {
    const find = (t) => window.app.graph._nodes.find(n => n.type === t);
    const a = find(${JSON.stringify(truth.asmId)}), c = find(${JSON.stringify(truth.accId)});
    if (!a || !c) return null;
    const r = { asm: (a.widgets || []).map(w => w.name), acc: (c.widgets || []).map(w => w.name) };
    const ok = ${JSON.stringify(truth.panel40)}.every((nm) => r.asm.includes(nm))
      && ${JSON.stringify(truth.panel208)}.every((nm) => r.acc.includes(nm));
    return ok ? JSON.stringify(r) : null;
  })()`), { timeout: 15_000, interval: 1200, label: "双宿主面板控件" })
    .catch(() => wv(main, `(() => {
      const find = (t) => window.app.graph._nodes.find(n => n.type === t);
      const a = find(${JSON.stringify(truth.asmId)}), c = find(${JSON.stringify(truth.accId)});
      if (!a || !c) return null;
      return JSON.stringify({ asm: (a.widgets || []).map(w => w.name), acc: (c.widgets || []).map(w => w.name) });
    })()`)); // 败态补发一发原始名单=detail 载实况
  let roster = null; try { roster = JSON.parse(String(rosterRaw)); } catch { /* keep null */ }
  const panel40Ok = !!roster && truth.panel40.every((nm) => roster.asm.includes(nm));
  const panel208Ok = !!roster && truth.panel208.every((nm) => roster.acc.includes(nm));
  check(`S5 装配宿主面板控件在位([${truth.panel40.join("/")}]`, panel40Ok, String(rosterRaw).slice(0, 240));
  check(`S5 加速宿主面板控件在位([${truth.panel208.join("/")}]`, panel208Ok, String(rosterRaw).slice(0, 240));
  await main.screenshot("6-t2i-reopened");
}

// ═══════════ S6 真前端 queuePrompt 出图(纯默认零手术) ═══════════
// 返回 true=全链走通(queue→引擎终态→产物在场,S6b 前置);false=链路断(S6b 不执行)
async function s6Generate(main, engineBase, truth) {
  step("S6", `真前端 queuePrompt 出图(纯默认:${truth.speedMode}/seed=${truth.seedDefault}/PE改写器在场)`);
  // 排队图摘要:引擎 /queue 现算(引擎口无鉴权,is_healthy 同款裸 GET);
  // 子图内键装载可重编号(0930 S3 实证)→按「宿主域前缀+class_type」动态寻址;
  // 抓取走 D3.2 内容过滤(装配域PE+本产线前缀)防应用侧异拍抢位
  const knownPids = new Set(Object.keys(await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json()));
  const outBefore = countOutput(truth.savePrefix);
  const t0 = Date.now();
  const queued = await wv(main, `(async () => {
    const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null;
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check("S6 queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") return false;
  let prompt = null, qpid = null;
  {
    const cap = await captureOurShot(engineBase, knownPids, truth, null, 20_000);
    prompt = cap.prompt; qpid = cap.pid;
  }
  if (!prompt) {
    check("S6 排队图抓取(引擎 /queue)", false, "执行期未捕到(过滤=装配域PE+本产线前缀;若真秒完看 history-entry.json)");
  } else {
    writeFileSync(join(TMP, "queued-prompt.json"), JSON.stringify(prompt, null, 1));
    const keys = Object.keys(prompt);
    // 1002 大轮编号锚:旧硬编码 "208:" 已废(加速宿主重排为 [7],域前缀=truth.accDomain
    // 自真源派生,与 S6b 同款)——实弹键形 "7:7010" 系
    const ksDir = keys.filter((k) => k.startsWith(truth.accDomain) && prompt[k]?.class_type === "KSampler" && String(prompt[k]?.inputs?.steps) === String(truth.ksSteps));
    check(`S6 排队图:直出 KSampler steps=${truth.ksSteps}(加速域)`, ksDir.length > 0, `key=${ksDir.join(",") || "无"}`);
    const seeds = keys.filter((k) => k.startsWith(truth.accDomain) && prompt[k]?.class_type === "PrimitiveInt");
    const seedOk = seeds.some((k) => String(prompt[k].inputs.value) === String(truth.seedDefault));
    check(`S6 排队图:seed=${truth.seedDefault}(加速域 PrimitiveInt)`, seedOk, `keys=${seeds.join(",") || "无"}`);
    const sel = keys.filter((k) => k.startsWith(truth.accDomain) && prompt[k]?.class_type === "MyQi21SpeedSelect");
    check(`S6 排队图:速度档=${truth.speedMode}`, sel.length > 0 && prompt[sel[0]]?.inputs?.mode === truth.speedMode,
      `mode=${sel.length ? prompt[sel[0]].inputs.mode : "无"}`);
    // 1005 重锚:管线重序后PE只吃主体句(D5)——排队图 PE.prompt=引用 PE开关口0
    // (PE路主体句直喂),正向主体句源含头+装配器侧构词三段(BASE←型底座+美术风格底座字面)
    const fed = peFedAssembly(prompt, keys, truth, truth.asmDomain);
    check("S6 排队图:PE 改写器在链(装配域,prompt=PE开关口0直喂+正向主体句源+装配器构词三段在场)", fed.ok,
      fed.pe.length ? `key=${fed.pe.join(",")} ${fed.why}` : "无");
  }
  // /history 等完(引擎家=装机生产家,产物直接落盘);60s 心跳防黑盒等待
  let hist = null;
  {
    const hs = Date.now();
    let lastErr = null;
    let lastBeat = 0;
    while (Date.now() - hs < GEN_TIMEOUT_MS) {
      try {
        const h = await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json();
        for (const [pid, e] of Object.entries(h)) {
          if (knownPids.has(pid)) continue;
          if (qpid && pid !== qpid) continue; // 只认抓拍锁定的拍(审读发现:防应用侧异拍先出终态被误采)
          const st = e.status?.status_str || "";
          if (st === "error") { hist = { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 4000)}` }; break; }
          if (st === "success" || e.status?.completed) { hist = { pid, entry: e }; break; }
        }
      } catch (e) { lastErr = String(e); }
      if (hist) break;
      if (Date.now() - lastBeat > 60_000) {
        lastBeat = Date.now();
        let running = "?";
        try { running = ((await (await fetch(`${engineBase}/queue`, { signal: AbortSignal.timeout(5000) })).json()).queue_running || []).length; }
        catch { /* 心跳尽力 */ }
        log(`S6 执行中 T+${Math.round((Date.now() - hs) / 1000)}s(队列 running=${running},history 未出终态)`);
      }
      await sleep(3000);
    }
    if (!hist) hist = { error: `history 超时 ${GEN_TIMEOUT_MS / 1000}s(lastErr=${lastErr})` };
  }
  const wallSecs = Math.round((Date.now() - t0) / 1000);
  if (hist.error) { check("S6 引擎执行完成(/history success)", false, String(hist.error).slice(0, 2000)); return false; }
  writeFileSync(join(TMP, "history-entry.json"), JSON.stringify(hist.entry, null, 1));
  check("S6 引擎执行完成(/history success)", true, `pid=${String(hist.pid).slice(0, 8)} ${wallSecs}s`);
  const imgs = [];
  for (const o of Object.values(hist.entry.outputs || {})) if (o.images) imgs.push(...o.images.filter((i) => (i.type || "output") === "output"));
  if (!imgs.length) { check("S6 引擎出图(history outputs)", false, "无 output 图"); return false; }
  const img = imgs.find((i) => /\.png$/i.test(i.filename)) || imgs[0];
  // 双证:引擎 output 目录新文件 + /view 取证落 apps/output
  const outNow = countOutput(truth.savePrefix);
  check("S6 引擎出图(引擎 output 目录新增)", outNow > outBefore, `前缀=${truth.savePrefix} ${outBefore}→${outNow} 文件=${img.filename}`);
  let buf = null;
  try {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
    const r = await fetch(`${engineBase}/view?${q}`, { signal: AbortSignal.timeout(15_000) }); // D3.4 /view 超时(与其余引擎 fetch 对齐;文件系统兜底已有)
    if (r.ok) buf = Buffer.from(await r.arrayBuffer());
  } catch { /* 落入文件系统兜底 */ }
  if (!buf && existsSync(join(ENGINE_OUTPUT, img.filename))) {
    buf = readFileSync(join(ENGINE_OUTPUT, img.filename)); // /view 失败时引擎家文件直读兜底
  }
  const evPath = join(OUT_DIR, "t2i-result.png");
  if (buf) writeFileSync(evPath, buf);
  check("S6 /view 取证落盘(PNG 魔数+>50KB→apps/output 证据)",
    Boolean(buf) && pngMagic(buf) && buf.length > 50_000,
    buf ? `${img.filename} ${(buf.length / 1024).toFixed(0)}KB → ${evPath} (${wallSecs}s)` : "取证失败(/view+文件系统双兜底皆空)");
  await main.screenshot("7-t2i-result");
  return true;
}

// ═══════════ S6b 主体句进 PE 硬闸(1001 S8 Q1=B+ 立;1005 重锚随管线重序) ═══════════
// 1005 重锚:管线重序后PE只吃主体句——PE改写[4013].prompt=PE开关 MyQi21PESwitch 口0
// 「PE路主体句」直喂(link#304 4012:0→4013:1),主体句先过PE、装配器[4011]在 PE 之后
// 经 SubjectSelect 收文(link#317),种子文 widget 清空退役(摆设)不变。硬闸:①程序化
// 入装配子图,装配器参数面锁层A全文=装机真源逐字对拍+PE 种子 widget 空核(退役在位);
// ②真出图,排队图服务器端硬闸 装配域:4013.prompt=PE开关口0直喂+正向主体句源+装配器
// 构词三段(D5)。入图走程序化 setGraph(S3-gate 已证形态);内件按 TYPE 寻址(子图内 id 装载可重编号)。
async function s6bPeFedShot(main, engineBase, truth) {
  step("S6b", `主体句进 PE 硬闸(Q1=B+;装配器美术风格底座 ${truth.lockA.length}字对拍+排队图 PE 链化判据)`);
  // ① 入装配子图(程序化;≤10 行注入纪律:存根图→按 TYPE 找宿主→setGraph 入图)
  const enteredRaw = await wv(main, `(() => {
    const c = window.app.canvas;
    window.__e2eS6bRoot = c.graph;
    window.__e2eS6bRootCount = c.graph._nodes.length;
    const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.asmId)});
    if (!host || !host.subgraph) return JSON.stringify({ err: 'host-missing' });
    c.setGraph(host.subgraph);
    return 'entered';
  })()`);
  if (enteredRaw !== "entered") { check("S6b 进入装配子图(程序化 setGraph,图切换见证)", false, String(enteredRaw)); return; }
  await sleep(800);
  const innerRaw = await wv(main, `(() => {
    const g = window.app.canvas.graph;
    return JSON.stringify({ inner: g && g._nodes ? g._nodes.length : null, root: window.__e2eS6bRootCount });
  })()`);
  let inner = null; try { inner = JSON.parse(String(innerRaw)); } catch { /* keep null */ }
  const enteredOk = !!inner && inner.inner > 0 && inner.inner !== inner.root;
  check("S6b 进入装配子图(程序化 setGraph,图切换见证)", enteredOk,
    enteredOk ? `根${inner.root}节点→子图${inner.inner}节点(内件数>0 且≠rootCount 即已切换)` : String(innerRaw).slice(0, 160));
  if (!enteredOk) return;
  // ② 装配器参数断言(implement S8 L2-2 步骤10「panel 值现读路径改装配器参数槽」):
  // 内件按 TYPE 寻址(子图内唯一);widget 按名「锁层A全文」(兜底=首个>500字串值)
  const asmRaw = await wv(main, `(() => {
    const g = window.app.canvas.graph;
    const nodes = g && g._nodes ? g._nodes : [];
    const asm = nodes.find(x => x.type === 'MyQi21PromptAssembly');
    if (!asm || !asm.widgets || !asm.widgets.length) return JSON.stringify({ err: 'asm-inner-missing', types: nodes.map(x => x.type).join(',') });
    const w = asm.widgets.find(x => String(x.name) === '锁层A全文') || asm.widgets.find(x => typeof x.value === 'string' && x.value.length > 500);
    if (!w) return JSON.stringify({ err: 'widget-missing', names: asm.widgets.map(x => x.name).join(',') });
    return JSON.stringify({ widget: w.name, back: w.value });
  })()`);
  let asmFed = null; try { asmFed = JSON.parse(String(asmRaw)); } catch { /* keep null */ }
  const asmOk = !!asmFed && !asmFed.err && asmFed.back === truth.lockA;
  check("S6b 装配器参数面:锁层A全文=装机真源逐字(Q1=B+ 装配全文第三段)", asmOk,
    asmOk ? `widget=${asmFed.widget} 读回 ${String(asmFed.back).length} 字逐字✓` : String(asmRaw).slice(0, 200));
  // PE 种子文 widget 退役在位核(1005 重锚:PE改写[4013].prompt 已接PE开关口0,widget=清空摆设)
  const peWRaw = await wv(main, `(() => {
    const g = window.app.canvas.graph;
    const pe = g && g._nodes ? g._nodes.find(x => x.type === 'QwenImage21_T2IPromptRewrite') : null;
    if (!pe) return JSON.stringify({ err: 'pe-inner-missing' });
    const w = pe.widgets.find(x => String(x.name) === 'prompt');
    return JSON.stringify({ back: w ? w.value : null });
  })()`);
  let peW = null; try { peW = JSON.parse(String(peWRaw)); } catch { /* keep null */ }
  check("S6b PE 种子文 widget 退役在位(清空=摆设,输入=PE开关·PE路主体句)", !!peW && !peW.err && peW.back === "",
    peW && !peW.err ? `prompt widget=${JSON.stringify(peW.back).slice(0, 40)}` : String(peWRaw).slice(0, 200));
  if (!asmOk) { await wv(main, `(() => { try { window.app.canvas.setGraph(window.__e2eS6bRoot); } catch (e) {} 'exited' })()`); return; }
  // ③ 退子图复位(改完即出,queuePrompt 在根图视角做——与真实用户路径一致)
  const exitRaw = await wv(main, `(() => {
    try { window.app.canvas.setGraph(window.__e2eS6bRoot); } catch (e) { return 'EXC:' + e.message; }
    const g = window.app.canvas.graph;
    return g && g._nodes ? g._nodes.length : null;
  })()`);
  check("S6b 退出子图复位(根节点数回位)", String(exitRaw) === String(truth.rootCount),
    `退出后 ${exitRaw} 节点(期望=${truth.rootCount})`);
  // ③.5 破缓存改 seed(1003 S6b 盲区修):S6(纯默认)与 S6b 两发排队输入全同——加速域
  // PrimitiveInt seed 恒=truth.seedDefault(装机真源 7014=[0,'fixed'],两次排队间无人拨)
  // ⇒ ComfyUI 全节点缓存命中,3s 秒回不落新文件,outNow>outBefore 恒 FAIL(非 App 缺陷)。
  // 真用户重出图必换 seed:加速宿主 seed widget(面板提升控件,真源名='seed')改 +1,
  // PrimitiveInt 下游采样链真重跑,每发真出图(判据不弱化,仍恒断 output 目录新增)。
  const seedRaw = await wv(main, `(() => {
    const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.accId)});
    if (!host || !host.widgets || !host.widgets.length) return JSON.stringify({ err: 'host-missing' });
    const w = host.widgets.find(x => String(x.name) === 'seed') || host.widgets.find(x => /seed/i.test(String(x.name)) && typeof x.value === 'number');
    if (!w) return JSON.stringify({ err: 'seed-widget-missing', names: host.widgets.map(x => x.name).join(',') });
    const old = w.value; w.value = Number(old) + 1;
    return JSON.stringify({ name: w.name, old: String(old), now: String(w.value) });
  })()`);
  let seedSet = null; try { seedSet = JSON.parse(String(seedRaw)); } catch { /* keep null */ }
  check("S6b 破缓存改 seed(加速宿主 seed widget +1,防与 S6 全同输入触发全节点缓存秒回)",
    !!seedSet && !seedSet.err && seedSet.now !== seedSet.old,
    seedSet && !seedSet.err ? `widget=${seedSet.name} ${seedSet.old}→${seedSet.now}` : String(seedRaw).slice(0, 160));
  // ④ queuePrompt(真前端,与 S6 同通道);排队图抓取走 D3.2 内容过滤(peChain=true:
  // 叠加链化判别=PE.prompt 引用PE开关口0(1005 重锚:管线重序后PE只吃主体句),防异拍)
  const knownPids = new Set(Object.keys(await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json()));
  const outBefore = countOutput(truth.savePrefix);
  const t0 = Date.now();
  const queued = await wv(main, `(async () => {
    const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null;
    try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
  })()`);
  check("S6b queuePrompt 发出(真前端)", queued === "queued", String(queued));
  if (queued !== "queued") return;
  const cap = await captureOurShot(engineBase, knownPids, truth, true, 20_000);
  const prompt = cap.prompt;
  if (!prompt) {
    check("S6b 排队图抓取(引擎 /queue,内容过滤=装配域PE+本产线前缀+PE链化判别)", false, "执行期未捕到(过滤=PE.prompt 引用PE开关口0;若真秒完看 history-entry-pe.json)");
  } else {
    writeFileSync(join(TMP, "queued-prompt-pe.json"), JSON.stringify(prompt, null, 1));
    check("S6b 排队图抓取(引擎 /queue,内容过滤=装配域PE+本产线前缀+PE链化判别)", true, `pid=${String(cap.pid).slice(0, 8)} 节点=${Object.keys(prompt).length}`);
    const keys = Object.keys(prompt);
    // 1005 重锚:管线重序后PE只吃主体句(D5 同款):PE.prompt=引用PE开关口0+正向主体句
    // 源+装配器侧构词三段在场=主体句真进 PE(装配器在 PE 后经 SubjectSelect 收文)
    const fed = peFedAssembly(prompt, keys, truth, truth.asmDomain);
    const ksDir = keys.filter((k) => k.startsWith(truth.accDomain) && prompt[k]?.class_type === "KSampler" && String(prompt[k]?.inputs?.steps) === String(truth.ksSteps));
    check("S6b 排队图硬闸(主体句真进 PE 改写器=PE路采样链文本源,装配器构词三段在场)", fed.ok && ksDir.length > 0,
      `改写器链=${fed.ok ? "PE开关口0直喂+正向主体句源+构词三段✓" : fed.why};直出KS steps=${truth.ksSteps} key=${ksDir.join(",") || "无"}`);
  }
  // ⑤ 等终态+取证(与 S6 同款:history success/前缀计数+1/新 PNG>50KB//view→t2i-result-pe.png)
  const hist = await waitTerminal(engineBase, knownPids, "S6b", cap && cap.pid);
  const wallSecs = Math.round((Date.now() - t0) / 1000);
  if (hist.error) { check("S6b 引擎执行完成(/history success)", false, String(hist.error).slice(0, 2000)); return; }
  writeFileSync(join(TMP, "history-entry-pe.json"), JSON.stringify(hist.entry, null, 1));
  check("S6b 引擎执行完成(/history success)", true, `pid=${String(hist.pid).slice(0, 8)} ${wallSecs}s`);
  const imgs = [];
  for (const o of Object.values(hist.entry.outputs || {})) if (o.images) imgs.push(...o.images.filter((i) => (i.type || "output") === "output"));
  if (!imgs.length) { check("S6b 引擎出图(history outputs)", false, "无 output 图"); return; }
  const img = imgs.find((i) => /\.png$/i.test(i.filename)) || imgs[0];
  const outNow = countOutput(truth.savePrefix);
  check("S6b 引擎出图(引擎 output 目录新增)", outNow > outBefore, `前缀=${truth.savePrefix} ${outBefore}→${outNow} 文件=${img.filename}`);
  let buf = null;
  try {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
    const r = await fetch(`${engineBase}/view?${q}`, { signal: AbortSignal.timeout(15_000) }); // D3.4 /view 超时
    if (r.ok) buf = Buffer.from(await r.arrayBuffer());
  } catch { /* 落入文件系统兜底 */ }
  if (!buf && existsSync(join(ENGINE_OUTPUT, img.filename))) buf = readFileSync(join(ENGINE_OUTPUT, img.filename));
  const evPath = join(OUT_DIR, "t2i-result-pe.png");
  if (buf) writeFileSync(evPath, buf);
  check("S6b /view 取证落盘(PNG 魔数+>50KB→apps/output 证据 t2i-result-pe.png)",
    Boolean(buf) && pngMagic(buf) && buf.length > 50_000,
    buf ? `${img.filename} ${(buf.length / 1024).toFixed(0)}KB → ${evPath} (${wallSecs}s)` : "取证失败(/view+文件系统双兜底皆空)");
  await main.screenshot("8-t2i-result-pe");
}

// ═══════════ S7 收摊+报告 ═══════════
async function s7Cleanup(engineBase) {
  step("S7", "收摊(干完即停:prekill 自拉全家+双口验 down)+报告");
  if (KEEP_APP) {
    check("S7 收摊(KEEP_APP=1 保留应用)", true, "跳过 prekill 与口验");
    return;
  }
  prekillApp();
  await sleep(3000);
  // 慢退出容忍:口验最多再等 10s(进程 teardown 有先后)
  const probeFree = async (port) => {
    for (let i = 0; i < 5; i++) { if (await isPortFree(port)) return true; await sleep(2000); }
    return false;
  };
  const cdpDown = await probeFree(CDP_PORT);
  check(`S7 双口验 down:CDP 口 ${CDP_PORT}`, cdpDown, cdpDown ? "已关" : "仍在监听!");
  if (engineBase) {
    const engPort = Number(String(engineBase).split(":").pop());
    const engDown = engPort ? await probeFree(engPort) : false;
    check(`S7 双口验 down:引擎口 ${engineBase}`, engDown, engDown ? "已关" : "仍在监听!");
  }
}

async function main() {
  if (!existsSync(APP_BIN)) { console.error("装机应用不存在:", APP_BIN); process.exit(2); }
  if (!existsSync(INST_T2I)) { console.error("装机 t2i 真源缺失:", INST_T2I); process.exit(2); }
  let truth;
  try { truth = parseTruth(); } catch (e) { console.error("装机 t2i 真源解析失败:", e.message); process.exit(2); }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  await s0Precheck(truth);
  const mainClientPromise = getMainClient();
  // D3.3 加固:S1 attach 挪进 try+main 外提——早失败(target 未出现/水合超时)也走
  // finally 收摊+落 report.json(fatal 字段载因),不再裸退出无报告
  let main = null;
  let engineBase = null;
  let fatal = null;
  try {
    main = await s1Launch(mainClientPromise);
    await s2EnterProject(main);
    engineBase = await s3OpenCanvas(main);
    await s4CloseAllTabs(main);
    await s5ReopenT2I(main, truth);
    if (SKIP_GEN) {
      log("S6 跳过实弹生图(SKIP_GEN=1,链路段 S0-S5 已覆盖)");
      results.push({ name: "S6 真前端出图(实弹)", pass: true, detail: "SKIP_GEN=1 跳过" });
      results.push({ name: "S6b 装配全文进 PE 硬闸(实弹)", pass: true, detail: "SKIP_GEN=1 跳过(连 S6 一起)" });
    } else {
      const s6ok = await s6Generate(main, engineBase, truth);
      if (SKIP_PE) {
        results.push({ name: "S6b 装配全文进 PE 硬闸(实弹)", pass: true, detail: "SKIP_PE=1 跳过" });
      } else if (!s6ok) {
        check("S6b 装配全文进 PE 硬闸(实弹)", false, "S6 未走通(queue/引擎/产物断链),S6b 前置不满足不执行");
      } else {
        await s6bPeFedShot(main, engineBase, truth);
      }
    }
  } catch (e) {
    fatal = String(e?.message || e);
    log("致命中断:", fatal);
    results.push({ name: "致命中断(段链断裂)", pass: false, detail: fatal });
  } finally {
    try { await s7Cleanup(engineBase); } catch (e) { log("S7 收摊异常:", String(e?.message || e)); }
    const allPass = results.every((r) => r.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      command: `node apps/build/scripts/daojie-t2i-app-e2e.mjs${SKIP_GEN ? " (SKIP_GEN=1)" : SKIP_PE ? " (SKIP_PE=1)" : ""}`,
      task: "09-30-daojie-t2i-e2e-pt2",
      cdpPort: CDP_PORT, engineBase,
      truth: { rootCount: truth.rootCount, panel40: truth.panel40, panel208: truth.panel208, speedMode: truth.speedMode, seedDefault: truth.seedDefault, ksSteps: truth.ksSteps, savePrefix: truth.savePrefix,
        subj24Head: truth.subj24.slice(0, 60), lockALen: truth.lockA.length, subjHead: truth.subjHead, lockAHead: truth.lockAHead,
        instT2iSha: truth.instSha, repoT2iSha: truth.repoSha },
      evidenceDir: OUT_DIR, tmpDir: TMP,
      consoleErrorCount: consoleErrors.length,
      consoleErrors: consoleErrors.slice(0, 30),
      fatal,
      checks: results,
      allPass,
    };
    writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
    log("════ 汇总 ════");
    for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${String(r.detail).slice(0, 200)}` : ""}`);
    log(`报告: ${join(OUT_DIR, "report.json")}(console 错误 ${consoleErrors.length} 条随档)`);
    log(allPass ? "✅ E2E 全部通过" : "❌ E2E 存在失败项");
    try { if (main) main.close(); } catch { /* 已关 */ }
    process.exit(allPass ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("E2E 失败:", e.message);
  if (!KEEP_APP) prekillApp();
  process.exit(1);
});
