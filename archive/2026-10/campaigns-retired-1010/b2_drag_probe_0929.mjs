#!/usr/bin/env node
/** B2 帘拖动探针:单 MyImageABCompare 节点,仪表化 onMouseDown/Move,真实 CDP 鼠标,
 *  暴露 litegraph 侧事件落点(graph_mouse/命中/handler 是否被调)。 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = "http://127.0.0.1:17001";
const CDP_PORT = 9373;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const chromeProc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/b2-drag-probe",
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
  log("graph ready");
  await sleep(1500);
  await ev(`window.app.loadGraphData(${JSON.stringify({
    id: "b2-drag-probe", nodes: [
      { id: 7, type: "MyImageABCompare", pos: [300, 200], size: [340, 300], flags: {}, order: 0, mode: 0,
        inputs: [{ name: "image_a", type: "IMAGE", link: null }, { name: "image_b", type: "IMAGE", link: null }],
        outputs: [{ name: "image_a", type: "IMAGE", links: null }, { name: "image_b", type: "IMAGE", links: null }],
        properties: { "Node name for S&R": "MyImageABCompare" }, widgets_values: ["A", "B"] },
    ], links: [], groups: [], config: {}, extra: {}, version: 0.4,
  })}, true, true, "b2-drag-probe")`);
  await sleep(1500);
  for (let i = 0; i < 20; i++) { if (await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare')?.__myAbHits?.divider ? 1:0`) === 1) break; await sleep(700); }
  await ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
    window.__probe = { down: 0, move: 0, lastPos: null, dragging: false };
    const od = n.onMouseDown, om = n.onMouseMove;
    n.onMouseDown = function (pos, e) { window.__probe.down++; window.__probe.lastPos = pos && [pos[0], pos[1]]; const r = od.apply(this, arguments); window.__probe.downRet = r; return r; };
    n.onMouseMove = function (pos, e) { window.__probe.move++; window.__probe.lastPos = pos && [pos[0], pos[1]]; return om.apply(this, arguments); };
    return 'instrumented';
  })()`);
  const geom = await ev(`(() => {
    const cnv = window.app.canvas; const n = cnv.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const h = n.__myAbHits; const d = h.divider; const st = h.stage;
    const s = (cnv.ds && cnv.ds.scale) || cnv.scale || 1;
    const ox = (cnv.ds && cnv.ds.offset && cnv.ds.offset[0]) || 0;
    const oy = (cnv.ds && cnv.ds.offset && cnv.ds.offset[1]) || 0;
    const r = cnv.canvas.getBoundingClientRect();
    return JSON.stringify({ rect: { l: r.left, t: r.top, w: r.width, h: r.height },
      scale: s, off: [ox, oy], nodePos: n.pos, div: d, stage: st,
      page: [r.left + (n.pos[0] + d.x + d.w / 2) * s + ox, r.top + (n.pos[1] + d.y + d.h / 2) * s + oy],
      elementAt: (() => { const p = [r.left + (n.pos[0] + d.x + d.w / 2) * s + ox, r.top + (n.pos[1] + d.y + d.h / 2) * s + oy];
        const el = document.elementFromPoint(p[0], p[1]); return el ? (el.tagName + '.' + (el.className && String(el.className).slice(0, 60))) : 'null'; })(),
      dpr: window.devicePixelRatio, canvasWH: [cnv.canvas.width, cnv.canvas.height] });
  })()`);
  log("geom:", geom);
  const g = JSON.parse(geom);
  // 1) 先看 hover 一下 graph_mouse 是否更新(映射真值)
  await mouse("mouseMoved", g.page[0] + 30, g.page[1], {});
  await sleep(300);
  const gm = await ev(`JSON.stringify(window.app.canvas.graph_mouse)`);
  log("after hover+30px, graph_mouse =", gm);
  // 2) 真拖
  const c0 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  await mouse("mousePressed", g.page[0], g.page[1], { button: "left", clickCount: 1 });
  await sleep(150);
  const probeDown = await ev(`JSON.stringify(window.__probe)`);
  log("probe after press:", probeDown);
  for (const t of [0.34, 0.67, 1]) {
    await mouse("mouseMoved", g.page[0] - 60 * t, g.page[1], { button: "left", clickCount: 1 });
    await sleep(150);
  }
  await mouse("mouseReleased", g.page[0] - 60, g.page[1], { button: "left", clickCount: 1 });
  await sleep(400);
  const c1 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  const probeEnd = await ev(`JSON.stringify(window.__probe)`);
  log(`curtain ${c0} -> ${c1}`);
  log("probe end:", probeEnd);
  log("graph_mouse end:", await ev(`JSON.stringify(window.app.canvas.graph_mouse)`));
} finally {
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { }
  ws.close();
}
