#!/usr/bin/env node
// 探针2:t2i [6:4014] 头句/W1 值映射确定性(反复装载/次序互换)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const WebSocket = require(`${process.env.HOME}/Project/Github/MYStudio/apps/node_modules/.pnpm/node_modules/ws`);
const ENGINE = "http://127.0.0.1:17599";
const CDP_PORT = 9394;
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const WF = {
  t2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`,
  i2i: `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`,
};
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const chromeProc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=/tmp/qi21-widgetmap-probe-${Date.now()}`, "--window-size=1400,900", "--no-first-run",
  "--no-default-browser-check", ENGINE], { detached: true, stdio: "ignore" });
chromeProc.unref();

async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
      if (page) break;
    } catch {}
    await sleep(1000);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((r) => ws.once("open", r));
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res } = pending.get(m.id); pending.delete(m.id); res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, { res }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };
  for (let i = 0; i < 60 && !(await ev("window.app && window.app.isGraphReady === true ? 1 : 0")); i++) await sleep(1000);
  await sleep(1500);

  const dump = async (wfKey, tag) => {
    const wfJson = JSON.parse(readFileSync(WF[wfKey], "utf8"));
    await ev(`window.app.loadGraphData(${JSON.stringify(wfJson)}, true, true, 'probe2-${tag}')`);
    await sleep(2000);
    const out = await ev(`(async () => {
      const p = await window.app.graphToPrompt();
      const n = p.output['6:4014'];
      // 画布侧:进子图定义找 4014 的 widgets
      const sg = (window.app.graph.serialized_widgets_debug, null);
      return JSON.stringify(n.inputs);
    })()`);
    const inputs = JSON.parse(out);
    const short = { 头句: inputs.RGBA官方头句?.slice(0, 40), 尾句: inputs.RGBA官方尾句?.slice(0, 40), W1: inputs.W1收束句?.slice(0, 40), pe开关: inputs.pe开关, 透明模式: inputs.透明模式 };
    log(`${tag} ${wfKey} 6:4014 →`, JSON.stringify(short, null, 0));
    return short;
  };
  const results = {};
  results.t2i_1 = await dump("t2i", "t2i-1st");
  results.i2i_1 = await dump("i2i", "i2i-2nd");
  results.t2i_2 = await dump("t2i", "t2i-3rd");
  writeFileSync(`${REPO}/apps/output/biground-1002/fire/probe2-widgetmap.json`, JSON.stringify(results, null, 2));
  ws.close();
}
main().then(() => { try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {} process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
