#!/usr/bin/env node
// 引擎前端加载时的失败请求清单(只读;隔离无头浏览器)。
// 目的:①核实 my-nodes 测试件改名后引擎前端不再报 preloadError;②把此前只记到状态码的 404/403/400 定位到具体地址。
// 用法:node apps/build/scripts/engine_frontend_failed_requests_probe.mjs [--origin http://192.168.0.101:17000] [--settle-ms 20000]
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const origin = arg('--origin', 'http://192.168.0.101:17000');
const settleMs = Number(arg('--settle-ms', '20000'));

let playwright;
try { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
catch { console.error('playwright 运行时缺失'); process.exit(2); }
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shellDir = existsSync(cache) ? readdirSync(cache).filter(n => n.startsWith('chromium_headless_shell-')).sort().at(-1) : null;
const executable = shellDir ? join(cache, shellDir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell') : undefined;
if (!executable || !existsSync(executable)) { console.error('缺 chromium headless shell'); process.exit(2); }

// 隔离:发车/写类接口硬拦;其余非 GET 与跨源请求伪造 200 空响应(请求不出浏览器);websocket 伪造队列恒 0。
const HARD_BLOCK = u => u.pathname === '/prompt' || u.pathname.startsWith('/upload') || u.pathname.startsWith('/view_api') || u.pathname.startsWith('/interrupt');
const browser = await playwright.chromium.launch({ headless: true, executablePath: executable });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const synthetic = [];
await context.route('**/*', async route => {
  const request = route.request(); const u = new URL(request.url());
  const kind = HARD_BLOCK(u) ? 'hard' : u.origin !== origin ? 'cross-origin' : request.method() !== 'GET' ? 'non-GET' : null;
  if (!kind) return route.continue();
  synthetic.push(`${kind} ${request.method()} ${u.pathname}`);
  if (kind === 'hard') return route.abort();
  return route.fulfill({ status: 200, contentType: 'application/json', body: kind === 'cross-origin' ? '[]' : '{}' });
});
await context.routeWebSocket('**/*', route => route.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'probe' } })));
const page = await context.newPage();
const failed = [], errors = [];
page.on('response', res => { if (res.status() >= 400) failed.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
page.on('requestfailed', req => { const u = new URL(req.url()); if (u.origin === origin) failed.push(`FAILED ${req.method()} ${req.url()} (${req.failure()?.errorText ?? ''})`); });
page.on('pageerror', e => errors.push(String(e).slice(0, 240)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 240)); });
await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => { const app = window.comfyAPI?.app?.app; return Boolean(app?.graph?.nodes?.length && typeof app.loadGraphData === 'function' && !app.configuringGraphLevel && Object.keys(window.LiteGraph?.registered_node_types ?? {}).length > 200); }, null, { timeout: 90000 });
await page.waitForTimeout(settleMs);
await browser.close();
const uniq = a => [...new Set(a)];
console.log(`引擎 ${origin} | 伪造/拦截请求 ${synthetic.length} 条(其中同源非 GET ${synthetic.filter(s => s.startsWith('non-GET')).length} 条,属探针隔离所致,非引擎问题)`);
console.log(`\n真实失败的同源请求 ${uniq(failed).length} 条:`);
for (const f of uniq(failed)) console.log('   ', f.replace(origin, ''));
console.log(`\n控制台 error / 页面错误 ${uniq(errors).length} 条:`);
for (const e of uniq(errors)) console.log('   ', e);
console.log(`\n其中提到 my-nodes 测试件的: ${uniq(errors).filter(e => e.includes('.test.')).length} 条`);
