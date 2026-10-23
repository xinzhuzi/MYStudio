// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 双击自动连最近兼容口(0930 TE-MAN 排查 B8 行仿写件,只仿设计:双击
 * 输出口→全图「类型兼容且空闲」的输入口里选几何最近者自动 connect,
 * 大图连线提速;实现全自研,零改 ComfyUI 本体)。
 *
 * 手势契约(只增强不劫持):本件是画布元素原生 dblclick 的纯观察者——
 * 不阻止默认行为、不截停事件传播、不 patch 任何原型;双击节点本体/
 * 输入口/空白的原生行为零改变,双击输出口的原生行为(起拖连线+可选
 * onOutputDblClick 钩)也照常,本件只在其上追加一次 connect。引擎自身
 * 的双击判定在 Pointer 类按时间戳自算(isDouble),与 DOM dblclick 互不
 * 干扰;真前端包自研代码唯一的 dblclick 监听在 DOM widget 文本编辑,
 * 画布上无此监听=零撞车。
 *
 * API 面(0930 扒引擎 venv 真前端包现核,勿按旧文档猜):
 * - 输出槽命中矩形=引擎 _processNodeClick 同款 isInRectangle(x, y,
 *   pos[0]-15, pos[1]-10, 30, 20),边界左上含右下不含(pos 取
 *   node.getOutputPos(slot));
 * - 命中次序=渲染序倒扫(引擎 getNodeOnPos 同向:后画者=最上层先中);
 * - 坐标换算=app.canvas.convertEventToCanvasOffset(event)(引擎自法:
 *   getBoundingClientRect + convertCanvasToOffset);
 * - 类型兼容=window.LiteGraph.isValidConnection(引擎类型槽语义单源:
 *   空串/"*" 通配、等值大小写不敏感、逗号多型递归;该全局与 connect
 *   内部判型同一对象,GraphView 挂载期赋值——画布可交互时必已就位);
 * - 连线=引擎公共 node.connect(slot, targetNode, targetSlot)——原生
 *   拖拽落点走同一方法:connectSlots 内 isValidConnection 权威复裁、
 *   onConnectionsChange 双侧通知、beforeChange/afterChange 与图版本
 *   递增(脏标记/撤销面)全由引擎自身走,本件零额外通知。
 *
 * 已选与未选(如实):
 * - 「空闲」=input.link == null(槽上已连线者永不被动,本件不做替换);
 * - 源节点自身输入不参选(connect 对「目标=源」恒拒,引擎语义);
 * - 无兼容空闲口=静默不动(不弹窗不 toast);
 * - 扫描面=当前显示图 app.canvas.graph._nodes(引擎 getCurrentGraph 同源:
 *   openSubgraph→setGraph 只切 canvas.graph,app.graph 的 getter 恒返根图
 *   rootGraphInternal 不可作扫描面——否则与 convertEventToCanvasOffset 的
 *   当前视口(子图)域坐标跨域错配:子图内双击恒不中、根图坐标数值重合时
 *   还会在根图连出子图画面完全看不见的线);
 * - window.LiteGraph 意外缺席时兜底=保守等值判型(结构性不可达的防御
 *   位),connect 仍是最终权威。
 * 引擎实弹延期(本轮零引擎约束:未 sync_my_nodes 未装机未打包)。
 */
const OUTPUT_HIT = { x: -15, y: -10, w: 30, h: 20 };
let listenerBound = false;

function typesCompatible(outputType, inputType) {
  const litegraph = window.LiteGraph;
  const check = litegraph?.isValidConnection;
  if (typeof check === "function") {
    return !!check.call(litegraph, outputType, inputType);
  }
  return String(outputType ?? "") === String(inputType ?? "");
}

function insideOutputRect(px, py, pos) {
  return px >= pos[0] + OUTPUT_HIT.x && px < pos[0] + OUTPUT_HIT.x + OUTPUT_HIT.w
    && py >= pos[1] + OUTPUT_HIT.y && py < pos[1] + OUTPUT_HIT.y + OUTPUT_HIT.h;
}

function findOutputSlotAt(nodes, x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node?.outputs?.length || typeof node.getOutputPos !== "function") continue;
    for (let slot = 0; slot < node.outputs.length; slot++) {
      const pos = node.getOutputPos(slot);
      if (pos && insideOutputRect(x, y, pos)) return { node, slot, pos };
    }
  }
  return null;
}

function findNearestFreeInput(nodes, sourceNode, outputType, fromPos) {
  let best = null;
  for (const node of nodes) {
    if (node === sourceNode || !node?.inputs?.length || typeof node.getInputPos !== "function") continue;
    for (let slot = 0; slot < node.inputs.length; slot++) {
      const input = node.inputs[slot];
      if (!input || input.link != null) continue; // 空闲过滤:已连线槽不参选
      if (!typesCompatible(outputType, input.type)) continue;
      const pos = node.getInputPos(slot);
      if (!pos) continue;
      const dx = pos[0] - fromPos[0];
      const dy = pos[1] - fromPos[1];
      const dist = dx * dx + dy * dy;
      if (best === null || dist < best.dist) best = { node, slot, dist };
    }
  }
  return best;
}

function onCanvasDblClick(event) {
  try {
    // 扫描面=当前显示图:引擎开子图走 openSubgraph→setGraph,只切
    // canvas.graph 不切 app.graph(其 getter 恒返根图 rootGraphInternal);
    // 而 convertEventToCanvasOffset 出的是当前视口(子图)域坐标——扫描面
    // 必须同取 canvas.graph 才与坐标同域,旧取 app.graph 属跨域比较(子图
    // 内恒不中+根图数值重合时误连)。canvas 意外缺 graph 位时保守回根图。
    const graph = app.canvas?.graph ?? app.graph;
    const nodes = graph?._nodes;
    if (!nodes?.length || typeof app.canvas?.convertEventToCanvasOffset !== "function") return;
    const point = app.canvas.convertEventToCanvasOffset(event);
    const hit = findOutputSlotAt(nodes, point[0], point[1]);
    if (!hit) return; // 双击输入口/节点本体/空白:零动作
    const outputType = hit.node.outputs[hit.slot]?.type;
    const target = findNearestFreeInput(nodes, hit.node, outputType, hit.pos);
    if (!target) return; // 无兼容空闲口:静默不动(不弹窗)
    hit.node.connect(hit.slot, target.node, target.slot);
  } catch { /* 增强件兜底:任何异常绝不打断画布原生双击链 */ }
}

app.registerExtension({
  name: "my.dblclick.connect.nearest",
  setup() {
    // 模块级闩一次性绑定(引擎自身也用 canvas.canvas 的 DOM 事件位,如
    // litegraph:set-graph);页面卸载由前端自身销毁,不留重复注册路径
    if (listenerBound) return;
    const el = app.canvas?.canvas;
    if (!el?.addEventListener) return;
    listenerBound = true;
    el.addEventListener("dblclick", onCanvasDblClick);
  },
});
