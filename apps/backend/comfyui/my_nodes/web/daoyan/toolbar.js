// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:2906-2945 业务工具条(bd-toolbar/bd-right 导入导出)
// 与 :3287-3300 运行状态条(bd-run-status 进度)——布局复刻、代码重写
// (PRD R3;我方语义=运行范围三勾选/章节名/选择运行/导演包/取消/进度,
// PRD R1.5/R1.8)。
// 输出条:minimax_timeline.js:3004-3093 .bd-output(outputBar)+:6539
// syncOutputUIFromTimeline——1113 阶段1.5 补丁① 输出条独立渲染。
//
// 业务条(阶段2 交互):三勾选写 timeline_data.stages(勾啥跑啥)/章节名
// 写回/选择运行→取消按钮态切换+进度条占位(执行链排阶段3)/导入导演包
// (旧台账 chapter-script.json 兼容)/导出导演包(同 schema)/撤销入口。
// IIFE 挂 window.DaoyanToolbar,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:9px 12px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".dy-stage-box{display:flex;align-items:center;gap:3px;background:rgba(52,211,153,.09);border:1px solid rgba(52,211,153,.3);border-radius:9px;padding:3px 8px;}",
    ".dy-stage-box label{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:#d9f7ea;cursor:pointer;padding:1px 4px;}",
    ".dy-stage-box input{accent-color:#34d399;cursor:pointer;}",
    ".dy-chapter{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#9aa7ba;}",
    ".dy-chapter input{width:110px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,24,.72);color:#dbe7fb;padding:3px 8px;font:inherit;outline:none;}",
    ".dy-chapter input:focus{border-color:rgba(110,168,254,.55);}",
    ".dy-btn{font-size:11px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:3.5px 11px;cursor:pointer;white-space:nowrap;}",
    ".dy-btn--primary{background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.16));border-color:rgba(52,211,153,.5);color:#eafff5;}",
    ".dy-btn--ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#9aa7ba;}",
    ".dy-btn--cancel{background:rgba(248,113,113,.14);border-color:rgba(248,113,113,.45);color:#fecaca;}",
    ".dy-btn[disabled]{opacity:.45;cursor:default;}",
    ".dy-progress{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:200px;}",
    ".dy-progress-text{font-size:10.5px;color:#9aa7ba;white-space:nowrap;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-progress-bar{flex:1;height:5px;min-width:80px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;}",
    ".dy-progress-bar>i{display:block;height:100%;width:0%;border-radius:3px;background:linear-gradient(90deg,#4f8fe0,#34d399);transition:width .3s ease;}",
    /* 输出条(1113 阶段1.5 补丁①;AIMixer .bd-output 同构) */
    ".daoyan-output{display:flex;flex-direction:column;gap:7px;padding:8px 12px 9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));margin-top:8px;}",
    ".dy-out-title{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#f0f4fa;}",
    ".dy-out-title .dy-hint{font-size:10px;font-weight:400;color:#9aa7ba;}",
    ".dy-out-rows{display:flex;flex-direction:column;gap:6px;}",
    ".dy-out-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}",
    ".dy-ocap{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:#cfd8e6;background:linear-gradient(180deg,#242b3a,#1a202b);border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:3.5px 11px;white-space:nowrap;cursor:default;}",
    ".dy-ocap b{color:#f5cd6d;font-weight:700;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;}",
    ".dy-ocap--check{gap:5px;padding:3.5px 10px;}",
    ".dy-ocap--check input{accent-color:#34d399;cursor:pointer;}",
    ".dy-btn--live{background:linear-gradient(180deg,rgba(52,211,153,.32),rgba(52,211,153,.18));border-color:rgba(52,211,153,.55);color:#eafff5;}",
    ".dy-btn--live[disabled]{opacity:.92;}",
    ".dy-import-file{display:none;}",
  ].join("\n");

  var STYLE_ID = "daoyan-toolbar-style";

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

  function S() { return global.DaoyanSerial; }

  function ocap(label, value, extraClass) {
    return '<span class="dy-ocap' + (extraClass ? " " + extraClass : "") + '">'
      + label + ' <b>' + value + "</b></span>";
  }

  // ── 动作 ───────────────────────────────────────────────────────────

  var actions = {
    /** 三勾选联动:写 timeline_data.stages(勾啥跑啥,PRD R1.5) */
    setStage: function (ctrl, key, on) {
      if (!(key in S().DEFAULT_STAGES)) return false;
      ctrl.apply(function (st) { st.stages[key] = !!on; });
      return true;
    },
    /** 章节名(产物目录 video/导演台/{章节}/{镜id}/ 同步引用,PRD R1.8) */
    setChapter: function (ctrl, name) {
      var v = String(name || "").trim();
      ctrl.apply(function (st) { st.chapter = v || "chapter-b001"; }, "chapter");
      return ctrl.state.chapter;
    },
    /** 选择运行→运行态(取消钮活/进度走;执行链排阶段3,此处=按钮态机) */
    startRun: function (ctrl) {
      ctrl.view.running = true;
      ctrl.view.done = 0;
      ctrl.apply(function () {});
      return true;
    },
    /** 取消:中断后续镜,已完镜产物保留(检查点语义,PRD R1.8) */
    cancelRun: function (ctrl) {
      ctrl.view.running = false;
      ctrl.view.done = 0;
      ctrl.apply(function () {});
      return true;
    },
    /** 导入导演包:双 schema 分流——旧台账 chapter-script.json(shots[]
     * 逐镜)直读(PRD R1.6);新 schema 导出包(segments[])整包载入
     * (全字段保全:stages/color_fix/common_params/advanced/perf 一并
     * 回填——导出=buildTimelinePayload 全量,导入逐字段对称=交换格式
     * 闭环,自导出包回导零丢失) */
    importPayload: function (ctrl, text) {
      var raw = null;
      if (typeof text === "string" && text.trim()) {
        try { raw = JSON.parse(text); } catch (err) { raw = null; }
      }
      if (raw && typeof raw === "object" && Array.isArray(raw.shots)) {
        return ctrl.importChapterScript(text); // 旧台账分支(无新字段,默认档)
      }
      if (raw && typeof raw === "object" && Array.isArray(raw.segments)) {
        var next = S().normalizeState(raw);
        ctrl.apply(function (st) {
          st.chapter = next.chapter;
          st.segments = next.segments;
          st.common_images = next.common_images;
          st.stages = next.stages;
          st.color_fix = next.color_fix;
          st.common_params = next.common_params;
          st.advanced = next.advanced;
          st.perf = next.perf;
        });
        return { ok: true, count: next.segments.length };
      }
      return { ok: false, count: 0 };
    },
    /** 导出演演包(同 schema 交换格式;面板=唯一交互真源,Q4 终裁) */
    exportPayload: function (ctrl) { return ctrl.exportPayload(); },
    /** 触发浏览器下载(引擎/预览用;测试直调 exportPayload) */
    downloadPayload: function (ctrl) {
      var json = actions.exportPayload(ctrl);
      try {
        var blob = new Blob([json], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (ctrl.state.chapter || "chapter") + ".daoyan.json";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } catch (err) { /* file:// 等受限环境兜底:不咬主路 */ }
      return json;
    },
    undo: function (ctrl) { return ctrl.undo(); },
  };

  // ── 渲染 ───────────────────────────────────────────────────────────

  /**
   * 渲染业务条+输出条(阶段2 交互)。
   * @param {HTMLElement} root
   * @param {object} ctx DaoyanSerial 控制器(裸 state 自动包 demo 控制器=静态)
   */
  function build(root, ctx) {
    ensureStyle();
    var ctrl = S().ctrlOf(ctx);
    var st = ctrl.state;
    var running = ctrl.view.running;
    var total = st.segments.length;
    var done = Math.min(ctrl.view.done, total);
    var pct = total ? Math.round((done / total) * 100) : 0;
    var stagesLabel = ["yicai:一采", "ercai:二采", "sancai:三采"].filter(function (x) {
      return st.stages[x.split(":")[0]];
    }).map(function (x) { return x.split(":")[1]; }).join("+") || "未勾";
    function box(key, label) {
      return "<label><input type='checkbox' data-act='stage' data-key='" + key + "'"
        + (st.stages[key] ? " checked" : "") + "> " + label + "</label>";
    }
    var businessBar = [
      '<div class="daoyan-toolbar">',
      '<span class="dy-stage-box" title="勾啥跑啥:勾 1=全镜一采草片;1+2=接二采;2 单独=吃盘上 p1 只跑二采;3 单独=吃盘上 p2 只跑三采">',
      box("yicai", "一采"),
      box("ercai", "二采"),
      box("sancai", "三采"),
      "</span>",
      '<span class="dy-chapter">章节 <input value="' + esc(st.chapter) + '" data-act="chapter" title="产物目录 video/导演台/{章节}/{镜id}/ 同步引用"></span>',
      '<button class="dy-btn dy-btn--primary" data-act="run" title="面板编辑→timeline_data 序列化(阶段3 接执行链)">选择运行</button>',
      '<button class="dy-btn" data-act="import" title="兼容批量役 chapter-script.json(同 schema 直读)">导入导演包</button>',
      '<button class="dy-btn" data-act="export" title="导出同 schema 交换格式">导出导演包</button>',
      '<button class="dy-btn' + (running ? " dy-btn--cancel" : " dy-btn--ghost") + '" data-act="cancel"'
      + (running ? "" : " disabled")
      + ' title="中断后续镜,已完镜产物保留(检查点语义)">取消</button>',
      '<button class="dy-btn dy-btn--ghost" data-act="undo"' + (ctrl.canUndo() ? "" : " disabled")
      + ' title="Ctrl+Z 同款:快照栈回退">↩ 撤销</button>',
      '<button class="dy-btn dy-btn--ghost" data-act="gallery" title="章草片/章终片与每镜 p1/p2/p3 产物回看(阶段3 落盘后点亮)">查看产物</button>',
      '<span class="dy-progress">',
      '<span class="dy-progress-text">' + (running
        ? "第 " + done + "/" + total + " 组 · " + stagesLabel + " · 执行链排阶段3"
        : "第 0/" + total + " 组 · 待运行") + "</span>",
      '<span class="dy-progress-bar"><i style="width:' + pct + '%"></i></span>',
      "</span>",
      '<input type="file" class="dy-import-file" data-act="import-file" accept=".json,application/json">',
      "</div>",
    ].join("");
    var outputBar = [
      '<div class="daoyan-output">',
      '<div class="dy-out-title">输出 <span class="dy-hint">渲染输出参数(占位·阶段3 接执行链)</span></div>',
      '<div class="dy-out-rows">',
      '<div class="dy-out-row">',
      ocap("输出分辨率", "16:9 档"),
      ocap("百万像素", "0.4"),
      ocap("帧率", String(S().FRAME_GRID.fps)),
      ocap("声音", "使用原声"),
      ocap("导出方式", "全部导出"),
      "</div>",
      '<div class="dy-out-row">',
      '<span class="dy-ocap dy-ocap--check" title="段间引导:相邻镜首尾衔接"><input type="checkbox" checked data-act="continuity"> 段间引导</span>',
      ocap("上下文帧数", "22"),
      ocap("引导方式", "引导"),
      '<button class="dy-btn dy-btn--live" disabled title="实时预览:采样中实时帧回看(阶段3 接线)">实时预览</button>',
      "</div>",
      "</div>",
      "</div>",
    ].join("");
    root.innerHTML = businessBar + outputBar;
    bind(root, ctrl);
    return root;
  }

  /** 事件:点击/复选/change 委托(重渲防重绑同 timeline.js 手法) */
  function bind(root, ctrl) {
    root._dyToolbarCtrl = ctrl;
    if (root._dyToolbarBound) return;
    root._dyToolbarBound = true;
    root.addEventListener("click", function (e) {
      var ctrl = root._dyToolbarCtrl;
      var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (el && el.getAttribute("data-act") === "stage") return; // 复选走 change
      if (!el || !ctrl) return;
      var act = el.getAttribute("data-act");
      if (act === "run") actions.startRun(ctrl);
      else if (act === "cancel") actions.cancelRun(ctrl);
      else if (act === "undo") actions.undo(ctrl);
      else if (act === "import") {
        var file = root.querySelector('[data-act="import-file"]');
        if (file) file.click();
      } else if (act === "export") actions.downloadPayload(ctrl);
    });
    root.addEventListener("change", function (e) {
      var ctrl = root._dyToolbarCtrl;
      var el = e.target;
      if (!el || !el.getAttribute || !ctrl) return;
      var act = el.getAttribute("data-act");
      if (act === "stage") actions.setStage(ctrl, el.getAttribute("data-key"), el.checked);
      else if (act === "chapter") actions.setChapter(ctrl, el.value);
      else if (act === "import-file" && el.files && el.files.length) {
        var reader = new FileReader();
        reader.onload = function () { actions.importPayload(ctrl, String(reader.result)); };
        reader.readAsText(el.files[0]);
        el.value = "";
      }
    });
  }

  global.DaoyanToolbar = { build: build, css: CSS, actions: actions };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
