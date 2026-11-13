// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_gen_timeline.js:242 MAX_REFERENCE_IMAGES=9 + :245-252 图片槽标签
// ("图片 N"/<Picture N>) 与 minimax_image_batch.js:2518 素材组卡片——
// 布局复刻、代码重写(PRD R3;核心件=公共图区只读+本组图区+翻页/复制/
// 删除/重跑此镜,PRD R1.5/R1.6)。
// 1113 阶段1.5 补丁④:图片槽编号改续号制——公共图区占 图片1-3,本组
// 图区从 图片4 续号(gen_timeline.js:250-252 refImagePromptTag=<Picture N>
// 全局连续编号口径;AIMixer 全局 refs 先编号、分段 refs 续号同构)。
//
// 素材组卡片(阶段1 静态一组):公共图区(角色卡全章共享只读)+本组图区
// (每镜分镜帧,9 槽)+组管理(翻页/复制/删除/重跑此镜)。
// IIFE 挂 window.DaoyanCards,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-cards{display:flex;flex-direction:column;gap:8px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".dy-card{border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));overflow:hidden;}",
    ".dy-card-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.07);font-size:12px;font-weight:700;color:#f0f4fa;}",
    ".dy-card-head .dy-mode{font-size:9.5px;color:#0c1220;background:#6ea8fe;border-radius:999px;padding:0 7px;flex:none;}",
    ".dy-card-head .dy-meta{font-size:10.5px;color:#9aa7ba;font-weight:400;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-card-head .dy-actions{margin-left:auto;display:flex;gap:5px;}",
    ".dy-btn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 9px;cursor:default;white-space:nowrap;}",
    ".dy-btn--primary{background:rgba(52,211,153,.16);border-color:rgba(52,211,153,.4);color:#d9f7ea;}",
    ".dy-btn--ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#9aa7ba;}",
    ".dy-slot-zone{padding:8px 12px 4px;}",
    ".dy-slot-zone-title{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#9aa7ba;margin-bottom:5px;}",
    ".dy-slot-zone-title .dy-ro{font-size:9.5px;color:#fbbf24;border:1px solid rgba(251,191,36,.35);border-radius:999px;padding:0 6px;}",
    ".dy-slots{display:flex;flex-wrap:wrap;gap:5px;}",
    ".dy-slot{position:relative;width:52px;height:52px;border-radius:7px;border:1px dashed rgba(255,255,255,.18);background:rgba(255,255,255,.03);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#7d8b9f;font-size:14px;}",
    ".dy-slot small{font-size:8.5px;color:#7d8b9f;pointer-events:none;}",
    ".dy-slot--filled{border-style:solid;border-color:rgba(110,168,254,.4);background:linear-gradient(180deg,rgba(110,168,254,.16),rgba(110,168,254,.06));color:#a8c8f2;}",
    ".dy-slot--ro{border-color:rgba(251,191,36,.3);}",
    ".dy-card-foot{display:flex;align-items:center;gap:10px;padding:7px 12px 9px;font-size:10.5px;color:#9aa7ba;}",
    ".dy-pager{display:flex;align-items:center;gap:6px;}",
    ".dy-pager i{font-style:normal;color:#6ea8fe;cursor:default;font-weight:700;}",
  ].join("\n");

  var STYLE_ID = "daoyan-cards-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /** 素材槽(9 槽模型,AIMixer gen_timeline.js:242 同构;filled=有图样式;
   * startIdx=续号制起始编号:公共区 1 起,本组区接公共区之后续号) */
  function slots(count, filledCount, readOnly, startIdx) {
    var start = startIdx || 1;
    var html = ['<div class="dy-slots">'];
    for (var i = 0; i < count; i++) {
      var n = start + i;
      var filled = i < filledCount;
      html.push('<div class="dy-slot' + (filled ? " dy-slot--filled" : "") + (readOnly ? " dy-slot--ro" : "") + '">'
        + (filled ? "🖼" : "+") + "<small>图片 " + n + "</small></div>");
    }
    html.push("</div>");
    return html.join("");
  }

  /**
   * 渲染素材组卡(阶段1 静态一组)。
   * @param {HTMLElement} root
   * @param {object} state 含 group 静态示例({index,total,mode,frames,seed,common,own})
   */
  function build(root, state) {
    ensureStyle();
    var g = (state && state.group) || { index: 1, total: 40, mode: "r2v", frames: "124f", seed: 42, common: 3, own: 9 };
    root.innerHTML = [
      '<div class="dy-card">',
      '<div class="dy-card-head">',
      "镜头 " + esc(g.index) + " / " + esc(g.total),
      '<span class="dy-mode">' + esc(g.mode) + "</span>",
      '<span class="dy-meta">' + esc(g.frames) + " · seed " + esc(g.seed) + " · p1✓ p2— p3—</span>",
      '<span class="dy-actions">',
      '<button class="dy-btn dy-btn--primary">重跑此镜</button>',
      '<button class="dy-btn">复制组</button>',
      '<button class="dy-btn dy-btn--ghost">删除组</button>',
      "</span></div>",
      '<div class="dy-slot-zone">',
      '<div class="dy-slot-zone-title">公共图区(角色卡,全章共享,占 图片1-' + esc(g.common) + ')<span class="dy-ro">只读</span></div>',
      slots(g.common, g.common, true, 1),
      "</div>",
      '<div class="dy-slot-zone">',
      '<div class="dy-slot-zone-title">本组图区(分镜帧 / 专属参考,从 图片' + esc(g.common + 1) + " 续号)</div>",
      slots(g.own, 0, false, g.common + 1),
      "</div>",
      '<div class="dy-card-foot">',
      '<span class="dy-pager"><i>◀</i> 第 ' + esc(g.index) + " / " + esc(g.total) + ' 组 <i>▶</i></span>',
      "<span>编号规则:公共图区占 图片1-" + esc(g.common) + ",本组图区从 图片" + esc(g.common + 1) + " 续号,与提示词 &lt;Picture N&gt; 全局一致</span>",
      "<span>每镜 task:t2v / i2v / fl2v / r2v 四选一(默认 r2v)</span>",
      "<span>产物回看:p1 草片 / p2 终片 / p3 终片缩略帧</span>",
      "</div>",
      "</div>",
    ].join("");
    return root;
  }

  global.DaoyanCards = { build: build, css: CSS, MAX_REFERENCE_IMAGES: 9 };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
