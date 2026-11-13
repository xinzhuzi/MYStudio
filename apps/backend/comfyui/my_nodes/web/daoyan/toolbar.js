// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:2906-2945 业务工具条(bd-toolbar/bd-right 导入导出/
// 时间码)与 :3287-3300 运行状态条(bd-run-status 进度)——布局复刻、代码
// 重写(PRD R3;我方语义=运行范围三勾选/章节名/选择运行/导演包/取消/
// 进度,PRD R1.5/R1.8)。
// 输出条:minimax_timeline.js:3004-3093 .bd-output(outputBar)输出参数
// 区+syncOutputUIFromTimeline(:6539)/updateSegmentContinuityUI(:6645,
// 段间引导/上下文帧数行)——布局复刻、代码重写;1113 阶段1.5 补丁①:
// 此前仅在文件头宣称「并业务条查看产物承载」实际未渲染,本补丁在业务条
// 下方补独立「输出」条(全静态占位,字段对齐 AIMixer .bd-output)。
//
// 业务条(阶段1 静态):六区之首。运行范围三勾选=勾啥跑啥(示例态=仅勾
// 一采);进度=第 N/40 组逐镜推进;取消=中断后续镜保已完镜产物。
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
    ".dy-btn{font-size:11px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:3.5px 11px;cursor:default;white-space:nowrap;}",
    ".dy-btn--primary{background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.16));border-color:rgba(52,211,153,.5);color:#eafff5;}",
    ".dy-btn--ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#9aa7ba;}",
    ".dy-btn[disabled]{opacity:.45;}",
    ".dy-progress{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:200px;}",
    ".dy-progress-text{font-size:10.5px;color:#9aa7ba;white-space:nowrap;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-progress-bar{flex:1;height:5px;min-width:80px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;}",
    ".dy-progress-bar>i{display:block;height:100%;width:0%;border-radius:3px;background:linear-gradient(90deg,#4f8fe0,#34d399);}",
    /* 输出条(1113 阶段1.5 补丁①;AIMixer .bd-output 同构,胶囊质感=
       浅描边+深灰底,对齐 params.js 胶囊行口径) */
    ".daoyan-output{display:flex;flex-direction:column;gap:7px;padding:8px 12px 9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));}",
    ".dy-out-title{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#f0f4fa;}",
    ".dy-out-title .dy-hint{font-size:10px;font-weight:400;color:#9aa7ba;}",
    ".dy-out-rows{display:flex;flex-direction:column;gap:6px;}",
    ".dy-out-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}",
    ".dy-ocap{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:#cfd8e6;background:linear-gradient(180deg,#242b3a,#1a202b);border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:3.5px 11px;white-space:nowrap;cursor:default;}",
    ".dy-ocap b{color:#f5cd6d;font-weight:700;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;}",
    ".dy-ocap--check{gap:5px;padding:3.5px 10px;}",
    ".dy-ocap--check input{accent-color:#34d399;cursor:default;}",
    ".dy-btn--live{background:linear-gradient(180deg,rgba(52,211,153,.32),rgba(52,211,153,.18));border-color:rgba(52,211,153,.55);color:#eafff5;}",
    /* 1113 补丁残修:.dy-btn[disabled] 的 opacity .45 盖掉绿,AIMixer 实时预览=亮绿;占位态保持绿相仅示禁用指针 */
    ".dy-btn--live[disabled]{opacity:.92;}",
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

  /** 输出条占位胶囊(1113 阶段1.5 补丁①;AIMixer .bd-output 字段对齐) */
  function ocap(label, value, extraClass) {
    return '<span class="dy-ocap' + (extraClass ? " " + extraClass : "") + '">'
      + label + ' <b>' + value + "</b></span>";
  }

  /**
   * 渲染业务条+输出条(阶段1.5 全静态;示例态=勾一采)。
   * 业务条=六区之首(三勾选/章节名/选择运行/导演包/取消/进度);
   * 输出条=业务条下方独立条,两行占位:第一行输出五参,第二行段间
   * 引导三参+实时预览绿按钮(占位 disabled,AIMixer .bd-live-sample 位)。
   * @param {HTMLElement} root
   * @param {object} state DaoyanSerial.parseTimeline 产物(stages/chapter)
   */
  function build(root, state) {
    ensureStyle();
    var st = (state && state.stages) || { yicai: false, ercai: false, sancai: false };
    var chapter = (state && state.chapter) || "chapter-b001";
    function box(key, label) {
      var on = st[key] === true;
      return "<label><input type='checkbox'" + (on ? " checked" : "") + "> " + label + "</label>";
    }
    var businessBar = [
      '<div class="daoyan-toolbar">',
      '<span class="dy-stage-box" title="勾啥跑啥:勾 1=全镜一采草片;1+2=接二采;2 单独=吃盘上 p1 只跑二采;3 单独=吃盘上 p2 只跑三采">',
      box("yicai", "一采"),
      box("ercai", "二采"),
      box("sancai", "三采"),
      "</span>",
      '<span class="dy-chapter">章节 <input value="' + esc(chapter) + '" title="产物目录 video/导演台/{章节}/{镜id}/ 同步引用"></span>',
      '<button class="dy-btn dy-btn--primary">选择运行</button>',
      '<button class="dy-btn">导入导演包</button>',
      '<button class="dy-btn">导出导演包</button>',
      '<button class="dy-btn dy-btn--ghost" disabled title="跑批中断后续镜,已完镜产物保留(检查点语义)">取消</button>',
      '<button class="dy-btn dy-btn--ghost" title="输出条:章草片/章终片与每镜 p1/p2/p3 产物回看">查看产物</button>',
      '<span class="dy-progress">',
      '<span class="dy-progress-text">第 0/40 组 · 待运行</span>',
      '<span class="dy-progress-bar"><i></i></span>',
      "</span>",
      "</div>",
    ].join("");
    var outputBar = [
      '<div class="daoyan-output">',
      '<div class="dy-out-title">输出 <span class="dy-hint">渲染输出参数(占位·阶段2 接交互)</span></div>',
      '<div class="dy-out-rows">',
      '<div class="dy-out-row">',
      ocap("输出分辨率", "16:9 档"),
      ocap("百万像素", "0.4"),
      ocap("帧率", "24"),
      ocap("声音", "使用原声"),
      ocap("导出方式", "全部导出"),
      "</div>",
      '<div class="dy-out-row">',
      '<span class="dy-ocap dy-ocap--check" title="段间引导:相邻镜首尾衔接(updateSegmentContinuityUI 位)"><input type="checkbox" checked> 段间引导</span>',
      ocap("上下文帧数", "22"),
      ocap("引导方式", "引导"),
      '<button class="dy-btn dy-btn--live" disabled style="background:linear-gradient(180deg,rgba(52,211,153,.45),rgba(52,211,153,.25));border:1px solid rgba(52,211,153,.8);color:#eafff5;opacity:.95" title="实时预览:采样中实时帧回看(占位·阶段2 接线)">实时预览</button>',
      "</div>",
      "</div>",
      "</div>",
    ].join("");
    root.innerHTML = businessBar + outputBar;
    return root;
  }

  global.DaoyanToolbar = { build: build, css: CSS };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
