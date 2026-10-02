// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md available.
/**
 * qi21 面板联动(qi21-panel-linkage,1001 用户测试批 P3 立;1002 大轮重锚):
 * 装配宿主子图面板上的两组条件控件做纯显隐联动——
 *   ① PE启用?=true(PE 自动给画幅;锚=子图内 [4012] PrimitiveBoolean 的宿主
 *      外露 widget,1002 ㉑ 节点化)→ 隐藏「手动宽/手动高」;false → 显示;
 *   ② 型选择=「自由」→ 显示「透明」布尔;九型 → 隐藏(透明值由底座件
 *      [4010] 出「透明值」按型解析,面板布尔只在自由型有意义)。
 *   ③ PE启用? 联动 [4020] PE思考预览件执行图参与(1002 修复轮):PE 开→
 *      mode0(画布可看推理,Q5);PE 关→mode4(旁路,[4013] 连带剪枝=懒执行
 *      铁律两全;真源静态默认=4 保守,详见 syncThinkingPreviewMode 注)。
 * 边界铁律:**只管显隐不管值**——零值写入,值路由全在执行层;hidden 是纯
 * UI 态,不入 widgets_values 序列化,重开工作流由本扩展按当前值重算。
 *
 * ⑲ 闪现修复(1002 大轮,定位=扩展显隐与前端缩放重绘路径竞态):
 *   - 显隐写(hidden)与布局(computeSize/setDirtyCanvas)**分离**:写 hidden
 *     即时,布局改动合并防抖(trailing 200ms)——缩放期间反复触发只落一次
 *     布局,消灭 combo 选择框闪现(4个/2个)的重复重绘路径;
 *   - 画布缩放静默窗:canvas scale 变化后 400ms 内布局腿让路(缩放中的
 *     computeSize 是闪现放大器);显隐值本身仍即时保持。
 * 生效面与兼容:宿主定位=widget 签名(型选择/PE启用?/透明/手动宽/手动高
 * 五名同存)∧ 子图名含「文本提示词类型优化子图」双保险。
 */
import { app } from "/scripts/app.js";

// 设计钉死值(探针逐值锁):显隐规则与定位签名的唯一真源
export const QI21_PANEL_LINKAGE_TOKENS = Object.freeze({
  tickMs: 400,                                    // 兜底轮询周期(同 autofit 先例)
  debounceMs: 200,                                // ⑲ 布局腿防抖(1002 大轮)
  zoomQuietMs: 400,                               // ⑲ 缩放静默窗(1002 大轮)
  subgraphNameHint: "文本提示词类型优化子图",       // 宿主子图名锚(1002 ⑬ 更名)
  peNodeAnchor: "[4012]",                          // PE启用? 节点锚(1002 ㉑)
  thinkNodeTitleHint: "PE思考",                     // ③ thinking 预览件 title 锚([4020])
  widgetNames: Object.freeze({
    type: "型选择",                                // combo:九型+自由
    pe: "PE启用?",                                 // toggle:true=PE 自动画幅([4012] 外露)
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

// ⑲:布局腿防抖(每节点一份 pending;缩放静默期内推迟)
const layoutTimers = new WeakMap();
let lastScale = null;
let lastScaleAt = 0;

function zoomQuiet() {
  try {
    const s = app.canvas?.ds?.scale;
    if (typeof s === "number" && s !== lastScale) {
      lastScale = s;
      lastScaleAt = performance.now();
    }
    return performance.now() - lastScaleAt < QI21_PANEL_LINKAGE_TOKENS.zoomQuietMs;
  } catch { return false; }
}

function scheduleLayout(node) {
  if (layoutTimers.has(node)) return;
  const t = setTimeout(() => {
    layoutTimers.delete(node);
    if (zoomQuiet()) { scheduleLayout(node); return; }  // 缩放中=再让一拍
    try { node.computeSize?.(); } catch { /* 布局兜底失败不阻塞显隐 */ }
    node.setDirtyCanvas?.(true, true);
  }, QI21_PANEL_LINKAGE_TOKENS.debounceMs);
  layoutTimers.set(node, t);
}

/** 应用显隐(纯 UI,零值写;⑲:hidden 即时/布局防抖):返回是否有变化 */
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
  if (dirty) scheduleLayout(node);   // ⑲:布局腿防抖(不再同步 computeSize)
  syncThinkingPreviewMode(node, q.pe.value === true);
  return dirty;
}

/**
 * ③ thinking 预览件执行图联动(1002 修复轮,Q5×懒执行铁律两全):
 * [4020] PE思考·showAnything 为 OUTPUT_NODE 显示件——常驻(mode0)会在
 * PE 关时强拉 [4013] PE改写器(违「pe关=零执行零装载」铁律,refire s6
 * 实弹坐实 6:4013=true);恒旁路(mode4)则画布永远看不到推理文本(Q5 落空)。
 * 两全=随 PE启用? 切执行图参与:PE 开(默认)→mode0(可见,thinking=PE
 * 调用副产物零额外成本);PE 关→mode4(旁路,[4013] 连带剪枝零装载)。
 * 真源静态默认=4(无前端/API 直构场景保守零强拉);本扩展在前端打开/
 * 切换时按当前值归位。mode=节点执行态开关,非 widget 值——「只管显隐
 * 不管值」铁律的执行对偶(值路由仍在执行层,零值写入)。
 * 路径实证(2026-10-02 引擎 1.53 CDP):host.subgraph 本体=LGraph,内节
 * 点=host.subgraph._nodes;mode 4↔0 切换 graphToPrompt 出/入 6:4020 确定性。
 */
function syncThinkingPreviewMode(host, peOn) {
  try {
    const inner = host?.subgraph?._nodes;
    if (!Array.isArray(inner)) return;
    const want = peOn ? 0 : 4;
    for (const n of inner) {
      if (n && n.type === "easy showAnything"
          && String(n.title ?? "").includes(QI21_PANEL_LINKAGE_TOKENS.thinkNodeTitleHint)
          && n.mode !== want) {
        n.mode = want;
      }
    }
  } catch { /* 联动失败不阻塞宿主 */ }
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
