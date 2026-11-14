// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:13323 app.registerExtension / :13439-13651
// beforeRegisterNodeDef 原型链 patch / :13500-13550 onNodeCreated→
// addDOMWidget("minimax_director_ui") 挂载+隐藏 widget 打标 /
// :13333 queuePrompt patch 入队强 flush / onConfigure 三段延迟恢复——
// 布局复刻、代码重写(PRD R3);我方先例 stage-node.js(addDOMWidget 骨架
// 同构,[验尸]C3)。
//
// 导演台面板引擎入口(阶段2 交互接线):识别 MyDirectorConsole→隐藏原生
// timeline_data widget(单通道由面板接管)→addDOMWidget 挂六区容器→
// DaoyanSerial.createController 绑 widget(读=onConfigure 恢复,写=500ms
// 去抖 timeline_data JSON)→组件区渲染(组件七件为 IIFE 挂 window.DaoyanXxx,
// preview/测试同源;本件为唯一 ES module)。
// 交互闭环:任何编辑→apply→去抖 commit→widget.value=JSON;入队前强 flush
// (queuePrompt patch);Ctrl+Z=撤销快照栈(PRD R1.6)。
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import "./serial.js";
import "./toolbar.js";
import "./params.js";
import "./timeline.js";
import "./cards.js";
import "./prompt.js";
import "./live.js";
import "./logs.js";

const NODE_TYPE = "MyDirectorConsole";
const PANEL_DOM_WIDGET_NAME = "daoyan_panel";
// 面板最小高度(AIMixer 钉 680、节点 1000×680 同款语义;用户拉大=面板大)
const PANEL_MIN_HEIGHT = 620;
const NODE_SIZE = [1040, 700];
// onConfigure 恢复延迟(AIMixer 三段延迟恢复的骨架版)
const RESTORE_DELAYS_MS = [0, 80];
// 全部在册控制器(入队前强 flush 用;多导演台节点并存各 flush 各的)
const liveControllers = new Set();
// 节点号→控制器(执行链事件回填路由;1114 阶段3)
const ctrlByNode = new Map();

/** 六区容器壳(引擎侧;preview.html 有等价内联壳,组件区同源) */
function buildShell() {
  const host = document.createElement("div");
  host.className = "daoyan-host";
  host.tabIndex = 0; // 面板可聚焦=Ctrl+Z 键盘撤销可达
  host.innerHTML = [
    '<style id="daoyan-host-style">',
    ".daoyan-host{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:9px;padding:10px 12px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;background:linear-gradient(180deg,rgba(12,18,32,.94),rgba(7,11,20,.97));border-radius:10px;overflow-y:auto;outline:none;}",
    ".daoyan-host *{box-sizing:border-box;}",
    ".daoyan-host .dy-mid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:9px;align-items:stretch;}",
    "@media (max-width:760px){.daoyan-host .dy-mid{grid-template-columns:1fr;}}",
    ".daoyan-host .dy-zone-title{font-size:10px;font-weight:700;letter-spacing:.08em;color:#7d8b9f;margin:2px 2px -3px;}",
    "</style>",
    '<section data-zone="toolbar"></section>',
    '<section data-zone="params"><div class="dy-zone-title">参数</div><div class="dy-zone-body"></div></section>',
    '<section data-zone="timeline"><div class="dy-zone-title">时间线</div><div class="dy-zone-body"></div></section>',
    '<div class="dy-mid">',
    '<section data-zone="cards"><div class="dy-zone-title">素材组卡</div><div class="dy-zone-body"></div></section>',
    '<section data-zone="prompt"><div class="dy-zone-title">提示词</div><div class="dy-zone-body"></div></section>',
    "</div>",
  ].join("");
  return host;
}

/** 组件区渲染(引擎与 preview/测试同一组件同源;ctx=DaoyanSerial 控制器) */
function renderZones(host, ctrl) {
  const zone = (name) => {
    const sec = host.querySelector('[data-zone="' + name + '"]');
    return sec.querySelector(".dy-zone-body") || sec;
  };
  try {
    globalThis.DaoyanToolbar && globalThis.DaoyanToolbar.build(zone("toolbar"), ctrl);
    globalThis.DaoyanParams && globalThis.DaoyanParams.build(zone("params"), ctrl);
    globalThis.DaoyanTimeline && globalThis.DaoyanTimeline.build(zone("timeline"), ctrl);
    globalThis.DaoyanCards && globalThis.DaoyanCards.build(zone("cards"), ctrl);
    globalThis.DaoyanPrompt && globalThis.DaoyanPrompt.build(zone("prompt"), ctrl);
  } catch (err) {
    console.error("[daoyan] 面板渲染失败:", err);
  }
}

/** 挂载面板到节点(onNodeCreated;AIMixer 13500-13550 同构) */
function mountPanel(node) {
  // ① 隐藏原生 timeline_data widget:单通道仍在(widgets_values 序列化
  // 不丢),交互由面板接管(AIMixer applyDirectorWidgetLabels 同构)
  let channel = null;
  for (const w of node.widgets || []) {
    if (w && w.name === "timeline_data") {
      w.hidden = true;
      if (w.type === "text" || w.type === "STRING") w.type = "STRING_HIDDEN";
      channel = w;
    }
  }
  // ② 节点尺寸(AIMixer 钉 [1000,680] 同款;用户拉大=面板大)
  if (node.size && (node.size[0] < NODE_SIZE[0] || node.size[1] < NODE_SIZE[1])) {
    node.size = [NODE_SIZE[0], NODE_SIZE[1]];
  }
  // ③ 控制器:绑 timeline_data widget(读=恢复,写=去抖序列化写回;
  // 阶段2 序列化闭环核心:任何编辑→500ms→widget.value=timeline_data JSON)
  const ctrl = globalThis.DaoyanSerial.createController({
    read: () => (channel ? channel.value : null),
    write: (json) => { if (channel) channel.value = json; },
  });
  liveControllers.add(ctrl);
  if (node.id != null) ctrlByNode.set(node.id, ctrl);
  // ④ addDOMWidget 挂载(我方 stage-node.js / AIMixer 13519-13538 同款)
  const host = buildShell();
  renderZones(host, ctrl);
  // 实时预览宿主绑定(DaoyanLive 事件驱动自渲;1114 缺口③)
  globalThis.DaoyanLive && globalThis.DaoyanLive.bindHost(host);
  node.addDOMWidget(PANEL_DOM_WIDGET_NAME, "daoyan", host, {
    getValue: () => "",
    setValue: () => {},
    getMinHeight: () => PANEL_MIN_HEIGHT,
    hideOnZoom: false,
  });
  // ⑤ 编辑→重渲(订阅);Ctrl+Z=撤销快照栈(PRD R1.6;工具条↩钮同款)
  ctrl.subscribe(() => renderZones(host, ctrl));
  ctrl._host = host; // onConfigure 恢复时按宿主反查控制器
  host.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      ctrl.undo();
    }
  });
  // ⑥ 节点收起态摘要行(PRD R1.6-1「3 组 · 45s · r2v」):收起时画布
  // 只绘标题栏,摘要并入 node.title(常显=展开态也不失读);每次状态
  // 变化/工作流加载恢复时随订阅与 reload 重算
  const refreshSummary = () => {
    try {
      node.title = "导演台 · " + globalThis.DaoyanSerial.summaryLine(ctrl.state);
    } catch (err) { /* 摘要失败不咬面板 */ }
  };
  ctrl.subscribe(refreshSummary);
  refreshSummary();
  node.setDirtyCanvas(true, true);
}

// 入队前强 flush(AIMixer queuePrompt patch :13333 同构):去抖窗口内的
// 未落盘编辑在入队瞬间直写 widget,杜绝「编辑未序列化就跑」
const origQueuePrompt = typeof app.queuePrompt === "function" ? app.queuePrompt.bind(app) : null;
if (origQueuePrompt) {
  app.queuePrompt = function queuePromptWithDaoyanFlush() {
    for (const ctrl of liveControllers) {
      try { ctrl.flush(); } catch (err) { /* 单节点 flush 故障不咬入队 */ }
    }
    return origQueuePrompt.apply(this, arguments);
  };
}

app.registerExtension({
  name: "my.director-console.daoyan",
  setup() {
    // 实时预览事件路由(1114 缺口③:通道先行;发射端=阶段3 执行链,
    // AIMixer minimax_director_preview 同构):payload 见 live.js 头注
    api.addEventListener("daoyan_preview", (e) => {
      globalThis.DaoyanLive && globalThis.DaoyanLive.onSample(e.detail || {});
    });
    // 执行链进度回填(阶段3):running/done 驱动进度条,message/stage 存
    // view(工具条进度文本显示当前阶段消息);终态(全部完成/已取消/失败)
    // 清 running;终态另携 chapter_outputs(章草片/章终片)→apply 回填
    // st.chapter_outputs(gallery 章级行点亮,1114 阶段3.5)
    api.addEventListener("daoyan_progress", (e) => {
      const d = e.detail || {};
      const ctrl = ctrlByNode.get(d.node_id);
      if (!ctrl) return;
      const fin = /全部完成|已取消|失败/.test(String(d.message || ""));
      ctrl.view.running = !fin;
      if (typeof d.done === "number") ctrl.view.done = d.done;
      if (typeof d.total === "number") ctrl.view.total = d.total;
      if (d.message != null) ctrl.view.message = String(d.message);
      if (d.stage != null) ctrl.view.stage = String(d.stage);
      if (d.chapter_outputs && typeof d.chapter_outputs === "object") {
        ctrl.apply((st) => {
          const co = d.chapter_outputs;
          if (co.draft) st.chapter_outputs.draft = String(co.draft);
          if (co.final) st.chapter_outputs.final = String(co.final);
        });
        return;
      }
      ctrl.apply(() => {});
    });
    // 产物落盘回填(阶段3):事件携带逐镜 p1/p2/p3 相对路径→state.artifacts
    // (apply=序列化写回,面板产物槽/总览点亮;1112 批量役检查点同源)
    api.addEventListener("daoyan_artifacts", (e) => {
      const d = e.detail || {};
      const ctrl = ctrlByNode.get(d.node_id);
      if (!ctrl || typeof d.segment_index !== "number") return;
      ctrl.apply((st) => {
        const seg = st.segments[d.segment_index];
        if (!seg) return;
        seg.artifacts = Object.assign(
          { p1: null, p2: null, p3: null }, seg.artifacts || {}, d.artifacts);
      });
    });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== NODE_TYPE) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      try {
        mountPanel(this);
      } catch (err) {
        console.error("[daoyan] 面板挂载失败(不影响节点执行):", err);
      }
      return r;
    };
    // 工作流加载后恢复:widget 值在 configure 期才回填→reload 重读+延迟重渲
    // (AIMixer onConfigure 三段延迟恢复的骨架版)
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      const node = this;
      const widget = node.widgets && node.widgets.find((w) => w && w.name === PANEL_DOM_WIDGET_NAME);
      if (widget && widget.element) {
        for (const delay of RESTORE_DELAYS_MS) {
          setTimeout(() => {
            // 恢复=重读 timeline_data widget 值(外部写入/工作流加载)
            const ctrl = [...liveControllers].find((c) => c._host === widget.element);
            if (ctrl) ctrl.reload();
          }, delay);
        }
      }
      return r;
    };
  },
});
