// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:9301 hitTest 拖拽状态机 / :9563-9594 edge 钳制 /
// :10388 drawSegmentThumbnails 分段块帧标注 / :11209 选中态 / :5790
// reorder —— 布局复刻、代码重写(PRD R3;AIMixer=Canvas 自绘,我方=DOM,
// 交互语义同构:边界拖拽改时长→贴 17k+5 网格,PRD R1.5)。
// 1113 阶段1.5 补丁③:选中态描边绿(对齐面板绿主色 #34d399)。
//
// 时间线(阶段2 交互):刻度尺+分段块+选中切换+增删分段+边界拖拽(拖毕
// 秒数自动贴 17k+5 帧网格并双单位显示「5s→124f」)。
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
    ".dy-seg{position:absolute;top:10px;bottom:10px;border-radius:8px;background:linear-gradient(180deg,rgba(110,168,254,.2),rgba(110,168,254,.1));border:1px solid rgba(110,168,254,.4);display:flex;flex-direction:column;justify-content:space-between;padding:7px 10px;overflow:hidden;cursor:pointer;}",
    ".dy-seg--selected{border-color:#34d399;box-shadow:0 0 0 1.5px #34d399,0 0 14px rgba(52,211,153,.45);background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.14));}",
    ".dy-seg-head{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#f0f4fa;white-space:nowrap;}",
    ".dy-seg-mode{font-size:9.5px;font-weight:700;color:#0c1220;background:#6ea8fe;border-radius:999px;padding:0 7px;flex:none;}",
    ".dy-seg--selected .dy-seg-mode{background:#34d399;}",
    ".dy-seg-frames{font-size:10.5px;color:#cfd8e6;font-family:ui-monospace,'SF Mono',Menlo,monospace;white-space:nowrap;}",
    ".dy-seg-edge{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;}",
    ".dy-seg-edge:hover{background:rgba(52,211,153,.25);}",
    ".dy-seg-edge--l{left:0;}.dy-seg-edge--r{right:0;}",
    ".dy-tl-foot{display:flex;align-items:center;gap:8px;font-size:10.5px;color:#9aa7ba;flex-wrap:wrap;}",
    ".dy-tl-foot .dy-grid{color:#f5cd6d;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-tl-head{display:flex;align-items:center;gap:6px;}",
    ".dy-tl-empty{padding:14px 12px;font-size:11px;color:#9aa7ba;border:1px dashed rgba(255,255,255,.14);border-radius:10px;text-align:center;}",
    ".dy-tbtn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 10px;cursor:pointer;white-space:nowrap;}",
    ".dy-tbtn--primary{background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.16));border-color:rgba(52,211,153,.5);color:#eafff5;}",
    ".dy-tbtn--danger{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.4);color:#fecaca;}",
    ".dy-tbtn[disabled]{opacity:.45;cursor:default;}",
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

  var serial = function () { return global.DaoyanSerial; };
  function S() { return serial(); }

  // ── 纯函数(测试断言面)──────────────────────────────────────────────

  /** 布局推导:分段顺序排布,start/end 按累计时长(秒) */
  function layout(state) {
    var t = 0;
    var items = [];
    var segs = (state && state.segments) || [];
    for (var i = 0; i < segs.length; i++) {
      var sec = S().framesToSeconds(segs[i].frames);
      items.push({ index: i, start: Math.round(t * 100) / 100, end: Math.round((t + sec) * 100) / 100, seconds: sec, frames: segs[i].frames });
      t += sec;
    }
    return { items: items, total: Math.round(t * 100) / 100 };
  }

  /** 边界拖拽→原始秒(未贴网格):右缘 +delta,左缘 −delta;钳 ≥0.2s */
  function edgeDragToSeconds(currentSeconds, side, deltaSec) {
    if (!isFinite(deltaSec)) deltaSec = 0;
    var raw = side === "l" ? Number(currentSeconds) - deltaSec : Number(currentSeconds) + deltaSec;
    return Math.max(0.2, Math.round(raw * 100) / 100);
  }

  // ── 动作(commit 经控制器:快照+去抖写回+通知重渲)──────────────────

  var actions = {
    /** 增分段(追加末尾,自动选中;PRD R2 面板操作链) */
    addSegment: function (ctrl, patch) {
      ctrl.apply(function (st) {
        st.segments.push(S().normalizeSegment(patch || {}, st.segments.length));
      });
      ctrl.view.selected = ctrl.state.segments.length - 1;
      return ctrl;
    },
    /** 删分段(删选中或指定 idx) */
    removeSegment: function (ctrl, idx) {
      var i = idx == null ? ctrl.view.selected : idx;
      if (i < 0 || i >= ctrl.state.segments.length) return false;
      ctrl.apply(function (st) { st.segments.splice(i, 1); });
      return true;
    },
    /** 选中切换(选中=素材组卡/提示词编辑的当前组) */
    selectSegment: function (ctrl, idx) {
      if (idx < 0 || idx >= ctrl.state.segments.length) return false;
      ctrl.view.selected = idx;
      ctrl.view.armedDelete = -1;
      ctrl.apply(function () {}); // 通知重渲(无状态变化)
      return true;
    },
    /** 改时长(秒输入/拖边界终值统一入口):贴 17k+5 网格+双单位显示 */
    setSegmentSeconds: function (ctrl, idx, seconds) {
      var seg = ctrl.state.segments[idx];
      if (!seg) return false;
      var sec = Math.max(0.2, Math.round(Number(seconds) * 100) / 100);
      if (!isFinite(sec) || sec <= 0) return false;
      ctrl.apply(function (st) {
        st.segments[idx].seconds = sec;
        st.segments[idx].frames = S().secondsToFrames(sec);
      });
      return true;
    },
  };

  // ── 渲染+事件 ──────────────────────────────────────────────────────

  /** 刻度尺 DOM(主刻度每 5s;短时长退每 1s) */
  function ruler(totalSec) {
    var step = totalSec > 0 && totalSec <= 6 ? 1 : 5;
    var html = ['<div class="dy-ruler">'];
    for (var s = 0; s <= totalSec + 0.001; s++) {
      var pct = totalSec > 0 ? (s / totalSec) * 100 : 0;
      var major = s % step === 0;
      if (major) {
        html.push('<i class="dy-tick dy-tick--major" style="left:' + pct + '%"></i>');
        html.push('<span class="dy-tick-label" style="left:' + pct + '%">' + s + 's</span>');
      } else {
        html.push('<i class="dy-tick" style="left:' + pct + '%"></i>');
      }
    }
    html.push("</div>");
    return html.join("");
  }

  /** 单个分段块(双单位显示 s→f;data-seg=idx;缘=data-drag-edge) */
  function segmentBlock(item, seg, total, selected) {
    var left = total > 0 ? (item.start / total) * 100 : 0;
    var width = total > 0 ? ((item.end - item.start) / total) * 100 : 100;
    return '<div class="dy-seg' + (selected ? " dy-seg--selected" : "") + '"'
      + ' data-act="select-seg" data-seg="' + item.index + '"'
      + ' style="left:' + left + '%;width:' + width + '%">'
      + '<i class="dy-seg-edge dy-seg-edge--l" data-drag-edge="l" data-seg="' + item.index + '" title="拖边界改时长(贴网格)"></i>'
      + '<div class="dy-seg-head">' + esc(seg.id) + '<span class="dy-seg-mode">' + esc(seg.mode) + "</span></div>"
      + '<div class="dy-seg-frames">' + item.start + "s–" + item.end + "s · " + seg.seconds + "s→" + seg.frames + "f</div>"
      + '<i class="dy-seg-edge dy-seg-edge--r" data-drag-edge="r" data-seg="' + item.index + '" title="拖边界改时长(贴网格)"></i>'
      + "</div>";
  }

  /**
   * 渲染时间线(阶段2 交互)。
   * @param {HTMLElement} root
   * @param {object} ctx DaoyanSerial 控制器(裸 state 自动包 demo 控制器=静态)
   */
  function build(root, ctx) {
    ensureStyle();
    var ctrl = S().ctrlOf(ctx);
    var lay = layout(ctrl.state);
    var sel = ctrl.view.selected;
    var head = [
      '<div class="dy-tl-head">',
      '<button class="dy-tbtn dy-tbtn--primary" data-act="add-seg">＋ 分段</button>',
      '<button class="dy-tbtn dy-tbtn--danger" data-act="remove-seg"' + (ctrl.state.segments.length ? "" : " disabled") + ">✕ 删分段</button>",
      "</div>",
    ].join("");
    var body;
    if (!ctrl.state.segments.length) {
      body = '<div class="dy-tl-empty">零分段——点「＋ 分段」或在素材组区点「添加第一组」开始</div>';
    } else {
      body = ruler(lay.total) + '<div class="dy-track">'
        + lay.items.map(function (it) {
          return segmentBlock(it, ctrl.state.segments[it.index], lay.total, it.index === sel);
        }).join("") + "</div>";
    }
    root.innerHTML = head + body + [
      '<div class="dy-tl-foot">',
      "<span>拖分段块左右缘调时长,松手自动贴网格</span>",
      '<span class="dy-grid">时长贴 17k+5 帧网格 · 5s→124f · 4s→107f</span>',
      "<span>选中=" + esc(ctrl.state.segments.length ? ctrl.state.segments[sel] && ctrl.state.segments[sel].id : "无") + "</span>",
      "</div>",
    ].join("");
    bind(root, ctrl);
    return root;
  }

  /** 事件:点击委托(增/删/选中)+ 边界指针拖拽(拖毕贴网格提交)。
   * 重渲防重绑:root 只绑一次,最新控制器挂 root._dyTlCtrl(重渲即刷新)。 */
  function bind(root, ctrl) {
    root._dyTlCtrl = ctrl;
    if (root._dyTlBound) return;
    root._dyTlBound = true;
    root.addEventListener("click", function (e) {
      var ctrl = root._dyTlCtrl;
      var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !ctrl) return;
      var act = el.getAttribute("data-act");
      if (act === "add-seg") actions.addSegment(ctrl);
      else if (act === "remove-seg") actions.removeSegment(ctrl);
      else if (act === "select-seg") actions.selectSegment(ctrl, +el.getAttribute("data-seg"));
    });
    root.addEventListener("pointerdown", function (e) {
      var ctrl = root._dyTlCtrl;
      var edge = e.target && e.target.closest ? e.target.closest("[data-drag-edge]") : null;
      if (!edge || !ctrl) return;
      var idx = +edge.getAttribute("data-seg");
      var side = edge.getAttribute("data-drag-edge");
      var segEl = edge.closest("[data-seg]");
      var track = root.querySelector(".dy-track");
      var seg = ctrl.state.segments[idx];
      if (!seg || !track || typeof track.getBoundingClientRect !== "function") return;
      var rect = track.getBoundingClientRect();
      if (!rect.width) return;
      var lay = layout(ctrl.state);
      var pxPerSec = rect.width / (lay.total || 1);
      var startX = e.clientX;
      var baseSeconds = seg.seconds;
      var framesEl = segEl ? segEl.querySelector(".dy-seg-frames") : null;
      function onMove(ev) {
        var raw = edgeDragToSeconds(baseSeconds, side, (ev.clientX - startX) / pxPerSec);
        var snapped = S().secondsToFrames(raw);
        // 拖拽实时反馈:块宽近似伸缩+双单位标签(松手才进 state=免抖动写)
        if (segEl) segEl.style.width = Math.max(2, (S().framesToSeconds(snapped) / (lay.total || 1)) * 100) + "%";
        if (framesEl) framesEl.textContent = raw + "s→" + snapped + "f(贴网格)";
      }
      function onUp(ev) {
        (global.removeEventListener || function () {})("pointermove", onMove);
        (global.removeEventListener || function () {})("pointerup", onUp);
        var raw = edgeDragToSeconds(baseSeconds, side, (ev.clientX - startX) / pxPerSec);
        actions.setSegmentSeconds(root._dyTlCtrl || ctrl, idx, raw);
      }
      (global.addEventListener || function () {})("pointermove", onMove);
      (global.addEventListener || function () {})("pointerup", onUp);
      if (e.preventDefault) e.preventDefault();
    });
  }

  global.DaoyanTimeline = { build: build, css: CSS, actions: actions, layout: layout, edgeDragToSeconds: edgeDragToSeconds };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
