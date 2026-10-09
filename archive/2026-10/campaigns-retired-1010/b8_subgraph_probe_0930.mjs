#!/usr/bin/env node
/** B8 子图打开态探针(0930,b8_dblclick_probe_0930.mjs 的子图域补集,常驻):
 *  背景:dblclick-connect-nearest.js:93 原取 app.graph._nodes 作扫描面,但引擎
 *  ComfyApp 的 graph getter 恒返根图(rootGraphInternal),开子图只切
 *  canvas.graph(openSubgraph→setGraph→attachCanvas);convertEventToCanvasOffset
 *  出的是当前视口(子图)域坐标——跨域比较曾致 ①子图内双击恒静默不连 ②根图/
 *  子图坐标数值重合时在根图连出用户看不见的线(缺陷原位复现档曾落
 *  /tmp/b8_subgraph_repro_0930.mjs,10 断言双形态均现)。修复后扫描面=
 *  canvas.graph(引擎 getCurrentGraph 同源)。
 *  本探针按引擎机制建「根图固定/子图视口分离」双域桩(前提四条自真前端包
 *  settingStore chunk 现核:getter 恒根图无 setter/唯一赋值在 configure/
 *  openSubgraph→setGraph 只切画布/坐标换算走当前显示图视口),装载真
 *  dblclick-connect-nearest.js(/scripts/app.js 唯一导入重定向,余零改),
 *  断言:子图内双击正常连子图最近兼容口/跨域数值重合只连子图不误连根图/
 *  根图画面功能不回归/子图内零扰原生·空闲过滤照常/canvas 缺 graph 位回退
 *  根图/每派发未取消+哨兵可达(零劫持)/setup 重入闩/静态门(AGPL 头逐字节·
 *  零道劫词·零 preventDefault·stopPropagation 字面·导入面恰一处)。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "../../backend/engines/comfyui/my_nodes/web/dblclick-connect-nearest.js");
const SIBLING = join(HERE, "../../backend/engines/comfyui/my_nodes/web/daojie-subgraph-autofit.js");

const dom = new JSDOM(`<!doctype html><html><body><canvas id="graph"></canvas></body></html>`, { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const canvasEl = dom.window.document.getElementById("graph");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// ── 引擎 isValidConnection 语义桩(与 b8 探针同源,自真前端包核出的行为)──
const ENGINE_EVENT = 1, ENGINE_ACTION = 1;
const isValidConnection = (a, b) => {
  if (a === "" || a === "*") a = 0;
  if (b === "" || b === "*") b = 0;
  if (!a || !b || a == b || (a == ENGINE_EVENT && b == ENGINE_ACTION)) return true;
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  if (!a.includes(",") && !b.includes(",")) return a === b;
  for (const pa of a.split(",")) for (const pb of b.split(",")) if (isValidConnection(pa, pb)) return true;
  return false;
};
window.LiteGraph = { isValidConnection, EVENT: ENGINE_EVENT, ACTION: ENGINE_ACTION };

// ── 坐标桩:引擎 convertEventToCanvasOffset 同构(rect→scale/offset,当前
//    显示图=子图打开时的子图视口域)──────────────────────────────────────
const RECT = { left: 10, top: 20 };
const SCALE = 2, OFF_X = 100, OFF_Y = 50;
const toClientX = (gx) => (gx - OFF_X) * SCALE + RECT.left;
const toClientY = (gy) => (gy - OFF_Y) * SCALE + RECT.top;

// ── 引擎同构桩:app.graph=根图(固定引用,模拟 rootGraphInternal 恒返根图);
//    app.canvas.graph=当前显示图(开子图后=subgraph,模型 openSubgraph→
//    setGraph→attachCanvas);getCurrentGraph=引擎真法(返 this.graph)──────
const ROOT = { _nodes: [] };
const SUB = { _nodes: [] };
const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
  graph: ROOT, // 引擎 getter 恒返此对象;子图打开不改它(无 setter,唯一赋值在 configure)
  canvas: {
    canvas: canvasEl,
    graph: ROOT, // 初始=根图;openSubgraph 后=subgraph
    getCurrentGraph() { return this.graph; },
    convertEventToCanvasOffset(e) {
      return [(e.clientX - RECT.left) / SCALE + OFF_X, (e.clientY - RECT.top) / SCALE + OFF_Y];
    },
  },
};

const tmp = await mkdtemp(join(tmpdir(), "b8-subgraph-probe-"));
try {
  const stubApp = join(tmp, "stub-app.mjs");
  await writeFile(stubApp, `export const app = globalThis.__stubApp__;`);
  globalThis.__stubApp__ = app;

  const extSrc = await readFile(EXT, "utf8");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  await writeFile(proxyExt, extSrc.replace('from "/scripts/app.js"', `from ${JSON.stringify(pathToFileURL(stubApp).href)}`));

  // ── 静态门(与 b8 探针同款)────────────────────────────────────────────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("扩展源零道劫词", !extSrc.includes("道劫"));
  ok("源零 preventDefault 字面", !extSrc.includes("preventDefault"));
  ok("源零 stopPropagation 字面", !extSrc.includes("stopPropagation"));
  ok("导入面恰 /scripts/app.js 一处", (extSrc.match(/from "\/scripts\//g) ?? []).length === 1 && extSrc.includes('from "/scripts/app.js"'));

  // ── 装载真扩展 + 绑定面 ────────────────────────────────────────────────
  await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.dblclick.connect.nearest");
  ok("真扩展已装载注册", !!ext);
  let dblBindings = 0, sentinel = 0;
  const origAdd = canvasEl.addEventListener.bind(canvasEl);
  canvasEl.addEventListener = (type, fn, opts) => { if (type === "dblclick") dblBindings++; return origAdd(type, fn, opts); };
  ext.setup(app);
  ok("setup 绑定 dblclick 监听恰一次", dblBindings === 1, `实际=${dblBindings}`);
  ext.setup(app);
  ok("二次 setup 零新增监听(重入闩)", dblBindings === 1, `实际=${dblBindings}`);
  canvasEl.addEventListener("dblclick", () => sentinel++); // 后置哨兵:零截停才可达

  // ── 节点/槽工厂 + 派发器(每次断言零取消+哨兵可达)─────────────────────
  let nextId = 1;
  const slot = (type, pos, link = null) => ({ type, link, __pos: pos });
  const mkNode = ({ inputs = [], outputs = [] }) => {
    const node = {
      id: nextId++, inputs, outputs, connectCalls: [],
      connect(slotIdx, targetNode, targetSlot) { this.connectCalls.push({ slot: slotIdx, targetNode, targetSlot }); return { id: `link-${nextId++}` }; },
    };
    node.getOutputPos = (i) => node.outputs[i]?.__pos ?? null;
    node.getInputPos = (i) => node.inputs[i]?.__pos ?? null;
    return node;
  };
  const connects = (...nodes) => nodes.reduce((n, x) => n + (x.connectCalls?.length ?? 0), 0);
  const dblclick = (gx, gy) => {
    const ev = new dom.window.MouseEvent("dblclick", {
      clientX: toClientX(gx), clientY: toClientY(gy), bubbles: true, cancelable: true,
    });
    const before = sentinel; // 基线须取在派发之前
    const notCanceled = canvasEl.dispatchEvent(ev);
    ok(`派发未取消+哨兵可达(${gx},${gy})`, notCanceled && !ev.defaultPrevented && sentinel === before + 1);
    return ev;
  };

  // ══ 场景 A(子图打开·双击子图输出口→连子图最近兼容口)════════════════
  console.log("[A] 子图内双击输出口(修复后应连子图口,根图零动作)");
  ROOT._nodes = [
    mkNode({ outputs: [slot("MODEL", [2000, 2000])] }),
    mkNode({ inputs: [slot("MODEL", [2120, 2000])] }),
  ];
  const A_src = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const A_near = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  const A_far = mkNode({ inputs: [slot("MODEL", [500, 900])] });
  SUB._nodes = [A_src, A_near, A_far];
  app.canvas.graph = SUB; // openSubgraph→setGraph(画布切子图,app.graph 仍=ROOT)
  ok("建模确认:canvas 当前图=子图,app.graph=根图(两引用不同)", app.canvas.graph === SUB && app.graph === ROOT && app.canvas.getCurrentGraph() === SUB);
  dblclick(500, 300);
  ok("子图源节点 connect 恰一次", A_src.connectCalls.length === 1, `实际=${A_src.connectCalls.length}`);
  ok("连的是子图内几何最近兼容口", A_src.connectCalls[0]?.targetNode === A_near && A_src.connectCalls[0]?.slot === 0 && A_src.connectCalls[0]?.targetSlot === 0);
  ok("根图两节点零 connect(不再跨域扫根图)", connects(...ROOT._nodes) === 0);
  A_src.connectCalls.length = 0;

  // ══ 场景 B(子图打开·根图/子图坐标数值重合→只连子图,根图不误连)══════
  console.log("[B] 跨域数值重合(旧缺陷形态②:曾在根图连出不可见线)");
  const B_rsrc = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const B_rin = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  ROOT._nodes = [B_rsrc, B_rin];
  const B_ssrc = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const B_sin = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  SUB._nodes = [B_ssrc, B_sin];
  app.canvas.graph = SUB;
  dblclick(500, 300); // 用户双击的是子图画面里 B_ssrc 的输出口
  ok("connect 发生在子图侧(B_ssrc→B_sin)", B_ssrc.connectCalls.length === 1 && B_ssrc.connectCalls[0]?.targetNode === B_sin);
  ok("根图 R_src 零 connect(不可见连线形态不再现)", B_rsrc.connectCalls.length === 0, `实际=${B_rsrc.connectCalls.length}`);
  ok("根图 R_in 空闲口未被跨域占用", B_rin.inputs[0].link === null);

  // ══ 场景 C(未开子图·根图=当前图·功能不回归)════════════════════════
  console.log("[C] 未开子图(当前图=根图,坐标同域)");
  const C_src = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const C_in = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  ROOT._nodes = [C_src, C_in];
  SUB._nodes = [];
  app.canvas.graph = ROOT;
  dblclick(500, 300);
  ok("根图画面双击输出→正常 connect 最近兼容口", C_src.connectCalls.length === 1 && C_src.connectCalls[0]?.targetNode === C_in);

  // ══ 场景 D(子图打开·双击输入口/空白/节点本体=零动作)════════════════
  console.log("[D] 子图内零扰原生");
  const D_src = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const D_in = mkNode({ inputs: [slot("MODEL", [300, 100])] });
  SUB._nodes = [D_src, D_in];
  app.canvas.graph = SUB;
  dblclick(300, 100);
  ok("子图内双击输入口零 connect", connects(D_src, D_in) === 0);
  dblclick(9999, 9999);
  ok("子图内双击空白零 connect", connects(D_src, D_in) === 0);

  // ══ 场景 E(子图打开·空闲过滤与类型过滤照常,均在子图域内)════════════
  console.log("[E] 子图域内语义照常");
  const E_src = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const E_busy = mkNode({ inputs: [slot("MODEL", [105, 100], 7)] });
  const E_wrong = mkNode({ inputs: [slot("LATENT", [110, 100])] });
  const E_free = mkNode({ inputs: [slot("MODEL", [100, 500])] });
  SUB._nodes = [E_src, E_busy, E_wrong, E_free];
  dblclick(100, 100);
  ok("已占槽与异型被跳过,连子图内次近兼容空闲口",
    E_src.connectCalls.length === 1 && E_src.connectCalls[0]?.targetNode === E_free && E_src.connectCalls[0]?.targetSlot === 0);

  // ══ 场景 F(canvas 缺 graph 位→保守回 app.graph 根图兜底)════════════
  console.log("[F] 回退链(canvas.graph 缺位=旧 b8 探针桩形态)");
  const savedGraph = app.canvas.graph;
  delete app.canvas.graph;
  const F_src = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const F_in = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  ROOT._nodes = [F_src, F_in];
  dblclick(500, 300);
  ok("canvas 缺 graph 位时回退根图照常连", F_src.connectCalls.length === 1 && F_src.connectCalls[0]?.targetNode === F_in);
  app.canvas.graph = savedGraph;

  console.log(`\nB8 子图探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
