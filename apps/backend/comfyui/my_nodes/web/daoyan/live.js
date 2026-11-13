// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:12235 setLiveSamplePreview / :3096-3115 .bd-live-sample
// ——引擎 api 事件「实时采样帧」→面板预览条消费(AIMixer 事件名
// minimax_director_preview,我方 daoyan_preview 同构语义,阶段3 执行链
// 端发射;1114 缺口③=通道先行接线,发射端随执行链落位)。
//
// DaoyanLive:事件消费+预览条渲染(自持 DOM 更新,不咬控制器重渲环)。
// payload schema(阶段3 执行链发射方契约):
//   { node_id:str, segment_index:int, url:str(/view 或 data:), step:int,
//     total:int, at:epoch_ms? }
// 双轨装载同 serial.js 头注口径:IIFE 挂 window.DaoyanLive,无 import/export。
(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /** 已绑定面板宿主(引擎壳/preview;多导演台节点各绑各的) */
  var hosts = [];
  /** 预览开关(toolbar 实时预览按钮驱动) */
  var enabled = false;
  /** 最近样本(留 8 帧滚动条) */
  var samples = [];
  var MAX_SAMPLES = 8;

  function latest() { return samples.length ? samples[samples.length - 1] : null; }

  function innerHtml() {
    var s = latest();
    if (!s) {
      return '<div class="dy-live-info">实时预览已开启 · 候采样事件<br>'
        + '<span style="color:#9aa7ba">阶段3 执行链发射 daoyan_preview 后,此处逐帧点亮</span></div>';
    }
    var strip = samples.map(function (f) {
      return '<img loading="lazy" src="' + esc(f.url) + '" alt="实时帧">';
    }).join("");
    return '<img class="dy-live-frame" src="' + esc(s.url) + '" alt="最新实时帧">'
      + '<div class="dy-live-info">第 ' + ((s.segment_index || 0) + 1) + " 镜 · 步 "
      + (s.step || "?") + "/" + (s.total || "?") + "<br>"
      + '<span style="color:#9aa7ba">共 ' + samples.length + " 帧样本</span></div>"
      + '<div class="dy-live-strip">' + strip + "</div>";
  }

  function renderAll() {
    if (!enabled) return;
    for (var i = 0; i < hosts.length; i++) {
      var el = hosts[i].querySelector ? hosts[i].querySelector(".daoyan-live") : null;
      if (el) el.innerHTML = innerHtml();
    }
  }

  var live = {
    /** 宿主绑定(引擎 mountPanel/preview 装载时各绑各的) */
    bindHost: function (host) {
      if (host && hosts.indexOf(host) < 0) hosts.push(host);
      return hosts.length;
    },
    /** 开关(toolbar.toggleLivePreview 驱动;开=即时渲染当前样本) */
    setEnabled: function (on) {
      enabled = !!on;
      renderAll();
      return enabled;
    },
    enabled: function () { return enabled; },
    /** 事件入口(index.js:api.addEventListener("daoyan_preview") 路由) */
    onSample: function (payload) {
      if (!payload || typeof payload !== "object" || !payload.url) return false;
      samples.push({
        url: String(payload.url),
        segment_index: payload.segment_index | 0,
        step: payload.step == null ? null : payload.step,
        total: payload.total == null ? null : payload.total,
      });
      if (samples.length > MAX_SAMPLES) samples.shift();
      renderAll();
      return true;
    },
    /** 预览条 html(toolbar 在 livePreview 开启时嵌板) */
    panelHtml: function () {
      return '<div class="daoyan-live">' + innerHtml() + "</div>";
    },
    /** 测试钩子:当前样本快照 */
    lastSample: function () {
      var s = latest();
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
    /** 测试钩子:清空 */
    reset: function () { samples = []; enabled = false; renderAll(); },
  };

  global.DaoyanLive = live;
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
