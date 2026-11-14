// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// DaoyanPicker:库内选图器(1115 缺口2 面板侧)。
//
// 数据源=导演台自有只读路由(daoyan_server.py 官方 PromptServer 扩展点,
// 零改引擎本体):GET /my_daoyan/input_media?limit=200
//   → { files:[{name,mtime,size}], count, error? }(name=相对 posix 名,
//     mtime 倒序;与 cards.thumbUrl lastIndexOf('/') 拆 subfolder 口径互吃)
// 浮层=缩略图 grid(复用 DaoyanCards.thumbUrl=/view input 通道)+「⬆ 上传
// 新图」(隐藏 file input 走 DaoyanCards 上传器,上传后自刷新);
// 点选回调=DaoyanCards.actions.add/replaceGroupImage/replaceCommonImage
// (9 槽/8 异图守门在 cards 侧自动生效);slot=null 新增/数字=原位替换。
// 自持 DOM(live.js 纪律:浮层自挂 document.body,不进控制器重渲环)。
// fetch 全 guard——无 fetch 环境(vm 测试/file:// 预览)降级 error 面不炸。
// 双轨装载同 serial.js 头注口径:IIFE 挂 window.DaoyanPicker,无 import/export。
(function (global) {
  "use strict";

  var CSS = [
    ".dy-picker-mask{position:fixed;inset:0;z-index:99997;background:rgba(4,7,14,.82);display:flex;align-items:center;justify-content:center;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".dy-picker{width:min(92vw,860px);max-height:84vh;display:flex;flex-direction:column;gap:8px;border:1px solid rgba(110,168,254,.3);border-radius:12px;background:linear-gradient(180deg,rgba(16,24,40,.98),rgba(9,13,24,.99));padding:12px 14px;box-shadow:0 18px 48px -8px rgba(0,0,0,.7);}",
    ".dy-picker-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#f0f4fa;flex-wrap:wrap;}",
    ".dy-picker-head .dy-hint{font-size:10px;font-weight:400;color:#9aa7ba;}",
    ".dy-picker-head .dy-close{margin-left:auto;font-style:normal;font-size:14px;color:#9aa7ba;cursor:pointer;padding:2px 8px;}",
    ".dy-picker-head .dy-close:hover{color:#fecaca;}",
    ".dy-picker-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".dy-pk-btn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 9px;cursor:pointer;white-space:nowrap;}",
    ".dy-pk-btn:hover{background:rgba(110,168,254,.26);}",
    ".dy-pk-upload-file{display:none;}",
    ".dy-pk-notice{font-size:10px;color:#fbbf24;}",
    ".dy-picker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;overflow-y:auto;padding:2px;}",
    ".dy-pk-item{display:flex;flex-direction:column;gap:4px;align-items:center;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.04);padding:6px 4px;cursor:pointer;color:#cfd8e6;}",
    ".dy-pk-item:hover{border-color:rgba(110,168,254,.6);}",
    ".dy-pk-item img{width:84px;height:84px;object-fit:cover;border-radius:6px;background:#05080f;}",
    ".dy-pk-item small{font-size:9.5px;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".dy-pk-empty{padding:18px;text-align:center;color:#9aa7ba;font-size:11px;}",
  ].join("\n");

  var STYLE_ID = "daoyan-picker-style";

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

  function blank() {
    return { open: false, zone: null, segIdx: null, slot: null,
             files: [], count: 0, loading: false, error: null, notice: "" };
  }

  var state = blank();
  var el = null;     // 自持浮层宿主(挂 body;live.js 纪律)
  var ctxCtrl = null; // 调用方控制器(cards 点选回调=DaoyanCards.actions 面)

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  function fetchMedia() {
    if (typeof fetch !== "function") {
      return Promise.resolve({ error: "无 fetch 环境(图库不可用)" });
    }
    return fetch("/my_daoyan/input_media?limit=200").then(function (r) {
      return r.json();
    }).catch(function (err) {
      return { error: "图库服务不可达:" + (err && err.message || err) };
    });
  }

  /** 浮层 html(当前 state;缩略图=DaoyanCards.thumbUrl input 通道) */
  function overlayHtml() {
    var head = '<div class="dy-picker-head">🖼 input/ 图库'
      + ' <span class="dy-hint">' + (state.zone === "common" ? "公共图区" : "本组图区")
      + (state.slot == null ? " · 添加" : " · 替换槽 " + (state.slot + 1))
      + "</span>"
      + '<i class="dy-close" data-act="pk-close" title="关闭">✕</i></div>';
    var bar = '<div class="dy-picker-bar">'
      + '<i class="dy-pk-btn" data-act="pk-upload" title="上传新图到 input/(POST /upload/image),上传后列表自刷新">⬆ 上传新图</i>'
      + '<input type="file" accept="image/*" class="dy-pk-upload-file" data-act="pk-upload-file">'
      + (state.notice ? '<span class="dy-pk-notice">' + esc(state.notice) + "</span>" : "")
      + "</div>";
    var body;
    if (state.loading) {
      body = '<div class="dy-pk-empty">图库载入中…</div>';
    } else if (state.error) {
      body = '<div class="dy-pk-empty">' + esc(state.error) + "</div>";
    } else if (!state.files.length) {
      body = '<div class="dy-pk-empty">input/ 无图片;⬆ 上传新图开始</div>';
    } else {
      var C = global.DaoyanCards;
      body = '<div class="dy-picker-grid">' + state.files.map(function (f) {
        var url = C && typeof C.thumbUrl === "function" ? C.thumbUrl(f.name) : "";
        return '<button class="dy-pk-item" data-name="' + esc(f.name)
          + '" title="' + esc(f.name) + '">'
          + (url ? '<img loading="lazy" src="' + esc(url)
            + '" alt="" onerror="this.style.visibility=\'hidden\'">' : "")
          + "<small>" + esc(f.name) + "</small></button>";
      }).join("") + "</div>";
    }
    return '<div class="dy-picker-mask" data-act="pk-close"><div class="dy-picker">'
      + head + bar + body + "</div></div>";
  }

  function render() {
    if (!el) return "";
    el.innerHTML = overlayHtml();
    return el.innerHTML;
  }

  function ensureEl() {
    if (el) return el;
    el = document.createElement("div");
    el.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var mask = el.firstElementChild || null;
      if (t === mask) { close(); return; } // 点空白遮罩=关
      var actEl = t.closest("[data-act]");
      var act = actEl ? actEl.getAttribute("data-act") : null;
      if (act === "pk-close") {
        close();
      } else if (act === "pk-upload") {
        var f = el.querySelector('[data-act="pk-upload-file"]');
        if (f) { f.value = ""; f.click(); }
      } else {
        var item = t.closest("[data-name]");
        if (item) pick(item.getAttribute("data-name"));
      }
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute("data-act") === "pk-upload-file") {
        var file = t.files && t.files.length ? t.files[0] : null;
        t.value = "";
        if (file) upload(file);
      }
    });
    if (document.body && document.body.appendChild) document.body.appendChild(el);
    return el;
  }

  function close() {
    state = blank();
    ctxCtrl = null;
    if (el && el.remove) { try { el.remove(); } catch (err) { /* stub 容错 */ } }
    el = null;
    return true;
  }

  /** 点选入槽:cards 现有动作面(9槽/8异图守门自动生效);成功自闭 */
  function pick(name) {
    if (!state.open) return false;
    var n = String(name || "").trim();
    if (!n) return false;
    var C = global.DaoyanCards;
    if (!C || !C.actions || !ctxCtrl) {
      state.notice = "选图回调不可用";
      render();
      return false;
    }
    var ok;
    if (state.zone === "common") {
      ok = state.slot == null ? C.actions.addCommonImage(ctxCtrl, n)
                              : C.actions.replaceCommonImage(ctxCtrl, state.slot, n);
    } else {
      ok = state.slot == null ? C.actions.addGroupImage(ctxCtrl, state.segIdx, n)
                              : C.actions.replaceGroupImage(ctxCtrl, state.segIdx, state.slot, n);
    }
    if (!ok) {
      state.notice = "入槽被拒(槽≤9/异图≤8/重名):" + n;
      render();
      return false;
    }
    close();
    return true;
  }

  /** 重拉图库(当前开面;mtime 倒序=服务侧排) */
  function refresh() {
    if (!state.open) return Promise.resolve(snapshot());
    return fetchMedia().then(function (data) {
      if (data && !data.error && Array.isArray(data.files)) {
        state.files = data.files;
        state.count = typeof data.count === "number" ? data.count : data.files.length;
        state.error = null;
      } else {
        state.files = [];
        state.error = (data && data.error) || "图库读取失败";
      }
      state.loading = false;
      render();
      return snapshot();
    });
  }

  /**
   * 开图库浮层。
   * @param {object} opts {zone:"common"|"own", segIdx, slot(null=新增/数字=原位替换), ctrl}
   * @returns {Promise<object>} 终态快照(降级=error 面,不炸)
   */
  function open(opts) {
    opts = opts || {};
    state = { open: true,
      zone: opts.zone === "common" ? "common" : "own",
      segIdx: opts.segIdx == null ? 0 : opts.segIdx,
      slot: opts.slot == null ? null : opts.slot,
      files: [], count: 0, loading: true, error: null, notice: "" };
    ctxCtrl = opts.ctrl || null;
    ensureStyle();
    ensureEl();
    render();
    return refresh();
  }

  /** 上传新图(DaoyanCards 上传器=引擎真传/测试桩;上传后自刷新) */
  function upload(file) {
    if (!file) return Promise.resolve({ ok: false, err: "无文件" });
    var C = global.DaoyanCards;
    if (!C || typeof C.uploadFile !== "function") {
      state.notice = "上传器不可用";
      render();
      return Promise.resolve({ ok: false, err: "uploader missing" });
    }
    return C.uploadFile(file).then(function (r) {
      state.notice = "已上传:" + ((r && r.name) || "");
      return refresh().then(function () { return { ok: true, name: r && r.name }; });
    }).catch(function (err) {
      state.notice = "上传失败:" + (err && err.message || err);
      render();
      return { ok: false, err: state.notice };
    });
  }

  global.DaoyanPicker = {
    open: open,
    close: close,
    state: snapshot,
    pick: pick,
    refresh: refresh,
    upload: upload,
    overlayHtml: overlayHtml,
    css: CSS,
    /** 测试钩子:清状态+摘浮层 */
    reset: function () { close(); },
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
