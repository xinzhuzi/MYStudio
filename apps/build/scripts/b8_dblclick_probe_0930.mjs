#!/usr/bin/env node
/** B8 双击自动连最近兼容口探针(0930,jsdom 仿真——本轮零引擎约束,引擎实弹延期):
 *  装载真 dblclick-connect-nearest.js(/scripts/app.js 唯一导入重定向到 jsdom
 *  桩,余零改),手势→选口→connect 全场景断言:双击输出→最近优先/类型过滤
 *  (通配·大小写·逗号多型·数组串接,引擎 isValidConnection 语义桩)/空闲过滤
 *  (已占槽永不被动)/源节点自身不参选/最上层优先/双击输入口·节点本体·空白
 *  零动作/无兼容静默/命中矩形边界(左上含右下不含,引擎 isInRectangle 同款)/
 *  手势零劫持(每次 dispatch 未取消+后置哨兵可达)/setup 重入闩/异常容错/
 *  LiteGraph 缺席兜底/AGPL 头逐字节/零道劫词/源零 preventDefault·stopPropagation
 *  字面调用。坐标换算桩=引擎 convertEventToCanvasOffset 同构(client-rect→
 *  scale/offset→图坐标),clientX/Y 全程走真 MouseEvent。 */
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../../backend/engines/comfyui/my_nodes/web");
const EXT = join(WEB, "dblclick-connect-nearest.js");
const SIBLING = join(WEB, "daojie-subgraph-autofit.js");

const dom = new JSDOM(`<!doctype html><html><body><canvas id="graph"></canvas></body></html>`, { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const canvasEl = dom.window.document.getElementById("graph");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// ── 引擎 isValidConnection 语义桩(0930 自真前端包逐字节核出的行为:
//    空串/"*"→通配;等值(大小写不敏感);逗号多型递归;EVENT→ACTION)──
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

// ── 坐标桩:引擎 convertEventToCanvasOffset 同构(rect 偏移→scale/offset)──
const RECT = { left: 10, top: 20 };
const SCALE = 2, OFF_X = 100, OFF_Y = 50;
const toClientX = (gx) => (gx - OFF_X) * SCALE + RECT.left;
const toClientY = (gy) => (gy - OFF_Y) * SCALE + RECT.top;

const tmp = await mkdtemp(join(tmpdir(), "b8-dblclick-probe-"));
try {
  // ── 桩:/scripts/app.js(扩展唯一 /scripts/* 依赖) ───────────────────
  const stubApp = join(tmp, "stub-app.mjs");
  await writeFile(stubApp, `export const app = {
  __registry: [],
  registerExtension(ext) { this.__registry.push(ext); },
  canvas: null,
  graph: { _nodes: [] },
};
`);
  // ── 重定向装载:仅替换 /scripts/app.js 一处导入,余零改 ──────────────
  const extSrc = await readFile(EXT, "utf8");
  const proxyExt = join(tmp, "ext.proxy.mjs");
  await writeFile(proxyExt, extSrc
    .replace('from "/scripts/app.js"', `from ${JSON.stringify(pathToFileURL(stubApp).href)}`));

  // ── 静态门:AGPL 头逐字节 / 零道劫词 / 零手势劫持字面 / 导入面 ──────
  console.log("[静态门]");
  const headerOf = async (p) => (await readFile(p, "utf8")).split("\n").slice(0, 3).join("\n") + "\n";
  ok("AGPL 头与兄弟件逐字节一致", (await headerOf(EXT)) === (await headerOf(SIBLING)));
  ok("新件零道劫词", !extSrc.includes("道劫"));
  ok("源零 preventDefault 字面", !extSrc.includes("preventDefault"));
  ok("源零 stopPropagation 字面", !extSrc.includes("stopPropagation"));
  ok("导入面恰 /scripts/app.js 一处(无 api/其他依赖)", (extSrc.match(/from "\/scripts\//g) ?? []).length === 1 && extSrc.includes('from "/scripts/app.js"'));

  // ── 装载(先 jsdom 全局后动态 import,顺序保证桩构造时 window 就位)──
  const { app } = await import(stubApp);
  app.canvas = {
    canvas: canvasEl,
    convertEventToCanvasOffset(e) {
      return [(e.clientX - RECT.left) / SCALE + OFF_X, (e.clientY - RECT.top) / SCALE + OFF_Y];
    },
  };
  await import(proxyExt);
  const ext = app.__registry.find((e) => e.name === "my.dblclick.connect.nearest");
  ok("扩展已注册(名 my.dblclick.connect.nearest)", !!ext, `registry=${app.__registry.map(e => e.name).join(",")}`);

  // ── 绑定面:setup 恰绑一次 + 重入闩 + 后置哨兵 ──────────────────────
  let dblBindings = 0, sentinel = 0;
  const origAdd = canvasEl.addEventListener.bind(canvasEl);
  canvasEl.addEventListener = (type, fn, opts) => { if (type === "dblclick") dblBindings++; return origAdd(type, fn, opts); };
  ext.setup(app);
  ok("setup 绑定 dblclick 监听恰一次", dblBindings === 1, `实际=${dblBindings}`);
  ext.setup(app);
  ok("二次 setup 零新增监听(重入闩)", dblBindings === 1, `实际=${dblBindings}`);
  canvasEl.addEventListener("dblclick", () => sentinel++); // 后置哨兵:零截停才可达

  // ── 节点/槽工厂 + dblclick 派发器(每次断言零取消+哨兵可达) ─────────
  let nextId = 1;
  const slot = (type, pos, link = null) => ({ type, link, __pos: pos });
  const mkNode = ({ inputs = [], outputs = [], noPosApi = false }) => {
    const node = {
      id: nextId++, inputs, outputs, connectCalls: [],
      connect(slotIdx, targetNode, targetSlot) { this.connectCalls.push({ slot: slotIdx, targetNode, targetSlot }); return { id: `link-${nextId++}` }; },
    };
    if (!noPosApi) {
      node.getOutputPos = (i) => node.outputs[i]?.__pos ?? null;
      node.getInputPos = (i) => node.inputs[i]?.__pos ?? null;
    }
    return node;
  };
  const useGraph = (...nodes) => { app.graph._nodes = nodes; };
  const totalConnects = () => app.graph._nodes.reduce((n, x) => n + (x.connectCalls?.length ?? 0), 0);
  const dblclick = (gx, gy) => {
    const ev = new dom.window.MouseEvent("dblclick", {
      clientX: toClientX(gx), clientY: toClientY(gy), bubbles: true, cancelable: true,
    });
    const before = sentinel; // 基线须取在派发之前
    const notCanceled = canvasEl.dispatchEvent(ev);
    ok(`派发未取消+哨兵可达(${gx},${gy})`, notCanceled && !ev.defaultPrevented && sentinel === before + 1);
    return ev;
  };
  const connectCount = (node) => node.connectCalls.length;
  const lastConnect = (node) => node.connectCalls.at(-1);

  // ── 场景 1:双击输出→最近兼容空闲输入 ────────────────────────────────
  console.log("[最近优先]");
  const src1 = mkNode({ outputs: [slot("MODEL", [500, 300])] });
  const near1 = mkNode({ inputs: [slot("MODEL", [620, 300])] });
  const far1 = mkNode({ inputs: [slot("MODEL", [500, 500])] });
  useGraph(src1, near1, far1);
  dblclick(500, 300);
  ok("双击输出 connect 恰一次", connectCount(src1) === 1, `实际=${connectCount(src1)}`);
  ok("connect 参数=(输出槽0,目标节点,目标槽0)", (() => { const c = lastConnect(src1); return c && c.slot === 0 && c.targetNode === near1 && c.targetSlot === 0; })(), JSON.stringify(lastConnect(src1)));
  ok("连的是几何最近者(620 距 120 < 500 距 200)", lastConnect(src1)?.targetNode === near1);

  // ── 场景 2:类型过滤(最近但不兼容→连次近兼容) ─────────────────────
  console.log("[类型过滤]");
  const src2 = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const wrong2 = mkNode({ inputs: [slot("LATENT", [110, 100])] });
  const right2 = mkNode({ inputs: [slot("MODEL", [100, 400])] });
  useGraph(src2, wrong2, right2);
  dblclick(100, 100);
  ok("类型不兼容的最近口被跳过", lastConnect(src2)?.targetNode === right2 && connectCount(src2) === 1);

  // ── 场景 3:通配 * / 大小写 / 逗号多型 / 数组输出串接 ────────────────
  console.log("[引擎判型语义]");
  const srcW = mkNode({ outputs: [slot("MODEL", [100, 1000])] });
  const inW = mkNode({ inputs: [slot("*", [110, 1000])] });
  useGraph(srcW, inW); dblclick(100, 1000);
  ok("输入 * 通配可连", lastConnect(srcW)?.targetNode === inW);
  const srcC = mkNode({ outputs: [slot("IMAGE", [100, 2000])] });
  const inC = mkNode({ inputs: [slot("image", [110, 2000])] });
  useGraph(srcC, inC); dblclick(100, 2000);
  ok("等值大小写不敏感可连(IMAGE→image)", lastConnect(srcC)?.targetNode === inC);
  const srcM = mkNode({ outputs: [slot("MASK", [100, 3000])] });
  const inM = mkNode({ inputs: [slot("IMAGE,MASK", [110, 3000])] });
  useGraph(srcM, inM); dblclick(100, 3000);
  ok("逗号多型输入可连(MASK→IMAGE,MASK)", lastConnect(srcM)?.targetNode === inM);
  const srcA = mkNode({ outputs: [slot(["IMAGE", "MASK"], [100, 4000])] });
  const inA = mkNode({ inputs: [slot("MASK", [110, 4000])] });
  useGraph(srcA, inA); dblclick(100, 4000);
  ok("数组输出型经 String 串接可连", lastConnect(srcA)?.targetNode === inA);

  // ── 场景 4:空闲过滤(已占槽永不被动) ───────────────────────────────
  console.log("[空闲过滤]");
  const src4 = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const busy4 = mkNode({ inputs: [slot("MODEL", [105, 100], 7)] });
  const free4 = mkNode({ inputs: [slot("MODEL", [100, 500])] });
  useGraph(src4, busy4, free4);
  dblclick(100, 100);
  ok("已连线槽(link=7)被跳过,连次近空闲口", lastConnect(src4)?.targetNode === free4 && connectCount(src4) === 1);

  // ── 场景 5:源节点自身输入不参选 ────────────────────────────────────
  console.log("[自身排除]");
  const src5 = mkNode({ inputs: [slot("MODEL", [120, 100])], outputs: [slot("MODEL", [100, 100])] });
  const other5 = mkNode({ inputs: [slot("MODEL", [400, 100])] });
  useGraph(src5, other5);
  dblclick(100, 100);
  ok("自身最近输入不参选,连他节点", lastConnect(src5)?.targetNode === other5, JSON.stringify(lastConnect(src5)));

  // ── 场景 6:最上层优先(渲染序倒扫) ────────────────────────────────
  console.log("[最上层]");
  const bottom6 = mkNode({ outputs: [slot("MODEL", [200, 200])] });
  const top6 = mkNode({ outputs: [slot("LATENT", [204, 200])] });
  const in6 = mkNode({ inputs: [slot("LATENT", [400, 200])] });
  useGraph(bottom6, top6, in6);
  dblclick(200, 200); // 两输出矩形重叠点:后画者(top6)胜
  ok("重叠矩形后画者(最上层)胜出", connectCount(top6) === 1 && connectCount(bottom6) === 0
    && lastConnect(top6)?.targetNode === in6);

  // ── 场景 7:双击输入口/节点本体/空白=零动作 ─────────────────────────
  console.log("[零扰原生]");
  const src7 = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const in7 = mkNode({ inputs: [slot("MODEL", [300, 100])] });
  useGraph(src7, in7);
  dblclick(300, 100);
  ok("双击输入口零 connect", totalConnects() === 0);
  dblclick(130, 130); // 节点本体(任意非输出矩形点)
  ok("双击节点本体零 connect", totalConnects() === 0);
  dblclick(9999, 9999);
  ok("双击空白零 connect", totalConnects() === 0);

  // ── 场景 8:无兼容空闲口=静默 ───────────────────────────────────────
  console.log("[无兼容静默]");
  const src8 = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const wrong8 = mkNode({ inputs: [slot("LATENT", [105, 100])] });
  useGraph(src8, wrong8);
  let threw8 = false;
  try { dblclick(100, 100); } catch { threw8 = true; }
  ok("无兼容口静默零 connect 零抛错", !threw8 && connectCount(src8) === 0);

  // ── 场景 9:命中矩形边界(引擎 isInRectangle:左上含右下不含) ───────
  console.log("[边界]");
  const src9 = mkNode({ outputs: [slot("MODEL", [200, 600])] }); // 矩形 x∈[185,215) y∈[590,610)
  const in9 = mkNode({ inputs: [slot("MODEL", [300, 600])] });
  useGraph(src9, in9);
  dblclick(214, 609);
  ok("右下界内(214,609)命中并 connect", connectCount(src9) === 1);
  src9.connectCalls.length = 0;
  dblclick(215, 610);
  ok("右下界外(215,610)零动作(右下不含)", connectCount(src9) === 0);

  // ── 场景 10:LiteGraph 缺席兜底(保守等值) ─────────────────────────
  console.log("[缺席兜底]");
  delete window.LiteGraph;
  const src10 = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const same10 = mkNode({ inputs: [slot("MODEL", [110, 100])] });
  useGraph(src10, same10); dblclick(100, 100);
  ok("缺席时等值型仍可连", lastConnect(src10)?.targetNode === same10);
  const src10b = mkNode({ outputs: [slot("MODEL", [100, 100])] });
  const diff10 = mkNode({ inputs: [slot("LATENT", [110, 100]), slot("MODEL", [100, 500])] });
  useGraph(src10b, diff10); dblclick(100, 100);
  ok("缺席时异型被兜底判拒(连到次近同型)", lastConnect(src10b)?.targetNode === diff10 && lastConnect(src10b)?.targetSlot === 1);
  window.LiteGraph = { isValidConnection, EVENT: ENGINE_EVENT, ACTION: ENGINE_ACTION };

  // ── 场景 11:异常容错(怪节点/空图/无 canvas 法) ────────────────────
  console.log("[容错]");
  const weird = mkNode({ outputs: [slot("MODEL", [100, 100])], noPosApi: true });
  const src11 = mkNode({ outputs: [slot("MODEL", [150, 100])] });
  const in11 = mkNode({ inputs: [slot("MODEL", [150, 300])] });
  useGraph(weird, src11, in11);
  let threw11 = false;
  try { dblclick(150, 100); } catch { threw11 = true; }
  ok("无 getOutputPos 怪节点被跳过不炸", !threw11 && lastConnect(src11)?.targetNode === in11);
  useGraph();
  let threw11b = false;
  try { dblclick(50, 50); } catch { threw11b = true; }
  ok("空图派发零抛错", !threw11b);

  console.log(`\nB8 探针结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
