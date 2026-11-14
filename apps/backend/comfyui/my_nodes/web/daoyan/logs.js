// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// DaoyanLogs:导演台运行日志区(1114 阶段3.5 可观测,审计 gap2 面板半)。
//
// 数据源=导演台自有只读路由(daoyan_server.py 官方 PromptServer 路由,
// 零改引擎本体):
//   GET /my_daoyan/logs?chapter=<v>&limit=500
//     → { chapter, path, lines:[str], error? }(文件缺失 404 带 error)
// 消费面:fetch 尾读渲染/手动刷新/运行中 5s 轮询(setInterval 关闭/重渲
// 即清);fetch 全 guard(typeof fetch + catch)——无 fetch 环境(vm 测试/
// 纯浏览器)降级占位不炸。引擎侧=RunLog 双落点(控制台+章目录
// run-log.txt),此处只读文件侧。
// 双轨装载同 serial.js 头注口径:IIFE 挂 window.DaoyanLogs,无 import/export。
(function (global) {
  "use strict";

  var LIMIT = 500;
  var POLL_MS = 5000;

  var state = { chapter: null, lines: [], path: null, error: null, loading: false };
  var timer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  function fetchLog(chapter, limit) {
    if (typeof fetch !== "function") {
      return Promise.resolve({ error: "无 fetch 环境(日志不可用)" });
    }
    return fetch("/my_daoyan/logs?chapter=" + encodeURIComponent(chapter)
      + "&limit=" + (limit || LIMIT))
      .then(function (r) { return r.json(); })
      .catch(function (err) { return { error: "日志服务不可达:" + err }; });
  }

  function update(el, data) {
    if (data && !data.error && typeof data === "object") {
      state.lines = Array.isArray(data.lines) ? data.lines.map(String) : [];
      state.path = typeof data.path === "string" ? data.path : null;
      state.chapter = typeof data.chapter === "string" ? data.chapter
        : state.chapter;
      state.error = null;
    } else {
      state.error = (data && data.error) || "日志读取失败";
    }
    state.loading = false;
    render(el);
    return snapshot();
  }

  function render(el) {
    if (!el) return "";
    var head = "运行日志"
      + (state.chapter ? " · " + esc(state.chapter) : "")
      + ' <button class="dy-btn" data-act="runlog-refresh" title="立即重读本章 run-log.txt 尾行">刷新</button>'
      + (state.path
        ? '<span class="dy-log-path" title="' + esc(state.path) + '">'
          + esc(state.path) + "</span>"
        : "");
    var body;
    if (state.error) {
      body = '<div class="dy-log-empty">' + esc(state.error) + "</div>";
    } else if (state.loading) {
      body = '<div class="dy-log-empty">载入中…</div>';
    } else if (!state.lines.length) {
      body = '<div class="dy-log-empty">暂无日志(选择运行后此处逐行留痕;'
        + "引擎侧 run-log.txt 双落点)</div>";
    } else {
      body = '<pre class="dy-log-lines">' + state.lines.map(esc).join("\n")
        + "</pre>";
    }
    var html = '<div class="daoyan-logs"><div class="dy-log-title">' + head
      + "</div>" + body + "</div>";
    el.innerHTML = html;
    return html;
  }

  var logs = {
    /** 打开日志区:载入+渲染(toolbar「运行日志」钮/build 接线驱动) */
    open: function (el, chapter) {
      state.chapter = String(chapter || "");
      state.loading = true;
      render(el);
      return fetchLog(state.chapter).then(function (data) {
        return update(el, data);
      });
    },
    /** 手动刷新(当前 chapter 重拉) */
    refresh: function (el) {
      if (state.chapter == null) return Promise.resolve(snapshot());
      return fetchLog(state.chapter).then(function (data) {
        return update(el, data);
      });
    },
    /** 运行中轮询(view.running 期间 5s;isRunning 回调假即自停) */
    startPolling: function (el, isRunning) {
      logs.stopPolling();
      timer = global.setInterval(function () {
        if (typeof isRunning === "function" && !isRunning()) {
          logs.stopPolling();
          return;
        }
        logs.refresh(el);
      }, POLL_MS);
      return timer;
    },
    stopPolling: function () {
      if (timer != null) { global.clearInterval(timer); timer = null; }
      return true;
    },
    polling: function () { return timer != null; },
    render: render,
    state: snapshot,
    /** 测试钩子:清状态+停轮询 */
    reset: function () {
      state = { chapter: null, lines: [], path: null, error: null, loading: false };
      logs.stopPolling();
    },
  };

  global.DaoyanLogs = logs;
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
