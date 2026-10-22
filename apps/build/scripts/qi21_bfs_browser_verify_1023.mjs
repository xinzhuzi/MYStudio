/** Isolated BFS canvas/export verification; forbids all server mutations. */
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('/Users/zhengbingjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve(import.meta.dirname, '../../..');
const out = join(root, '.trellis/tasks/10-22-bfs-qwen21-color-diagnosis/research/production-sync-1023');
const inventory = JSON.parse(readFileSync(join(out, 'inventory.json'), 'utf8'));
const source = join(resolve(inventory.source, '..'), inventory.new_name);
const graph = JSON.parse(readFileSync(source, 'utf8'));
const appHome = join(homedir(), 'Library/Application Support', readdirSync(join(homedir(), 'Library/Application Support')).find(n => n === '漫影工作室'));
const manifest = JSON.parse(readFileSync(join(appHome, 'comfyui/manifest.json'), 'utf8'));
const origin = `http://127.0.0.1:${manifest.engine.port}`;
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const executable = join(cache, 'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const report = {origin, source, isolatedBrowser: true, liveAppAttached: false, generationSubmitted: false, blockedRequests: [], pageErrors: [], stage: 'launch', ok: false};
const save = () => writeFileSync(join(out, 'browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: executable});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== origin || url.pathname === '/prompt') {
      report.blockedRequests.push({method: request.method(), url: request.url()});
      return route.abort();
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', route => {
    route.onMessage(message => {
      try {if (JSON.parse(String(message)).type === 'feature_flags') route.send(JSON.stringify({type: 'feature_flags', data: {}}));} catch {}
    });
    route.send(JSON.stringify({type: 'status', data: {status: {exec_info: {queue_remaining: 0}}, sid: 'bfs-isolated-no-generation'}}));
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? String(error)));
  report.stage = 'navigate'; save();
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 20000});
  await page.waitForFunction(() => {
    const app = window.comfyAPI?.app?.app;
    return app?.positionConversion && app.committedGraphLoadSequence > 0 && !app.configuringGraphLevel;
  }, null, {timeout: 25000});
  report.stage = 'loadGraphData'; save();
  report.result = await page.evaluate(async graph => {
    const {app} = await import('/scripts/app.js');
    await app.loadGraphData(graph, true, false, null, {skipAssetScans: true});
    const loaded = app.graph.serialize();
    if (loaded.id !== graph.id) throw new Error('Workflow identity mismatch');
    const {output} = await app.graphToPrompt();
    const loader = app.graph.getNodeById(485);
    const widgets = loader.widgets.map(w => ({name: w.name, value: w.value}));
    app.canvas.ds.scale = 0.8;
    app.canvas.ds.offset = [-2380, -2110];
    app.canvas.draw(true, true);
    return {output, widgets, nodes: loaded.nodes.length, links: loaded.links.length, vaeType: loader.type};
  }, graph);
  const output = report.result.output;
  if (output['485']?.class_type !== 'VAELoaderKJ') throw new Error('Wrong exported VAE class');
  const wanted = {vae_name: 'texture_fix_vae_for_qwen_image_2.1_bf16.safetensors', device: 'cpu', weight_dtype: 'fp32'};
  if (JSON.stringify(output['485'].inputs) !== JSON.stringify(wanted)) throw new Error('Wrong exported VAE inputs');
  for (const id of ['487', '496']) {
    if (JSON.stringify(output[id].inputs.vae) !== '["485",0]') throw new Error(`Shared VAE lost at ${id}`);
  }
  const sampling = output['490'].inputs;
  if (sampling.steps !== 20 || sampling.cfg !== 1 || sampling.sampler_name !== 'euler' || sampling.scheduler !== 'simple') throw new Error('Sampler parameters drifted');
  const text = graph.nodes.find(n => n.id === 496).widgets_values[0];
  if (output['496'].inputs.prompt !== text || !text.startsWith('head_swap:')) throw new Error('Head swap prompt drifted');
  if (report.result.nodes !== 24 || report.result.links !== 29) throw new Error('Graph count drifted');
  for (const [id, node] of Object.entries(output)) if (!node.class_type) throw new Error(`Unregistered node ${id}`);
  writeFileSync(join(out, 'frontend-export.api.json'), JSON.stringify(output, null, 2) + '\n');
  await page.screenshot({path: join(out, 'isolated-canvas.png')});
  report.stage = 'done'; report.ok = true; save();
  console.log(JSON.stringify({ok: report.ok, vae: output['485'], widgets: report.result.widgets, nodes: report.result.nodes, links: report.result.links, generationSubmitted: false}));
} catch (error) {
  report.fatal = String(error); report.stack = error.stack; save();
  console.error(error); process.exitCode = 1;
} finally {await browser?.close(); save();}
