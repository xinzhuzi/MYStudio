#!/usr/bin/env node
/**
 * 道劫工作流装机应用批量出图(09-17,用户令「结合之前测试的代码,自己打开项目
 * 跳转到本地模型,使用道劫工作流出图:多人物/场景/道具」)。
 *
 * 复用 cdp-daojie-krea2-ink-e2e.mjs 的装机驱动骨架(prekill→MYSTUDIO_REMOTE_DEBUG
 * 拉起→侧栏「本地模型」→webview→漫影侧栏 repo: 叶子行→真实用户路径打开
 * K2-文生图-道劫),对每个主体:画布设 [50] 主体句 widget + [20] 独立种子 →
 * queuePrompt → 等 K2道劫文生图_ 新图 → 拷贝到 output/daojie_batch_0917/。
 *
 * 幂等:已拷贝产物在盘的主体直接跳过(--force 强制),中断重跑即续。
 * 结束保留应用(用户要看画布),不 prekill;退出码 0=全部主体成图。
 * 断点/耗时:每主体超时 GEN_TIMEOUT_MS(默认 600s,首张含模型冷加载)。
 *
 * --engine-only(09-18 加固):只走好用的前段——prekill→拉起应用→点「启动
 * ComfyUI」→画布就绪即退出码 0;不做任何画布操作、不碰(漫影工作流)侧栏,
 * 应用与引擎保留运行。用途=给引擎直排腿(daojie_batch_engine_0918.py)拉起
 * 引擎。产物全在盘也会照常拉起(幂等早退仅对默认批量模式生效)。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync,
  statSync, mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const APP_BUNDLE_ID = "com.manju2026.manying-studio";
const CH = join(homedir(), "Library/Application Support/漫影工作室/comfyui");
const ENGINE_OUTPUT = join(CH, "output");
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const WF_REL = "1_图片/K2图像/1_文生图/K2-文生图-道劫.json";
const WF_REPO = join(REPO, "apps/backend/engines/comfyui/workflows", WF_REL);
const OUT_DIR = join(REPO, "output/daojie_batch_0917");
const PREFIX = "K2道劫文生图_";
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS || 600_000);
const FORCE = process.argv.includes("--force");
const ENGINE_ONLY = process.argv.includes("--engine-only");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vis = (x) => `(() => { try { return ${x}; } catch { return null; } })()`;

// 主体清单:三人物(手部策略递进:按剑半遮→拢袖全藏→法印暴露=压力测试)+两场景+两道具
const SUBJECTS = [
  {
    file: "01-人物-女剑修-按剑.jpg",
    seed: 20260901,
    prompt: "一位青年女剑修，筑基后期，气质剑意凌厉，肤色温润透亮，五官英朗；墨黑长发束成高马尾垂至腰际，发丝逐层分明；身着素色劲装道袍，月白纯色，腰带束腰，素布质感，衣纹线条流畅；立于画面左三分之一处，面朝右方，右手按于腰间剑柄，目光垂视剑鞘方向，神色沉静；背景淡墨远山，大面积留白。",
  },
  {
    file: "02-人物-中年男修-拢袖.jpg",
    seed: 20260902,
    prompt: "一位中年男修士，元婴初期，气质温润如玉，肤色温润透亮，五官温润；墨黑长发绾成道髻，发丝逐层分明；身着淡青道袍长衫，素布质感，衣纹线条流畅；立于画面右侧三分之一处，面朝左方，双手拢于袖中收在身前，目视前方，神色沉静；背景纯色浅净，大面积留白。",
  },
  {
    file: "03-人物-女修-拂尘法印.jpg",
    seed: 20260903,
    prompt: "一位青年女修士，金丹初期，气质清冷出尘，肤色温润透亮，五官清隽；墨黑长发绾成双丫道髻，发丝逐层分明；身着素色道袍长裙，米白纯色，云锦薄染质感，衣纹线条流畅；位于画面中右，左手持一柄白色拂尘自然垂落，右手手指于胸前掐法印，目光平视前方，神色专注；背景淡墨云雾，大面积留白。",
  },
  {
    file: "04-场景-山水.jpg",
    seed: 20260904,
    prompt: "层叠远山以细墨线勾勒轮廓，淡墨晕染云雾，墨色浓淡干湿层次分明；山石以赭石与石绿低饱和点染，近景一株古松横斜，旧金点缀枝干转折；溪涧以留白作水面，云气大面积流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
  },
  {
    file: "05-场景-道观山门.jpg",
    seed: 20260905,
    prompt: "一座道观山门位于画面中景，重檐以细墨线勾勒层次，檐角旧金点缀；山门前淡墨晕染云雾缭绕，石阶蜿蜒而下，两侧苍松淡墨勾勒；远处山影只以淡墨一抹带过；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
  },
  {
    file: "06-道具-古铜飞剑.jpg",
    seed: 20260906,
    prompt: "一柄古铜飞剑悬于画面正中，剑身以细而稳的墨线勾勒，剑格纹样旧金点缀，剑身罩一层赭石薄染；剑尖旁淡墨云气缭绕流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
  },
  {
    file: "07-道具-丹炉.jpg",
    seed: 20260907,
    prompt: "一只青灰丹炉置于石台之上，炉身以细而稳的墨线勾勒，炉耳旧金点缀，炉口三缕细烟以淡墨晕染升起；炉身暗面隐约有朱砂符纹浮动；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
  },
];

function prekillApp() {
  const cp = require("node:child_process");
  const steps = [
    ["osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]],
    ...["漫影工作室", "漫影工作室 Helper", "manying-studio"].map((n) => ["pkill", ["-x", n]]),
    ["pkill", ["-f", "漫影工作室.app/Contents"]],
    ["pkill", ["-9", "-f", "mystudio-installed-smoke"]],
    ["pkill", ["-f", "漫影工作室/comfyui/ComfyUI/main.py"]],
  ];
  for (const [cmd, args] of steps) {
    try { cp.execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* 可选步骤 */ }
  }
}

function launchApp() {
  const child = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env, MYSTUDIO_REMOTE_DEBUG: "1" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  log("app spawned pid", child.pid);
}

async function getMainClient() {
  let page = null;
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    try {
      const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
      page = list.find((t) => t.type === "page" && !/127\.0\.0\.1/.test(t.url || ""));
      if (page) break;
    } catch { /* 端口未就绪 */ }
    await sleep(1500);
  }
  if (!page) throw new Error("主窗口 target 未出现");
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
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    send,
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
      const path = `/tmp/daojie-batch-${name}.png`;
      try {
        const r = await send("Page.captureScreenshot", { format: "png" });
        if (r && r.data) { writeFileSync(path, Buffer.from(r.data, "base64")); log(`📸 ${path}`); return; }
      } catch { /* 原生兜底 */ }
      try { require("node:child_process").execFileSync("screencapture", ["-x", "-C", path]); } catch { }
    },
  };
}

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

function latestOutput() {
  if (!existsSync(ENGINE_OUTPUT)) return null;
  return readdirSync(ENGINE_OUTPUT)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".png"))
    .map((f) => ({ f, t: statSync(join(ENGINE_OUTPUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0] || null;
}

async function countOutput() {
  if (!existsSync(ENGINE_OUTPUT)) return 0;
  return readdirSync(ENGINE_OUTPUT).filter((f) => f.startsWith(PREFIX) && f.endsWith(".png")).length;
}

/** 画布设 [50] 主体句与 [20] 种子(真实 widget 写入+callback,照 E2E 参考图注入法)。
 * 注意:活图节点 id 是字符串(前端 toNodeId=String,09-18 CDP 实锤:loadGraphData
 * 入参数字 id → configure 后全 string),查找一律 String() 归一再比。 */
async function setSubjectAndSeed(main, prompt, seed) {
  const r = await wv(main, `(() => {
    const g = window.app && window.app.graph;
    if (!g) return 'no-graph';
    const n50 = g._nodes.find(n => String(n.id) === '50' && n.type === 'PrimitiveStringMultiline');
    const n20 = g._nodes.find(n => String(n.id) === '20');
    if (!n50 || !n20 || !n50.widgets || !n20.widgets) return 'nodes-missing:' + (!n50 ? '50' : '20');
    const w50 = n50.widgets.find(w => w.name === 'value');
    const w20 = n20.widgets.find(w => w.name === 'seed');
    if (!w50 || !w20) return 'widgets-missing';
    w50.value = ${JSON.stringify(prompt)};
    try { w50.callback && w50.callback(w50.value); } catch (e) {}
    w20.value = ${seed};
    try { w20.callback && w20.callback(w20.value); } catch (e) {}
    return 'set:' + (n50.widgets.find(w => w.name === 'value').value || '').slice(0, 12) + '/' + n20.widgets.find(w => w.name === 'seed').value;
  })()`);
  return r;
}

/** 画布内容锚:活动图=仓库版道劫(有 [50]主体句/[71]底座/[72]装配/[74]扩架件
 * 且全图无风格库)。节点数无关——09-18 LoRA 扩架后 34 节点,纯数数会再骗一次;
 * [74] 恰好区分用户自改副本(道劫+73=28 节点,无 74-79)。
 * id 比对必须 String() 归一:该前端 build 的 LGraphNode.configure 经 toNodeId
 * 把一切 id 转成字符串(09-18 CDP 现场:数字入参→string 出参),严格 === 数字
 * 恒 false——这正是 09-17 三次「叶子行 ok 但内容锚超时」的根因(画布其实已切,
 * 锚失明)。 */
const DAOJIE_GRAPH_PROBE = `(() => {
  const g = window.app && window.app.graph;
  if (!g || !g._nodes) return null;
  const has = (id, type) => g._nodes.some(n => String(n.id) === String(id) && (type ? n.type === type : true));
  const noLib = !g._nodes.some(n => n.type === 'MyStylesLibrary');
  return has(50, 'PrimitiveStringMultiline') && has(71) && has(72, 'StringConcatenate') && has(74) && noLib ? 'y' : null;
})()`;

async function main() {
  if (!existsSync(APP_BIN)) { console.error("装机应用不存在:", APP_BIN); process.exit(2); }
  if (!existsSync(WF_REPO)) { console.error("道劫工作流真源缺失:", WF_REPO); process.exit(2); }
  const wfGraph = JSON.parse(readFileSync(WF_REPO, "utf8"));
  mkdirSync(OUT_DIR, { recursive: true });

  const pendingSubjects = SUBJECTS.filter((s) => FORCE || !existsSync(join(OUT_DIR, s.file)));
  if (!pendingSubjects.length && !ENGINE_ONLY) {
    log("全部产物已在盘,无待跑主体(--force 强制重跑)");
    process.exit(0);
  }
  log(ENGINE_ONLY
    ? `engine-only:仅拉起应用+引擎至画布就绪(待出图 ${pendingSubjects.length}/${SUBJECTS.length} 张仅参考)`
    : `待出图 ${pendingSubjects.length}/${SUBJECTS.length} 张`);

  // 附身优先:应用若已带调试口在跑(本脚本上一轮保留的),直接复用不再冷启
  let mainPage = null;
  try { mainPage = await getMainClient(); log("① 附身已运行装机应用(免冷启)"); } catch { mainPage = null; }
  if (!mainPage) {
    log("① prekill + 启动装机应用(真实 userData,结束时保留)");
    prekillApp();
    launchApp();
    mainPage = await getMainClient();
  }
  // 附身态可能已在 ComfyUI 沉浸模式(主页面只剩 webview、按钮极少——09-17 实弹
  // 「应用水合」超时的根因):webview 在场即视为就绪,跳过导航整段
  const alreadyImmersive = await mainPage.ev(vis(`!!document.querySelector('webview')`));
  if (alreadyImmersive) {
    log("② 跳过导航:应用已在 ComfyUI 沉浸态(webview 在场)");
  } else {
    await waitFor(() => mainPage.ev(vis(`document.querySelectorAll('button').length > 5 || document.querySelector('webview')`)), { label: "应用水合", timeout: 120_000 });

    const onDashboard = await mainPage.ev(vis(`document.querySelectorAll('div.dashboard-project-card').length > 0`));
    if (onDashboard) {
      await mainPage.domClick("div.dashboard-project-card", `e => ((e.textContent||'').includes('道劫'))`);
      log("进入道劫项目"); await sleep(3000);
    } else { log("已在项目内"); }

    log("② 侧栏「本地模型」进 ComfyUI 沉浸模块");
    const navClicked = await mainPage.domClick("button", `e => ((e.textContent||'').trim() === '本地模型')`);
    log("「本地模型」点击:", navClicked);
    await sleep(1200);
    const inForm = await mainPage.ev(vis(`!!document.querySelector('[data-local-model-studio]')`));
    if (inForm) {
      log("生图表单态,切回 ComfyUI 画布(悬浮球直达)");
      await mainPage.ev(vis(`document.querySelector('[data-workflow-orb]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`));
      await waitFor(() => mainPage.ev(vis(`(() => {
        const sec = document.querySelector('[data-orb-section="local-models"]');
        if (sec && sec.getAttribute('data-state') === 'closed') sec.querySelector('button')?.click();
        return !!document.querySelector('[data-orb-nav-mode="comfy"]');
      })()`)), { timeout: 15_000, interval: 800, label: "本地模型分区展开" });
      await mainPage.ev(vis(`document.querySelector('[data-orb-nav-mode="comfy"]')?.click()`));
      await sleep(1500);
    }

    log("③ 等 webview 挂载(引擎冷启,必要时点「启动 ComfyUI」)");
    {
      const t0 = Date.now();
      let lastShot = 0;
      while (Date.now() - t0 < 600_000) {
        const state = await mainPage.ev(vis(`(() => {
          if (document.querySelector('webview')) return 'webview';
          const startBtn = document.querySelector('[data-comfy-canvas-start]');
          if (startBtn) return 'need-start';
          if (document.querySelector('[data-comfy-canvas-starting]')) return 'starting';
          return 'waiting';
        })()`));
        if (state === "need-start") {
          const clicked = await mainPage.domClick("[data-comfy-canvas-start]", "e=>true");
          log("点击「启动 ComfyUI」:", clicked);
        }
        if (state === "webview") break;
        if (Date.now() - lastShot > 60_000) { lastShot = Date.now(); log("引擎状态:", state); }
        await sleep(3000);
      }
      if (!(await mainPage.ev(vis(`!!document.querySelector('webview')`)))) throw new Error("webview 挂载超时(600s)");
    }
  }
  await waitFor(
    () => wv(mainPage, `window.app && window.app.isGraphReady === true && typeof window.app.loadGraphData === 'function' ? 'ready' : null`),
    { timeout: 420_000, interval: 3000, label: "ComfyUI graph 就绪" });
  log("画布就绪"); await mainPage.screenshot("1-comfy-ready");

  if (ENGINE_ONLY) {
    // 到此为止:引擎已起、画布已就绪,不做任何画布操作、不碰侧栏;
    // 只关 CDP 附身的 WebSocket,应用与引擎保留运行(供引擎直排腿接管)
    log("engine-only:画布就绪,退出码 0(未做画布操作/未碰侧栏,应用与引擎保留运行)");
    mainPage.close();
    process.exit(0);
  }

  log("④ 漫影侧栏→repo: 叶子行打开道劫工作流(真实用户路径)");
  await waitFor(() => wv(mainPage, `(() => {
    const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
      .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
    if (!btn) return null; btn.click(); return 'clicked';
  })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮" });
  let hasTree = await wv(mainPage, `document.body.innerText.includes('1_图片') && document.body.innerText.includes('K2图像') ? 'yes' : null`);
  if (!hasTree) {
    await mainPage.ev(`(() => { document.querySelector('webview')?.reloadIgnoringCache?.(); return true; })()`);
    await waitFor(() => wv(mainPage, `window.app && window.app.isGraphReady === true ? 'y' : null`),
      { timeout: 120_000, interval: 2000, label: "webview 忽略缓存重载" });
    await waitFor(() => wv(mainPage, `(() => {
      const btn = [...document.querySelectorAll('.side-tool-bar-container button, [class*="side-tool-bar"] button')]
        .find(b => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('漫影'));
      if (!btn) return null; btn.click(); return 'clicked';
    })()`), { timeout: 30_000, interval: 1500, label: "漫影侧栏按钮(重载后)" });
    hasTree = await waitFor(() => wv(mainPage, `document.body.innerText.includes('1_图片') && document.body.innerText.includes('K2图像') ? 'yes' : null`),
      { timeout: 30_000, label: "目录树" });
  }
  const expandFolder = async (name) => {
    await waitFor(() => wv(mainPage, `(() => {
      const row = [...document.querySelectorAll('.my-tree-row')]
        .find(r => r.querySelector('button') && r.querySelector('.my-tree-label')?.textContent === ${JSON.stringify(name)});
      if (!row) return null; row.click(); return 'ok';
    })()`), { timeout: 20_000, interval: 1200, label: `展开目录 ${name}` });
    await sleep(800);
  };
  const leafClick = () => wv(mainPage, `(() => {
    const row = [...document.querySelectorAll('.my-tree-row')]
      .find(r => (r.title || '').endsWith(${JSON.stringify("repo:" + WF_REL)}));
    if (!row) return null; row.click(); return 'ok';
  })()`);
  await expandFolder("K2图像");
  await expandFolder("1_文生图");
  const leafOk = await leafClick();
  log("道劫叶子行点击:", leafOk);
  // 会话恢复竞态(09-17 实弹):应用会把用户上次画布副本切回活动位,纯节点数判据
  // 会被骗——用内容锚([50]主体句+[71]底座)等真身
  let opened = await waitFor(() => wv(mainPage, DAOJIE_GRAPH_PROBE), { timeout: 45_000, interval: 1000, label: "画布切道劫(内容锚 [50]+[71])" }).catch(() => null);
  if (!opened) {
    log("叶子行 45s 未切画布,回落 loadGraphData 直载(E2E 同款兜底)");
    opened = await wv(mainPage, `(async () => {
      const app = window.app;
      if (!app || app.isGraphReady !== true || typeof app.loadGraphData !== 'function') return 'app-not-ready';
      app.loadGraphData(${JSON.stringify(wfGraph)}, true, true, ${JSON.stringify(WF_REL)});
      return 'opened-via-loadGraphData';
    })()`);
    await waitFor(() => wv(mainPage, DAOJIE_GRAPH_PROBE), { timeout: 30_000, interval: 1000, label: "兜底载入后内容锚" });
  }
  log("道劫工作流已在画布:", opened); await mainPage.screenshot("2-daojie-open");

  log("⑤ 逐主体出图");
  const summary = [];
  let fail = 0;
  for (const s of pendingSubjects) {
    // 画布可能又被会话恢复/用户操作切走——每张出手前重验内容锚,丢了就重点道劫叶子行
    let anchor = await wv(mainPage, DAOJIE_GRAPH_PROBE);
    if (!anchor) {
      log(`[${s.file}] 画布不在道劫图,重新打开`);
      await leafClick();
      anchor = await waitFor(() => wv(mainPage, DAOJIE_GRAPH_PROBE), { timeout: 45_000, interval: 1000, label: "重开道劫画布" }).catch(() => null);
    }
    if (!anchor) { fail += 1; summary.push({ ...s, ok: false, err: "canvas-lost" }); continue; }
    const setResult = await setSubjectAndSeed(mainPage, s.prompt, s.seed);
    const verify = await wv(mainPage, `(() => {
      const g = window.app.graph;
      const n50 = g._nodes.find(n => String(n.id) === '50'); const n20 = g._nodes.find(n => String(n.id) === '20');
      const w50 = n50 && n50.widgets.find(w => w.name === 'value');
      const w20 = n20 && n20.widgets.find(w => w.name === 'seed');
      return JSON.stringify({ p: w50 && w50.value ? w50.value.slice(0, 8) : '', s: w20 ? w20.value : null });
    })()`);
    log(`[${s.file}] 设主体句+种子:`, String(setResult).slice(0, 40), "回读:", verify);
    if (!String(setResult).startsWith("set:") || !String(verify || "").includes(String(s.seed))) {
      log(`[${s.file}] 主体句/种子设置失败`);
      fail += 1; summary.push({ ...s, ok: false, err: `${setResult}|${verify}` }); continue;
    }
    await sleep(800);
    const before = await countOutput();
    const queued = await wv(mainPage, `(async () => {
      const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null;
      try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && e.message); }
    })()`);
    log(`[${s.file}] queuePrompt:`, queued);
    if (queued !== "queued") { fail += 1; summary.push({ ...s, ok: false, err: String(queued) }); continue; }
    const t0 = Date.now();
    let img = null;
    while (Date.now() - t0 < GEN_TIMEOUT_MS) {
      if ((await countOutput()) > before) { img = latestOutput(); break; }
      await sleep(3000);
    }
    if (!img) {
      log(`[${s.file}] 超时未出图(${GEN_TIMEOUT_MS / 1000}s)`);
      fail += 1; summary.push({ ...s, ok: false, err: "timeout" });
      continue;
    }
    const dest = join(OUT_DIR, s.file.replace(/\.jpg$/, ".png"));
    copyFileSync(join(ENGINE_OUTPUT, img.f), dest);
    const kb = (statSync(dest).size / 1024).toFixed(0);
    log(`[${s.file}] ✅ ${img.f} → ${dest} (${kb}KB, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    summary.push({ ...s, ok: true, engine: img.f, dest, kb });
    writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    await mainPage.screenshot(`3-${s.file.replace(/\.jpg$/, "")}`);
  }

  mainPage.close();
  log("════ 汇总 ════");
  for (const r of summary) log(r.ok ? `✅ ${r.file} (${r.kb}KB)` : `❌ ${r.file}: ${r.err}`);
  log(fail === 0 ? "✅ 全部成图" : `❌ ${fail} 张失败;重跑即续(幂等)`);
  log("应用保留运行(用户查看画布);产物目录:", OUT_DIR);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("批量出图失败:", e.message); process.exit(1); });
