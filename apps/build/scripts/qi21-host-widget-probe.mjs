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
const report = { origin, generationSubmitted: false, errors: [], cases: [], ok: false };
const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const file of files) {
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
      route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'qi21-widget-isolated' } }));
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.committedGraphLoadSequence > 0, null, { timeout: 25000 });
    const graph = JSON.parse(readFileSync(file, 'utf8'));
    const row = await page.evaluate(async graph => {
      const { app } = await import('/scripts/app.js');
      await app.loadGraphData(graph, true, false, null, { skipAssetScans: true });
      const host = app.graph._nodes.find(n => n.subgraph?._nodes.some(inner => inner.type === 'MyQi21DaojieBase'));
      const widgets = host.widgets.map(w => ({ name: w.name, type: w.type, value: w.value, values: w.options?.values }));
      const baseline = await app.graphToPrompt();
      const base = Object.values(baseline.output).find(n => n.class_type === 'MyQi21DaojieBase');
      const selections = [];
      for (const value of [...widgets[0].values, '人物']) {
        const widget = host.widgets.find(w => w.name === '型选择');
        widget.value = value; widget.callback?.(value);
        const prompt = await app.graphToPrompt();
        selections.push({ selected: value, exported: Object.values(prompt.output).find(n => n.class_type === 'MyQi21DaojieBase')?.inputs.base });
      }
      const exportedControls = [
        ['PE启用?', 'MyQi21InstructionSelect', 'pe开关'],
        ['RGBA透明', 'MyQi21RgbaSelect', 'mode'],
        ['组装用途', 'MyQi21PromptAssembly', '组装用途'],
      ].map(([name, type, input]) => ({ name, value: Object.values(baseline.output).find(n => n.class_type === type)?.inputs[input] }));
      const otherSelections = [];
      for (const [name, value, type, input] of [
        ['PE启用?', true, 'MyQi21InstructionSelect', 'pe开关'],
        ['RGBA透明', 'true', 'MyQi21RgbaSelect', 'mode'],
        ['组装用途', '道劫美术类型', 'MyQi21PromptAssembly', '组装用途'],
      ]) {
        const widget = host.widgets.find(w => w.name === name), original = widget.value;
        widget.value = value; widget.callback?.(value);
        const prompt = await app.graphToPrompt();
        otherSelections.push({ name, selected: value, exported: Object.values(prompt.output).find(n => n.class_type === type)?.inputs[input] });
        widget.value = original; widget.callback?.(original);
      }
      const serialized = app.graph.serialize();
      await app.loadGraphData(serialized, true, false, null, { skipAssetScans: true });
      const restored = app.graph._nodes.find(n => n.subgraph?._nodes.some(inner => inner.type === 'MyQi21DaojieBase'));
      app.canvas.ds.scale = 1;
      app.canvas.ds.offset[0] = 620 - restored.pos[0];
      app.canvas.ds.offset[1] = 140 - restored.pos[1];
      app.canvas.resize(); app.canvas.draw(true, true);
      await new Promise(resolve => setTimeout(resolve, 300));
      return { widgets, exportedBase: base?.inputs.base, selections, exportedControls, otherSelections, roundtrip: restored.widgets.map(w => ({ name: w.name, value: w.value })) };
    }, graph);
    report.cases.push({ file, ...row });
    await page.screenshot({ path: join(root, `apps/output/automation/qi21-host-widget-${report.cases.length}.png`) });
    await context.close();
  }
  for (const row of report.cases) {
    assert.deepEqual(row.widgets.map(w => w.name), ['型选择', 'PE启用?', 'RGBA透明', '组装用途']);
    assert.deepEqual(row.widgets.map(w => w.value), ['人物', false, '自动', '自由出图']);
    assert.equal(row.exportedBase, '人物');
    assert(row.widgets[0].values.includes('高清人脸'));
    for (const selection of row.selections) assert.equal(selection.exported, selection.selected);
    assert.deepEqual(row.exportedControls.map(c => c.value), [false, '自动', '自由出图']);
    for (const selection of row.otherSelections) assert.equal(selection.exported, selection.selected);
    assert.deepEqual(row.roundtrip.map(w => w.value), ['人物', false, '自动', '自由出图']);
  }
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) { report.fatal = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  const output = join(root, 'apps/output/automation/qi21-host-widget-probe.json');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
