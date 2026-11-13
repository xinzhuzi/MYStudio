// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director (Apache-2.0):
// minimax_gen_timeline.js:242 MAX_REFERENCE_IMAGES=9 + :245-252 图片槽标签
// ("图片 N"/<Picture N>) 与 minimax_image_batch.js:2518 素材组卡片——
// 布局复刻、代码重写(PRD R3;核心件=公共图区只读+本组图区+翻页/复制/
// 删除/重跑此镜,PRD R1.5/R1.6)。
// 1113 阶段1.5 补丁④:图片槽编号续号制——公共图区占 图片1-N,本组图区
// 从 图片N+1 续号(<Picture N> 全局连续编号口径)。
//
// 素材组卡片(阶段2 交互):空状态引导卡(零组=「添加第一组」大按钮,
// PRD R1.6)/组管理(翻页/复制/删除两步确认/重跑此镜按钮态)/组级参数行
// (参考图尺寸 match▾+秒数双单位)/公共图区管理/本组图槽增删(续号制)。
// 1113 门禁追认补:素材进出全量落地(PRD R1.5「面板内直接上传/替换/
// 删除图(走 input/ 通道),上传即缩略图进卡片;也支持引用已有文件」)
// ——真上传=POST /upload/image(注入式上传器,引擎真传/测试桩双态),
// 缩略图=/view?type=input 死图回退 🖼 字形,替换=槽角 ⇄ 原位换图。
// IIFE 挂 window.DaoyanCards,无 import/export 语法(见 serial.js 头注)。
(function (global) {
  "use strict";

  var CSS = [
    ".daoyan-cards{display:flex;flex-direction:column;gap:8px;font:400 12px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8edf6;}",
    ".dy-card{border:1px solid rgba(255,255,255,.09);border-radius:10px;background:linear-gradient(180deg,rgba(18,24,38,.78),rgba(10,14,24,.84));overflow:hidden;}",
    ".dy-card-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.07);font-size:12px;font-weight:700;color:#f0f4fa;flex-wrap:wrap;}",
    ".dy-card-head .dy-mode{font-size:9.5px;color:#0c1220;background:#6ea8fe;border-radius:999px;padding:0 7px;flex:none;}",
    ".dy-card-head .dy-meta{font-size:10.5px;color:#9aa7ba;font-weight:400;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-card-head .dy-actions{margin-left:auto;display:flex;gap:5px;}",
    ".dy-btn{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2.5px 9px;cursor:pointer;white-space:nowrap;}",
    ".dy-btn--primary{background:rgba(52,211,153,.16);border-color:rgba(52,211,153,.4);color:#d9f7ea;}",
    ".dy-btn--ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#9aa7ba;}",
    ".dy-btn--rerun{background:linear-gradient(180deg,rgba(52,211,153,.32),rgba(52,211,153,.18));border-color:rgba(52,211,153,.6);color:#eafff5;}",
    ".dy-btn--armed{background:rgba(248,113,113,.2);border-color:rgba(248,113,113,.6);color:#fecaca;}",
    /* 组级参数行(参考图尺寸 match▾+秒数双单位+seed) */
    ".dy-gparams{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;color:#9aa7ba;}",
    ".dy-gparams label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}",
    ".dy-gparams select,.dy-gparams input[type=number]{border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,24,.72);color:#dbe7fb;padding:2px 7px;font:inherit;font-size:11px;outline:none;}",
    ".dy-gparams select:focus,.dy-gparams input:focus{border-color:rgba(110,168,254,.55);}",
    ".dy-gparams .dy-frames{color:#f5cd6d;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-gparams .dy-off{font-size:10px;color:#fbbf24;border:1px solid rgba(251,191,36,.35);border-radius:999px;padding:0 6px;}",
    /* 公共参数行(已启用/展开/禁用) */
    ".dy-common-params{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;color:#9aa7ba;}",
    ".dy-common-params .dy-cp-state{color:#34d399;font-weight:700;}",
    ".dy-common-params .dy-cp-state--off{color:#9aa7ba;font-weight:400;}",
    ".dy-common-params .dy-cp-detail{font-size:10.5px;color:#7d8b9f;font-family:ui-monospace,'SF Mono',Menlo,monospace;}",
    ".dy-slot-zone{padding:8px 12px 4px;}",
    ".dy-slot-zone-title{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#9aa7ba;margin-bottom:5px;flex-wrap:wrap;}",
    ".dy-slot-zone-title .dy-ro{font-size:9.5px;color:#fbbf24;border:1px solid rgba(251,191,36,.35);border-radius:999px;padding:0 6px;}",
    ".dy-slots{display:flex;flex-wrap:wrap;gap:5px;}",
    ".dy-slot{position:relative;width:56px;height:56px;border-radius:7px;border:1px dashed rgba(255,255,255,.18);background:rgba(255,255,255,.03);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#7d8b9f;font-size:13px;overflow:hidden;}",
    ".dy-slot small{font-size:8.5px;color:#7d8b9f;pointer-events:none;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".dy-slot--filled{border-style:solid;border-color:rgba(110,168,254,.4);background:linear-gradient(180deg,rgba(110,168,254,.16),rgba(110,168,254,.06));color:#a8c8f2;}",
    ".dy-slot--filled small{color:#c7d9f5;background:rgba(7,11,20,.72);border-radius:3px;padding:0 2px;max-width:52px;}",
    ".dy-slot--ro{border-color:rgba(251,191,36,.3);}",
    /* 真缩略图(上传即进卡):/view 图绝对铺槽;死图(file:// 预览/未装)回退 🖼 字形 */
    ".dy-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:6px;z-index:1;}",
    ".dy-thumb--dead{display:none;}",
    ".dy-slot-glyph{z-index:0;}",
    ".dy-slot--filled small{z-index:2;position:relative;}",
    ".dy-slot-swap{position:absolute;bottom:1px;left:2px;font-size:9px;font-style:normal;color:#8dbcff;cursor:pointer;line-height:1;padding:1px;z-index:3;}",
    ".dy-slot-swap:hover{color:#c7e2ff;}",
    ".dy-slot-x{position:absolute;top:1px;right:2px;font-size:9px;color:#f87171;cursor:pointer;line-height:1;padding:1px;z-index:3;}",
    ".dy-slot-x:hover{color:#fecaca;}",
    ".dy-file-row{display:flex;align-items:center;gap:5px;padding:4px 12px 7px;font-size:10.5px;color:#7d8b9f;flex-wrap:wrap;}",
    ".dy-file-row input[type=text]{flex:1;min-width:120px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,24,.72);color:#dbe7fb;padding:3px 8px;font:inherit;font-size:10.5px;outline:none;}",
    ".dy-file-row input:focus{border-color:rgba(110,168,254,.55);}",
    ".dy-file-add{font-size:10.5px;font-weight:600;color:#dbe7fb;background:rgba(110,168,254,.14);border:1px solid rgba(110,168,254,.32);border-radius:7px;padding:2px 9px;cursor:pointer;white-space:nowrap;}",
    ".dy-upload-file{display:none;}",
    ".dy-upload-err{font-size:10px;color:#f87171;border:1px solid rgba(248,113,113,.4);border-radius:6px;padding:0 6px;cursor:help;}",
    ".dy-card-foot{display:flex;align-items:center;gap:10px;padding:7px 12px 9px;font-size:10.5px;color:#9aa7ba;flex-wrap:wrap;}",
    ".dy-pager{display:flex;align-items:center;gap:6px;}",
    ".dy-pager i{font-style:normal;color:#6ea8fe;cursor:pointer;font-weight:700;padding:0 3px;}",
    ".dy-pager i.dy-pager--off{color:#4b5568;cursor:default;}",
    /* 空状态引导卡(PRD R1.6:零组禁白屏) */
    ".dy-empty-guide{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 16px;border:1px dashed rgba(110,168,254,.35);border-radius:10px;background:rgba(110,168,254,.05);text-align:center;}",
    ".dy-empty-guide .dy-big{font-size:15px;font-weight:700;color:#eafff5;background:linear-gradient(180deg,rgba(52,211,153,.34),rgba(52,211,153,.2));border:1px solid rgba(52,211,153,.6);border-radius:10px;padding:10px 26px;cursor:pointer;}",
    ".dy-empty-guide .dy-desc{font-size:11px;color:#9aa7ba;max-width:340px;}",
  ].join("\n");

  var STYLE_ID = "daoyan-cards-style";

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

  // ── 纯函数 ─────────────────────────────────────────────────────────

  /** 续号制标签:公共区 slot i → 图片 i+1;本组区 slot j → 图片 common+j+1 */
  function pictureLabel(state, zone, slotIdx) {
    var common = (state && state.common_images) ? state.common_images.length : 0;
    return "图片 " + (zone === "common" ? slotIdx + 1 : common + slotIdx + 1);
  }

  /** 缩略图 URL(input/ 通道图=引擎 /view 端点;name 含子目录时拆参数) */
  function thumbUrl(name) {
    var file = String(name || "");
    var sub = "";
    var slash = file.lastIndexOf("/");
    if (slash >= 0) { sub = file.slice(0, slash); file = file.slice(slash + 1); }
    return "/view?filename=" + encodeURIComponent(file)
      + "&type=input&subfolder=" + encodeURIComponent(sub);
  }

  // ── 上传器(input/ 通道;注入式=引擎真传/测试桩/预览降级三态)──────
  // 默认=引擎官方路由 POST /upload/image(multipart 字段 image;AIMixer
  // 同款通道)。引擎页面源=引擎源,直 fetch 即达;file:// 预览与测试
  // 无服务 → 调用方注入(setUploader)或走错误路径不咬主路。
  var injectedUploader = null;
  var lastUploadError = "";

  function defaultUploader(file) {
    var fd = new FormData();
    fd.append("image", file);
    fd.append("overwrite", "true");
    return fetch("/upload/image", { method: "POST", body: fd }).then(function (r) {
      if (!r.ok) throw new Error("upload HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.name) throw new Error("upload 响应无文件名");
      return { name: j.name, subfolder: j.subfolder || "" };
    });
  }
  function getUploader() { return injectedUploader || defaultUploader; }
  /** 注入上传器(测试桩/引擎定制;null=还原默认 /upload/image) */
  function setUploader(fn) { injectedUploader = typeof fn === "function" ? fn : null; }

  // ── 动作 ───────────────────────────────────────────────────────────

  var actions = {
    /** 添加组(=添加分段,默认吃公共参数档:时长/seed;自动选中) */
    addGroup: function (ctrl) {
      var cp = ctrl.state.common_params;
      ctrl.apply(function (st) {
        st.segments.push(S().normalizeSegment({
          seconds: cp.seconds, seed: cp.seed, match: cp.match,
        }, st.segments.length));
      });
      ctrl.view.selected = ctrl.state.segments.length - 1;
      return ctrl;
    },
    prevGroup: function (ctrl) {
      if (ctrl.view.selected <= 0) return false;
      ctrl.view.selected -= 1;
      ctrl.view.armedDelete = -1;
      ctrl.apply(function () {});
      return true;
    },
    nextGroup: function (ctrl) {
      if (ctrl.view.selected >= ctrl.state.segments.length - 1) return false;
      ctrl.view.selected += 1;
      ctrl.view.armedDelete = -1;
      ctrl.apply(function () {});
      return true;
    },
    /** 复制组(深拷贝插其后,id 加「副本」,自动选中) */
    duplicateGroup: function (ctrl, idx) {
      var i = idx == null ? ctrl.view.selected : idx;
      var seg = ctrl.state.segments[i];
      if (!seg) return false;
      ctrl.apply(function (st) {
        var copy = JSON.parse(JSON.stringify(st.segments[i]));
        copy.id = seg.id + " 副本";
        copy.rerun = false;
        st.segments.splice(i + 1, 0, copy);
      });
      ctrl.view.selected = i + 1;
      return true;
    },
    /** 删除组:两步确认兜底(第一步布防红钮,第二步真删;Ctrl+Z 可回退) */
    deleteGroup: function (ctrl, idx) {
      var i = idx == null ? ctrl.view.selected : idx;
      if (i < 0 || i >= ctrl.state.segments.length) return false;
      if (ctrl.view.armedDelete !== i) {
        ctrl.view.armedDelete = i;
        ctrl.apply(function () {}); // 仅视图态,通知重渲出「确认删除」
        return false;
      }
      ctrl.view.armedDelete = -1;
      ctrl.apply(function (st) { st.segments.splice(i, 1); });
      return true;
    },
    /** 单镜重掷按钮态(PRD R1.5:覆盖与跳过两语义分离) */
    toggleRerun: function (ctrl, idx) {
      var i = idx == null ? ctrl.view.selected : idx;
      if (!ctrl.state.segments[i]) return false;
      ctrl.apply(function (st) { st.segments[i].rerun = !st.segments[i].rerun; });
      return true;
    },
    setGroupMode: function (ctrl, idx, mode) {
      if (!ctrl.state.segments[idx] || S().SEGMENT_MODES.indexOf(mode) < 0) return false;
      ctrl.apply(function (st) { st.segments[idx].mode = mode; });
      return true;
    },
    setGroupMatch: function (ctrl, idx, match) {
      if (!ctrl.state.segments[idx] || S().MATCH_MODES.indexOf(match) < 0) return false;
      ctrl.apply(function (st) { st.segments[idx].match = match; });
      return true;
    },
    setGroupSeed: function (ctrl, idx, seed) {
      if (!ctrl.state.segments[idx]) return false;
      var v = S().normalizeSegment({ seed: seed }).seed; // int|null 归一
      ctrl.apply(function (st) { st.segments[idx].seed = v; });
      return true;
    },
    /** 秒数(与时间线同贴网格;双单位显示;timeline 优先委派) */
    setGroupSeconds: function (ctrl, idx, seconds) {
      if (global.DaoyanTimeline && global.DaoyanTimeline.actions) {
        return global.DaoyanTimeline.actions.setSegmentSeconds(ctrl, idx, seconds);
      }
      var seg = ctrl.state.segments[idx];
      if (!seg) return false;
      var sec = Math.max(0.2, Math.round(Number(seconds) * 100) / 100);
      if (!isFinite(sec) || sec <= 0) return false;
      ctrl.apply(function (st) {
        st.segments[idx].seconds = sec;
        st.segments[idx].frames = S().secondsToFrames(sec);
      });
      return true;
    },
    /** 本组禁用公共参数(use_common=false) */
    setUseCommon: function (ctrl, idx, use) {
      if (!ctrl.state.segments[idx]) return false;
      ctrl.apply(function (st) { st.segments[idx].use_common = !!use; });
      return true;
    },
    toggleCommonEnabled: function (ctrl) {
      ctrl.apply(function (st) { st.common_params.enabled = !st.common_params.enabled; });
      return ctrl.state.common_params.enabled;
    },
    toggleCommonExpanded: function (ctrl) {
      ctrl.view.commonExpanded = !ctrl.view.commonExpanded;
      ctrl.apply(function () {});
      return ctrl.view.commonExpanded;
    },
    /** 公共图区添加(文件名引用已有;真上传走 uploadToZone)。守门=每镜
     * 总参考 ≤9:公共数+现存各组本组图最大数+1 ≤9(1113 追认批修:
     * 旧守门只数公共自身,9 公共+组内 1 图=该镜 10 参考破 AUTOGROW 顶) */
    addCommonImage: function (ctrl, filename) {
      var name = String(filename || "").trim();
      if (!name) return false;
      var st = ctrl.state;
      var maxOwn = 0;
      for (var gi = 0; gi < st.segments.length; gi++) {
        maxOwn = Math.max(maxOwn, st.segments[gi].images.length);
      }
      if (st.common_images.length + maxOwn + 1 > S().MAX_REFERENCE_IMAGES) return false;
      if (st.common_images.indexOf(name) >= 0) return false;
      ctrl.apply(function (s) { s.common_images.push(name); });
      return true;
    },
    removeCommonImage: function (ctrl, i) {
      if (i < 0 || i >= ctrl.state.common_images.length) return false;
      ctrl.apply(function (st) { st.common_images.splice(i, 1); });
      return true;
    },
    /** 本组图槽添加(续号制:公共 N 张+本组 M 张 ≤9) */
    addGroupImage: function (ctrl, segIdx, filename) {
      var name = String(filename || "").trim();
      var seg = ctrl.state.segments[segIdx];
      if (!name || !seg) return false;
      if (ctrl.state.common_images.length + seg.images.length + 1 > S().MAX_REFERENCE_IMAGES) return false;
      if (seg.images.indexOf(name) >= 0) return false;
      ctrl.apply(function (st) { st.segments[segIdx].images.push(name); });
      return true;
    },
    removeGroupImage: function (ctrl, segIdx, slot) {
      var seg = ctrl.state.segments[segIdx];
      if (!seg || slot < 0 || slot >= seg.images.length) return false;
      ctrl.apply(function (st) { st.segments[segIdx].images.splice(slot, 1); });
      return true;
    },
    /** 替换公共图槽(原位换图,槽位/续号不动;PRD R1.5「替换」) */
    replaceCommonImage: function (ctrl, i, filename) {
      var name = String(filename || "").trim();
      if (!name || i < 0 || i >= ctrl.state.common_images.length) return false;
      var dup = ctrl.state.common_images.indexOf(name);
      if (dup >= 0 && dup !== i) return false; // 与他槽重名拒(原位同名=幂等直过)
      ctrl.apply(function (st) { st.common_images[i] = name; });
      return true;
    },
    /** 替换本组图槽(原位换图,槽位/续号不动) */
    replaceGroupImage: function (ctrl, segIdx, slot, filename) {
      var name = String(filename || "").trim();
      var seg = ctrl.state.segments[segIdx];
      if (!name || !seg || slot < 0 || slot >= seg.images.length) return false;
      var dup = seg.images.indexOf(name);
      if (dup >= 0 && dup !== slot) return false;
      ctrl.apply(function (st) { st.segments[segIdx].images[slot] = name; });
      return true;
    },
    /** 真上传入槽(input/ 通道):uploader(file)→引擎名→addXxxImage
     * (守门/去重与文件名引用同面);Promise<{ok,name,err}> */
    uploadToZone: function (ctrl, zone, segIdx, file) {
      lastUploadError = "";
      return Promise.resolve().then(function () { return getUploader()(file); })
        .then(function (r) {
          var name = (r && r.subfolder ? r.subfolder + "/" : "") + (r && r.name);
          var ok = zone === "common"
            ? actions.addCommonImage(ctrl, name)
            : actions.addGroupImage(ctrl, segIdx, name);
          if (!ok) { lastUploadError = "入槽被拒(上限 9/重名):" + name; }
          return { ok: ok, name: name, err: lastUploadError };
        })
        .catch(function (err) {
          lastUploadError = String(err && err.message || err);
          return { ok: false, name: "", err: lastUploadError };
        });
    },
    /** 真上传替换槽:uploader→引擎名→replaceXxx(原位) */
    uploadReplaceSlot: function (ctrl, zone, segIdx, slot, file) {
      lastUploadError = "";
      return Promise.resolve().then(function () { return getUploader()(file); })
        .then(function (r) {
          var name = (r && r.subfolder ? r.subfolder + "/" : "") + (r && r.name);
          var ok = zone === "common"
            ? actions.replaceCommonImage(ctrl, slot, name)
            : actions.replaceGroupImage(ctrl, segIdx, slot, name);
          if (!ok) { lastUploadError = "替换被拒(重名):" + name; }
          return { ok: ok, name: name, err: lastUploadError };
        })
        .catch(function (err) {
          lastUploadError = String(err && err.message || err);
          return { ok: false, name: "", err: lastUploadError };
        });
    },
  };

  // ── 渲染 ───────────────────────────────────────────────────────────

  /** 素材槽(filled=缩略图入槽:/view 真缩略图+死图回退 🖼 字形;槽角
   * ⇄ 替换/✕ 删除;续号标签) */
  function slot(file, label, readOnly, removable, zone, idx) {
    var filled = !!file;
    var html = '<div class="dy-slot' + (filled ? " dy-slot--filled" : "")
      + (readOnly ? " dy-slot--ro" : "") + '"'
      + (filled ? ' title="' + esc(file) + '"' : "") + ">"
      + (filled
        ? '<img class="dy-thumb" loading="lazy" src="' + esc(thumbUrl(file))
          + '" alt="" onerror="this.classList.add(\'dy-thumb--dead\')">'
        : "")
      + '<span class="dy-slot-glyph">' + (filled ? "🖼" : "+") + "</span>"
      + "<small>" + esc(filled ? file : label) + "</small>";
    if (filled && removable) {
      html += '<i class="dy-slot-swap" data-act="swap-' + zone + '" data-i="' + idx
        + '" title="替换此槽(原位换图,上传或文件名)">⇄</i>'
        + '<i class="dy-slot-x" data-act="del-' + zone + '" data-i="' + idx + '" title="移除此图">✕</i>';
    }
    return html + "</div>";
  }

  function fileRow(zone, hint) {
    return '<div class="dy-file-row">'
      + '<input type="text" data-act="file-' + zone + '" placeholder="input/ 文件名,如 sb001_scene.jpg(引用已有)" title="' + esc(hint) + '">'
      + '<button class="dy-file-add" data-act="add-' + zone + '">添加</button>'
      + '<button class="dy-file-add" data-act="upload-' + zone + '" title="真上传走 input/ 通道(POST /upload/image),上传即缩略图进卡">⬆ 上传</button>'
      + '<input type="file" accept="image/*" class="dy-upload-file" data-act="upload-file-' + zone + '">'
      + (lastUploadError ? '<span class="dy-upload-err" title="' + esc(lastUploadError) + '">上传失败</span>' : "")
      + "</div>";
  }

  /**
   * 渲染素材组卡(阶段2 交互)。
   * @param {HTMLElement} root
   * @param {object} ctx DaoyanSerial 控制器(裸 state 自动包 demo 控制器=静态)
   */
  function build(root, ctx) {
    ensureStyle();
    var ctrl = S().ctrlOf(ctx);
    var st = ctrl.state;
    var sel = ctrl.view.selected;
    var seg = st.segments[sel];

    // 空状态引导卡(PRD R1.6:零组=大按钮引导,禁白屏)
    if (!st.segments.length) {
      root.innerHTML = [
        '<div class="dy-empty-guide">',
        '<div class="dy-big" data-act="add-group">＋ 添加第一组</div>',
        '<div class="dy-desc">一组=一镜:分镜帧与专属参考图入本组图区,角色卡入公共图区;时长自动贴 17k+5 帧网格。</div>',
        "</div>",
      ].join("");
      bind(root, ctrl);
      return root;
    }

    var common = st.common_images;
    var ownMax = Math.max(0, S().MAX_REFERENCE_IMAGES - common.length);
    var ownPad = Math.max(0, Math.min(3, ownMax - seg.images.length)); // 空槽留 3 个点击位
    var armed = ctrl.view.armedDelete === sel;
    var cp = st.common_params;

    var commonSlots = common.map(function (f, i) {
      return slot(f, pictureLabel(st, "common", i), true, true, "common", i);
    }).join("");

    var ownSlots = seg.images.map(function (f, j) {
      return slot(f, pictureLabel(st, "own", j), false, true, "own", j);
    }).join("");
    for (var k = 0; k < ownPad; k++) {
      ownSlots += slot("", pictureLabel(st, "own", seg.images.length + k), false, false);
    }

    root.innerHTML = [
      '<div class="dy-card">',
      '<div class="dy-card-head">',
      "镜头 " + (sel + 1) + " / " + st.segments.length,
      '<select data-act="set-mode" title="每镜 task 四选一(默认 r2v=产线口径)">'
      + S().SEGMENT_MODES.map(function (m) {
        return '<option value="' + m + '"' + (seg.mode === m ? " selected" : "") + ">" + m + "</option>";
      }).join("") + "</select>",
      '<span class="dy-meta">' + seg.seconds + "s→" + seg.frames + "f · seed " + (seg.seed == null ? "继承全局" : seg.seed)
      + (seg.rerun ? " · 重掷已布防" : "") + "</span>",
      '<span class="dy-actions">',
      '<button class="dy-btn dy-btn--rerun' + (seg.rerun ? "" : " dy-btn--ghost") + '" data-act="toggle-rerun" title="强制覆盖该镜当前阶段产物(不点=默认跳过已完镜)">重跑此镜' + (seg.rerun ? " ✓" : "") + "</button>",
      '<button class="dy-btn" data-act="dup-group">复制组</button>',
      '<button class="dy-btn' + (armed ? " dy-btn--armed" : " dy-btn--ghost") + '" data-act="del-group" title="两步确认;Ctrl+Z 可撤销">' + (armed ? "确认删除?" : "删除组") + "</button>",
      "</span></div>",
      /* 组级参数行:参考图尺寸 match▾ + 秒数(双单位) */
      '<div class="dy-gparams">',
      "<label>参考图尺寸 <select data-act=\"set-match\">"
      + S().MATCH_MODES.map(function (m) {
        return '<option value="' + m + '"' + (seg.match === m ? " selected" : "") + ">" + m + "</option>";
      }).join("") + "</select></label>",
      "<label>秒数 <input type=\"number\" min=\"0.2\" step=\"0.5\" value=\"" + seg.seconds + '" data-act="set-seconds">'
      + '<span class="dy-frames">→ ' + seg.frames + "f</span></label>",
      "<label>seed <input type=\"number\" value=\"" + (seg.seed == null ? "" : seg.seed) + '" placeholder="继承" data-act="set-seed"></label>',
      seg.use_common ? "" : '<span class="dy-off">公共参数已禁用(本组)</span>',
      "</div>",
      /* 公共参数行(已启用/展开/禁用) */
      '<div class="dy-common-params">',
      "<span>公共参数:<b class=\"dy-cp-state" + (cp.enabled ? "" : " dy-cp-state--off") + "\">"
      + (cp.enabled ? "已启用" : "已停用") + "</b></span>",
      '<button class="dy-btn dy-btn--ghost" data-act="toggle-cp-enabled">' + (cp.enabled ? "停用" : "启用") + "</button>",
      '<button class="dy-btn" data-act="toggle-cp-expand">' + (ctrl.view.commonExpanded ? "收起 ▴" : "展开 ▾") + "</button>",
      '<button class="dy-btn' + (seg.use_common ? " dy-btn--ghost" : "") + '" data-act="toggle-use-common">'
      + (seg.use_common ? "本组禁用" : "本组已禁用·恢复") + "</button>",
      ctrl.view.commonExpanded
        ? '<span class="dy-cp-detail">公共档:时长 ' + cp.seconds + "s→" + S().secondsToFrames(cp.seconds) + "f · seed " + cp.seed + " · 参考图尺寸 " + cp.match + "(新组默认吃此档)</span>"
        : "",
      "</div>",
      '<div class="dy-slot-zone">',
      '<div class="dy-slot-zone-title">公共图区(角色卡,全章共享,占 图片1-' + common.length + ")<span class=\"dy-ro\">只读</span>"
      + "<span>共 " + common.length + " 张 · 公共+本组合计上限 " + S().MAX_REFERENCE_IMAGES + " 槽</span></div>",
      '<div class="dy-slots">' + commonSlots + "</div>",
      "</div>",
      fileRow("common", "公共图=全章共享(角色卡/场景卡);文件名引用 input/ 已有图,或⬆ 上传新图"),
      '<div class="dy-slot-zone">',
      '<div class="dy-slot-zone-title">本组图区(分镜帧 / 专属参考,从 图片' + (common.length + 1) + " 续号)"
      + "<span>已 " + seg.images.length + "/" + ownMax + " 张</span></div>",
      '<div class="dy-slots">' + ownSlots + "</div>",
      "</div>",
      fileRow("own", "回车或点添加:文件名引用入槽(续号);⬆ 上传=input/ 通道直传,上传即缩略图进卡"),
      '<div class="dy-card-foot">',
      '<span class="dy-pager">'
      + '<i data-act="prev-group"' + (sel > 0 ? "" : ' class="dy-pager--off"') + ">◀</i>"
      + " 第 " + (sel + 1) + " / " + st.segments.length + " 组 "
      + '<i data-act="next-group"' + (sel < st.segments.length - 1 ? "" : ' class="dy-pager--off"') + ">▶</i></span>",
      "<span>编号续号制:公共图区占 图片1-" + common.length + ",本组图区从 图片" + (common.length + 1) + " 续号,与提示词 &lt;Picture N&gt; 全局一致</span>",
      "</div>",
      "</div>",
    ].join("");
    bind(root, ctrl);
    return root;
  }

  /** 事件:点击委托+change/input 委托(重渲防重绑同 timeline.js 手法) */
  function bind(root, ctrl) {
    root._dyCardsCtrl = ctrl;
    if (root._dyCardsBound) return;
    root._dyCardsBound = true;
    root.addEventListener("click", function (e) {
      var ctrl = root._dyCardsCtrl;
      var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !ctrl) return;
      var act = el.getAttribute("data-act");
      var i = el.getAttribute("data-i");
      var sel = ctrl.view.selected;
      function pickFile(zone) {
        var f = root.querySelector('[data-act="upload-file-' + zone + '"]');
        if (f) { f.value = ""; f.click(); }
      }
      if (act === "add-group") actions.addGroup(ctrl);
      else if (act === "prev-group") actions.prevGroup(ctrl);
      else if (act === "next-group") actions.nextGroup(ctrl);
      else if (act === "dup-group") actions.duplicateGroup(ctrl, sel);
      else if (act === "del-group") actions.deleteGroup(ctrl, sel);
      else if (act === "toggle-rerun") actions.toggleRerun(ctrl, sel);
      else if (act === "toggle-cp-enabled") actions.toggleCommonEnabled(ctrl);
      else if (act === "toggle-cp-expand") actions.toggleCommonExpanded(ctrl);
      else if (act === "toggle-use-common") actions.setUseCommon(ctrl, sel, !ctrl.state.segments[sel].use_common);
      else if (act === "del-common") actions.removeCommonImage(ctrl, +i);
      else if (act === "del-own") actions.removeGroupImage(ctrl, sel, +i);
      else if (act === "swap-common" || act === "swap-own") {
        // 替换布防:记槽位→弹文件选择;上传成功后原位换图(槽位/续号不动)
        ctrl.view.pendingSwap = { zone: act === "swap-common" ? "common" : "own", seg: sel, slot: +i };
        pickFile(ctrl.view.pendingSwap.zone);
      } else if (act === "upload-common" || act === "upload-own") {
        ctrl.view.pendingSwap = null; // 非替换=新增入槽
        pickFile(act === "upload-common" ? "common" : "own");
      } else if (act === "add-common") {
        var inp = root.querySelector('[data-act="file-common"]');
        if (inp && actions.addCommonImage(ctrl, inp.value)) inp.value = "";
      } else if (act === "add-own") {
        var inp2 = root.querySelector('[data-act="file-own"]');
        if (inp2 && actions.addGroupImage(ctrl, sel, inp2.value)) inp2.value = "";
      }
    });
    root.addEventListener("change", function (e) {
      var ctrl = root._dyCardsCtrl;
      var el = e.target;
      if (!el || !el.getAttribute || !ctrl) return;
      var act = el.getAttribute("data-act");
      var sel = ctrl.view.selected;
      if (act === "set-mode") actions.setGroupMode(ctrl, sel, el.value);
      else if (act === "set-match") actions.setGroupMatch(ctrl, sel, el.value);
      else if (act === "set-seconds") actions.setGroupSeconds(ctrl, sel, el.value);
      else if (act === "set-seed") actions.setGroupSeed(ctrl, sel, el.value);
      else if (act === "upload-file-common" || act === "upload-file-own") {
        var zone = act === "upload-file-common" ? "common" : "own";
        var file = el.files && el.files.length ? el.files[0] : null;
        el.value = "";
        if (!file) return;
        var swap = ctrl.view.pendingSwap;
        ctrl.view.pendingSwap = null;
        var p = (swap && swap.zone === zone)
          ? actions.uploadReplaceSlot(ctrl, zone, swap.seg, swap.slot, file)
          : actions.uploadToZone(ctrl, zone, sel, file);
        p.then(function (r) {
          if (!r.ok) ctrl.apply(function () {}); // 失败态重渲示「上传失败」标
        });
      }
    });
    root.addEventListener("keydown", function (e) {
      var ctrl = root._dyCardsCtrl;
      var el = e.target;
      if (!el || !el.getAttribute || !ctrl || e.key !== "Enter") return;
      var act = el.getAttribute("data-act");
      var sel = ctrl.view.selected;
      if (act === "file-common" && actions.addCommonImage(ctrl, el.value)) el.value = "";
      if (act === "file-own" && actions.addGroupImage(ctrl, sel, el.value)) el.value = "";
    });
  }

  global.DaoyanCards = {
    build: build, css: CSS, actions: actions, pictureLabel: pictureLabel,
    thumbUrl: thumbUrl, setUploader: setUploader, lastUploadError: function () { return lastUploadError; },
    MAX_REFERENCE_IMAGES: 9,
  };
})(typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : this);
