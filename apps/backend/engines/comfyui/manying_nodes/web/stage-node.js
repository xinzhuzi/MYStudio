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
        shot.status === "running" ? badge("run", "渲染中") : "",
        shot.status === "failed" ? badge("fail", "失败") : "",
        shot.status === "blocked" ? badge("fail", "阻塞") : "",
        shot.status === "queued" ? badge("wait", "排队") : "",
      ].filter(Boolean).join("");
      const prog = shot.status === "running" && typeof shot.progress === "number"
        ? `<span class="ms-prog"><i style="width:${Math.round(Math.min(1, Math.max(0, shot.progress)) * 100)}%"></i></span>` : "";
      return `<div class="ms-row"><span class="idx">#${String(shot.index).padStart(2, "0")}</span>
        <span class="main">${esc(shot.label)}</span>${prog}<span class="ms-badges">${bits}</span></div>`;
    }).join("");
    return `<div class="ms-rows">${rows}</div>`;
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
    button.classList.remove("ms-btn--flash");
    void button.offsetWidth; // 重启动画
    button.classList.add("ms-btn--flash");
    fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
      method: "POST",
      headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    }).catch(() => undefined);
  });
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
