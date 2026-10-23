/** Read-only, isolated host-widget, selection and serialization regression probe. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve(import.meta.dirname, '../../..');
const appHome = join(homedir(), 'Library/Application Support', readdirSync(join(homedir(), 'Library/Application Support')).find(n => n === '漫影工作室'));
const manifest = JSON.parse(readFileSync(join(appHome, 'comfyui/manifest.json'), 'utf8'));
const origin = `http://127.0.0.1:${manifest.engine.port}`;
const sources = process.argv[2] || join(root, 'apps/backend/engines/comfyui');
const files = execFileSync('fd', ['-a', '--fixed-strings', 'qi21-道劫-i2i.json', sources], { encoding: 'utf8' }).trim().split('\n');
files.push(execFileSync('fd', ['-a', '--fixed-strings', 'qi21-提示词类型优化子图-i2i.json', sources], { encoding: 'utf8' }).trim());
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const executablePath = join(cache, readdirSync(cache).find(n => n === 'chromium_headless_shell-1243'), 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
const browser = await chromium.launch({ headless: true, executablePath });
const report = { generationSubmitted: false, errors: [], ok: false };
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST' && url.origin === origin && url.pathname.startsWith('/api/settings/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    } else if (req.method() !== 'GET' || url.origin !== origin) await route.abort();
    else await route.continue();
  });
  await context.routeWebSocket('**/*', route => {
    route.onMessage(message => {
      try { if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({ type: 'feature_flags', data: {} })); } catch {}
    });
    route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'qi21-output-layout-isolated' } }));
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.committedGraphLoadSequence > 0, null, { timeout: 25000 });
  const graph = JSON.parse(readFileSync(files[0], 'utf8'));
  report.rendered = await page.evaluate(async graph => {
    const { app } = await import('/scripts/app.js');
    await app.loadGraphData(graph, true, false, null, { skipAssetScans: true });
    const prompt = await app.graphToPrompt();
    const group = app.graph.serialize().groups.find(g => g.title === '道劫·④输出');
    const nodes = [5, 7500, 8].map(id => {
      const n = app.graph.getNodeById(id);
      return { id, pos: Array.from(n.pos), size: Array.from(n.size) };
    });
    const overlaps = nodes.flatMap((a, i) => nodes.slice(i + 1).filter(b => a.pos[0] < b.pos[0] + b.size[0] && b.pos[0] < a.pos[0] + a.size[0] && a.pos[1] - 30 < b.pos[1] + b.size[1] && b.pos[1] - 30 < a.pos[1] + a.size[1]).map(b => [a.id, b.id]));
    app.canvas.ds.scale = 0.6;
    app.canvas.ds.offset[0] = 180 / 0.6 - group.bounding[0];
    app.canvas.ds.offset[1] = 110 / 0.6 - group.bounding[1];
    app.canvas.resize(); app.canvas.draw(true, true);
    await new Promise(resolve => setTimeout(resolve, 500));
    return { group, nodes, overlaps, exportedNodes: Object.keys(prompt.output).length };
  }, graph);
  await page.screenshot({ path: join(root, 'apps/output/automation/qi21-i2i-output-compact.png') });
  assert(Math.abs(report.rendered.group.bounding[2] - 1587.3) < 0.01);
  assert.deepEqual(report.rendered.nodes.find(n => n.id === 8).pos, [8790, 2446.1]);
  assert.deepEqual(report.rendered.overlaps, []);
  const [x, y, w, h] = report.rendered.group.bounding;
  for (const n of report.rendered.nodes) {
    assert(n.pos[0] >= x && n.pos[1] - 30 >= y && n.pos[0] + n.size[0] <= x + w && n.pos[1] + n.size[1] <= y + h);
  }
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) { report.fatal = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  writeFileSync(join(root, 'apps/output/automation/qi21-i2i-output-compact-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
