// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * PCB 连线插件兼容垫片测试(11-24,任务 11-24-comfyui-pcb-link-routing;design §3.8:
 * 十二组纯逻辑用例 + 薄挂载接线用例)。
 * 跑法:node --test apps/backend/comfyui/my_nodes/web/my_pcb_link_compat.test.mjs
 * (后缀必须是 .test.mjs:引擎前端会把扩展目录下的 .js 当插件脚本加载,测试件一被加载就报错;
 * 同目录惯例见 web/*.test.mjs)
 *
 * 双 runner 适配(同 open-workflow-decision.test.mjs 头注口径):VT 全量(apps/ 根,
 * frontend/config/vite.config.ts 未设 include/exclude)按 vitest 默认测试 glob 也会拾取本文件,
 * 而 node:test 注册的用例不被 vitest 认领 →「No test suite found」套件红;按 runner 取注册 API:
 * VT 下(process.env.VITEST)用 vitest 的 test,node --test 下用 node:test,两门禁锁同一份断言。
 *
 * 造的对象全是假的(画布/图/注册表/插件句柄),不碰真实页面。上游 registry.js 的可见行为照搬进
 * 假注册表:beginFrame 按图里的节点数更新障碍物、变了就升版本号;stats 回
 * { cached, obstacles, version }。上游 index.js 对 drawLink 的包装也照搬一个假的(算走线时读
 * canvas.graph._links),垫片应当包在它外面。
 *
 * 纯逻辑(①–⑫ = design §3.8 的 1–12,一组一条主用例,⑨ 按断言面拆成 a–e):
 *  ① 插件不在/没挂钩  ② 画布没有自有 drawConnections  ③ 有自有 drawConnections:包一次
 *  ④ 非 PCB 模式直通  ⑤ 首帧探活→此后补调  ⑥ 判插件钩子活着→永不补调  ⑦ 空图不下结论
 *  ⑧ beginFrame 抛错不外漏  ⑨ 走线期别名  ⑩ 画布换新对象  ⑪ 注册表加载失败  ⑫ 默认切换判定
 * 薄挂载接线(接线①–⑧):读 my_pcb_link_compat.js 源码,去掉 import 行后放进 vm 跑,桩掉
 * app、createPcbCompat、resolveDefaultMode、window、定时器、console。
 */

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { createPcbCompat, resolveDefaultMode } from "./my_pcb_link_compat_core.mjs";

const PCB_MODE = 64; // 上游哨兵(window.__pcb.PCB())
const SPLINE = 2; // 出厂默认 = window.LiteGraph.SPLINE_LINK
const FRAME_FLAG = "__myPcbLinkCompatShim";
const ROUTE_FLAG = "__myPcbLinkCompatRoute";
const MODE_SETTING = "Comfy.LinkRenderMode";
const ACTIVATED_SETTING = "My.PcbLinkMode.Activated";
const CTX = { tag: "ctx" };
const ROUTE_BOOM = new Error("route boom");
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// ── 假对象 ────────────────────────────────────────────────────────────────

class FakeGraph {
  constructor(nodes = []) {
    this.links = new Map();
    this._nodes = nodes;
  }
}

/** 假注册表模块:照上游 registry.js 的可见行为。 */
function makeRegistry() {
  const registry = {
    obstacles: 0,
    version: 0,
    beginTargets: [], // 每次 beginFrame 收到的画布
    statsCalls: 0,
    failBegin: null, // 设为 Error:beginFrame 抛它
    failStats: null, // 设为 Error:stats 抛它
    beginFrame(canvas) {
      registry.beginTargets.push(canvas);
      if (registry.failBegin) throw registry.failBegin;
      const count = canvas.graph?._nodes?.length ?? 0;
      if (count !== registry.obstacles) {
        registry.obstacles = count;
        registry.version++;
      }
    },
    stats() {
      registry.statsCalls++;
      if (registry.failStats) throw registry.failStats;
      return { cached: 0, obstacles: registry.obstacles, version: registry.version };
    },
  };
  return registry;
}

/** 假的 window.__pcb。 */
function makePcb({ patched = true, value = PCB_MODE } = {}) {
  return {
    state: { patched, option: patched, PCB: value },
    stats: () => ({}),
    routes: () => [],
    PCB: () => value,
  };
}

/** 每个画布各给一套新的类(渲染器原型是垫片要包的对象,不能跨用例共用)。 */
function makeCanvasClass() {
  class PathRenderer {
    drawLink(ctx, linkData, context) {
      return `core-draw:${linkData?.id}`;
    }
  }
  class Canvas {
    constructor(graph, mode) {
      this.links_render_mode = mode;
      this.graph = graph;
      this.linkRenderer = { pathRenderer: new PathRenderer() };
    }
    drawConnections() {
      return "proto-drawn";
    }
  }
  return { Canvas, PathRenderer };
}

/**
 * 仿 MiniMaxH3-Easy 在画布**实例**上覆盖 drawConnections。
 * onDraw = 原函数执行途中做的事(用来模拟「原函数里含插件的原型钩子」)。
 */
function giveOwnDrawConnections(canvas, onDraw = null) {
  canvas.ownCalls = [];
  canvas.drawConnections = function drawConnectionsWithFakeLinks(ctx) {
    canvas.ownCalls.push({ self: this, args: Array.from(arguments) });
    if (onDraw) onDraw(canvas);
    if (canvas.onOwnDraw) canvas.onOwnDraw();
    if (canvas.ownThrows) throw canvas.ownThrows;
    return "own-drawn";
  };
  return canvas;
}

function makeCanvas(graph, mode = PCB_MODE, { own = true } = {}) {
  const { Canvas } = makeCanvasClass();
  const canvas = new Canvas(graph, mode);
  return own ? giveOwnDrawConnections(canvas) : canvas;
}

/**
 * 仿上游 index.js 对 drawLink 的包装:算走线时读 canvas.graph._links。
 * 每次执行记下「入口处」看到的 _links;nestedId 那条会在执行途中再进一次 drawLink(嵌套);
 * throwId 那条会抛错。返回记录数组。
 */
function giveUpstreamDrawLink(canvas, { nestedId = null, throwId = null } = {}) {
  const proto = Object.getPrototypeOf(canvas.linkRenderer.pathRenderer);
  const core = proto.drawLink;
  const log = [];
  proto.drawLink = function upstreamDrawLink(ctx, linkData, context) {
    const entry = { id: linkData?.id, self: this, args: Array.from(arguments), atEntry: canvas.graph._links };
    log.push(entry);
    if (linkData?.id === nestedId) {
      proto.drawLink.call(this, ctx, { id: "inner" }, context);
      entry.afterNested = canvas.graph._links;
    }
    if (linkData?.id === throwId) throw ROUTE_BOOM;
    return core.apply(this, arguments);
  };
  return log;
}

/** 建一份垫片 + 记录面。warnCalls 是朴素计数(垫片每报一次记一次),warned 是按消息键去重后的集合。 */
function makeHarness({ pcb = makePcb(), canvas = null, registry = makeRegistry(), activateDefaultMode } = {}) {
  const h = { pcb, canvas, registry, loads: 0, loadError: null, activations: 0, warnCalls: [], warned: new Set() };
  const warnOnce = (msg, error) => {
    h.warnCalls.push({ msg, error });
    h.warned.add(msg);
  };
  h.compat = createPcbCompat({
    getPcb: () => h.pcb,
    loadRegistry: async () => {
      h.loads++;
      if (h.loadError) throw h.loadError;
      return h.registry;
    },
    warnOnce,
    getCanvas: () => h.canvas,
    getGraph: () => h.canvas?.graph ?? null,
    ...(activateDefaultMode === undefined
      ? {}
      : {
          activateDefaultMode: (...args) => {
            h.activations++;
            return activateDefaultMode(...args);
          },
        }),
  });
  return h;
}

// ── 纯逻辑 ────────────────────────────────────────────────────────────────

test("① 插件不在/没挂钩:tick 恒 waiting、零副作用(不包钩、不补别名、不取注册表、不做默认切换),且不因次数封顶转 dormant", async () => {
  const graph = new FakeGraph([{}, {}]);
  const canvas = makeCanvas(graph); // 有自有 drawConnections:万一被误包,下面抓得到
  const h = makeHarness({
    pcb: null,
    canvas,
    activateDefaultMode: async () => ({ activated: true, mode: PCB_MODE, defaultMode: SPLINE, reason: "first-run" }),
  });
  const ownBefore = canvas.drawConnections;
  const rendererProto = Object.getPrototypeOf(canvas.linkRenderer.pathRenderer);
  const drawLinkBefore = rendererProto.drawLink;

  for (let i = 0; i < 400; i++) assert.strictEqual(await h.compat.tick(), "waiting");
  assert.strictEqual(h.compat.state.phase, "waiting", "等插件不封顶:400 拍后仍是 waiting");
  assert.strictEqual(h.compat.state.waitTicks, 400);
  assert.strictEqual(h.loads, 0, "插件没挂钩不该去取注册表模块");
  assert.strictEqual(h.activations, 0, "插件没挂钩不该做默认切换");
  assert.strictEqual(canvas.drawConnections, ownBefore, "不该包画布实例的前置钩");
  assert.strictEqual(rendererProto.drawLink, drawLinkBefore, "不该包渲染器原型的 drawLink");
  assert.strictEqual(h.compat.canvasInfo(canvas).wrapped, false);
  assert.deepStrictEqual(h.compat.aliasInfo(graph), { defined: false, resolved: false });
  assert.strictEqual("_links" in graph, false);
  assert.deepStrictEqual(h.compat.activation(), { activated: false, mode: null, defaultMode: null, reason: "not-run" });

  // 插件在、但还没挂钩(window.__pcb.state.patched 仍是 false):同样只计数等待
  h.pcb = makePcb({ patched: false });
  assert.strictEqual(await h.compat.tick(), "waiting");
  assert.strictEqual(h.compat.state.waitTicks, 401);
  assert.strictEqual(h.loads, 0);
  assert.strictEqual(canvas.drawConnections, ownBefore);
});

test("② 插件已挂钩、画布没有自有 drawConnections:不包前置钩(原型层钩子够得着),返回 ready;默认切换只在第一次到 ready 时做一次", async () => {
  const graph = new FakeGraph([{}, {}]);
  const canvas = makeCanvas(graph, PCB_MODE, { own: false });
  const h = makeHarness({
    canvas,
    activateDefaultMode: async () => ({ activated: true, mode: PCB_MODE, defaultMode: SPLINE, reason: "first-run" }),
  });
  assert.strictEqual(await h.compat.tick(), "ready");
  assert.strictEqual(h.compat.state.phase, "ready");
  assert.strictEqual(h.compat.state.registry, h.registry, "注册表模块取到并留在状态里");
  assert.strictEqual(hasOwn(canvas, "drawConnections"), false, "不得给画布加自有 drawConnections(再包一帧会调两次)");
  assert.strictEqual(h.compat.state.liveByCanvas.has(canvas), false);
  assert.deepStrictEqual(h.compat.canvasInfo(canvas), { wrapped: false, live: "unknown" });
  // 画一帧:直接走到原型方法,垫片零参与(不读 stats、不调 beginFrame)
  assert.strictEqual(canvas.drawConnections.call(canvas, CTX), "proto-drawn");
  assert.strictEqual(h.registry.beginTargets.length, 0);
  assert.strictEqual(h.registry.statsCalls, 0);

  // 再 tick 幂等:注册表不重取、默认切换不重做、始终没有自有 drawConnections
  await h.compat.tick();
  await h.compat.tick();
  assert.strictEqual(h.loads, 1);
  assert.strictEqual(h.activations, 1, "默认切换只在第一次到 ready 时做");
  assert.deepStrictEqual(h.compat.activation(), { activated: true, mode: PCB_MODE, defaultMode: SPLINE, reason: "first-run" });
  assert.strictEqual(hasOwn(canvas, "drawConnections"), false);
  assert.strictEqual(h.compat.canvasInfo(canvas).wrapped, false);

  // 画布还没出现(app.canvas 为 null):照样 ready、不抛;画布晚出现后下一拍补上
  const h2 = makeHarness({ canvas: null });
  assert.strictEqual(await h2.compat.tick(), "ready");
  assert.deepStrictEqual(h2.compat.canvasInfo(null), { wrapped: false, live: "unknown" });
  assert.deepStrictEqual(h2.compat.aliasInfo(null), { defined: false, resolved: false });
  h2.canvas = makeCanvas(new FakeGraph([{}]));
  await h2.compat.tick();
  assert.strictEqual(h2.compat.canvasInfo(h2.canvas).wrapped, true, "画布晚出现:就绪后的巡检把它包上");
  assert.strictEqual(h2.compat.state.phase, "ready");
});

test("③ 画布有自有 drawConnections:包一次(标记为真);再 tick 不重复包;原函数被留作 previous、原样透传", async () => {
  const graph = new FakeGraph([{}, {}]);
  const canvas = makeCanvas(graph);
  const own = canvas.drawConnections;
  const h = makeHarness({ canvas });
  assert.strictEqual(h.compat.canvasInfo(canvas).wrapped, false);
  assert.strictEqual(await h.compat.tick(), "ready");
  const shim = canvas.drawConnections;
  assert.notStrictEqual(shim, own, "实例上的 drawConnections 应被换成包装函数");
  assert.strictEqual(hasOwn(shim, FRAME_FLAG), true, "包装函数带本模块的标记属性");
  assert.strictEqual(shim[FRAME_FLAG], true);
  assert.strictEqual(hasOwn(canvas, "drawConnections"), true, "仍是画布实例上的自有属性(实例层)");
  assert.strictEqual(h.compat.state.liveByCanvas.get(canvas), "unknown", "包上时的探活结论=还没在 PCB 模式下画过");
  assert.deepStrictEqual(h.compat.canvasInfo(canvas), { wrapped: true, live: "unknown" });
  await h.compat.tick();
  await h.compat.tick();
  assert.strictEqual(canvas.drawConnections, shim, "重复 tick 不得再包一层");
  assert.strictEqual(h.compat.state.liveByCanvas.get(canvas), "unknown", "重复 tick 不得改写探活结论");

  // 非 PCB 模式画一帧:原函数恰被调用一次,this / 实参 / 返回值原样透传(证明 previous 就是原来那个自有函数)
  canvas.links_render_mode = SPLINE;
  const ctx = { name: "ctx" };
  const extra = { name: "extra" };
  const returned = canvas.drawConnections.call(canvas, ctx, extra);
  assert.strictEqual(canvas.ownCalls.length, 1, "原函数恰被调用一次");
  assert.strictEqual(canvas.ownCalls[0].self, canvas, "this 原样透传");
  assert.strictEqual(canvas.ownCalls[0].args.length, 2, "实参个数原样透传");
  assert.strictEqual(canvas.ownCalls[0].args[0], ctx, "实参原样透传(第 1 个)");
  assert.strictEqual(canvas.ownCalls[0].args[1], extra, "实参原样透传(多出来的第 2 个)");
  assert.strictEqual(returned, "own-drawn", "返回值原样透传");
  assert.strictEqual(h.registry.beginTargets.length, 0);
});

test("④ 模式不是 PCB:包装函数原样调用原函数恰一次,beginFrame 调用次数为 0,也不探活", async () => {
  const graph = new FakeGraph([{}, {}]);
  const canvas = makeCanvas(graph, SPLINE);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = canvas.drawConnections;
  for (let i = 0; i < 3; i++) assert.strictEqual(shim.call(canvas, CTX), "own-drawn");
  assert.strictEqual(canvas.ownCalls.length, 3, "每帧原函数恰一次");
  assert.strictEqual(h.registry.beginTargets.length, 0, "beginFrame 调用次数为 0");
  assert.strictEqual(h.registry.statsCalls, 0, "非 PCB 模式不探活");
  assert.deepStrictEqual(h.compat.canvasInfo(canvas), { wrapped: true, live: "unknown" });

  // 已判成「由垫片补调」之后再切回曲线:照样一次都不补调
  canvas.links_render_mode = PCB_MODE;
  shim.call(canvas, CTX); // 第一帧:判为 shim
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "shim");
  shim.call(canvas, CTX); // 第二帧:补调一次
  assert.strictEqual(h.registry.beginTargets.length, 1);
  canvas.links_render_mode = SPLINE;
  const ownCount = canvas.ownCalls.length;
  shim.call(canvas, CTX);
  shim.call(canvas, CTX);
  assert.strictEqual(h.registry.beginTargets.length, 1, "切回曲线后 beginFrame 调用次数不再增加");
  assert.strictEqual(canvas.ownCalls.length, ownCount + 2, "原函数照常每帧一次");

  // 插件没挂钩时(哪怕模式数值恰好等于哨兵)同样直通
  h.pcb = makePcb({ patched: false });
  canvas.links_render_mode = PCB_MODE;
  shim.call(canvas, CTX);
  assert.strictEqual(h.registry.beginTargets.length, 1, "插件没挂钩:不补调");
  assert.strictEqual(canvas.ownCalls.length, ownCount + 3, "原函数照常被调用");
});

test("⑤ PCB 模式、obstacles 为 0、图里有节点:第一帧不补调(帧后判「插件钩子够不着」),之后每帧在原函数之前补调恰一次", async () => {
  const graph = new FakeGraph([{}, {}, {}]);
  const canvas = makeCanvas(graph);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const order = []; // 谁先谁后
  canvas.onOwnDraw = () => order.push("own");
  const realBegin = h.registry.beginFrame;
  h.registry.beginFrame = (target) => {
    order.push("begin");
    realBegin.call(h.registry, target);
  };

  // 第一帧
  assert.strictEqual(canvas.drawConnections.call(canvas, CTX), "own-drawn");
  assert.deepStrictEqual(order, ["own"], "第一帧不补调");
  assert.strictEqual(
    h.compat.canvasInfo(canvas).live,
    "shim",
    "帧后判定:图里有节点而 obstacles 为 0 = 插件自己的钩子没被调到",
  );
  assert.strictEqual(h.registry.statsCalls, 1, "探活只读一次 stats");
  assert.strictEqual(h.registry.obstacles, 0, "此时确实还没人调过 beginFrame");

  // 之后每帧
  order.length = 0;
  for (let i = 0; i < 3; i++) assert.strictEqual(canvas.drawConnections.call(canvas, CTX), "own-drawn");
  assert.deepStrictEqual(order, ["begin", "own", "begin", "own", "begin", "own"], "每帧在原函数之前补调恰一次");
  assert.strictEqual(h.registry.beginTargets.length, 3);
  assert.strictEqual(
    h.registry.beginTargets.every((target) => target === canvas),
    true,
    "beginFrame 收到的是画布本身",
  );
  assert.strictEqual(canvas.ownCalls.length, 4, "原函数每帧恰一次(含第一帧)");
  // 补调之后障碍物已有值,但结论不重判(不重读 stats):仍每帧补调
  assert.strictEqual(h.registry.obstacles, 3);
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "shim");
  assert.strictEqual(h.registry.statsCalls, 1);
});

test("⑥ PCB 模式、obstacles 大于 0:判为插件钩子活着,此后永不补调(之后障碍物归零也不重判)", async () => {
  const graph = new FakeGraph([{}, {}]);
  const canvas = makeCanvas(graph, PCB_MODE, { own: false });
  const hook = { registry: null, alive: true, frames: 0 };
  // 原函数里含插件的原型钩子(插件先挂钩、别的插件后抓原函数的情形):
  // 原函数执行途中,插件的 beginFrame 被调到。
  giveOwnDrawConnections(canvas, (target) => {
    if (!hook.alive) return;
    hook.frames++;
    hook.registry.beginFrame(target);
  });
  const h = makeHarness({ canvas });
  hook.registry = h.registry;
  await h.compat.tick();

  canvas.drawConnections.call(canvas, CTX);
  assert.strictEqual(hook.frames, 1, "插件自己的钩子被调到了");
  assert.strictEqual(h.registry.obstacles, 2);
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "plugin", "帧后判定:obstacles 大于 0 = 插件钩子活着");

  // 之后插件钩子够不着了、障碍物归零:垫片仍不补调、不重探
  hook.alive = false;
  h.registry.obstacles = 0;
  const realBegin = h.registry.beginFrame;
  let beginCalls = 0;
  h.registry.beginFrame = (target) => {
    beginCalls++;
    realBegin.call(h.registry, target);
  };
  for (let i = 0; i < 3; i++) canvas.drawConnections.call(canvas, CTX);
  assert.strictEqual(beginCalls, 0, "判为插件钩子活着之后,垫片一次都不补调");
  assert.strictEqual(h.registry.statsCalls, 1, "判过之后不再探活");
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "plugin");
  assert.strictEqual(canvas.ownCalls.length, 4, "原函数照常每帧一次");
});

test("⑦ PCB 模式但图是空的:不下结论(不读 stats、不补调);等有节点的帧再判", async () => {
  const graph = new FakeGraph([]); // 空图
  const canvas = makeCanvas(graph);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const order = [];
  canvas.onOwnDraw = () => order.push("own");
  const realBegin = h.registry.beginFrame;
  h.registry.beginFrame = (target) => {
    order.push("begin");
    realBegin.call(h.registry, target);
  };
  canvas.drawConnections.call(canvas, CTX);
  canvas.drawConnections.call(canvas, CTX);
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "unknown", "空图的 obstacles 恒为 0,分不出死活:不下结论");
  assert.strictEqual(h.registry.statsCalls, 0, "空图不读 stats");
  assert.deepStrictEqual(order, ["own", "own"]);

  // 来了节点(加载了工作流)、插件钩子够不着:这一帧仍不补调,帧后判 shim;再下一帧起补调
  graph._nodes.push({}, {});
  order.length = 0;
  canvas.drawConnections.call(canvas, CTX);
  assert.deepStrictEqual(order, ["own"], "有节点的第一帧仍不补调");
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "shim");
  order.length = 0;
  canvas.drawConnections.call(canvas, CTX);
  assert.deepStrictEqual(order, ["begin", "own"]);

  // 另一路:空图期间没判,来节点时插件钩子够得着 → 判 plugin,永不补调
  const graph2 = new FakeGraph([]);
  const canvas2 = makeCanvas(graph2, PCB_MODE, { own: false });
  const hook = { registry: null, alive: true };
  giveOwnDrawConnections(canvas2, (target) => {
    if (hook.alive) hook.registry.beginFrame(target);
  });
  const h2 = makeHarness({ canvas: canvas2 });
  hook.registry = h2.registry;
  await h2.compat.tick();
  canvas2.drawConnections.call(canvas2, CTX);
  assert.strictEqual(h2.compat.canvasInfo(canvas2).live, "unknown");
  graph2._nodes.push({});
  canvas2.drawConnections.call(canvas2, CTX);
  assert.strictEqual(h2.compat.canvasInfo(canvas2).live, "plugin");
  // 之后插件钩子够不着了:垫片也不补(判过「插件钩子活着」就永远直通)
  hook.alive = false;
  canvas2.drawConnections.call(canvas2, CTX);
  canvas2.drawConnections.call(canvas2, CTX);
  assert.strictEqual(h2.registry.beginTargets.length, 2, "只有插件钩子那两次;垫片补调次数=0");
  assert.strictEqual(h2.registry.statsCalls, 1, "判过之后不再探活");
});

test("⑧ beginFrame 抛错:被吞掉不外漏,原函数仍被调用并有返回值,同一故障只告警一次;探活读 stats 抛错同样不外漏", async () => {
  const graph = new FakeGraph([{}]);
  const canvas = makeCanvas(graph);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = canvas.drawConnections;
  shim.call(canvas, CTX); // 第一帧:判为 shim
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "shim");
  assert.strictEqual(h.registry.beginTargets.length, 0, "第一帧垫片没补调过");
  assert.strictEqual(h.warned.size, 0, "一路正常:零告警");

  const boom = new Error("beginFrame boom");
  h.registry.failBegin = boom;
  const ownBefore = canvas.ownCalls.length;
  let returned;
  for (let i = 0; i < 4; i++) returned = shim.call(canvas, CTX); // 不抛
  assert.strictEqual(returned, "own-drawn", "原函数的返回值照常回传");
  assert.strictEqual(canvas.ownCalls.length, ownBefore + 4, "原函数每帧仍被调用恰一次");
  assert.strictEqual(h.registry.beginTargets.length, 4, "每帧都试了补调(全部抛错、全部被吞)");
  assert.strictEqual(h.warnCalls.length, 4, "垫片每帧都把故障报给 warnOnce(去重由 warnOnce 负责)");
  assert.strictEqual(
    h.warnCalls.every((w) => w.msg === h.warnCalls[0].msg && w.error === boom),
    true,
    "同一故障用同一个消息键、带原错误",
  );
  assert.strictEqual(h.warned.size, 1, "于是同一故障只告警一次");
  assert.strictEqual(h.compat.canvasInfo(canvas).live, "shim", "出错不改探活结论");
  assert.strictEqual(h.compat.state.phase, "ready");

  // 原函数自己抛的错不是垫片的事:照常外抛,不吞、不改写
  const ownBoom = new Error("own drawConnections boom");
  canvas.ownThrows = ownBoom;
  let caught = null;
  try {
    shim.call(canvas, CTX);
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, ownBoom, "原函数的异常原样外抛");

  // 探活读 stats 抛错:不下结论、不外漏、告警一次
  const canvas2 = makeCanvas(new FakeGraph([{}]));
  const h2 = makeHarness({ canvas: canvas2 });
  h2.registry.failStats = new Error("stats boom");
  await h2.compat.tick();
  assert.strictEqual(canvas2.drawConnections.call(canvas2, CTX), "own-drawn", "不抛,原函数返回值照常回传");
  assert.strictEqual(canvas2.ownCalls.length, 1);
  assert.strictEqual(h2.compat.canvasInfo(canvas2).live, "unknown", "读不到 stats 就不下结论");
  assert.strictEqual(h2.warned.size, 1);
  canvas2.drawConnections.call(canvas2, CTX);
  assert.strictEqual(h2.warned.size, 1, "同一故障只告警一次");
  assert.strictEqual(h2.registry.beginTargets.length, 0, "没下结论就不会补调");
});

test("⑨a 走线期别名:包的是渲染器原型上的 drawLink,只包一次;别名只在上游算走线的那次调用期间可见", async () => {
  const graph = new FakeGraph([{}, {}]);
  graph.links = new Map([[7, { id: 7 }]]);
  const canvas = makeCanvas(graph, PCB_MODE, { own: false });
  const renderer = canvas.linkRenderer.pathRenderer;
  const proto = Object.getPrototypeOf(renderer);
  const upstream = proto.drawLink;
  const log = giveUpstreamDrawLink(canvas);
  const h = makeHarness({ canvas });
  assert.strictEqual(h.compat.aliasInfo(graph).defined, false, "就绪前没装");

  await h.compat.tick();
  const shim = proto.drawLink;
  assert.notStrictEqual(shim, upstream, "包的是渲染器原型上的 drawLink");
  assert.strictEqual(hasOwn(shim, ROUTE_FLAG), true);
  assert.strictEqual(shim[ROUTE_FLAG], true);
  assert.strictEqual(proto.drawLink, shim);
  assert.strictEqual(hasOwn(renderer, "drawLink"), false, "不往渲染器实例上挂");
  assert.strictEqual(renderer.drawLink, shim, "渲染器实例沿原型链取到的就是包装函数");

  // 只包一次:再 tick、同类的第二个画布,都不再包
  await h.compat.tick();
  assert.strictEqual(proto.drawLink, shim);
  const canvas2 = new canvas.constructor(graph, PCB_MODE);
  const renderer2 = canvas2.linkRenderer.pathRenderer;
  h.canvas = canvas2;
  await h.compat.tick();
  assert.strictEqual(proto.drawLink, shim, "同一条原型不重复包");

  // 调用期间可见、调用前后不可见;this / 实参 / 返回值原样透传
  const linkData = { id: 7 };
  const context = { name: "context" };
  assert.strictEqual(graph._links, undefined, "调用前不可见");
  const returned = shim.call(renderer, CTX, linkData, context);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].atEntry, graph.links, "上游函数执行期间 graph._links === graph.links");
  assert.strictEqual(log[0].self, renderer, "this 原样透传");
  assert.strictEqual(log[0].args.length, 3, "实参个数原样透传");
  assert.strictEqual(log[0].args[0], CTX);
  assert.strictEqual(log[0].args[1], linkData);
  assert.strictEqual(log[0].args[2], context);
  assert.strictEqual(returned, "core-draw:7", "返回值原样透传");
  assert.strictEqual(graph._links, undefined, "调用后不可见");
  assert.strictEqual(h.compat.state.depth, 0, "深度计数调用结束归零");
  // 换了画布对象(canvas2):包装按「当前画布的图」走
  assert.strictEqual(shim.call(renderer2, CTX, linkData, context), "core-draw:7");
  assert.strictEqual(log[1].atEntry, graph.links);
  assert.strictEqual(graph._links, undefined);
});

test("⑨b 非 PCB 模式下执行期间也是 undefined,且不装访问器;访问器是图对象的自有属性,原型上没有 _links", async () => {
  const graph = new FakeGraph([{}, {}]);
  graph.links = new Map();
  const canvas = makeCanvas(graph, SPLINE, { own: false });
  const renderer = canvas.linkRenderer.pathRenderer;
  const log = giveUpstreamDrawLink(canvas);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = Object.getPrototypeOf(renderer).drawLink;

  shim.call(renderer, CTX, { id: 1 }, {});
  assert.strictEqual(log[0].atEntry, undefined, "非 PCB 模式:执行期间也是 undefined");
  assert.strictEqual("_links" in graph, false, "非 PCB 模式不装访问器");
  assert.deepStrictEqual(h.compat.aliasInfo(graph), { defined: false, resolved: false });
  assert.strictEqual(h.compat.state.depth, 0);

  // 切到 PCB:首次在走线中遇到这张图才装
  canvas.links_render_mode = PCB_MODE;
  shim.call(renderer, CTX, { id: 1 }, {});
  assert.strictEqual(log[1].atEntry, graph.links);
  const descriptor = Object.getOwnPropertyDescriptor(graph, "_links");
  assert.strictEqual(typeof descriptor.get, "function", "访问器是图对象的自有属性");
  assert.strictEqual(descriptor.configurable, true);
  assert.strictEqual(descriptor.enumerable, false);
  assert.strictEqual(descriptor.set, undefined);
  assert.strictEqual(hasOwn(Object.getPrototypeOf(graph), "_links"), false, "图的原型上没有 _links");
  assert.strictEqual("_links" in FakeGraph.prototype, false);
  assert.strictEqual("_links" in Object.prototype, false);
  assert.strictEqual(graph._links, undefined, "走线之外读出来是 undefined");
  assert.deepStrictEqual(h.compat.aliasInfo(graph), { defined: true, resolved: true }, "resolved 标记被置真");
});

test("⑨c 图上已有自有 _links(别的代码留下的)或 links.get 不是函数时不装、不盖、不增深度", async () => {
  const main = new FakeGraph([{}]);
  main.links = new Map();
  const canvas = makeCanvas(main, PCB_MODE, { own: false });
  const renderer = canvas.linkRenderer.pathRenderer;
  const log = giveUpstreamDrawLink(canvas);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = Object.getPrototypeOf(renderer).drawLink;

  // 别的代码留下的自有 _links(普通数据属性):原样留着,上游读到的是它
  const foreign = new Map([[1, { id: 1 }]]);
  const borrowed = new FakeGraph([{}]);
  Object.defineProperty(borrowed, "_links", { value: foreign, writable: true, enumerable: true, configurable: false });
  canvas.graph = borrowed;
  assert.strictEqual(shim.call(renderer, CTX, { id: 1 }, {}), "core-draw:1");
  assert.strictEqual(log[0].atEntry, foreign, "上游读到的是图上原有的那张表(不是垫片的访问器)");
  assert.strictEqual(Object.getOwnPropertyDescriptor(borrowed, "_links").value, foreign, "没被盖掉");
  assert.deepStrictEqual(h.compat.aliasInfo(borrowed), { defined: false, resolved: false });
  assert.strictEqual(h.compat.state.depth, 0);

  // links.get 不是函数:不装
  const flat = new FakeGraph([{}]);
  flat.links = [];
  canvas.graph = flat;
  shim.call(renderer, CTX, { id: 2 }, {});
  assert.strictEqual(log[1].atEntry, undefined);
  assert.strictEqual("_links" in flat, false);
  assert.deepStrictEqual(h.compat.aliasInfo(flat), { defined: false, resolved: false });
  assert.strictEqual(h.compat.state.depth, 0);
});

test("⑨d 嵌套调用:只有最外层结束后才复原;上游函数抛错时深度计数照常复原", async () => {
  const graph = new FakeGraph([{}, {}]);
  graph.links = new Map();
  const canvas = makeCanvas(graph, PCB_MODE, { own: false });
  const renderer = canvas.linkRenderer.pathRenderer;
  const log = giveUpstreamDrawLink(canvas, { nestedId: "outer", throwId: "bad" });
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = Object.getPrototypeOf(renderer).drawLink;

  shim.call(renderer, CTX, { id: "outer" }, {});
  assert.strictEqual(log.length, 2);
  assert.strictEqual(log[0].id, "outer");
  assert.strictEqual(log[0].atEntry, graph.links, "外层执行期间可见");
  assert.strictEqual(log[1].id, "inner");
  assert.strictEqual(log[1].atEntry, graph.links, "内层(嵌套)执行期间可见");
  assert.strictEqual(log[0].afterNested, graph.links, "内层结束、外层还没结束:仍可见(深度 2→1)");
  assert.strictEqual(graph._links, undefined, "最外层结束才复原");
  assert.strictEqual(h.compat.state.depth, 0);

  // 上游函数抛错:错误照常外抛(不吞、不改写),深度计数照常复原
  let caught = null;
  try {
    shim.call(renderer, CTX, { id: "bad" }, {});
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, ROUTE_BOOM, "上游函数抛的错原样外抛");
  assert.strictEqual(h.compat.state.depth, 0, "深度计数复原");
  assert.strictEqual(graph._links, undefined, "抛错之后别名照样不可见");
  assert.deepStrictEqual(h.compat.aliasInfo(graph), { defined: true, resolved: true });

  // 之后正常调用仍然对
  assert.strictEqual(shim.call(renderer, CTX, { id: "ok" }, {}), "core-draw:ok");
  assert.strictEqual(log[3].atEntry, graph.links);
  assert.strictEqual(h.compat.state.depth, 0);
  assert.strictEqual(h.warned.size, 0, "上游函数自己的错不是垫片的事:不告警");
});

test("⑨e 每张图对象各装一次(主图与子图各有一份访问器,互不影响);画布不在/插件不在时直通", async () => {
  const main = new FakeGraph([{}]);
  main.links = new Map();
  const canvas = makeCanvas(main, PCB_MODE, { own: false });
  const renderer = canvas.linkRenderer.pathRenderer;
  const log = giveUpstreamDrawLink(canvas);
  const h = makeHarness({ canvas });
  await h.compat.tick();
  const shim = Object.getPrototypeOf(renderer).drawLink;

  shim.call(renderer, CTX, { id: 1 }, {});
  assert.deepStrictEqual(h.compat.aliasInfo(main), { defined: true, resolved: true });

  // 进了子图:画布的图换成子图对象,首次在走线中遇到才装
  const sub = new FakeGraph([{}, {}, {}]);
  sub.links = new Map();
  canvas.graph = sub;
  assert.deepStrictEqual(h.compat.aliasInfo(sub), { defined: false, resolved: false });
  assert.strictEqual(sub._links, undefined);
  shim.call(renderer, CTX, { id: 2 }, {});
  assert.strictEqual(log[1].atEntry, sub.links, "子图执行期间可见的是子图自己的连线表");
  assert.deepStrictEqual(h.compat.aliasInfo(sub), { defined: true, resolved: true });
  assert.strictEqual(hasOwn(sub, "_links"), true);
  assert.strictEqual(main._links, undefined, "主图的访问器与子图无关:主图此刻不可见");
  assert.strictEqual(h.compat.state.depth, 0);

  // 画布不在(app.canvas 为 null)/ 插件不在(window.__pcb 为 null):直通,不装、不增深度
  const orphan = new FakeGraph([{}]);
  orphan.links = new Map();
  canvas.graph = orphan;
  const liveCanvas = h.canvas;
  h.canvas = null;
  shim.call(renderer, CTX, { id: 3 }, {});
  assert.strictEqual(log[2].atEntry, undefined, "画布不在:执行期间不可见");
  assert.strictEqual("_links" in orphan, false);
  h.canvas = liveCanvas;
  h.pcb = null;
  shim.call(renderer, CTX, { id: 4 }, {});
  assert.strictEqual(log[3].atEntry, undefined, "插件不在:执行期间不可见");
  assert.strictEqual("_links" in orphan, false);
  assert.strictEqual(h.compat.state.depth, 0);
  assert.strictEqual(hasOwn(main, "_links"), true, "已装过的访问器留着(下次走线直接用)");
});

test("⑩ 画布换新对象:巡检发现后新画布被处理(前置钩+走线期别名),旧画布不动(不重包、探活结论不被改写)", async () => {
  const oldCanvas = makeCanvas(new FakeGraph([{}, {}]));
  const oldRendererProto = Object.getPrototypeOf(oldCanvas.linkRenderer.pathRenderer);
  const h = makeHarness({ canvas: oldCanvas });
  await h.compat.tick();
  const oldShim = oldCanvas.drawConnections;
  const oldRouteShim = oldRendererProto.drawLink;
  oldCanvas.drawConnections.call(oldCanvas, CTX); // 旧画布已判「由垫片补调」
  assert.strictEqual(h.compat.canvasInfo(oldCanvas).live, "shim");

  // 换新画布(另一个类 = 另一条渲染器原型)
  const newGraph = new FakeGraph([{}, {}, {}]);
  const newCanvas = makeCanvas(newGraph);
  const newOwn = newCanvas.drawConnections;
  const newRendererProto = Object.getPrototypeOf(newCanvas.linkRenderer.pathRenderer);
  h.canvas = newCanvas;
  assert.strictEqual(h.compat.canvasInfo(newCanvas).wrapped, false, "巡检前新画布还没被处理");
  assert.strictEqual(await h.compat.tick(), "ready");
  assert.notStrictEqual(newCanvas.drawConnections, newOwn, "新画布的前置钩被包上");
  assert.strictEqual(h.compat.canvasInfo(newCanvas).wrapped, true);
  assert.strictEqual(h.compat.state.liveByCanvas.get(newCanvas), "unknown", "新画布从没画过:探活结论是全新的");
  assert.strictEqual(hasOwn(newRendererProto.drawLink, ROUTE_FLAG), true, "新画布的渲染器原型也被包上走线期别名");

  // 新画布自己走一遍探活,与旧画布的结论无关
  newCanvas.drawConnections.call(newCanvas, CTX);
  assert.strictEqual(h.compat.canvasInfo(newCanvas).live, "shim");
  assert.strictEqual(h.registry.statsCalls, 2, "旧画布探活一次 + 新画布探活一次");
  assert.strictEqual(h.registry.beginTargets.length, 0);
  newCanvas.drawConnections.call(newCanvas, CTX);
  assert.strictEqual(h.registry.beginTargets.length, 1);
  assert.strictEqual(h.registry.beginTargets[0], newCanvas, "补调的是新画布");

  // 旧画布不动
  assert.strictEqual(oldCanvas.drawConnections, oldShim, "旧画布的前置钩没被重包");
  assert.strictEqual(oldRendererProto.drawLink, oldRouteShim, "旧画布那条原型没被重包");
  assert.strictEqual(h.compat.canvasInfo(oldCanvas).live, "shim", "旧画布的探活结论原样");
  oldCanvas.links_render_mode = SPLINE;
  oldCanvas.drawConnections.call(oldCanvas, CTX);
  assert.strictEqual(oldCanvas.ownCalls.length, 2, "旧画布的包装仍可用,且没变成双层(原函数恰一次)");
  assert.strictEqual(newCanvas.ownCalls.length, 2, "旧画布被画不会碰新画布");

  // 同一个类再换一个画布:渲染器原型是同一条,走线期别名不重包;前置钩照样给新实例包上
  const third = giveOwnDrawConnections(new newCanvas.constructor(newGraph, PCB_MODE));
  h.canvas = third;
  await h.compat.tick();
  assert.strictEqual(h.compat.canvasInfo(third).wrapped, true, "同类的新实例:前置钩照样包上");
  assert.strictEqual(
    Object.getPrototypeOf(third.linkRenderer.pathRenderer).drawLink,
    newRendererProto.drawLink,
    "同一条原型:走线期别名不重复包",
  );
  assert.strictEqual(h.compat.canvasInfo(newCanvas).wrapped, true);
});

test("⑪ 注册表模块加载失败:转 dormant(本页终态:不再取模块、不再告警、不装任何钩、不做默认切换),告警一次", async () => {
  const graph = new FakeGraph([{}]);
  const canvas = makeCanvas(graph);
  const rendererProto = Object.getPrototypeOf(canvas.linkRenderer.pathRenderer);
  const drawLinkBefore = rendererProto.drawLink;
  const ownBefore = canvas.drawConnections;
  const h = makeHarness({
    canvas,
    activateDefaultMode: async () => ({ activated: true, mode: null, defaultMode: null, reason: "first-run" }),
  });
  const boom = new Error("import failed");
  h.loadError = boom;
  assert.strictEqual(await h.compat.tick(), "dormant");
  assert.strictEqual(h.compat.state.phase, "dormant");
  assert.strictEqual(h.compat.state.registry, null);
  assert.strictEqual(h.loads, 1);
  assert.strictEqual(h.warnCalls.length, 1, "告警一次");
  assert.strictEqual(h.warnCalls[0].error, boom, "带原错误");
  assert.match(h.warnCalls[0].msg, /注册表/);
  for (let i = 0; i < 3; i++) assert.strictEqual(await h.compat.tick(), "dormant");
  assert.strictEqual(h.loads, 1, "休眠后不再取模块");
  assert.strictEqual(h.warnCalls.length, 1, "休眠后不再告警");
  assert.strictEqual(h.activations, 0, "没到 ready:不做默认切换");
  assert.strictEqual(canvas.drawConnections, ownBefore, "没装前置钩");
  assert.strictEqual(rendererProto.drawLink, drawLinkBefore, "没装走线期别名");

  // 先等插件(插件不在),插件出现后注册表才失败:同样转 dormant
  const canvas2 = makeCanvas(new FakeGraph([{}]));
  const h2 = makeHarness({ pcb: null, canvas: canvas2 });
  assert.strictEqual(await h2.compat.tick(), "waiting");
  h2.pcb = makePcb();
  h2.loadError = new Error("late failure");
  assert.strictEqual(await h2.compat.tick(), "dormant");
  assert.strictEqual(h2.compat.state.waitTicks, 1);
  assert.strictEqual(h2.compat.canvasInfo(canvas2).wrapped, false);

  // 注册表模块没有 beginFrame(上游改了接口):包了也补调不了 → 不包前置钩、不告警;别名照装
  const canvas3 = makeCanvas(new FakeGraph([{}]));
  const h3 = makeHarness({ canvas: canvas3, registry: { stats: () => ({ obstacles: 0 }) } });
  assert.strictEqual(await h3.compat.tick(), "ready");
  assert.strictEqual(h3.compat.canvasInfo(canvas3).wrapped, false, "没有 beginFrame 就不包前置钩");
  assert.strictEqual(hasOwn(Object.getPrototypeOf(canvas3.linkRenderer.pathRenderer).drawLink, ROUTE_FLAG), true);
  assert.strictEqual(h3.warned.size, 0);
});

test("⑫ resolveDefaultMode 四种输入:已激活过 / 用户手选过 / 设置服务不可用 / 首次运行", () => {
  const firstRun = { activated: false, mode: SPLINE, defaultMode: SPLINE, settingsAvailable: true };
  const results = [
    resolveDefaultMode({ ...firstRun, activated: true }),
    resolveDefaultMode({ ...firstRun, mode: 0 }),
    resolveDefaultMode({ ...firstRun, mode: PCB_MODE }),
    resolveDefaultMode({ activated: false, mode: null, defaultMode: null, settingsAvailable: false }),
    resolveDefaultMode(firstRun),
  ];
  assert.deepStrictEqual(results[0], { shouldActivate: false, reason: "already-activated" });
  assert.deepStrictEqual(results[1], { shouldActivate: false, reason: "user-chose" });
  assert.deepStrictEqual(results[2], { shouldActivate: false, reason: "user-chose" }, "用户自己选过 PCB 也不必再切");
  assert.deepStrictEqual(results[3], { shouldActivate: false, reason: "settings-unavailable" });
  assert.deepStrictEqual(results[4], { shouldActivate: true, reason: "first-run" });
  // 比不出「是否仍是出厂默认值」(任一侧未知)时同样不动
  assert.deepStrictEqual(resolveDefaultMode({ ...firstRun, mode: null }), { shouldActivate: false, reason: "user-chose" });
  assert.deepStrictEqual(resolveDefaultMode({ ...firstRun, defaultMode: null }), { shouldActivate: false, reason: "user-chose" });
  // 结果恒为这两个键、reason 恒在四个值之内
  for (const result of results) {
    assert.deepStrictEqual(Object.keys(result).sort(), ["reason", "shouldActivate"]);
    assert.strictEqual(typeof result.shouldActivate, "boolean");
    assert.ok(["already-activated", "user-chose", "settings-unavailable", "first-run"].includes(result.reason));
    assert.strictEqual(result.shouldActivate, result.reason === "first-run", "只有首次运行才切");
  }
});

test("⑫b 默认切换只在第一次到 ready 时做一次;切换抛错=告警一次、不重试到死、不影响就绪态;没提供就不做", async () => {
  const boom = new Error("set failed");
  const h = makeHarness({
    canvas: makeCanvas(new FakeGraph([{}])),
    activateDefaultMode: async () => {
      throw boom;
    },
  });
  assert.strictEqual(await h.compat.tick(), "ready", "切换失败不影响就绪");
  assert.strictEqual(h.compat.state.phase, "ready");
  assert.deepStrictEqual(h.compat.activation(), { activated: false, mode: null, defaultMode: null, reason: "error" });
  assert.strictEqual(h.compat.canvasInfo(h.canvas).wrapped, true, "前置钩照常装上");
  await h.compat.tick();
  await h.compat.tick();
  assert.strictEqual(h.activations, 1, "不重试到死");
  assert.strictEqual(h.warnCalls.filter((w) => w.error === boom).length, 1, "告警一次");

  // 成功:结果留在诊断里(返回的是副本,改不动内部状态)
  const info = { activated: true, mode: SPLINE, defaultMode: SPLINE, reason: "first-run" };
  const h2 = makeHarness({ canvas: makeCanvas(new FakeGraph([{}])), activateDefaultMode: async () => info });
  await h2.compat.tick();
  await h2.compat.tick();
  assert.strictEqual(h2.activations, 1);
  assert.deepStrictEqual(h2.compat.activation(), info);
  h2.compat.activation().activated = false;
  assert.strictEqual(h2.compat.activation().activated, true, "诊断句柄返回的是副本");

  // 没提供 activateDefaultMode:零调用,reason 保持 not-run
  const h3 = makeHarness({ canvas: makeCanvas(new FakeGraph([{}])) });
  assert.strictEqual(await h3.compat.tick(), "ready");
  assert.deepStrictEqual(h3.compat.activation(), { activated: false, mode: null, defaultMode: null, reason: "not-run" });
});

// ── 薄挂载接线 ────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOUNT_SOURCE = readFileSync(path.join(HERE, "my_pcb_link_compat.js"), "utf8");
/** 去掉静态 import 行后的薄挂载源码(函数体内的动态 import 留着,用例里不触发它)。 */
const MOUNT_SOURCE_NO_IMPORTS = MOUNT_SOURCE.split("\n").filter((line) => !/^import\b/.test(line)).join("\n");

/** vm 上下文里造的对象原型与本域不同:转成本域的普通对象再比。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 把薄挂载源码跑进 vm;桩掉 app / createPcbCompat / resolveDefaultMode / window / 定时器 / console。 */
function runMount({ tick, state } = {}) {
  const out = {
    extensions: [], // registerExtension 收到的扩展对象
    timers: [], // 待触发的定时器 { fn, ms }
    warned: [],
    resolveCalls: [],
    deps: null,
    app: {
      canvas: null,
      graph: null,
      extensionManager: undefined,
      registerExtension: (extension) => out.extensions.push(extension),
    },
    window: {},
    compat: {
      state: state ?? { phase: "waiting", waitTicks: 0 },
      tick: tick ?? (async () => "waiting"),
      canvasInfo: (canvas) => ({ wrapped: canvas === "W", live: "shim" }),
      aliasInfo: (graph) => ({ defined: graph === "D", resolved: graph === "R" }),
      activation: () => ({ activated: true, mode: 64, defaultMode: 2, reason: "first-run" }),
    },
  };
  const context = createContext({
    app: out.app,
    window: out.window,
    createPcbCompat: (deps) => {
      out.deps = deps;
      return out.compat;
    },
    resolveDefaultMode: (input) => {
      out.resolveCalls.push(plain(input));
      return resolveDefaultMode(input);
    },
    setTimeout: (fn, ms) => {
      out.timers.push({ fn, ms });
      return out.timers.length;
    },
    console: {
      warn: (...args) => out.warned.push(args),
    },
  });
  runInContext(MOUNT_SOURCE_NO_IMPORTS, context, { filename: "my_pcb_link_compat.js" });
  return out;
}

/** 定时器到点:跑完这一拍(含它内部 await 的 tick),返回此刻待触发的定时器。 */
async function fire(out) {
  const timer = out.timers.shift();
  assert.ok(timer, "应当有一个待触发的定时器");
  await timer.fn();
  return out.timers.slice();
}

test("接线① 扩展名正确、settings 里登记了隐藏设置;setup 没调之前不排轮询、不暴露诊断句柄", () => {
  const out = runMount();
  assert.strictEqual(out.extensions.length, 1, "registerExtension 恰调一次");
  const extension = out.extensions[0];
  assert.strictEqual(extension.name, "my.pcb-link.compat");
  assert.deepStrictEqual(plain(extension.settings), [
    { id: ACTIVATED_SETTING, name: "PCB 连线自动布线已启用(内部标记)", type: "hidden", defaultValue: false },
  ]);
  assert.strictEqual(typeof extension.setup, "function");
  assert.strictEqual(out.deps, null, "setup 之前不建 compat");
  assert.strictEqual(out.timers.length, 0, "setup 没调之前不排轮询");
  assert.strictEqual(out.window.__myPcbLinkCompat, undefined, "setup 没调之前不暴露诊断句柄");
});

test("接线② setup 调过后启动轮询:等插件期 400ms 一拍、满 150 拍放慢到 3000ms 一直等;就绪后 2000ms 一拍;tick 返回 dormant 后不再排下一次", async () => {
  let next = "waiting";
  const out = runMount({ tick: async () => next });
  out.extensions[0].setup();
  assert.deepStrictEqual(out.timers.map((t) => t.ms), [400], "setup 调过后启动了轮询:第一拍 400ms");
  const pump = out.timers[0].fn;

  const step = async (waitTicks) => {
    out.compat.state.waitTicks = waitTicks; // 真 tick 会把这个数加一;这里直接给数
    const pending = await fire(out);
    assert.strictEqual(pending.length, 1, "同一时刻至多一个待触发的定时器(自排队链)");
    return pending[0].ms;
  };
  assert.strictEqual(await step(1), 400);
  assert.strictEqual(await step(149), 400, "第 150 拍之前仍是 400ms");
  assert.strictEqual(await step(150), 3000, "满 150 拍仍未挂钩:放慢到 3000ms");
  assert.strictEqual(await step(650), 3000, "一直等,不封顶(不因为等得久就停)");
  assert.strictEqual(out.timers[0].fn, pump, "每一拍排的都是同一个 pump");

  next = "ready";
  assert.strictEqual(await step(650), 2000, "就绪后 2000ms 一拍(巡检画布有没有换新对象)");
  assert.strictEqual(await step(650), 2000);

  next = "dormant";
  assert.deepStrictEqual(await fire(out), [], "tick 返回 dormant 后不再排下一次");
  assert.strictEqual(out.timers.length, 0);
  await pump(); // 万一还有迟到的一拍:仍是 dormant,照样不排
  assert.strictEqual(out.timers.length, 0);
});

test("接线③ tick 抛错不停表:告警一次,照常排下一拍", async () => {
  let calls = 0;
  const out = runMount({
    tick: async () => {
      calls++;
      throw new Error("tick boom");
    },
  });
  out.extensions[0].setup();
  for (let i = 0; i < 3; i++) {
    const pending = await fire(out);
    assert.deepStrictEqual(pending.map((t) => t.ms), [400], "抛错也照常排下一拍");
  }
  assert.strictEqual(calls, 3);
  assert.strictEqual(out.warned.length, 1, "同一故障只告警一次");
  assert.match(String(out.warned[0][0]), /tick boom|轮询出错/);
});

test("接线④ deps 六样齐全,读的是页面上的真东西(window.__pcb / app.canvas / app.canvas?.graph ?? app.graph)", () => {
  const out = runMount();
  out.extensions[0].setup();
  const deps = out.deps;
  assert.deepStrictEqual(Object.keys(deps).sort(), [
    "activateDefaultMode",
    "getCanvas",
    "getGraph",
    "getPcb",
    "loadRegistry",
    "warnOnce",
  ]);
  for (const key of Object.keys(deps)) assert.strictEqual(typeof deps[key], "function", key);
  assert.strictEqual(deps.getPcb(), null, "window.__pcb 不在 → null");
  assert.strictEqual(deps.getCanvas(), null);
  assert.strictEqual(deps.getGraph(), null);
  const pcb = { PCB: () => PCB_MODE };
  const canvas = { graph: { tag: "canvas-graph" } };
  const root = { tag: "root-graph" };
  out.window.__pcb = pcb;
  out.app.canvas = canvas;
  out.app.graph = root;
  assert.strictEqual(deps.getPcb(), pcb);
  assert.strictEqual(deps.getCanvas(), canvas);
  assert.strictEqual(deps.getGraph(), canvas.graph, "有画布时取画布的图");
  out.app.canvas = null;
  assert.strictEqual(deps.getGraph(), root, "没有画布时退到 app.graph");
});

test("接线⑤ 诊断句柄 window.__myPcbLinkCompat = { version: 1, phase, canvasInfo, aliasInfo, activation }:只读转发", async () => {
  let next = "waiting";
  const state = { phase: "waiting", waitTicks: 0 };
  const out = runMount({ state, tick: async () => (state.phase = next) });
  out.extensions[0].setup();
  const handle = out.window.__myPcbLinkCompat;
  assert.deepStrictEqual(Object.keys(handle).sort(), ["activation", "aliasInfo", "canvasInfo", "phase", "version"]);
  assert.strictEqual(handle.version, 1);
  for (const key of ["phase", "canvasInfo", "aliasInfo", "activation"]) assert.strictEqual(typeof handle[key], "function", key);
  assert.strictEqual(handle.phase(), "waiting");
  next = "ready";
  await fire(out);
  assert.strictEqual(handle.phase(), "ready", "phase 是现读的");
  assert.deepStrictEqual(plain(handle.canvasInfo("W")), { wrapped: true, live: "shim" });
  assert.strictEqual(handle.canvasInfo("other").wrapped, false);
  assert.deepStrictEqual(plain(handle.aliasInfo("R")), { defined: false, resolved: true });
  assert.deepStrictEqual(plain(handle.aliasInfo("D")), { defined: true, resolved: false });
  assert.deepStrictEqual(plain(handle.activation()), { activated: true, mode: 64, defaultMode: 2, reason: "first-run" });
  // 只读:不暴露状态本体,也没有能驱动状态机的入口
  for (const key of ["state", "tick", "compat"]) assert.strictEqual(key in handle, false, `句柄不得暴露 ${key}`);
});

test("接线⑥ warnOnce:同一 msg 只告警一次,不同 msg 各告警一次,带 [my.pcb-link.compat] 前缀与原错误", () => {
  const out = runMount();
  out.extensions[0].setup();
  const warnOnce = out.deps.warnOnce;
  warnOnce("a", new Error("first"));
  warnOnce("a", new Error("second"));
  warnOnce("b", new Error("third"));
  warnOnce("b");
  assert.strictEqual(out.warned.length, 2, "a、b 各一次");
  assert.strictEqual(out.warned[0][0], "[my.pcb-link.compat] a");
  assert.strictEqual(out.warned[0][1].message, "first");
  assert.strictEqual(out.warned[1][0], "[my.pcb-link.compat] b");
  assert.strictEqual(out.warned[1][1].message, "third");
});

test("接线⑦ 默认切到 PCB:设置服务不可用/已激活过/用户手选过 → 不碰 set;首次 → 先切模式(值=window.__pcb.PCB())再置标记", async () => {
  /** 假设置服务:gets / sets 记读写;without 摘掉某个方法(造「服务不全」的形态)。 */
  const fakeSetting = ({ values, defaults = { [MODE_SETTING]: SPLINE }, failOn = null, without = [] } = {}) => {
    const setting = {
      gets: 0,
      sets: [],
      get: (id) => {
        setting.gets++;
        return values[id];
      },
      set: async (id, value) => {
        setting.sets.push([id, value]);
        if (failOn && failOn(id, value)) throw new Error("set boom");
        values[id] = value;
      },
      getDefaultValue: (id) => defaults[id],
    };
    for (const key of without) delete setting[key];
    return setting;
  };
  /** 跑一份薄挂载,挂上设置服务与插件句柄。 */
  const mountSetting = (extensionManager) => {
    const out = runMount();
    out.extensions[0].setup();
    out.app.extensionManager = extensionManager;
    out.window.__pcb = { PCB: () => PCB_MODE };
    out.window.LiteGraph = { SPLINE_LINK: SPLINE };
    return out;
  };
  const activate = (out) => out.deps.activateDefaultMode();

  // 设置服务不可用(四种形态):不读不写,reason=settings-unavailable
  const stuck = { [MODE_SETTING]: SPLINE, [ACTIVATED_SETTING]: true };
  const unavailable = [
    mountSetting(undefined),
    mountSetting({}),
    mountSetting({ setting: fakeSetting({ values: { ...stuck }, without: ["set"] }) }),
    mountSetting({ setting: fakeSetting({ values: { ...stuck }, without: ["get"] }) }),
  ];
  for (const out of unavailable) {
    const before = JSON.stringify(out.app.extensionManager);
    assert.deepStrictEqual(plain(await activate(out)), {
      activated: false,
      mode: null,
      defaultMode: null,
      reason: "settings-unavailable",
    });
    assert.deepStrictEqual(out.resolveCalls, [
      { activated: false, mode: null, defaultMode: null, settingsAvailable: false },
    ]);
    assert.strictEqual(JSON.stringify(out.app.extensionManager), before, "不读不写");
  }

  // 已激活过 / 用户手选过:读了,但一个 set 都不发
  const activated = mountSetting({
    setting: fakeSetting({ values: { [MODE_SETTING]: PCB_MODE, [ACTIVATED_SETTING]: true } }),
  });
  assert.deepStrictEqual(plain(await activate(activated)), {
    activated: true,
    mode: PCB_MODE,
    defaultMode: SPLINE,
    reason: "already-activated",
  });
  assert.strictEqual(activated.app.extensionManager.setting.sets.length, 0);
  assert.deepStrictEqual(activated.resolveCalls, [
    { activated: true, mode: PCB_MODE, defaultMode: SPLINE, settingsAvailable: true },
  ]);

  const chose = mountSetting({
    setting: fakeSetting({ values: { [MODE_SETTING]: 0, [ACTIVATED_SETTING]: false } }),
  });
  assert.deepStrictEqual(plain(await activate(chose)), {
    activated: false,
    mode: 0,
    defaultMode: SPLINE,
    reason: "user-chose",
  });
  assert.strictEqual(chose.app.extensionManager.setting.sets.length, 0);

  // 首次:先切模式(值=window.__pcb.PCB()),再置标记;做完再问一次=已激活,不再写
  const values = { [MODE_SETTING]: SPLINE, [ACTIVATED_SETTING]: false };
  const first = mountSetting({ setting: fakeSetting({ values }) });
  const setting = first.app.extensionManager.setting;
  assert.deepStrictEqual(plain(await activate(first)), {
    activated: true,
    mode: SPLINE,
    defaultMode: SPLINE,
    reason: "first-run",
  });
  assert.deepStrictEqual(setting.sets, [[MODE_SETTING, PCB_MODE], [ACTIVATED_SETTING, true]], "先模式、后标记");
  assert.strictEqual(values[MODE_SETTING], PCB_MODE);
  assert.strictEqual(values[ACTIVATED_SETTING], true);
  assert.deepStrictEqual(plain(await activate(first)), {
    activated: true,
    mode: PCB_MODE,
    defaultMode: SPLINE,
    reason: "already-activated",
  });
  assert.strictEqual(setting.sets.length, 2, "激活过之后不再写");

  // 取不到出厂默认值:与 window.LiteGraph.SPLINE_LINK 比,照样能判首次
  for (const options of [{ defaults: {} }, { without: ["getDefaultValue"] }]) {
    const fallback = mountSetting({
      setting: fakeSetting({ values: { [MODE_SETTING]: SPLINE, [ACTIVATED_SETTING]: false }, ...options }),
    });
    assert.deepStrictEqual(plain(await activate(fallback)), {
      activated: true,
      mode: SPLINE,
      defaultMode: SPLINE,
      reason: "first-run",
    });
  }

  // 置标记那一步失败:错误原样抛出(交给纯逻辑侧告警一次;下次页面加载再试),不谎报已激活
  const failing = mountSetting({
    setting: fakeSetting({
      values: { [MODE_SETTING]: SPLINE, [ACTIVATED_SETTING]: false },
      failOn: (id) => id === ACTIVATED_SETTING,
    }),
  });
  await assert.rejects(activate(failing), /set boom/);
  assert.strictEqual(failing.app.extensionManager.setting.sets.length, 2, "模式那一步已经发出");
});

test("接线⑧ 导入关系与注册表地址:薄挂载静态导入 app 与纯逻辑;注册表模块走上游公布地址的动态 import", () => {
  const importLines = MOUNT_SOURCE.split("\n").filter((line) => /^import\b/.test(line));
  assert.deepStrictEqual(importLines, [
    'import { app } from "/scripts/app.js";',
    'import { createPcbCompat, resolveDefaultMode } from "./my_pcb_link_compat_core.mjs";',
  ]);
  // 与插件自己 import "./pathing/registry.js" 解析到同一个地址 → 同一个模块实例
  assert.match(MOUNT_SOURCE, /import\("\/extensions\/comfyui-pcb\/pathing\/registry\.js"\)/);
  assert.match(MOUNT_SOURCE, /"my\.pcb-link\.compat"/);
});
