// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节节点富内容 DOM 渲染(stage-node,09-12 任务 09-12-stage-node-typography)。
 *
 * 路线=官方扩展面 node.addDOMWidget(装机前端 1.51.10 domWidget.ts 实证),
 * 同 pysssss ShowText / rgthree Display Any 的框架机制家族:定位/缩放/显隐/
 * 指针全由前端 DomWidget.vue 承包,不经 litegraph canvas 背景 pass——对
 * 「两态渲染竞态」(research 定性:canvas 自绘会被启动期降级跳过)免疫。
 *
 * 共存设计:manying.js 的 canvas 自绘(manying.stage.render)保留为缺席
 * 兜底——本扩展挂载成功后以实例级 onDrawBackground 覆写静音之(原型链
 * 遮蔽,零改 monolith);删除本文件即回退 canvas 渲染。
 *
 * 排版=真 HTML+CSS(行高/省略/斑马/网格),高度真源=DOM 实测(getHeight
 * 回报)——生成器尺寸仅为首帧估计,双端常量漂移类裁切从机制上消灭。
 */
import { app } from "/scripts/app.js";

const BRIDGE_URL = (window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
const BRIDGE_TOKEN = window.MANYING_BRIDGE_TOKEN || "manying-local-image";

/** HTML 转义:载荷字符串全走此门(生成器产物,防意外标记注入) */
/** 缩略/封面晚到兜底:保鲜链补传一轮后文件才在(冷启动竞态)——404 后 2.5s
 * 换缓存戳重试至多 3 次,仍败=隐藏(占位文字在 img 之下自然透出)。 */
window.__manyingImgRetry = (img) => {
  const tries = (Number(img.dataset.tries) || 0) + 1;
  img.dataset.tries = String(tries);
  if (tries > 3) { img.style.display = "none"; return; }
  setTimeout(() => {
    img.src = img.src.split("&_=")[0] + "&_=" + Date.now();
  }, 2500);
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

// ── 设计系统(照 apple-design/frontend-design 技能:层级/字阶/克制)──────
const STATUS_COLOR = {
  ready: "#4ec9a8", pending: "#d9a25a", empty: "#7d8ba1", warning: "#e06c75",
};
const STYLES = `
.manying-stage-body{pointer-events:none;box-sizing:border-box;width:100%;
  padding:10px 12px 12px;font:400 12px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:rgba(235,240,248,.88);background:rgba(9,12,18,.42);border-radius:10px;
  display:flex;flex-direction:column;gap:8px;overflow:hidden;}
.manying-stage-body *{box-sizing:border-box;margin:0;}
.ms-head{display:flex;flex-direction:column;gap:6px;padding:8px 10px;
  background:rgba(255,255,255,.045);border-radius:8px;}
.ms-statusrow{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600;color:rgba(240,244,250,.94);}
.ms-dot{width:7px;height:7px;border-radius:50%;flex:none;box-shadow:0 0 5px -1px currentColor;}
.ms-export{margin-left:auto;font-size:10px;font-weight:600;color:#6ea8fe;
  border:1px solid rgba(110,168,254,.45);border-radius:999px;padding:1px 8px;}
.ms-desc{font-size:11px;color:rgba(178,188,204,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-metrics,.ms-skills{display:flex;flex-wrap:wrap;gap:5px;}
.ms-chip{font-size:10.5px;color:rgba(235,240,248,.82);background:rgba(255,255,255,.07);
  border-radius:5px;padding:2px 7px;white-space:nowrap;}
.ms-skill{font-size:10.5px;color:#9fc3f7;background:rgba(110,168,254,.12);
  border:1px solid rgba(110,168,254,.28);border-radius:999px;padding:1px 8px;white-space:nowrap;}
.ms-body{display:flex;flex-direction:column;gap:6px;min-height:0;}
.ms-pill{align-self:flex-start;font-size:10px;font-weight:600;letter-spacing:.04em;
  color:rgba(178,188,204,.9);background:rgba(255,255,255,.06);border-radius:999px;padding:2px 9px;}
.ms-lines{display:flex;flex-direction:column;font-size:11.5px;line-height:1.78;
  color:rgba(226,232,242,.82);}
.ms-lines>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px;}
.ms-lines>div:nth-child(even){background:rgba(255,255,255,.045);}
.ms-tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;}
.ms-tile{position:relative;aspect-ratio:3/4;border-radius:6px;overflow:hidden;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);}
.ms-tile img{width:100%;height:100%;object-fit:cover;display:block;}
.ms-tile .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:11px;color:rgba(178,188,204,.55);}
.ms-tile .sd{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;
  box-shadow:0 0 4px rgba(0,0,0,.6);}
.ms-tile .tt{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;font-size:8.5px;
  color:rgba(235,240,248,.92);background:linear-gradient(transparent,rgba(0,0,0,.72));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-rows{display:flex;flex-direction:column;font-size:11px;}
.ms-row{display:flex;align-items:baseline;gap:8px;padding:3px 6px;border-radius:5px;}
.ms-row:nth-child(even){background:rgba(255,255,255,.028);}
.ms-row .idx{color:#9fc3f7;font-weight:600;flex:none;min-width:30px;}
.ms-row .main{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-row .main .scene{color:rgba(178,188,204,.75);margin-right:6px;}
.ms-row .sub{display:block;font-size:10px;color:rgba(160,172,190,.68);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
.ms-row .meta{flex:none;color:rgba(178,188,204,.8);font-size:10.5px;}
.ms-badges{display:flex;gap:4px;flex:none;align-items:center;}
.ms-badge{font-size:9.5px;border-radius:4px;padding:0 4.5px;line-height:16px;font-weight:600;}
.ms-badge--ok{color:#4ec9a8;background:rgba(78,201,168,.13);}
.ms-badge--wait{color:rgba(178,188,204,.75);background:rgba(255,255,255,.06);}
.ms-badge--rev{color:#c9a6f7;background:rgba(201,166,247,.12);}
.ms-badge--run{color:#6ea8fe;background:rgba(110,168,254,.13);}
.ms-badge--fail{color:#e06c75;background:rgba(224,108,117,.13);}
.ms-prog{flex:none;width:64px;height:4px;border-radius:2px;background:rgba(255,255,255,.09);overflow:hidden;align-self:center;}
.ms-prog>i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#4f8fe0,#6ea8fe);}
.ms-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.ms-card{display:flex;gap:7px;align-items:center;padding:4px;border-radius:7px;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);}
.ms-card img{width:38px;height:38px;border-radius:5px;object-fit:cover;flex:none;
  background:rgba(255,255,255,.06);}
.ms-card .cv{width:38px;height:38px;border-radius:5px;flex:none;background:rgba(255,255,255,.06);
  display:flex;align-items:center;justify-content:center;font-size:15px;}
.ms-card .nm{font-size:10.5px;line-height:1.35;color:rgba(226,232,242,.88);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ms-card .nm small{display:block;font-size:9px;color:rgba(160,172,190,.7);font-weight:400;}
.ms-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;}
.ms-btn{pointer-events:auto;cursor:pointer;font:600 11px/1 inherit;padding:6px 13px;border-radius:7px;
  color:#9fc3f7;background:rgba(110,168,254,.13);border:1px solid rgba(110,168,254,.4);
  transition:transform 80ms ease,background 120ms ease;}
.ms-btn:hover{background:rgba(110,168,254,.22);}
.ms-btn:active{transform:scale(.96);}
.ms-btn--paid{color:#e6b054;background:rgba(230,176,84,.12);border-color:rgba(230,176,84,.5);}
.ms-btn--paid:hover{background:rgba(230,176,84,.2);}
.ms-btn:disabled{opacity:.32;cursor:default;pointer-events:none;}
.ms-btn--flash{animation:ms-flash 1.2s ease;}
.ms-composer{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  background:rgba(230,176,84,.07);border:1px dashed rgba(230,176,84,.35);}
.ms-composer-title{font-size:10px;font-weight:600;color:rgba(230,176,84,.92);letter-spacing:.03em;}
.ms-composer textarea{pointer-events:auto;width:100%;box-sizing:border-box;resize:none;font:400 11.5px/1.5 inherit;
  color:rgba(235,240,248,.9);background:rgba(0,0,0,.3);border:1px solid rgba(230,176,84,.3);
  border-radius:6px;padding:6px 8px;outline:none;}
.ms-composer textarea:focus{border-color:rgba(230,176,84,.55);}
.ms-composer-row{display:flex;gap:6px;}
.ms-live{display:flex;gap:4px;flex:none;align-items:center;}
#manying-canvas-hints{position:fixed;right:52px;bottom:18px;z-index:60;width:270px;pointer-events:auto;
  background:rgba(16,20,28,.96);border:1px solid rgba(110,168,254,.35);border-radius:12px;
  padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.5);
  font:400 11px/1.55 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;color:rgba(226,232,242,.9);}
#manying-canvas-hints .ms-hints-head{display:flex;align-items:center;justify-content:space-between;
  font-size:12px;font-weight:700;color:#9fc3f7;margin-bottom:6px;}
#manying-canvas-hints .ms-hints-x{pointer-events:auto;cursor:pointer;background:transparent;border:none;
  color:rgba(178,188,204,.8);font-size:15px;line-height:1;padding:2px 4px;border-radius:5px;}
#manying-canvas-hints .ms-hints-x:hover{color:#fff;background:rgba(255,255,255,.1);}
#manying-canvas-hints .ms-hints-item{display:flex;gap:7px;padding:3.5px 0;}
#manying-canvas-hints .ms-hints-item b{flex:none;color:#6ea8fe;min-width:48px;font-weight:600;}
#manying-canvas-hints .ms-hints-item span{color:rgba(200,208,222,.85);}
#manying-canvas-hints-fab{position:fixed;right:14px;bottom:18px;z-index:60;width:30px;height:30px;
  pointer-events:auto;cursor:pointer;border-radius:50%;border:1px solid rgba(110,168,254,.45);
  background:rgba(16,20,28,.92);color:#9fc3f7;font:600 14px/1 inherit;
  box-shadow:0 4px 14px rgba(0,0,0,.4);}
#manying-canvas-hints-fab:hover{background:rgba(110,168,254,.18);}
@keyframes ms-flash{0%{box-shadow:0 0 0 0 rgba(110,168,254,.65);}100%{box-shadow:0 0 0 9px rgba(110,168,254,0);}}
`;

function ensureStyles() {
  if (document.getElementById("manying-stage-dom-styles")) return;
  const style = document.createElement("style");
  style.id = "manying-stage-dom-styles";
  style.textContent = STYLES;
  document.head.append(style);
}

// ── 载荷 → HTML(六分支:tiles/表行/队列/资产卡/轨道/正文行)────────────────
function badge(kind, text) {
  return `<span class="ms-badge ms-badge--${kind}">${esc(text)}</span>`;
}

/** 队列活态徽章/进度条(静态渲染与 B2 轮询共用一源):running=徽章+进度条,
 * failed/blocked=红,canceled/ready/pending=灰;succeeded=空(就绪徽章接管)。 */
function liveBadgesHTML(status, progress) {
  if (status === "running") {
    const pct = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100);
    return badge("run", "渲染中") + `<span class="ms-prog"><i style="width:${pct}%"></i></span>`;
  }
  if (status === "failed") return badge("fail", "失败");
  if (status === "blocked") return badge("fail", "阻塞");
  if (status === "canceled") return badge("wait", "已取消");
  if (status === "pending" || status === "ready" || status === "queued") return badge("wait", "排队");
  return "";
}

function bodyBranchHTML(payload) {
  if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
    const tiles = payload.tiles.map((tile) => {
      const state = tile.hasVideo ? "#6ea8fe" : tile.hasImage ? "#4ec9a8" : "#7d8ba1";
      const media = tile.preview
        ? `<img src="/view?filename=${encodeURIComponent(tile.preview)}&subfolder=&type=input" alt=""
             onerror="window.__manyingImgRetry && window.__manyingImgRetry(this)">`
        : "";
      return `<div class="ms-tile" title="${esc(tile.title)}${tile.lines ? "\n" + esc(tile.lines) : ""}">
        ${media}<span class="ph">${esc(tile.title)}</span>
        <i class="sd" style="background:${state}"></i>
        <span class="tt">${esc(tile.title)}</span>
      </div>`;
    }).join("");
    return `<div class="ms-tiles">${tiles}</div>`;
  }
  if (Array.isArray(payload.tableRows) && payload.tableRows.length > 0) {
    const rows = payload.tableRows.map((row) => `
      <div class="ms-row">
        <span class="idx">#${String(row.index).padStart(2, "0")}</span>
        <span class="main"><span class="scene">${esc(row.scene)}</span>${esc(row.title)}
          <span class="sub">「${esc(row.lines || "—")}」${row.action ? " · " + esc(row.action) : ""}${row.sound ? " · ♪" + esc(row.sound) : ""}${row.assets ? " · 【" + esc(row.assets) + "】" : ""}</span>
        </span>
        <span class="meta">${esc(row.shotSize)}${row.cameraMove ? "·" + esc(row.cameraMove) : ""} ${row.duration}s</span>
      </div>`).join("");
    return `<div class="ms-rows">${rows}</div>`;
  }
  if (Array.isArray(payload.shots) && payload.shots.length > 0) {
    const rows = payload.shots.map((shot) => {
      const bits = [
        shot.videoReady ? badge("ok", "视频✓") : badge("wait", "待出"),
        shot.ttsReady ? badge("ok", "配音✓") : "",
        shot.sfxReady ? badge("ok", "音效✓") : "",
        shot.revision > 1 ? badge("rev", "v" + shot.revision) : "",
      ].filter(Boolean).join("");
      // 活态徽章/进度条独立容器(.ms-live):B2 轮询到队列快照后原位重填,
      // 不动静态就绪徽章;初始渲染吃载荷快照(保鲜链上轮写入)
      const live = liveBadgesHTML(shot.status, shot.progress);
      return `<div class="ms-row" data-shot-idx="${Number(shot.index) || 0}"><span class="idx">#${String(shot.index).padStart(2, "0")}</span>
        <span class="main">${esc(shot.label)}</span><span class="ms-live">${live}</span><span class="ms-badges">${bits}</span></div>`;
    }).join("");
    return `<div class="ms-rows" data-live="queue">${rows}</div>`;
  }
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const cards = payload.assets.map((asset) => {
      const cover = asset.cover
        ? `<img src="/view?filename=${encodeURIComponent(asset.cover)}&subfolder=&type=input" alt=""
             onerror="window.__manyingImgRetry && window.__manyingImgRetry(this)">`
        : `<span class="cv">🖼</span>`;
      return `<div class="ms-card" title="${esc(asset.name)}">${cover}
        <span class="nm">${esc(asset.name)}<small>${esc(asset.typeLabel)}${asset.views ? " · " + esc(asset.views) + " 视图" : ""}${asset.state ? " · " + esc(asset.state) : ""}</small></span>
      </div>`;
    }).join("");
    return `<div class="ms-cards">${cards}</div>`;
  }
  if (Array.isArray(payload.tracks) && payload.tracks.length > 0) {
    const rows = payload.tracks.map((track) => `
      <div class="ms-row"><span class="main">${esc(track.name)}</span>
        <span class="meta">${track.count > 0 ? esc(track.count) + " 镜 · " : ""}${track.mediaCount > 0 ? esc(track.mediaCount) + " 素材 · " : ""}${track.duration > 0 ? Math.floor(track.duration / 60) + ":" + String(track.duration % 60).padStart(2, "0") : ""}</span>
        ${track.state ? `<span class="ms-badges">${badge(track.state === "ready" ? "ok" : "wait", esc(track.state))}</span>` : ""}
      </div>`).join("");
    return `<div class="ms-rows">${rows}</div>`;
  }
  const lines = (payload.previewLines || []).map((line) => `<div>${esc(line)}</div>`).join("");
  return `<div class="ms-lines">${lines}</div>`;
}

function stageHTML(payload) {
  const color = STATUS_COLOR[payload.status] || STATUS_COLOR.empty;
  const metrics = (payload.metrics || []).map((m) => `<span class="ms-chip">${esc(m)}</span>`).join("");
  const skills = (payload.skills || []).map((s) => `<span class="ms-skill">${esc(s)}</span>`).join("");
  const actions = (payload.actions || []).map((action) => `
    <button class="ms-btn${action.paid ? " ms-btn--paid" : ""}" data-kind="${esc(action.kind)}"
      ${action.disabled ? "disabled" : ""} title="${esc(action.label)}">${esc(action.label)}${action.paid ? " ⭐" : ""}</button>`).join("");
  return `
    <div class="ms-head">
      <div class="ms-statusrow" style="color:${color}">
        <span class="ms-dot" style="background:${color};color:${color}"></span>${esc(payload.statusText || "")}
        ${payload.finalExport ? '<span class="ms-export">已导出成片</span>' : ""}
      </div>
      ${payload.description ? `<div class="ms-desc" title="${esc(payload.description)}">${esc(payload.description)}</div>` : ""}
      ${metrics ? `<div class="ms-metrics">${metrics}</div>` : ""}
      ${skills ? `<div class="ms-skills">${skills}</div>` : ""}
    </div>
    <div class="ms-body">
      ${payload.previewTitle ? `<span class="ms-pill">${esc(payload.previewTitle)}</span>` : ""}
      ${bodyBranchHTML(payload)}
    </div>
    ${actions ? `<div class="ms-actions">${actions}</div>` : ""}`;
}

// ── 挂载/渲染/尺寸同步 ────────────────────────────────────────────────
/**
 * 自然高度离屏测量:框架按视口裁切隐藏视口外节点的 DOM widget(wrapper
 * display:none→offsetHeight 恒 0),在 widget 上量高=鸡生蛋。探针克隆挂
 * body 外(fixed+visibility:hidden+节点等宽)量内容自然高;tiles 用
 * aspect-ratio、正文用固定行高——量高与图片异步加载无关,稳定可复现。
 */
function measureNatural(node, el) {
  const probe = el.cloneNode(true);
  probe.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:${Math.max(220, node.size[0] - 24)}px;`;
  document.body.append(probe);
  const height = probe.offsetHeight || 0;
  probe.remove();
  return height;
}

function mountDomBody(node) {
  if (node.__manyingDomBody) return;
  ensureStyles();
  const el = document.createElement("div");
  el.className = "manying-stage-body";
  const state = { el, naturalH: 80 };
  const widget = node.addDOMWidget("manying-stage-body", "manying-stage", el, {
    hideOnZoom: false,
    getHeight: () => state.naturalH,
    getMinHeight: () => state.naturalH,
  });
  Object.assign(state, { widget });
  node.__manyingDomBody = state;
  // 实例级静音 monolith canvas 自绘(原型 manying.stage.render 保留为兜底)
  node.onDrawBackground = function () {};
  wireActions(node, el);
}

function wireActions(node, el) {
  el.addEventListener("click", (event) => {
    const button = event.target.closest(".ms-btn");
    if (!button || button.disabled) return;
    const kind = button.dataset.kind || "";
    // B1 补充要求(09-12 功能差异补齐):付费动作先出组稿器(补充要求可空),
    // 执行才过桥——note 随动作入队,宿主经 userInstruction 语义喂付费生成。
    // 非付费动作照旧直发。
    if (button.classList.contains("ms-btn--paid") && !button.classList.contains("ms-btn--go")) {
      openComposer(el, kind, button.textContent.replace(" ⭐", "").trim());
      return;
    }
    if (button.classList.contains("ms-btn--cancel")) {
      closeComposer(el);
      return;
    }
    const note = button.classList.contains("ms-btn--go")
      ? (el.querySelector(".ms-composer textarea")?.value || "")
      : "";
    if (button.classList.contains("ms-btn--go")) closeComposer(el);
    postAction(kind, note, button);
  });
}

function postAction(kind, note, button) {
  if (button) {
    button.classList.remove("ms-btn--flash");
    void button.offsetWidth; // 重启动画
    button.classList.add("ms-btn--flash");
  }
  fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
    method: "POST",
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(note ? { kind, note } : { kind }),
  }).catch(() => undefined);
}

function openComposer(el, kind, label) {
  closeComposer(el);
  const composer = document.createElement("div");
  composer.className = "ms-composer";
  composer.innerHTML = `
    <div class="ms-composer-title">「${esc(label)}」补充要求(可空,Enter 执行)</div>
    <textarea rows="2" placeholder="如:节奏更快、多加一个反派伏笔、台词更口语化…"></textarea>
    <div class="ms-composer-row">
      <button class="ms-btn ms-btn--paid ms-btn--go" data-kind="${esc(kind)}">⭐ 执行(付费云端)</button>
      <button class="ms-btn ms-btn--cancel">取消</button>
    </div>`;
  const actions = el.querySelector(".ms-actions");
  (actions || el).append(composer);
  const textarea = composer.querySelector("textarea");
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.querySelector(".ms-btn--go").click();
    }
    if (event.key === "Escape") closeComposer(el);
  });
  syncSizeFor(el);
  textarea.focus();
}

function closeComposer(el) {
  const composer = el.querySelector(".ms-composer");
  if (composer) {
    composer.remove();
    syncSizeFor(el);
  }
}

/** 由元素反查宿主节点补一轮高度同步(组稿器开合会变内容高) */
function syncSizeFor(el) {
  const host = el.closest && document.body.contains(el) ? el : null;
  if (!host) return;
  for (const node of (window.app?.canvas?.graph?._nodes || [])) {
    if (node.__manyingDomBody && node.__manyingDomBody.el === el) {
      node.__manyingDomBody.naturalH = Math.max(80, measureNatural(node, el));
      syncSize(node);
      return;
    }
  }
}

// ── B2 队列实时轮询(单例):桥 /comfy/bridge/storyboards 的 queue 快照 →
// 逐镜 [data-shot-idx] 行原位重填 .ms-live 徽章;画布不在场=空转(仅查询)。──
function installQueuePoller() {
  if (window.__manyingQueuePoller) return;
  window.__manyingQueuePoller = true;
  setInterval(() => {
    if (!document.querySelector('.manying-stage-body [data-live="queue"]')) return;
    fetch(`${BRIDGE_URL}/comfy/bridge/storyboards`, { headers: { "X-Manying-Image-Token": BRIDGE_TOKEN } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.queue)) return;
        for (const item of data.queue) {
          const row = document.querySelector(`.manying-stage-body [data-shot-idx="${Number(item.index) || 0}"]`);
          if (!row) continue;
          const live = row.querySelector(".ms-live");
          if (live) live.innerHTML = liveBadgesHTML(item.status, item.progress);
        }
      })
      .catch(() => undefined);
  }, 2000);
}

// ── B3 画布速查卡(老画布 CanvasHints 等价迁移):首开自动浮出五条核心用法,
// 可关闭+localStorage 记忆,右下角「?」随时唤回。外挂 DOM,零改 ComfyUI 本体。──
const HINTS_ITEMS = [
  ["导航", "拖拽画布空白处平移,滚轮缩放;双击空白可添加节点"],
  ["制作动作", "环节节点底部按钮:主色=本地/免费,金色⭐=付费云端(可填补充要求)"],
  ["分镜总览", "「分镜面板」磁贴网格=本章全部分镜,缩略图缺失会自动重试"],
  ["队列进度", "「单镜视频生产」每镜徽章每 2 秒实进(渲染中带进度条)"],
  ["完整内容", "节点只展示概览;全文与操作进「阶段面板」(悬浮球切换阶段)"],
];

function installCanvasHints() {
  if (document.getElementById("manying-canvas-hints-fab")) return;
  const KEY = "manying.canvasHints.dismissed";
  const build = () => {
    const card = document.createElement("div");
    card.id = "manying-canvas-hints";
    card.innerHTML = `
      <div class="ms-hints-head"><span>分镜画布速查</span><button class="ms-hints-x" title="关闭(右下角 ? 可唤回)">×</button></div>
      ${HINTS_ITEMS.map(([title, text]) => `
        <div class="ms-hints-item"><b>${title}</b><span>${text}</span></div>`).join("")}`;
    document.body.append(card);
    card.querySelector(".ms-hints-x").onclick = () => {
      card.remove();
      try { localStorage.setItem(KEY, "1"); } catch (error) { /* 无碍 */ }
    };
  };
  const fab = document.createElement("button");
  fab.id = "manying-canvas-hints-fab";
  fab.title = "画布速查卡";
  fab.textContent = "?";
  fab.onclick = () => {
    const existing = document.getElementById("manying-canvas-hints");
    if (existing) existing.remove();
    else build();
  };
  document.body.append(fab);
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === "1"; } catch (error) { /* 无碍 */ }
  if (!dismissed) build();
}

function renderDomBody(node) {
  const state = node.__manyingDomBody;
  if (!state) return;
  const payload = node.properties?.manyingStage;
  if (!payload) {
    state.el.innerHTML = "";
    state.naturalH = 80;
    return;
  }
  state.el.innerHTML = stageHTML(payload);
  state.naturalH = Math.max(80, measureNatural(node, state.el));
  syncSize(node);
}

/** 高度单源:DOM 实测回投布局(computeSize 汇总 widget 高度)——生成器尺寸只是首帧估计 */
function syncSize(node) {
  const state = node.__manyingDomBody;
  if (!state) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      const sz = node.computeSize();
      if (sz && Math.abs(sz[1] - node.size[1]) > 1) {
        node.size[1] = sz[1];
      }
      if (sz && sz[0] > node.size[0]) {
        node.size[0] = sz[0];
      }
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
      if (node.graph?.change) node.graph.change();
    } catch (error) { /* 布局面失败不致命:下一轮 onConfigure 重来 */ }
  }));
}

app.registerExtension({
  name: "manying.stage.dom",
  async setup() {
    // B2 队列轮询 + B3 速查卡:页面级单例,扩展 setup 一次即装
    try { installQueuePoller(); } catch (error) { /* 无碍 */ }
    try { installCanvasHints(); } catch (error) { /* 无碍 */ }
  },
  async beforeRegisterNodeDef(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try { mountDomBody(this); renderDomBody(this); } catch (error) { /* 兜底=canvas 自绘 */ }
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try { renderDomBody(this); } catch (error) { /* 同上 */ }
      return result;
    };
  },
});
