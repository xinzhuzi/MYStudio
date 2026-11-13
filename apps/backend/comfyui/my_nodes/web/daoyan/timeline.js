// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:2996-3002 时间线视区 + :1439 pickRulerMajorStepSec
// 刻度尺 + :10388 drawSegmentThumbnails 分段块/帧标注 + :11209 选中态——
// 布局复刻、代码重写(PRD R3;AIMixer=Canvas 自绘,阶段1 静态骨架用 DOM
// 呈现同构结构,拖拽状态机 hitTest/edge 钳制排阶段2)。
// 1113 阶段1.5 补丁③:选中态描边蓝→绿(AIMixer 选中=亮绿描边口径,
// 对齐面板绿主色 #34d399;未选中段保持蓝底默认态)。
//
// 时间线(阶段1 静态):刻度尺+两分段块+选中态+帧范围标注+17k+5 吸附提示。
// IIFE 挂 window.DaoyanTimeline,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-timeline{display:flex;flex-direction:column;gap:6px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".dy-ruler{position:relative;height:26px;border-bottom:1px solid rgba(255,255,255,.14);margin:0 2px;}",
    ".dy-ruler .dy-tick{position:absolute;bottom:0;width:1px;height:7px;background:rgba(255,255,255,.22);}",
    ".dy-ruler .dy-tick--major{height:12px;background:rgba(255,255,255,.4);}",
    ".dy-ruler .dy-tick-label{position:absolute;bottom:9px;transform:translateX(-50%);font-size:10px;color:#9aa7ba;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-track{position:relative;height:92px;border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.6),rgba(10,14,24,.7));border:1px solid rgba(255,255,255,.08);overflow:hidden;}",
    ".dy-seg{position:absolute;top:10px;bottom:10px;border-radius:8px;background:linear-gradient(180deg,rgba(110,168,254,.2),rgba(110,168,254,.1));border:1px solid rgba(110,168,254,.4);display:flex;flex-direction:column;justify-content:space-between;padding:7px 10px;overflow:hidden;}",
    ".dy-seg--selected{border-color:#34d399;box-shadow:0 0 0 1.5px #34d399,0 0 14px rgba(52,211,153,.45);background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.14));}",
    ".dy-seg-head{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#f0f4fa;white-space:nowrap;}",
    ".dy-seg-mode{font-size:9.5px;font-weight:700;color:#0c1220;background:#6ea8fe;border-radius:999px;padding:0 7px;flex:none;}",
    ".dy-seg--selected .dy-seg-mode{background:#34d399;}",
    ".dy-seg-frames{font-size:10.5px;color:#cfd8e6;font-family:ui-monospace,'SF Mono',Menlo,monospace;white-space:nowrap;}",
    ".dy-seg-edge{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;}",
    ".dy-seg-edge--l{left:0;}.dy-seg-edge--r{right:0;}",
    ".dy-tl-foot{display:flex;align-items:center;gap:8px;font-size:10.5px;color:#9aa7ba;}",
    ".dy-tl-foot .dy-grid{color:#f5cd6d;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-playhead{position:absolute;top:0;bottom:0;width:1.5px;background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.6);}",
    ".dy-playhead:after{content:'▶';position:absolute;top:1px;left:4px;font-size:8px;color:#34d399;}",
  ].join("\n");

  var STYLE_ID = "daoyan-timeline-style";

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

  /** 刻度尺 DOM(总时长秒;主刻度每 5s) */
  function ruler(totalSec) {
    var html = ['<div class="dy-ruler">'];
    for (var s = 0; s <= totalSec; s++) {
      var pct = (s / totalSec) * 100;
      var major = s % 5 === 0;
      html.push('<i class="dy-tick' + (major ? " dy-tick--major" : "") + '" style="left:' + pct + '%"></i>');
      if (major) html.push('<span class="dy-tick-label" style="left:' + pct + '%">' + s + 's</span>');
    }
    html.push("</div>");
    return html.join("");
  }

  /** 单个分段块(静态;start/end 秒、mode、帧标注、选中态) */
  function segment(seg) {
    var left = (seg.start / seg.total) * 100;
    var width = ((seg.end - seg.start) / seg.total) * 100;
    var frames = global.DaoyanSerial
      ? global.DaoyanSerial.secondsToFrames(seg.end - seg.start) : null;
    var framesLabel = seg.frames != null ? seg.frames : (frames != null ? frames + "f" : "");
    return '<div class="dy-seg' + (seg.selected ? " dy-seg--selected" : "") + '"'
      + ' style="left:' + left + '%;width:' + width + '%">'
      + '<i class="dy-seg-edge dy-seg-edge--l"></i>'
      + '<div class="dy-seg-head">' + esc(seg.title) + '<span class="dy-seg-mode">' + esc(seg.mode) + "</span></div>"
      + '<div class="dy-seg-frames">' + esc(seg.start + "s–" + seg.end + "s · " + (seg.seconds != null ? seg.seconds + "s→" : "") + framesLabel) + "</div>"
      + '<i class="dy-seg-edge dy-seg-edge--r"></i>'
      + "</div>";
  }

  /**
   * 渲染时间线(阶段1 静态)。
   * @param {HTMLElement} root
   * @param {object} state 含 segments 静态示例({title,mode,start,end,total,seconds,frames,selected})
   */
  function build(root, state) {
    ensureStyle();
    var segs = (state && Array.isArray(state.segments) && state.segments.length)
      ? state.segments
      : [
          { title: "镜头 1", mode: "r2v", start: 0, end: 5, total: 10, seconds: 5, frames: "124f", selected: true },
          { title: "镜头 2", mode: "i2v", start: 5, end: 9, total: 10, seconds: 4, frames: "107f", selected: false },
        ];
    var total = segs.reduce(function (m, s) { return Math.max(m, s.total || s.end); }, 0) || 10;
    root.innerHTML = [
      ruler(total),
      '<div class="dy-track">',
      segs.map(segment).join(""),
      "</div>",
      '<div class="dy-tl-foot">',
      "<span>拖分段块边界调时长(阶段2 交互)</span>",
      '<span class="dy-grid">时长自动贴 17k+5 帧网格 · 5s→124f · 4s→107f</span>',
      '<span>选中=镜头 1</span>',
      "</div>",
    ].join("");
    return root;
  }

  global.DaoyanTimeline = { build: build, css: CSS };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
