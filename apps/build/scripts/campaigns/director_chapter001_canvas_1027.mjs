/** Explicit task-only exercise of the production Canvas reference compositor. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = path.join(repo, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  const [, , , payloadFile, bundleFile, destination] = process.argv;
  app.setPath('userData', path.join(path.dirname(destination), 'isolated-canvas-profile'));
  let window;
  process.stderr.write('canvas_child_entry\n');
  // Completing the ESM entry is required before Electron emits ready.
  void app.whenReady().then(async () => {
    let failed = false;
    try {
    process.stderr.write('canvas_app_ready\n');
    window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
    window.webContents.on('console-message', (_event, _level, message) => process.stderr.write('renderer: ' + message + '\n'));
    await window.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><title>Chapter001 Canvas Verification</title>');
    process.stderr.write('canvas_window_loaded\n');
    await window.webContents.executeJavaScript(fs.readFileSync(bundleFile, 'utf8'));
    process.stderr.write('canvas_bundle_loaded\n');
    const result = await window.webContents.executeJavaScript(`ChapterReferenceCanvas.buildStoryboardReferenceSheet(${fs.readFileSync(payloadFile, 'utf8')})`);
    const bytes = Buffer.from(result.imageUrl.split(',')[1], 'base64');
    fs.writeFileSync(destination + '.png', bytes, { flag: 'wx' });
    fs.writeFileSync(destination + '.json', JSON.stringify({ ...result, imageUrl: undefined, imageFile: destination + '.png', sha256: sha(bytes), realCanvas: true, projectWrites: 0 }, null, 2), { flag: 'wx' });
    process.stdout.write('real_canvas_compositor_passed\n');
    } catch (error) { process.stderr.write(String(error) + '\n'); failed = true; }
    finally { window?.destroy(); app.exit(failed ? 1 : 0); }
  });
} else {
  if (process.argv.length !== 4 || process.argv[2] !== '--run') throw new Error('Usage: node director_chapter001_canvas_1027.mjs --run <new-evidence-directory>');
  const folder = path.resolve(process.argv[3]);
  if (!folder.startsWith(evidence + path.sep) || fs.existsSync(folder)) throw new Error('New chapter001 evidence directory required');
  const index = JSON.parse(fs.readFileSync(path.join(evidence, 'reference-contact-1027-v2/index.json'), 'utf8'));
  const references = [index[0], index[7]];
  const urls = references.map((ref) => { const bytes = fs.readFileSync(ref.path); if (sha(bytes) !== ref.sha256) throw new Error('Reference hash changed'); return 'data:image/png;base64,' + bytes.toString('base64'); });
  const nodes = references.map((ref, i) => ({ id: 'ref-' + i, type: 'reference', title: ref.name, imageUrl: urls[i], source: { kind: 'asset', assetType: ref.kind, id: ref.versionId }, position: { x: 0, y: i * 100 } }));
  const graph = { id: 'chapter001-canvas-proof', name: 'Canvas proof', target: { kind: 'storyboard', id: 'chapter001-runtime-proof' }, nodes, edges: nodes.map((node) => ({ id: 'edge-' + node.id, source: node.id, target: 'result' })), createdAt: 0, updatedAt: 0 };
  nodes.push({ id: 'result', type: 'generated', title: '成图', position: { x: 500, y: 0 }, status: 'idle' });
  const { build } = await import('vite');
  const result = await build({ configFile: false, root: path.join(repo, 'apps'), logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { alias: { '@': path.join(repo, 'apps/frontend'), '@rendering': path.join(repo, 'apps/frontend/electron/rendering') } }, build: { write: false, minify: false, lib: { entry: path.join(repo, 'apps/frontend/components/panels/studio/image-workflow/storyboard-reference-sheet.ts'), name: 'ChapterReferenceCanvas', formats: ['iife'] } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((buildOutput) => buildOutput.output).filter((item) => item.type === 'chunk');
  if (chunks.length !== 1) throw new Error('Single compositor bundle required');
  fs.mkdirSync(folder);
  const payload = path.join(folder, 'payload.json'); const bundle = path.join(folder, 'compositor.js');
  fs.writeFileSync(payload, JSON.stringify({ graph, targetNodeId: 'result', referenceImages: urls, preparedReferenceImages: urls }));
  fs.writeFileSync(bundle, chunks[0].code);
  fs.writeFileSync(path.join(folder, 'inputs.json'), JSON.stringify({ references, compositorSha256: sha(fs.readFileSync(path.join(repo, 'apps/frontend/components/panels/studio/image-workflow/storyboard-reference-sheet.ts'))) }, null, 2));
  const electron = (await import('electron')).default;
  const child = spawn(electron, [fileURLToPath(import.meta.url), '--child', payload, bundle, path.join(folder, 'sheet')], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; process.stdout.write(data); });
  child.stderr.on('data', (data) => { stderr += data; process.stderr.write(data); });
  const outcome = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
  fs.writeFileSync(path.join(folder, 'subprocess.json'), JSON.stringify({ ...outcome, stdout, stderr }, null, 2), { flag: 'wx' });
  if (outcome.code !== 0) throw new Error('Canvas subprocess failed: ' + JSON.stringify(outcome));
  if (!fs.existsSync(path.join(folder, 'sheet.png'))) throw new Error('Canvas subprocess returned without a PNG');
}
