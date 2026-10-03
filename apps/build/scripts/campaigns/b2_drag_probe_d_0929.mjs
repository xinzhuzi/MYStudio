#!/usr/bin/env node
/** B2 探针D:驱动同款三节点连接图 + 全套仪表,复现/定位 ⑤a 帘拖动不动。 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = "http://127.0.0.1:17001";
const CDP_PORT = 9376;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = mkdtempSync(join(tmpdir(), "b2-drag-probe-d-"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const IMG_GRAPH = {
  id: "b2-probe-d-img",
  nodes: [
    { id: 1, type: "LoadImage", pos: [60, 200], size: [270, 314], flags: {}, order: 0, mode: 0,
      inputs: [{ name: "upload", type: "IMAGE", link: null }],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }, { name: "MASK", type: "MASK", links: null }],
      properties: { "Node name for S&R": "LoadImage" }, widgets_values: ["fire0929b2_imgA_red.png", "image"] },
    { id: 2, type: "LoadImage", pos: [60, 600], size: [270, 314], flags: {}, order: 1, mode: 0,
      inputs: [{ name: "upload", type: "IMAGE", link: null }],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [2] }, { name: "MASK", type: "MASK", links: null }],
      properties: { "Node name for S&R": "LoadImage" }, widgets_values: ["fire0929b2_imgB_blue.png", "image"] },
    { id: 3, type: "MyImageABCompare", pos: [430, 300], size: [340, 300], flags: {}, order: 2, mode: 0,
      inputs: [
        { name: "image_a", type: "IMAGE", link: 1 },
        { name: "image_b", type: "IMAGE", link: 2 },
        { name: "label_a", type: "STRING", link: null, widget: { name: "label_a" } },
        { name: "label_b", type: "STRING", link: null, widget: { name: "label_b" } },
      ],
      outputs: [
        { name: "image_a", type: "IMAGE", links: null },
        { name: "image_b", type: "IMAGE", links: null },
      ],
      properties: { "Node name for S&R": "MyImageABCompare" }, widgets_values: ["旧版", "新版"] },
  ],
  links: [[1, 1, 0, 3, 0, "IMAGE"], [2, 2, 0, 3, 1, "IMAGE"]],
  groups: [], config: {}, extra: {}, version: 0.4,
};

const chromeProc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
  "--window-size=1720,1050", "--no-first-run", "--no-default-browser-check", ENGINE,
], { detached: true, stdio: "ignore" });
chromeProc.unref();

let page = null;
const t0 = Date.now();
while (Date.now() - t0 < 60_000) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    page = list.find((x) => x.type === "page" && (x.url || "").startsWith(ENGINE));
    if (page) break;
  } catch { }
  await sleep(1000);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 128 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
await send("Runtime.enable");
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? "EXC:" + JSON.stringify(r.exceptionDetails).slice(0, 500) : r.result.value;
};
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });

try {
  while ((await ev(`window.app && window.app.isGraphReady === true ? 1 : 0`)) !== 1) await sleep(1000);
  await sleep(2000);
  await ev(`window.app.loadGraphData(${JSON.stringify(IMG_GRAPH)}, true, true, "b2-probe-d")`);
  await sleep(2000);
  for (let i = 0; i < 25; i++) { if (await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare')?.__myAbHits?.divider ? 1:0`) === 1) break; await sleep(700); }
  await ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const w = (n.widgets || []).find(w => w.name === 'my_ab_image_stage');
    window.__p = { mouseCalls: 0, downs: 0, lastArgs: null, pos0: [...n.pos], hasMouse: typeof w.mouse, widgetY: w.y, widgetH: w.computedHeight ?? (w.computeSize && w.computeSize(n.size[0])[1]) };
    const om = w.mouse;
    w.mouse = function (e, pos, node) {
      window.__p.mouseCalls++;
      if (String(e.type).includes('down')) window.__p.downs++;
      window.__p.lastArgs = { type: e.type, buttons: e.buttons, pos: pos ? [pos[0], pos[1]] : null };
      const r = om.apply(this, arguments);
      window.__p.lastRet = r;
      return r;
    };
    return JSON.stringify(window.__p);
  })()`);
  const geom = await ev(`(() => {
    const cnv = window.app.canvas; const n = cnv.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const h = n.__myAbHits; const d = h.divider; const st = h.stage;
    const s = cnv.ds.scale, off = cnv.ds.offset;
    const r = cnv.canvas.getBoundingClientRect();
    const toPage = (gx, gy) => [r.left + (gx + off[0]) * s, r.top + (gy + off[1]) * s];
    const [hx, hy] = toPage(n.pos[0] + d.x + d.w / 2, n.pos[1] + d.y + d.h / 2);
    const [tx, ty] = toPage(n.pos[0] + st.x + st.w * 0.28, n.pos[1] + st.y + st.h / 2);
    return JSON.stringify({ hx, hy, tx, ty, scale: s, off, nodePos: n.pos, div: d, st, w: (n.widgets||[]).map(x=>({n:x.name,y:x.y,h:x.computedHeight??(x.computeSize&&x.computeSize(n.size[0])[1])})) });
  })()`);
  log("geom:", geom);
  await mouse("mouseMoved", ...JSON.parse(geom).hx !== undefined ? [JSON.parse(geom).hx, JSON.parse(geom).hy] : [0, 0], {});
  await sleep(300);
  log("graph_mouse@handle:", await ev(`JSON.stringify(window.app.canvas.graph_mouse)`));
  const c0 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  const g = JSON.parse(geom);
  await mouse("mousePressed", g.hx, g.hy, { button: "left", clickCount: 1, buttons: 1 });
  await sleep(200);
  log("after press:", await ev(`JSON.stringify({p:window.__p, nodePos: window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').pos})`));
  for (const t of [0.34, 0.67, 1]) {
    await mouse("mouseMoved", g.hx + (g.tx - g.hx) * t, g.hy + (g.ty - g.hy) * t, { button: "left", clickCount: 1, buttons: 1 });
    await sleep(150);
  }
  await mouse("mouseReleased", g.tx, g.ty, { button: "left", clickCount: 1, buttons: 0 });
  await sleep(400);
  const c1 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  log(`curtain ${c0} -> ${c1}`);
  log("end:", await ev(`JSON.stringify({p:window.__p, nodePosEnd: window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').pos})`));
} finally {
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { }
  ws.close();
}
