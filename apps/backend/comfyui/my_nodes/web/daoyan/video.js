// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// DaoyanVideo:面板内视频播放浮层(1115 缺口3)。
//
// cards.artBadge / toolbar galleryPanel 产物徽章的播放面:target=_blank
// 新页通道退场,data-view 承载解析后 /view URL→本浮层 open 直看。
// 全屏遮罩(div.dy-video-mask[data-act=video-close]>video[controls autoplay])
// 自挂 document.body(live.js 自持 DOM 纪律,不进控制器重渲环);
// 样式全内联(零 style 注入);src 恒 esc()。遮罩空白/✕ 点击=关,
// 视频本体与控制条点击不关。
// 双轨装载同 serial.js 头注口径:IIFE 挂 window.DaoyanVideo,无 import/export。
(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var state = { open: false, url: "", title: "" };
  var el = null;

  /** 遮罩 html(纯函数;无参=当前 state;src/title 恒 esc) */
  function overlayHtml(url, title) {
    var u = String(url == null ? state.url : url);
    var t = String(title == null ? state.title : title);
    return '<div class="dy-video-mask" data-act="video-close"'
      + ' style="position:fixed;inset:0;z-index:99999;background:rgba(3,6,12,.9);'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">'
      + '<div style="display:flex;align-items:center;gap:10px;max-width:92vw;">'
      + '<span style="font:600 12px/1.6 -apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;'
      + 'color:#dbe7fb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
      + esc(t || "产物回看") + "</span>"
      + '<i data-act="video-close" style="font-style:normal;font-size:15px;color:#9aa7ba;'
      + 'cursor:pointer;padding:2px 8px;" title="关闭">✕</i></div>'
      + '<video controls autoplay src="' + esc(u) + '"'
      + ' style="max-width:92vw;max-height:76vh;border-radius:10px;background:#000;'
      + 'box-shadow:0 16px 44px -6px rgba(0,0,0,.8);"></video>'
      + '<span style="font:400 10px/1.6 -apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;'
      + 'color:#7d8b9f;">点击空白处或 ✕ 关闭</span>'
      + "</div>";
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("video")) return; // 播放器/控制条点击不关
    if (t.closest('[data-act="video-close"]')) close();
  }

  function open(url, title) {
    if (!url) return false;
    state = { open: true, url: String(url), title: String(title || "") };
    if (document && document.createElement) {
      if (!el) {
        el = document.createElement("div");
        if (el.addEventListener) el.addEventListener("click", onClick);
      }
      el.innerHTML = overlayHtml();
      if (document.body && document.body.appendChild) document.body.appendChild(el);
    }
    return true;
  }

  function close() {
    state = { open: false, url: "", title: "" };
    if (el && el.remove) { try { el.remove(); } catch (err) { /* stub 容错 */ } }
    el = null;
    return true;
  }

  global.DaoyanVideo = {
    open: open,
    close: close,
    state: function () { return JSON.parse(JSON.stringify(state)); },
    overlayHtml: overlayHtml,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
