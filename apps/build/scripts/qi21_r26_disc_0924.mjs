#!/usr/bin/env node
/**
 * R26.4 开态 LoRA 真加载·差分实证(0924;t2i-on 补证;派生自 qi21_r26_live_0924.mjs):
 * 引擎日志无显式 LoRA 加载行(0.37 INFO 级不打印),开态「LoRA 真生效」改用
 * 差分实证:同 seed=0 同 steps=4,唯一变量=[30] 开关源——
 *   A=开态(r26-t2i-on-seed0-4step.png,LoRA=true,已出)
 *   B=关态 steps=4(本脚本排队,LoRA=false)
 * 若 LoRA 真加载生效,A≠B(权重改变采样轨迹);若 LoRA 静默 no-op,A≡B 逐像素。
 * 对比=16 横带 RGB 均值/标准差 + 全图像素差统计(文件级,禁视觉读图),阈值:
 * 平均绝对差 ≥1.0(0-255)即判「A≠B→LoRA 生效」;<0.01 判逐像素同。
 * 用法:node apps/build/scripts/qi21_r26_disc_0924.mjs   (引擎 17002 在位)
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);

const ENGINE = "http://127.0.0.1:17002";
const CDP_PORT = 9381;
const WF_T2I = `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`;
const DISC_IMG = "/tmp/r26-disc-4step-off.png";   // B 图(差分实验件,非 ask 交付物)
const REPORT_DIR = `${process.env.HOME}/Project/Github/MYStudio/apps/out/q21-final-0924`;
const GEN_TIMEOUT = Number(process.env.GEN_TIMEOUT_MS || 1_200_000);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let chromeProc = null;
function killChrome() {
  if (!chromeProc) return;
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { /* gone */ }
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = { phase: "t2i-disc-4step-off", startedAt: new Date().toISOString() };

  chromeProc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    "--user-data-dir=/tmp/qi21-r26-disc-profile", "--window-size=1720,1050",
    "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
    ENGINE,
  ], { detached: true, stdio: "ignore" });
  chromeProc.unref();

  let page = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((x) => x.type === "page" && (x.url || "").startsWith(ENGINE));
      if (page) break;
    } catch { /* not ready */ }
    await sleep(1200);
  }
  if (!page) throw new Error("page target 未出现");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };

  // 就绪+载入
  for (let i = 0; i < 60; i++) {
    if (await ev(`window.app && window.app.isGraphReady === true ? 1 : null`)) break;
    await sleep(2000);
  }
  const wf = JSON.parse(readFileSync(WF_T2I, "utf8"));
  await ev(`window.app.loadGraphData(${JSON.stringify(wf)}, true, true, 'qi21-t2i-差分B-steps4关态')`);
  await sleep(2500);

  // 只切 steps→4,开关保持默认 false
  const f1 = await ev(`(() => {
    const n = window.app.graph._nodes.find(n => String(n.id) === '7');
    const w = n.widgets.find(w => w.name === 'steps');
    w.value = 4; try { w.callback && w.callback(w.value); } catch (e) {}
    return 'steps=' + w.value;
  })()`);
  check("B 运行态 steps=4(开关保持默认关)", String(f1).includes("steps=4"), String(f1));
  const dry = await ev(`(async () => { const p = await window.app.graphToPrompt(); return JSON.stringify(p.output); })()`);
  const dryStr = String(dry);
  check("B 干跑:value=false + steps=4(唯一变量=开关)", dryStr.includes('"value":false') && dryStr.includes('"steps":4'), "");
  report.dryBlobHead = dryStr.slice(0, 800);

  // 排队+等待
  const known = new Set(Object.keys(await (await fetch(`${ENGINE}/history`)).json()));
  await ev(`window.app.queuePrompt()`);
  check("B queuePrompt 发出", true);
  let hist = null;
  const tq = Date.now();
  while (Date.now() - tq < GEN_TIMEOUT) {
    const h = await (await fetch(`${ENGINE}/history`)).json();
    for (const [pid, e] of Object.entries(h)) {
      if (known.has(pid)) continue;
      const blob = JSON.stringify(e.prompt?.[2] || {});
      if (!blob.includes('"value":false') || !blob.includes('"steps":4') || !blob.includes('"base":"人物"')) continue;
      if (e.status?.status_str === "error") throw new Error("引擎执行 error: " + JSON.stringify(e.status?.messages || []).slice(0, 2000));
      const imgs = [];
      for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
      if (imgs.length) { hist = { pid, imgs, blob }; break; }
    }
    if (hist) break;
    await sleep(3000);
  }
  if (!hist) { check("B 出图(history)", false, "超时"); throw new Error("B 超时"); }
  const img = hist.imgs.find((i) => /\.png$/i.test(i.filename));
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const buf = Buffer.from(await (await fetch(`${ENGINE}/view?${q}`)).arrayBuffer());
  const { writeFileSync: wfSync } = await import("node:fs");
  wfSync(DISC_IMG, buf);
  check("B 出图落盘", buf.length > 50_000 && buf[0] === 0x89 && buf[1] === 0x50, `${DISC_IMG}(${(buf.length / 1024).toFixed(0)}KB) pid=${String(hist.pid).slice(0, 8)}`);
  report.discImg = DISC_IMG;
  report.results = results;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(REPORT_DIR, "r26-report-t2i-disc.json"), JSON.stringify(report, null, 2));
  ws.close();
  killChrome();
  log("disc done");
  process.exit(0);
}

main().catch((e) => { console.error("disc 失败:", e.message); killChrome(); process.exit(1); });
