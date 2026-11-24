#!/usr/bin/env node
/**
 * PCB 连线自动布线·装机验收探针(1124;零发车 / 零写引擎)
 *
 * 回答的问题:comfyui-pcb 插件与我方兼容垫片在这台引擎的真实前端上是否真的生效——
 *   ① 引擎公布的前端脚本里(前端启动时读取的 /api/extensions),插件入口与我方垫片都在册;
 *   ② 插件挂上了并登记了 PCB 选项,垫片处于就绪态;
 *   ③ 默认连线模式已是 PCB;换一个全新的浏览器上下文再加载仍是(证明已持久化);
 *   ④ 在役工作流里连线 100% 走布线;
 *   ⑤ 挪一个节点后障碍物快照版本号恰好 +1(证明「每帧更新障碍物」那一钩是活的,没被别的插件遮住);
 *   ⑥ 走线期取得到连线表(走线期别名生效);子图内部同样布线;
 *   ⑦ 全程页面零未捕获异常,控制台没有与 PCB 相关的报错。
 *
 * 隔离口径(沿用 multiseg_ui_canvas_probe.mjs 与调研探针):发车与写类接口硬拦;其余非 GET 与跨源请求
 *   伪造 200 空响应;websocket 伪造(队列恒 0)。唯一放行的写请求是本功能自己的两笔设置保存
 *   (POST /settings/Comfy.LinkRenderMode 与 /settings/My.PcbLinkMode.Activated)——那是默认切换功能的本职动作;
 *   预演模式下一律不放行(插件尚未真装,不该在引擎上留下设置)。
 *
 * 预演模式(--inject):不落引擎。拦截引擎的 /api/extensions 清单,把插件入口与我方垫片追加进去,
 *   两者的文件由本脚本按同源路径现发(插件取自本地克隆的 web/ 目录,垫片取自我方仓库目录)。
 *   用于在真正安装与部署之前,先验证「垫片 + 插件」整链可用。预演模式不验持久化。
 *
 * 用法(任意目录):
 *   node apps/build/scripts/comfyui_pcb_link_acceptance_probe.mjs --origin <引擎地址> --label <名字> --out <输出目录> \
 *        --workflow <工作流 json> [--workflow ...] \
 *        [--inject <comfyui-pcb 克隆目录> --shim-dir <我方 my_nodes/web 目录>]
 * 退出码:0=全部断言通过;1=有断言失败;2=环境问题(引擎不可达、运行时缺失、参数缺失)。
 * 产物:<out>/acceptance-report.json 与截图 <label>__<工作流>__<取景>__<模式>.png
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const list = name => args.flatMap((v, i) => (v === name && args[i + 1] ? [args[i + 1]] : []));
const origin = arg('--origin', '').replace(/\/+$/, '');
const label = arg('--label', 'engine');
const out = resolve(arg('--out', 'pcb-acceptance'));
const workflows = list('--workflow');
const injectDir = arg('--inject', '');
const injectWeb = resolve(injectDir, 'web');
const shimDir = resolve(arg('--shim-dir', ''), '');
const INJECTED = Boolean(injectDir);
const usage = '用法见文件头:--origin <引擎地址> --label <名字> --out <输出目录> --workflow <json> [--workflow ...] [--inject <comfyui-pcb 克隆目录> --shim-dir <我方 my_nodes/web 目录>]';
const injectReady = existsSync(join(injectWeb, 'index.js')) && existsSync(join(shimDir, 'my_pcb_link_compat.js')) && existsSync(join(shimDir, 'my_pcb_link_compat_core.mjs'));
if (!origin || !workflows.length || (INJECTED && !injectReady)) { console.error(usage); process.exit(2); }
mkdirSync(out, { recursive: true });

const PLUGIN_ENTRY = '/extensions/comfyui-pcb/index.js';
const SHIM_ENTRY = '/extensions/my-nodes/my_pcb_link_compat.js';
const SHIM_CORE_ENTRY = '/extensions/my-nodes/my_pcb_link_compat_core.mjs';
const PCB_PREFIX = '/extensions/comfyui-pcb/';

let playwright;
try { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
catch { console.error('playwright 运行时缺失(~/.cache/codex-runtimes/.../node_modules/playwright)'); process.exit(2); }
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shellDirs = existsSync(cache) ? readdirSync(cache).filter(n => n.startsWith('chromium_headless_shell-')).sort() : [];
const executable = shellDirs.length ? join(cache, shellDirs[shellDirs.length - 1], 'chrome-headless-shell-mac-arm64/chrome-headless-shell') : null;
if (!executable || !existsSync(executable)) { console.error('缺 chromium headless shell(~/Library/Caches/ms-playwright/chromium_headless_shell-*)'); process.exit(2); }

const report = {
  origin, label, injected: INJECTED, generatedSubmitted: false, settingsWriteAllowed: !INJECTED,
  blockedRequests: 0, pageErrors: [], console: [], consoleAll: [], failedRequests: [], checks: [], workflows: [], shots: [], stage: 'launch',
};
const save = () => writeFileSync(join(out, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
const check = (name, ok, detail) => { report.checks.push({ name, ok: Boolean(ok), detail: detail ?? null }); save(); return Boolean(ok); };

/** 页面就绪判据(不依赖前端版本私有属性):节点定义已注册、默认图已加载、装载接口可用、不在配置中 */
const READY = () => {
  const app = window.comfyAPI?.app?.app;
  return Boolean(app?.graph && Array.isArray(app.graph.nodes) && app.graph.nodes.length > 0
    && typeof app.loadGraphData === 'function' && !app.configuringGraphLevel
    && Object.keys(window.LiteGraph?.registered_node_types ?? {}).length > 200);
};

async function makeContext(browser) {
  const context = await browser.newContext({ viewport: { width: 2200, height: 1300 } });
  await context.route('**/*', async route => {
    const request = route.request(); const u = new URL(request.url());
    const hard = u.pathname === '/prompt' || u.pathname.startsWith('/upload') || u.pathname.startsWith('/view_api') || u.pathname.startsWith('/interrupt');
    const kind = hard ? 'hard' : u.origin !== origin ? 'cross-origin' : request.method() !== 'GET' ? 'non-GET' : null;
    const ownSetting = !INJECTED && request.method() === 'POST'
      && (u.pathname === '/settings/Comfy.LinkRenderMode' || u.pathname === '/settings/My.PcbLinkMode.Activated');
    if (!kind || ownSetting) return route.continue();
    report.blockedRequests++;
    if (kind === 'hard') return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: kind === 'cross-origin' ? '[]' : '{}' });
  });
  if (INJECTED) {
    const serve = (root, rel) => {
      const file = resolve(root, rel);
      if (!file.startsWith(root + sep) || !existsSync(file)) return { status: 404, body: 'not found' };
      return { status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: readFileSync(file) };
    };
    // 插件在浏览器里的地址不含 web/ 这一层:/extensions/<包>/<WEB_DIRECTORY 内相对路径>
    await context.route(`**${PCB_PREFIX}**`, async route => {
      await route.fulfill(serve(injectWeb, decodeURIComponent(new URL(route.request().url()).pathname.slice(PCB_PREFIX.length))));
    });
    await context.route(`**${SHIM_ENTRY}`, async route => { await route.fulfill(serve(shimDir, 'my_pcb_link_compat.js')); });
    await context.route(`**${SHIM_CORE_ENTRY}`, async route => { await route.fulfill(serve(shimDir, 'my_pcb_link_compat_core.mjs')); });
    // 前端启动时取清单的地址是 /api/extensions(1124 实测;旧的 /extensions 它不读)
    await context.route(`${origin}/api/extensions`, async route => {
      const response = await route.fetch();
      const entries = await response.json();
      entries.push(PLUGIN_ENTRY, SHIM_ENTRY);
      await route.fulfill({ response, json: entries });
    });
  }
  await context.routeWebSocket('**/*', route => {
    route.onMessage(message => { try { if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({ type: 'feature_flags', data: {} })); } catch {} });
    route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'pcb-acceptance-isolated-browser' } }));
  });
  const page = await context.newPage();
  page.on('pageerror', e => { report.pageErrors.push(String(e).slice(0, 300)); });
  page.on('console', msg => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const t = msg.text();
    const s = `[${msg.type()}] ${t.slice(0, 300)}`;
    if (report.consoleAll.length < 300) report.consoleAll.push(s);
    if (/pcb/i.test(t) && !report.console.includes(s) && report.console.length < 200) report.console.push(s);
  });
  page.on('requestfailed', r => { if (report.failedRequests.length < 60) report.failedRequests.push(`${r.resourceType()} ${r.url().slice(0, 160)} | ${r.failure()?.errorText ?? ''}`); });
  page.on('response', r => { if (r.status() >= 400 && report.failedRequests.length < 60) report.failedRequests.push(`HTTP ${r.status()} ${r.request().resourceType()} ${r.url().slice(0, 160)}`); });
  // 启动期弹出的通知(版本兼容警告等)固定在画布右上角、层级 9999,会挡住走线:注入一条样式整页隐藏(只在本隔离页面内)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#vue-app ol.pointer-events-none.fixed, .p-toast, .p-dialog-mask, .p-dialog, .comfy-modal { display: none !important; }';
      document.head.appendChild(style);
    });
  });
  return { context, page };
}

async function openReady(browser, tag) {
  const { context, page } = await makeContext(browser);
  report.stage = `${tag}: navigate`; save();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  report.stage = `${tag}: app ready`; save();
  await page.waitForFunction(READY, null, { timeout: 90000 });
  return { context, page };
}

let browser;
let envError = null;
const deadline = setTimeout(() => { report.timeout = report.stage; save(); browser?.close().finally(() => process.exit(2)); }, 540000);
try {
  // no-proxy-server:局域网引擎直连,不走系统代理
  browser = await playwright.chromium.launch({ headless: true, executablePath: executable, args: ['--no-proxy-server'] });
  const { context, page } = await openReady(browser, 'context-1');

  // ① 引擎公布的前端脚本
  report.stage = 'extensions'; save();
  const ext = await page.evaluate(async () => {
    const list = await (await fetch('/api/extensions')).json();
    const stats = await (await fetch('/system_stats')).json().catch(() => ({}));
    return { hasPlugin: list.includes('/extensions/comfyui-pcb/index.js'), hasShim: list.includes('/extensions/my-nodes/my_pcb_link_compat.js'),
      total: list.length, comfyui: stats?.system?.comfyui_version ?? null };
  });
  report.engine = { comfyui: ext.comfyui, extensionScripts: ext.total };
  check('① 插件入口在引擎公布的前端脚本里', ext.hasPlugin, ext.hasPlugin ? PLUGIN_ENTRY : `未找到 ${PLUGIN_ENTRY}(共 ${ext.total} 条)`);
  check('① 我方垫片在引擎公布的前端脚本里', ext.hasShim, ext.hasShim ? SHIM_ENTRY : `未找到 ${SHIM_ENTRY}(共 ${ext.total} 条)`);
  // 未在册就没必要再等挂钩(必然超时):带着已记下的失败直接收尾
  if (!ext.hasPlugin || !ext.hasShim) throw new Error(`前端脚本未在册:插件 ${ext.hasPlugin},垫片 ${ext.hasShim}`);

  // ② 插件挂钩 + 垫片就绪(未在册时这一步必然超时,如实记为失败)
  report.stage = 'plugin + shim ready'; save();
  await page.waitForFunction(() => window.__pcb?.state?.patched === true && typeof window.__myPcbLinkCompat?.phase === 'function', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__myPcbLinkCompat.phase() === 'ready', null, { timeout: 60000 });
  const readyInfo = await page.evaluate(() => ({ pcbOption: window.__pcb.state.option === true, phase: window.__myPcbLinkCompat.phase() }));
  report.shim = readyInfo;
  check('② 插件已挂钩并登记了 PCB 选项', readyInfo.pcbOption, `state.option=${readyInfo.pcbOption}`);
  check('② 我方垫片处于就绪态', readyInfo.phase === 'ready', `phase=${readyInfo.phase}`);

  // ③ 默认模式:页面加载后应是 PCB
  report.stage = 'default mode'; save();
  await page.waitForFunction(() => { const app = window.comfyAPI?.app?.app; return Boolean(window.__pcb && app?.canvas && app.canvas.links_render_mode === window.__pcb.PCB()); }, null, { timeout: 25000 }).catch(() => {});
  const mode = await page.evaluate(() => {
    const { app } = window.comfyAPI.app; const setting = app.extensionManager?.setting;
    return { canvasMode: app.canvas?.links_render_mode ?? null, pcb: window.__pcb.PCB(), activation: window.__myPcbLinkCompat.activation(),
      storedMode: setting?.get?.('Comfy.LinkRenderMode') ?? null };
  });
  report.defaultMode = mode;
  check('③ 默认连线模式已是 PCB', mode.canvasMode === mode.pcb, JSON.stringify(mode));

  // 页面内小工具:排若干帧刷新;计数补丁包在插件外面,只数「真连线里带布线结果的条数」
  await page.evaluate(async () => {
    const { app } = await import('/scripts/app.js');
    window.__settle = async (n = 8) => {
      const frame = () => new Promise(r => { app.canvas.setDirty(true, true); requestAnimationFrame(() => requestAnimationFrame(r)); });
      for (let i = 0; i < n; i++) await frame();
    };
    // 未布线的线逐条留样:两端同一水平线且中间无遮挡的直线,插件按设计不布线、交原生画直线(不算失败)
    const T = window.__acc = { drawn: 0, routed: 0, straight: 0, unrouted: [], counting: false };
    const prProto = Object.getPrototypeOf(app.canvas.linkRenderer.pathRenderer);
    const orig = prProto.drawLink;
    prProto.drawLink = function (ctx, linkData, context) {
      const r = orig.call(this, ctx, linkData, context);
      if (T.counting && linkData && linkData.id !== 'temp' && linkData.id !== 'dragging') {
        T.drawn++;
        if (linkData.__route) T.routed++;
        else {
          const dy = Math.abs(linkData.endPoint.y - linkData.startPoint.y);
          if (dy <= 3) T.straight++;
          if (T.unrouted.length < 8) T.unrouted.push({ id: linkData.id, dy: Math.round(dy), dx: Math.round(linkData.endPoint.x - linkData.startPoint.x), dir: `${linkData.startDirection}>${linkData.endDirection}` });
        }
      }
      return r;
    };
  });

  const loadWorkflow = async wf => page.evaluate(async graph => {
    const { app } = await import('/scripts/app.js');
    try { await app.loadGraphData(graph, true, false, null, { skipAssetScans: true }); }
    catch (e) { if (e instanceof TypeError) await app.loadGraphData(graph, true, false, null); else throw e; }
    await new Promise(r => setTimeout(r, 600));
    const g = app.canvas.graph ?? app.graph;
    const L = g.links; const links = Array.isArray(L) ? L : [...L.values()];
    return { nodes: g._nodes?.length ?? null, links: links.length,
      missing: (g?._nodes ?? []).filter(n => n.constructor?.name === 'LGraphNode').map(n => `${n.id}:${n.type}`),
      groups: (g.groups ?? []).map(gr => {
        const b = Array.isArray(gr.bounding) ? gr.bounding : [gr._pos?.[0] ?? gr.pos?.[0], gr._pos?.[1] ?? gr.pos?.[1], gr._size?.[0] ?? gr.size?.[0], gr._size?.[1] ?? gr.size?.[1]];
        return { title: String(gr.title ?? ''), b: b.map(v => Math.round(v)) };
      }).sort((x, y) => y.b[2] * y.b[3] - x.b[2] * x.b[3]),
      subgraphs: g.subgraphs ? [...g.subgraphs.values()].map(s => ({ id: s.id, name: s.name, nodes: s.nodes?.length ?? 0 })).sort((a, b) => b.nodes - a.nodes) : [] };
  }, JSON.parse(readFileSync(wf, 'utf8')));

  // 布线覆盖的判据:每条被画出来的线,要么走了布线,要么是两端水平的直线(插件按设计不管这种)
  const covered = m => Boolean(m && m.drawn > 0 && m.routed + m.straight === m.drawn);
  const coverText = m => m ? `布线 ${m.routed} + 直线 ${m.straight} / 绘制 ${m.drawn}` + (m.routed + m.straight === m.drawn ? '' : `;未覆盖留样 ${JSON.stringify(m.unrouted.slice(0, 4))}`) : '未量到';

  // 取景(偏移单位=世界坐标:屏幕=(世界+offset)×scale)
  const fit = bounds => page.evaluate(async b => {
    const { app } = await import('/scripts/app.js');
    const c = app.canvas; const vw = c.canvas.clientWidth, vh = c.canvas.clientHeight; const pad = 40;
    const scale = Math.min(b.maxScale ?? 1, (vw - 2 * pad) / b.w, (vh - 2 * pad) / b.h);
    c.ds.scale = scale;
    c.ds.offset[0] = (vw / 2 - (b.x + b.w / 2) * scale) / scale;
    c.ds.offset[1] = (vh / 2 - (b.y + b.h / 2) * scale) / scale;
    await window.__settle(3);
    return { scale: +scale.toFixed(4) };
  }, bounds);
  const graphBounds = () => page.evaluate(() => {
    const { app } = window.comfyAPI.app;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of app.canvas.graph._nodes ?? []) { const r = n.boundingRect ?? [n.pos[0], n.pos[1], n.size[0], n.size[1]]; x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });

  // 一个取景:曲线 / PCB 各拍一张;PCB 态量布线覆盖。第一个取景另拍一张「默认」(页面加载后未做任何改动的样子)
  let defaultCaptured = false;
  const shoot = async (row, view) => {
    const canvas = page.locator('#graph-canvas');
    const plan = defaultCaptured ? [['曲线', 2], ['PCB', 'pcb']] : [['默认', 'keep'], ['曲线', 2], ['PCB', 'pcb']];
    defaultCaptured = true;
    for (const [name, value] of plan) {
      const m = await page.evaluate(async ({ value, pcbValue }) => {
        const { app } = await import('/scripts/app.js');
        const T = window.__acc;
        if (value === 'pcb') app.canvas.links_render_mode = pcbValue;
        else if (value !== 'keep') app.canvas.links_render_mode = value;
        await window.__settle(8);
        T.drawn = 0; T.routed = 0; T.straight = 0; T.unrouted.length = 0; T.counting = true; await window.__settle(1); T.counting = false;
        return { mode: app.canvas.links_render_mode, drawn: T.drawn, routed: T.routed, straight: T.straight, unrouted: T.unrouted.slice(), stats: { ...window.__pcb.stats() } };
      }, { value, pcbValue: mode.pcb });
      const file = `${label}__${row.stem}__${view.name}__${name}.png`;
      await canvas.screenshot({ path: join(out, file) });
      report.shots.push(file);
      row.modes[`${view.name}/${name}`] = m;
      if (name === 'PCB') row.views[view.name] = { ...view.meta, ...m };
    }
    save();
  };

  // 第一遍:每件工作流的主图
  for (const [index, wf] of workflows.entries()) {
    const stem = basename(wf, '.json');
    const row = { file: wf, stem, views: {}, modes: {}, checks: [] };
    report.workflows.push(row);
    report.stage = `load ${stem}`; save();
    Object.assign(row, await loadWorkflow(wf));
    row.checks.push({ name: `④ ${stem}: 加载无缺节点定义`, ok: row.missing.length === 0, detail: row.missing.length ? row.missing.slice(0, 8).join(', ') : `${row.nodes} 节点 / ${row.links} 连线` });

    await fit(await graphBounds());
    await shoot(row, { name: '全图', meta: {} });
    const full = row.views['全图'];
    row.checks.push({ name: `④ ${stem}: 全图连线全部布线`, ok: covered(full), detail: coverText(full) });

    const g = row.groups[0];
    if (g && g.b[2] > 0 && g.b[3] > 0) {
      const v = await fit({ x: g.b[0], y: g.b[1], w: g.b[2], h: g.b[3], maxScale: 0.55 });
      await shoot(row, { name: '组框近景', meta: { title: g.title, ...v } });
      const close = row.views['组框近景'];
      row.checks.push({ name: `④ ${stem}: 组框「${g.title}」近景连线全部布线`, ok: covered(close), detail: coverText(close) });
    }

    // ⑤⑥ 挪一个节点看是否重新布线;顺带读前置钩与别名的状态(只对第一件做)
    if (index === 0) {
      report.stage = `move-node ${stem}`; save();
      const mv = await page.evaluate(async pcbValue => {
        const { app } = await import('/scripts/app.js');
        const c = app.canvas; const g = c.graph;
        c.links_render_mode = pcbValue;
        await window.__settle(6);
        const L = g.links; const links = Array.isArray(L) ? L : [...L.values()];
        const score = new Map();
        for (const l of links) { score.set(l.origin_id, (score.get(l.origin_id) ?? 0) + 1); score.set(l.target_id, (score.get(l.target_id) ?? 0) + 1); }
        const node = g.getNodeById([...score.entries()].sort((a, b) => b[1] - a[1])[0][0]);
        const before = { ...window.__pcb.stats() };
        const pos0 = [node.pos[0], node.pos[1]];
        node.pos[0] += 140; node.pos[1] += 90;
        await window.__settle(6);
        const after = { ...window.__pcb.stats() };
        node.pos[0] = pos0[0]; node.pos[1] = pos0[1];
        await window.__settle(4);
        const shim = window.__myPcbLinkCompat;
        return { nodeId: node.id, nodes: g._nodes.length, before, after, canvas: shim.canvasInfo(c), alias: shim.aliasInfo(c.graph) };
      }, mode.pcb);
      row.move = mv;
      row.checks.push({ name: `⑤ ${stem}: 挪节点后重新布线`, ok: mv.after.version === mv.before.version + 1 && mv.after.obstacles === mv.nodes, detail: `节点 #${mv.nodeId} 挪动:版本 ${mv.before.version}→${mv.after.version},障碍物 ${mv.after.obstacles}/${mv.nodes}` });
      row.checks.push({ name: `⑤ ${stem}: 前置钩活着`, ok: !mv.canvas.wrapped || mv.canvas.live !== 'unknown', detail: JSON.stringify(mv.canvas) });
      row.checks.push({ name: `⑥ ${stem}: 走线期取得到连线表`, ok: mv.alias.resolved === true, detail: JSON.stringify(mv.alias) });
    }
    save();
  }

  // 第二遍:子图内部(进入子图后画布换图,所以放在最后单独跑)
  for (const [index, wf] of workflows.entries()) {
    const row = report.workflows[index];
    const biggest = row.subgraphs[0];
    if (!biggest || biggest.nodes < 1) continue;
    report.stage = `subgraph ${row.stem}`; save();
    await loadWorkflow(wf);
    const sub = await page.evaluate(async ({ id, pcbValue }) => {
      const { app } = await import('/scripts/app.js');
      const sg = [...app.graph.subgraphs.values()].find(s => s.id === id);
      if (!sg) return { error: 'subgraph not found' };
      app.canvas.openSubgraph(sg);
      await new Promise(r => setTimeout(r, 900));
      app.canvas.links_render_mode = pcbValue;
      const c = app.canvas; const vw = c.canvas.clientWidth, vh = c.canvas.clientHeight; const pad = 40;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of c.graph._nodes ?? []) { const r = n.boundingRect ?? [n.pos[0], n.pos[1], n.size[0], n.size[1]]; x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]); }
      const scale = Math.min((vw - 2 * pad) / (x1 - x0), (vh - 2 * pad) / (y1 - y0), 1);
      c.ds.scale = scale;
      c.ds.offset[0] = (pad - x0 * scale + ((vw - 2 * pad) - (x1 - x0) * scale) / 2) / scale;
      c.ds.offset[1] = (pad - y0 * scale + ((vh - 2 * pad) - (y1 - y0) * scale) / 2) / scale;
      await window.__settle(3);
      return { name: sg.name, nodes: c.graph._nodes.length, scale: +scale.toFixed(4), alias: window.__myPcbLinkCompat.aliasInfo(c.graph) };
    }, { id: biggest.id, pcbValue: mode.pcb });
    if (sub.error) { row.checks.push({ name: `⑥ ${row.stem}: 子图内`, ok: false, detail: sub.error }); continue; }
    await shoot(row, { name: '子图内', meta: sub });
    const s = row.views['子图内'];
    row.checks.push({ name: `⑥ ${row.stem}: 子图「${sub.name}」内连线全部布线`, ok: covered(s), detail: `${coverText(s)};别名 ${JSON.stringify(sub.alias)}` });
    save();
  }

  // ⑦ 报错
  check('⑦ 页面零未捕获异常', report.pageErrors.length === 0, report.pageErrors.slice(0, 5).join(' | ') || '0 条');
  const noisy = report.console.filter(s => s.startsWith('[error]') || s.startsWith('[warning]'));
  check('⑦ 控制台没有与 PCB 相关的报错或告警', noisy.length === 0, noisy.slice(0, 6).join(' | ') || '0 条');
  await context.close();

  // ③ 持久化:全新上下文再加载一次,模式应直接是 PCB,且本上下文不再执行切换(激活标记已持久化)
  if (!INJECTED) {
    report.stage = 'persistence'; save();
    const second = await openReady(browser, 'context-2');
    await second.page.waitForFunction(() => window.__pcb?.state?.patched === true && window.__myPcbLinkCompat?.phase() === 'ready', null, { timeout: 60000 });
    const again = await second.page.evaluate(async () => {
      const { app } = await import('/scripts/app.js');
      const frame = () => new Promise(r => { app.canvas.setDirty(true, true); requestAnimationFrame(() => requestAnimationFrame(r)); });
      for (let i = 0; i < 6; i++) await frame();
      return { canvasMode: app.canvas?.links_render_mode ?? null, pcb: window.__pcb.PCB(), activation: window.__myPcbLinkCompat.activation() };
    });
    report.persisted = again;
    check('③ 换全新上下文再加载仍是 PCB(已持久化)', again.canvasMode === again.pcb && again.activation.activated === true, JSON.stringify(again));
    await second.context.close();
  }
  report.stage = 'done';
} catch (error) {
  report.fatal = String(error?.stack ?? error).slice(0, 1500);
  // 现场诊断:失败在哪一环,一眼可辨(只读)
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    const live = pages[pages.length - 1];
    if (live) report.diagnosis = await live.evaluate(async () => ({
      hasPcb: Boolean(window.__pcb), pcbPatched: window.__pcb?.state?.patched ?? null, pcbOption: window.__pcb?.state?.option ?? null,
      hasShimHandle: typeof window.__myPcbLinkCompat?.phase, hasCanvas: Boolean(window.comfyAPI?.app?.app?.canvas), hasLinkRenderer: Boolean(window.comfyAPI?.app?.app?.canvas?.linkRenderer?.pathRenderer),
      ownDrawConnections: Boolean(window.comfyAPI?.app?.app?.canvas && Object.prototype.hasOwnProperty.call(window.comfyAPI.app.app.canvas, 'drawConnections')),
      // 这两份脚本页面到底请求过没有;此刻手动导入会不会报错
      requested: performance.getEntriesByType('resource').map(e => e.name).filter(n => /pcb/i.test(n)).map(n => n.replace(location.origin, '')),
      manualImport: await Promise.all(['/extensions/comfyui-pcb/index.js', '/extensions/my-nodes/my_pcb_link_compat.js'].map(u => import(u).then(() => `${u}: ok`, e => `${u}: ${String(e).slice(0, 200)}`))),
    })).catch(e => ({ error: String(e) }));
  } catch {}
} finally {
  clearTimeout(deadline);
  report.failedChecks = [...report.checks, ...report.workflows.flatMap(w => w.checks)].filter(c => !c.ok).map(c => c.name);
  report.passed = !report.fatal && report.failedChecks.length === 0;
  save();
  const unreachable = report.stage.endsWith(': navigate');
  await browser?.close().finally(() => process.exit(report.passed ? 0 : unreachable ? 2 : 1));
}
