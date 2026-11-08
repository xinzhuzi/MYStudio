/** Isolated QI21 source-canvas verification. Never submits generation or writes user state. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../../..');
const sources = resolve(process.argv[2] || join(root, 'apps/backend/comfyui'));
const out = join(root, 'apps/output/automation/qi21-current-browser-1026');
mkdirSync(out, { recursive: true });
const support = join(homedir(), 'Library/Application Support');
const appName = readdirSync(support).find(n => n === '漫影工作室');
assert(appName, 'App data directory missing');
const manifest = JSON.parse(readFileSync(join(support, appName, 'comfyui/manifest.json'), 'utf8'));
assert(Number.isInteger(manifest.engine.port), 'Invalid managed engine port');
const origin = `http://127.0.0.1:${manifest.engine.port}`;
const discover = name => {
  const rows = execFileSync('fd', ['-a', '--fixed-strings', name, join(sources, 'workflows')], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(rows.length, 1, `Nonunique workflow ${name}`); assert(rows[0]); return rows[0];
};
const files = ['qi21-道劫-t2i.json', 'qi21-道劫-i2i.json'].map(discover);
const bytes = files.map(file => readFileSync(file));
const sha = data => createHash('sha256').update(data).digest('hex');
const report = { origin, sources, productionMutations: false, generationSubmitted: false, blockedRequests: [], errors: [], cases: [], ok: false };
let browser;
try {
  const response = await fetch(origin + '/object_info/MyQi21DaojieBase', { signal: AbortSignal.timeout(5000) });
  assert(response.ok, 'Current object_info unavailable');
  const baseSchema = (await response.json()).MyQi21DaojieBase;
  const currentTypes = baseSchema.input.required.base[0];
  assert(currentTypes.includes('人物海报') && currentTypes.includes('人脸基准'), 'Current type enum missing expected public types');
  report.currentTypes = currentTypes;
  const { chromium } = require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const build = readdirSync(cache).find(n => n === 'chromium_headless_shell-1243');
  assert(build, 'Known verified Chromium build missing');
  const executablePath = join(cache, build, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
  assert(existsSync(executablePath));
  browser = await chromium.launch({ headless: true, executablePath });
  for (const [index, file] of files.entries()) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST' && url.origin === origin && url.pathname.startsWith('/api/settings/')) {
        report.blockedRequests.push({ method: request.method(), path: url.pathname, simulated: true });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else if (request.method() !== 'GET' || url.origin !== origin) {
        report.blockedRequests.push({ method: request.method(), path: url.pathname });
        await route.abort();
      } else await route.continue();
    });
    await context.routeWebSocket('**/*', route => {
      route.onMessage(message => {
        try {
          if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({ type: 'feature_flags', data: {} }));
        } catch {}
      });
      route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'qi21-current-browser-isolated' } }));
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ file: basename(file), message: String(error) }));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => {
      const app = window.comfyAPI?.app?.app;
      return app?.positionConversion && app.committedGraphLoadSequence > 0 && !app.configuringGraphLevel;
    }, null, { timeout: 25000 });
    const graph = JSON.parse(bytes[index]);
    const row = await page.evaluate(async ({ graph, currentTypes, index }) => {
      const { app } = await import('/scripts/app.js');
      const load = async data => app.loadGraphData(data, true, false, null, { skipAssetScans: true });
      const findHost = () => app.graph.getNodeById(6);
      const widgetsOf = node => node.widgets.map(w => ({ name: w.name, value: w.value, type: w.type, values: w.options?.values }));
      const findType = output => Object.values(output).find(n => n.class_type === 'MyQi21DaojieBase');
      await load(graph);
      const host = findHost(), widgets = widgetsOf(host);
      const baseline = await app.graphToPrompt();
      if (Object.values(baseline.output).some(n => !n.class_type)) throw new Error('Missing exported class_type');
      const expectedNames = index === 0 ? ['型选择'] : ['型选择', 'PE启用?', 'RGBA透明', '组装用途'];
      if (JSON.stringify(widgets.map(w => w.name)) !== JSON.stringify(expectedNames)) throw new Error('Host widget order mismatch');
      if (JSON.stringify(widgets[0].values) !== JSON.stringify(currentTypes)) throw new Error('Host enum differs from current object_info');
      if (host.widgets.some(w => w.name === '指令')) throw new Error('Linked instruction incorrectly occupies a widget');
      const selections = [];
      for (const value of currentTypes) {
        const selected = findHost().widgets.find(w => w.name === '型选择');
        selected.value = value; await selected.callback?.(value);
        const first = await app.graphToPrompt();
        const serialized = app.graph.serialize();
        await load(serialized);
        const second = await app.graphToPrompt();
        selections.push({ selected: value, exported: findType(first.output)?.inputs.base, restored: findHost().widgets.find(w => w.name === '型选择').value, reexported: findType(second.output)?.inputs.base });
      }
      await load(graph);
      const controlSelections = [];
      if (index === 1) {
        for (const [name, value, type, input] of [
          ['PE启用?', true, 'MyQi21InstructionSelect', 'pe开关'],
          ['RGBA透明', 'true', 'MyQi21RgbaSelect', 'mode'],
          ['组装用途', '道劫美术类型', 'MyQi21PromptAssembly', '组装用途'],
        ]) {
          const widget = findHost().widgets.find(w => w.name === name), original = widget.value;
          widget.value = value; await widget.callback?.(value);
          const prompt = await app.graphToPrompt();
          controlSelections.push({ name, selected: value, exported: Object.values(prompt.output).find(n => n.class_type === type)?.inputs[input] });
          widget.value = original; await widget.callback?.(original);
        }
      }
      const serialized = app.graph.serialize();
      await load(serialized);
      const restored = widgetsOf(findHost());
      const geometryOf = scope => ({
        nodes: scope._nodes.map(n => ({ id: n.id, type: n.type, pos: Array.from(n.pos), size: Array.from(n.size) })),
        groups: scope.serialize().groups,
      });
      const geometry = { main: geometryOf(app.graph), subgraphs: app.graph._nodes.filter(n => n.subgraph).map(n => ({ host: n.id, name: n.subgraph.name, ...geometryOf(n.subgraph) })) };
      const accel = app.graph.getNodeById(7).subgraph;
      const hybrid = [7040, 7041, 7042, 7043, 7044].map(id => {
        const n = accel.getNodeById(id); return n ? { id, type: n.type } : null;
      });
      const panel = findHost();
      app.canvas.ds.scale = 1; app.canvas.ds.offset[0] = 500 - panel.pos[0]; app.canvas.ds.offset[1] = 140 - panel.pos[1];
      app.canvas.resize(); app.canvas.draw(true, true);
      await new Promise(resolve => setTimeout(resolve, 300));
      return { widgets, exportedBase: findType(baseline.output)?.inputs.base, selections, controlSelections, restored, hybrid, geometry, output: baseline.output };
    }, { graph, currentTypes, index });
    assert.deepEqual(row.widgets.map(w => w.value), index === 0 ? ['人物海报'] : ['人物海报', false, '自动', '自由出图']);
    assert.equal(row.exportedBase, '人物海报');
    for (const selection of row.selections) {
      assert.equal(selection.exported, selection.selected); assert.equal(selection.restored, selection.selected); assert.equal(selection.reexported, selection.selected);
    }
    for (const selection of row.controlSelections) assert.equal(selection.exported, selection.selected);
    assert.deepEqual(row.restored.map(w => w.value), row.widgets.map(w => w.value));
    assert(row.hybrid.every(Boolean), 'New E-hybrid GUI branch missing');
    const stem = index === 0 ? 't2i' : 'i2i';
    await page.screenshot({ path: join(out, stem + '-host.png') });
    await page.evaluate(async () => {
      const { app } = await import('/scripts/app.js');
      const group = app.graph.serialize().groups.find(g => g.title === '道劫·④输出');
      if (group) {
        app.canvas.ds.scale = Math.min(0.7, 1300 / group.bounding[2], 780 / group.bounding[3]);
        app.canvas.ds.offset[0] = 100 / app.canvas.ds.scale - group.bounding[0];
        app.canvas.ds.offset[1] = 80 / app.canvas.ds.scale - group.bounding[1];
        app.canvas.resize(); app.canvas.draw(true, true);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    });
    await page.screenshot({ path: join(out, stem + '-output.png') });
    row.seedvr2 = await page.evaluate(async () => {
      const { app } = await import('/scripts/app.js');
      const node = app.graph.getNodeById(503);
      if (!node) return null;
      const bounds = n => [n.pos[0], n.pos[1] - 30, n.pos[0] + n.size[0], n.pos[1] + n.size[1]];
      const box = bounds(node);
      const overlaps = app.graph._nodes.filter(n => n !== node).filter(n => {
        const b = bounds(n); return box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3];
      }).map(n => n.id);
      app.canvas.ds.scale = Math.min(0.8, 900 / node.size[0], 700 / node.size[1]);
      app.canvas.ds.offset[0] = 350 / app.canvas.ds.scale - node.pos[0];
      app.canvas.ds.offset[1] = 180 / app.canvas.ds.scale - node.pos[1];
      app.canvas.resize(); app.canvas.draw(true, true);
      await new Promise(resolve => setTimeout(resolve, 300));
      return { id: node.id, title: node.title, pos: Array.from(node.pos), size: Array.from(node.size), overlaps };
    });
    if (row.seedvr2) {
      assert.deepEqual(row.seedvr2.overlaps, [], 'SeedVR2 runtime overlap');
      await page.screenshot({ path: join(out, stem + '-seedvr2.png') });
    }
    row.note4100 = await page.evaluate(async () => {
      const { app } = await import('/scripts/app.js');
      const host = app.graph.getNodeById(6), scope = host.subgraph;
      app.canvas.openSubgraph(scope, host);
      await new Promise(resolve => setTimeout(resolve, 700));
      assertSubgraph();
      function assertSubgraph() { if (app.canvas.graph !== scope) throw new Error('Prompt subgraph did not open'); }
      const node = scope.getNodeById(4100);
      if (!node) return null;
      const peers = scope._nodes.filter(n => n !== node);
      const center = (Math.min(...peers.map(n => n.pos[0])) + Math.max(...peers.map(n => n.pos[0] + n.size[0]))) / 2;
      const overlaps = peers.filter(n => node.pos[0] < n.pos[0] + n.size[0] && n.pos[0] < node.pos[0] + node.size[0] && node.pos[1] - 30 < n.pos[1] + n.size[1] && n.pos[1] - 30 < node.pos[1] + node.size[1]).map(n => n.id);
      app.canvas.ds.scale = Math.min(0.85, 1150 / node.size[0], 700 / node.size[1]);
      app.canvas.ds.offset[0] = 180 / app.canvas.ds.scale - node.pos[0];
      app.canvas.ds.offset[1] = 160 / app.canvas.ds.scale - node.pos[1];
      app.canvas.resize(); app.canvas.setDirty(true, true); app.canvas.draw(true, true);
      await new Promise(resolve => setTimeout(resolve, 500));
      app.canvas.ds.scale = Math.min(0.85, 1150 / node.size[0], 700 / node.size[1]);
      app.canvas.ds.offset[0] = 180 / app.canvas.ds.scale - node.pos[0];
      app.canvas.ds.offset[1] = 160 / app.canvas.ds.scale - node.pos[1];
      app.canvas.setDirty(true, true); app.canvas.draw(true, true);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { id: node.id, pos: Array.from(node.pos), size: Array.from(node.size), centerDifference: node.pos[0] + node.size[0] / 2 - center, overlaps };
    });
    if (row.note4100) {
      assert.deepEqual(row.note4100.overlaps, [], 'Note4100 runtime overlap');
      await page.screenshot({ path: join(out, stem + '-note4100.png') });
    }
    report.cases.push({ file, sourceSha256: sha(bytes[index]), ...row });
    await context.close();
  }
  const orderProbe = String.raw`
import importlib,json,sys,types
from pathlib import Path
root=Path(sys.argv[1]);graph=json.load(sys.stdin)
package=types.ModuleType('qi21_browser_nodes')
package.__path__=[str(root/'apps/backend/comfyui/my_nodes/nodes')]
sys.modules[package.__name__]=package
def load(name):
 return importlib.import_module(package.__name__+'.'+name[:-3])
base_mod=load('my_qi21_base.py');pe_mod=load('my_qi21_api_pe.py');final_mod=load('my_qi21_final_output.py');text_mod=load('my_qi21_bases_text.py')
pe=next(n['inputs'] for n in graph.values() if n['class_type']=='MyQi21ApiPE')
style_id=pe['美术风格底座-正向'][0];base_id=pe['类型句正向'][0]
assert graph[style_id]['class_type']=='MyQi21美术风格底座' and pe['美术风格底座-正向'][1]==0
assert graph[base_id]['class_type']=='MyQi21DaojieBase' and pe['类型句正向'][1]==0
final_inputs=next(n['inputs'] for n in graph.values() if n['class_type']=='MyQi21FinalOutput')
assert graph[final_inputs['正向提示词'][0]]['class_type']=='MyQi21ApiPE'
style,style_negative=text_mod.MyQi21美术风格底座().output()['result']
subject='一位青年男修正面立于山门石阶，双臂自然垂落。'
rows=[]
for kind in ('人物海报','人脸基准'):
 base=base_mod.MyQi21DaojieBase().run(kind)
 rewritten=pe_mod.MyQi21ApiPE().rewrite(正向提示词=subject,类型句正向=base[0],类型句负向=base[3],透明模式=base[4],AI扩写开关=False,**{'美术风格底座-正向':style,'美术风格底座-负向':style_negative})
 assembled,negative=rewritten['result'][:2]
 final,_=final_mod.MyQi21FinalOutput().compose(正向提示词=assembled,负向提示词=negative,透明模式=base[4])
 positions=[assembled.index(style),assembled.index('类型句:'),assembled.index('主体句:')]
 assert positions[0]==0 and positions[0]<positions[1]<positions[2]
 assert assembled in final
 rows.append({'type':kind,'order':['美术风格底座','类型句','主体句'],'positions':positions,'rgbaWrappedOutside':bool(base[4]),'assembledLength':len(assembled),'finalLength':len(final)})
print(json.dumps(rows,ensure_ascii=False))
`;
  report.promptOrder = JSON.parse(execFileSync('python3', ['-c', orderProbe, root], { input: JSON.stringify(report.cases[0].output), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim().split('\n').at(-1));
  report.sourcesUnchanged = files.every((file, i) => sha(readFileSync(file)) === sha(bytes[i]));
  assert(report.sourcesUnchanged, 'Source changed while verifying; rerun current source');
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.fatal = String(error); report.cause = error.cause ? String(error.cause) : undefined; process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, origin, caseCount: report.cases.length, types: report.currentTypes?.length, promptOrder: report.promptOrder, fatal: report.fatal, errors: report.errors, report: join(out, 'report.json') }));
}
