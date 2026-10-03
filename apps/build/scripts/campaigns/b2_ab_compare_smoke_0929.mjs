#!/usr/bin/env node
/**
 * 实弹验收 0929 B2 — MyImageABCompare / MyVideoABCompare 两件真前端现场冒烟:
 *   ① 注册与扩展面:/object_info 双键 + /extensions 双 js(驱动外已 curl 存证);
 *   ② 菜单可加:空画布真双击 → 节点搜索框输入 MyImageABCompare → Enter 落节点;
 *   ③ 图冒烟:LoadImage(红/蓝 64×64)×2 → MyImageABCompare → history ui.abCompare
 *      (type=temp 双帧引用) + temp 落盘像素对账 + /view 200;
 *   ④ 视频冒烟:LoadVideo(8f@12fps / 8f@25fps)×2 → MyVideoABCompare →
 *      ui.abCompare 帧数/帧率/时长/声道元数据 + temp mp4 + /view 200;
 *   ⑤ 帘拖动一档(真实 CDP 鼠标):图件=canvas 命中路(node.onMouseDown/Move/Up
 *      全链),视频件=DOM 手柄 pointerdown/move/up;断言 properties 帘位迁移;
 *   ⑥ 全程控制台零报错门禁(graph ready 后;装载期噪音单列)。
 * 驱动仿 apps/build/scripts/fire0929_node_smoke.mjs(B1/B3 同族);引擎生命周期
 * 在驱动外管理。用法:node apps/build/scripts/b2_ab_compare_smoke_0929.mjs;
 * 退出码 0=全绿 1=有失败 2=环境错。
 */
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const execFileP = promisify(execFile);

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17001";
const CDP_PORT = Number(process.env.CDP_PORT || 9372);
const OUT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/output/b2-smoke-0929`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// 每跑一版全新 profile:复用旧 profile 会带磁盘缓存,改版扩展 JS 后读到旧件
const CHROME_PROFILE = mkdtempSync(join(tmpdir(), "b2-smoke-chrome-"));
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const HOME_INPUT = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/input`;
// 引擎 temp 真位=源码家 temp(folder_paths.py:70 base_path 拼接,--output-directory 不改它)
const HOME_TEMP = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/ComfyUI/temp`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch (e) { return 'ERR:' + (e && e.message); } })()`;
const results = [];
const consoleErrors = [];
let graphReadyAt = 0;
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 3000) });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
};

let chromeProc = null;
function launchChrome() {
  chromeProc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_PROFILE}`,
    "--window-size=1720,1050", "--no-first-run", "--no-default-browser-check",
    "--disable-crash-reporter", "--disable-background-timer-throttling",
    "--autoplay-policy=no-user-gesture-required", ENGINE,
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
    mouse(type, x, y, extra = {}) {
      return send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });
    },
    async keyEnter() {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
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

async function loadGraph(page, name, graphJson) {
  return page.ev(`(async () => {
    const app = window.app;
    if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
    app.loadGraphData(${JSON.stringify(graphJson)}, true, true, ${JSON.stringify(name)});
    return 'opened';
  })()`);
}

/** 节点定位按 id(精确,双同型节点图必需)退 type;widget 按 name 设值。 */
function setWidget(page, type, wname, value, nodeId) {
  return page.ev(`(() => {
    const ns = window.app.graph._nodes.filter(n => n.type === ${JSON.stringify(type)});
    const n = ${nodeId ? `ns.find(n => n.id === ${JSON.stringify(nodeId)}) || ns[0]` : "ns[0]"};
    if (!n) return 'node-missing:' + ${JSON.stringify(type)};
    if (!n.widgets) return 'no-widgets:' + n.type;
    const w = n.widgets.find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + n.widgets.map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set@' + n.id + ':' + w.name + '=' + String(w.value);
  })()`);
}

/** 按宿主输入链定位源节点设值(loadGraphData 会改节点 id,type 序不稳;
 *  链路=宿主 inputs[name].link → links[l].origin_id,结构性精确)。 */
function setWidgetByLink(page, hostType, inputName, wname, value) {
  return page.ev(`(() => {
    const g = window.app.graph;
    const host = g._nodes.find(n => n.type === ${JSON.stringify(hostType)});
    if (!host) return 'host-missing:' + ${JSON.stringify(hostType)};
    const input = (host.inputs || []).find(i => i.name === ${JSON.stringify(inputName)});
    const link = input && input.link != null && g.links.get(input.link);
    const src = link && g._nodes.find(n => n.id === link.origin_id);
    if (!src) return 'src-missing(input=' + ${JSON.stringify(inputName)} + ')';
    const w = (src.widgets || []).find(w => w.name === ${JSON.stringify(wname)});
    if (!w) return 'widget-missing:' + src.type + '/' + (src.widgets || []).map(x => x.name).join(',');
    w.value = ${JSON.stringify(value)};
    try { w.callback && w.callback(w.value); } catch (e) { /* combo callback 可选 */ }
    return 'set@' + src.id + '(' + src.type + '):' + w.name + '=' + String(w.value);
  })()`);
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

async function waitNewHistory(knownPids, { timeout = 120_000 } = {}) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeout) {
    try {
      const h = await (await fetch(`${ENGINE}/history`)).json();
      for (const [pid, e] of Object.entries(h)) {
        if (knownPids.has(pid)) continue;
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { pid, error: `引擎执行 error: ${JSON.stringify(e.status?.messages || []).slice(0, 8000)}` };
        }
        if (st === "success" || e.status?.completed) {
          return { pid, entry: e, status: st, messages: e.status?.messages };
        }
      }
    } catch (e) { lastErr = String(e); }
    await sleep(3000);
  }
  return { error: `history 超时 ${timeout / 1000}s(lastErr=${lastErr})` };
}

async function viewStatus(filename, subfolder = "", type = "temp") {
  const url = `${ENGINE}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  const r = await fetch(url);
  return { status: r.status, contentType: r.headers.get("content-type") || "", url };
}

async function tempFileCheck(filesJson, expectJson) {
  const { stdout } = await execFileP(VENV_PY, ["-c", `
import json, sys, os
from PIL import Image
files = json.loads(sys.argv[1]); expect = json.loads(sys.argv[2])
base = ${JSON.stringify(HOME_TEMP)}
out = []
for rel, (w, h, rgb, tol) in zip(files, expect):
    p = os.path.join(base, rel)
    if not os.path.exists(p):
        out.append({"file": rel, "exists": False}); continue
    im = Image.open(p).convert("RGB")
    px = im.getpixel((im.width // 2, im.height // 2))
    diffs = [abs(a - b) for a, b in zip(px, rgb)]
    out.append({"file": rel, "exists": True, "size": im.size, "center_px": list(px),
                "expect": list(rgb), "maxdiff": max(diffs), "ok": im.size == (w, h) and max(diffs) <= tol})
print(json.dumps(out))
`, JSON.stringify(filesJson), JSON.stringify(expectJson)]);
  return JSON.parse(stdout);
}

// ── 冒烟图 ①:LoadImage(红)×LoadImage(蓝)→ MyImageABCompare ──────────
const IMG_GRAPH = {
  id: "b2-smoke-image-ab",
  nodes: [
    { id: 1, type: "LoadImage", pos: [60, 200], size: [270, 314], flags: {}, order: 0, mode: 0,
      inputs: [{ name: "upload", type: "IMAGE", link: null }],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }, { name: "MASK", type: "MASK", links: null }],
      properties: { "Node name for S&R": "LoadImage" },
      widgets_values: ["fire0929b2_imgA_red.png", "image"] },
    { id: 2, type: "LoadImage", pos: [60, 600], size: [270, 314], flags: {}, order: 1, mode: 0,
      inputs: [{ name: "upload", type: "IMAGE", link: null }],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [2] }, { name: "MASK", type: "MASK", links: null }],
      properties: { "Node name for S&R": "LoadImage" },
      widgets_values: ["fire0929b2_imgB_blue.png", "image"] },
    { id: 3, type: "MyImageABCompare", pos: [430, 300], size: [340, 300], flags: {}, order: 2, mode: 0,
      inputs: [
        { name: "image_a", type: "IMAGE", link: 1 },
        { name: "image_b", type: "IMAGE", link: 2 },
        { name: "label_a", type: "STRING", link: null, widget: { name: "label_a" } },
        { name: "label_b", type: "STRING", link: null, widget: { name: "label_b" } },
      ],
      outputs: [
        { name: "image_a", type: "IMAGE", links: null },
        { name: "image_b", type: "IMAGE", links: null },
      ],
      properties: { "Node name for S&R": "MyImageABCompare" },
      widgets_values: ["旧版", "新版"] },
  ],
  links: [[1, 1, 0, 3, 0, "IMAGE"], [2, 2, 0, 3, 1, "IMAGE"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

// ── 冒烟图 ②:LoadVideo(8f@12)×LoadVideo(8f@25)→ MyVideoABCompare ────
const VID_GRAPH = {
  id: "b2-smoke-video-ab",
  nodes: [
    { id: 1, type: "LoadVideo", pos: [60, 200], size: [320, 320], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [1] }],
      properties: { "Node name for S&R": "LoadVideo" },
      widgets_values: ["fire0929b2_vidA_8f_12fps.mp4"] },
    { id: 2, type: "LoadVideo", pos: [60, 600], size: [320, 320], flags: {}, order: 1, mode: 0,
      inputs: [], outputs: [{ name: "VIDEO", type: "VIDEO", links: [2] }],
      properties: { "Node name for S&R": "LoadVideo" },
      widgets_values: ["fire0929b2_vidB_8f_25fps.mp4"] },
    { id: 3, type: "MyVideoABCompare", pos: [470, 300], size: [340, 300], flags: {}, order: 2, mode: 0,
      inputs: [
        { name: "video_a", type: "VIDEO", link: 1 },
        { name: "video_b", type: "VIDEO", link: 2 },
        { name: "label_a", type: "STRING", link: null, widget: { name: "label_a" } },
        { name: "label_b", type: "STRING", link: null, widget: { name: "label_b" } },
      ],
      outputs: [
        { name: "video_a", type: "VIDEO", links: null },
        { name: "video_b", type: "VIDEO", links: null },
      ],
      properties: { "Node name for S&R": "MyVideoABCompare" },
      widgets_values: ["12fps 路", "25fps 路"] },
  ],
  links: [[1, 1, 0, 3, 0, "VIDEO"], [2, 2, 0, 3, 1, "VIDEO"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

async function main() {
  try {
    const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
    log("引擎就绪:", alive.system?.comfyui_version);
  } catch (e) { console.error("引擎探活失败:", e.message); process.exit(2); }

  launchChrome();
  const page = await getPageClient();
  log("前端 target 已连接");
  const graphReady = await waitFor(() => page.ev(vis(`window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`)),
    { timeout: 120_000, interval: 2000, label: "ComfyUI 前端就绪" });
  graphReadyAt = Date.now();
  check("引擎前端就绪(app.isGraphReady)", graphReady === "ready", String(graphReady));
  await sleep(2500);

  // ══ ② 菜单可加:空画布 → 真双击搜索框 → 输入 → Enter ══
  await loadGraph(page, "b2-empty", { id: "b2-empty", nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 });
  await sleep(1200);
  const inputsBeforeSig = await page.ev(vis(`JSON.stringify(Array.from(document.querySelectorAll('input')).map(i => i.placeholder + '|' + i.type + '|' + (i.id || '') + '|' + (i.className || '')))`));
  const beforeSet = new Set(JSON.parse(inputsBeforeSig));
  const canvasRect = await page.ev(vis(`(() => { const r = window.app.canvas.canvas.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width * 0.35, y: r.top + r.height * 0.4, w: r.width, h: r.height }); })()`));
  const cr = JSON.parse(canvasRect);
  await page.mouse("mousePressed", cr.x, cr.y, { button: "left", clickCount: 1 });
  await page.mouse("mouseReleased", cr.x, cr.y, { button: "left", clickCount: 1 });
  await page.mouse("mousePressed", cr.x, cr.y, { button: "left", clickCount: 2 });
  await page.mouse("mouseReleased", cr.x, cr.y, { button: "left", clickCount: 2 });
  await sleep(1200);
  // 双盒型通吃:经典 litegraph 盒(.lite-searchbox input)或 V2 弹层=双击后新出现的 input
  const searchBox = await page.ev(`(() => {
    try {
    const known = ${JSON.stringify([...beforeSet])};
    const sig = (i) => i.placeholder + '|' + i.type + '|' + (i.id || '') + '|' + (i.className || '');
    const classic = document.querySelector('.lite-searchbox input');
    const all = Array.from(document.querySelectorAll('input'));
    const fresh = all.filter(i => !known.includes(sig(i)) && i.offsetParent !== null);
    const box = classic || fresh[fresh.length - 1];
    if (!box) return 'no-searchbox;total=' + all.length + ';fresh=' + fresh.length;
    const r = box.getBoundingClientRect();
    if (!r.width) return 'zero-rect-searchbox:' + box.className;
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, ph: box.placeholder || box.className });
    } catch (e) { return 'ERR:' + (e && e.message); }
  })()`);
  let menuAdded = false;
  if (searchBox.startsWith("{")) {
    const sb = JSON.parse(searchBox);
    await page.mouse("mousePressed", sb.x, sb.y, { button: "left", clickCount: 1 });
    await page.mouse("mouseReleased", sb.x, sb.y, { button: "left", clickCount: 1 });
    await sleep(300);
    await page.send("Input.insertText", { text: "MyImageABCompare" });
    await sleep(900);
    await page.keyEnter();
    await sleep(1200);
    menuAdded = await page.ev(vis(`window.app.graph._nodes.some(n => n.type === 'MyImageABCompare') ? 'yes' : 'no'`)) === "yes";
    check("② 双节点可从菜单添加(真双击搜索框→输入→Enter 落 MyImageABCompare)", menuAdded,
      `searchbox=${sb.ph}`);
    // 关搜索框(Escape)+验证画布顶面无残留遮罩(elementFromPoint=CANVAS)
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(600);
    const topEl = await page.ev(vis(`(() => {
      const r = window.app.canvas.canvas.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? el.tagName + '.' + String(el.className).slice(0, 50) : 'null';
    })()`));
    check("② 搜索框已散场,画布顶面无遮罩(elementFromPoint=CANVAS)", String(topEl).startsWith("CANVAS"), String(topEl));
  } else {
    check("② 双节点可从菜单添加(真双击搜索框→输入→Enter 落 MyImageABCompare)", false, String(searchBox));
  }

  // ══ ③ 图冒烟 ══
  const opened1 = await loadGraph(page, "b2-冒烟-图对比审片", IMG_GRAPH);
  check("③ 工作流载入(前端 loadGraphData,临时图)", opened1 === "opened", String(opened1));
  await sleep(1500);
  const rA = await setWidgetByLink(page, "MyImageABCompare", "image_a", "image", "fire0929b2_imgA_red.png");
  const rB = await setWidgetByLink(page, "MyImageABCompare", "image_b", "image", "fire0929b2_imgB_blue.png");
  const rLa = await setWidget(page, "MyImageABCompare", "label_a", "旧版");
  const rLb = await setWidget(page, "MyImageABCompare", "label_b", "新版");
  check("③ 画布设值: 双 LoadImage + label_a/b", [rA, rB, rLa, rLb].every((r) => String(r).startsWith("set")),
    [rA, rB, rLa, rLb].map(String).join(" | ").slice(0, 240));
  const extApplied = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
    if (!n) return 'node-missing';
    const state = n.properties && n.properties.myAbImage;
    const w = (n.widgets || []).find(w => w.name === 'my_ab_image_stage');
    return JSON.stringify({
      stateDefault: Boolean(state) && state.curtain === 0.5 && state.lensOn === false,
      onMouseDownPatched: typeof n.onMouseDown === 'function' && n.onMouseDown.toString().includes('__myAbHits'),
      placeholderWidget: Boolean(w),
      widgetMouseDeployed: Boolean(w) && typeof w.mouse === 'function',
    });
  })()`));
  check("③ 扩展件生效(my.abcompare.image):缺省态/交互 patch/占位 widget/画布派发", (() => {
    if (typeof extApplied !== "string" || !extApplied.startsWith("{")) return false;
    const o = JSON.parse(extApplied); return o.stateDefault && o.onMouseDownPatched && o.placeholderWidget && o.widgetMouseDeployed;
  })(), String(extApplied));

  const known1 = await historyPids();
  await sleep(800);
  const q1 = await queuePrompt(page);
  check("③ queuePrompt 发出(真前端)", q1 === "queued", String(q1));
  const h1 = await waitNewHistory(known1, { timeout: 120_000 });
  let imgAB = null;
  if (h1.error) {
    check("③ 引擎执行完成", false, h1.error.slice(0, 3000));
  } else {
    check("③ 引擎执行完成", true, `pid=${String(h1.pid).slice(0, 8)} status=${h1.status}`);
    const rawAB = Object.values(h1.entry.outputs || {}).find((o) => o && Array.isArray(o.abCompare))?.abCompare || null;
    imgAB = rawAB ? { a: rawAB.find((p) => p.side === "a"), b: rawAB.find((p) => p.side === "b"), raw: rawAB } : null;
    check("③ history outputs 含 ui.abCompare(引擎契约=双元素列表[侧a,侧b])", Boolean(imgAB && imgAB.a && imgAB.b && rawAB.length === 2),
      JSON.stringify(rawAB).slice(0, 400));
    if (imgAB?.a && imgAB?.b) {
      const metaOk = imgAB.a.type === "temp" && imgAB.b.type === "temp"
        && imgAB.a.width === 64 && imgAB.a.height === 64 && imgAB.b.width === 64 && imgAB.b.height === 64
        && imgAB.a.batch === 1 && imgAB.b.batch === 1
        && imgAB.a.label === "旧版" && imgAB.b.label === "新版";
      check("③ ui.abCompare 元数据(type=temp/64×64/batch1/标签)", metaOk,
        `a=${JSON.stringify(imgAB.a)} b=${JSON.stringify(imgAB.b)}`);
      const files = [imgAB.a.filename, imgAB.b.filename];
      const px = await tempFileCheck(files, [[64, 64, [255, 0, 0], 6], [64, 64, [0, 0, 255], 6]]);
      check("③ temp 目录双帧落盘+像素对账(红/蓝)", px.every((p) => p.exists && p.ok),
        px.map((p) => `${p.file}:${p.exists ? `${p.size[0]}x${p.size[1]}@${p.center_px}Δ${p.maxdiff}` : "缺失"}`).join(" ; "));
      const v1 = await viewStatus(imgAB.a.filename, imgAB.a.subfolder);
      const v2 = await viewStatus(imgAB.b.filename, imgAB.b.subfolder);
      check("③ /view 取 temp 双帧 200+png", v1.status === 200 && v2.status === 200
        && v1.contentType.includes("image/png") && v2.contentType.includes("image/png"),
        `a=${v1.status}/${v1.contentType} b=${v2.status}/${v2.contentType}`);
    }
    // onExecuted 前端接住 → properties.myAbImage.a/b 落位(真实前端钩子)
    const propAfter = await waitFor(() => page.ev(vis(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
      const s = n && n.properties && n.properties.myAbImage;
      return (s && s.a && s.b) ? JSON.stringify({ curtain: s.curtain, a: s.a.filename }) : null; })()`)),
      { timeout: 20_000, interval: 1000, label: "onExecuted→properties" });
    check("③ onExecuted 前端接住(properties.myAbImage.a/b 落位)", String(propAfter).includes(".png"), String(propAfter));
  }

  // ══ ⑤a 图件帘拖动一档(真实 CDP 鼠标走 canvas 命中路)══
  const hitsReady = await waitFor(() => page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const h = n && n.__myAbHits;
    return (h && h.divider && h.stage) ? 'yes' : null; })()`)),
    { timeout: 20_000, interval: 1000, label: "__myAbHits 命中缓存(画布绘制)" });
  check("③ 命中缓存 __myAbHits 就绪(真实绘制 pass)", hitsReady === "yes", String(hitsReady));
  const dragGeom = await page.ev(vis(`(() => {
    const cnv = window.app.canvas;
    const n = cnv.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const h = n.__myAbHits; const d = h.divider; const st = h.stage;
    // 本版 litegraph 变换真源(page = rect + (graph + offset) * scale;0929 探针B
    // 以 graph_mouse 反算对拍精确验证)
    const s = cnv.ds.scale, off = cnv.ds.offset;
    const r = cnv.canvas.getBoundingClientRect();
    const toPage = (gx, gy) => [r.left + (gx + off[0]) * s, r.top + (gy + off[1]) * s];
    const [hx, hy] = toPage(n.pos[0] + d.x + d.w / 2, n.pos[1] + d.y + d.h / 2);
    const [tx, ty] = toPage(n.pos[0] + st.x + st.w * 0.28, n.pos[1] + st.y + st.h / 2);
    const elAt = document.elementFromPoint(hx, hy);
    return JSON.stringify({ hx, hy, tx, ty, scale: s, topEl: elAt ? elAt.tagName + '.' + String(elAt.className).slice(0, 50) : 'null' });
  })()`));
  if (String(dragGeom).startsWith("{")) {
    const g = JSON.parse(dragGeom);
    // 仪表:包一层 widget.mouse 观测事件流(留档报证据)
    await page.ev(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
      const w = (n.widgets || []).find(w => w.name === 'my_ab_image_stage');
      window.__b2drag = { calls: 0, downs: 0, last: null };
      if (w && typeof w.mouse === 'function' && !w.__b2wrapped) {
        const om = w.mouse; w.__b2wrapped = true;
        w.mouse = function (e, pos, node) {
          window.__b2drag.calls++;
          if (String(e.type).includes('down')) window.__b2drag.downs++;
          window.__b2drag.last = { type: e.type, buttons: e.buttons, pos: pos ? [pos[0], pos[1]] : null };
          return om.apply(this, arguments);
        };
      }
      return 'wrapped';
    })()`);
    const curtainBefore = await page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyImageABCompare').properties.myAbImage.curtain`));
    await page.mouse("mousePressed", g.hx, g.hy, { button: "left", clickCount: 1, buttons: 1 });
    await sleep(150);
    for (const t of [0.2, 0.5, 0.8]) {
      await page.mouse("mouseMoved", g.hx + (g.tx - g.hx) * t, g.hy + (g.ty - g.hy) * t, { button: "left", clickCount: 1, buttons: 1 });
      await sleep(120);
    }
    await page.mouse("mouseMoved", g.tx, g.ty, { button: "left", clickCount: 1, buttons: 1 });
    await sleep(150);
    await page.mouse("mouseReleased", g.tx, g.ty, { button: "left", clickCount: 1, buttons: 0 });
    await sleep(400);
    const curtainAfter = await page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyImageABCompare').properties.myAbImage.curtain`));
    const flow = await page.ev(vis(`JSON.stringify(window.__b2drag)`));
    const before = Number(curtainBefore), after = Number(curtainAfter);
    check("⑤a 图件帘拖动一档(真实鼠标:widget.mouse pointerdown→move→up 全链)", after < before - 0.1 && Math.abs(after - 0.28) < 0.08,
      `curtain ${before} → ${after}(目标≈0.28;scale=${g.scale};手柄顶元素=${g.topEl};事件流=${flow})`);
  } else {
    check("⑤a 图件帘拖动一档(真实鼠标)", false, String(dragGeom));
  }

  // ══ ④ 视频冒烟 ══
  const opened2 = await loadGraph(page, "b2-冒烟-视频对比审片", VID_GRAPH);
  check("④ 工作流载入(前端 loadGraphData,临时图)", opened2 === "opened", String(opened2));
  await sleep(1500);
  const rV1 = await setWidgetByLink(page, "MyVideoABCompare", "video_a", "file", "fire0929b2_vidA_8f_12fps.mp4");
  const rV2 = await setWidgetByLink(page, "MyVideoABCompare", "video_b", "file", "fire0929b2_vidB_8f_25fps.mp4");
  check("④ 画布设值: 双 LoadVideo(12fps/25fps)", [rV1, rV2].every((r) => String(r).startsWith("set")),
    `${rV1} | ${rV2}`);
  const extV = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare');
    if (!n) return 'node-missing';
    const ui = n.__myAbVideo;
    return JSON.stringify({
      domMounted: Boolean(ui && ui.el && ui.el.isConnected),
      domWidgetSerializeFalse: Boolean(ui && ui.widget && ui.widget.serialize === false),
      stateDefault: Boolean(n.properties && n.properties.myAbVideo && n.properties.myAbVideo.curtain === 0.5),
    });
  })()`));
  check("④ 扩展件生效(my.abcompare.video):DOM 挂载/serialize:false/缺省态", (() => {
    if (typeof extV !== "string" || !extV.startsWith("{")) return false;
    const o = JSON.parse(extV); return o.domMounted && o.domWidgetSerializeFalse && o.stateDefault;
  })(), String(extV));

  const known2 = await historyPids();
  await sleep(800);
  const q2 = await queuePrompt(page);
  check("④ queuePrompt 发出(真前端)", q2 === "queued", String(q2));
  const h2 = await waitNewHistory(known2, { timeout: 180_000 });
  let vidAB = null;
  if (h2.error) {
    check("④ 引擎执行完成", false, h2.error.slice(0, 3000));
  } else {
    check("④ 引擎执行完成", true, `pid=${String(h2.pid).slice(0, 8)} status=${h2.status}`);
    const rawVAB = Object.values(h2.entry.outputs || {}).find((o) => o && Array.isArray(o.abCompare))?.abCompare || null;
    vidAB = rawVAB ? { a: rawVAB.find((p) => p.side === "a"), b: rawVAB.find((p) => p.side === "b"), raw: rawVAB } : null;
    check("④ history outputs 含 ui.abCompare(引擎契约=双元素列表[侧a,侧b])", Boolean(vidAB && vidAB.a && vidAB.b && rawVAB.length === 2),
      JSON.stringify(rawVAB).slice(0, 500));
    if (vidAB?.a && vidAB?.b) {
      const a = vidAB.a, b = vidAB.b;
      const metaOk = a.type === "temp" && b.type === "temp"
        && a.frame_count === 8 && b.frame_count === 8
        && a.frame_rate === 12.0 && b.frame_rate === 25.0
        && Math.abs(a.duration - 8 / 12) < 0.01 && Math.abs(b.duration - 8 / 25) < 0.01
        && a.has_audio === false && b.has_audio === false
        && a.width === 64 && a.height === 48 && b.width === 64 && b.height === 48;
      check("④ ui.abCompare 元数据(8帧/12·25fps/时长/无声道/64×48)", metaOk,
        `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
      const { stdout } = await execFileP("/bin/ls", ["-l", join(HOME_TEMP, a.filename), join(HOME_TEMP, b.filename)]).catch((e) => ({ stdout: String(e.message) }));
      check("④ temp 目录双路 mp4 落盘(非空)", !stdout.includes("No such file") && !stdout.includes(" 0 "), stdout.replace(/\s+/g, " ").slice(0, 300));
      const w1 = await viewStatus(a.filename, a.subfolder);
      const w2 = await viewStatus(b.filename, b.subfolder);
      check("④ /view 取 temp 双路 mp4 200", w1.status === 200 && w2.status === 200,
        `a=${w1.status}/${w1.contentType} b=${w2.status}/${w2.contentType}`);
    }
    const propV = await waitFor(() => page.ev(vis(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare');
      const s = n && n.properties && n.properties.myAbVideo;
      return (s && s.a && s.b) ? JSON.stringify({ frame: s.frame, a: s.a.filename, srcSet: Boolean(n.__myAbVideo && n.__myAbVideo.videoA && n.__myAbVideo.videoA.src) }) : null; })()`)),
      { timeout: 20_000, interval: 1000, label: "onExecuted→properties(video)" });
    const pv = String(propV);
    check("④ onExecuted 前端接住(properties.myAbVideo + <video> src 换源)", pv.includes(".mp4") && pv.includes('"srcSet":true'), pv);
  }

  // ══ ⑤b 视频件帘拖动一档(DOM 手柄 pointer 全链)══
  const handleGeom = await page.ev(vis(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare');
    const ui = n && n.__myAbVideo;
    if (!ui || !ui.handle || !ui.handle.getBoundingClientRect) return 'no-handle';
    const hr = ui.handle.getBoundingClientRect();
    const sr = ui.stage.getBoundingClientRect();
    if (!hr.width || !sr.width) return 'zero-rect:' + JSON.stringify({ hw: hr.width, sw: sr.width });
    return JSON.stringify({ hx: hr.left + hr.width / 2, hy: hr.top + hr.height / 2,
      tx: sr.left + sr.width * 0.3, ty: sr.top + sr.height / 2, sw: sr.width });
  })()`));
  if (String(handleGeom).startsWith("{")) {
    const g = JSON.parse(handleGeom);
    const beforeV = await page.ev(vis(`window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare').properties.myAbVideo.curtain`));
    await page.mouse("mousePressed", g.hx, g.hy, { button: "left", clickCount: 1, buttons: 1 });
    for (const t of [0.3, 0.6, 1]) {
      await page.mouse("mouseMoved", g.hx + (g.tx - g.hx) * t, g.hy, { button: "left", clickCount: 1, buttons: 1 });
      await sleep(120);
    }
    await page.mouse("mouseReleased", g.tx, g.ty, { button: "left", clickCount: 1, buttons: 0 });
    await sleep(400);
    const afterV = await page.ev(vis(`(() => {
      const n = window.app.graph._nodes.find(n => n.type === 'MyVideoABCompare');
      return JSON.stringify({ curtain: n.properties.myAbVideo.curtain, dividerLeft: n.__myAbVideo.divider.style.left });
    })()`));
    const o = JSON.parse(afterV);
    check("⑤b 视频件帘拖动一档(真实鼠标:手柄 pointerdown→move→up)", Number(o.curtain) < Number(beforeV) - 0.1 && Math.abs(Number(o.curtain) - 0.3) < 0.08,
      `curtain ${beforeV} → ${o.curtain}(divider.style.left=${o.dividerLeft})`);
  } else {
    check("⑤b 视频件帘拖动一档(真实鼠标)", false, String(handleGeom));
  }

  // console 留存与汇总
  for (const e of consoleErrors) e.cls = e.ts < new Date(graphReadyAt).toISOString() ? "load-noise" : "workflow-phase";
  writeFileSync(join(OUT_DIR, "smoke-console.json"), JSON.stringify(consoleErrors, null, 2));
  const phaseErrs = consoleErrors.filter((e) => e.cls === "workflow-phase");
  check("全程控制台零报错(graph ready 后)", phaseErrs.length === 0,
    phaseErrs.length ? `${phaseErrs.length} 条;首条: ${String(phaseErrs[0]?.text).slice(0, 200)}` : `0 条(装载期噪音 ${consoleErrors.length - phaseErrs.length} 条另存 smoke-console.json)`);
  writeFileSync(join(OUT_DIR, "smoke-report.json"), JSON.stringify({
    engine: ENGINE, ts: new Date().toISOString(),
    results, consoleErrors,
    uiImage: imgAB, uiVideo: vidAB,
  }, null, 2));

  page.close();
  killChrome();
  log("════ B2 冒烟汇总 ════");
  for (const r of results) log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${String(r.detail).slice(0, 160)}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟失败:", e.message);
  writeFileSync(join(OUT_DIR, "smoke-crash.txt"), String(e?.stack || e));
  killChrome();
  process.exit(1);
});
