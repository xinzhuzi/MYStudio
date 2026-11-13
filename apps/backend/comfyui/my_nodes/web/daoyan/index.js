// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:13323 app.registerExtension / :13439-13651
// beforeRegisterNodeDef 原型链 patch / :13500-13550 onNodeCreated→
// addDOMWidget("minimax_director_ui") 挂载+隐藏 widget 打标 / :13612-13650
// onConfigure 延迟恢复——布局复刻、代码重写(PRD R3);我方先例
// stage-node.js(41K)addDOMWidget 骨架同构([验尸]C3)。
//
// 导演台面板引擎入口(阶段1 静态骨架):识别 MyDirectorConsole→隐藏原生
// timeline_data widget(单通道由面板接管)→addDOMWidget 挂六区容器→组件
// 渲染。组件六件(serial/params/timeline/cards/prompt/toolbar)为 IIFE 挂
// window.DaoyanXxx(无 import/export 语法,file:// preview.html 双轨直开同源
// 渲染,design §0 对冲);本件为唯一 ES module(引擎 /scripts/app.js 依赖)。
// 布局六区对标 design §2 / PRD R2:业务条+输出条(1113 阶段1.5 补丁①:
// 输出条独立渲染于业务条下方,PRD R1.6)/参数折叠/时间线/素材组卡/提示词
// 编辑。
import { app } from "/scripts/app.js";
import "./serial.js";
import "./toolbar.js";
import "./params.js";
import "./timeline.js";
import "./cards.js";
import "./prompt.js";

const NODE_TYPE = "MyDirectorConsole";
const PANEL_DOM_WIDGET_NAME = "daoyan_panel";
// 面板最小高度(AIMixer 钉 680、节点 1000×680 同款语义;用户拉大=面板大)
const PANEL_MIN_HEIGHT = 620;
const NODE_SIZE = [1040, 700];
// onConfigure 恢复延迟(AIMixer 三段延迟恢复的骨架版;全量时序对抗排阶段2)
const RESTORE_DELAYS_MS = [0, 80];

/** 六区容器壳(引擎侧;preview.html 有等价内联壳,组件区同源) */
function buildShell() {
  const host = document.createElement("div");
  host.className = "daoyan-host";
  host.innerHTML = [
    '<style id="daoyan-host-style">',
    ".daoyan-host{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:9px;padding:10px 12px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;background:linear-gradient(180deg,rgba(12,18,32,.94),rgba(7,11,20,.97));border-radius:10px;overflow-y:auto;}",
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

/** 组件区渲染(引擎与 preview.html 同一组件同源) */
function renderZones(host, node) {
  const serial = globalThis.DaoyanSerial;
  const state = serial && node ? (serial.readTimelineWidget(node) || null) : null;
  const zone = (name) => {
    const sec = host.querySelector('[data-zone="' + name + '"]');
    return sec.querySelector(".dy-zone-body") || sec;
  };
  try {
    globalThis.DaoyanToolbar && globalThis.DaoyanToolbar.build(zone("toolbar"), state);
    globalThis.DaoyanParams && globalThis.DaoyanParams.build(zone("params"), state);
    globalThis.DaoyanTimeline && globalThis.DaoyanTimeline.build(zone("timeline"), state);
    globalThis.DaoyanCards && globalThis.DaoyanCards.build(zone("cards"), state);
    globalThis.DaoyanPrompt && globalThis.DaoyanPrompt.build(zone("prompt"), state);
  } catch (err) {
    console.error("[daoyan] 面板渲染失败(阶段1 静态骨架):", err);
  }
}

/** 挂载面板到节点(onNodeCreated;AIMixer 13500-13550 同构) */
function mountPanel(node) {
  // ① 隐藏原生 timeline_data widget:单通道仍在(widgets_values 序列化
  // 不丢),交互由面板接管(AIMixer applyDirectorWidgetLabels 同构)
  for (const w of node.widgets || []) {
    if (w && w.name === "timeline_data") {
      w.hidden = true;
      if (w.type === "text" || w.type === "STRING") w.type = "STRING_HIDDEN";
    }
  }
  // ② 节点尺寸(AIMixer 钉 [1000,680] 同款;用户拉大=面板大)
  if (node.size && (node.size[0] < NODE_SIZE[0] || node.size[1] < NODE_SIZE[1])) {
    node.size = [NODE_SIZE[0], NODE_SIZE[1]];
  }
  // ③ addDOMWidget 挂载(我方 stage-node.js / AIMixer 13519-13538 同款)
  const host = buildShell();
  renderZones(host, node);
  node.addDOMWidget(PANEL_DOM_WIDGET_NAME, "daoyan", host, {
    getValue: () => "",
    setValue: () => {},
    getMinHeight: () => PANEL_MIN_HEIGHT,
    hideOnZoom: false,
  });
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "my.director-console.daoyan",
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
    // 工作流加载后恢复(AIMixer onConfigure 三段延迟恢复的骨架版:
    // widget 值在 configure 期才回填,延迟重读重渲染;全量对抗排阶段2)
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      const node = this;
      const widget = node.widgets && node.widgets.find((w) => w && w.name === PANEL_DOM_WIDGET_NAME);
      if (widget && widget.element) {
        for (const delay of RESTORE_DELAYS_MS) {
          setTimeout(() => renderZones(widget.element, node), delay);
        }
      }
      return r;
    };
  },
});
