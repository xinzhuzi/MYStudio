// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:3196-3260 组提示词结构(summary/retention/description
// 分段 textarea)与 minimax_prompt_mentions.js token 编辑层位——布局复刻、
// 代码重写(PRD R3;我方四段=soundscape 增段,token chips 排后续役)。
//
// 结构化提示词编辑(阶段2 交互):summary/retention/description/soundscape
// 四段写回选中组(打字连击快照合并=Ctrl+Z 一次回退一句)+结构模板一键插入
// (PRD R1.6:全英文 placeholder/模板,UI 文案全中文)。
// IIFE 挂 window.DaoyanPrompt,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-prompt{display:flex;flex-direction:column;gap:7px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;height:100%;}",
    ".dy-prompt-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".dy-prompt-head .dy-title{font-size:12.5px;font-weight:700;color:#f0f4fa;}",
    ".dy-prompt-head .dy-who{font-size:10px;color:#7d8b9f;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-btn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 9px;cursor:pointer;white-space:nowrap;}",
    ".dy-btn--primary{background:linear-gradient(180deg,rgba(52,211,153,.28),rgba(52,211,153,.16));border-color:rgba(52,211,153,.5);color:#eafff5;}",
    ".dy-prompt-head .dy-hint{font-size:10px;color:#9aa7ba;}",
    ".dy-field{display:flex;flex-direction:column;gap:3px;flex:1;min-height:64px;}",
    ".dy-field label{font-size:10.5px;font-weight:700;color:#a8c8f2;}",
    ".dy-field label small{color:#7d8b9f;font-weight:400;margin-left:5px;}",
    ".dy-field textarea{flex:1;resize:vertical;min-height:40px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(10,14,24,.72);color:#dbe7fb;padding:6px 9px;font:400 11px/1.6 ui-monospace,'SF Mono',Menlo,monospace;outline:none;}",
    ".dy-field textarea:focus{border-color:rgba(110,168,254,.55);box-shadow:0 0 0 2px rgba(110,168,254,.15);}",
    ".dy-field textarea::placeholder{color:#66748a;}",
  ].join("\n");

  var STYLE_ID = "daoyan-prompt-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function S() { return global.DaoyanSerial; }

  var FIELDS = [
    { key: "summary", label: "总述", hint: "summary", ph: "One-line summary of this shot: subject, action, camera move." },
    { key: "retention", label: "保留", hint: "retention", ph: "Elements to retain from the reference images (identity, outfit, palette)." },
    { key: "description", label: "画面描述", hint: "description", ph: "Cinematic description: framing, lighting, motion, environment beats." },
    { key: "soundscape", label: "声景", hint: "soundscape", ph: "Ambience and sound cues: wind, footsteps, distant traffic, score mood." },
  ];

  /** 结构模板骨架(PRD R1.6 一键插入;只填空段,已有内容不覆盖) */
  var STRUCT_TEMPLATE = {
    summary: "[summary] One-line shot summary: subject, action, camera move.",
    retention: "[retention] Keep from reference images: identity, outfit, palette, props.",
    description: "[description] Framing (wide/medium/close); lighting; motion beats 1-2-3; environment details; camera move.",
    soundscape: "[soundscape] Base ambience; foreground foley; music mood; silences.",
  };

  // ── 动作 ───────────────────────────────────────────────────────────

  var actions = {
    /** 四段写回选中组(静默写=打字不重渲免丢焦点;coalesce=同段连击
     * 1.5s 合并快照,Ctrl+Z 一次回退一句) */
    setPromptField: function (ctrl, field, text) {
      var seg = ctrl.selectedSegment();
      if (!seg) return false;
      var f = FIELDS.filter(function (x) { return x.key === field; })[0];
      if (!f) return false;
      var mut = function (st) {
        st.segments[ctrl.view.selected].prompt[field] = String(text == null ? "" : text);
      };
      if (typeof ctrl.applySilent === "function") {
        ctrl.applySilent(mut, "prompt-" + field + "-" + ctrl.view.selected);
      } else {
        ctrl.apply(mut, "prompt-" + field + "-" + ctrl.view.selected);
      }
      return true;
    },
    /** 插入结构模板:只填空段(骨架英文),已有内容不覆盖 */
    insertTemplate: function (ctrl) {
      var seg = ctrl.selectedSegment();
      if (!seg) return false;
      ctrl.apply(function (st) {
        var p = st.segments[ctrl.view.selected].prompt;
        for (var k in STRUCT_TEMPLATE) {
          if (!p[k] || !p[k].trim()) p[k] = STRUCT_TEMPLATE[k];
        }
      });
      return true;
    },
  };

  // ── 渲染 ───────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /**
   * 渲染提示词编辑区(阶段2 交互)。
   * @param {HTMLElement} root
   * @param {object} ctx DaoyanSerial 控制器(裸 state 自动包 demo 控制器=静态)
   */
  function build(root, ctx) {
    ensureStyle();
    var ctrl = S().ctrlOf(ctx);
    var seg = ctrl.selectedSegment();
    var p = (seg && seg.prompt) || {};
    root.innerHTML = [
      '<div class="dy-prompt-head">',
      '<span class="dy-title">提示词编辑</span>',
      '<span class="dy-who">' + (seg ? "当前组:" + esc(seg.id) : "无组") + "</span>",
      '<button class="dy-btn dy-btn--primary" data-act="insert-template"' + (seg ? "" : " disabled") + ">插入结构模板</button>",
      '<span class="dy-hint">四段结构 · 只填空段 · Ctrl+Z 撤销</span>',
      "</div>",
    ].concat(FIELDS.map(function (f) {
      var v = p[f.key] == null ? "" : String(p[f.key]);
      return '<div class="dy-field"><label>' + f.label + "<small>" + f.hint
        + '</small></label><textarea rows="2" data-field="' + f.key
        + '" placeholder="' + f.ph + '">' + esc(v) + "</textarea></div>";
    })).join("");
    bind(root, ctrl);
    return root;
  }

  /** 事件:input 委托写回(重渲防重绑同 timeline.js 手法)。
   * input → applySilent(写 state+去抖提交,不重渲)=打字不丢焦点;
   * 提示词区 DOM 在下一次任意区动作/撤销时随重渲对齐。 */
  function bind(root, ctrl) {
    root._dyPromptCtrl = ctrl;
    if (root._dyPromptBound) return;
    root._dyPromptBound = true;
    root.addEventListener("input", function (e) {
      var ctrl = root._dyPromptCtrl;
      var el = e.target;
      if (!el || !el.getAttribute || !ctrl) return;
      var field = el.getAttribute("data-field");
      if (field) actions.setPromptField(ctrl, field, el.value);
    });
    root.addEventListener("click", function (e) {
      var ctrl = root._dyPromptCtrl;
      var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !ctrl) return;
      if (el.getAttribute("data-act") === "insert-template") actions.insertTemplate(ctrl);
    });
  }

  global.DaoyanPrompt = {
    build: build, css: CSS, FIELDS: FIELDS, STRUCT_TEMPLATE: STRUCT_TEMPLATE,
    actions: actions,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
