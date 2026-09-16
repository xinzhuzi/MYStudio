// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节节点富内容 DOM 渲染(stage-node,09-13 视觉与正方形重塑):
 * 官方 node.addDOMWidget 渲染面,毛玻璃质感+状态色条+正方形常理尺寸约束(≤760px)。
 * 保留实例级 onDrawBackground 覆写静音 canvas 自绘;删除本文件即回退 canvas 渲染。
 */
import { app } from "/scripts/app.js";
import { BRIDGE_TOKEN, BRIDGE_URL, postAction } from "./bridge-action.js";
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

/** 缩略/封面晚到兜底:保鲜链补传一轮后文件才在(冷启动竞态)——404 后 2.5s
 * 换缓存戳重试至多 3 次,仍败=隐藏(占位文字在 img 之下自然透出)。 */
window.__myImgRetry = (img) => {
  const tries = (Number(img.dataset.tries) || 0) + 1;
  img.dataset.tries = String(tries);
  if (tries > 3) { img.style.display = "none"; return; }
  setTimeout(() => {
    img.src = img.src.split("&_=")[0] + "&_=" + Date.now();
  }, 2500);
};

const STYLES = `
.my-stage-body{pointer-events:none;box-sizing:border-box;width:100%;
  padding:12px 14px 14px;font:400 12px/1.65 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:var(--my-text);background:${CINEMA_TOKENS.glassBg};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid ${CINEMA_TOKENS.glassBorder};border-radius:${CINEMA_TOKENS.glassRadius};
  box-shadow:${CINEMA_TOKENS.glassShadow},${CINEMA_TOKENS.glassHighlight};
  display:flex;flex-direction:column;gap:10px;overflow:hidden;position:relative;}
.my-stage-body *{box-sizing:border-box;margin:0;}
.ms-stage-topbar{position:absolute;top:0;left:0;right:0;height:2.5px;border-radius:12px 12px 0 0;}
.ms-stage-topbar--ready{background:linear-gradient(90deg,#34d399,#059669);box-shadow:0 0 8px rgba(52,211,153,.6);}
.ms-stage-topbar--running,.ms-stage-topbar--pending{background:linear-gradient(90deg,#fbbf24,#d97706);box-shadow:0 0 8px rgba(251,191,36,.6);}
.ms-stage-topbar--warning,.ms-stage-topbar--failed{background:linear-gradient(90deg,#f87171,#dc2626);box-shadow:0 0 8px rgba(248,113,113,.6);}
.ms-stage-topbar--empty,.ms-stage-topbar--idle{background:linear-gradient(90deg,#64748b,#475569);}
.ms-head{display:flex;flex-direction:column;gap:6px;padding:8px 10px 9px;
  background:var(--my-hover);border-radius:8px;border-bottom:1px solid var(--my-hover);}
.ms-statusrow{display:flex;align-items:center;gap:9px;font-size:var(--my-fs-11-5);font-weight:600;color:rgba(240,244,250,.94);}
@keyframes ms-dot-breathe{0%,100%{transform:scale(1);opacity:.85;filter:drop-shadow(0 0 4px currentColor);}50%{transform:scale(1.15);opacity:1;filter:drop-shadow(0 0 9px currentColor);}}
.ms-dot{width:7px;height:7px;border-radius:50%;flex:none;}
.ms-dot--live{animation:ms-dot-breathe 2.4s infinite ease-in-out;}
.ms-export{margin-left:auto;font-size:var(--my-fs-10);font-weight:600;color:#6ea8fe;
  border:1px solid rgba(110,168,254,.45);border-radius:999px;padding:1px 8px;}
.ms-desc{font-size:var(--my-fs-11);color:var(--my-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-metrics,.ms-skills{display:flex;flex-wrap:wrap;gap:5px;}
.ms-chip{font-size:var(--my-fs-10);color:rgba(178,188,204,.68);background:var(--my-hover);
  border-radius:999px;padding:1.5px 8px;white-space:nowrap;}
.ms-progress{display:flex;flex-direction:column;gap:3.5px;}
.ms-prog-row{display:flex;align-items:center;gap:8px;font-size:var(--my-fs-10-5);}
.ms-prog-label{color:var(--my-text-2);flex:none;}
.ms-prog-nums{color:rgba(240,244,250,.96);font-weight:700;flex:none;
  font-family:var(--font-mono,var(--font-mono,ui-monospace,Menlo,monospace));}
.ms-prog-mini{flex:1;height:3.5px;min-width:48px;border-radius:2px;background:var(--my-hover-2);overflow:hidden;}
.ms-prog-mini>i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#4f8fe0,#34d399);}
.ms-skill{pointer-events:auto;cursor:pointer;font-size:var(--my-fs-10-5);color:var(--my-accent-soft);background:rgba(110,168,254,.12);
  border:1px solid rgba(110,168,254,.28);border-radius:999px;padding:2px 9px;white-space:nowrap;
  transition:background 120ms ease;}
.ms-skill:hover{background:rgba(110,168,254,.24);}
.ms-skill.is-open{background:rgba(110,168,254,.32);}
.ms-skill-detail{margin-top:2px;padding:6px 9px;border-radius:6px;background:rgba(110,168,254,.08);
  border:1px solid rgba(110,168,254,.2);font-size:var(--my-fs-10);line-height:1.65;color:var(--my-text-2);
  max-height:96px;overflow-y:auto;}
.ms-skill-detail-head{font-weight:600;color:var(--my-accent-soft);margin-bottom:2px;}
.ms-body{pointer-events:none;display:flex;flex-direction:column;gap:8px;min-height:0;
  max-height:${SIZE.maxBodyH}px;overflow-y:auto;overflow-x:hidden;padding-right:4px;}
.ms-body.ms-scroll{pointer-events:auto;
  mask-image:linear-gradient(180deg,black calc(100% - 24px),transparent 100%);
  -webkit-mask-image:linear-gradient(180deg,black calc(100% - 24px),transparent 100%);}
.ms-body.ms-scroll::-webkit-scrollbar{width:3.5px;}
.ms-body.ms-scroll::-webkit-scrollbar-track{background:transparent;}
.ms-body.ms-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:999px;}
.ms-body.ms-scroll::-webkit-scrollbar-thumb:hover{background:rgba(110,168,254,.45);}
.ms-empty{display:flex;align-items:center;justify-content:center;min-height:56px;
  font-size:var(--my-fs-10-5);color:rgba(160,172,190,.62);background:rgba(255,255,255,.03);
  border:1px dashed var(--my-hover-2);border-radius:8px;padding:8px;text-align:center;}
.ms-lines{display:flex;flex-direction:column;font-size:var(--my-fs-11-5);line-height:1.78;
  color:rgba(226,232,242,.82);}
.ms-md{font-size:var(--my-fs-11-5);line-height:1.78;letter-spacing:.01em;color:rgba(224,230,240,.86);}
.ms-md h1{font-size:var(--my-fs-15);font-weight:800;letter-spacing:-0.01em;color:rgba(244,247,252,.97);margin:9px 0 6px;}
.ms-md h2{font-size:var(--my-fs-13);font-weight:700;letter-spacing:-0.005em;color:#a8c8f2;margin:9px 0 5px;}
.ms-md h3{font-size:var(--my-fs-11-5);font-weight:600;color:rgba(178,190,208,.95);margin:7px 0 3px;}
.ms-md h1:first-child,.ms-md h2:first-child{margin-top:1px;}
.ms-md p{margin:0 0 9px;}
.ms-md p:last-child{margin-bottom:0;}
.ms-md hr{border:none;border-top:1px solid var(--my-hover-2);margin:7px 0;}
.ms-md blockquote{margin:5px 0 9px;padding:4px 12px;border-left:2.5px solid rgba(110,168,254,.5);
  color:rgba(178,188,204,.9);background:rgba(110,168,254,.06);border-radius:0 5px 5px 0;}
.ms-md strong{color:#f5cd6d;font-weight:700;}
.ms-md em{color:var(--my-text-2);}
.ms-md code{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:var(--my-fs-10-5);
  background:rgba(255,255,255,.07);border-radius:4px;padding:0 4px;}
.ms-md ul,.ms-md ol{margin:2px 0 5px;padding-left:18px;}
.ms-md li{margin:1.5px 0;}
.ms-md table{border-collapse:collapse;margin:4px 0;font-size:var(--my-fs-10-5);}
.ms-md th,.ms-md td{border:1px solid var(--my-hover-2);padding:2px 7px;}
.ms-md th{background:var(--my-hover);font-weight:600;}
.ms-lines>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px;}
.ms-lines>div:nth-child(even){background:var(--my-hover);}
.ms-tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;}
.ms-tile{position:relative;aspect-ratio:3/4;border-radius:6px;overflow:hidden;
  background:var(--my-hover);border:1px solid var(--my-hover-2);}
.ms-tile img{width:100%;height:100%;object-fit:cover;display:block;}
.ms-tile .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:var(--my-fs-11);color:rgba(178,188,204,.55);}
.ms-tile .sd{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;
  box-shadow:0 0 4px rgba(0,0,0,.6);}
.ms-tile .tt{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;font-size:var(--my-fs-8-5);
  color:var(--my-text);background:linear-gradient(transparent,rgba(0,0,0,.72));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-rows{display:flex;flex-direction:column;font-size:var(--my-fs-11);}
.ms-row{display:flex;align-items:baseline;gap:8px;padding:3px 6px;border-radius:5px;}
.ms-row:nth-child(even){background:rgba(255,255,255,.028);}
.ms-row .idx{color:var(--my-accent-soft);font-weight:600;flex:none;min-width:30px;font-family:var(--font-mono,var(--font-mono,ui-monospace,Menlo,monospace));}
.ms-row .main{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ms-row .main .scene{color:var(--my-text-2);margin-right:6px;}
.ms-row .sub{display:block;font-size:var(--my-fs-10);color:rgba(160,172,190,.68);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
.ms-row .meta{flex:none;color:var(--my-text-2);font-size:var(--my-fs-10-5);font-family:var(--font-mono,var(--font-mono,ui-monospace,Menlo,monospace));}
.ms-badges{display:flex;gap:4px;flex:none;align-items:center;}
.ms-badge{font-size:var(--my-fs-9-5);border-radius:4px;padding:0 4.5px;line-height:16px;font-weight:600;}
.ms-badge--ok{color:#4ec9a8;background:rgba(78,201,168,.13);}
.ms-badge--wait{color:var(--my-text-2);background:var(--my-hover);}
.ms-badge--rev{color:#c9a6f7;background:rgba(201,166,247,.12);}
.ms-badge--run{color:#6ea8fe;background:rgba(110,168,254,.13);}
.ms-badge--fail{color:#e06c75;background:rgba(224,108,117,.13);}
.ms-prog{flex:none;width:64px;height:4px;border-radius:2px;background:var(--my-hover-2);overflow:hidden;align-self:center;}
.ms-prog>i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#4f8fe0,#6ea8fe);}
.ms-asset-sections{display:flex;flex-direction:column;gap:5px;}
.ms-asset-group b{display:block;font-size:var(--my-fs-10);font-weight:700;color:var(--my-accent-soft);margin-bottom:2px;}
.ms-asset-names{display:flex;flex-wrap:wrap;gap:4px;}
.ms-asset-name{font-size:var(--my-fs-10);color:rgba(226,232,242,.85);background:rgba(255,255,255,.055);
  border-radius:5px;padding:1.5px 7px;white-space:nowrap;}
.ms-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.ms-card{display:flex;gap:7px;align-items:center;padding:5px 6px;border-radius:8px;
  background:rgba(255,255,255,.04);border:1px solid var(--my-hover-2);box-shadow:0 1px 3px rgba(0,0,0,.25);}
.ms-card img{width:38px;height:38px;border-radius:5px;object-fit:cover;flex:none;
  background:var(--my-hover);}
.ms-card .cv{width:38px;height:38px;border-radius:5px;flex:none;background:var(--my-hover);
  display:flex;align-items:center;justify-content:center;font-size:var(--my-fs-15);}
.ms-card .nm{font-size:var(--my-fs-10-5);line-height:1.35;color:rgba(226,232,242,.88);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ms-card .nm small{display:block;font-size:var(--my-fs-9);color:rgba(160,172,190,.7);font-weight:400;}
.ms-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;
  border-top:1px solid var(--my-hover);padding-top:8px;}
.ms-btn{pointer-events:auto;cursor:pointer;font:600 11px/1 inherit;flex:0 0 auto;
  display:inline-flex;align-items:center;justify-content:center;
  padding:0 12px;height:26px;border-radius:7px;
  color:var(--my-accent-soft);background:rgba(110,168,254,.13);border:1px solid rgba(110,168,254,.4);
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
.ms-composer-title{font-size:var(--my-fs-10);font-weight:600;color:rgba(230,176,84,.92);letter-spacing:.03em;}
.ms-composer textarea{pointer-events:auto;width:100%;box-sizing:border-box;resize:none;font:400 11.5px/1.5 inherit;
  color:rgba(235,240,248,.9);background:rgba(0,0,0,.3);border:1px solid rgba(230,176,84,.3);
  border-radius:6px;padding:6px 8px;outline:none;}
.ms-composer textarea:focus{border-color:rgba(230,176,84,.55);}
.ms-composer-row{display:flex;gap:6px;}
.ms-live{display:flex;gap:4px;flex:none;align-items:center;}
/* 09-14 挪右上:右下压原生底部工作流标签栏;右上顶栏下方原生件最少 */
#my-canvas-hints{position:fixed;right:14px;top:64px;z-index:60;width:275px;pointer-events:auto;
  background:linear-gradient(180deg,var(--my-card-bg) 0%,var(--my-pop-bg) 100%);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(110,168,254,.35);border-radius:12px;
  padding:12px 14px;box-shadow:0 12px 32px -4px rgba(0,0,0,.65),0 4px 12px rgba(0,0,0,.4);
  font:400 11px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;color:rgba(226,232,242,.9);
  animation:ms-slide-up 0.25s cubic-bezier(0.16,1,0.3,1);}
#my-canvas-hints .ms-hints-head{display:flex;align-items:center;justify-content:space-between;
  font-size:var(--my-fs-12);font-weight:700;color:var(--my-accent-soft);margin-bottom:6px;}
#my-canvas-hints .ms-hints-x{pointer-events:auto;cursor:pointer;background:transparent;border:none;
  color:var(--my-text-2);font-size:var(--my-fs-15);line-height:1;padding:2px 4px;border-radius:5px;}
#my-canvas-hints .ms-hints-x:hover{color:#fff;background:rgba(255,255,255,.1);}
#my-canvas-hints .ms-hints-item{display:flex;gap:7px;padding:3.5px 0;}
#my-canvas-hints .ms-hints-item b{flex:none;color:#6ea8fe;min-width:48px;font-weight:600;}
#my-canvas-hints .ms-hints-item span{color:var(--my-text-2);}
#my-canvas-hints-fab{position:fixed;right:14px;top:18px;z-index:60;width:32px;height:32px;
  pointer-events:auto;cursor:pointer;border-radius:50%;border:1px solid rgba(110,168,254,.45);
  background:linear-gradient(135deg,var(--my-card-bg) 0%,var(--my-pop-bg) 100%);
  backdrop-filter:blur(10px);color:var(--my-accent-soft);font:600 14px/1 inherit;
  box-shadow:0 4px 14px rgba(0,0,0,.5);transition:transform 80ms ease,box-shadow 150ms ease;}
#my-canvas-hints-fab:hover{transform:scale(1.08);box-shadow:0 0 12px rgba(110,168,254,.5);}
@keyframes ms-slide-up{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
@keyframes ms-flash{0%{box-shadow:0 0 0 0 rgba(110,168,254,.65);}100%{box-shadow:0 0 0 9px rgba(110,168,254,0);}}
`;

function ensureStyles() {
  if (document.getElementById("my-stage-dom-styles")) return;
  const style = document.createElement("style");
  style.id = "my-stage-dom-styles";
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

// 文档型环节(09-13 用户裁定:每一型都要「查看完全」):七型注入查看按钮;
// 可编辑三型(script/scriptPlan/storyboardTable=编辑器状态机可写集合)加「编辑」。
// 阶段直达型(09-13/14 用户裁定):衍生资产/分镜表/分镜面板/单镜生产/工作台
// =「详情」直达宿主对应阶段页(assets→剧本资产;storyboardTable/storyboard→
// 分镜面板 storyboardPanel;remotionProduction/workbench→视频工作台,老画布
// targetStage 同源),不开弹窗——分镜表弹窗重且慢,分镜内容本就归分镜面板。
// 真文档型(script/scriptPlan)才保留「全文」弹窗。
// 按钮经桥动作回宿主,note=环节 key(宿主寻节点/路由)。
const DOC_VIEWER_KEYS = new Set([
  "script", "scriptPlan", "assets", "storyboardTable",
  "storyboard", "remotionProduction", "workbench",
]);
const DOC_EDITOR_KEYS = new Set(["script", "scriptPlan", "storyboardTable"]);
const DOC_VIEW_LABELS = {
  assets: "详情", storyboard: "详情", storyboardTable: "详情",
  remotionProduction: "详情", workbench: "详情",
};
const docButtons = (key) => {
  const buttons = [];
  // 分镜面板专属(09-14 用户裁定:按之前设计,分镜内容入口=节点按钮,主图
  // 不再摆独立子图节点)——本地动作,canvas.openSubgraph 原生进入
  if (key === "storyboard") buttons.push({ kind: "open-shot-grid", label: "分镜内容" });
  if (DOC_VIEWER_KEYS.has(key)) {
    buttons.push({ kind: "view-doc", label: DOC_VIEW_LABELS[key] || "全文", noteKey: key });
  }
  if (DOC_EDITOR_KEYS.has(key)) buttons.push({ kind: "edit-doc", label: "编辑", noteKey: key });
  return buttons;
};

function stageHTML(payload) {
  const statusKey = payload.status || "empty";
  const color = STATUS_COLOR[statusKey] || STATUS_COLOR.empty;
  const metrics = (payload.metrics || []).map((m) => `<span class="ms-chip">${esc(m)}</span>`).join("");
  const progressRows = (payload.progress || []).map((item) => {
    const total = typeof item.total === "number" && item.total > 0 ? item.total : null;
    const pct = total ? Math.round(Math.min(1, (item.done || 0) / total) * 100) : 0;
    return `<div class="ms-prog-row"><span class="ms-prog-label">${esc(item.label)}</span>
      <span class="ms-prog-nums">${Number(item.done) || 0}${total ? "/" + total : ""}</span>
      ${total != null ? `<span class="ms-prog-mini"><i style="width:${pct}%"></i></span>` : ""}</div>`;
  }).join("");
  const skillPills = (payload.skills || []).map((name, i) =>
    `<button class="ms-skill" data-skill="${i}" title="点击查看技能详情">${esc(name)}</button>`).join("");
  const skillDetails = (payload.skillDetails || []).map((detail, i) => `
    <div class="ms-skill-detail" data-skill="${i}" hidden>
      <div class="ms-skill-detail-head">${esc(detail.name)}${detail.source ? " · " + esc(detail.source) : ""}</div>
      ${(detail.summary || []).map((line) => `<div>${esc(line)}</div>`).join("")}
    </div>`).join("");
  const actions = [...docButtons(payload.key), ...(payload.actions || [])].map((action) => `
    <button class="ms-btn${action.paid ? " ms-btn--paid" : ""}" data-kind="${esc(action.kind)}"
      ${action.noteKey ? `data-note="${esc(action.noteKey)}"` : ""}
      ${action.disabled ? "disabled" : ""} title="${esc(action.label)}">${esc(action.label)}${action.paid ? " ⭐" : ""}</button>`).join("");
  return `
    <div class="ms-stage-topbar ms-stage-topbar--${esc(statusKey)}"></div>
    <div class="ms-head">
      <div class="ms-statusrow" style="color:${color}">
        <span class="ms-dot${statusKey === "pending" ? " ms-dot--live" : ""}" style="background:${color};color:${color}"></span>${esc(payload.statusText || "")}
        ${payload.finalExport ? '<span class="ms-export">已导出成片</span>' : ""}
      </div>
      ${payload.description ? `<div class="ms-desc" title="${esc(payload.description)}">${esc(payload.description)}</div>` : ""}
      ${progressRows ? `<div class="ms-progress">${progressRows}</div>` : ""}
      ${metrics ? `<div class="ms-metrics">${metrics}</div>` : ""}
      ${skillPills ? `<div class="ms-skills">${skillPills}</div>${skillDetails ? `<div class="ms-skill-details">${skillDetails}</div>` : ""}` : ""}
    </div>
    <div class="ms-body">
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
  probe.className = "my-stage-body";
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
  if (node.__myDomBody) return;
  ensureStyles();
  const el = document.createElement("div");
  el.className = "my-stage-body";
  el.setAttribute("data-my-ui", "1"); // 禁动画桥作用域根
  const state = { el, naturalH: 80 };
  const widget = node.addDOMWidget("my-stage-body", "my-stage", el, {
    hideOnZoom: false,
    getHeight: () => state.naturalH,
    // 布局地板只做防塌底限——恒小于 minSize 节点可容空间,尺寸单源归 syncSize
    // (naturalH 当地板会与 760 天花板互顶,前端布局把节点顶到 1228 实测在案)
    getMinHeight: () => 80,
  });
  Object.assign(state, { widget });
  node.__myDomBody = state;
  // 实例级静音 monolith canvas 自绘(原型 my.stage.render 保留为兜底)
  node.onDrawBackground = function () {};
  wireActions(node, el);
  // 滚轮救回(09-13 用户裁定:正文可滚动):前端 GraphView 容器 onwheel 恒
  // preventDefault+缩放画布,正文滚轮冒泡到它=默认滚动被取消。滚动正文上
  // 拦断冒泡(不 preventDefault),默认滚动即恢复;非滚动区照常冒泡缩放画布
  el.addEventListener("wheel", (event) => {
    if (event.target.closest(".ms-body.ms-scroll")) event.stopPropagation();
  }, { passive: true });
}

function wireActions(node, el) {
  el.addEventListener("click", (event) => {
    // 技能胶囊:点开/收起详情(09-13 用户裁定),高度变化走 syncSizeFor
    const skill = event.target.closest(".ms-skill");
    if (skill) {
      const detail = el.querySelector(`.ms-skill-detail[data-skill="${skill.dataset.skill}"]`);
      if (detail) {
        detail.hidden = !detail.hidden;
        skill.classList.toggle("is-open", !detail.hidden);
        syncSizeFor(el);
      }
      return;
    }
    const button = event.target.closest(".ms-btn");
    if (!button || button.disabled) return;
    // 分镜内容(09-14):本地进入子图,不经桥——官方 canvas.openSubgraph
    const kind0 = button.dataset.kind || "";
    if (kind0 === "open-shot-grid") {
      const nodes = window.app?.canvas?.graph?._nodes || [];
      const ref = nodes.find((n) => n.type !== "MyStage" && n.type !== "ManyingStage" && String(n.title || "").includes("分镜内容"))
        || nodes.find((n) => n.subgraph && String(n.title || "").includes("分镜内容"));
      if (ref && window.app.canvas?.openSubgraph) window.app.canvas.openSubgraph(ref.subgraph, ref);
      return;
    }
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
    const note = button.dataset.note
      || (button.classList.contains("ms-btn--go")
        ? (el.querySelector(".ms-composer textarea")?.value || "")
        : "");
    if (button.classList.contains("ms-btn--go")) closeComposer(el);
    postAction(kind, note, button);
  });
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
    if (node.__myDomBody && node.__myDomBody.el === el) {
      node.__myDomBody.naturalH = Math.max(80, measureNatural(node, el));
      syncSize(node);
      return;
    }
  }
}

// ── B2 队列实时轮询(单例):桥 /comfy/bridge/storyboards 的 queue 快照 →
// 逐镜 [data-shot-idx] 行原位重填 .ms-live 徽章;画布不在场=空转(仅查询)。──
function installQueuePoller() {
  if (window.__myQueuePoller) return;
  window.__myQueuePoller = true;
  setInterval(() => {
    if (!document.querySelector('.my-stage-body [data-live="queue"]')) return;
    fetch(`${BRIDGE_URL}/comfy/bridge/storyboards`, { headers: { "X-Manying-Image-Token": BRIDGE_TOKEN } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.queue)) return;
        for (const item of data.queue) {
          const row = document.querySelector(`.my-stage-body [data-shot-idx="${Number(item.index) || 0}"]`);
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
  ["导航", "拖拽画布空白处平移,空白处滚轮缩放;双击空白可添加节点"],
  ["节点按钮", "全文=文档弹窗(剧本/导演规划);详情=直达对应阶段页;分镜内容=进入每镜子图;金色⭐=付费云端(可填补充要求)"],
  ["分镜内容", "分镜面板节点「分镜内容」进入子图;每镜双关键帧并排,标号即卡片"],
  ["正文滚动", "内容超出帽高的节点,正文区可直接滚轮滚动(不会缩放画布)"],
  ["进度与技能", "头区进度对=已做/要做;技能胶囊点开看来源与摘要;队列徽章 2 秒实进"],
];

function installCanvasHints() {
  if (document.getElementById("my-canvas-hints-fab")) return;
  const KEY = "my.canvasHints.dismissed";
  const build = () => {
    const card = document.createElement("div");
    card.id = "my-canvas-hints";
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
  fab.id = "my-canvas-hints-fab";
  fab.title = "画布速查卡";
  fab.textContent = "?";
  fab.onclick = () => {
    const existing = document.getElementById("my-canvas-hints");
    if (existing) existing.remove();
    else build();
  };
  document.body.append(fab);
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === "1"; } catch (error) { /* 无碍 */ }
  if (!dismissed) build();
}

function renderDomBody(node) {
  const state = node.__myDomBody;
  if (!state) return;
  // 旧键 manyingStage=存量工作流兼容双读
  const payload = node.properties?.myStage ?? node.properties?.manyingStage;
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
  const state = node.__myDomBody;
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
      let h = Math.max(sz[1], state.naturalH ? state.naturalH + chrome : 240);

      // 正方形=宽基准+高帽(09-13 用户裁定:禁按钮下留白):宽恒 [540,760]
      // 方卡观感;高随内容收缩贴底(下限 180 仅防塌),高内容时拓宽趋方并
      // 封顶 ≤宽×1.15 与 hardMax——短内容不再被拉高填空白
      if (h > w && w < SIZE.maxSize) {
        w = Math.min(SIZE.maxSize, Math.max(w, h));
      }
      const targetW = Math.min(SIZE.hardMax, Math.max(SIZE.minSize, w));
      const targetH = Math.max(180, Math.min(SIZE.hardMax, Math.min(h, targetW * 1.15)));

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
  name: "my.stage.dom",
  async setup() {
    // markdown-it 就位→重渲染全部环节正文(首帧纯文本回落→成型替换)
    onMarkdownReady(() => {
      for (const node of (window.app?.canvas?.graph?._nodes || [])) {
        if (node.__myDomBody) {
          try { renderDomBody(node); } catch (error) { /* 各自兜底 */ }
        }
      }
    });
    // B2 队列轮询 + B3 速查卡:页面级单例,扩展 setup 一次即装
    try { installQueuePoller(); } catch (error) { /* 无碍 */ }
    try { installCanvasHints(); } catch (error) { /* 无碍 */ }
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    // 旧名 ManyingStage=存量工作流兼容
    if (nodeData?.name !== "MyStage" && nodeData?.name !== "ManyingStage") return;
    // 09-15 右键继承:环节动作族挂进 litegraph 原生节点菜单(与 DOM 面板
    // 按钮同一 postAction 通道,宿主消费端零改动);原生项(Pin/Collapse/
    // Bypass/Colors…)原样保留——只追加,不替换。
    const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const stageProps = this.properties || {};
      const payload = stageProps.myStage ?? stageProps.manyingStage;
      if (payload && typeof payload.key === "string") {
        const act = (content, kind, note) => options.push({
          content: `漫影 · ${content}`,
          callback: () => { postAction(kind, note || payload.key, null); },
        });
        // 与 DOM 面板按钮同源(docButtons 单源):桥类动作走 postAction;
        // 本地动作(open-shot-grid=进分镜子图)在菜单内本地执行同款
        for (const action of docButtons(payload.key)) {
          if (action.kind === "open-shot-grid") {
            options.push({
              content: `漫影 · ${action.label}`,
              callback: () => { try { window.app?.canvas?.openSubgraph?.(this); } catch (error) { /* 子图缺席静默 */ } },
            });
            continue;
          }
          act(action.label, action.kind, action.noteKey);
        }
        // 资产环节:抽取/重新抽取(载荷 actions 单源;disabled 同面板语义=
        // 无剧本时不触发;09-15 排查:衍生资产来源=剧本抽取,非分镜表)
        for (const action of payload.actions || []) {
          if (action.kind !== "extract-assets") continue;
          const item = {
            content: `漫影 · ${action.label}`,
            disabled: Boolean(action.disabled),
            callback: () => { if (!action.disabled) postAction(action.kind, action.note || null, null); },
          };
          options.push(item);
        }
      }
      return getExtraMenuOptions?.apply(this, arguments);
    };

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
      try {
        // 槽位代名词(09-13 用户裁定:upstream/MANYING_FLOW 裸英文退役):
        // 入槽=「上游环节」,出槽=「下游环节」;剧本是链头,入槽整个摘除
        // (生成器本就 inputs:[],前端会照节点定义补建,这里在其后移除;
        // 链头永无入线,零断链风险)
        const stageProps = this.properties || {};
        const isHead = (stageProps.myStage ?? stageProps.manyingStage)?.key === "script";
        this.inputs = (this.inputs || []).filter((input) => {
          if (input.name !== "upstream") return true;
          if (isHead) return false;
          input.label = "上游环节";
          return true;
        });
        for (const output of this.outputs || []) {
          if (output.name === "flow") output.label = "下游环节";
        }
      } catch (error) { /* 兜底=原生标签 */ }
      try { renderDomBody(this); } catch (error) { /* 同上 */ }
      return result;
    };
  },
});
