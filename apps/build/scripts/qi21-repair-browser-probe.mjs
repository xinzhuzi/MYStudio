/** Isolated post-install graph export and canvas evidence for the qi21 repair. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const appHome = join(homedir(), 'Library/Application Support', readdirSync(join(homedir(), 'Library/Application Support')).find(n => n === '漫影工作室'));
const manifest = JSON.parse(readFileSync(join(appHome, 'comfyui/manifest.json'), 'utf8'));
const origin = `http://127.0.0.1:${manifest.engine.port}`;
const sources = process.argv[2] || join(root, 'apps/backend/engines/comfyui/workflows');
const files = ['qi21-道劫-t2i.json', 'qi21-道劫-i2i.json', 'qi21-edit.json'].map(name => execFileSync('fd', ['-a', '--fixed-strings', name, sources], { encoding: 'utf8' }).trim());
if (files.some(f => !f || f.includes('\n'))) throw new Error('Workflow discovery not unique');
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const executablePath = join(cache, readdirSync(cache).find(n => n === 'chromium_headless_shell-1243'), 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
const out = join(root, 'apps/output/automation/qi21-repair-browser');
const report = { origin, productionMutations: false, generationSubmitted: false, blockedRequests: [], errors: [], cases: [], ok: false };
const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const file of files) {
    const context = await browser.newContext({ viewport: { width: 2000, height: 1450 } });
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === 'POST' && url.origin === origin && url.pathname.startsWith('/api/settings/')) {
        report.blockedRequests.push({ method: request.method(), path: url.pathname, simulated: true });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      if (request.method() !== 'GET' || url.origin !== origin) {
        report.blockedRequests.push({ method: request.method(), path: url.pathname });
        await route.abort();
      } else await route.continue();
    });
    await context.routeWebSocket('**/*', route => {
      route.onMessage(message => {
        try { if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({ type: 'feature_flags', data: {} })); } catch {}
      });
      route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'qi21-repair-isolated' } }));
    });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => {
      const app = window.comfyAPI?.app?.app;
      return app?.positionConversion && app.committedGraphLoadSequence > 0 && !app.configuringGraphLevel;
    }, null, { timeout: 25000 });
    const graph = JSON.parse(readFileSync(file, 'utf8'));
    const row = await page.evaluate(async graph => {
      const { app } = await import('/scripts/app.js');
      await app.loadGraphData(graph, true, false, null, { skipAssetScans: true });
      const prompt = await app.graphToPrompt();
      const missing = Object.entries(prompt.output).filter(([, n]) => !n.class_type).map(([id]) => id);
      if (missing.length) throw new Error('Missing class_type: ' + missing.join(','));
      return { exported: true, nodeCount: Object.keys(prompt.output).length, output: prompt.output };
    }, graph);
    if (file === files[0]) {
      row.seedvr2 = await page.evaluate(async () => {
        const { app } = await import('/scripts/app.js');
        const nodes = app.graph.serialize().nodes.map(s => {
          const n = app.graph.getNodeById(s.id); return { id: s.id, pos: Array.from(n.pos), size: Array.from(n.size) };
        });
        const node = nodes.find(n => n.id === 503);
        if (node.pos[0] !== 8000 || node.pos[1] !== 2280) throw new Error('SeedVR2 position mismatch');
        const overlaps = nodes.filter(n => n.id !== 503 && node.pos[0] < n.pos[0] + n.size[0] && n.pos[0] < node.pos[0] + node.size[0] && node.pos[1] - 30 < n.pos[1] + n.size[1] && n.pos[1] - 30 < node.pos[1] + node.size[1]);
        if (overlaps.length) throw new Error('SeedVR2 rendered overlaps');
        const ds = app.canvas.ds; ds.scale = 0.65; ds.offset[0] = -7350; ds.offset[1] = -1570; app.canvas.draw(true, true);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { node, overlaps };
      });
      await page.screenshot({ path: out + '-seedvr2.png' });
      row.note4100 = await page.evaluate(async () => {
        const { app } = await import('/scripts/app.js');
        const host = app.graph.getNodeById(6); const sg = host.subgraph; app.canvas.openSubgraph(sg, host);
        await new Promise(resolve => setTimeout(resolve, 500));
        app.canvas.resize(); app.canvas.setDirty(true, true); app.canvas.draw(true, true);
        if (app.canvas.graph !== sg) throw new Error('Prompt subgraph did not open');
        const nodes = sg.serialize().nodes.map(s => { const n = sg.getNodeById(s.id); return { id: s.id, pos: Array.from(n.pos), size: Array.from(n.size) }; });
        const node = nodes.find(n => n.id === 4100), peers = nodes.filter(n => n.id !== 4100);
        const contentCenter = (Math.min(...peers.map(n => n.pos[0])) + Math.max(...peers.map(n => n.pos[0] + n.size[0]))) / 2;
        const centerDifference = node.pos[0] + node.size[0] / 2 - contentCenter;
        if (node.size[0] !== 1330 || node.size[1] !== 440 || node.pos[1] !== 80 || Math.abs(centerDifference) > 0.001) throw new Error('Note size or center mismatch: ' + JSON.stringify({ node, contentCenter }));
        const overlaps = peers.filter(n => node.pos[0] < n.pos[0] + n.size[0] && n.pos[0] < node.pos[0] + node.size[0] && node.pos[1] - 30 < n.pos[1] + n.size[1] && n.pos[1] - 30 < node.pos[1] + node.size[1]);
        if (overlaps.length) throw new Error('Note rendered overlaps');
        const ds = app.canvas.ds; ds.scale = 0.9; ds.offset[0] = -615; ds.offset[1] = 40; app.canvas.draw(true, true);
        app.canvas.resize(); app.canvas.setDirty(true, true);
        await new Promise(resolve => setTimeout(resolve, 500)); app.canvas.draw(true, true);
        return { node, contentCenter, centerDifference, overlaps };
      });
      await page.screenshot({ path: out + '-note4100.png' });
    }
    report.cases.push({ file, ...row });
    await context.close();
  }
  report.ok = report.cases.length === 3 && report.cases.every(c => c.exported);
} catch (error) { report.fatal = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  writeFileSync(out + '.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.map(c => ({ file: c.file, exported: c.exported, nodeCount: c.nodeCount, seedvr2: c.seedvr2, note4100: c.note4100 })), fatal: report.fatal, errors: report.errors, report: out + '.json' }));
}
