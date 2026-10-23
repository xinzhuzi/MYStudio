// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { THEME, PROGRESS_HIGHLIGHT_TOKENS as TOKENS } from "./theme.js";

/**
 * 画布并发运行高亮(0930 TE-MAN 排查 B6 行仿写件,只仿设计:画布侧
 * 「跑到哪几镜」可见;实现全自研)。正在执行的节点描边高亮、完成即褪,
 * 并发多节点同时高亮(异步节点并跑/多任务在途时画布上多处同亮)。
 *
 * 事件面(0930 扒引擎 venv 真前端包 api-*.js 现核,勿按旧文档猜):
 * - executing → detail = display_node || node(节点 id 字符串;0.37 后端
 *   execution.py:496 无「executing:null 收尾」信号,收尾看 status)
 * - progress  → detail = { value, max, prompt_id, node }(main.py:435,
 *   node=real 节点 id;子图内节点在其所在画面内高亮)
 * - executed  → detail = { node, display_node, output, prompt_id }
 * - status    → detail = { exec_info: { queue_remaining } } 或 null(广播,
 *   全引擎事件;queue_remaining=排队+在跑,0 ⟺ 引擎全闲)
 * 描边挂 litegraph node.strokeStyles 函数式槽(渲染循环逐键 call,真身返
 * {color,lineWidth} 即画、undefined 即不画);键名 myProgress 与内置
 * error/selected/running/dragOver/executionError/outputNode 零碰撞。
 *
 * 已知边界(引擎侧事件路由,如实记录):per-node 事件只发提交方 client_id;
 * 画布自己点 Queue 提交→事件回画布,高亮全程有效;App/批量脚本以一次性
 * client_id 提交且无 WebSocket→per-node 事件在服务端被丢弃,画布只见广播
 * status——此时本件退化为「队列清零兜底清扫」,画布侧高亮本就不可能由
 * 任何前端件补出(内置 running 描边同盲)。颜色/尺寸单源:THEME.pending
 * (进行中语义色,与内置绿 #0f0 视觉区分)+ PROGRESS_HIGHLIGHT_TOKENS。
 */
const STYLE_KEY = "myProgress";
const runningIds = new Set(); // 事件口径节点 id(字符串归一)——正在执行集合
let listenersBound = false;

function nodeIdKey(value) {
  if (value === null || value === undefined) return null;
  const key = String(value);
  return key === "null" || key === "undefined" ? null : key;
}

function requestDraw() {
  try {
    app.canvas?.setDirty?.(true, true);
  } catch { /* 画布未就绪:状态已入集合,下一帧自然重绘 */ }
}

function markRunning(id, on) {
  if (id === null) return;
  const before = runningIds.size;
  if (on) runningIds.add(id);
  else runningIds.delete(id);
  if (runningIds.size !== before) requestDraw();
}

function onExecuting(event) {
  markRunning(nodeIdKey(event.detail), true);
}

function onProgress(event) {
  // 带进度节点=铁证在跑(KSampler 等按步汇报;real id 与 executing 的
  // display id 在根图重合,在子图内则点亮子图画面里的内节点)
  markRunning(nodeIdKey(event.detail?.node), true);
}

function onExecuted(event) {
  const detail = event.detail;
  if (!detail) return;
  // display 键清 executing 路径、real 键清 progress 路径——两键同清即褪
  markRunning(nodeIdKey(detail.display_node), false);
  markRunning(nodeIdKey(detail.node), false);
}

function onStatus(event) {
  // 广播兜底:错过的 executed/中断/外部提交者路由丢弃后的滞留清扫
  if (event.detail?.exec_info?.queue_remaining === 0 && runningIds.size > 0) {
    runningIds.clear();
    requestDraw();
  }
}

function onExecutionHalt() {
  // execution_error / execution_interrupted:跑到一半断了,描边不许滞留
  if (runningIds.size > 0) {
    runningIds.clear();
    requestDraw();
  }
}

function attachStroke(node) {
  if (!node?.strokeStyles || node.id === undefined || node.id === null) return;
  if (node.strokeStyles[STYLE_KEY]) return; // nodeCreated 与 setup 清扫双路幂等
  node.strokeStyles[STYLE_KEY] = function () {
    if (!runningIds.has(String(this.id))) return undefined;
    return { color: THEME.pending, lineWidth: TOKENS.lineWidth };
  };
}

app.registerExtension({
  name: "my.progress.highlight",
  setup() {
    // 监听在扩展生命周期内一次性注册:模块级闩防 setup 重入(双守:引擎
    // registerExtension 同名二次会抛错,闩在前静默);页面卸载由前端自身
    // 销毁模块与监听,不留重复注册路径
    if (!listenersBound) {
      listenersBound = true;
      api.addEventListener("executing", onExecuting);
      api.addEventListener("progress", onProgress);
      api.addEventListener("executed", onExecuted);
      api.addEventListener("status", onStatus);
      api.addEventListener("execution_error", onExecutionHalt);
      api.addEventListener("execution_interrupted", onExecutionHalt);
    }
    // setup 早于工作流装载时 graph 为空,此扫为纯防御(双保险不重不漏)
    for (const node of app.graph?._nodes ?? []) attachStroke(node);
  },
  nodeCreated(node) {
    attachStroke(node);
  },
});
