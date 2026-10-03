#!/usr/bin/env node
/** 一次性探测:loadGraphData 后的运行时节 id 重映射 + widget 名/值实况(i2i+edit)。 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const ENGINE = "http://127.0.0.1:17001";
const CDP_PORT = 9373;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WFS = [
  ["i2i", `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`],
  ["edit", `${process.env.HOME}/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json`],
];

const chromeProc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/fire0929-probe-profile",
  "--window-size=1400,900", "--no-first-run", "--no-default-browser-check", ENGINE,
], { detached: true, stdio: "ignore" });
chromeProc.unref();

async function main() {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(1200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && (t.url || "").startsWith(ENGINE));
    } catch {}
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res } = pending.get(m.id); pending.delete(m.id); res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, { res }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send("Runtime.enable");

  for (let i = 0; i < 60; i++) { if (await ev("!!(window.app && window.app.isGraphReady)") ) break; await sleep(1500); }
  await sleep(1500);

  for (const [key, wf] of WFS) {
    const g = JSON.parse(readFileSync(wf, "utf8"));
    const sgType = g.definitions?.subgraphs?.[0]?.id || "";
    await ev(`window.app.loadGraphData(${JSON.stringify(g)}, true, true, 'probe-${key}')`);
    await sleep(2500);
    const dump = await ev(`(() => {
      const app = window.app;
      const interesting = ['LoadImage','MyQi21SpeedSelect','ComfySwitchNode','PrimitiveBoolean','KSampler','LoraLoaderModelOnly','T8QwenImage21FunAccPDD4Step'];
      const out = [];
      for (const n of app.graph._nodes) {
        if (interesting.includes(n.type) || n.type === ${JSON.stringify(sgType)}) {
          out.push({ id: n.id, type: n.type, title: String(n.title||''), widgets: (n.widgets||[]).map(w => ({ name: String(w.name), type: String(w.type), value: typeof w.value === 'string' ? w.value.slice(0,40) : w.value })) });
        }
      }
      return JSON.stringify(out, null, 1);
    })()`);
    console.log(`════ ${key}(sgType=${sgType.slice(0,8)}…) ════`);
    console.log(dump);
  }
  ws.close();
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {}
}
main().catch((e) => { console.error(e); try { process.kill(-chromeProc.pid, "SIGTERM"); } catch {} process.exit(1); });
