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
    const drawPreview = (node, ctx) => {
      const name = node.properties?.manyingPreview;
      if (!name || node.flags?.collapsed) return;
      const img = ensureImage(name);
      if (!img || !img.complete || !img.naturalWidth) return; // 未载/404=不画
      const w = node.size[0] - PAD * 2;
      const h = PREVIEW_H;
      const x = PAD;
      const y = node.size[1] - h - PAD;
      ctx.save();
      roundedPath(ctx, x, y, w, h, 8);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.25)"; // letterbox 底色,与深色节点同调
      ctx.fillRect(x, y, w, h);
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
      roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
      onDrawBackground?.apply(this, arguments);
      drawPreview(this, ctx);
    };
  },
});
