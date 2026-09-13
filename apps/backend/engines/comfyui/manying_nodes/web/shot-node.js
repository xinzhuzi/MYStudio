// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 镜节点图片带(shot-node 模块,09-13 模块拆分):manyingPreview 缩略图
 * 画布直绘(letterbox)。canvas 自绘保留(D2 裁定)。
 */

// ── 漫影节点图片带(09-10 用户裁定:节点要展示该镜成图,风格贴原生) ───────
// properties.manyingPreview = 引擎 input 目录缩略图名(总览保鲜上传,
// manying-shot-*.jpg 同名覆写);onDrawBackground 画布直绘:零前端组件
// API 依赖、不进 widgets_values(序列化契约零影响)、缺图/无键=纯文字卡
// 优雅退化。图带锚节点底部,节点加高由总览生成器(NODE_HEIGHT)负责。
app.registerExtension({
  name: "manying.shot.preview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ManyingShot") return;
    const PREVIEW_H = 170;
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
          if (!pending || now > (pending.__manyingShimmerUntil || 0)) pendingNodes.delete(id);
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
    window.__manyingShimmer = {
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

    const drawPreview = (node, ctx) => {
      const name = node.properties?.manyingPreview;
      if (!name || node.flags?.collapsed) return;
      const w = node.size[0] - PAD * 2;
      const h = PREVIEW_H;
      const x = PAD;
      const y = node.size[1] - h - PAD;
      const img = ensureImage(name);
      const isReady = Boolean(img && img.complete && img.naturalWidth);

      ctx.save();
      roundedPath(ctx, x, y, w, h, 8);
      ctx.clip();

      if (isReady) {
        pendingNodes.delete(node.id);
        ctx.fillStyle = "rgba(8,11,18,0.7)"; // 电影质感底色
        ctx.fillRect(x, y, w, h);
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else {
        // 水墨流光骨架屏:截止前微光流动,超时=静置骨架(缺图不占计时器)
        const now = Date.now();
        if (node.__manyingShimmerUntil == null) node.__manyingShimmerUntil = now + SHIMMER_GRACE_MS;
        ctx.fillStyle = "rgba(14,18,28,0.72)";
        ctx.fillRect(x, y, w, h);
        if (now < node.__manyingShimmerUntil) {
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

      // 电影监视器四角十字标尺
      drawCrosshairs(ctx, x, y, w, h);

      // 左上角镜头暗印
      const shotMatch = (node.title || "").match(/S\d+/i);
      if (shotMatch) {
        ctx.save();
        ctx.font = '600 9.5px ui-monospace, "SF Mono", Menlo, monospace';
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(shotMatch[0].toUpperCase(), x + 9, y + 16);
        ctx.restore();
      }

      roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
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
        this.size[1] = Math.max(this.size[1] || 0, 232);
      } catch (error) { /* 兜底=原生外观 */ }
      return result;
    };
  },
});
