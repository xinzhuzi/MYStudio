// Copyright (c)  2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:3196-3260 组提示词结构(summary/retention/description
// 分段 textarea)与 minimax_prompt_mentions.js token 编辑层位——布局复刻、
// 代码重写(PRD R3;我方四段=soundscape 增段,token chips 排后续役)。
//
// 结构化提示词编辑(阶段1 静态):summary/retention/description/soundscape
// 四段+结构模板一键插入占位(PRD R1.6:全英文 placeholder,UI 文案全中文)。
// IIFE 挂 window.DaoyanPrompt,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-prompt{display:flex;flex-direction:column;gap:7px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;height:100%;}",
    ".dy-prompt-head{display:flex;align-items:center;gap:8px;}",
    ".dy-prompt-head .dy-title{font-size:12.5px;font-weight:700;color:#f0f4fa;}",
    ".dy-btn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 9px;cursor:default;white-space:nowrap;}",
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

  var FIELDS = [
    { key: "summary", label: "总述", hint: "summary", ph: "One-line summary of this shot: subject, action, camera move." },
    { key: "retention", label: "保留", hint: "retention", ph: "Elements to retain from the reference images (identity, outfit, palette)." },
    { key: "description", label: "画面描述", hint: "description", ph: "Cinematic description: framing, lighting, motion, environment beats." },
    { key: "soundscape", label: "声景", hint: "soundscape", ph: "Ambience and sound cues: wind, footsteps, distant traffic, score mood." },
  ];

  /**
   * 渲染提示词编辑区(阶段1 静态:placeholder 展示,无事件)。
   * @param {HTMLElement} root
   * @param {object} state 含 prompt 四段文案(缺省空)
   */
  function build(root, state) {
    ensureStyle();
    var p = (state && state.prompt) || {};
    root.innerHTML = [
      '<div class="dy-prompt-head">',
      '<span class="dy-title">提示词编辑</span>',
      '<button class="dy-btn">插入结构模板</button>',
      '<span class="dy-hint">四段结构;模板插入=阶段2 交互</span>',
      "</div>",
    ].concat(FIELDS.map(function (f) {
      var v = p[f.key] == null ? "" : String(p[f.key]);
      return '<div class="dy-field"><label>' + f.label + "<small>" + f.hint
        + '</small></label><textarea rows="2" data-field="' + f.key
        + '" placeholder="' + f.ph + '">' + v.replace(/[<>&]/g, function (c) {
          return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c];
        }) + "</textarea></div>";
    })).join("");
    return root;
  }

  global.DaoyanPrompt = { build: build, css: CSS, FIELDS: FIELDS };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
