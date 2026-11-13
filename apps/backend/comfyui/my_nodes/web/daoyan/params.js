// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:3004-3093 折叠参数分区(分区胶囊行)+
// minimax_pack.js:14 采样七 widget 折叠条——布局复刻、代码重写(PRD R3)。
// 1113 阶段1.5 补丁②:真胶囊行形(数值=步进圆钮/布尔=toggle/枚举=▾)。
//
// 折叠参数分区(阶段2 交互):采样(全局 seed/每组时长贴网格/color_fix)/
// 高级采样(默认收起+红线警示;偏离产线验证档即黄条)/性能 toggles。
// 参数暴露策略=PRD R1.7:LoRA/底模/TE/VAE 锁死不出现。
// IIFE 挂 window.DaoyanParams,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-params{display:flex;flex-direction:column;gap:8px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".daoyan-params details{border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));overflow:hidden;}",
    ".daoyan-params summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:8px 12px;font-weight:700;font-size:12.5px;color:#f0f4fa;user-select:none;}",
    ".daoyan-params summary::-webkit-details-marker{display:none;}",
    ".daoyan-params summary:before{content:'▸';color:#6ea8fe;transition:transform .15s ease;font-size:11px;}",
    ".daoyan-params details[open] summary:before{transform:rotate(90deg);}",
    ".daoyan-params .dy-tag{font-size:10.5px;font-weight:600;border-radius:999px;padding:1px 8px;flex:none;}",
    ".daoyan-params .dy-tag--danger{color:#f87171;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);}",
    ".daoyan-params .dy-tag--lock{color:#9aa7ba;background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.22);}",
    ".daoyan-params .dy-tag--ok{color:#34d399;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);}",
    ".daoyan-params .dy-body{display:flex;flex-direction:column;gap:7px;padding:4px 12px 11px;border-top:1px solid rgba(255,255,255,.06);}",
    ".daoyan-params .dy-caplist{display:flex;flex-direction:column;gap:6px;}",
    ".daoyan-params .dy-cap{display:flex;align-items:center;gap:8px;min-height:30px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:linear-gradient(180deg,#242b3a,#1a202b);padding:3px 7px 3px 13px;}",
    ".daoyan-params .dy-cap .dy-cap-label{font-size:11.5px;font-weight:600;color:#cfd8e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".daoyan-params .dy-cap .dy-cap-label small{font-size:10px;color:#7d8b9f;font-weight:400;margin-left:6px;}",
    ".daoyan-params .dy-cap .dy-cap-val{margin-left:auto;display:inline-flex;align-items:center;gap:3px;flex:none;}",
    ".daoyan-params .dy-cap-num{font-size:12px;font-weight:700;color:#f5cd6d;font-family:ui-monospace,'SF Mono',Menlo,monospace;min-width:38px;text-align:center;white-space:nowrap;}",
    ".daoyan-params .dy-step{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:9px;font-style:normal;color:#a8c8f2;background:rgba(110,168,254,.12);border:1px solid rgba(110,168,254,.28);cursor:pointer;user-select:none;flex:none;}",
    ".daoyan-params .dy-step:hover{background:rgba(110,168,254,.28);}",
    ".daoyan-params .dy-caret{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;color:#dbe7fb;white-space:nowrap;cursor:pointer;}",
    ".daoyan-params .dy-caret i{font-style:normal;font-size:9px;color:#7d8b9f;line-height:1;}",
    ".daoyan-params .dy-caret:hover i{color:#a8c8f2;}",
    ".daoyan-params .dy-toggle{position:relative;width:34px;height:18px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);flex:none;cursor:pointer;}",
    ".daoyan-params .dy-toggle i{position:absolute;top:1.5px;left:1.5px;width:13px;height:13px;border-radius:50%;background:#9aa7ba;box-shadow:0 1px 3px rgba(0,0,0,.5);transition:left .15s ease;}",
    ".daoyan-params .dy-toggle--on{background:linear-gradient(180deg,rgba(52,211,153,.45),rgba(52,211,153,.28));border-color:rgba(52,211,153,.55);}",
    ".daoyan-params .dy-toggle--on i{left:calc(100% - 14.5px);background:#eafff5;}",
    ".daoyan-params .dy-toggle-text{font-size:10.5px;color:#9aa7ba;white-space:nowrap;}",
    ".daoyan-params .dy-warn{font-size:10.5px;color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:5px 10px;}",
    ".daoyan-params .dy-warn--live{animation:dyWarnPulse 1.2s ease-in-out infinite;}",
    "@keyframes dyWarnPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,.25);}50%{box-shadow:0 0 0 4px rgba(251,191,36,.18);}}",
    ".daoyan-params .dy-note{font-size:10.5px;color:#9aa7ba;}",
  ].join("\n");

  var STYLE_ID = "daoyan-params-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function S() { return global.DaoyanSerial; }

  // ── 纯函数 ─────────────────────────────────────────────────────────

  /** 高级采样偏离产线验证档?(PRD R1.7:偏离即黄条) */
  function advancedDeviated(state) {
    var adv = (state && state.advanced) || {};
    var def = S().ADVANCED_DEFAULTS;
    for (var k in def) {
      if (Math.abs(Number(adv[k]) - def[k]) > 1e-9) return true;
    }
    return false;
  }

  // ── 动作 ───────────────────────────────────────────────────────────

  var actions = {
    /** 全局 seed(common_params.seed;每组可覆盖=卡片组级 seed) */
    setCommonSeed: function (ctrl, seed) {
      var v = S().normalizeSegment({ seed: seed }).seed;
      ctrl.apply(function (st) { st.common_params.seed = v == null ? 42 : v; });
      return true;
    },
    /** 每组时长默认档(common_params.seconds,±步进;贴网格) */
    bumpCommonSeconds: function (ctrl, delta) {
      ctrl.apply(function (st) {
        var next = Math.max(0.2, Math.round((st.common_params.seconds + delta) * 100) / 100);
        st.common_params.seconds = next;
      });
      return ctrl.state.common_params.seconds;
    },
    /** 三采 color_fix 轮换 none/adain/wavelet(PRD R1.7) */
    cycleColorFix: function (ctrl) {
      ctrl.apply(function (st) {
        var modes = S().COLOR_FIX_MODES;
        st.color_fix = modes[(modes.indexOf(st.color_fix) + 1) % modes.length];
      });
      return ctrl.state.color_fix;
    },
    /** 高级采样改值(偏离验证档→黄条警示;快照可撤销) */
    setAdvanced: function (ctrl, key, value) {
      if (!(key in S().ADVANCED_DEFAULTS)) return false;
      ctrl.apply(function (st) { st.advanced[key] = Number(value); });
      return true;
    },
    /** 高级采样步进(±) */
    bumpAdvanced: function (ctrl, key, delta, min) {
      if (!(key in S().ADVANCED_DEFAULTS)) return false;
      ctrl.apply(function (st) {
        st.advanced[key] = Math.max(min == null ? 1 : min, Math.round((st.advanced[key] + delta) * 100) / 100);
      });
      return true;
    },
    /** 恢复产线验证档 */
    resetAdvanced: function (ctrl) {
      ctrl.apply(function (st) { st.advanced = JSON.parse(JSON.stringify(S().ADVANCED_DEFAULTS)); });
      return true;
    },
    /** 性能区 toggles */
    togglePerf: function (ctrl, key) {
      if (!(key in S().PERF_DEFAULTS)) return false;
      ctrl.apply(function (st) { st.perf[key] = !st.perf[key]; });
      return ctrl.state.perf[key];
    },
  };

  // ── 渲染 ───────────────────────────────────────────────────────────

  /** 数值胶囊行:左标签+右值+步进箭头 ◀▶(data-act 驱动) */
  function capStep(label, act, value, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val">'
      + '<i class="dy-step" data-act="' + act + '" data-delta="-1" title="−">◀</i>'
      + '<span class="dy-cap-num">' + value + "</span>"
      + '<i class="dy-step" data-act="' + act + '" data-delta="1" title="＋">▶</i></span></div>';
  }

  /** 枚举胶囊行:左标签+右值+▾(点击轮换,data-act 驱动) */
  function capCaret(label, act, value, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val"><span class="dy-caret" data-act="' + act + '" title="点击切换">' + value + " <i>▾</i></span></span></div>";
  }

  /** 布尔胶囊行:左标签+右 toggle(on=绿轨白钮,点击切换) */
  function capToggle(label, act, on, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val"><span class="dy-toggle' + (on ? " dy-toggle--on" : "")
      + '" data-act="' + act + '"><i></i></span>'
      + '<span class="dy-toggle-text">' + (on ? "开" : "关") + "</span></span></div>";
  }

  /**
   * 渲染折叠参数三区(阶段2 交互)。
   * @param {HTMLElement} root 容器
   * @param {object} ctx DaoyanSerial 控制器(裸 state 自动包 demo 控制器=静态)
   */
  function build(root, ctx) {
    ensureStyle();
    var ctrl = S().ctrlOf(ctx);
    var st = ctrl.state;
    var cp = st.common_params;
    // 1113 补丁②残修:壳 section 自挂 .daoyan-params 域类(scoped CSS 生效前提)
    var sec = root.closest && root.closest('section[data-zone="params"]');
    if (sec) { sec.classList.add("daoyan-params"); }
    var deviated = advancedDeviated(st);
    root.innerHTML = [
      '<details open class="dy-sec">',
      "  <summary>采样 <span class='dy-tag dy-tag--ok'>产线验证档</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capStep("全局 seed", "seed", cp.seed, "每组可覆写"),
      capCaret("分辨率档", null, "16:9 阶梯", "960 → 1440 → 2880(锁 16:9 一档)"),
      capStep("每组时长(默认)", "bump-seconds", cp.seconds + "s", "贴 17k+5 网格 → " + S().secondsToFrames(cp.seconds) + "f"),
      capCaret("三采 color_fix", "cycle-colorfix", st.color_fix),
      "    </div>",
      '    <div class="dy-note">分辨率锁 16:9 一档阶梯,不开放自由像素;竖屏后续役。新组默认吃公共参数档。</div>',
      "  </div>",
      "</details>",
      "<details class='dy-sec'>",
      "  <summary>高级采样 <span class='dy-tag dy-tag--danger'>红线:偏离产线验证档</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capStep("一采 steps", "adv-first_steps", st.advanced.first_steps),
      capStep("二采 steps", "adv-second_steps", st.advanced.second_steps),
      capCaret("sampler", null, st.advanced.sampler + "(焊死)"),
      capCaret("scheduler", null, st.advanced.scheduler + " · dn 0.2(焊死)"),
      capCaret("σ shift", null, "一采 [6,3] · 二采 [12,3](焊死)"),
      capStep("cfg", "adv-cfg", st.advanced.cfg),
      "    </div>",
      deviated
        ? '<div class="dy-warn dy-warn--live">⚠ 已偏离产线验证档(Euler→片尾乱码红线)——<span data-act="adv-reset" style="text-decoration:underline;cursor:pointer">恢复验证档</span></div>'
        : '<div class="dy-warn">⚠ 改动即偏离产线验证档(Euler→片尾乱码红线);默认=我方栈档,非必要不动。</div>',
      "  </div>",
      "</details>",
      "<details open class='dy-sec'>",
      "  <summary>性能 <span class='dy-tag dy-tag--lock'>三采前卸 H3 已焊节点内</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capToggle("三采前卸 H3", "perf-free_h3", st.perf.free_h3, "/free 自动"),
      capToggle("段间清显存", "perf-vram_clear", st.perf.vram_clear),
      capToggle("断点续跑", "perf-resume", st.perf.resume, "已完镜自动跳过"),
      capToggle("产物回看", "perf-gallery", st.perf.gallery, "面板产物区 p1/p2/p3"),
      "    </div>",
      '    <div class="dy-note">显存清理四点位+model_prefetch 队列清坑随执行链(阶段3)落位。</div>',
      "  </div>",
      "</details>",
    ].join("\n");
    bind(root, ctrl);
    return root;
  }

  /** 事件:点击委托(步进/轮换/toggle;重渲防重绑同 timeline.js 手法) */
  function bind(root, ctrl) {
    root._dyParamsCtrl = ctrl;
    if (root._dyParamsBound) return;
    root._dyParamsBound = true;
    root.addEventListener("click", function (e) {
      var ctrl = root._dyParamsCtrl;
      var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !ctrl) return;
      var act = el.getAttribute("data-act");
      var delta = el.getAttribute("data-delta");
      if (act === "seed") actions.setCommonSeed(ctrl, ctrl.state.common_params.seed + (delta ? +delta : 0));
      else if (act === "bump-seconds") actions.bumpCommonSeconds(ctrl, delta ? +delta : 0);
      else if (act === "cycle-colorfix") actions.cycleColorFix(ctrl);
      else if (act && act.indexOf("adv-") === 0 && act !== "adv-reset") {
        var key = act.slice(4);
        if (key === "cfg") actions.bumpAdvanced(ctrl, "cfg", delta ? +delta * 0.1 : 0, 0.1);
        else actions.bumpAdvanced(ctrl, key, delta ? +delta : 0, 1);
      } else if (act === "adv-reset") actions.resetAdvanced(ctrl);
      else if (act && act.indexOf("perf-") === 0) actions.togglePerf(ctrl, act.slice(5));
    });
  }

  global.DaoyanParams = {
    build: build, css: CSS, actions: actions, advancedDeviated: advancedDeviated,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
