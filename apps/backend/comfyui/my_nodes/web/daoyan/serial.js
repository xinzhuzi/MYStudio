// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:2877 _writeTimelineWidget / :1994 parseTimeline /
// :154 TIMELINE_SYNC_DEBOUNCE_MS —— 隐藏 STRING widget timeline_data 单通道
// +500ms 去抖写回+强 flush;布局复刻、代码重写(PRD R3)。
//
// timeline_data 序列化/反序列化+面板控制器(阶段2 交互核心)。
// 双轨装载:引擎侧经 index.js 以 ES module 副作用导入;preview.html /
// 测试件以普通 <script>/vm 直开。故本件不用 import/export 语法,
// IIFE 挂 window.DaoyanSerial。
//
// canonical timeline_data schema(阶段2,节点侧 parse_timeline 透传兼容):
// {
//   version: 1,
//   chapter: "chapter-b001",
//   stages: { yicai:bool, ercai:bool, sancai:bool },   // 勾啥跑啥(PRD R1.5)
//   color_fix: "none"|"adain"|"wavelet",                // 三采(PRD R1.7)
//   common_images: ["canon-jc.png", ...],               // 公共图区(全章共享)
//   common_params: { enabled:bool, seconds:num, seed:num, match:str },
//   advanced: { first_steps, second_steps, sampler, scheduler, cfg },
//   perf: { free_h3, vram_clear, resume, gallery },
//   segments: [{
//     id, mode(t2v/i2v/fl2v/r2v), seconds, frames(17k+5 贴网格),
//     seed(null=继承全局), match(参考图尺寸 match▾), rerun(单镜重掷态),
//     use_common(本组禁用公共参数=false),
//     prompt: { summary, retention, description, soundscape },
//     images: ["sb001_scene.jpg", ...]                  // 本组图区(文件名引用)
//   }]
// }
// 旧台账兼容:chapter-script.json(批量役 1112 同 schema 导入,PRD R1.6)
// → chapterScriptToState():shots[] 逐镜映射 segments[](refs 取 basename
// =input/ 文件名引用口径,prompt 整段→description)。
(function (global) {
  "use strict";

  /** 去抖间隔(AIMixer 同值 500ms) */
  var TIMELINE_SYNC_DEBOUNCE_MS = 500;
  /** payload 版本(与节点侧 my_director_console.TIMELINE_VERSION 对齐) */
  var TIMELINE_VERSION = 1;
  /** 阶段勾选默认(勾啥跑啥,PRD R1.5;空台本三不勾) */
  var DEFAULT_STAGES = { yicai: false, ercai: false, sancai: false };
  /** 时长贴网格:17k+5 帧 @25fps(5s→124f;PRD R1.5) */
  var FRAME_GRID = { k: 17, bias: 5, fps: 25 };
  /** 每镜 task 四选一(混合时间线,AIMixer 同谱系;默认 r2v=产线口径) */
  var SEGMENT_MODES = ["t2v", "i2v", "fl2v", "r2v"];
  /** 参考图尺寸 match▾ 档(默认 match=跟参考图) */
  var MATCH_MODES = ["match", "16:9", "4:3", "1:1"];
  /** 三采 color_fix 档(PRD R1.7) */
  var COLOR_FIX_MODES = ["none", "adain", "wavelet"];
  /** 高级采样产线验证档(偏离即黄条警示,PRD R1.7) */
  var ADVANCED_DEFAULTS = { first_steps: 8, second_steps: 3, sampler: "lcm", scheduler: "simple", cfg: 1.0 };
  /** 性能区默认(全开) */
  var PERF_DEFAULTS = { free_h3: true, vram_clear: true, resume: true, gallery: true };
  /** 引擎参考图槽上限(三采 AUTOGROW max=9 口径,公共+本组合计) */
  var MAX_REFERENCE_IMAGES = 9;

  /** 秒 → 17k+5 帧网格(就近合法档) */
  function secondsToFrames(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return FRAME_GRID.bias;
    var n = Math.max(1, Math.round((seconds * FRAME_GRID.fps - FRAME_GRID.bias) / FRAME_GRID.k));
    return n * FRAME_GRID.k + FRAME_GRID.bias;
  }

  /** 帧 → 秒(双单位显示用,两位小数) */
  function framesToSeconds(frames) {
    if (!isFinite(frames) || frames <= 0) return 0;
    return Math.round((frames / FRAME_GRID.fps) * 100) / 100;
  }

  /** 节点收起态摘要行(PRD R1.6-1):「3 组 · 45s · r2v」——组数/全片
   * 时长(帧折秒累计)/主 mode(出现最多的 task;并列取先见者) */
  function summaryLine(state) {
    var segs = (state && state.segments) || [];
    if (!segs.length) return "0 组 · 待添加";
    var total = 0;
    var counts = {};
    var best = null;
    for (var i = 0; i < segs.length; i++) {
      total += framesToSeconds(segs[i].frames);
      var m = segs[i].mode;
      counts[m] = (counts[m] || 0) + 1;
      if (best === null || counts[m] > counts[best]) best = m;
    }
    return segs.length + " 组 · " + (Math.round(total * 100) / 100) + "s · " + best;
  }

  function num(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }
  function intOrNull(v) {
    if (v == null || v === "") return null;
    var n = Math.round(Number(v));
    return isFinite(n) ? n : null;
  }
  function strList(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
      if (typeof v[i] === "string" && v[i].trim()) out.push(v[i].trim());
    }
    return out;
  }
  function pick(v, allowed, fallback) {
    return allowed.indexOf(v) >= 0 ? v : fallback;
  }

  /** 单段规范化(所有入口字段兜底;frames 恒=seconds 贴网格的派生值) */
  function normalizeSegment(seg, idx) {
    seg = seg && typeof seg === "object" ? seg : {};
    var seconds = num(seg.seconds, framesToSeconds(num(seg.frames, 124)) || 5);
    if (seconds <= 0) seconds = 5;
    seconds = Math.round(seconds * 100) / 100;
    var prompt = seg.prompt && typeof seg.prompt === "object" ? seg.prompt : {};
    return {
      id: typeof seg.id === "string" && seg.id ? seg.id : "镜头" + (idx + 1),
      mode: pick(seg.mode, SEGMENT_MODES, "r2v"),
      seconds: seconds,
      frames: secondsToFrames(seconds),
      seed: intOrNull(seg.seed),
      match: pick(seg.match, MATCH_MODES, "match"),
      rerun: seg.rerun === true,
      use_common: seg.use_common === false ? false : true,
      prompt: {
        summary: typeof prompt.summary === "string" ? prompt.summary : "",
        retention: typeof prompt.retention === "string" ? prompt.retention : "",
        description: typeof prompt.description === "string" ? prompt.description : "",
        soundscape: typeof prompt.soundscape === "string" ? prompt.soundscape : "",
      },
      images: strList(seg.images),
    };
  }

  /** timeline_data(任意:JSON 串/对象/空)→ canonical state(全字段兜底) */
  function normalizeState(raw) {
    var data = raw;
    if (typeof raw === "string" && raw.trim()) {
      try { data = JSON.parse(raw); } catch (err) { data = null; }
    } else if (typeof raw !== "object" || raw === null) {
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    var stagesIn = data.stages && typeof data.stages === "object" ? data.stages : {};
    var cpIn = data.common_params && typeof data.common_params === "object" ? data.common_params : {};
    var advIn = data.advanced && typeof data.advanced === "object" ? data.advanced : {};
    var perfIn = data.perf && typeof data.perf === "object" ? data.perf : {};
    var commonSeconds = Math.round(num(cpIn.seconds, 5) * 100) / 100;
    if (commonSeconds <= 0) commonSeconds = 5;
    var segments = [];
    if (Array.isArray(data.segments)) {
      for (var i = 0; i < data.segments.length; i++) segments.push(normalizeSegment(data.segments[i], i));
    }
    var advanced = {};
    for (var k in ADVANCED_DEFAULTS) advanced[k] = num(advIn[k], ADVANCED_DEFAULTS[k]);
    var perf = {};
    for (var p in PERF_DEFAULTS) perf[p] = perfIn[p] === false ? false : true;
    return {
      version: typeof data.version === "number" ? data.version : TIMELINE_VERSION,
      chapter: typeof data.chapter === "string" && data.chapter ? data.chapter : "chapter-b001",
      stages: {
        yicai: stagesIn.yicai === true,
        ercai: stagesIn.ercai === true,
        sancai: stagesIn.sancai === true,
      },
      color_fix: pick(data.color_fix, COLOR_FIX_MODES, "none"),
      common_images: strList(data.common_images),
      common_params: {
        enabled: cpIn.enabled === false ? false : true,
        seconds: commonSeconds,
        seed: intOrNull(cpIn.seed) == null ? 42 : intOrNull(cpIn.seed),
        match: pick(cpIn.match, MATCH_MODES, "match"),
      },
      advanced: advanced,
      perf: perf,
      segments: segments,
    };
  }

  /** 面板状态 → timeline_data JSON(canonical 化再序列化=roundtrip 稳定) */
  function buildTimelinePayload(state) {
    return JSON.stringify(normalizeState(state));
  }

  /** 兼容别名:阶段1 导出名(parseTimeline 现即 normalizeState) */
  function parseTimeline(raw) { return normalizeState(raw); }

  /** 从节点 widgets 里找 timeline_data 通道并解析 */
  function readTimelineWidget(node) {
    if (!node || !node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++) {
      var w = node.widgets[i];
      if (w && w.name === "timeline_data") return normalizeState(w.value);
    }
    return null;
  }

  /** 写回器:commit=去抖攒写,flush=强刷(入队前/执行事件时调,
   * AIMixer scheduleTimelineSync/_writeTimelineWidget 同构) */
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

  /**
   * 旧台账 chapter-script.json(批量役 1112)→ canonical state。
   * schema:{chapter, mode, frames, shots:[{id,seed,refs[],prompt}]}
   * 映射:refs 取 basename(input/ 文件名引用);prompt→description;
   * frames→seconds(framesToSeconds);seed 逐镜携带。
   * @returns {object|null} 坏 JSON 返回 null
   */
  function chapterScriptToState(text) {
    var data;
    try { data = typeof text === "string" ? JSON.parse(text) : text; }
    catch (err) { return null; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    var shots = Array.isArray(data.shots) ? data.shots : [];
    var segments = [];
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i] && typeof shots[i] === "object" ? shots[i] : {};
      var refs = strList(s.refs).map(function (p) {
        var parts = String(p).split("/");
        return parts[parts.length - 1];
      });
      segments.push(normalizeSegment({
        id: typeof s.id === "string" && s.id ? s.id : "镜头" + (i + 1),
        mode: pick(data.mode, SEGMENT_MODES, "r2v"),
        frames: num(data.frames, 124),
        seed: intOrNull(s.seed),
        match: "match",
        prompt: { description: typeof s.prompt === "string" ? s.prompt : "" },
        images: refs,
      }, i));
    }
    var state = normalizeState({ chapter: data.chapter });
    state.segments = segments;
    return state;
  }

  /**
   * 面板控制器(阶段2 交互核心):state+view+undo 快照栈+去抖写回+订阅重渲。
   * 与 AIMixer 编辑器类职责对应但拆写为纯控制器(无 DOM;DOM 在组件件)。
   * @param {object} opts { read():string|null, write(json), initial, debounceMs, maxUndo }
   */
  function createController(opts) {
    opts = opts || {};
    var debounceMs = num(opts.debounceMs, TIMELINE_SYNC_DEBOUNCE_MS);
    var maxUndo = Math.max(1, num(opts.maxUndo, 60));
    var state = normalizeState(opts.initial != null ? opts.initial
      : (typeof opts.read === "function" ? opts.read() : null));
    var view = { selected: 0, running: false, done: 0, armedDelete: -1, commonExpanded: false };
    var undoStack = [];
    var subs = [];
    var timer = null;
    var dirty = false;
    var lastCoalesce = { key: null, at: 0 };
    var api;

    function notify() {
      for (var i = 0; i < subs.length; i++) {
        try { subs[i](api); } catch (err) { /* 订阅者故障不咬主路 */ }
      }
    }
    function scheduleCommit() {
      dirty = true;
      if (typeof opts.write !== "function") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    }
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (dirty) {
        dirty = false;
        if (typeof opts.write === "function") opts.write(buildTimelinePayload(state));
      }
    }
    /** 快照入栈;coalesceKey=同键 1.5s 内合并(打字连击不爆栈) */
    function snapshot(coalesceKey) {
      var now = Date.now();
      if (coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < 1500) {
        lastCoalesce.at = now;
        return;
      }
      undoStack.push(JSON.stringify(state));
      if (undoStack.length > maxUndo) undoStack.shift();
      lastCoalesce = { key: coalesceKey || null, at: now };
    }
    function clampSelection() {
      var n = state.segments.length;
      view.selected = n ? Math.min(Math.max(0, view.selected), n - 1) : 0;
    }
    /** 编辑入口:mutator(state) 改 canonical state;改毕重规范化+通知+去抖提交 */
    function apply(mutator, coalesceKey) {
      applySilent(mutator, coalesceKey);
      notify();
      return api;
    }
    /** 静默编辑:写 state+去抖提交,不通知重渲(打字中 textarea 免焦点丢失) */
    function applySilent(mutator, coalesceKey) {
      snapshot(coalesceKey);
      if (typeof mutator === "function") mutator(state);
      state = normalizeState(state);
      clampSelection();
      scheduleCommit();
      return api;
    }
    /** Ctrl+Z 快照栈回退(PRD R1.6;AIMixer 无 undo,我方补上) */
    function undo() {
      if (!undoStack.length) return false;
      state = normalizeState(undoStack.pop());
      lastCoalesce = { key: null, at: 0 };
      view.armedDelete = -1;
      clampSelection();
      scheduleCommit();
      notify();
      return true;
    }
    /** onConfigure 读回恢复:widget 值(外部写入/工作流加载)→ state */
    function reload() {
      if (typeof opts.read === "function") {
        state = normalizeState(opts.read());
        clampSelection();
      }
      dirty = false;
      notify();
    }
    /** 旧台账导入(「导入导演包」兼容 chapter-script.json,PRD R1.6) */
    function importChapterScript(text) {
      var next = chapterScriptToState(text);
      if (!next) return { ok: false, count: 0 };
      apply(function (st) {
        st.chapter = next.chapter;
        st.segments = next.segments;
      });
      return { ok: true, count: next.segments.length };
    }
    /** 导出导演包(同 schema 交换格式=canonical 全字段;与 toolbar
     * importPayload 新 schema 分支逐字段对称,自导出包回导零丢失;
     * 面板=唯一交互真源,Q4 终裁) */
    function exportPayload() { return buildTimelinePayload(state); }

    api = {
      // state 活引用(apply/undo/reload 均整体置换 state 对象,静态属性
      // 会滞留旧引用——getter 保证组件/测试恒见最新)
      get state() { return state; },
      view: view,
      apply: apply,
      applySilent: applySilent,
      undo: undo,
      canUndo: function () { return undoStack.length > 0; },
      flush: flush,
      reload: reload,
      subscribe: function (fn) { if (typeof fn === "function") subs.push(fn); return fn; },
      selectedSegment: function () { return state.segments[view.selected] || null; },
      importChapterScript: importChapterScript,
      exportPayload: exportPayload,
      /** 测试/预览专用:窥探 undo 深度 */
      undoDepth: function () { return undoStack.length; },
    };
    return api;
  }

  /**
   * 阶段1 静态演示态适配器:旧 preview.html 传裸 state 对象(无 apply),
   * 组件用它包成 no-op 控制器=静态渲染不断档(阶段1 视觉门材料保活)。
   */
  function demoController(legacyState) {
    var st = normalizeState(legacyState || {});
    return {
      state: st,
      view: { selected: 0, running: false, done: 0, armedDelete: -1, commonExpanded: false },
      apply: function () { return this; },
      applySilent: function () { return this; },
      undo: function () { return false; },
      canUndo: function () { return false; },
      flush: function () {},
      reload: function () {},
      subscribe: function () {},
      selectedSegment: function () { return st.segments[0] || null; },
      importChapterScript: function () { return { ok: false, count: 0 }; },
      exportPayload: function () { return buildTimelinePayload(st); },
      undoDepth: function () { return 0; },
    };
  }

  /** 组件入口统一解析:控制器直用,裸 state 包 demo 控制器 */
  function ctrlOf(ctx) {
    if (ctx && typeof ctx.apply === "function" && ctx.state) return ctx;
    return demoController(ctx);
  }

  global.DaoyanSerial = {
    TIMELINE_SYNC_DEBOUNCE_MS: TIMELINE_SYNC_DEBOUNCE_MS,
    TIMELINE_VERSION: TIMELINE_VERSION,
    DEFAULT_STAGES: DEFAULT_STAGES,
    FRAME_GRID: FRAME_GRID,
    SEGMENT_MODES: SEGMENT_MODES,
    MATCH_MODES: MATCH_MODES,
    COLOR_FIX_MODES: COLOR_FIX_MODES,
    ADVANCED_DEFAULTS: ADVANCED_DEFAULTS,
    PERF_DEFAULTS: PERF_DEFAULTS,
    MAX_REFERENCE_IMAGES: MAX_REFERENCE_IMAGES,
    secondsToFrames: secondsToFrames,
    framesToSeconds: framesToSeconds,
    summaryLine: summaryLine,
    normalizeSegment: normalizeSegment,
    normalizeState: normalizeState,
    buildTimelinePayload: buildTimelinePayload,
    parseTimeline: parseTimeline,
    readTimelineWidget: readTimelineWidget,
    makeWriter: makeWriter,
    chapterScriptToState: chapterScriptToState,
    createController: createController,
    demoController: demoController,
    ctrlOf: ctrlOf,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
