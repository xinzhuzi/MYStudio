// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";
import { postAction } from "./bridge-action.js";

/**
 * 镜节点图片带(shot-node 模块,09-13 模块拆分):myPreview 缩略图
 * 画布直绘(letterbox)。canvas 自绘保留(D2 裁定)。
 */

// ── 漫影节点图片带(09-10 用户裁定:节点要展示该镜成图,风格贴原生) ───────
// properties.myPreview = 引擎 input 目录缩略图名(总览保鲜上传,
// manying-shot-*.jpg 同名覆写);onDrawBackground 画布直绘:零前端组件
// API 依赖、不进 widgets_values(序列化契约零影响)、缺图/无键=纯文字卡
// 优雅退化。图带锚节点底部,节点加高由总览生成器(NODE_HEIGHT)负责。
app.registerExtension({
  name: "my.shot.preview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    // 旧名 ManyingShot=存量工作流兼容(09-14 manying→my 改名)
    if (nodeData?.name !== "MyShot" && nodeData?.name !== "ManyingShot") return;
    const PREVIEW_H = 170;
    const ACTION_H = 44;
    const PAD = 10;
    const images = new Map(); // filename -> HTMLImageElement(全图共用缓存)
    const ensureImage = (name) => {
      if (!images.has(name)) {
        const img = new Image();
        img.onload = () => { if (app.canvas?.setDirty) app.canvas.setDirty(true, true); };
        // 同名覆写下加时间戳防浏览器缓存旧图
        img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
        images.set(name, img);
      }
      return images.get(name);
    };
    const roundedPath = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    let shimmerTimer = null;
    // 流光骨架生命周期:per-node 8s 宽限截止(404 类缺图超时后静置,不烧计时器);
    // 全部就绪/超时即 clearInterval——计数器每帧自增永不清零会让 20fps 全画布
    // 重绘贯穿整个会话(发烫类事故同款),故以集合+截止时间替代。
    const SHIMMER_GRACE_MS = 8000;
    const pendingNodes = new Set();
    const scheduleShimmer = () => {
      if (shimmerTimer) return;
      shimmerTimer = setInterval(() => {
        const now = Date.now();
        for (const id of pendingNodes) {
          const pending = app.graph?._nodes?.find((x) => x.id === id);
          if (!pending || now > (pending.__myShimmerUntil || 0)) pendingNodes.delete(id);
        }
        if (pendingNodes.size === 0) {
          clearInterval(shimmerTimer);
          shimmerTimer = null;
          if (app.canvas?.setDirty) app.canvas.setDirty(true, true); // 收尾一帧:静置骨架
        } else if (app.canvas?.setDirty) {
          app.canvas.setDirty(true, true);
        }
      }, 66); // ~15fps 微光流动
    };
    // 探针接缝:隔离引擎验证计时器生命周期用(常驻成本=两个 getter)
    window.__myShimmer = {
      get pending() { return pendingNodes.size; },
      get animating() { return Boolean(shimmerTimer); },
    };

    const drawCrosshairs = (ctx, x, y, w, h) => {
      const L = 5;
      const M = 6;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + M, y + M + L); ctx.lineTo(x + M, y + M); ctx.lineTo(x + M + L, y + M);
      ctx.moveTo(x + w - M - L, y + M); ctx.lineTo(x + w - M, y + M); ctx.lineTo(x + w - M, y + M + L);
      ctx.moveTo(x + M, y + h - M - L); ctx.lineTo(x + M, y + h - M); ctx.lineTo(x + M + L, y + h - M);
      ctx.moveTo(x + w - M - L, y + h - M); ctx.lineTo(x + w - M, y + h - M); ctx.lineTo(x + w - M, y + h - M - L);
      ctx.stroke();
      ctx.restore();
    };

    // 单格绘制(双帧共用):就绪=电影底色 letterbox;未就绪=流光骨架/静置
    const drawCell = (node, ctx, x, y, w, h, img) => {
      const isReady = Boolean(img && img.complete && img.naturalWidth);
      ctx.save();
      roundedPath(ctx, x, y, w, h, 6);
      ctx.clip();
      if (isReady) {
        ctx.fillStyle = "rgba(8,11,18,0.7)"; // 电影质感底色
        ctx.fillRect(x, y, w, h);
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else {
        // 水墨流光骨架屏:截止前微光流动,超时=静置骨架(缺图不占计时器)
        const now = Date.now();
        if (node.__myShimmerUntil == null) node.__myShimmerUntil = now + SHIMMER_GRACE_MS;
        ctx.fillStyle = "rgba(14,18,28,0.72)";
        ctx.fillRect(x, y, w, h);
        if (now < node.__myShimmerUntil) {
          pendingNodes.add(node.id);
          scheduleShimmer();
          const shift = ((now % 2400) / 2400);
          const grad = ctx.createLinearGradient(x + (shift - 0.4) * w, y, x + (shift + 0.4) * w, y + h);
          grad.addColorStop(0, "rgba(255,255,255,0.02)");
          grad.addColorStop(0.5, "rgba(255,255,255,0.09)");
          grad.addColorStop(1, "rgba(255,255,255,0.02)");
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, w, h);
        } else {
          pendingNodes.delete(node.id);
        }
      }
      ctx.restore();
    };

    const drawPreview = (node, ctx) => {
      // 旧键 manyingPreview=存量工作流兼容双读
      const name = node.properties?.myPreview ?? node.properties?.manyingPreview;
      if (!name || node.flags?.collapsed) return;
      const w = node.size[0] - PAD * 2;
      const h = PREVIEW_H;
      const x = PAD;
      const y = node.size[1] - h - PAD - ACTION_H;
      const img = ensureImage(name);
      // 双帧并排(09-14 用户裁定:每镜多张图都上屏——回接后每镜常 2 帧;
      // 帧2 缺席=整幅单图,帧2 图未到=右半骨架)
      const name2 = node.properties?.myPreview2 ?? node.properties?.manyingPreview2;
      const img2 = name2 ? ensureImage(name2) : null;
      if (name2) {
        const gap = 4;
        const half = (w - gap) / 2;
        drawCell(node, ctx, x, y, half, h, img);
        drawCell(node, ctx, x + half + gap, y, half, h, img2);
        if (img && img.complete && img.naturalWidth && img2 && img2.complete && img2.naturalWidth) {
          pendingNodes.delete(node.id);
        }
      } else {
        drawCell(node, ctx, x, y, w, h, img);
      }

      // 电影监视器四角十字标尺(09-14 用户裁定:图内 Sxx 暗印退役——
      // 节点左下标题栏已是标号真源,图内重复)
      drawCrosshairs(ctx, x, y, w, h);

      roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    // 隐藏兜底双保险:onConfigure 时再压一遍——部分加载时序里 widgets 在
    // onNodeCreated 之后才建(首压空转),configure 后必在
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try { for (const widget of this.widgets || []) widget.hidden = true; } catch (error) { /* 无碍 */ }
      return result;
    };
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
      onDrawBackground?.apply(this, arguments);
      drawPreview(this, ctx);
    };
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        // 固定值输入框退役(shot_id/label/description/media_status 全 host 独写;
        // 镜卡语言=标题+缩略图带):官方 hidden 位,widgets_values 序列化零影响
        for (const widget of this.widgets || []) widget.hidden = true;
        // 高度钉底:隐藏 widget 后 computeSize 缩水,保缩略图带完整
        this.size[0] = Math.max(this.size[0] || 0, 300);
        this.size[1] = Math.max(this.size[1] || 0, 276);
        const action = document.createElement("div");
        action.style.cssText = "height:44px;display:flex;align-items:center;padding:6px 10px 0;box-sizing:border-box;";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "视频制作";
        button.title = "先生成画面";
        button.style.cssText = "width:100%;height:32px;border:1px solid rgba(110,168,254,.4);border-radius:7px;background:rgba(110,168,254,.16);color:#cfe2ff;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;";
        const update = () => {
          const mediaStatus = String(this.widgets?.[3]?.value || "");
          const ready = mediaStatus.includes("图✓");
          button.disabled = !ready;
          button.title = ready ? "打开该镜的漫影 H3 视频制作工作流" : "先生成画面";
          button.style.opacity = ready ? "1" : ".48";
          button.style.cursor = ready ? "pointer" : "not-allowed";
        };
        button.addEventListener("click", () => {
          const shotId = String(this.widgets?.[0]?.value || "").trim();
          if (shotId && !button.disabled) postAction("open-shot-video", shotId, button);
        });
        action.append(button);
        const widget = this.addDOMWidget("manying-shot-actions", "manying-shot-actions", action, {
          hideOnZoom: false,
          getHeight: () => 44,
          getMinHeight: () => 44,
        });
        this.__myShotActions = { action, button, widget };
        update();
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };
    const onConfigureWithActions = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigureWithActions?.apply(this, arguments);
      try {
        for (const widget of this.widgets || []) widget.hidden = true;
        this.__myShotActions?.button && (() => {
          const ready = String(this.widgets?.[3]?.value || "").includes("图✓");
          this.__myShotActions.button.disabled = !ready;
          this.__myShotActions.button.title = ready ? "打开该镜的漫影 H3 视频制作工作流" : "先生成画面";
          this.__myShotActions.button.style.opacity = ready ? "1" : ".48";
        })();
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };
  },
});
