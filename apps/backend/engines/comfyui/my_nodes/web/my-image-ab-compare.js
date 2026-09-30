// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 图对比审片器 canvas 自绘件(0929 TE-MAN 排查 B2 仿写件)。
 * 滑动帘横拖对比 + 2-7x 放大镜悬停放大,全部画布自绘零后端交互:
 * 后端 MyImageABCompare 执行时把 A/B 首帧落 temp,onExecuted 接 ui.abCompare
 * 存进 properties.myAbImage(随工作流保存/重开复原),画布每帧照 properties
 * 重绘——状态永驻 properties,禁走 widgets_values(序列化契约零影响)。
 * 交互范式=仓内三板斧:beforeRegisterNodeDef 五钩子(onNodeCreated/
 * onExecuted/onResize/onSerialize/onConfigure)+ 命中矩形缓存 + {type:"custom",
 * serialize:false, computeSize} 占位 widget(实绘在 onDrawBackground,样板=
 * stage-canvas.js/shot-node.js 同款)。
 */

import { AB_COMPARE_TOKENS as TOKENS } from "./theme.js";

// 帘位/镜位/倍率的取值面(与 py 侧 clamp 同源;此处是画布侧兜底夹取)
const clamp01 = (x) => Math.min(Math.max(Number(x) || 0, 0), 1);
const clampZoom = (z) => Math.min(
  Math.max(Number(z) || TOKENS.zoom.min, TOKENS.zoom.min), TOKENS.zoom.max);
const nextZoom = (z) => {
  const cur = clampZoom(z);
  for (const step of TOKENS.zoom.steps) if (cur < step) return step;
  return TOKENS.zoom.steps[0];
};

// properties.myAbImage 的缺省态(label 外全在此,widgets_values 零沾)
const DEFAULT_STATE = () => ({
  curtain: 0.5,       // 帘位(0=全 B,1=全 A;0.5=正中)
  lensOn: false,      // 放大镜开关
  lensX: 0.5, lensY: 0.5,  // 镜心(舞台归一化)
  zoom: TOKENS.zoom.steps[0],
  a: null, b: null,   // ui.abCompare 单侧引用(filename/subfolder/type/label…)
});

const ensureState = (node) => {
  const props = node.properties || (node.properties = {});
  const state = props.myAbImage || (props.myAbImage = DEFAULT_STATE());
  state.curtain = clamp01(state.curtain);
  state.lensX = clamp01(state.lensX);
  state.lensY = clamp01(state.lensY);
  state.zoom = clampZoom(state.zoom);
  state.lensOn = Boolean(state.lensOn);
  return state;
};

// temp 图缓存(全扩展共用;/view 取图,带缓存戳防同名旧图)
const imageCache = new Map();
const ensureImage = (entry) => {
  const key = `${entry.subfolder || ""}/${entry.filename}`;
  if (!imageCache.has(key)) {
    const img = new Image();
    img.onload = () => { if (app.canvas?.setDirty) app.canvas.setDirty(true, true); };
    img.src = `/view?filename=${encodeURIComponent(entry.filename)}`
      + `&subfolder=${encodeURIComponent(entry.subfolder || "")}`
      + `&type=${encodeURIComponent(entry.type || "temp")}&_=${Date.now()}`;
    imageCache.set(key, img);
  }
  return imageCache.get(key);
};

const roundBox = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// letterbox 适配:图贴进舞台盒的绘制矩形与缩放比
const fitRect = (img, x, y, w, h) => {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  return { dx: x + (w - dw) / 2, dy: y + (h - dh) / 2, dw, dh, scale };
};

/** 舞台顶=动态让位:读 litegraph 运行时实测的 label 行位/行高(0930 B2 修)
 * (标签行坐舞台上方,舞台/角标不与文本框叠字;标签行数按 widgets 实数)
 * 实测真源=前端 _arrangeWidgets 每轮排布写在 widget 上的 y(与绘期 last_y
 * 同源)与 computedHeight(默认行高=NODE_WIDGET_HEIGHT+4=24)。旧常量式
 * titleH+行数×widgetRowH+gap 在引擎现役前端实测留 18px 叠字:首行 y=46
 * 由输入槽底动态推得(非 titleH),行距 24(非 20)——常量猜不准,改读实值。
 * 回落=首排布前 y 未赋值(litegraph widget 类字段初值 0)时走常量式
 * (widgetRowH 已实测校准 24)兜首帧;排布落定后每帧绘制自动用实值。 */
const stageTopFor = (node) => {
  const labels = (node.widgets || [])
    .filter((w) => w?.name === "label_a" || w?.name === "label_b");
  let bottom = 0;
  for (const w of labels) {
    const y = Number.isFinite(w.y) && w.y > 0 ? w.y
      : Number.isFinite(w.last_y) && w.last_y > 0 ? w.last_y : null;
    const h = Number.isFinite(w.computedHeight) && w.computedHeight > 0
      ? w.computedHeight : TOKENS.widgetRowH;
    if (y != null) bottom = Math.max(bottom, y + h);
  }
  if (bottom > 0) return bottom + TOKENS.labelStageGap;
  return TOKENS.titleH + labels.length * TOKENS.widgetRowH + TOKENS.labelStageGap;
};

/** 舞台几何(节点本地坐标):命中检测与绘制共用同一真源 */
const stageRect = (node) => {
  const top = stageTopFor(node);
  const w = Math.max(node.size[0] - TOKENS.pad * 2, TOKENS.minStageFace);
  return {
    x: TOKENS.pad, y: top, w,
    h: Math.max(node.size[1] - top - TOKENS.buttonRowH - TOKENS.pad,
                TOKENS.minStageFace),
  };
};

app.registerExtension({
  name: "my.abcompare.image",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyImageABCompare") return;
    const C = TOKENS.colors;

    // ── 绘制:滑动帘(B 全幅垫底,A 裁帘左)+ 放大镜 + 角标 + 按钮行 ──
    const drawStage = (node, ctx) => {
      const state = ensureState(node);
      const st = stageRect(node);
      const bottom = st.y + st.h;
      ctx.save();
      try {
        roundBox(ctx, st.x + 0.5, st.y + 0.5, st.w - 1, st.h - 1, 8);
        ctx.fillStyle = C.stageBg;
        ctx.fill();
        ctx.strokeStyle = C.stageBorder;
        ctx.lineWidth = 1;
        ctx.stroke();

        const imgA = state.a ? ensureImage(state.a) : null;
        const imgB = state.b ? ensureImage(state.b) : null;
        const okA = imgA && imgA.complete && imgA.naturalWidth;
        const okB = imgB && imgB.complete && imgB.naturalWidth;
        const curtainX = st.x + st.w * state.curtain;

        // B 垫底全幅 → A 只画帘左(帘右露出 B)
        if (okB) {
          const f = fitRect(imgB, st.x, st.y, st.w, st.h);
          ctx.save();
          roundBox(ctx, st.x + 1, st.y + 1, st.w - 2, st.h - 2, 7);
          ctx.clip();
          ctx.drawImage(imgB, f.dx, f.dy, f.dw, f.dh);
          ctx.restore();
        }
        if (okA) {
          const f = fitRect(imgA, st.x, st.y, st.w, st.h);
          ctx.save();
          ctx.beginPath();
          ctx.rect(st.x, st.y, curtainX - st.x, st.h);
          ctx.clip();
          ctx.drawImage(imgA, f.dx, f.dy, f.dw, f.dh);
          ctx.restore();
        }
        if (!okA || !okB) {
          ctx.font = "600 12px sans-serif";
          ctx.fillStyle = C.readout;
          const hint = !okA && !okB ? "接 A/B 两路 IMAGE 后执行Queue即可对比"
            : !okA ? "A 路图未就绪" : "B 路图未就绪";
          ctx.fillText(hint, st.x + 12, st.y + 20);
        }

        // 帘线 + 手柄(↔ 双箭头)
        ctx.beginPath();
        ctx.moveTo(curtainX, st.y);
        ctx.lineTo(curtainX, bottom);
        ctx.strokeStyle = C.divider;
        ctx.lineWidth = TOKENS.dividerW;
        ctx.stroke();
        const handleY = st.y + st.h / 2;
        ctx.beginPath();
        ctx.arc(curtainX, handleY, TOKENS.handleR, 0, Math.PI * 2);
        ctx.fillStyle = C.handleBg;
        ctx.fill();
        ctx.strokeStyle = C.divider;
        ctx.lineWidth = TOKENS.lensBorderW;
        ctx.stroke();
        ctx.strokeStyle = C.handleIcon;
        ctx.lineWidth = 1.6;
        const aw = 4.5;
        ctx.beginPath();
        ctx.moveTo(curtainX - aw + 1.5, handleY - 3); ctx.lineTo(curtainX - aw + 4.5, handleY);
        ctx.lineTo(curtainX - aw + 1.5, handleY + 3);
        ctx.moveTo(curtainX + aw - 1.5, handleY - 3); ctx.lineTo(curtainX + aw - 4.5, handleY);
        ctx.lineTo(curtainX + aw - 1.5, handleY + 3);
        ctx.stroke();

        // A/B 角标(带 batch 提示:A×3=批 3 取首帧)
        ctx.font = "600 10px sans-serif";
        const badge = (text, x) => {
          const w = ctx.measureText(text).width + 10;
          roundBox(ctx, x, st.y + 6, w, 15, 7);
          ctx.fillStyle = C.badgeBg;
          ctx.fill();
          ctx.fillStyle = C.badgeText;
          ctx.fillText(text, x + 5, st.y + 17);
        };
        const labelOf = (entry, fallback) => {
          if (!entry) return fallback;
          const label = String(entry.label ?? fallback);
          return entry.batch > 1 ? `${label}×${entry.batch}` : label;
        };
        badge(labelOf(state.a, "A"), st.x + 8);
        const bText = labelOf(state.b, "B");
        badge(bText, st.x + st.w - 14 - ctx.measureText(bText).width - 10);

        // 放大镜(开且 A 就绪才画;取样中心=镜心在 A 贴图上的像点)
        if (state.lensOn && okA) {
          const fA = fitRect(imgA, st.x, st.y, st.w, st.h);
          const lensX = st.x + st.w * state.lensX;
          const lensY = st.y + st.h * state.lensY;
          const r = TOKENS.lensR;
          // 镜心若落在 A 贴图外,取样点夹回贴图内(边缘也能照)
          const sx = Math.min(Math.max(lensX, fA.dx), fA.dx + fA.dw);
          const sy = Math.min(Math.max(lensY, fA.dy), fA.dy + fA.dh);
          const srcR = r / state.zoom;
          ctx.save();
          ctx.beginPath();
          ctx.arc(lensX, lensY, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = C.stageBg;
          ctx.fillRect(lensX - r, lensY - r, r * 2, r * 2);
          ctx.drawImage(imgA,
            (sx - fA.dx) / fA.scale - srcR, (sy - fA.dy) / fA.scale - srcR,
            srcR * 2, srcR * 2,
            lensX - r, lensY - r, r * 2, r * 2);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(lensX, lensY, r, 0, Math.PI * 2);
          ctx.strokeStyle = C.handleBg;
          ctx.lineWidth = TOKENS.lensBorderW;
          ctx.stroke();
          ctx.font = "600 10px sans-serif";
          ctx.fillStyle = C.badgeBg;
          const tag = `${state.zoom}x`;
          const tagW = ctx.measureText(tag).width + 8;
          roundBox(ctx, lensX - tagW / 2, lensY + r + 3, tagW, 14, 7);
          ctx.fill();
          ctx.fillStyle = C.pillText;
          ctx.fillText(tag, lensX - tagW / 2 + 4, lensY + r + 13.5);
        }

        // 底部按钮行:放大镜开关 / 倍率循环(命中矩形缓存供 onMouseDown)
        const pills = [];
        let bx = st.x + 2;
        const pill = (text, active, hit) => {
          const w = ctx.measureText(text).width + 18;
          roundBox(ctx, bx, bottom + 4, w, 18, 8);
          ctx.fillStyle = active ? C.pillBg : C.pillOffBg;
          ctx.fill();
          ctx.strokeStyle = active ? C.pillBorder : C.pillOffBorder;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = active ? C.pillText : C.pillOffText;
          ctx.font = "600 10px sans-serif";
          ctx.fillText(text, bx + 9, bottom + 16.5);
          if (hit) pills.push({ x: bx, y: bottom + 4, w, h: 18, kind: hit });
          bx += w + 6;
        };
        ctx.font = "600 10px sans-serif";
        pill(`放大镜 ${state.lensOn ? "开" : "关"}`, state.lensOn, "lens");
        pill(`倍率 ${state.zoom}x`, true, "zoom");
        if (state.a && state.b) {
          const meta = `${state.a.width}×${state.a.height}`;
          ctx.fillStyle = C.readout;
          ctx.fillText(meta, st.x + st.w - ctx.measureText(meta).width - 2, bottom + 16.5);
        }
        node.__myAbHits = {
          pills,
          divider: { x: curtainX - TOKENS.handleR, y: handleY - TOKENS.handleR,
                     w: TOKENS.handleR * 2, h: TOKENS.handleR * 2 },
          stage: st,
        };
      } finally {
        ctx.restore();
      }
    };

    // ── 三板斧钩子①:onNodeCreated(占位 widget+尺寸钉底+命中缓存初建)──
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        ensureState(this);
        this.__myAbDragging = false;
        // 占位 widget:{type:"custom"+serialize:false} 只管撑高布局,实绘在
        // onDrawBackground(stage-canvas 样板);widgets_values 零沾。
        // 真实画布点击派发挂 widget.mouse(见上 stageMouse 注记),占位层截
        // 住节点体点击后 node.onMouseDown 不达——两路并存,画布走 widget 路。
        const widget = this.addCustomWidget({
          type: "custom",
          name: "my_ab_image_stage",
          serialize: false,
          computeSize: (width) => [
            width, stageTopFor(this) + TOKENS.stageH + TOKENS.buttonRowH + TOKENS.pad],
        });
        if (widget) widget.mouse = (e, pos, node) => {
          try { return stageMouse(node, e, pos); } catch (error) { return false; }
        };
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.stageMinW);
        this.size[1] = Math.max(
          this.size[1] || 0,
          stageTopFor(this) + TOKENS.stageH + TOKENS.buttonRowH + TOKENS.pad);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };

    // ── 三板斧钩子②:onExecuted(接 ui.abCompare → properties → 触发取图)──
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = onExecuted?.apply(this, arguments);
      try {
        const payload = message?.abCompare;
        // 引擎 ui 契约:每个 ui 值被列表扁平化 → abCompare=[侧a,侧b](side 字段
        // 显式标识);旧 dict 形(探针桩)双读兼容
        const a = Array.isArray(payload) ? payload.find((p) => p && p.side === "a") : payload?.a;
        const b = Array.isArray(payload) ? payload.find((p) => p && p.side === "b") : payload?.b;
        if (!a || !b) return result;
        const state = ensureState(this);
        state.a = a;
        state.b = b;
        ensureImage(a);
        ensureImage(b);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 无图兜底=占位文案 */ }
      return result;
    };

    // ── 三板斧钩子③:onResize(用户手动缩节点时守舞台最小面)──
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      try {
        const minHeight = stageTopFor(this) + TOKENS.minStageH
          + TOKENS.buttonRowH + TOKENS.pad;
        this.size[0] = Math.max(this.size[0] || 0, TOKENS.stageMinW);
        this.size[1] = Math.max(this.size[1] || 0, minHeight);
      } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 三板斧钩子④:onSerialize(存盘前兜底归一 properties 交互态)──
    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (data) {
      const result = onSerialize?.apply(this, arguments);
      try { ensureState(this); } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 三板斧钩子⑤:onConfigure(重开复原:状态夹取+取图重绘)──
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try {
        const state = ensureState(this);
        if (state.a) ensureImage(state.a);
        if (state.b) ensureImage(state.b);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      } catch (error) { /* 无碍 */ }
      return result;
    };

    // ── 实绘挂点:onDrawBackground(collapsed 不画;样板同 stage-canvas)──
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
      onDrawBackground?.apply(this, arguments);
      if (this.flags?.collapsed) return;
      try { drawStage(this, ctx); } catch (error) { /* 单帧绘制失败不拖画布 */ }
    };

    // ── 交互:命中矩形缓存驱动 ──────────────────────────────────────
    // 本版 @comfyorg litegraph 真实画布派发面=widget.mouse:节点体点击先被
    // getWidgetOnPos 截进占位 widget(processWidgetClick),node.onMouseDown
    // 不达;down/move/up 全走 widget.mouse(e, 本地坐标, node),0929 实弹
    // 探针B 逐拍证实。node.onMouseDown/Move/Up 三件保留=非画布宿主兜底。
    const hitPill = (node, pos) => {
      for (const rect of node.__myAbHits?.pills || []) {
        if (pos[0] >= rect.x && pos[0] <= rect.x + rect.w
          && pos[1] >= rect.y && pos[1] <= rect.y + rect.h) return rect;
      }
      return null;
    };
    const inStage = (node, pos) => {
      const st = node.__myAbHits?.stage;
      return Boolean(st) && pos[0] >= st.x && pos[0] <= st.x + st.w
        && pos[1] >= st.y && pos[1] <= st.y + st.h;
    };
    const nearDivider = (node, pos) => {
      const d = node.__myAbHits?.divider;
      if (!d) return false;
      const slop = TOKENS.hitSlop;
      return pos[0] >= d.x - slop && pos[0] <= d.x + d.w + slop
        && pos[1] >= d.y - slop && pos[1] <= d.y + d.h + slop;
    };
    const moveLens = (node, pos) => {
      const st = node.__myAbHits.stage;
      const state = ensureState(node);
      if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
      state.lensX = clamp01((pos[0] - st.x) / st.w);
      state.lensY = clamp01((pos[1] - st.y) / st.h);
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    };
    /** widget.mouse 派发(e=pointer 原生事件,pos=节点本地坐标);返回 true=消费 */
    const stageMouse = (node, e, pos) => {
      const hits = node.__myAbHits;
      if (!hits || !pos) return false;
      const kind = String(e.type);
      if (kind.includes("down")) {
        const pill = hitPill(node, pos);
        if (pill) {
          const state = ensureState(node);
          if (pill.kind === "lens") state.lensOn = !state.lensOn;
          if (pill.kind === "zoom") state.zoom = nextZoom(state.zoom);
          if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
          return true;
        }
        if (nearDivider(node, pos)) {
          node.__myAbDragging = true;
          return true;
        }
        if (ensureState(node).lensOn && inStage(node, pos)) {
          moveLens(node, pos);
          return true;
        }
        return false;
      }
      if (kind.includes("up") || !(e.buttons & 1)) {  // 抬指/失按即收帘
        const wasDragging = node.__myAbDragging;
        node.__myAbDragging = false;
        return wasDragging;
      }
      if (node.__myAbDragging) {  // move(按住):拖帘
        const st = hits.stage;
        if (st && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
          ensureState(node).curtain = clamp01((pos[0] - st.x) / st.w);
          if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
        }
        return true;
      }
      if (ensureState(node).lensOn && inStage(node, pos)) {
        moveLens(node, pos);
        return true;
      }
      return false;
    };

    // 节点级兜底路由(非画布宿主/无占位 widget 场景):本版 litegraph 签名=
    // (e, 本地坐标, canvas),经典宿主=(本地坐标, e)——取数组参数双兼容;
    // 真实画布上节点体点击被占位 widget 截走,主路=上面 widget.mouse。
    const pickLocal = (a, b) => (Array.isArray(a) ? a : Array.isArray(b) ? b : null);
    nodeType.prototype.onMouseDown = function (e, pos) {
      const hits = this.__myAbHits;
      const local = pickLocal(e, pos);
      if (!hits || !local) return false;
      const pill = hitPill(this, local);
      if (pill) {
        const state = ensureState(this);
        if (pill.kind === "lens") state.lensOn = !state.lensOn;
        if (pill.kind === "zoom") state.zoom = nextZoom(state.zoom);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        return true;
      }
      if (nearDivider(this, local)) {
        this.__myAbDragging = true;
        return true;
      }
      if (ensureState(this).lensOn && inStage(this, local)) {
        moveLens(this, local);
        return true;
      }
      return false;
    };
    nodeType.prototype.onMouseMove = function (e, pos) {
      const local = pickLocal(e, pos);
      if (!local || !Number.isFinite(local[0]) || !Number.isFinite(local[1])) return false;
      if (this.__myAbDragging) {
        const st = this.__myAbHits?.stage;
        if (st) {
          ensureState(this).curtain = clamp01((local[0] - st.x) / st.w);
          if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        }
        return true;
      }
      if (ensureState(this).lensOn && inStage(this, local)) {
        moveLens(this, local);
        return true;
      }
      return false;
    };
    nodeType.prototype.onMouseUp = function () {
      if (this.__myAbDragging) {
        this.__myAbDragging = false;
        return true;
      }
      return false;
    };
  },
});
