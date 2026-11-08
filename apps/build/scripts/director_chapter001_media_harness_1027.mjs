/** Isolated offline Electron boot harness. Generation is deliberately fail-closed. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const entry = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(entry), '../../..');
const research = path.join(repo, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const usage = 'Usage: node apps/build/scripts/director_chapter001_media_harness_1027.mjs <--boot|--offline-dom> --out <new research/chapter001-media-harness-... directory> [--bridge-result <actual bridge result JSON> --bridge-sha256 <SHA256>]';
const blocked = 'GENERATION_BLOCKED: no root-reviewed reference binding plan or ownership-safe production runtime assembly is supplied; actual frame finalization is private to useStoryboardBatchGeneration, whose start includes retries/queue cleanup. No generation, credential read, IPC provider request or media save was attempted.';
const writeNew = (name, value) => fs.writeFileSync(name, value, { flag: 'wx' });

if (!process.versions.electron && process.argv[2] === '--dom-child') {
  const folder = fs.realpathSync(process.argv[3]);
  if (process.argv.length !== 4 || path.dirname(folder) !== fs.realpathSync(research) || !path.basename(folder).startsWith('chapter001-media-harness-')) throw new Error('DOM child evidence scope mismatch');
  const { JSDOM } = await import('jsdom');
  // jsdom's own in-memory Storage, not a replacement for any production store.
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://chapter001-harness.invalid/', runScripts: 'outside-only' });
  // Actual Node Web Platform implementations for APIs jsdom does not provide.
  Object.assign(dom.window, { TransformStream, ReadableStream, WritableStream, TextEncoder, TextDecoder, Request, Response, Headers });
  const before = { localStorageEmpty: dom.window.localStorage.length === 0, noNode: typeof dom.window.require === 'undefined', noPersistenceBridge: !dom.window.fileStorage && !dom.window.projectFiles, noFetch: typeof dom.window.fetch === 'undefined' };
  const networkAttempts = [];
  // Deny the remaining jsdom egress mechanisms; no provider function is replaced.
  dom.window.XMLHttpRequest = class { constructor() { networkAttempts.push('XMLHttpRequest'); throw new Error('Offline egress denied'); } };
  dom.window.WebSocket = class { constructor() { networkAttempts.push('WebSocket'); throw new Error('Offline egress denied'); } };
  try {
    if (!Object.values(before).every(Boolean)) throw new Error('DOM pre-import memory isolation failed');
    dom.window.eval(fs.readFileSync(path.join(folder, 'renderer.js'), 'utf8'));
    const renderer = await dom.window.Chapter001MediaHarness.bootVerification();
    const bridgePath = path.join(folder, 'bridge-result.json');
    const bridge = fs.existsSync(bridgePath) ? await dom.window.Chapter001MediaHarness.loadBridgeResult(JSON.parse(fs.readFileSync(bridgePath, 'utf8'))) : undefined;
    if (networkAttempts.length) throw new Error('Production import attempted network');
    writeNew(path.join(folder, 'boot.json'), JSON.stringify({ ok: true, mode: 'offline-dom', electronBootVerified: false, beforeProductionImport: before, renderer, bridge, networkAttempts }, null, 2) + '\n');
    process.stdout.write('chapter001_media_harness_offline_dom_passed\n');
  } catch (error) {
    writeNew(path.join(folder, 'boot.json'), JSON.stringify({ ok: false, mode: 'offline-dom', electronBootVerified: false, beforeProductionImport: before, error: String(error), networkAttempts }, null, 2) + '\n');
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  } finally { dom.window.close(); }
} else if (process.versions.electron) {
  const { app, BrowserWindow, protocol, session } = await import('electron');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--child') throw new Error('Owned child invocation required');
  const folder = fs.realpathSync(args[1]);
  if (path.dirname(folder) !== fs.realpathSync(research) || !path.basename(folder).startsWith('chapter001-media-harness-')) throw new Error('Child evidence scope mismatch');
  // No normal main import, default profile, project registry or application startup.
  app.setPath('userData', path.join(folder, 'profile'));
  app.setPath('sessionData', path.join(folder, 'session-data'));
  app.setPath('cache', path.join(folder, 'cache'));
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  protocol.registerSchemesAsPrivileged([{ scheme: 'chapter001-harness', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  let window;
  // Do not await ready at top level: Electron emits ready after the entry evaluates.
  void app.whenReady().then(async () => {
    const evidence = { mode: 'offline-boot', blockedNetworkRequests: [], sourceRead: 'bundled-current-source', realProjectWrites: 0, mediaSaved: 0 };
    try {
      const memory = session.fromPartition(`chapter001-media-harness-${crypto.randomUUID()}`, { cache: false });
      if (memory.isPersistent()) throw new Error('Persistent renderer session forbidden');
      // This guard is installed before window creation and before any production import.
      const blockExternal = target => target.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (details, callback) => {
        evidence.blockedNetworkRequests.push({ method: details.method, scheme: new URL(details.url).protocol });
        callback({ cancel: true });
      });
      blockExternal(memory);
      blockExternal(session.defaultSession);
      memory.protocol.handle('chapter001-harness', request => {
        if (request.url !== 'chapter001-harness://boot/') throw new Error('Unexpected task origin path');
        return new Response('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'"><title>Offline chapter001 boot</title><body></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
      window = new BrowserWindow({ show: false, webPreferences: { session: memory, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await window.loadURL('chapter001-harness://boot/');
      const before = await window.webContents.executeJavaScript('({ origin: location.origin, nativeLocalStorageEmpty: localStorage.length === 0, noFileStorageBridge: !window.fileStorage, noProjectBridge: !window.projectFiles, noAssetBridge: !window.studioAssets, noNode: typeof require === "undefined" })');
      if (!before.nativeLocalStorageEmpty || !before.noFileStorageBridge || !before.noProjectBridge || !before.noAssetBridge || !before.noNode) throw new Error('Pre-import isolation check failed');
      evidence.beforeProductionImport = { ...before, sessionPersistent: memory.isPersistent() };
      // Only now evaluate the current-source production module bundle.
      await window.webContents.executeJavaScript(fs.readFileSync(path.join(folder, 'renderer.js'), 'utf8'));
      evidence.renderer = await window.webContents.executeJavaScript('Chapter001MediaHarness.bootVerification()');
      if (fs.existsSync(path.join(folder, 'bridge-result.json'))) {
        const raw = fs.readFileSync(path.join(folder, 'bridge-result.json'), 'utf8');
        evidence.bridge = await window.webContents.executeJavaScript(`Chapter001MediaHarness.loadBridgeResult(${raw})`);
      }
      if (evidence.blockedNetworkRequests.length) throw new Error('Production boot attempted external I/O; inspect canceled request evidence');
      evidence.ok = true;
      writeNew(path.join(folder, 'boot.json'), JSON.stringify(evidence, null, 2) + '\n');
      process.stdout.write('chapter001_media_harness_offline_boot_passed\n');
      window.destroy();
      app.exit(0);
    } catch (error) {
      evidence.ok = false;
      evidence.error = String(error);
      writeNew(path.join(folder, 'boot.json'), JSON.stringify(evidence, null, 2) + '\n');
      process.stderr.write(String(error) + '\n');
      window?.destroy();
      app.exit(1);
    }
  });
} else {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { process.stdout.write(usage + '\nGeneration remains blocked; default invocation performs no boot or project access.\n'); }
  else if (args.includes('--generate')) { process.stderr.write(blocked + '\n'); process.exitCode = 2; }
  else {
    const flags = new Map();
    const mode = args.shift();
    if (!['--boot', '--offline-dom'].includes(mode)) throw new Error(usage);
    while (args.length) {
      const key = args.shift(); const value = args.shift();
      if (!['--out', '--bridge-result', '--bridge-sha256'].includes(key) || !value || flags.has(key)) throw new Error(usage);
      flags.set(key, value);
    }
    if (!flags.has('--out') || flags.has('--bridge-result') !== flags.has('--bridge-sha256')) throw new Error(usage);
    const folder = path.resolve(flags.get('--out'));
    if (path.dirname(folder) !== fs.realpathSync(research) || !path.basename(folder).startsWith('chapter001-media-harness-') || fs.existsSync(folder)) throw new Error('New direct research/chapter001-media-harness-* output directory required');
    let bridgeBytes;
    if (flags.has('--bridge-result')) {
      const input = fs.realpathSync(flags.get('--bridge-result'));
      if (!input.startsWith(fs.realpathSync(research) + path.sep)) throw new Error('Bridge input must be inside active task research');
      bridgeBytes = fs.readFileSync(input);
      if (digest(bridgeBytes) !== flags.get('--bridge-sha256')) throw new Error('Bridge input hash mismatch');
      JSON.parse(bridgeBytes.toString('utf8'));
    }
    const { build } = await import('vite');
    const sourceFiles = new Set();
    const built = await build({
      configFile: false, root: path.join(repo, 'apps'), logLevel: 'error',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { alias: { '@': path.join(repo, 'apps/frontend'), '@rendering': path.join(repo, 'apps/frontend/electron/rendering') } },
      plugins: [{ name: 'chapter001-current-source-evidence', transform(_code, id) { const file = id.split('?')[0]; if (file.startsWith(path.join(repo, 'apps/frontend') + path.sep) && fs.existsSync(file)) sourceFiles.add(file); } }],
      build: { write: false, minify: false, lib: { entry: entry.replace('.mjs', '.renderer.ts'), name: 'Chapter001MediaHarness', formats: ['iife'] } },
    });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(item => item.type === 'chunk');
    if (chunks.length !== 1) throw new Error('Exactly one self-contained renderer bundle required');
    const inventory = [...sourceFiles].sort().map(file => ({ path: path.relative(repo, file), sha256: digest(fs.readFileSync(file)) }));
    if (inventory.some(item => item.path === 'apps/frontend/electron/main/main.ts')) throw new Error('Normal main must never be imported');
    fs.mkdirSync(folder);
    writeNew(path.join(folder, 'renderer.js'), chunks[0].code);
    writeNew(path.join(folder, 'source-evidence.json'), JSON.stringify({ sources: inventory, rendererSha256: digest(chunks[0].code), launcherSha256: digest(fs.readFileSync(entry)), rendererEntrySha256: digest(fs.readFileSync(entry.replace('.mjs', '.renderer.ts'))), bridgeResultSha256: bridgeBytes ? digest(bridgeBytes) : null, productionSourceOverrides: 0, normalMainImported: false }, null, 2) + '\n');
    if (bridgeBytes) writeNew(path.join(folder, 'bridge-result.json'), bridgeBytes);
    const executable = mode === '--boot' ? (await import('electron')).default : process.execPath;
    const childEnv = { ...process.env };
    // Electron must be a fresh owned application, never a debugger connection.
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [entry, mode === '--boot' ? '--child' : '--dom-child', folder], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000 });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; process.stdout.write(data); });
    child.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
    const outcome = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, pid: child.pid })); });
    writeNew(path.join(folder, 'subprocess.json'), JSON.stringify({ ...outcome, stdout, stderr }, null, 2) + '\n');
    if (outcome.code !== 0 || JSON.parse(fs.readFileSync(path.join(folder, 'boot.json'), 'utf8')).ok !== true) throw new Error('Offline boot child failed; inspect boot.json and subprocess.json');
    for (const item of inventory) if (digest(fs.readFileSync(path.join(repo, item.path))) !== item.sha256) throw new Error('Production source changed during boot; receipt is stale');
  }
}
