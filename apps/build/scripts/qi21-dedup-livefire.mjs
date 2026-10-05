#!/usr/bin/env node
/**
 * qi21 提示词去重实弹验证(qi21-dedup-livefire.mjs)—— 一次性驱动(1005 立)。
 *
 * 验什么:my_qi21_final_output.py / my_qi21_prompt_select.py 刚退役 _ZH_ALPHA_DECL
 * (中文透明声明插入——其逐字=rgba.head+rgba.tail 拼接;见
 * apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_final_output.py:135)。
 * 去重后透明开正向文本 = 头句 + " " + 装配全文 + " " + W1收束句 + " " + 尾句
 * (compose,my_qi21_final_output.py:190-194)——三短语各恰好出现 1 次(修复前各 2 次):
 *   「这是一张带有透明度的RGBA图像」「该图像具有alpha通道」「主体呈现为干净的平面剪裁」。
 * 主判据=④文本计数断言(机器门);alpha=⑤三门机器门(1005 升门:
 * mode==RGBA / 四角 alpha 全≤8 / PNG 取证成功,任一不过 exit 1)。
 *
 * 取证位定谳:resolved 正向文本不内联在排队图(TextEncodeQwenImage21.prompt=连线
 * 引用 ["6",0])——真源=根图 [401] MyQi21PromptPreview(OUTPUT_NODE=True,
 * ui.merged 载荷,my_qi21_prompt_preview.py:58):其 正向提示词 ← [6].out[0]
 * positive(link18),与 [4015] 主编码 .prompt(link208)同一根([4014].进编码正向
 * 文本),运行时恒等 → merged 正向段 ≡ 主编码正向输入。
 *
 * 驱动流程(骨架承自 comfy-canvas-verify.mjs:选口 9222-9231/prekill 单飞/
 * launchApp/getMainClient/wv()/KEEP_APP;history/token 机制承自
 * daojie-t2i-app-e2e.mjs S6b:knownPids+/queue 内容过滤抓拍/waitTerminal):
 *   ①启动装机 App 进 ComfyUI 画布,repo: 直载 qi21-道劫-t2i(webview 已挂载直用,S3-S5 同 verify);
 *   ②读 repo qi21_bases.json:rgba_default=true 型(预期「道具」,json 为准)→
 *     置 [6] widget:型选择=该型、PE启用?=false(透明自动跟型,my_qi21_base.py:35
 *     「透明值=型≠自由?该型 rgba_default:透明覆盖」);
 *   ③真前端 app.queuePrompt 发一枪,poll /history 至终态(预算 30 分钟;
 *     Fun-Acc 4 步默认档通常几分钟);
 *   ④取 [401] merged 正向段,三短语计数各==1;任一不满足 exit 1 + 打印实际文本前后 80 字;
 *   ④b(S11,插 S8/S9 间)显示层端到端:wv() 在 webview 取子图 [401] 合并预览框值
 *     (web JS onExecuted 回填,__myPreviewDisplay 标记,my-qi21-prompt-preview.js:35)
 *     ——两门:长度>300 且含透明头句;host.subgraph 取不到回退 canvas.graph(子图
 *     打开态),双路皆空=FAIL+诊断(host 键名/widgets 名单),不许静默跳过;
 *   ⑤取输出 PNG,引擎 venv python(~/Project/IP/漫影工作室/comfyui/venv/bin/python
 *     优先)读 mode/size/四角 RGBA(stdout 一行 JSON);三门:mode==RGBA、
 *     四角 alpha 全≤8、PNG 取证成功——任一不过 FAIL 进 results(参与 exit code);
 *   ⑥证据写 apps/output/comfy-canvas-verify/dedup-livefire.md;KEEP_APP=1 留 App。
 *
 * 退出码:0=全过;1=断言失败;2=环境错误。stdout 简洁行(门禁只认 exit code)。
 * 产物:apps/output/comfy-canvas-verify/{dedup-livefire.md,dedup-livefire-canvas.png,
 *   dedup-livefire-widgets.png,dedup-livefire-output.png};中间件 /tmp/qi21-dedup-livefire/。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const HOME = process.env.HOME;
const REPO = `${HOME}/Project/Github/MYStudio`;
const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.my.manying-studio";
const WF_REL = "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json";
// repo: 侧栏叶子直载真读位=装机 Resources(1005 晚路径定谳,同 comfy-canvas-verify.mjs:38)
const TRUTH_WF_PATH = "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/" + WF_REL;
const INST_FINAL_OUT = "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/my_nodes/nodes/my_qi21_final_output.py";
const BASES_JSON = `${REPO}/apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json`;
const OUT_DIR = `${REPO}/apps/output/comfy-canvas-verify`;
const TMP = "/tmp/qi21-dedup-livefire";
const ENGINE_OUTPUT = `${HOME}/Library/Application Support/漫影工作室/comfyui/output`;
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 1_800_000); // ③预算 30 分钟
const KEEP_APP = process.env.KEEP_APP === "1";

// ④断言短语(任务给定;S0 与 qi21_bases.json rgba 节交叉核对,漂移仅提醒不设门)
const NEEDLE_HEAD = "这是一张带有透明度的RGBA图像";
const NEEDLE_ALPHA = "该图像具有alpha通道";
const NEEDLE_W1 = "主体呈现为干净的平面剪裁";
const MARK_POS = "═══ 正向提示词 ═══";
const MARK_NEG = "═══ 负向提示词 ═══";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const step = (id, t) => log(`──── ${id} ${t} ────`);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const countOf = (t, s) => t.split(s).length - 1;
const quitApp = () => {
  try { execFileSync("osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`], { stdio: "ignore" }); } catch { /* 可选 */ }
};

// ── 真源解析(装机 t2i;零硬编码:rootCount/宿主 id/SaveImage 前缀全动态) ──
function parseTruth() {
  const g = JSON.parse(readFileSync(TRUTH_WF_PATH, "utf8"));
  const sg6 = (g.definitions?.subgraphs || []).find((s) => String(s.name).includes("提示词类型优化"));
  const sgAcc = (g.definitions?.subgraphs || []).find((s) => String(s.name).includes("加速"));
  const host6 = g.nodes.find((n) => String(n.type) === String(sg6?.id));
  const hostAcc = g.nodes.find((n) => String(n.type) === String(sgAcc?.id));
  const save = g.nodes.find((n) => n.type === "SaveImage");
  if (!sg6 || !sgAcc || !host6 || !hostAcc || !save) throw new Error("装机 t2i 真源关键件缺失(装配宿主/加速宿主/SaveImage)");
  return {
    rootCount: g.nodes.length,
    asmId: String(sg6.id), accId: String(sgAcc.id),
    savePrefix: save.widgets_values?.[0] || "",
    asmDomain: `${host6.id}:`,
    def6: Array.isArray(host6.widgets_values) ? host6.widgets_values.slice(0, 2) : null, // 装机默认 [型选择, PE启用?]
  };
}

// ── qi21_bases.json:rgba_default 型 + rgba 三句(needles 交叉核对) ──
function parseBases() {
  const b = JSON.parse(readFileSync(BASES_JSON, "utf8"));
  const trueTypes = (b.types || []).filter((t) => t.rgba_default === true).map((t) => t.zh);
  const rgba = b.rgba || {};
  return {
    trueTypes,
    chosen: trueTypes.includes("道具") ? "道具" : (trueTypes[0] || null),
    typeCount: (b.types || []).length,
    needlesInJson: {
      head: String(rgba.head || "").includes(NEEDLE_HEAD),
      alpha: String(rgba.tail || "").includes(NEEDLE_ALPHA),
      w1: String(rgba.w1_closing || "").includes(NEEDLE_W1),
    },
  };
}

// ── CDP 底座(comfy-canvas-verify.mjs 原样) ──
async function isPortFree(port) {
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); return false; }
  catch (e) { return String(e?.cause?.code || e?.message || e).includes("ECONNREFUSED"); }
}
function prekillApp() { // 单飞铁律:只清本驱动要管理的 App 实例(不碰引擎/别人进程)
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
  ];
  for (const [cmd, args] of steps) { try { execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* 可选 */ } }
}
let CDP_PORT = 0;
function launchApp() {
  const appProc = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env }, detached: true, stdio: "ignore",
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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send("Runtime.enable"); await send("Page.enable");
  return {
    send, url: page.url, close: () => ws.close(),
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
        t.click(); return (t.textContent || '').trim().slice(0, 40);
      })()`);
    },
    async screenshot(name) {
      mkdirSync(OUT_DIR, { recursive: true });
      const path = join(OUT_DIR, `${name}.png`);
      try { // 画布内容在 webview guest 层:按 /json/list 直截 webview target(verify 同款)
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const wvTarget = list.find((t) => t.type === "webview" && t.webSocketDebuggerUrl);
        if (wvTarget) {
          const ws2 = new WebSocket(wvTarget.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws2.addEventListener("open", res, { once: true });
            ws2.addEventListener("error", rej, { once: true });
          });
          const r2 = await new Promise((res) => {
            ws2.addEventListener("message", function h(ev) {
              const m = JSON.parse(String(ev.data));
              if (m.id === 1) { ws2.removeEventListener("message", h); res(m.result); }
            });
            ws2.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
          });
          ws2.close();
          if (r2 && r2.data) { writeFileSync(path, Buffer.from(r2.data, "base64")); log(`📸(webview) ${path}`); return; }
        }
      } catch { /* 落主窗兜底 */ }
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* 原生兜底 */ }
      try { execFileSync("screencapture", ["-x", "-C", path]); log(`📸(native) ${path}`); }
      catch { log(`📸 失败 ${path}`); }
    },
  };
}
/** webview 内执行(注入每段≤10 行防 IPC 竞态) */
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

// ── 排队图抓拍(e2e D3.2 同款内容过滤;本产线=装配域 MyQi21FinalOutput+本前缀 SaveImage) ──
async function captureOurShot(engineBase, knownPids, truth, deadlineMs = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const q = await (await fetch(`${engineBase}/queue`, { signal: AbortSignal.timeout(8000) })).json();
      for (const running of q.queue_running || []) {
        if (knownPids.has(running[1])) continue;
        const p = running[2] || {};
        const keys = Object.keys(p);
        const fo = keys.some((k) => k.startsWith(truth.asmDomain) && p[k]?.class_type === "MyQi21FinalOutput");
        const sv = keys.some((k) => p[k]?.class_type === "SaveImage" && p[k]?.inputs?.filename_prefix === truth.savePrefix);
        if (fo && sv) return { pid: running[1], prompt: p };
      }
    } catch { /* 引擎忙 */ }
    await sleep(2000);
  }
  return { pid: null, prompt: null };
}
// ── /history 等终态(e2e waitTerminal 同款;心跳 180s 控 stdout 行数) ──
async function waitTerminal(engineBase, knownPids, tag, expectPid, getBase) {
  const hs = Date.now();
  let lastErr = null, lastBeat = 0, missStreak = 0;
  while (Date.now() - hs < GEN_TIMEOUT_MS) {
    try {
      const h = await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json();
      missStreak = 0;
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        if (expectPid && pid !== expectPid) continue;
        const st = e.status?.status_str || "";
        if (st === "error") return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 4000)}`, base: engineBase };
        if (st === "success" || e.status?.completed) return { pid, entry: e, base: engineBase };
      }
    } catch (e) {
      lastErr = String(e); missStreak++;
      if (missStreak >= 3 && getBase) {
        try { const nb = await getBase(); if (nb && nb !== engineBase) { log(`${tag} 引擎口漂移(跟随 webview): ${engineBase}→${nb}`); engineBase = nb; } } catch { /* 下轮再试 */ }
      }
      if (missStreak >= 6) {
        for (const p of [17000, 17001, 17002, 17003]) {
          try { const r = await fetch(`http://127.0.0.1:${p}/system_stats`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { const nb = `http://127.0.0.1:${p}`; if (nb !== engineBase) { log(`${tag} 端口扫描救回: ${engineBase}→${nb}`); engineBase = nb; break; } } } catch { /* 下一个口 */ }
        }
        missStreak = 0;
      }
    }
    if (Date.now() - lastBeat > 180_000) {
      lastBeat = Date.now();
      log(`${tag} 执行中 T+${Math.round((Date.now() - hs) / 1000)}s(history 未出终态)`);
    }
    await sleep(3000);
  }
  return { error: `history 超时 ${GEN_TIMEOUT_MS / 1000}s(lastErr=${lastErr})`, base: engineBase };
}

// ── ④取证:history outputs 里 [401] merged ui 载荷 → 正向段 ──
function extractPositive(entry) {
  const outs = entry?.outputs || {};
  const pick = (o) => (o && Array.isArray(o.merged) && typeof o.merged[0] === "string" ? o.merged[0] : null);
  let merged = pick(outs["401"]);
  if (merged == null) for (const o of Object.values(outs)) { const v = pick(o); if (v != null) { merged = v; break; } }
  if (merged == null) return { merged: null, positive: null };
  const iPos = merged.indexOf(MARK_POS);
  if (iPos < 0) return { merged, positive: null };
  const iNeg = merged.indexOf(MARK_NEG, iPos + MARK_POS.length);
  return { merged, positive: merged.slice(iPos + MARK_POS.length, iNeg >= 0 ? iNeg : undefined).trim() };
}
const ctxAround = (t, s) => {
  const i = t.indexOf(s);
  if (i < 0) return `长度=${t.length} 头120=${JSON.stringify(t.slice(0, 120))} 尾120=${JSON.stringify(t.slice(-120))}`;
  return JSON.stringify(t.slice(Math.max(0, i - 80), i + s.length + 80));
};

// ── ⑤alpha 探针(引擎 venv python 优先;stdout 一行 JSON:mode/size/corners) ──
function alphaProbe(pngPath) {
  const script = join(TMP, "alpha_probe.py");
  writeFileSync(script, `import sys, json
try:
    from PIL import Image
except Exception as e:
    print(json.dumps({"error": "PIL_IMPORT_FAIL", "detail": str(e)})); sys.exit(3)
im = Image.open(sys.argv[1])
mode = im.mode
size = list(im.size)
has_alpha = mode in ("RGBA", "LA") or (mode == "P" and "transparency" in im.info)
corners = []
if has_alpha:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    for c in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
        corners.append(list(rgba.getpixel(c)))
print(json.dumps({"mode": mode, "size": size, "corners": corners}))
`);
  const cands = [
    `${HOME}/Project/IP/漫影工作室/comfyui/venv/bin/python`,
    `${HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`,
    "/usr/bin/python3",
  ];
  let last = null;
  for (const py of cands) {
    if (!existsSync(py)) { last = `${py} 不存在`; continue; }
    try {
      const out = execFileSync(py, [script, pngPath], { encoding: "utf8", timeout: 60_000 });
      return { py, out: out.trim() };
    } catch (e) {
      const msg = String(e?.stdout || "") + String(e?.stderr || e?.message || e);
      last = `${py}: ${msg.slice(0, 120)}`;
      if (!msg.includes("PIL_IMPORT_FAIL")) return { py, out: `PYTHON_ERR ${last}` }; // 非缺 PIL=脚本/文件错,不再换
    }
  }
  return { py: null, out: `PIL 不可用,alpha 未读,三门将 FAIL(${last})` };
}

// ═══════════ 主流程(失败也落证据,统一收摊) ═══════════
async function main() {
  if (!existsSync(APP_BIN)) { console.error("装机应用不存在:", APP_BIN); process.exit(2); }
  if (!existsSync(TRUTH_WF_PATH)) { console.error("装机 t2i 真源缺失:", TRUTH_WF_PATH); process.exit(2); }
  if (!existsSync(BASES_JSON)) { console.error("repo qi21_bases.json 缺失:", BASES_JSON); process.exit(2); }
  let truth, bases;
  try { truth = parseTruth(); bases = parseBases(); }
  catch (e) { console.error("真源解析失败:", e.message); process.exit(2); }
  log("真源:", TRUTH_WF_PATH);
  log(`qi21_bases ${bases.typeCount} 型,rgba_default=true=[${bases.trueTypes.join("/")}] → 选「${bases.chosen}」`);
  if (!bases.chosen) { console.error("qi21_bases.json 无 rgba_default=true 型,前提破坏"); process.exit(2); }
  if (!Object.values(bases.needlesInJson).every(Boolean)) log("⚠️ 断言短语与 json rgba 节有出入(仅提醒):", JSON.stringify(bases.needlesInJson));
  mkdirSync(OUT_DIR, { recursive: true }); mkdirSync(TMP, { recursive: true });

  step("S0", "选口+prekill 单飞");
  for (const p of [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231]) {
    if (await isPortFree(p)) { CDP_PORT = p; break; }
  }
  if (!CDP_PORT) { console.error("9222-9231 无空闲调试口"); process.exit(2); }
  log(`S0 调试口 ${CDP_PORT}`);
  prekillApp();
  await sleep(2500);

  step("S1", "启动装机 App+attach");
  launchApp();
  const client = await getMainClient();
  await waitFor(() => client.ev(vis(`document.querySelectorAll('button').length > 5`)), { label: "应用水合" });
  log("S1 主窗口 attach+水合 ✓");

  // 运行态变量(S6 起逐步填充;失败路径也尽量带着已有态落证据)
  let engineBase = null, set6 = null, seedSet = null, cap = null, hist = null, wallSecs = 0;
  let posText = null, merged = null, extractNote = null, counts = null, dedupOk = false;
  let alphaOut = "未执行", alphaPy = "-", pngFilename = null, outPngPath = join(OUT_DIR, "dedup-livefire-output.png");
  let fatal = null;

  try {
    // S2 Dashboard 进道劫子项目
    const onDashboard = await client.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
    if (onDashboard) {
      const clicked = await client.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
      check("S2 道劫项目卡点击", Boolean(clicked), String(clicked));
    } else check("S2 非 Dashboard 起步(已在项目内)", true);

    step("S3", "进 ComfyUI 画布(webview 已挂载直用)");
    const alreadyIn = await wv(client, `document.querySelector('webview') ? 'webview' : null`);
    if (alreadyIn) {
      log("S3 webview 已挂载(视图状态直 restore,跳导航)");
    } else {
      const NAV_PRED = `e => ((e.textContent||'').trim() === '本地模型')`;
      const navClicked = await waitFor(async () =>
          (await client.domClick("button", NAV_PRED))
          ?? (await client.domClick('[role="button"]', NAV_PRED))
          ?? (await client.domClick("span", NAV_PRED)),
        { timeout: 45_000, interval: 1500, label: "本地模型入口出现并可点" }).catch(() => null);
      check("S3 本地模型入口可点", Boolean(navClicked), String(navClicked));
      await client.ev(vis(`document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`));
      await waitFor(() => wv(client, `'ok'`),
        { timeout: 1200_000, interval: 3000, label: "webview 挂载且可执行(引擎冷启动在内)" });
    }
    await waitFor(() => wv(client, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
      { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
    await wv(client, `window.__dfPreReload = 1; 'marked'`);
    await client.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
    await waitFor(() => wv(client, `(!window.__dfPreReload && window.app && window.app.isGraphReady === true) ? 'y' : null`),
      { timeout: 120_000, interval: 2000, label: "新页真身" });
    engineBase = await wv(client, `location.origin`);
    check("S3 webview 就绪+引擎口动态取得", Boolean(engineBase && /^http:\/\/127\.0\.0\.1:\d+$/.test(engineBase || "")), String(engineBase));

    step("S4", "关所有已开工作流标签");
    await wv(client, `(() => {
      window.__dfCloseAll = async () => {
        const s = window.app?.extensionManager?.workflow;
        if (!s || !Array.isArray(s.openWorkflows)) return JSON.stringify({ error: 'no-svc' });
        let closed = 0; const t = [...s.openWorkflows];
        for (const wf of t) { try { await Promise.race([s.closeWorkflow(wf), new Promise(r => setTimeout(r, 4000))]); closed++; } catch (e) {} }
        return JSON.stringify({ before: t.length, closed });
      };
      return 'installed';
    })()`);
    await wv(client, `window.__dfCloseAll()`);

    step("S5", `漫影侧栏 repo: 直载 ${WF_REL}`);
    await waitFor(() => wv(client, `(() => {
      if (document.body.innerText.includes('1_图片')) return 'tree';
      const btn = document.querySelector('[data-testid="my.shots-tab-button"]')
        || [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
          .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
      if (!btn) return null; btn.click(); return 'clicked';
    })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏打开" });
    const ensureFolder = async (name, childProbe) => {
      await waitFor(() => wv(client, `(() => {
        const li = [...document.querySelectorAll('li.my-tree-item')]
          .find(li => li.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
        if (!li) return null;
        if (li.getAttribute('aria-expanded') === 'true') return 'open';
        li.querySelector('.my-tree-row')?.click();
        return 'clicked';
      })()`), { timeout: 20_000, interval: 1200, label: `目录 ${name}` });
      await waitFor(() => wv(client, childProbe), { timeout: 15_000, interval: 800, label: `${name} 子级出现` });
    };
    const relParts = WF_REL.split("/");
    await ensureFolder(relParts[0], `document.body.innerText.includes(${JSON.stringify(relParts[1])}) ? 'y' : null`);
    await ensureFolder(relParts[1], `(() => [...document.querySelectorAll('.my-tree-row')]
      .some(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)})) ? 'y' : null)()`);
    await wv(client, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)}));
      if (!row) return null; row.click(); return 'ok';
    })()`);
    const nodes = await waitFor(() => wv(client, `window.app.graph && window.app.graph._nodes.length === ${truth.rootCount} ? ${truth.rootCount} : null`),
      { timeout: 60_000, interval: 1000, label: `画布载入(${truth.rootCount} 节点)` }).catch(() => 0);
    check(`S5 画布载入(根节点=${truth.rootCount})`, nodes === truth.rootCount, `实际 ${nodes}`);

    // ── S6 置 [6] widget(型选择=json rgba_default 型,PE启用?=false)+ seed 破缓存 ──
    step("S6", `置 [6] widget:型选择=${bases.chosen}/PE启用?=false`);
    const setRaw = await wv(client, `(() => {
      const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.asmId)});
      if (!host || !host.widgets) return JSON.stringify({ err: 'host-missing' });
      const combo = host.widgets.find(x => x.name === '型选择');
      const pe = host.widgets.find(x => x.name === 'PE启用?');
      if (!combo || !pe) return JSON.stringify({ err: 'widget-missing', names: host.widgets.map(w => w.name) });
      const opts = (combo.options && combo.options.values) || null;
      const oldT = combo.value, oldPE = pe.value;
      combo.value = ${JSON.stringify(bases.chosen)}; pe.value = false;
      let inpSync = [];
      for (const inp of (host.inputs || [])) {
        if (inp.widget && inp.widget.name === '型选择') { inp.widget.value = ${JSON.stringify(bases.chosen)}; inpSync.push('型选择'); }
        if (inp.widget && inp.widget.name === 'PE启用?') { inp.widget.value = false; inpSync.push('PE启用?'); }
      }
      const back = {};
      for (const inp of (host.inputs || [])) if (inp.widget && (inp.widget.name === '型选择' || inp.widget.name === 'PE启用?')) back[inp.widget.name] = String(inp.widget.value);
      return JSON.stringify({ oldT: String(oldT), oldPE: String(oldPE), nowT: String(combo.value), nowPE: String(pe.value), opts, inpSync, back });
    })()`);
    try { set6 = JSON.parse(String(setRaw)); } catch { /* keep null */ }
    check("S6 [6] widget 置值读回(型选择/PE启用?)",
      !!set6 && !set6.err && set6.nowT === bases.chosen && set6.nowPE === "false",
      set6 && !set6.err
        ? `型 ${set6.oldT}→${set6.nowT},PE ${set6.oldPE}→${set6.nowPE},options含选型=${Array.isArray(set6.opts) ? set6.opts.includes(bases.chosen) : "无options"}`
        : String(setRaw).slice(0, 200));
    // 1005 晚案②:载图后 subgraph widget 有异步重绑窗口——立即置值会落在将被遗弃的
    // widget 对象上(读回=道具,排队却=人物)。以 graphToPrompt(排队真视角)为门,
    // 置→等→验循环直到排队视角真吃到目标型。
    let g2pBase = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(1500);
      const probeRaw = await wv(client, `(async () => {
        const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.asmId)});
        if (!host) return JSON.stringify({ err: "no-host" });
        const w = host.widgets.find(x => x.name === "型选择");
        if (w) w.value = ${JSON.stringify(bases.chosen)};
        const pe = host.widgets.find(x => x.name === "PE启用?");
        if (pe) pe.value = false;
        const gp = await window.app.graphToPrompt();
        const out = gp.output || gp.prompt || gp;
        const k = Object.keys(out).find(x => out[x]?.class_type === "MyQi21DaojieBase");
        return JSON.stringify({ base: k ? out[k].inputs.base : null });
      })()`);
      let probe = null; try { probe = JSON.parse(String(probeRaw)); } catch { /* keep null */ }
      g2pBase = probe ? probe.base : null;
      if (g2pBase === bases.chosen) break;
      log(`S6 排队视角未吃到目标型(第${attempt + 1}次): base=${g2pBase},重置重验`);
    }
    check("S6 排队视角真值门(graphToPrompt base=目标型)", g2pBase === bases.chosen, `g2p.base=${g2pBase}`);
    if (g2pBase !== bases.chosen) throw new Error("排队视角真值门未过:subgraph widget 重绑窗口未凑效,宁终止不假绿");
    const seedRaw = await wv(client, `(() => { // 加速宿主 seed+1(e2e 1003 同款):保真出图新文件,不影响文本
      const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.accId)});
      if (!host || !host.widgets) return JSON.stringify({ err: 'host-missing' });
      const w = host.widgets.find(x => String(x.name) === 'seed') || host.widgets.find(x => /seed/i.test(String(x.name)) && typeof x.value === 'number');
      if (!w) return JSON.stringify({ err: 'seed-widget-missing' });
      const old = w.value; w.value = Number(old) + 1;
      return JSON.stringify({ old: String(old), now: String(w.value) });
    })()`);
    try { seedSet = JSON.parse(String(seedRaw)); } catch { /* keep null */ }
    log(`S6 破缓存 seed: ${seedSet && !seedSet.err ? `${seedSet.old}→${seedSet.now}` : "未拨(best-effort)"}`);
    await client.screenshot("dedup-livefire-widgets");

    // ── S7 真前端 queuePrompt 发一枪+等终态(预算 30 分钟) ──
    step("S7", "真前端 queuePrompt 出图(透明开)");
    const knownPids = new Set(Object.keys(await (await fetch(`${engineBase}/history`, { signal: AbortSignal.timeout(8000) })).json()));
    const t0 = Date.now();
    const queued = await wv(client, `(async () => {
      const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null;
      try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); }
    })()`);
    check("S7 queuePrompt 发出(真前端)", queued === "queued", String(queued));
    if (queued !== "queued") throw new Error("queuePrompt 未发出,链路断");
    cap = await captureOurShot(engineBase, knownPids, truth, 20_000);
    if (cap.prompt) writeFileSync(join(TMP, "queued-prompt.json"), JSON.stringify(cap.prompt, null, 1));
    check("S7 排队图抓拍(装配域 FinalOutput+本前缀 SaveImage)", Boolean(cap.prompt),
      cap.prompt ? `pid=${String(cap.pid).slice(0, 8)} 节点=${Object.keys(cap.prompt).length}` : "未捕到(秒完/异拍,靠 history 新 pid 兜底)");
    // ── S7b 排队图类型闸(1005 晚案:首枪 base=人物=序列化旧值回流,型置值必须以排队图为事实门) ──
    const queuedBase = () => {
      try {
        const p = cap.prompt || JSON.parse(readFileSync(join(TMP, "queued-prompt.json"), "utf8"));
        const k = Object.keys(p).find((x) => p[x]?.class_type === "MyQi21DaojieBase");
        return k ? String(p[k]?.inputs?.base) : null;
      } catch { return null; }
    };
    let qBase = queuedBase();
    if (qBase !== bases.chosen) {
      log(`S7b 排队图 base=${qBase} ≠ 目标 ${bases.chosen}——撤销错枪+补写 input.widget.value+重排队`);
      if (cap.pid) {
        knownPids.add(cap.pid);
        try { await fetch(`${engineBase}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [cap.pid] }), signal: AbortSignal.timeout(8000) }); log("S7b 错枪已撤销"); }
        catch { log("S7b 错枪撤销失败,pid 已入排除表照走"); }
      }
      await wv(client, `(() => {
        const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.asmId)});
        if (!host) return 'no-host';
        for (const inp of (host.inputs || [])) {
          if (inp.widget && inp.widget.name === '型选择') inp.widget.value = ${JSON.stringify(bases.chosen)};
          if (inp.widget && inp.widget.name === 'PE启用?') inp.widget.value = false;
        }
        return 're-fixed';
      })()`);
      const reQ = await wv(client, `(async () => { try { await window.app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); } })()`);
      log(`S7b 重排队: ${reQ}`);
      cap = await captureOurShot(engineBase, knownPids, truth, 20_000);
      if (cap.prompt) writeFileSync(join(TMP, "queued-prompt.json"), JSON.stringify(cap.prompt, null, 1));
      qBase = queuedBase();
    }
    check("S7b 排队图类型闸(queued base=目标型)", qBase === bases.chosen, `queued.base=${qBase} 目标=${bases.chosen}`);
    if (qBase !== bases.chosen) throw new Error("排队图类型闸未过:置值路径未凑效——宁响亮终止不出假门禁");
    hist = await waitTerminal(engineBase, knownPids, "S7", cap.pid, async () => await wv(client, `location.origin`));
    if (hist && hist.base) engineBase = hist.base;
    wallSecs = Math.round((Date.now() - t0) / 1000);
    if (hist.error) {
      check("S7 引擎执行完成(/history success)", false, String(hist.error).slice(0, 2000));
      extractNote = `引擎未出成功终态: ${String(hist.error).slice(0, 300)}`;
    } else {
      writeFileSync(join(TMP, "history-entry.json"), JSON.stringify(hist.entry, null, 1));
      check("S7 引擎执行完成(/history success)", true, `pid=${String(hist.pid).slice(0, 8)} ${wallSecs}s`);
    }

    // ── S8 ④主判据:三短语计数各==1 ──
    step("S8", "主判据:去重后正向文本三短语计数");
    if (!hist || hist.error) {
      check("S8 [401] merged 正向段可取", false, "前置断(S7 无成功终态),判据未执行");
    } else {
      const ex = extractPositive(hist.entry);
      merged = ex.merged; posText = ex.positive;
      if (posText == null) {
        extractNote = merged == null
          ? `history outputs 无 merged 载荷 keys=${JSON.stringify(Object.keys(hist.entry.outputs || {})).slice(0, 200)}`
          : "merged 无正向分段标记(预览节点版本漂移?)";
        check("S8 [401] merged 正向段可取(OUTPUT_NODE ui 载荷)", false, extractNote);
      } else {
        check("S8 [401] merged 正向段可取(OUTPUT_NODE ui 载荷)", true, `正向段 ${posText.length} 字`);
        counts = { HEAD: countOf(posText, NEEDLE_HEAD), ALPHA: countOf(posText, NEEDLE_ALPHA), W1: countOf(posText, NEEDLE_W1) };
        const gates = [
          [`④「${NEEDLE_HEAD}」count==1`, counts.HEAD === 1, `实际=${counts.HEAD}`],
          [`④「${NEEDLE_ALPHA}」count==1`, counts.ALPHA === 1, `实际=${counts.ALPHA}`],
          [`④「${NEEDLE_W1}」count==1`, counts.W1 === 1, `实际=${counts.W1}`],
        ];
        for (const [name, pass, detail] of gates) check(name, pass, detail);
        dedupOk = gates.every((g) => g[1]);
        if (!dedupOk) { // 任务令:任一不满足→打印实际文本前后 80 字
          for (const [needle, c] of [[NEEDLE_HEAD, counts.HEAD], [NEEDLE_ALPHA, counts.ALPHA], [NEEDLE_W1, counts.W1]]) {
            if (c !== 1) log(`❌ 实况「${needle}」count=${c}: ${ctxAround(posText, needle)}`);
          }
        } else log("✅ 去重生效:三短语各恰好 1 次(修复前各 2 次)");
      }
    }

    // ── S11 预览框回填门(显示层端到端:[401] 合并预览框由 web JS onExecuted 回填, ──
    //    与 S8 的服务端 history 文本互为独立证据;widget 标记 __myPreviewDisplay)
    step("S11", "预览框回填门(webview 显示层 [401] 合并预览框)");
    if (!hist || hist.error) {
      check("S11 显示控件值可读(subgraph→canvas 回退)", false, "前置断(S7 无成功终态),回填门未执行");
    } else {
      // /history 终态与前端 onExecuted(websocket)可能有秒级竞态:短轮询收口,取到即停
      let s11raw = null;
      for (let i = 0; i < 6; i++) {
        s11raw = await wv(client, `(() => {
          const host = window.app.graph._nodes.find(n => n.type === ${JSON.stringify(truth.asmId)});
          const sg = host && host.subgraph;
          let pvn = sg && sg.nodes && sg.nodes.find(n => n.type === "MyQi21PromptPreview");
          let via = "host.subgraph";
          if (!pvn) { // 回退:子图打开态时 canvas.graph 即子图内部图
            const cg = window.app.canvas && window.app.canvas.graph;
            pvn = cg && (cg._nodes || cg.nodes || []).find(n => n.type === "MyQi21PromptPreview");
            via = "canvas.graph";
          }
          const w = pvn && pvn.widgets && pvn.widgets.find(x => x.__myPreviewDisplay);
          const text = String((w && w.value) || "");
          if (text) return JSON.stringify({ text: text, via: via });
          return JSON.stringify({ text: "", via: via, diag: {
            hostFound: !!host,
            hostKeys: host ? Object.keys(host).join("|").slice(0, 300) : null,
            hostWidgets: host && host.widgets ? host.widgets.map(x => x.name).join(",") : null,
            sgNodes: sg && sg.nodes ? sg.nodes.length : null,
            pvnFound: !!pvn,
            pvnWidgets: pvn && pvn.widgets ? pvn.widgets.map(x => x.name).join(",") : null } });
        })()`);
        let r = null; try { r = JSON.parse(String(s11raw)); } catch { /* keep null */ }
        if (r && r.text) break;
        log(`S11 显示框未取到/未回填(第${i + 1}次)——${s11raw == null ? "wv 执行异常" : String(s11raw).slice(0, 160)}`);
        await sleep(2000);
      }
      let s11 = null; try { s11 = JSON.parse(String(s11raw)); } catch { /* keep null */ }
      const s11Text = s11 && typeof s11.text === "string" ? s11.text : "";
      if (s11Text) {
        check("S11 显示控件值可读(subgraph→canvas 回退)", true, `via=${s11.via} 长度=${s11Text.length}`);
        check("S11 预览框回填门1 显示值长度>300", s11Text.length > 300, `实际=${s11Text.length}`);
        const s11Hit = s11Text.includes(NEEDLE_HEAD);
        check(`S11 预览框回填门2 含透明头句「${NEEDLE_HEAD}」`, s11Hit,
          s11Hit ? `count=${countOf(s11Text, NEEDLE_HEAD)}` : ctxAround(s11Text, NEEDLE_HEAD));
      } else {
        check("S11 显示控件值可读(subgraph→canvas 回退)", false,
          `双路径均未取到显示控件值——诊断(host 键名/widgets 名单) ${String(s11raw).slice(0, 400)}`);
      }
    }

    // ── S9 ⑤alpha 三门(mode==RGBA/四角 alpha≤8/PNG 取证成功)+ /view 取证落盘 ──
    step("S9", "输出 PNG alpha 三门(RGBA/四角≤8/取证成功)");
    let pngOk = false;
    if (hist && !hist.error) {
      const imgs = [];
      for (const [k, o] of Object.entries(hist.entry.outputs || {})) if (o.images) imgs.push({ key: k, arr: o.images });
      const png = (imgs.find((x) => x.key === "8") || imgs[0])?.arr
        ?.filter((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename || ""))[0] || null;
      let pngBuf = null;
      if (png) {
        pngFilename = png.filename;
        try {
          const q = new URLSearchParams({ filename: png.filename, subfolder: png.subfolder || "", type: png.type || "output" });
          const r = await fetch(`${engineBase}/view?${q}`, { signal: AbortSignal.timeout(15_000) });
          if (r.ok) pngBuf = Buffer.from(await r.arrayBuffer());
        } catch { /* 落文件系统兜底 */ }
        if (!pngBuf && existsSync(join(ENGINE_OUTPUT, png.subfolder || "", png.filename))) {
          pngBuf = readFileSync(join(ENGINE_OUTPUT, png.subfolder || "", png.filename));
        }
      }
      if (pngBuf) {
        writeFileSync(outPngPath, pngBuf);
        pngOk = true;
        const ap = alphaProbe(outPngPath);
        alphaPy = ap.py || "-"; alphaOut = ap.out;
      } else {
        alphaOut = "无输出图可取";
      }
    } else {
      alphaOut = "前置断(S7 无成功终态),无 PNG 可探";
    }
    // 三门(1005 升门:任一不过=FAIL 进 results,参与 exit code;探针输出为一行 JSON)
    let alphaInfo = null;
    try { alphaInfo = JSON.parse(String(alphaOut)); } catch { alphaInfo = null; }
    const corners = Array.isArray(alphaInfo?.corners) ? alphaInfo.corners : [];
    check("⑤ alpha 门1 PNG 取证成功", pngOk, pngOk ? `${outPngPath}(${pngFilename})` : String(alphaOut).slice(0, 160));
    check("⑤ alpha 门2 mode==RGBA", alphaInfo?.mode === "RGBA", `mode=${alphaInfo?.mode ?? "?"}`);
    check("⑤ alpha 门3 四角 alpha 全≤8",
      corners.length === 4 && corners.every((c) => Array.isArray(c) && c.length >= 4 && Number(c[3]) <= 8),
      corners.length ? JSON.stringify(corners) : `corners=${corners.length}(需 4)`);
    log(`⑤ alpha(${alphaPy}): ${alphaOut.split("\n").join(" | ").slice(0, 280)}`);
  } catch (e) {
    fatal = String(e?.message || e).slice(0, 400);
    log("致命中断:", fatal);
    results.push({ name: "致命中断(段链断裂)", pass: false, detail: fatal });
  }

  // ── S10 ⑥证据落盘(dedup-livefire.md)+ 收摊 ──
  try {
    step("S10", "证据落盘 dedup-livefire.md");
    await client.screenshot("dedup-livefire-canvas");
    const instDecl = existsSync(INST_FINAL_OUT) ? String(readFileSync(INST_FINAL_OUT, "utf8")).split("_ZH_ALPHA_DECL").length - 1 : -1;
    const md = [
      `# qi21 提示词去重实弹验证(dedup-livefire)`,
      ``,
      `- 生成: ${new Date().toISOString()}`,
      `- 驱动: \`node apps/build/scripts/qi21-dedup-livefire.mjs\`(KEEP_APP=${KEEP_APP ? 1 : 0},GEN_TIMEOUT_MS=${GEN_TIMEOUT_MS})`,
      `- CDP 口: ${CDP_PORT} / 引擎口: ${engineBase ?? "?"} / 执行用时: ${wallSecs}s / 队列 pid: ${hist?.pid ? String(hist.pid).slice(0, 12) : "-"}`,
      `- 真源: ${TRUTH_WF_PATH}(根节点=${truth.rootCount},SaveImage 前缀=${truth.savePrefix})`,
      fatal ? `- 致命中断: ${fatal}` : ``,
      ``,
      `## 型选择(②,json 为准)`,
      ``,
      `- 源: \`${BASES_JSON}\`(${bases.typeCount} 型)`,
      `- rgba_default=true 型: ${bases.trueTypes.join("、")}`,
      `- 实选: **${bases.chosen}**(预期「道具」${bases.chosen === "道具" ? "命中" : "未命中,以 json 为准"})`,
      `- [6] widget 置值: 型选择 ${set6?.oldT ?? "?"}→${set6?.nowT ?? "?"},PE启用? ${set6?.oldPE ?? "?"}→${set6?.nowPE ?? "?"}(装机默认 ${JSON.stringify(truth.def6)})`,
      `- 破缓存: 加速宿主 seed ${seedSet && !seedSet.err ? `${seedSet.old}→${seedSet.now}` : "未拨(best-effort)"}`,
      ``,
      `## ④ 主判据:去重后正向文本三短语计数(机器门)`,
      ``,
      counts
        ? [
            `- 「${NEEDLE_HEAD}」count=${counts.HEAD}(期望 1)→ ${counts.HEAD === 1 ? "PASS" : "FAIL"}`,
            `- 「${NEEDLE_ALPHA}」count=${counts.ALPHA}(期望 1)→ ${counts.ALPHA === 1 ? "PASS" : "FAIL"}`,
            `- 「${NEEDLE_W1}」count=${counts.W1}(期望 1)→ ${counts.W1 === 1 ? "PASS" : "FAIL"}`,
            `- **判定: ${dedupOk ? "PASS(修复前头/尾各 2 次,去重后各 1 次)" : "FAIL"}**`,
          ]
        : [`- **判定: FAIL(正向终稿未取到)—— ${extractNote ?? "前置断"}**`],
      ``,
      `### 实际正向文本([401] merged 正向段 ≡ TextEncodeQwenImage21 正向输入)`,
      ``,
      "```",
      posText ?? "(未取到——见上判定行)",
      "```",
      ``,
      `## ⑤ alpha 三门(mode==RGBA/四角 alpha≤8/PNG 取证成功)`,
      ``,
      `- python: \`${alphaPy}\``,
      `- 输出 PNG: ${pngFilename ? `${outPngPath}(${pngFilename})` : "无"}`,
      "```",
      alphaOut,
      "```",
      ``,
      `## 证据链与附注`,
      ``,
      `- 取证位: [401] MyQi21PromptPreview(OUTPUT_NODE,ui.merged)正向段;其正向输入←[6].out[0]←[4014].进编码正向文本,与 [4015] 主编码 .prompt 同一根(workflow link18/link208 已对拍)`,
      `- 中间件: 排队图 ${TMP}/queued-prompt.json;history ${TMP}/history-entry.json`,
      `- 装机 my_qi21_final_output.py 内 _ZH_ALPHA_DECL 出现次数=${instDecl}(1=仅退役定义,插入已删;≥2=仍插入)`,
      `- 断言短语×json rgba 节交叉核对: ${JSON.stringify(bases.needlesInJson)}(false=漂移提醒)`,
      `- 画布截图: ${OUT_DIR}/dedup-livefire-canvas.png;置值后截图: ${OUT_DIR}/dedup-livefire-widgets.png`,
      `- 全部检查(${results.filter((r) => r.pass).length}/${results.length} PASS):`,
      ...results.map((r) => `  - [${r.pass ? "x" : " "}] ${r.name}${r.detail ? ` — ${String(r.detail).slice(0, 160)}` : ""}`),
      ``,
    ].flat().join("\n");
    writeFileSync(join(OUT_DIR, "dedup-livefire.md"), md);
    log(`⑥ 证据: ${join(OUT_DIR, "dedup-livefire.md")}`);
  } catch (e) { log("证据落盘异常:", String(e?.message || e).slice(0, 200)); }

  const fails = results.filter((r) => !r.pass);
  const dedupLine = counts ? (dedupOk ? "去重门 PASS" : "去重门 FAIL") : "去重门 FAIL(未取到)";
  console.log(`\n═══ 结果: ${results.length - fails.length}/${results.length} PASS(${dedupLine}) ═══`);
  for (const f of fails) console.log(`FAIL  ${f.name} — ${f.detail}`);
  process.exitCode = fails.length ? 1 : 0;
  if (!counts) { process.exitCode = 1; log("判据未执行(正稿未取到)——强制 exit 1 防假绿"); }
  log(`exit=${process.exitCode}`);
  if (!KEEP_APP) {
    log("收摊:关 App(KEEP_APP=1 可留)");
    quitApp();
  } else log("App 留驻(KEEP_APP=1)");
  try { client.close(); } catch { /* 已关 */ }
}

main().catch((e) => {
  console.error("炸了:", String(e && (e.message || e)).slice(0, 400));
  if (!KEEP_APP) quitApp(); // e2e 同款:致命退出也收摊
  process.exit(1);
});
