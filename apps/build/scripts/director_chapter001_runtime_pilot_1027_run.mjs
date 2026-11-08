/** Exactly one invocation of the existing runtime tool, with read-only queue evidence. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const folder = path.join(root, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026/runtime-pilot-generation-v1');
const storage = fs.realpathSync(path.join(os.homedir(), 'Library/Application Support', '漫影工作室'));
const manifest = JSON.parse(fs.readFileSync(path.join(storage, 'comfyui/manifest.json'), 'utf8'));
const engineUrl = `http://127.0.0.1:${manifest.engine.port}`;
const get = async (suffix) => { const r = await fetch(engineUrl + suffix, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error(`GET ${suffix}: ${r.status}`); return r.json(); };
const listeners = () => {
  const result = {};
  for (const port of [17595, manifest.engine.port]) {
    try { result[port] = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8', timeout: 5000 }); }
    catch (error) { result[port] = { error: error.message }; }
  }
  return result;
};
const queue = await get('/queue');
if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Engine queue is busy; no generation submitted');
const before = await get('/history?max_items=10');
const beforeIds = new Set(Object.keys(before));
fs.writeFileSync(path.join(folder, 'launch.json'), JSON.stringify({ at: new Date().toISOString(), queue, listeners: listeners(), historyIdsBefore: [...beforeIds], enginePort: manifest.engine.port, frontendChain: false, maximumPostCalls: 1, runtimeBudgetMs: 35 * 60_000 }, null, 2), { flag: 'wx' });
const log = fs.openSync(path.join(folder, 'generation.log'), 'wx');
const child = spawn('npm', ['test', '--', 'build/scripts/director_chapter001_runtime_1026.test.ts'], {
  cwd: path.join(root, 'apps'), stdio: ['ignore', log, log],
  env: { ...process.env, DIRECTOR_CHAPTER001_RUNTIME_MODE: 'generate', DIRECTOR_CHAPTER001_RUNTIME_OUTPUT: path.join(folder, 'response.json'), DIRECTOR_CHAPTER001_IMAGE_REQUEST: path.join(folder, 'request.json') },
});
let finished = false;
const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { finished = true; resolve({ code, signal }); }); });
const observations = [];
while (!finished) {
  let timer;
  await Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, 15000); })]);
  clearTimeout(timer);
  if (finished) break;
  try {
    const current = await get('/queue');
    const record = { at: new Date().toISOString(), running: current.queue_running.map((item) => item[1]), pending: current.queue_pending.map((item) => item[1]) };
    observations.push(record);
    fs.appendFileSync(path.join(folder, 'queue-observations.jsonl'), JSON.stringify(record) + '\n');
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch (error) { process.stderr.write('Read-only queue probe: ' + error.message + '\n'); }
}
const outcome = await done;
fs.closeSync(log);
const after = await get('/history?max_items=10');
const newHistory = Object.fromEntries(Object.entries(after).filter(([id]) => !beforeIds.has(id)));
fs.writeFileSync(path.join(folder, 'engine-history.json'), JSON.stringify(newHistory, null, 2), { flag: 'wx' });
fs.writeFileSync(path.join(folder, 'exit.json'), JSON.stringify({ ...outcome, at: new Date().toISOString(), listenersAfter: listeners(), queueAfter: await get('/queue'), observedPromptIds: [...new Set(observations.flatMap((item) => [...item.running, ...item.pending]))], historyPromptIds: Object.keys(newHistory) }, null, 2), { flag: 'wx' });
process.stdout.write('runtime pilot exited ' + JSON.stringify(outcome) + '\n');
process.exitCode = outcome.code ?? 1;
