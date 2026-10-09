#!/usr/bin/env node
/** B2 帘拖动探针B:验证 @comfyorg litegraph 的 widget.mouse 派发(addCustomWidget 包裹层)
 *  + 修正坐标公式 page = rect + (graph+offset)*scale。 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ENGINE = "http://127.0.0.1:17001";
const CDP_PORT = 9374;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const chromeProc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/b2-drag-probe-b",
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
  await sleep(1500);
  await ev(`window.app.loadGraphData(${JSON.stringify({
    id: "b2-drag-probe-b", nodes: [
      { id: 7, type: "MyImageABCompare", pos: [300, 200], size: [340, 300], flags: {}, order: 0, mode: 0,
        inputs: [{ name: "image_a", type: "IMAGE", link: null }, { name: "image_b", type: "IMAGE", link: null }],
        outputs: [{ name: "image_a", type: "IMAGE", links: null }, { name: "image_b", type: "IMAGE", links: null }],
        properties: { "Node name for S&R": "MyImageABCompare" }, widgets_values: ["A", "B"] },
    ], links: [], groups: [], config: {}, extra: {}, version: 0.4,
  })}, true, true, "b2-drag-probe-b")`);
  await sleep(1500);
  for (let i = 0; i < 20; i++) { if (await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare')?.__myAbHits?.divider ? 1:0`) === 1) break; await sleep(700); }
  const setup = await ev(`(() => {
    const n = window.app.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const w = (n.widgets || []).find(w => w.name === 'my_ab_image_stage');
    window.__p = { nodeDown: 0, widgetMouse: 0, widgetDown: 0, pointerDown: 0, lastArgs: null, widgetCtor: w ? w.constructor.name : 'none' };
    const od = n.onMouseDown;
    n.onMouseDown = function () { window.__p.nodeDown++; return od.apply(this, arguments); };
    if (w) {
      const om = w.mouse;
      w.mouse = function (e, pos, node) {
        window.__p.widgetMouse++;
        if (String(e.type).includes('down')) window.__p.widgetDown++;
        window.__p.lastArgs = { type: e.type, buttons: e.buttons, pos: pos ? [pos[0], pos[1]] : null, nodeOk: node === n };
        return om && om.apply(this, arguments);
      };
      const opd = w.onPointerDown;
      w.onPointerDown = function () { window.__p.pointerDown++; return opd && opd.apply(this, arguments); };
    }
    return JSON.stringify(window.__p.widgetCtor);
  })()`);
  log("widget ctor:", setup);
  // 修正公式:page = rect + (graph + offset) * scale;graph = 节点pos + 手柄局部中心
  const geom = await ev(`(() => {
    const cnv = window.app.canvas; const n = cnv.graph._nodes.find(n => n.type === 'MyImageABCompare');
    const h = n.__myAbHits; const d = h.divider; const st = h.stage;
    const s = cnv.ds.scale, off = cnv.ds.offset;
    const r = cnv.canvas.getBoundingClientRect();
    const toPage = (gx, gy) => [r.left + (gx + off[0]) * s, r.top + (gy + off[1]) * s];
    const [hx, hy] = toPage(n.pos[0] + d.x + d.w / 2, n.pos[1] + d.y + d.h / 2);
    const [tx, ty] = toPage(n.pos[0] + st.x + st.w * 0.28, n.pos[1] + st.y + st.h / 2);
    return JSON.stringify({ hx, hy, tx, ty, scale: s, off, rect: [r.left, r.top] });
  })()`);
  log("geom(corrected):", geom);
  const g = JSON.parse(geom);
  // 真值校验:hover 后 graph_mouse 应≈手柄图坐标
  await mouse("mouseMoved", g.hx, g.hy, {});
  await sleep(300);
  log("graph_mouse after hover at handle:", await ev(`JSON.stringify(window.app.canvas.graph_mouse)`));
  const c0 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  await mouse("mousePressed", g.hx, g.hy, { button: "left", clickCount: 1 });
  await sleep(200);
  log("after press:", await ev(`JSON.stringify(window.__p)`));
  for (const t of [0.34, 0.67, 1]) {
    await mouse("mouseMoved", g.hx + (g.tx - g.hx) * t, g.hy + (g.ty - g.hy) * t, { button: "left", clickCount: 1 });
    await sleep(150);
  }
  await mouse("mouseReleased", g.tx, g.ty, { button: "left", clickCount: 1 });
  await sleep(400);
  const c1 = await ev(`window.app.graph._nodes.find(n=>n.type==='MyImageABCompare').properties.myAbImage.curtain`);
  log(`curtain ${c0} -> ${c1}`);
  log("probe end:", await ev(`JSON.stringify(window.__p)`));
} finally {
  try { process.kill(-chromeProc.pid, "SIGTERM"); } catch { }
  ws.close();
}
