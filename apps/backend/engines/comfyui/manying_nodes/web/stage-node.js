// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节节点富内容 DOM 渲染(stage-node,09-13 视觉与正方形重塑):
 * 官方 node.addDOMWidget 渲染面,毛玻璃质感+状态色条+正方形常理尺寸约束(≤760px)。
 * 保留实例级 onDrawBackground 覆写静音 canvas 自绘;删除本文件即回退 canvas 渲染。
 */
import { app } from "/scripts/app.js";
// 每型节点 UI 独立模块(09-13 用户裁定:不同代码分模块,适应 ComfyUI):
// stage-ui/ 下七型各一文件+common 公共件+vendor(markdown-it MIT);
// 本文件只做壳(头区/动作/组稿器/速查卡/轮询/高度)与按 payload.key 分发。
import { esc, liveBadgesHTML, onMarkdownReady } from "./stage-ui/common.js";
import scriptUI from "./stage-ui/script.js";
import directorPlanUI from "./stage-ui/director-plan.js";
import assetsUI from "./stage-ui/assets.js";
import storyboardTableUI from "./stage-ui/storyboard-table.js";
import storyboardPanelUI from "./stage-ui/storyboard-panel.js";
import shotProductionUI from "./stage-ui/shot-production.js";
import workbenchUI from "./stage-ui/workbench.js";
// 东方影视代币(theme.js 单源):尺寸约束+玻璃质感+状态色——禁在本文件复刻魔法数
import { STAGE_SIZE_CONSTRAINTS as SIZE, CINEMA_TOKENS } from "./theme.js";

const STAGE_UI_REGISTRY = new Map([
  [scriptUI.key, scriptUI],
  [directorPlanUI.key, directorPlanUI],
  [assetsUI.key, assetsUI],
  [storyboardTableUI.key, storyboardTableUI],
  [storyboardPanelUI.key, storyboardPanelUI],
  [shotProductionUI.key, shotProductionUI],
  [workbenchUI.key, workbenchUI],
]);

const BRIDGE_URL = (window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
const BRIDGE_TOKEN = window.MANYING_BRIDGE_TOKEN || "manying-local-image";

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

const STYLES = `
.manying-stage-body{pointer-events:none;box-sizing:border-box;width:100%;
  padding:12px 14px 14px;font:400 12px/1.65 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:rgba(235,240,248,.92);background:${CINEMA_TOKENS.glassBg};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid ${CINEMA_TOKENS.glassBorder};border-radius:${CINEMA_TOKENS.glassRadius};
  box-shadow:${CINEMA_TOKENS.glassShadow},${CINEMA_TOKENS.glassHighlight};
  display:flex;flex-direction:column;gap:10px;overflow:hidden;position:relative;}
.manying-stage-body *{box-sizing:border-box;margin:0;}
.ms-stage-topbar{position:absolute;top:0;left:0;right:0;height:2.5px;border-radius:12px 12px 0 0;}
.ms-stage-topbar--ready{background:linear-gradient(90deg,#34d399,#059669);box-shadow:0 0 8px rgba(52,211,153,.6);}
.ms-stage-topbar--running,.ms-stage-topbar--pending{background:linear-gradient(90deg,#fbbf24,#d97706);box-shadow:0 0 8px rgba(251,191,36,.6);}
.ms-stage-topbar--warning,.ms-stage-topbar--failed{background:linear-gradient(90deg,#f87171,#dc2626);box-shadow:0 0 8px rgba(248,113,113,.6);}
.ms-stage-topbar--empty,.ms-stage-topbar--idle{background:linear-gradient(90deg,#64748b,#475569);}
.ms-head{display:flex;flex-direction:column;gap:6px;padding:8px 10px 9px;
  background:rgba(255,255,255,.045);border-radius:8px;border-bottom:1px solid rgba(255,255,255,.06);}
.ms-statusrow{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600;color:rgba(240,244,250,.94);}
@keyframes ms-dot-breathe{0%,100%{transform:scale(1);opacity:.85;filter:drop-shadow(0 0 4px currentColor);}50%{transform:scale(1.15);opacity:1;filter:drop-shadow(0 0 9px currentColor);}}
.ms-dot{width:7px;height:7px;border-radius:50%;flex:none;}
.ms-dot--live{animation:ms-dot-breathe 2.4s infinite ease-in-out;}
.ms-export{margin-left:auto;font-size:10px;font-weight:600;color:#6ea8fe;
  border:1px solid rgba(110,168,254,.45);border-radius:999px;padding:1px 8px;}
.ms-desc{font-size:11px;color:rgba(178,188,204,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-metrics,.ms-skills{display:flex;flex-wrap:wrap;gap:5px;}
.ms-chip{font-size:10.5px;color:rgba(235,240,248,.82);background:rgba(255,255,255,.07);
  border-radius:999px;padding:2.5px 9px;white-space:nowrap;}
.ms-skill{font-size:10.5px;color:#9fc3f7;background:rgba(110,168,254,.12);
  border:1px solid rgba(110,168,254,.28);border-radius:999px;padding:2px 9px;white-space:nowrap;}
.ms-body{pointer-events:none;display:flex;flex-direction:column;gap:8px;min-height:0;
  max-height:${SIZE.maxBodyH}px;overflow-y:auto;overflow-x:hidden;padding-right:4px;}
.ms-body.ms-scroll{pointer-events:auto;
  mask-image:linear-gradient(180deg,black calc(100% - 24px),transparent 100%);
  -webkit-mask-image:linear-gradient(180deg,black calc(100% - 24px),transparent 100%);}
.ms-body.ms-scroll::-webkit-scrollbar{width:3.5px;}
.ms-body.ms-scroll::-webkit-scrollbar-track{background:transparent;}
.ms-body.ms-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:999px;}
.ms-body.ms-scroll::-webkit-scrollbar-thumb:hover{background:rgba(110,168,254,.45);}
.ms-pill{align-self:flex-start;font-size:10px;font-weight:600;letter-spacing:.04em;
  color:rgba(178,188,204,.9);background:rgba(255,255,255,.06);border-radius:999px;padding:2px 9px;}
.ms-lines{display:flex;flex-direction:column;font-size:11.5px;line-height:1.78;
  color:rgba(226,232,242,.82);}
.ms-md{font-size:11.5px;line-height:1.78;letter-spacing:.01em;color:rgba(224,230,240,.86);}
.ms-md h1{font-size:15px;font-weight:800;letter-spacing:-0.01em;color:rgba(244,247,252,.97);margin:9px 0 6px;}
.ms-md h2{font-size:13px;font-weight:700;letter-spacing:-0.005em;color:#a8c8f2;margin:9px 0 5px;}
.ms-md h3{font-size:11.5px;font-weight:600;color:rgba(178,190,208,.95);margin:7px 0 3px;}
.ms-md h1:first-child,.ms-md h2:first-child{margin-top:1px;}
.ms-md p{margin:0 0 9px;}
.ms-md p:last-child{margin-bottom:0;}
.ms-md hr{border:none;border-top:1px solid rgba(255,255,255,.12);margin:7px 0;}
.ms-md blockquote{margin:5px 0 9px;padding:4px 12px;border-left:2.5px solid rgba(110,168,254,.5);
  color:rgba(178,188,204,.9);background:rgba(110,168,254,.06);border-radius:0 5px 5px 0;}
.ms-md strong{color:rgba(240,244,250,.96);font-weight:600;}
.ms-md em{color:rgba(200,210,226,.88);}
.ms-md code{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;
  background:rgba(255,255,255,.07);border-radius:4px;padding:0 4px;}
.ms-md ul,.ms-md ol{margin:2px 0 5px;padding-left:18px;}
.ms-md li{margin:1.5px 0;}
.ms-md table{border-collapse:collapse;margin:4px 0;font-size:10.5px;}
.ms-md th,.ms-md td{border:1px solid rgba(255,255,255,.12);padding:2px 7px;}
.ms-md th{background:rgba(255,255,255,.05);font-weight:600;}
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
.ms-row .idx{color:#9fc3f7;font-weight:600;flex:none;min-width:30px;font-family:ui-monospace,"SF Mono",Menlo,monospace;}
.ms-row .main{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-row .main .scene{color:rgba(178,188,204,.75);margin-right:6px;}
.ms-row .sub{display:block;font-size:10px;color:rgba(160,172,190,.68);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
.ms-row .meta{flex:none;color:rgba(178,188,204,.8);font-size:10.5px;font-family:ui-monospace,"SF Mono",Menlo,monospace;}
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
.ms-card{display:flex;gap:7px;align-items:center;padding:5px 6px;border-radius:8px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);box-shadow:0 1px 3px rgba(0,0,0,.25);}
.ms-card img{width:38px;height:38px;border-radius:5px;object-fit:cover;flex:none;
  background:rgba(255,255,255,.06);}
.ms-card .cv{width:38px;height:38px;border-radius:5px;flex:none;background:rgba(255,255,255,.06);
  display:flex;align-items:center;justify-content:center;font-size:15px;}
.ms-card .nm{font-size:10.5px;line-height:1.35;color:rgba(226,232,242,.88);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ms-card .nm small{display:block;font-size:9px;color:rgba(160,172,190,.7);font-weight:400;}
.ms-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:2px;
  border-top:1px solid rgba(255,255,255,.06);padding-top:8px;}
.ms-btn{pointer-events:auto;cursor:pointer;font:600 11px/1 inherit;width:100%;min-height:30px;
  display:inline-flex;align-items:center;justify-content:center;padding:0 12px;border-radius:8px;
  color:#9fc3f7;background:rgba(110,168,254,.13);border:1px solid rgba(110,168,254,.4);
  transition:transform 80ms ease,background 120ms ease;}
.ms-btn:hover{background:rgba(110,168,254,.22);}
.ms-btn:active{transform:scale(.96);}
.ms-btn--paid{color:#e6b054;background:rgba(230,176,84,.12);border-color:rgba(230,176,84,.5);}
.ms-btn--paid:hover{background:rgba(230,176,84,.2);}
.ms-btn:disabled{opacity:.32;cursor:default;pointer-events:none;}
.ms-btn--flash{animation:ms-flash 1.2s ease;}
.ms-composer{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  grid-column:1 / -1;
  background:rgba(230,176,84,.07);border:1px dashed rgba(230,176,84,.35);}
.ms-composer-title{font-size:10px;font-weight:600;color:rgba(230,176,84,.92);letter-spacing:.03em;}
.ms-composer textarea{pointer-events:auto;width:100%;box-sizing:border-box;resize:none;font:400 11.5px/1.5 inherit;
  color:rgba(235,240,248,.9);background:rgba(0,0,0,.3);border:1px solid rgba(230,176,84,.3);
  border-radius:6px;padding:6px 8px;outline:none;}
.ms-composer textarea:focus{border-color:rgba(230,176,84,.55);}
.ms-composer-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.ms-live{display:flex;gap:4px;flex:none;align-items:center;}
#manying-canvas-hints{position:fixed;right:52px;bottom:18px;z-index:60;width:275px;pointer-events:auto;
  background:linear-gradient(180deg,rgba(18,24,38,.92) 0%,rgba(10,14,24,.96) 100%);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(110,168,254,.35);border-radius:12px;
  padding:12px 14px;box-shadow:0 12px 32px -4px rgba(0,0,0,.65),0 4px 12px rgba(0,0,0,.4);
  font:400 11px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;color:rgba(226,232,242,.9);
  animation:ms-slide-up 0.25s cubic-bezier(0.16,1,0.3,1);}
#manying-canvas-hints .ms-hints-head{display:flex;align-items:center;justify-content:space-between;
  font-size:12px;font-weight:700;color:#9fc3f7;margin-bottom:6px;}
#manying-canvas-hints .ms-hints-x{pointer-events:auto;cursor:pointer;background:transparent;border:none;
  color:rgba(178,188,204,.8);font-size:15px;line-height:1;padding:2px 4px;border-radius:5px;}
#manying-canvas-hints .ms-hints-x:hover{color:#fff;background:rgba(255,255,255,.1);}
#manying-canvas-hints .ms-hints-item{display:flex;gap:7px;padding:3.5px 0;}
#manying-canvas-hints .ms-hints-item b{flex:none;color:#6ea8fe;min-width:48px;font-weight:600;}
#manying-canvas-hints .ms-hints-item span{color:rgba(200,208,222,.85);}
#manying-canvas-hints-fab{position:fixed;right:14px;bottom:18px;z-index:60;width:32px;height:32px;
  pointer-events:auto;cursor:pointer;border-radius:50%;border:1px solid rgba(110,168,254,.45);
  background:linear-gradient(135deg,rgba(18,24,38,.92) 0%,rgba(10,14,24,.96) 100%);
  backdrop-filter:blur(10px);color:#9fc3f7;font:600 14px/1 inherit;
  box-shadow:0 4px 14px rgba(0,0,0,.5);transition:transform 80ms ease,box-shadow 150ms ease;}
#manying-canvas-hints-fab:hover{transform:scale(1.08);box-shadow:0 0 12px rgba(110,168,254,.5);}
@keyframes ms-slide-up{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
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
/** 正文分发:按载荷 key 选型模块(每型独立文件);未知型/模块异常回落纯文本行。 */
function bodyHTML(payload) {
  const mod = STAGE_UI_REGISTRY.get(payload.key);
  if (mod) {
    try {
      return mod.render(payload);
    } catch (error) {
      // 型模块异常=回落纯文本(单型故障不拖全画布)
    }
  }
  const rows = (payload.previewLines || []).map((line) => `<div>${esc(line)}</div>`).join("");
  return `<div class="ms-lines">${rows}</div>`;
}

// ── 设计系统(东方影视代币:层级/字阶/克制;色值单源=CINEMA_TOKENS.status)──
const STATUS_COLOR = Object.fromEntries(
  Object.entries(CINEMA_TOKENS.status).map(([key, tone]) => [key, tone.accent]),
);

function stageHTML(payload) {
  const statusKey = payload.status || "empty";
  const color = STATUS_COLOR[statusKey] || STATUS_COLOR.empty;
  const metrics = (payload.metrics || []).map((m) => `<span class="ms-chip">${esc(m)}</span>`).join("");
  const skills = (payload.skills || []).map((s) => `<span class="ms-skill">${esc(s)}</span>`).join("");
  const actions = (payload.actions || []).map((action) => `
    <button class="ms-btn${action.paid ? " ms-btn--paid" : ""}" data-kind="${esc(action.kind)}"
      ${action.disabled ? "disabled" : ""} title="${esc(action.label)}">${esc(action.label)}${action.paid ? " ⭐" : ""}</button>`).join("");
  return `
    <div class="ms-stage-topbar ms-stage-topbar--${esc(statusKey)}"></div>
    <div class="ms-head">
      <div class="ms-statusrow" style="color:${color}">
        <span class="ms-dot${statusKey === "pending" ? " ms-dot--live" : ""}" style="background:${color};color:${color}"></span>${esc(payload.statusText || "")}
        ${payload.finalExport ? '<span class="ms-export">已导出成片</span>' : ""}
      </div>
      ${payload.description ? `<div class="ms-desc" title="${esc(payload.description)}">${esc(payload.description)}</div>` : ""}
      ${metrics ? `<div class="ms-metrics">${metrics}</div>` : ""}
      ${skills ? `<div class="ms-skills">${skills}</div>` : ""}
    </div>
    <div class="ms-body">
      ${payload.previewTitle ? `<span class="ms-pill">${esc(payload.previewTitle)}</span>` : ""}
      ${bodyHTML(payload)}
    </div>
    ${actions ? `<div class="ms-actions">${actions}</div>` : ""}`;
}

// ── 挂载/渲染/尺寸同步 ────────────────────────────────────────────────
/**
 * 自然高度离屏测量:框架按视口裁切隐藏视口外节点的 DOM widget(wrapper
 * display:none→offsetHeight 恒 0),在 widget 上量高=鸡生蛋。
 * 探针用「新容器+innerHTML」而非 cloneNode——clone 会继承 wrapper 拉伸态,
 * 读数两态漂移(实测 0/1080),fresh 容器读数=内容真高(实测定谳)。
 * 正文上限动态化:bodyCap=hardMax-固定开销-头区/动作实测——常理最大 760
 * 内恒装得下全部内容(动作行不被裁),头区再高也不破天花板。
 */
const STAGE_NODE_CHROME_FALLBACK = 168; // 节点高-widget 高(标题栏+边距),实测回落值

function measureNatural(node, el) {
  const probe = document.createElement("div");
  probe.className = "manying-stage-body";
  probe.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:${Math.min(SIZE.hardMax, Math.max(SIZE.minSize, node.size?.[0] || SIZE.defaultSize)) - 28}px;`;
  probe.innerHTML = el.innerHTML;
  const probeBody = probe.querySelector(".ms-body");
  document.body.append(probe);
  // 头区/动作高度从探针读(已布局):live el 在视口外时 wrapper display:none,
  // offsetHeight 恒 0,bodyCap 会算错——探针在 body 下恒有布局
  const probeHead = probe.querySelector(".ms-head");
  const probeActions = probe.querySelector(".ms-actions");
  const fixedChrome = STAGE_NODE_CHROME_FALLBACK
    + (probeHead ? probeHead.offsetHeight : 0)
    + (probeActions ? probeActions.offsetHeight : 0);
  const cap = Math.max(160, SIZE.hardMax - fixedChrome - 26 - 20);
  if (probeBody) probeBody.style.maxHeight = `${cap}px`;
  const height = probe.offsetHeight || 0;
  // 溢出开关:仅正文真溢出才开滚动交互(.ms-scroll=指针+渐隐 mask+滚动条),
  // 其余节点保持画布穿透(节点拖拽/滚轮缩放不被 DOM 吃掉)
  const overflow = Boolean(probeBody && probeBody.scrollHeight > cap + 1);
  probe.remove();
  const liveBody = el.querySelector(".ms-body");
  if (liveBody) {
    liveBody.style.maxHeight = `${cap}px`;
    liveBody.classList.toggle("ms-scroll", overflow);
  }
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
    // 布局地板只做防塌底限——恒小于 minSize 节点可容空间,尺寸单源归 syncSize
    // (naturalH 当地板会与 760 天花板互顶,前端布局把节点顶到 1228 实测在案)
    getMinHeight: () => 80,
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
  if (!document.body.contains(el)) return;
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

/** 尺寸单源:DOM 实测回投布局，强制近正方形比例(1:1~1:1.15)，严格限制常理最大尺寸(≤760px) */
function syncSize(node) {
  const state = node.__manyingDomBody;
  if (!state) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      const sz = node.computeSize();
      if (!sz) return;
      let w = Math.max(SIZE.minSize, Math.max(node.size[0] || SIZE.defaultSize, sz[0]));
      // 外部 chrome(标题栏+widget 边距)实测优先,量不到回落常量——
      // wrapper 高 = 节点高-chrome,naturalH+chrome 即内容恰好的节点高
      const wrapperH = state.el.parentElement?.offsetHeight || 0;
      const chrome = wrapperH > 0 && wrapperH < node.size[1] ? node.size[1] - wrapperH : STAGE_NODE_CHROME_FALLBACK;
      let h = Math.max(sz[1], state.naturalH ? state.naturalH + chrome : SIZE.defaultSize);

      // 正方形约束:高度较高时同步拓宽，使节点趋向近正方形
      if (h > w && w < SIZE.maxSize) {
        w = Math.min(SIZE.maxSize, Math.max(w, h));
      }
      // 常理最大天花板限制:宽高绝对不超过 hardMax，正方形比例锁定在 1:1~1:1.15
      const targetW = Math.min(SIZE.hardMax, Math.max(SIZE.minSize, w));
      const targetH = Math.min(SIZE.hardMax, Math.max(SIZE.minSize, Math.min(h, targetW * 1.15)));

      if (Math.abs(targetW - node.size[0]) > 1 || Math.abs(targetH - node.size[1]) > 1) {
        node.size[0] = targetW;
        node.size[1] = targetH;
      }
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
      if (node.graph?.change) node.graph.change();
    } catch (error) { /* 布局面失败不致命:下一轮 onConfigure 重来 */ }
  }));
}

app.registerExtension({
  name: "manying.stage.dom",
  async setup() {
    // markdown-it 就位→重渲染全部环节正文(首帧纯文本回落→成型替换)
    onMarkdownReady(() => {
      for (const node of (window.app?.canvas?.graph?._nodes || [])) {
        if (node.__manyingDomBody) {
          try { renderDomBody(node); } catch (error) { /* 各自兜底 */ }
        }
      }
    });
    // B2 队列轮询 + B3 速查卡:页面级单例,扩展 setup 一次即装
    try { installQueuePoller(); } catch (error) { /* 无碍 */ }
    try { installCanvasHints(); } catch (error) { /* 无碍 */ }
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ManyingStage") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        // 固定值输入框退役(stage_key/title/summary/status 全 host 独写,
        // DOM body 是唯一 UI):官方 hidden 位,绘制+布局双跳过,
        // widgets_values 序列化契约零影响
        for (const widget of this.widgets || []) widget.hidden = true;
      } catch (error) { /* 兜底=原生外观 */ }
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
