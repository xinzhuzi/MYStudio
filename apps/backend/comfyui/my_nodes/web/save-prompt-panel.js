// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 存图节点底部 prompt 面板 canvas 自绘件(1001 TE-MAN B7 子件①仿写件)。
 * 后端 MyImageSave(核心 SaveImage 子类)执行时 ui.myPrompt 单元素列表回传
 * (引擎 ui 契约:每个 ui 值被列表扁平化,元素=扁平 dict),onExecuted 接住
 * 存进 properties.mySavePrompt(随工作流保存/重开复原)——状态永驻
 * properties,禁走 widgets_values(序列化契约零影响)。
 * 交互范式=仓内三板斧:beforeRegisterNodeDef 五钩子(onNodeCreated/
 * onExecuted/onResize/onSerialize/onConfigure)+ {type:"custom",
 * serialize:false, computeSize} 占位 widget + onDrawBackground 实绘
 * (样板=my-image-ab-compare.js 同款)。
 * 面板行为:折行显示(默认折叠 2 行+省略号,展开 30 行封顶,全文恒可复制);
 * 双击复制全文(widget.mouse 按时间戳自算双击——canvas 元素上的双击已被
 * dblclick-connect-nearest.js 占用语义面,且 widget 层无 DOM dblclick 事件,
 * 引擎 Pointer 类同款手法);头行单击切折叠(双击头行=第二击翻回+复制,
 * 净零折叠漂移)。
 */

// ── tokens(设计单源位=theme.js;本轮 ①②③ 并行实现文件面互斥,theme.js
//    不在本件可写面——先模块内单源导出,归并轮统一迁 theme.js 消费)──
export const SAVE_PROMPT_PANEL_TOKENS = {
  minW: 320,            // 节点宽下限(px;面板再窄没法读)
  pad: 10,              // 面板外边距(px)
  minFace: 40,          // 面板宽退化下限(px;防负几何)
  headerH: 20,          // 面板头行高(px;「提示词 N字 ⌄」)
  lineH: 17,            // 正文行高(px;折行显示)
  collapseLines: 2,     // 折叠态显示行数(设计钉死)
  maxLines: 30,         // 展开上限行数(设计钉死;超出行数截断,全文恒可复制)
  dblClickMs: 350,      // 双击判定窗(ms;两次 down 间隔)
  dblClickSlop: 5,      // 双击位移容差(px;超距视为两次单击)
  copiedFlashMs: 1500,  // 「已复制」头行闪示时长(ms)
  toastMs: 1500,        // DOM toast 消隐时长(ms)
  ellipsis: "…",        // 截断省略号
  font: "12px sans-serif",
  headerFont: "600 11px sans-serif",
  colors: {
    panelBg: "rgba(0, 0, 0, 0.32)",
    panelBorder: "rgba(255, 255, 255, 0.10)",
    headerText: "rgba(240, 244, 250, 0.94)",
    bodyText: "rgba(226, 232, 240, 0.92)",
    dimText: "rgba(178, 188, 204, 0.85)",
    copied: "#34d399",   // 「已复制 ✓」闪示色
  },
};

const TOKENS = SAVE_PROMPT_PANEL_TOKENS;
const PANEL_WIDGET_NAME = "my_save_prompt_panel";

// ── 折行纯函数(探针直测面;measure=ctx.measureText 注入,零画布依赖)──

/** CJK 判定:中日韩统一表意/注音·假名/CJK 符号点号/兼容表意/全角形/
 *  扩展 B 以后——逐字可断;余(西文)按词不可断。 */
const isCJK = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)
    || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)
    || (c >= 0x20000 && c <= 0x2fa1f);
};

/** 分词:CJK 单字=独立单元;西文连续非空白=整词单元(不可断);空白单列
 *  (行首丢弃/换行吞掉,行尾暂挂随下一次测量)。 */
const tokenize = (text) => {
  const tokens = [];
  let word = "";
  const flush = () => { if (word) { tokens.push(word); word = ""; } };
  for (const ch of text) {
    if (isCJK(ch)) { flush(); tokens.push(ch); }
    else if (ch === " " || ch === "\t") { flush(); tokens.push(ch); }
    else { word += ch; }
  }
  flush();
  return tokens;
};

/** 折行:显式 \n 保留;贪心装行(CJK 逐字/西文按词);单个超 maxWidth 的
 *  词独占一行(不截字,溢出由画布裁切);空文→单条空行。 */
export function wrapText(text, maxWidth, measure) {
  const m = (s) => Number(measure?.(s)?.width) || 0;
  const wrapPara = (para) => {
    const lines = [];
    let line = "";
    for (const t of tokenize(para)) {
      if (t === " " || t === "\t") {
        if (line === "") continue;  // 行首空白丢弃
        line += t;                  // 暂挂行尾(换行时吞掉)
        continue;
      }
      if (line === "" || m(line + t) <= maxWidth) { line += t; continue; }
      lines.push(line.replace(/[ \t]+$/, ""));
      line = t;
    }
    if (line !== "") lines.push(line.replace(/[ \t]+$/, ""));
    return lines;
  };
  const out = [];
  for (const para of String(text ?? "").split("\n")) out.push(...wrapPara(para));
  return out.length ? out : [""];
}

/** 显示截断(纯函数):折好行按折叠/展开预算截断;truncated=有被截掉的行
 *  (画布画省略号;全文恒可复制与显示截断无关)。 */
export function clipLines(lines, collapsed) {
  const all = Array.isArray(lines) ? lines : [];
  const limit = collapsed ? TOKENS.collapseLines : TOKENS.maxLines;
  if (all.length <= limit) return { lines: all.slice(), truncated: false };
  return { lines: all.slice(0, limit), truncated: true };
}

// ── 状态(properties.mySavePrompt;缺省+归一,引用恒稳不换)────────────

const DEFAULT_STATE = () => ({ text: "", chars: 0, collapsed: true, copiedAt: 0 });

const ensureState = (node) => {
  const props = node.properties || (node.properties = {});
  const state = props.mySavePrompt || (props.mySavePrompt = DEFAULT_STATE());
  state.text = typeof state.text === "string" ? state.text : "";
  state.chars = Number.isFinite(state.chars) ? state.chars : state.text.length;
  state.collapsed = Boolean(state.collapsed);
  state.copiedAt = Number.isFinite(state.copiedAt) ? state.copiedAt : 0;
  return state;
};

// ── 复制与 toast(DOM 悬浮层挂 body,不嵌画布 DOM)────────────────────

/** 复制双路:navigator.clipboard 主路(引擎内 window.navigator;探针桩
 *  window 位);缺席/拒绝→隐藏 textarea+execCommand 兜底(clipboard 权限
 *  面 B7 设计钉死)。 */
const copyText = async (text) => {
  try {
    const nav = (typeof window !== "undefined" && window?.navigator)
      || (typeof navigator !== "undefined" ? navigator : null);
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch (error) { /* 落兜底路 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch (error) { return false; }
};

const toast = (message) => {
  if (typeof document === "undefined" || !document.body) return;
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;"
    + "padding:8px 14px;border-radius:8px;background:rgba(10,14,24,0.88);"
    + "color:rgba(240,244,250,0.95);font-size:12px;pointer-events:none;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), TOKENS.toastMs);
};

const flashCopied = (node, state, ok) => {
  state.copiedAt = ok ? Date.now() : 0;
  toast(ok ? `已复制 ${state.chars} 字` : "复制失败——剪贴板不可用");
  if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
};

const copyFullText = (node, state) => {
  const text = state.text;
  if (!text) { toast("面板暂无 prompt 全文"); return; }
  copyText(text).then((ok) => flashCopied(node, state, ok))
    .catch(() => flashCopied(node, state, false));
};

// ── 面板几何与绘制 ────────────────────────────────────────────────────

const panelWidgetOf = (node) =>
  (node.widgets || []).find((w) => w?.name === PANEL_WIDGET_NAME) || null;

/** 面板顶=占位 widget 运行时实值 y(0930 B2 修:节点内动态布局禁常量猜,
 *  读排布真源 w.y/last_y;首排布前未赋值→null 让位不画,排布落定自动显)。 */
const panelTopFor = (node) => {
  const w = panelWidgetOf(node);
  if (!w) return null;
  if (Number.isFinite(w.y) && w.y > 0) return w.y;
  if (Number.isFinite(w.last_y) && w.last_y > 0) return w.last_y;
  return null;
};

/** 显示行预算(占位 widget computeSize 与实绘共用同一真源;截断省略行
 *  额外占一行;展开态折行缓存未建时按折叠预算兜首排布)。 */
const lineBudgetFor = (node, state) => {
  const total = node.__mySaveWrap?.lines?.length || 0;
  const limit = state.collapsed ? TOKENS.collapseLines : TOKENS.maxLines;
  if (total <= 0) return TOKENS.collapseLines;
  return Math.min(total, limit) + (total > limit ? 1 : 0);
};

const panelHeightFor = (node, state) =>
  TOKENS.headerH + lineBudgetFor(node, state) * TOKENS.lineH + TOKENS.pad;

const roundBox = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const drawPanel = (node, ctx) => {
  const state = ensureState(node);
  const top = panelTopFor(node);
  if (top == null) return;
  const w = panelWidgetOf(node);
  const height = Number.isFinite(w.computedHeight) && w.computedHeight > 0
    ? w.computedHeight : panelHeightFor(node, state);
  const box = {
    x: TOKENS.pad, y: top,
    w: Math.max(node.size[0] - TOKENS.pad * 2, TOKENS.minFace),
    h: height,
  };
  const C = TOKENS.colors;
  ctx.save();
  try {
    roundBox(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 8);
    ctx.fillStyle = C.panelBg;
    ctx.fill();
    ctx.strokeStyle = C.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 折行缓存(宽度/文本敏感;onExecuted/换宽即失效重建)
    ctx.font = TOKENS.font;
    const innerW = box.w - TOKENS.pad * 2;
    const cache = node.__mySaveWrap;
    if (!cache || cache.width !== innerW || cache.text !== state.text) {
      node.__mySaveWrap = {
        width: innerW, text: state.text,
        lines: wrapText(state.text, innerW, (s) => ctx.measureText(s)),
      };
    }
    const shown = clipLines(node.__mySaveWrap.lines, state.collapsed);

    // 头行:「提示词 N字 ⌄/›」+右侧「双击复制/已复制 ✓」
    const copied = Date.now() - state.copiedAt < TOKENS.copiedFlashMs;
    ctx.font = TOKENS.headerFont;
    ctx.fillStyle = C.headerText;
    const headY = box.y + 14;
    ctx.fillText(
      `提示词 ${state.chars} 字 ${state.collapsed ? "›" : "⌄"}`,
      box.x + TOKENS.pad, headY);
    const hint = copied ? "已复制 ✓" : "双击复制";
    ctx.fillStyle = copied ? C.copied : C.dimText;
    ctx.fillText(hint, box.x + box.w - TOKENS.pad - ctx.measureText(hint).width, headY);

    // 正文:空态提示 / 折行文本(+截断省略行)
    ctx.font = TOKENS.font;
    ctx.fillStyle = C.bodyText;
    if (!state.text) {
      ctx.fillStyle = C.dimText;
      ctx.fillText("接 prompt_text 后执行,此处显示 prompt 全文",
        box.x + TOKENS.pad, box.y + TOKENS.headerH + 14);
    } else {
      const baseY = box.y + TOKENS.headerH + TOKENS.lineH - 4;
      shown.lines.forEach((line, i) => {
        ctx.fillText(line, box.x + TOKENS.pad, baseY + i * TOKENS.lineH);
      });
      if (shown.truncated) {
        const total = node.__mySaveWrap.lines.length;
        ctx.fillStyle = C.dimText;
        const tail = `${TOKENS.ellipsis} 共 ${total} 行,双击复制全文`
          + (state.collapsed ? ",单击头行展开" : "");
        ctx.fillText(tail, box.x + TOKENS.pad,
          baseY + shown.lines.length * TOKENS.lineH);
      }
    }

    // 命中矩形缓存(头行=折叠开关;整体=双击复制带;供 widget.mouse)
    node.__mySaveHits = {
      header: { x: box.x, y: box.y, w: box.w, h: TOKENS.headerH },
      body: { x: box.x, y: box.y + TOKENS.headerH, w: box.w, h: box.h - TOKENS.headerH },
      panel: box,
    };
  } finally {
    ctx.restore();
  }
};

/** widget.mouse 派发(e=pointer 原生事件,pos=节点本地坐标);返回 true=消费。
 *  双击=两次 down 间隔<dblClickMs 且位移<dblClickSlop(引擎 Pointer 类同款
 *  自算,勿依赖 DOM dblclick);面板外=不消费(事件照常还给画布)。 */
const panelMouse = (node, e, pos) => {
  const hits = node.__mySaveHits;
  if (!hits || !pos) return false;
  const kind = String(e?.type ?? "");
  if (!kind.includes("down")) return false;
  const inHeader = pos[0] >= hits.header.x && pos[0] <= hits.header.x + hits.header.w
    && pos[1] >= hits.header.y && pos[1] <= hits.header.y + hits.header.h;
  const inBody = pos[0] >= hits.body.x && pos[0] <= hits.body.x + hits.body.w
    && pos[1] >= hits.body.y && pos[1] <= hits.body.y + hits.body.h;
  if (!inHeader && !inBody) return false;
  const state = ensureState(node);
  const t = Number(e?.timeStamp ?? Date.now());
  const last = node.__mySaveLastDown;
  node.__mySaveLastDown = { t, x: pos[0], y: pos[1] };
  const isDouble = Boolean(last && t >= last.t && t - last.t < TOKENS.dblClickMs
    && Math.abs(pos[0] - last.x) < TOKENS.dblClickSlop
    && Math.abs(pos[1] - last.y) < TOKENS.dblClickSlop);
  if (isDouble) {
    // 头行双击=第二击把第一击的折叠翻回去(净零漂移)再复制;体内双击=纯复制
    if (inHeader) state.collapsed = !state.collapsed;
    copyFullText(node, state);
    return true;
  }
  if (inHeader) {
    state.collapsed = !state.collapsed;
    node.__mySaveWrap = null;  // 预算变→占位高度随 computeSize 重排
    if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    return true;
  }
  return true;  // 体内单击=消费不外溢(不与画布手势抢事件)
};

app.registerExtension({
  name: "my.save.prompt.panel",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyImageSave") return;

    // ── 三板斧钩子①:onNodeCreated(占位 widget+状态+命中缓存初建)──
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        const state = ensureState(this);
        // 占位 widget 幂等:重入(同节点二次构造面)不重复加,只保 mouse 派发
        let widget = panelWidgetOf(this);
        if (!widget) {
          widget = this.addCustomWidget({
            type: "custom",
            name: PANEL_WIDGET_NAME,
            serialize: false,
            computeSize: (width) => [width, panelHeightFor(this, ensureState(this))],
          });
        }
        if (widget) widget.mouse = (e, pos, node) => {
          try { return panelMouse(node, e, pos); } catch (error) { return false; }
        };
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.minW);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };

    // ── 三板斧钩子②:onExecuted(ui.myPrompt → properties → 失效折行重绘)──
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = onExecuted?.apply(this, arguments);
      try {
        // 引擎 ui 契约:列表扁平化→myPrompt=[载荷](单元素);旧 dict 形(桩)双读
        const payload = message?.myPrompt;
        const entry = Array.isArray(payload) ? payload[0] : payload;
        if (!entry || typeof entry !== "object") return result;
        const state = ensureState(this);
        state.text = typeof entry.text === "string" ? entry.text : String(entry.text ?? "");
        state.chars = Number.isFinite(entry.chars) ? Number(entry.chars) : state.text.length;
        this.__mySaveWrap = null;  // 文本变→折行缓存失效
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 垃圾载荷兜底=面板维持旧值 */ }
      return result;
    };

    // ── 三板斧钩子③:onResize(用户手动缩节点时守面板最小宽)──
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      try {
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.minW);
      } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 三板斧钩子④:onSerialize(存盘前兜底归一 properties 交互态)──
    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function () {
      const result = onSerialize?.apply(this, arguments);
      try { ensureState(this); } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 三板斧钩子⑤:onConfigure(重开复原:状态夹取+折行失效重绘)──
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try {
        ensureState(this);
        this.__mySaveWrap = null;
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 实绘挂点:onDrawBackground(collapsed 不画;样板同 AB 对比件)──
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
      onDrawBackground?.apply(this, arguments);
      if (this.flags?.collapsed) return;
      try { drawPanel(this, ctx); } catch (error) { /* 单帧绘制失败不拖画布 */ }
    };
  },
});
