// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:2877 _writeTimelineWidget / :1994 parseTimeline /
// :154 TIMELINE_SYNC_DEBOUNCE_MS —— 隐藏 STRING widget timeline_data 单通道
// +500ms 去抖写回+强 flush;布局复刻、代码重写(PRD R3)。
//
// timeline_data 序列化/反序列化(阶段1=读通道骨架:面板↔节点唯一通道,
// 禁自造第二 widget 通道;写回去抖/入队强 flush 排阶段2 接事件)。
// 双轨装载:引擎侧经 index.js 以 ES module 副作用导入;preview.html 以
// 普通 <script> 直开(file:// 下 module 跨文件导入被浏览器 CORS 拒)。
// 故本件不用 import/export 语法,IIFE 挂 window.DaoyanSerial。
(function (global) {
  "use strict";

  /** 去抖间隔(AIMixer 同值 500ms) */
  var TIMELINE_SYNC_DEBOUNCE_MS = 500;
  /** payload 版本(与节点侧 my_director_console.TIMELINE_VERSION 对齐) */
  var TIMELINE_VERSION = 1;
  /** 阶段勾选默认(勾啥跑啥,PRD R1.5;空台本三不勾) */
  var DEFAULT_STAGES = { yicai: false, ercai: false, sancai: false };
  /** 时长贴网格:17k+5 帧(5s→124f;PRD R1.5) */
  var FRAME_GRID = { k: 17, bias: 5 };

  /** 秒 → 17k+5 帧网格(就近合法档) */
  function secondsToFrames(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return FRAME_GRID.bias;
    var n = Math.max(1, Math.round((seconds * 25 - FRAME_GRID.bias) / FRAME_GRID.k));
    return n * FRAME_GRID.k + FRAME_GRID.bias;
  }

  /** timeline_data JSON → 面板状态(空/坏值兜底;与节点侧 parse_timeline 同构) */
  function parseTimeline(raw) {
    var payload = {
      version: TIMELINE_VERSION,
      chapter: "chapter-b001",
      stages: { yicai: DEFAULT_STAGES.yicai, ercai: DEFAULT_STAGES.ercai, sancai: DEFAULT_STAGES.sancai },
      segments: [],
    };
    if (!raw) return payload;
    var data;
    try { data = JSON.parse(raw); } catch (err) { return payload; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return payload;
    if (data.stages && typeof data.stages === "object") {
      ["yicai", "ercai", "sancai"].forEach(function (key) {
        var v = data.stages[key];
        payload.stages[key] = typeof v === "boolean" ? v : DEFAULT_STAGES[key];
      });
    }
    if (Array.isArray(data.segments)) payload.segments = data.segments;
    if (typeof data.chapter === "string" && data.chapter) payload.chapter = data.chapter;
    if (typeof data.version === "number") payload.version = data.version;
    return payload;
  }

  /** 面板状态 → timeline_data JSON(阶段1 骨架:stages/chapter/segments 透传) */
  function buildTimelinePayload(state) {
    var payload = parseTimeline(JSON.stringify(state || {}));
    return JSON.stringify(payload);
  }

  /** 从节点 widgets 里找 timeline_data 通道并解析(AIMixer 构造器
   * parseTimeline(this.timelineWidget?.value) 同构,minimax_timeline.js:2283) */
  function readTimelineWidget(node) {
    if (!node || !node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++) {
      var w = node.widgets[i];
      if (w && w.name === "timeline_data") return parseTimeline(w.value);
    }
    return null;
  }

  /** 写回器:commit=500ms 去抖攒写,flush=强刷(入队前/执行事件时调,
   * AIMixer scheduleTimelineSync/_writeTimelineWidget+queuePrompt patch 同构;
   * 阶段1 仅 API 骨架,事件接线排阶段2) */
  function makeWriter(widget) {
    var timer = null;
    var pending = null;
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending !== null && widget) {
        widget.value = pending;
        pending = null;
      }
    }
    return {
      commit: function (payloadJson) {
        pending = String(payloadJson == null ? "" : payloadJson);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, TIMELINE_SYNC_DEBOUNCE_MS);
      },
      flush: flush,
      pending: function () { return pending; },
    };
  }

  global.DaoyanSerial = {
    TIMELINE_SYNC_DEBOUNCE_MS: TIMELINE_SYNC_DEBOUNCE_MS,
    TIMELINE_VERSION: TIMELINE_VERSION,
    DEFAULT_STAGES: DEFAULT_STAGES,
    FRAME_GRID: FRAME_GRID,
    secondsToFrames: secondsToFrames,
    parseTimeline: parseTimeline,
    buildTimelinePayload: buildTimelinePayload,
    readTimelineWidget: readTimelineWidget,
    makeWriter: makeWriter,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
