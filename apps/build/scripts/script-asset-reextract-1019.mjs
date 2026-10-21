/**
 * ch1/ch2 剧本资产重提驱动(1019,候令⑥「两章重提复核」)
 *
 * 口径:真装机 App + 真实 IPC + 真实 AI(textCompletion),与用户手点同路;
 * 验收=盘面新 entity-extractions 分片出现(不靠 UI toast);
 * 审计(说话人差分/郁澄心)由外层 python 复核,本件只负责驱动与留痕。
 *
 * 用法: node apps/build/scripts/script-asset-reextract-1019.mjs [chapter-002] [chapter-001] ...
 * 前置:装机 App 未在跑(脚本自spawn自收);AI 绑定(script_analysis)已配。
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const CDP_PORT = 9227;
const MA = `${process.env.HOME}/Project/IP/MA/store/studio-workflow/chapters`;
const OUT = `${process.env.HOME}/Project/Github/MYStudio/apps/output/reextract-1019`;
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[reextract]", ...a);
const fail = (m) => { console.error("[reextract] ❌ " + m); process.exitCode = 1; };

const targets = process.argv.slice(2);
if (!targets.length) { fail("用法: node …mjs chapter-002 chapter-001"); process.exit(2); }

const baseline = {};
for (const ch of targets) {
  const dir = `${MA}/${ch}`;
  if (!existsSync(dir)) { fail(`${ch} 目录不存在`); process.exit(2); }
  baseline[ch] = new Set(readdirSync(dir).filter((f) => f.startsWith("entity-extractions")));
}

async function waitCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error("CDP 60s 未就绪");
}

function attach(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let seq = 0; const pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    ws.on("open", () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq; pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      close: () => ws.close(),
    }));
    ws.on("error", reject);
  });
}

async function evalJs(cdp, expr, awaitPromise = true) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error("页面执行异常: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

const CLICK = `(el)=>{const r=el.getBoundingClientRect();const o={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
for(const t of ["pointerdown","mousedown","pointerup","mouseup","click"])el.dispatchEvent(new MouseEvent(t,o));return true;}`;

async function byText(cdp, selector, text, timeoutMs = 20000) {
  for (let i = 0; i < timeoutMs / 500; i += 1) {
    const found = await evalJs(cdp, `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find((e) => (e.textContent || "").includes(${JSON.stringify(text)}));
      if (!el) return null;
      el.scrollIntoView({ block: "center" }); (${CLICK})(el); return el.textContent.slice(0, 40);
    })()`);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`未找到 ${selector} 含「${text}」`);
}

async function main() {
  let reused = false;
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
    reused = Array.isArray(await r.json());
  } catch { /* not up */ }
  if (reused) log("复用已活实例(CDP " + CDP_PORT + ")");
  else {
    log("spawn App (CDP " + CDP_PORT + ")");
    const app = spawn(APP_BIN, [`--remote-debugging-port=${CDP_PORT}`], { detached: true, stdio: "ignore" });
    app.unref();
  }
  const page = await waitCdp();
  log("CDP target:", page.title || page.url.slice(0, 60));
  const cdp = await attach(page.webSocketDebuggerUrl);

  // 就绪门槛:body 出现侧栏文本(启动+库水合可达 2 分钟),再走导航
  for (let i = 0; i < 120; i += 1) {
    const ready = await evalJs(cdp, `document.body && document.body.innerText.includes("MY 工作流")`).catch(() => false);
    if (ready) break;
    await sleep(2000);
  }
  await byText(cdp, "a,button,[role='tab']", "MY 工作流", 30000).catch((e) => log("侧栏 MY 工作流 未点中(可能已在):", e.message));
  await sleep(2000);
  await byText(cdp, "[role='tab'],button,a", "剧本资产管理", 60000);
  await byText(cdp, "[data-testid='chapter-select-trigger']", "章节", 30000).catch(() => log("章选触发器未现(可能单章)"));
  log("已进剧本资产管理页");

  const results = {};
  for (const ch of targets) {
    log(`── ${ch}: 切章`);
    try {
      await byText(cdp, "[data-testid='chapter-select-trigger']", "章节", 8000);
      await byText(cdp, `[data-testid='chapter-option-${ch}']`, ch, 8000);
    } catch (e) { log(`${ch}: 章选未点中(${e.message})——按当前章继续`); }
    await sleep(2500);
    const cardText = await byText(cdp, "button", ch === "chapter-001" ? "提取资产" : "重新提取资产", 15000).catch(async (e) => {
      return await byText(cdp, "button", "提取资产", 8000).catch(() => { throw e; });
    });
    log(`${ch}: 已点提取钮(${cardText}),轮询新分片…`);
    let newFile = null;
    for (let i = 0; i < 120 && !newFile; i += 1) {
      await sleep(2500);
      const files = readdirSync(`${MA}/${ch}`).filter((f) => f.startsWith("entity-extractions") && !baseline[ch].has(f));
      if (files.length) newFile = files[0];
    }
    if (newFile) { results[ch] = newFile; log(`${ch}: ✅ 新分片 ${newFile}`); }
    else { results[ch] = null; fail(`${ch}: 300s 无新分片(模型调用失败或被防重)——看 App toast/诊断`); }
    await sleep(2000);
  }

  writeFileSync(`${OUT}/reextract-result.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  log("结果:", JSON.stringify(results));
  if (!reused) { try { await cdp.send("Browser.close"); } catch { /* ignore */ } }
  await sleep(1000);
  log(reused ? "复用实例保持开(收尾由外层处理)" : "App 已关");
}
main().catch((e) => { fail(e.message); process.exit(1); });
