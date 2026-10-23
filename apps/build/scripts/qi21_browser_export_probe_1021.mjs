/** Isolated frontend export only; blocks all production mutations and sockets. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(root, '.trellis/tasks/10-20-trellis-audit-remediation/research/round15-i2i-output-error');
const appHome = join(homedir(), 'Library/Application Support', readdirSync(join(homedir(), 'Library/Application Support')).find(n => n === '漫影工作室'));
const manifest = JSON.parse(readFileSync(join(appHome, 'comfyui/manifest.json'), 'utf8'));
const origin = `http://127.0.0.1:${manifest.engine.port}`;
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const executable = join(cache, readdirSync(cache).find(n => n === 'chromium_headless_shell-1243'), 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
const report = { origin, liveAppAttached: false, generationSubmitted: false, blockedRequests: [], pageErrors: [], cases: [], stage: 'launch' };
const save = () => writeFileSync(join(out, 'main-browser-export-node.json'), JSON.stringify(report, null, 2) + '\n');
let browser;
const deadline = setTimeout(() => { report.timeout = report.stage; save(); browser?.close().finally(() => process.exit(2)); }, 90000);
try {
  browser = await chromium.launch({ headless: true, executablePath: executable });
  console.log('launched');
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route('**/*', async route => {
    const request = route.request(); const u = new URL(request.url());
    if (request.method() !== 'GET' || u.origin !== origin || u.pathname === '/prompt') {
      report.blockedRequests.push({ method: request.method(), url: request.url() });
      await route.abort();
    } else await route.continue();
  });
  await context.routeWebSocket('**/*', route => {
    route.onMessage(message => {
      try { if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({type:'feature_flags',data:{}})); } catch {}
    });
    route.send(JSON.stringify({type:'status',data:{status:{exec_info:{queue_remaining:0}},sid:'round15-offline-browser'}}));
  });
  const page = await context.newPage();
  page.on('pageerror', e => { report.pageErrors.push(e.stack ?? String(e)); save(); });
  page.on('console', msg => { if (msg.type() === 'error') report.pageErrors.push(msg.text()); });
  report.stage = 'navigate'; save();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('navigated');
  report.stage = 'app ready'; save();
  await page.waitForFunction(() => { const app = window.comfyAPI?.app?.app; return app?.positionConversion && app.committedGraphLoadSequence > 0 && !app.configuringGraphLevel; }, null, { timeout: 25000 });
  console.log('ready');
  console.log('boot', await page.evaluate(() => ({apiKeys:Object.keys(window.comfyAPI),canvasCount:document.querySelectorAll('canvas').length})));
  const files = [];
  const scan = path => { for (const e of readdirSync(path, { withFileTypes: true })) { const p = join(path, e.name); if (e.isDirectory()) scan(p); else if (['qi21-道劫-i2i.json','qi21-道劫-t2i.json','qi21-edit.json'].includes(e.name)) files.push(p); } };
  scan(join(root, 'apps/backend/comfyui/workflows'));
  files.sort((a,b) => Number(!a.endsWith('qi21-道劫-i2i.json')) - Number(!b.endsWith('qi21-道劫-i2i.json')));
  for (const file of files) {
    if (report.cases.length) {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => { const app = window.comfyAPI?.app?.app; return app?.positionConversion && app.committedGraphLoadSequence > 0 && !app.configuringGraphLevel; }, null, { timeout: 25000 });
    }
    report.stage = file; save(); console.log('load', file);
    const graph = JSON.parse(readFileSync(file, 'utf8'));
    if (process.argv.includes('--simulate-repair') && file.endsWith('qi21-道劫-i2i.json')) {
      const host = graph.nodes.find(n => n.id === 6);
      const sg = graph.definitions.subgraphs.find(s => s.id === host.type);
      const router = graph.nodes.find(n => n.id === 19);
      graph.nodes = graph.nodes.filter(n => n.id !== 19);
      router.id = 4022; router.title = '[4022] 用途画幅路由·自动'; router.pos = [5780, 1620];
      router.inputs[0].link = 287; router.outputs[0].links = [288]; sg.nodes.push(router);
      const passthrough = sg.links.find(l => l.id === 287);
      passthrough.target_id = 4022; passthrough.target_slot = 0;
      sg.links.push({id: 288, origin_id: 4022, origin_slot: 0, target_id: -20, target_slot: 5, type: 'BOOLEAN'});
      sg.outputs[5].name = '使用类型画幅'; sg.outputs[5].type = 'BOOLEAN'; sg.outputs[5].linkIds = [288];
      host.outputs[5].name = '使用类型画幅'; host.outputs[5].type = 'BOOLEAN'; host.outputs[5].links = [32];
      graph.links = graph.links.filter(l => l[0] !== 7468);
      const link = graph.links.find(l => l[0] === 32); link[1] = 6; link[2] = 5;
      sg.state.lastNodeId = Math.max(sg.state.lastNodeId, 4022); sg.state.lastLinkId = Math.max(sg.state.lastLinkId, 288); sg.last_link_id = Math.max(sg.last_link_id, 288);
      report.simulatedRepair = true;
    }
    const result = await page.evaluate(async graph => {
      const { app } = await import('/scripts/app.js'); const row = { loaded: false };
      try {
        await Promise.race([app.loadGraphData(graph, true, false, null, { skipAssetScans: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('loadGraphData timeout')), 15000))]);
        if (app.graph.getNodeById(6)?.type !== graph.nodes.find(n => n.id === 6)?.type) throw new Error('Loaded graph identity mismatch');
        row.loaded = true;
        const node = app.graph.getNodeById(19);
        row.node19 = node ? { type: node.type, comfyClass: node.comfyClass, outputs: node.outputs.map(x => ({name: x.name, type: x.type})), inputs: node.inputs.map(x => ({name: x.name, type: x.type})), nodeDataOutputs: node.constructor.nodeData?.output ?? null } : null;
        row.nodeClasses = app.graph.serialize().nodes.map(n => {const x = app.graph.getNodeById(n.id); return {id:n.id,type:n.type,comfyClass:x.comfyClass,constructor:x.constructor.name};});
        const result = await app.graphToPrompt(); row.output = result.output; row.nodeCount = Object.keys(result.output).length;
        const missing = Object.entries(result.output).filter(([, n]) => !n.class_type).map(([id]) => id);
        if (missing.length) throw new Error(`Export has missing class_type: ${missing.join(',')}`);
        row.exported = true;
      } catch (error) { row.exported = false; row.error = String(error); row.stack = error.stack; }
      return row;
    }, graph);
    report.cases.push({ file, ...result }); save();
    console.log(JSON.stringify({file, ...Object.fromEntries(Object.entries(result).filter(([k]) => !['output','node19','nodeClasses'].includes(k))) }));
  }
  await page.screenshot({ path: join(out, 'main-isolated-canvas.png') });
  report.stage = 'done'; save();
} catch (error) { report.fatal = String(error); report.stack = error.stack; save(); console.error(error); process.exitCode = 2; }
finally { clearTimeout(deadline); await browser?.close(); save(); }
if (!process.exitCode) process.exitCode = report.cases.length === 3 && report.cases.every(x => x.exported) ? 0 : 1;
