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
    /* token chips 行(1115 缺口1:<Picture N>/<Audio J> 一键插入光标处) */
    ".dy-chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;}",
    ".dy-chips .dy-chips-label{font-size:9.5px;color:#7d8b9f;letter-spacing:.05em;}",
    ".dy-chip{font:600 10px/1.4 ui-monospace,'SF Mono',Menlo,monospace;color:#a8c8f2;background:rgba(110,168,254,.1);border:1px solid rgba(110,168,254,.28);border-radius:6px;padding:1.5px 7px;cursor:pointer;white-space:nowrap;}",
    ".dy-chip:hover{background:rgba(110,168,254,.24);}",
    ".dy-chip--audio{color:#d9f7ea;background:rgba(52,211,153,.09);border-color:rgba(52,211,153,.32);}",
    ".dy-chip--audio:hover{background:rgba(52,211,153,.2);}",
    /* AI扩写失败红标(1115 缺口6;cards dy-upload-err 同款) */
    ".dy-enhance-err{font-size:10px;color:#f87171;border:1px solid rgba(248,113,113,.4);border-radius:6px;padding:0 6px;cursor:help;}",
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

  /** AI扩写最近错误(build 渲红标用;cards lastUploadError 同款模式) */
  var lastEnhanceError = "";

  // ── 纯函数(测试断言面)────────────────────────────────────────────

  /**
   * 光标处插入 token(1115 缺口1):插入不改邻近字符,新光标=pos+token.length。
   * @returns {{text:string, cursor:number}}
   */
  function insertAtCursor(text, pos, token) {
    var s = String(text == null ? "" : text);
    var p = Math.round(Number(pos));
    if (!isFinite(p) || p < 0) p = 0;
    if (p > s.length) p = s.length;
    var tok = String(token == null ? "" : token);
    return { text: s.slice(0, p) + tok + s.slice(p), cursor: p + tok.length };
  }

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
    /** token 入段(1115 缺口1):读 seg.prompt[field]→pos 处插入→applySilent
     * 静默写(不重渲不丢焦点,打字同款;coalesce key 与模板/打字分离,
     * Ctrl+Z 一次回退整枚 token);@returns 新光标(失败 NaN/-1=undefined) */
    insertToken: function (ctrl, field, token, pos) {
      var seg = ctrl.selectedSegment();
      if (!seg) return -1;
      var f = FIELDS.filter(function (x) { return x.key === field; })[0];
      if (!f) return -1;
      var cur = String(seg.prompt[field] == null ? "" : seg.prompt[field]);
      var r = insertAtCursor(cur, pos == null ? cur.length : pos, token);
      var mut = function (st) {
        st.segments[ctrl.view.selected].prompt[field] = r.text;
      };
      if (typeof ctrl.applySilent === "function") {
        ctrl.applySilent(mut, "token-" + field + "-" + ctrl.view.selected);
      } else {
        ctrl.apply(mut, "token-" + field + "-" + ctrl.view.selected);
      }
      return r.cursor;
    },
    /** AI扩写(1115 缺口6③):POST /my_daoyan/enhance_prompt {text}
     * →ok:回填 description(非 silent=独立快照,Ctrl+Z 一次回退);
     * err:红标+原文不动;无 fetch=钮 disabled 不达此路 */
    enhance: function (ctrl, btn) {
      var seg = ctrl.selectedSegment();
      if (!seg || typeof fetch !== "function") return Promise.resolve({ ok: false, error: "无 fetch 环境" });
      var text = String(seg.prompt.description || "").trim();
      if (!text) return Promise.resolve({ ok: false, error: "画面描述为空" });
      if (btn) { try { btn.disabled = true; } catch (err) { /* stub 容错 */ } }
      return fetch("/my_daoyan/enhance_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok && typeof j.text === "string" && j.text) {
            lastEnhanceError = "";
            ctrl.apply(function (st) {
              st.segments[ctrl.view.selected].prompt.description = j.text;
            });
            return { ok: true, text: j.text };
          }
          lastEnhanceError = (j && j.error) || "扩写失败";
          ctrl.apply(function () {}); // 失败态重渲示红标
          return { ok: false, error: lastEnhanceError };
        })
        .catch(function (err) {
          lastEnhanceError = "扩写服务不可达:" + (err && err.message || err);
          ctrl.apply(function () {});
          return { ok: false, error: lastEnhanceError };
        });
    },
  };

  // ── 渲染 ───────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ── token chips(1115 缺口1)───────────────────────────────────────

  /** 图编号:经 DaoyanCards.pictureLabel 续号制(公共 i+1/本组 common+j+1);
   * cards 缺席(vm 最小壳)回退同式直算 */
  function pictureNo(st, zone, idx) {
    var C = global.DaoyanCards;
    if (C && typeof C.pictureLabel === "function") {
      var m = /\d+/.exec(String(C.pictureLabel(st, zone, idx)));
      if (m) return parseInt(m[0], 10);
    }
    var common = (st && st.common_images) ? st.common_images.length : 0;
    return zone === "common" ? idx + 1 : common + idx + 1;
  }

  function chipBtn(act, token, name) {
    return '<button class="dy-chip' + (act === "chip-audio" ? " dy-chip--audio" : "")
      + '" data-act="' + act + '" data-token="' + esc(token)
      + '" title="' + esc(name) + '">' + esc(token) + "</button>";
  }

  /** chips 行:图=公共+本组已填槽连续编号 <Picture N>(空槽不占位);
   * 音频=seg.audios <Audio J>(J=1-based,引擎 docstring「Ordinals are
   * 1-based per type」);零图零音频=整行不渲 */
  function chipsRow(ctrl, seg) {
    var st = ctrl.state;
    var common = (st && st.common_images) || [];
    var own = (seg && seg.images) || [];
    var auds = (seg && seg.audios) || [];
    if (!common.length && !own.length && !auds.length) return "";
    var chips = [];
    for (var i = 0; i < common.length; i++) {
      chips.push(chipBtn("chip-picture", "<Picture " + pictureNo(st, "common", i) + ">", common[i]));
    }
    for (var j = 0; j < own.length; j++) {
      chips.push(chipBtn("chip-picture", "<Picture " + pictureNo(st, "own", j) + ">", own[j]));
    }
    for (var k = 0; k < auds.length; k++) {
      chips.push(chipBtn("chip-audio", "<Audio " + (k + 1) + ">", auds[k]));
    }
    if (!chips.length) return "";
    return '<div class="dy-chips"><span class="dy-chips-label">chips</span>'
      + chips.join("") + "</div>";
  }

  // ── 渲染 ───────────────────────────────────────────────────────────

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
    var desc = String(p.description || "").trim();
    root.innerHTML = [
      '<div class="dy-prompt-head">',
      '<span class="dy-title">提示词编辑</span>',
      '<span class="dy-who">' + (seg ? "当前组:" + esc(seg.id) : "无组") + "</span>",
      '<button class="dy-btn dy-btn--primary" data-act="insert-template"' + (seg ? "" : " disabled") + ">插入结构模板</button>",
      '<button class="dy-btn" data-act="enhance"'
      + (!seg || !desc || typeof fetch !== "function" ? " disabled" : "")
      + ' title="LLM 扩写画面描述(声画镜头语言,不改既有语义;Ctrl+Z 一次回退)">AI扩写</button>',
      lastEnhanceError ? '<span class="dy-enhance-err" title="' + esc(lastEnhanceError) + '">扩写失败</span>' : "",
      '<span class="dy-hint">四段结构 · 只填空段 · Ctrl+Z 撤销</span>',
      "</div>",
      chipsRow(ctrl, seg),
    ].concat(FIELDS.map(function (f) {
      var v = p[f.key] == null ? "" : String(p[f.key]);
      return '<div class="dy-field"><label>' + f.label + "<small>" + f.hint
        + '</small></label><textarea rows="2" data-field="' + f.key
        + '" placeholder="' + f.ph + '">' + esc(v) + "</textarea></div>";
    })).join("");
    bind(root, ctrl);
    return root;
  }

  /** 事件:input 委托写回+focusin 记目标段+chips/AI扩写点击委托
   * (重渲防重绑同 timeline.js 手法)。
   * input → applySilent(写 state+去抖提交,不重渲)=打字不丢焦点;
   * 提示词区 DOM 在下一次任意区动作/撤销时随重渲对齐;
   * chip → 目标 textarea.value 直写+setSelectionRange(光标落 token 尾)
   * →insertToken 同步 state(静默=不重渲不丢焦点)。 */
  function bind(root, ctrl) {
    root._dyPromptCtrl = ctrl;
    if (root._dyPromptBound) return;
    root._dyPromptBound = true;
    root.addEventListener("focusin", function (e) {
      var el = e.target;
      if (el && el.getAttribute) {
        var f = el.getAttribute("data-field");
        if (f) root._dyPromptLastField = f; // chips 插入目标=最近聚焦段(默认 description)
      }
    });
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
      var act = el.getAttribute("data-act");
      if (act === "insert-template") {
        actions.insertTemplate(ctrl);
      } else if (act === "enhance") {
        actions.enhance(ctrl, el);
      } else if (act === "chip-picture" || act === "chip-audio") {
        var token = el.getAttribute("data-token") || "";
        var field = root._dyPromptLastField || "description";
        var ta = root.querySelector ? root.querySelector('textarea[data-field="' + field + '"]') : null;
        var pos;
        if (ta) {
          var cur = String(ta.value == null ? "" : ta.value);
          pos = typeof ta.selectionStart === "number" ? ta.selectionStart : cur.length;
          var ins = insertAtCursor(cur, pos, token);
          ta.value = ins.text; // 直写不重渲=焦点/滚动位不动
          if (typeof ta.setSelectionRange === "function") {
            ta.setSelectionRange(ins.cursor, ins.cursor); // 光标落 token 尾
          }
        } else {
          var seg0 = ctrl.selectedSegment();
          var cur0 = String((seg0 && seg0.prompt && seg0.prompt[field]) || "");
          pos = cur0.length;
        }
        actions.insertToken(ctrl, field, token, pos);
      }
    });
  }

  global.DaoyanPrompt = {
    build: build, css: CSS, FIELDS: FIELDS, STRUCT_TEMPLATE: STRUCT_TEMPLATE,
    actions: actions, insertAtCursor: insertAtCursor,
    lastEnhanceError: function () { return lastEnhanceError; },
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
