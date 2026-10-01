// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * qi21 面板联动(qi21-panel-linkage,1001 用户测试批 P3):
 * 装配宿主子图面板上的两组条件控件做纯显隐联动——
 *   ① PE开关=true(PE 自动给画幅)→ 隐藏「手动宽/手动高」;false → 显示;
 *   ② 型选择=「自由」→ 显示「透明」布尔;九型 → 隐藏(透明值由底座件
 *      第六出「透明值」按型 rgba_default 解析,面板布尔只在自由型有意义)。
 * 边界铁律(1001 深夜 d 方案 grill 修正):**只管显隐不管值**——本扩展零
 * 值写入(切九型不覆写面板布尔,自由型手设透明=true 切九型再切回仍在),
 * 值路由全部住在执行层([150] 第六出=型≠自由?rgba_default:透明覆盖);
 * 若未来确需改值,必须走前端 widget setValue/callback 通路(进画布状态),
 * 禁直改 DOM。hidden 是纯 UI 态:不入 widgets_values 序列化,工作流重开
 * 后由本扩展按当前值即时重算(懒加载边界:只动 UI 层,不碰执行语义)。
 *
 * 生效面与兼容:宿主定位=widget 签名(型选择/PE开关/透明/手动宽/手动高
 * 五名同存)∧ 子图名含「提示词类型优化子图」双保险——i2i/edit 旧形态
 * (RGBA透明三态 combo/无手动宽高)签名不齐永不命中,零波及。
 *
 * 实现通路(引擎前端 1.53.6 实物核):LGraphWidget.hidden 官方
 * getter/setter(_state.options.hidden),节点绘制/布局/computeSize 经
 * isWidgetVisible()/getLayoutWidgets() 过滤 hidden;值监听=onWidgetChanged
 * 官方钩子链式包装(即时)+ 400ms 轮询 dirty-check(兜底,先例
 * daojie-subgraph-autofit;覆盖打开工作流/undo/store 投影重建等一切值源,
 * 并在投影对象被重建导致 hidden 丢失时自动重写)。
 */
import { app } from "/scripts/app.js";

// 设计钉死值(探针逐值锁):显隐规则与定位签名的唯一真源
export const QI21_PANEL_LINKAGE_TOKENS = Object.freeze({
  tickMs: 400,                                    // 兜底轮询周期(同 autofit 先例)
  subgraphNameHint: "提示词类型优化子图",           // 宿主子图名/标题共有的锚词
  widgetNames: Object.freeze({
    type: "型选择",                                // combo:九型+自由
    pe: "PE开关",                                  // toggle:true=PE 自动画幅
    alpha: "透明",                                 // toggle:仅自由型显示
    manualW: "手动宽",                             // number:仅 PE 关时显示
    manualH: "手动高",                             // number:仅 PE 关时显示
  }),
  freeType: "自由",                                // 型选择里启用透明布尔的唯一档
});

const attached = new WeakSet();

/** 宿主 widget 组:五名同存才返回组,否则 null(签名即门) */
function readWidgets(node) {
  const by = Object.create(null);
  for (const w of node?.widgets ?? []) {
    if (w && w.name) by[w.name] = w;
  }
  const N = QI21_PANEL_LINKAGE_TOKENS.widgetNames;
  for (const k of ["type", "pe", "alpha", "manualW", "manualH"]) {
    if (!by[N[k]]) return null;
  }
  return {
    type: by[N.type], pe: by[N.pe], alpha: by[N.alpha],
    manualW: by[N.manualW], manualH: by[N.manualH],
  };
}

/** 宿主判定:widget 签名 ∧ 子图名/标题锚词(双保险,宁缺勿错伤) */
function isHost(node) {
  if (!readWidgets(node)) return false;
  const hint = QI21_PANEL_LINKAGE_TOKENS.subgraphNameHint;
  const sgName = String(node.subgraph?.name ?? "");
  const title = String(node.title ?? "");
  return sgName.includes(hint) || title.includes(hint);
}

/** 应用显隐(纯 UI,零值写):返回是否有变化 */
function applyLinkage(node) {
  const q = readWidgets(node);
  if (!q) return false;
  const alphaHidden = String(q.type.value) !== QI21_PANEL_LINKAGE_TOKENS.freeType;
  const manualHidden = q.pe.value === true;
  let dirty = false;
  const set = (w, hidden) => {
    if (w.hidden !== hidden) { w.hidden = hidden; dirty = true; }
  };
  set(q.alpha, alphaHidden);
  set(q.manualW, manualHidden);
  set(q.manualH, manualHidden);
  if (dirty) {
    try { node.computeSize?.(); } catch { /* 布局兜底失败不阻塞显隐 */ }
    node.setDirtyCanvas?.(true, true);
  }
  return dirty;
}

/** 附着:链式包装 onWidgetChanged(即时联动),幂等(重复 attach 零双层) */
function attach(node) {
  attached.add(node);
  const prev = node.onWidgetChanged;
  if (typeof prev === "function" && prev.__qi21PanelLinkage) return;
  const wrapped = function (name, value, oldValue, widget) {
    try { prev?.call(this, name, value, oldValue, widget); } catch { /* 原钩子异常不吞联动 */ }
    try { applyLinkage(this); } catch { /* 联动失败不阻塞宿主 */ }
  };
  wrapped.__qi21PanelLinkage = true;
  node.onWidgetChanged = wrapped;
  applyLinkage(node); // 发现即首轮应用(打开工作流自恢复显隐)
}

app.registerExtension({
  name: "my.qi21.panel.linkage",
  setup() {
    const tick = () => {
      try {
        for (const node of app.graph?._nodes ?? []) {
          if (attached.has(node)) {
            applyLinkage(node); // 兜底:store 投影重建等场景 hidden 丢失即重写
          } else if (isHost(node)) {
            attach(node);       // 发现即附着+首轮应用(打开工作流自恢复)
          }
        }
      } catch { /* 轮询单轮失败静默,下轮再来 */ }
    };
    tick();
    const timer = setInterval(tick, QI21_PANEL_LINKAGE_TOKENS.tickMs);
    addEventListener("pagehide", () => clearInterval(timer), { once: true });
  },
});
