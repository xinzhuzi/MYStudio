#!/usr/bin/env node
/**
 * multiseg 记账界面图·真实前端探针(1123 D17;零发车零写引擎)
 *
 * 回答的问题:界面图 h3-multiseg-template.json(及其组装后克隆)在真实 ComfyUI 前端里
 *   ① 能不能正常加载(无缺节点定义/无报错);
 *   ② 追加的可选输入口(#101.first_frame / #5011.identity_clip_vision,追加在 inputs 末尾)
 *      连线是否落到正确的口上;
 *   ③ 前端 graphToPrompt 导出的执行图与 App 实际提交的 apiGraph 是否逐节点/逐连线/逐参数一致
 *      ——「排障时打开的图就是实际执行的图」(D17① 批复口径)的实证;API 绿≠画布绿。
 *   另在新节点所在组框处截图,供目检布局与连线。
 *
 * 隔离:发车/写类接口硬拦;其余非 GET 与跨源请求伪造 200 空响应(请求不出浏览器,引擎零写入,
 *   也不让启动期扩展的 fetch 抛错中断初始化);websocket 伪造(队列恒 0)。只读引擎前端与节点定义。
 *   Mac 引擎离线时用 Win 引擎(纯 GET)。
 *
 * 输入目录(默认 output/_validation-1123/d17,vite-node 取图器 build-d17.ts 产出):
 *   ui-<case>.json 界面图 + api-<case>.json 期望执行图。
 *   约定例名:shipped=出厂界面图(#9/#103 出厂旁路,不进导出);canvas=原始画布件对照例
 *   (无 #9/#103/#800;用于证明某现象是画布件自带而非界面图引入)。
 * 用法(仓库根):node apps/build/scripts/multiseg_ui_canvas_probe.mjs [--origin http://192.168.0.101:17000] [--dir <目录>]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const origin = arg('--origin', 'http://192.168.0.101:17000');
const appsRoot = resolve(fileURLToPath(import.meta.url), '../../..');
const dir = resolve(arg('--dir', join(appsRoot, 'output/_validation-1123/d17')));
const shotsDir = join(dir, 'shots');
// 各例里「预期不进导出」的节点:出厂态旁路掉的 App 专用件 / 画布件对照例本就没有的 App 专用件
const EXPECT_ABSENT = { shipped: ['9', '103'], canvas: ['9', '103', '800'] };
// 各例里预期内的参数差异(不计入不符,单列留档):
//   画布件对照例:#4 前缀是 App 占位值(画布件用自家默认);#5011/#5023/#5025 是画布件自带的
//   「画布≠执行图」取值(1118 收尾役有意分策 / 母本两表,见 d17-canvas-fidelity-1123.md)——界面图已对齐,画布件本身不动。
const KNOWN_DEVIATIONS = {
  canvas: ['#4.filename_prefix', '#5011.identity_threshold', '#5011.identity_model',
    '#5023.bit_depth', '#5023.chroma_subsampling', '#5025.bit_depth', '#5025.chroma_subsampling'],
  shipped: ['#4.filename_prefix'],
};
// 界面图比执行图多出的画布件自有件(两处中间档存盘;说明卡是 UI-only 件不进导出)
const CANVAS_ONLY = ['3071', '4003'];
const APP_LINKS = [['101', 'first_frame'], ['5012', 'ref_images.ref_image_0'], ['103', 'video'], ['5011', 'identity_clip_vision']];
// 截图取景:以这些节点为中心各拍一张(节点号 → 文件名;组装后两态各拍)
const SHOT_NODES = [[9, 'node9-loadimage'], [800, 'node800-clipvision'], [103, 'node103-myshot'], [101, 'node101-sampler'], [4100, 'node4100-finalsave']];
// 控件清单留档的节点(带 seed 的与已知画布≠执行图分歧件)
const WIDGET_DUMP = [101, 4002, 5110, 5011, 5023, 5025];

let playwright;
try { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
catch { console.error('playwright 运行时缺失(~/.cache/codex-runtimes/.../node_modules/playwright)'); process.exit(2); }
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shellDir = existsSync(cache) ? readdirSync(cache).filter(n => n.startsWith('chromium_headless_shell-')).sort().at(-1) : null;
const executable = shellDir ? join(cache, shellDir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell') : undefined;
if (!executable || !existsSync(executable)) { console.error('缺 chromium headless shell(~/Library/Caches/ms-playwright/chromium_headless_shell-*)'); process.exit(2); }

const report = { origin, generatedSubmitted: false, blockedRequests: [], pageErrors: [], console: [], cases: [], stage: 'launch' };
const save = () => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'canvas-probe-report.json'), JSON.stringify(report, null, 2) + '\n'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 导出执行图 vs 期望执行图(apiGraph):逐节点/逐连线/逐参数。 */
function compare(exp, got, absent) {
  const out = { missingNodes: [], classMismatch: [], linkMismatch: [], scalarMismatch: [], extraNodes: [], extraInputs: [], skippedFromAbsent: [] };
  for (const [id, node] of Object.entries(exp)) {
    const g = got[id];
    if (!g) { if (!absent.includes(id)) out.missingNodes.push(id); continue; }
    if (g.class_type !== node.class_type) out.classMismatch.push({ id, expected: node.class_type, got: g.class_type });
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && absent.includes(String(value[0]))) { out.skippedFromAbsent.push(`${id}.${name}`); continue; }
      if (!same(g.inputs[name], value)) (Array.isArray(value) ? out.linkMismatch : out.scalarMismatch).push({ id, name, expected: value, got: g.inputs[name] });
    }
    for (const name of Object.keys(g.inputs)) if (!(name in node.inputs)) out.extraInputs.push({ id, name, got: g.inputs[name] });
  }
  out.extraNodes = Object.keys(got).filter(id => !(id in exp) && !CANVAS_ONLY.includes(id));
  return out;
}

let browser;
const deadline = setTimeout(() => { report.timeout = report.stage; save(); browser?.close().finally(() => process.exit(2)); }, 300000);
try {
  browser = await playwright.chromium.launch({ headless: true, executablePath: executable });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  // 隔离口径:发车/写类接口硬拦(请求丢弃);其余非 GET 与跨源请求伪造 200 空响应——请求不出浏览器、
  // 引擎零写入,同时不让启动期扩展的 fetch 抛错中断初始化(abort 会让 setup 链断掉,应用到不了就绪)。
  const HARD_BLOCK = u => u.pathname === '/prompt' || u.pathname.startsWith('/upload') || u.pathname.startsWith('/view_api') || u.pathname.startsWith('/interrupt');
  await context.route('**/*', async route => {
    const request = route.request(); const u = new URL(request.url());
    const kind = HARD_BLOCK(u) ? 'hard' : u.origin !== origin ? 'cross-origin' : request.method() !== 'GET' ? 'non-GET' : null;
    if (!kind) return route.continue();
    if (report.blockedRequests.length < 60) report.blockedRequests.push({ kind, method: request.method(), url: request.url().slice(0, 140) });
    if (kind === 'hard') return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: kind === 'cross-origin' ? '[]' : '{}' });
  });
  await context.routeWebSocket('**/*', route => {
    route.onMessage(message => { try { if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({ type: 'feature_flags', data: {} })); } catch {} });
    route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'd17-isolated-browser' } }));
  });
  const page = await context.newPage();
  page.on('pageerror', e => { report.pageErrors.push(`${String(e).slice(0, 300)}\n    ${String(e.stack).split('\n').slice(0, 4).join('\n    ')}`); });
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') { const t = msg.text().slice(0, 300); if (!report.console.includes(t) && report.console.length < 80) report.console.push(t); } });
  report.stage = 'navigate'; save();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  report.stage = 'app ready'; save();
  // 就绪判据不依赖前端版本私有属性:节点定义已注册、默认图已加载、装载/导出接口可用、不在配置中
  const READY = () => {
    const app = window.comfyAPI?.app?.app;
    return Boolean(app?.graph && Array.isArray(app.graph.nodes) && app.graph.nodes.length > 0
      && typeof app.loadGraphData === 'function' && typeof app.graphToPrompt === 'function' && !app.configuringGraphLevel
      && Object.keys(window.LiteGraph?.registered_node_types ?? {}).length > 200);
  };
  try {
    await page.waitForFunction(READY, null, { timeout: 90000 });
  } catch (error) {
    // 就绪信号没到:留下现场再抛(是哪个接口被拦/哪条初始化断了,报告里可定位)
    report.readyDiagnostics = await page.evaluate(() => { const app = window.comfyAPI?.app?.app; return {
      hasApp: Boolean(app), comfyApiKeys: Object.keys(window.comfyAPI ?? {}).slice(0, 12),
      registeredTypes: Object.keys(window.LiteGraph?.registered_node_types ?? {}).length,
      configuringGraphLevel: app?.configuringGraphLevel, graphNodes: app?.graph?.nodes?.length,
      hasLoadGraphData: typeof app?.loadGraphData, hasGraphToPrompt: typeof app?.graphToPrompt }; }).catch(e => ({ error: String(e) }));
    save();
    throw error;
  }
  report.stage = 'ready';
  // 引擎节点定义(只读 GET):供「导出多出的输入」对引擎默认值
  report.objectInfo = await page.evaluate(async () => { try { return await (await fetch('/object_info')).json(); } catch (e) { return { __error: String(e) }; } });
  report.system = await page.evaluate(async () => { try { return (await (await fetch('/system_stats')).json()).system; } catch (e) { return { error: String(e) }; } });

  const cases = readdirSync(dir).filter(n => n.startsWith('ui-') && n.endsWith('.json')).sort();
  for (const file of cases) {
    const name = basename(file, '.json').slice(3);
    const graph = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const expectPath = join(dir, `api-${name}.json`);
    const expected = existsSync(expectPath) ? JSON.parse(readFileSync(expectPath, 'utf8')) : null;
    report.stage = `load ${file}`; save();
    const row = await page.evaluate(async ({ graph, dump }) => {
      const { app } = await import('/scripts/app.js'); const row = { loaded: false };
      try {
        const opts = { skipAssetScans: true };
        await Promise.race([
          app.loadGraphData(graph, true, false, null, opts).catch(e => { if (e instanceof TypeError) return app.loadGraphData(graph, true, false, null); throw e; }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('loadGraphData timeout')), 30000)),
        ]);
        row.loaded = true;
        const lid = l => l == null ? null : (typeof l === 'object' ? l.id : l);
        const short = v => typeof v === 'string' && v.length > 160 ? `${v.slice(0, 160)}…(${v.length})` : v;
        const pick = id => { const n = app.graph.getNodeById(id); return n ? { type: n.type, mode: n.mode,
          inputs: n.inputs.map(i => ({ name: i.name, type: i.type, link: lid(i.link) })),
          outputs: n.outputs.map(o => ({ name: o.name, links: (o.links || []).map(lid) })) } : null; };
        row.graphNodes = app.graph.nodes.length;
        // 缺节点定义:前端对未知类名只会造裸 LGraphNode
        row.missingDefinitions = app.graph.nodes.filter(n => n.constructor.name === 'LGraphNode').map(n => ({ id: n.id, type: n.type }));
        row.picked = Object.fromEntries([9, 103, 800, 101, 5011, 5012, 4100].map(id => [id, pick(id)]));
        row.widgetDump = Object.fromEntries(dump.map(id => { const n = app.graph.getNodeById(id); if (!n) return [id, null];
          return [id, (n.widgets || []).map(w => ({ name: w.name, value: short(w.value), type: w.type, serialize: w.serialize ?? true }))]; }));
        const result = await app.graphToPrompt();
        row.output = result.output;
      } catch (error) { row.error = String(error); row.stack = String(error.stack).slice(0, 900); }
      return row;
    }, { graph, dump: WIDGET_DUMP });
    const absent = EXPECT_ABSENT[name] ?? [];
    const item = { file, ...row, output: undefined };
    if (row.output && expected) {
      item.diff = compare(expected, row.output, absent);
      const known = KNOWN_DEVIATIONS[name] ?? [];
      item.knownDeviations = item.diff.scalarMismatch.filter(x => known.includes(`#${x.id}.${x.name}`));
      item.diff.scalarMismatch = item.diff.scalarMismatch.filter(x => !known.includes(`#${x.id}.${x.name}`));
      // 导出多出的输入(执行图未列=引擎取定义默认值):标出画布值≠引擎默认值的,那才是「看到的≠跑的」
      item.diff.extraInputsNeedingDefault = item.diff.extraInputs.filter(x => {
        const def = report.objectInfo?.[expected[x.id]?.class_type];
        const spec = def?.input?.required?.[x.name] ?? def?.input?.optional?.[x.name];
        const d = spec?.[1]?.default;
        const fallback = Array.isArray(spec?.[0]) ? spec[0][0] : spec?.[0];
        return spec && !same(x.got, d !== undefined ? d : fallback);
      });
    }
    if (row.output) item.exportedNodes = Object.keys(row.output).length;
    report.cases.push(item); save();

    // 画面重绘计数器(只在本无头页面内给画布的逐帧绘制入口打补丁):画布分前后两层,
    // 取景参数设好后两层不一定当帧重绘完,过早截图会拍到错位的旧帧(1124 实测两张落空)
    await page.evaluate(() => {
      const c = window.comfyAPI.app.app.canvas;
      if (!window.__d17Draw) { let n = 0; const orig = c.draw.bind(c); c.draw = (...args) => { n += 1; return orig(...args); }; window.__d17Draw = () => n; }
    });
    for (const [id, tag] of SHOT_NODES) {
      const view = await page.evaluate(async id => {
        const app = window.comfyAPI.app.app; const node = app.graph.getNodeById(id); if (!node) return null;
        // 清掉界面右侧的版本兼容警告条等浮层(遮画布,与被测图无关;只动本无头页面的 DOM)
        const overlays = document.querySelectorAll('.p-toast, .comfy-toast');
        const removed = overlays.length; overlays.forEach(e => e.remove());
        const x = node.pos[0], y = node.pos[1], w = node.size[0], h = node.size[1];
        const boxOf = g => g.bounding ?? g._bounding ?? (g.pos && g.size ? [g.pos[0], g.pos[1], g.size[0], g.size[1]] : null);
        const group = (app.graph.groups || []).find(g => { const b = boxOf(g); return b && b[0] <= x && x + w <= b[0] + b[2] && b[1] <= y && y + h <= b[1] + b[3]; });
        // 以节点为中心取景:四周留 420 画布单位,看得到相邻节点与进出连线;缩放夹在 [0.55, 1] 保证文字可读
        const canvas = app.canvas; const rect = canvas.canvas.getBoundingClientRect(); const m = 420;
        const s = Math.max(0.55, Math.min(1, Math.min(rect.width / (w + 2 * m), rect.height / (h + 2 * m))));
        const want = [rect.width / 2 - (x + w / 2) * s, rect.height / 2 - (y + h / 2) * s];
        const before = window.__d17Draw();
        canvas.ds.scale = s; canvas.ds.offset = want; canvas.setDirty(true, true);
        // 等画布按新取景确实重绘过(至少 3 帧),再回读取景参数与画布中心像素留证
        const start = performance.now();
        while (window.__d17Draw() < before + 3 && performance.now() - start < 4000) await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 250));
        const ctx = canvas.canvas.getContext('2d');
        const applied = [canvas.ds.scale, canvas.ds.offset[0], canvas.ds.offset[1]].map(v => +Number(v).toFixed(3));
        const want3 = [s, want[0], want[1]].map(v => +Number(v).toFixed(3));
        return {
          group: group?.title ?? null, node: { title: node.title, type: node.type, mode: node.mode, pos: [x, y], size: [w, h] },
          scale: +s.toFixed(3), framesDrawn: window.__d17Draw() - before, framingApplied: JSON.stringify(applied) === JSON.stringify(want3),
          centrePixel: ctx ? Array.from(ctx.getImageData(Math.round(rect.width / 2), Math.round(rect.height / 2), 1, 1).data).join(',') : null,
          removedOverlays: removed,
        };
      }, id);
      if (!view) continue;
      mkdirSync(shotsDir, { recursive: true });
      const path = join(shotsDir, `${name}.${tag}.png`);
      await page.screenshot({ path });
      (item.shots ??= []).push({ path, ...view });
    }
    save();
  }
  report.stage = 'done'; save();
} catch (error) { report.fatal = String(error); report.stack = String(error.stack).slice(0, 1200); save(); console.error(error); process.exitCode = 2; }
finally { clearTimeout(deadline); await browser?.close(); save(); }

// ── 判定与打印 ──
let failed = false;
for (const c of report.cases) {
  const d = c.diff; const problems = [];
  if (!c.loaded) problems.push(`加载失败:${c.error}`);
  if (c.missingDefinitions?.length) problems.push(`缺节点定义:${c.missingDefinitions.map(n => `#${n.id} ${n.type}`).join(', ')}`);
  if (d) {
    if (d.missingNodes.length) problems.push(`导出缺节点:${d.missingNodes.join(',')}`);
    if (d.classMismatch.length) problems.push(`节点类型不符:${d.classMismatch.length} 处`);
    if (d.linkMismatch.length) problems.push(`连线不符 ${d.linkMismatch.length} 处:${d.linkMismatch.map(x => `#${x.id}.${x.name} 期望 ${JSON.stringify(x.expected)} 实得 ${JSON.stringify(x.got)}`).join('; ')}`);
    if (d.scalarMismatch.length) problems.push(`参数不符 ${d.scalarMismatch.length} 处:${d.scalarMismatch.map(x => `#${x.id}.${x.name} ${JSON.stringify(x.expected)}≠${JSON.stringify(x.got)}`).join('; ')}`);
    if (d.extraNodes.length) problems.push(`导出多出未知节点:${d.extraNodes.join(',')}`);
    if (d.extraInputsNeedingDefault.length) problems.push(`画布值≠引擎默认值(执行图未列此输入,引擎按默认跑):${d.extraInputsNeedingDefault.map(x => `#${x.id}.${x.name} 画布=${JSON.stringify(x.got)}`).join('; ')}`);
  }
  const appLinks = d ? APP_LINKS.map(([id, name]) => {
    if (d.skippedFromAbsent.includes(`${id}.${name}`)) return `${id}.${name}=本例不含`;
    if (d.linkMismatch.some(x => x.id === id && x.name === name)) return `${id}.${name}=不符`;
    if (d.missingNodes.includes(id)) return `${id}.${name}=节点缺`;
    return `${id}.${name}=一致`;
  }).join('  ') : '(无期望执行图,只验加载)';
  if (problems.length) failed = true;
  console.log(`\n[${problems.length ? 'FAIL' : 'PASS'}] ${c.file}  图内节点 ${c.graphNodes} / 导出 ${c.exportedNodes ?? '-'}`);
  console.log(`   App 四线:${appLinks}`);
  for (const p of problems) console.log('   ✗', p);
  if (c.knownDeviations?.length) console.log(`   · 预期内的差异 ${c.knownDeviations.length} 处(本例特有,不计不符):${c.knownDeviations.map(x => `#${x.id}.${x.name}`).join(' ')}`);
  if (d?.extraInputs.length) console.log(`   · 导出多出的输入 ${d.extraInputs.length} 个(执行图未列,引擎取默认):${d.extraInputs.map(x => `#${x.id}.${x.name}`).join(' ')}`);
  if (c.shots?.length) console.log(`   · 截图:${c.shots.map(s => `${basename(s.path)}(${s.group ?? '无组框'},缩放 ${s.scale})`).join(' ')}`);
}
console.log(`\n引擎:comfyui ${report.system?.comfyui_version} / 前端包 ${report.system?.comfy_package_versions?.find(p => p.name === 'comfyui-frontend-package')?.installed}(要求 ${report.system?.required_frontend_version})`);
console.log(`页面错误 ${report.pageErrors.length} 条;控制台 error/warning ${report.console.length} 条(全文见报告);拦截/伪造请求 ${report.blockedRequests.length} 条;发车 0`);
if (report.pageErrors.length) console.log('  页面错误:', report.pageErrors.slice(0, 5).join(' | '));
console.log(`报告:${join(dir, 'canvas-probe-report.json')}`);
if (failed) process.exitCode = 1;
