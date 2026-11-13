// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_timeline.js:3004-3093 折叠参数分区(bd-output/分区胶囊行)+
// minimax_pack.js:14 采样七 widget 折叠条——布局复刻、代码重写(PRD R3)。
// 1113 阶段1.5 补丁②:一行文字摘要升级为真胶囊行静态形(对标 AIMixer
// 胶囊行质感=浅描边+深灰底):数值参=左标签右值+两端步进箭头 ◀▶(静态
// 形);布尔参=toggle 静态形;枚举参=▾ 下拉静态形。全静态零交互(步进/
// 开关/下拉事件排阶段2)。
//
// 折叠参数分区(阶段1 静态骨架):采样/高级采样/性能三区胶囊行
// (design §2)。参数暴露策略=PRD R1.7:LoRA/底模/TE/VAE 锁死不出现;
// 高级采样默认收起+红线警示标签;面板只露 seed/分辨率档/时长网格/
// color_fix。配色=漫影深色玻璃系(色值对齐 theme.js CINEMA_TOKENS,
// 组件不 import theme.js 以保 file:// 双轨直开)。
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
    /* 真胶囊行(1113 阶段1.5 补丁②;AIMixer 胶囊行质感=浅描边+深灰底) */
    ".daoyan-params .dy-caplist{display:flex;flex-direction:column;gap:6px;}",
    ".daoyan-params .dy-cap{display:flex;align-items:center;gap:8px;min-height:30px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:linear-gradient(180deg,#242b3a,#1a202b);padding:3px 7px 3px 13px;}",
    ".daoyan-params .dy-cap .dy-cap-label{font-size:11.5px;font-weight:600;color:#cfd8e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".daoyan-params .dy-cap .dy-cap-label small{font-size:10px;color:#7d8b9f;font-weight:400;margin-left:6px;}",
    ".daoyan-params .dy-cap .dy-cap-val{margin-left:auto;display:inline-flex;align-items:center;gap:3px;flex:none;}",
    ".daoyan-params .dy-cap-num{font-size:12px;font-weight:700;color:#f5cd6d;font-family:ui-monospace,'SF Mono',Menlo,monospace;min-width:38px;text-align:center;white-space:nowrap;}",
    ".daoyan-params .dy-step{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:9px;font-style:normal;color:#a8c8f2;background:rgba(110,168,254,.12);border:1px solid rgba(110,168,254,.28);cursor:default;user-select:none;flex:none;}",
    ".daoyan-params .dy-caret{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;color:#dbe7fb;white-space:nowrap;}",
    ".daoyan-params .dy-caret i{font-style:normal;font-size:9px;color:#7d8b9f;line-height:1;}",
    ".daoyan-params .dy-toggle{position:relative;width:34px;height:18px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);flex:none;cursor:default;}",
    ".daoyan-params .dy-toggle i{position:absolute;top:1.5px;left:1.5px;width:13px;height:13px;border-radius:50%;background:#9aa7ba;box-shadow:0 1px 3px rgba(0,0,0,.5);transition:left .15s ease;}",
    ".daoyan-params .dy-toggle--on{background:linear-gradient(180deg,rgba(52,211,153,.45),rgba(52,211,153,.28));border-color:rgba(52,211,153,.55);}",
    ".daoyan-params .dy-toggle--on i{left:calc(100% - 14.5px);background:#eafff5;}",
    ".daoyan-params .dy-toggle-text{font-size:10.5px;color:#9aa7ba;white-space:nowrap;}",
    ".daoyan-params .dy-warn{font-size:10.5px;color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:5px 10px;}",
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

  /** 数值胶囊行:左标签+右值,值两端步进箭头 ◀▶(静态形) */
  function capStep(label, value, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val"><i class="dy-step">◀</i>'
      + '<span class="dy-cap-num">' + value + "</span>"
      + '<i class="dy-step">▶</i></span></div>';
  }

  /** 枚举胶囊行:左标签+右值+▾ 下拉静态形(内联字形,CSS content 不依赖) */
  function capCaret(label, value, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val"><span class="dy-caret">' + value + " <i>▾</i></span></span></div>";
  }

  /** 布尔胶囊行:左标签+右 toggle 静态形(on=绿轨白钮) */
  function capToggle(label, on, hint) {
    return '<div class="dy-cap"><span class="dy-cap-label">' + label
      + (hint ? "<small>" + hint + "</small>" : "")
      + '</span><span class="dy-cap-val"><span class="dy-toggle'
      + (on ? " dy-toggle--on" : "") + '"><i></i></span>'
      + '<span class="dy-toggle-text">' + (on ? "开" : "关") + "</span></span></div>";
  }

  /**
   * 渲染折叠参数三区(阶段1.5 真胶囊行静态形)。
   * @param {HTMLElement} root 容器
   * @param {object} state DaoyanSerial.parseTimeline 产物(阶段1 未消费,签名预留)
   */
  function build(root, state) {
    ensureStyle();
    // 1113 补丁②残修:壳 section(data-zone=params)从未挂 .daoyan-params 域类,
    // 本件全部 scoped CSS(.daoyan-params .dy-cap 等)成死码→参数区渲染成裸文本行。
    // 自挂法:root 向上找本区 section 挂类,引擎 DOM 与 preview 双上下文通吃。
    var sec = root.closest && root.closest('section[data-zone="params"]');
    if (sec) { sec.classList.add('daoyan-params'); }
    root.innerHTML = [
      '<details open class="dy-sec">',
      "  <summary>采样 <span class='dy-tag dy-tag--ok'>产线验证档</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capStep("全局 seed", "42", "每组可覆写"),
      capCaret("分辨率档", "16:9 阶梯", "960 → 1440 → 2880"),
      capStep("每组时长", "5s", "贴 17k+5 网格 → 124f"),
      capCaret("三采 color_fix", "none"),
      "    </div>",
      '    <div class="dy-note">分辨率锁 16:9 一档阶梯,不开放自由像素;竖屏后续役。</div>',
      "  </div>",
      "</details>",
      "<details class='dy-sec'>",
      "  <summary>高级采样 <span class='dy-tag dy-tag--danger'>红线:偏离产线验证档</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capStep("一采 steps", "8"),
      capStep("二采 steps", "3"),
      capCaret("sampler", "lcm"),
      capCaret("scheduler", "simple · dn 0.2"),
      capCaret("σ shift", "一采 [6,3] · 二采 [12,3]"),
      capStep("cfg", "1.0"),
      "    </div>",
      '    <div class="dy-warn">⚠ 改动即偏离产线验证档(Euler→片尾乱码红线);默认=我方栈档,非必要不动。</div>',
      "  </div>",
      "</details>",
      "<details open class='dy-sec'>",
      "  <summary>性能 <span class='dy-tag dy-tag--lock'>三采前卸 H3 已焊节点内</span></summary>",
      '  <div class="dy-body">',
      '    <div class="dy-caplist">',
      capToggle("三采前卸 H3", true, "/free 自动"),
      capToggle("段间清显存", true),
      capToggle("断点续跑", true, "已完镜自动跳过"),
      capToggle("产物回看", true, "面板产物区 p1/p2/p3"),
      "    </div>",
      '    <div class="dy-note">显存清理四点位+model_prefetch 队列清坑随执行链(阶段3)落位。</div>',
      "  </div>",
      "</details>",
    ].join("\n");
    return root;
  }

  global.DaoyanParams = { build: build, css: CSS };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
