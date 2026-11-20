// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节详情浮层(stage-ui/detail,1115 详情入 ComfyUI:derived-asset-detail)。
 *
 * 形态纪律(先例=daoyan/picker.js:118-148 + daoyan/video.js:26-72):
 * 全屏遮罩+自持 DOM 挂 document.body+data-act 委托——不进环节节点重渲环
 * (live.js 纪律),不 portal 进 LiteGraph canvas DOM,禁 Radix;规避 1007
 * LegacyWidget 懒 materialize 刻碑(my-qi21-prompt-preview.js 反例:JS 自建
 * customtext/addDOMWidget 渲染不可靠,显示只走 body 外挂或自定义 type)。
 * 视频回看复用 window.DaoyanVideo(IIFE 全局件,零改 import);富文本复用
 * common.js renderMarkdown(markdown-it vendor 内嵌)。
 *
 * 四模式(resolveDetailRequest 单源分派):
 *   chapterShots 整章镜 id 清单(分镜表/分镜面板「详情」默认,点行下钻;
 *               旧行缺 id 时=行号对齐兜底入口,行数不符示换代警示禁错开镜)
 *   shot        单镜 15 列全量+台词+分镜图+单镜视频(数据走 /my_daoyan/
 *               shot_detail 引擎直读路由,零回 App 往返)
 *   asset       衍生资产卡详情(载荷直渲:cover 大图+prompt+state+父子血缘;
 *               不走新路由——引擎不复刻 asset-file:// 解析,防漂移)
 *   workbench   轨道概览+finalExport 徽章/逐镜队列(载荷直渲:数据已在
 *               workbench/remotionProduction 注入块,不走 shot_detail)
 * 真文档型(script/scriptPlan「全文」)不进本浮层——仍走宿主 NodeDocViewer。
 */
import { esc, renderMarkdown, inputImg, badge } from "./common.js";

/** view-doc 五型(「详情」标签型)→浮层;与 stage-node DOC_VIEW_LABELS 同源 */
const DETAIL_VIEW_KINDS = new Set([
  "assets", "storyboard", "storyboardTable",
  "remotionProduction", "workbench",
]);

/** 长文列走 markdown 渲染(分镜描述是 md 风格源);其余列纯转义 */
const MD_COLUMNS = new Set(["画面描述", "视频描述"]);

/**
 * 详情请求分派(纯函数,machine-test 面):
 * @param {object} input {kind, act?, shotId?, idx?, assetName?,
 *   projectId, chapter, payload, rowCount?}
 * @returns {object|null} {mode, ...ctx};null=不进浮层(script/scriptPlan 等)
 */
export function resolveDetailRequest(input) {
  const kind = String(input?.kind || "");
  const ctx = {
    projectId: String(input?.projectId || ""),
    chapter: String(input?.chapter || ""),
    payload: input?.payload || null,
  };
  if (input?.act === "shot-detail") {
    if (input.shotId) return { mode: "shot", shotId: String(input.shotId), fromList: true, ...ctx };
    // 旧行缺 id(D0 前载荷):清单+行号对齐兜底;对齐失败=换代警示
    return {
      mode: "chapterShots", needAlign: true,
      alignIndex: Number(input?.idx) || 0,
      rowCount: Number(input?.rowCount) || 0, ...ctx,
    };
  }
  if (input?.act === "asset-detail") {
    return { mode: "asset", assetName: input.assetName || null, ...ctx };
  }
  if (kind === "storyboardTable" || kind === "storyboard") {
    return { mode: "chapterShots", ...ctx };
  }
  if (kind === "assets") {
    return { mode: "asset", assetName: null, ...ctx };
  }
  if (kind === "workbench" || kind === "remotionProduction") {
    return { mode: "workbench", ...ctx };
  }
  return null;
}

/**
 * 旧行行号对齐(纯函数):清单行数===表行数才放行(跨源一致性,禁行号直取
 * 错开镜);不符=null→上层示「表/分片换代不一致,请重开工作流」。
 */
export function alignShotId(list, rowCount, idx) {
  const shots = Array.isArray(list?.shots) ? list.shots : [];
  if (!shots.length || shots.length !== Number(rowCount)) return null;
  const hit = shots.find((s) => Number(s.index) === Number(idx));
  return hit?.id ? String(hit.id) : null;
}

// ── 纯 HTML 构建(机器断言面:关键字段/属性必须在案) ──────────────────

export function chapterListHTML(data, options = {}) {
  const shots = Array.isArray(data?.shots) ? data.shots : [];
  const rows = shots.map((s) => `
    <div class="dt-row${s.imageReady ? "" : " dt-row--wait"}"
         data-act="shot-detail" data-shot-id="${esc(s.id)}">
      <span class="dt-idx">#${String(s.index).padStart(2, "0")}</span>
      <span class="dt-main">${esc(s.title || `分镜 ${s.index}`)}
        <small>「${esc(s.lines || "—")}」</small></span>
      <span class="dt-meta">${esc(s.duration ?? "—")}s · ${esc(s.state || "—")}</span>
    </div>`).join("");
  const warn = options.mismatch
    ? `<div class="dt-warn">表/分片换代不一致，请重开工作流（本清单按最新分片渲染，点击行按镜 id 直达）</div>` : "";
  return `${warn}<div class="dt-list" data-live="detail-list">${rows}</div>`;
}

export function shotHTML(shot) {
  const columns = Array.isArray(shot?.columns) ? shot.columns : [];
  const rows = columns.map(([label, value]) => `
    <div class="dt-col"><dt>${esc(label)}</dt><dd>${
      MD_COLUMNS.has(label) && value ? renderMarkdown(String(value))
        : esc(value ?? "—")}</dd></div>`).join("");
  const image = shot?.imageUrl
    ? `<img class="dt-shot-img" src="${esc(shot.imageUrl)}" alt="分镜图"
         onerror="this.style.display='none'">` : "";
  const video = shot?.videoUrl
    ? `<button type="button" class="dt-btn" data-act="shot-video"
         data-url="${esc(shot.videoUrl)}" data-title="${esc(shot.id || "")}">▶ 单镜视频</button>` : "";
  const badges = [
    shot?.state ? badge(shot.state === "ready" ? "ok" : "wait", esc(shot.state)) : "",
    Number(shot?.revision) > 1 ? badge("rev", `v${shot.revision}`) : "",
    shot?.stale ? badge("fail", "stale") : "",
  ].filter(Boolean).join("");
  // 1120 分镜面板退役迁引擎:单镜动作面(面板单镜卡出口全量收编为桥动作;
  // note 编码:open-shot-image=shotId;keyframe-extract=shotId|single|<ts>/
  // shotId|uniform|<count>;compare-*=shotId;set-audio-mix=shotId|value)
  const shotId = esc(shot?.id || "");
  const actBtn = (kind, label, note, title) => `
      <button type="button" class="dt-btn dt-btn--act" data-act="bridge-action"
        data-kind="${esc(kind)}" data-note="${esc(note)}"${title ? ` title="${esc(title)}"` : ""}>${esc(label)}</button>`;
  const actions = shot?.id ? `
    <div class="dt-act-row">
      ${actBtn("open-shot-image", "进入图工作流", shotId, "打开本镜图片工作流(编辑/生成)")}
      ${shot?.videoUrl ? actBtn("keyframe-extract", "存为关键帧", `${shotId}|single|0`, "当前画面存为本镜关键帧") : ""}
      ${shot?.videoUrl ? actBtn("keyframe-extract", "自动抽帧", `${shotId}|uniform|3`, "均匀抽 3 帧回灌关键帧") : ""}
      ${actBtn("compare-frames", "对比两帧", shotId, "左右对比本镜第 1、2 帧关键帧")}
      ${actBtn("compare-video", "对比上一版", shotId, "当前版与上一版并排对比")}
      ${shot?.videoUrl ? `
      <label class="dt-mix"><span>混音</span>
        <select class="dt-select" data-act="audio-mix" data-shot-id="${shotId}">
          <option value="h3-baked"${shot?.audioMix === "h3-baked" ? " selected" : ""}>用片内声</option>
          <option value="tts-stack"${(shot?.audioMix ?? "tts-stack") === "tts-stack" ? " selected" : ""}>配音主导</option>
          <option value="mixed"${shot?.audioMix === "mixed" ? " selected" : ""}>双层混音</option>
        </select></label>` : ""}
    </div>` : "";
  return `
    <div class="dt-shot">
      <div class="dt-shot-head"><b>#${String(columns.find(([l]) => l === "镜号")?.[1] ?? "").padStart(2, "0")}</b>
        <code>${esc(shot?.id || "")}</code>${badges ? `<span class="dt-badges">${badges}</span>` : ""}</div>
      ${image}
      <dl class="dt-cols">${rows}</dl>
      ${video}
      ${actions}
    </div>`;
}

export function assetHTML(asset) {
  if (!asset) return `<div class="dt-empty">未找到该资产卡（载荷换代？请重开工作流）</div>`;
  const cover = asset.cover
    ? `<div class="dt-asset-cover">${inputImg(asset.cover)}</div>`
    : `<div class="dt-asset-cover"><span>🖼</span></div>`;
  const meta = [
    ["类型", asset.typeLabel],
    ["状态", asset.state],
    ["视图", asset.views ? `${asset.views} 视图` : null],
    // D0 载荷扩字段(prompt/血缘)——键缺席优雅退化「—」,不猜
    ["提示词", asset.prompt],
    ["源卡", asset.sourceName],
    ["衍生", Array.isArray(asset.derivedNames) && asset.derivedNames.length
      ? asset.derivedNames.join("、") : null],
  ].map(([label, value]) => `
    <div class="dt-col"><dt>${label}</dt><dd>${esc(value ?? "—")}</dd></div>`).join("");
  return `
    <div class="dt-asset">
      ${cover}
      <div class="dt-asset-head"><b>${esc(asset.name || "")}</b></div>
      <dl class="dt-cols">${meta}</dl>
    </div>`;
}

export function assetOverviewHTML(payload) {
  const cards = payload?.assets || [];
  if (!cards.length) return `<div class="dt-empty">暂无资产 · 详情需先「抽取资产」</div>`;
  const rows = cards.map((a) => `
    <div class="dt-row" data-act="asset-detail" data-asset-name="${esc(a.name)}">
      <span class="dt-main">${esc(a.name || "")}
        <small>${esc(a.typeLabel || "")}${a.state ? " · " + esc(a.state) : ""}</small></span>
    </div>`).join("");
  return `<div class="dt-list">${rows}</div>`;
}

export function workbenchHTML(payload) {
  const parts = [];
  if (payload?.finalExport) parts.push(
    `<div class="dt-export">${badge("ok", "已导出成片")}${payload.rendererLabel
      ? `<span class="dt-meta">${esc(payload.rendererLabel)}</span>` : ""}</div>`);
  const tracks = (payload?.tracks || []).map((t) => `
    <div class="dt-row"><span class="dt-main">${esc(t.name)}</span>
      <span class="dt-meta">${t.count > 0 ? esc(t.count) + " 镜 · " : ""}${
        t.mediaCount > 0 ? esc(t.mediaCount) + " 素材 · " : ""}${
        t.duration > 0 ? Math.floor(t.duration / 60) + ":" + String(t.duration % 60).padStart(2, "0") : ""}</span>
      ${t.state ? badge(t.state === "ready" ? "ok" : "wait", esc(t.state)) : ""}</div>`).join("");
  if (tracks) parts.push(`<div class="dt-list">${tracks}</div>`);
  const shots = (payload?.shots || []).map((s) => `
    <div class="dt-row"><span class="dt-idx">#${String(s.index).padStart(2, "0")}</span>
      <span class="dt-main">${esc(s.label)}</span>
      <span class="dt-meta">${s.videoReady ? "视频✓" : "待出"}${s.ttsReady ? " · 配音✓" : ""}${
        s.sfxReady ? " · 音效✓" : ""}${Number(s.revision) > 1 ? ` · v${s.revision}` : ""}</span></div>`).join("");
  if (shots) parts.push(`<div class="dt-list">${shots}</div>`);
  if (!parts.length) return `<div class="dt-empty">暂无轨道/队列数据（载荷直渲分支）</div>`;
  return parts.join("");
}

function loadingHTML() {
  return `<div class="dt-empty">详情读取中…</div>`;
}

function errorHTML(message) {
  return `<div class="dt-warn">${esc(message || "详情读取失败")}</div>`;
}

// ── 浮层壳(body 外挂自持 DOM;data-act 委托=picker.js 同款) ────────────

const OVERLAY_STYLES = `
.dt-mask{position:fixed;inset:0;z-index:99998;background:rgba(3,6,12,.82);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  display:flex;align-items:center;justify-content:center;padding:28px;}
.dt-panel{width:min(720px,92vw);max-height:86vh;display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(17,26,42,.97),rgba(10,16,28,.97));
  border:1px solid rgba(110,168,254,.35);border-radius:14px;
  box-shadow:0 24px 64px -8px rgba(0,0,0,.75);overflow:hidden;
  font:400 12px/1.7 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:rgba(226,232,242,.92);}
.dt-head{display:flex;align-items:center;gap:10px;padding:12px 16px;flex:none;
  border-bottom:1px solid rgba(110,168,254,.18);}
.dt-title{font-size:14px;font-weight:700;color:#9ec5fe;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dt-sub{font-size:10.5px;color:rgba(160,172,190,.75);margin-right:auto;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dt-x{pointer-events:auto;cursor:pointer;background:transparent;border:none;
  color:rgba(160,172,190,.85);font-size:15px;line-height:1;padding:2px 8px;border-radius:5px;}
.dt-x:hover{color:#fff;background:rgba(255,255,255,.1);}
.dt-body{padding:14px 16px 16px;overflow-y:auto;min-height:120px;}
.dt-body::-webkit-scrollbar{width:5px;}
.dt-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:999px;}
.dt-list{display:flex;flex-direction:column;gap:2px;}
.dt-row{display:flex;align-items:baseline;gap:10px;padding:7px 10px;border-radius:8px;
  cursor:pointer;pointer-events:auto;transition:background 120ms ease;}
.dt-row:hover{background:rgba(110,168,254,.12);}
.dt-row--wait{opacity:.72;}
.dt-idx{flex:none;min-width:34px;font-weight:600;color:#9ec5fe;
  font-family:var(--font-mono,ui-monospace,Menlo,monospace);}
.dt-row .dt-main{flex:1;min-width:0;}
.dt-row .dt-main small{display:block;font-size:10.5px;color:rgba(160,172,190,.75);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dt-meta{flex:none;font-size:10.5px;color:rgba(160,172,190,.8);
  font-family:var(--font-mono,ui-monospace,Menlo,monospace);}
.dt-warn{margin-bottom:10px;padding:8px 12px;border-radius:8px;font-size:11.5px;
  color:#f2c1c6;background:rgba(224,108,117,.12);border:1px solid rgba(224,108,117,.4);}
.dt-empty{padding:26px 10px;text-align:center;font-size:11.5px;color:rgba(160,172,190,.65);}
.dt-shot-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
.dt-shot-head b{font-size:15px;color:#f5cd6d;}
.dt-shot-head code{font-size:10.5px;color:rgba(160,172,190,.8);
  background:rgba(255,255,255,.06);border-radius:4px;padding:1px 6px;}
.dt-badges{display:flex;gap:4px;align-items:center;}
.dt-shot-img{width:100%;max-height:320px;object-fit:contain;border-radius:10px;
  background:rgba(0,0,0,.35);margin-bottom:12px;border:1px solid rgba(110,168,254,.2);}
.dt-cols{display:flex;flex-direction:column;gap:0;margin:0;}
.dt-col{display:flex;gap:12px;padding:6px 2px;border-bottom:1px dashed rgba(110,168,254,.12);}
.dt-col dt{flex:none;width:64px;font-size:10.5px;font-weight:600;color:#9ec5fe;}
.dt-col dd{flex:1;min-width:0;margin:0;color:rgba(226,232,242,.9);word-break:break-word;}
.dt-col dd p{margin:0 0 6px;}
.dt-col dd p:last-child{margin-bottom:0;}
.dt-btn{pointer-events:auto;cursor:pointer;margin-top:12px;font:600 11.5px/1 inherit;
  display:inline-flex;align-items:center;gap:6px;padding:0 14px;height:28px;border-radius:8px;
  color:#9ec5fe;background:rgba(110,168,254,.13);border:1px solid rgba(110,168,254,.4);}
.dt-btn:hover{background:rgba(110,168,254,.22);}
.dt-act-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px;}
.dt-act-row .dt-btn{margin-top:0;height:26px;padding:0 10px;font-size:10.5px;}
.dt-mix{display:inline-flex;align-items:center;gap:5px;margin-left:auto;
  font-size:10.5px;color:rgba(160,172,190,.85);}
.dt-select{pointer-events:auto;cursor:pointer;font:600 10.5px/1 inherit;color:rgba(226,232,242,.92);
  background:rgba(110,168,254,.1);border:1px solid rgba(110,168,254,.35);
  border-radius:6px;padding:4px 6px;height:26px;}
.dt-act-status{margin-top:8px;font-size:10.5px;color:rgba(160,172,190,.8);min-height:14px;}
.dt-back{pointer-events:auto;cursor:pointer;margin-bottom:10px;font:600 11px/1 inherit;
  background:transparent;border:none;color:#9ec5fe;padding:2px 0;}
.dt-back:hover{text-decoration:underline;}
.dt-asset{display:flex;flex-direction:column;gap:12px;}
.dt-asset-cover{display:flex;align-items:center;justify-content:center;
  min-height:200px;border-radius:10px;background:rgba(0,0,0,.3);
  border:1px solid rgba(110,168,254,.2);overflow:hidden;}
.dt-asset-cover img{max-width:100%;max-height:360px;object-fit:contain;display:block;}
.dt-asset-cover span{font-size:34px;opacity:.5;}
.dt-asset-head b{font-size:15px;color:#f5cd6d;}
.dt-export{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
`;

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("my-detail-styles")) return;
  const style = document.createElement("style");
  style.id = "my-detail-styles";
  style.textContent = OVERLAY_STYLES;
  document.head.append(style);
}

const TITLES = {
  chapterShots: "整章镜清单", shot: "单镜详情",
  asset: "资产详情", workbench: "轨道概览",
};

let root = null;
let current = null; // {request, listData}
let escHandler = null;

// ── 1120 分镜面板退役迁引擎:单镜动作面桥提交 ─────────────────────────
// 复制 theme.js 常量语义(不 import theme.js——它顶层挂 ComfyUI 全局,
// node --test 直跑会炸;此处运行时才触 fetch,纯函数测试面零依赖)
const BRIDGE_URL = ((typeof window !== "undefined"
  && (window.MY_BRIDGE_URL || window.MANYING_BRIDGE_URL)) || "http://127.0.0.1:17595"
).replace(/\/$/, "");

function actStatusEl() {
  return root?.querySelector?.("[data-live='act-status']") || null;
}

function setActStatus(text, isError = false) {
  const el = actStatusEl();
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#e06c75" : "";
}

async function submitBridgeAction(kind, note) {
  const request = current?.request || {};
  setActStatus("提交中…");
  try {
    const response = await fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        note,
        originProjectId: request.projectId,
        originEpisodeId: request.chapter,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setActStatus(data.duplicate ? "已提交过,等待宿主执行" : "已提交,宿主执行中");
  } catch (error) {
    setActStatus(`提交失败(${error?.message || error})`, true);
  }
}

function renderShell(title, sub, body) {
  if (!root) return "";
  root.innerHTML = `
    <div class="dt-mask">
      <div class="dt-panel" role="dialog" aria-label="${esc(title)}">
        <div class="dt-head"><span class="dt-title">${esc(title)}</span>
          <span class="dt-sub">${esc(sub || "")}</span>
          <button type="button" class="dt-x" data-act="detail-close" title="关闭 (Esc)">✕</button></div>
        <div class="dt-body">${body}</div>
      </div>
    </div>`;
  return root.innerHTML;
}

function closeDetailInternal() {
  current = null;
  if (escHandler && typeof document !== "undefined") {
    document.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  if (root && root.remove) { try { root.remove(); } catch (error) { /* stub 容错 */ } }
  root = null;
  return true;
}

/** 关浮层(遮罩/✕/Esc 同口;测试与外部动作亦可直调) */
export function closeDetail() { return closeDetailInternal(); }

async function fetchShotDetail(params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`/my_daoyan/shot_detail?${query.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function requireCtx(request) {
  if (request.mode === "asset" || request.mode === "workbench") return true; // 载荷直渲分支
  if (!request.projectId || !request.chapter) {
    renderShell(TITLES[request.mode], "", errorHTML(
      "此工作流未绑定来源项目与章节，请从漫影项目重新打开后再查看"));
    return false;
  }
  return true;
}

async function showRequest(request) {
  current = { request, listData: current?.listData || null };
  const sub = request.chapter || "";
  renderShell(TITLES[request.mode] || "详情", sub, loadingHTML());
  try {
    if (request.mode === "chapterShots") {
      const data = await fetchShotDetail(
        { project: request.projectId, chapter: request.chapter });
      current.listData = data;
      if (request.needAlign) {
        const rowCount = request.rowCount
          || (request.payload?.tableRows || request.payload?.tiles || []).length;
        const id = alignShotId(data, rowCount, request.alignIndex);
        if (id) return showRequest({ ...request, mode: "shot", shotId: id, needAlign: false });
        renderShell(TITLES.chapterShots, sub,
          chapterListHTML(data, { mismatch: data.count !== rowCount }));
        return true;
      }
      renderShell(TITLES.chapterShots, sub, chapterListHTML(data));
      return true;
    }
    if (request.mode === "shot") {
      const data = await fetchShotDetail({
        project: request.projectId, chapter: request.chapter,
        shot_id: request.shotId,
      });
      const back = request.fromList && current.listData
        ? `<button type="button" class="dt-back" data-act="back-list">◀ 返回镜清单</button>` : "";
      const actStatus = `<div class="dt-act-status" data-live="act-status"></div>`;
      renderShell(TITLES.shot, sub, back + shotHTML(data.shot) + actStatus);
      return true;
    }
    if (request.mode === "asset") {
      const assets = request.payload?.assets || [];
      const asset = request.assetName
        ? assets.find((a) => a.name === request.assetName) : null;
      renderShell(TITLES.asset, "", request.assetName
        ? assetHTML(asset) : assetOverviewHTML(request.payload));
      return true;
    }
    if (request.mode === "workbench") {
      renderShell(TITLES.workbench, "", workbenchHTML(request.payload));
      return true;
    }
    return false;
  } catch (error) {
    renderShell(TITLES[request.mode] || "详情", sub, errorHTML(error?.message));
    return false;
  }
}

function onRootClick(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  const mask = root?.firstElementChild;
  if (target === mask) { closeDetailInternal(); return; } // 点空白遮罩=关(panel 内不关)
  const actEl = target.closest("[data-act]");
  const act = actEl?.getAttribute("data-act") || "";
  if (act === "detail-close") { closeDetailInternal(); return; }
  if (act === "back-list") {
    if (current?.listData) {
      showRequest({ ...current.request, mode: "chapterShots",
        needAlign: false, fromList: false });
    }
    return;
  }
  if (act === "shot-detail") {
    showRequest({ ...(current?.request || {}), kind: "", act: "shot-detail",
      shotId: actEl.getAttribute("data-shot-id") || "" });
    return;
  }
  if (act === "asset-detail") {
    showRequest({ ...(current?.request || {}), kind: "assets", act: "asset-detail",
      assetName: actEl.getAttribute("data-asset-name") || null });
    return;
  }
  if (act === "shot-video") {
    const video = window.DaoyanVideo;
    if (video?.open) video.open(actEl.getAttribute("data-url") || "",
      actEl.getAttribute("data-title") || "单镜视频回看");
    return;
  }
  // 1120 单镜动作面:桥动作直发宿主(与节点按钮同通道,note=镜 id 编码)
  if (act === "bridge-action") {
    void submitBridgeAction(actEl.getAttribute("data-kind") || "",
      actEl.getAttribute("data-note") || "");
  }
}

function onRootChange(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  const select = target.closest('select[data-act="audio-mix"]');
  if (select) {
    void submitBridgeAction("set-audio-mix",
      `${select.getAttribute("data-shot-id") || ""}|${select.value}`);
  }
}

/**
 * 开详情浮层(入口=stage-node wireActions/右键菜单;输入面同
 * resolveDetailRequest)。分派失败(真文档型等)=false 不浮层。
 */
export function openDetail(input) {
  const request = resolveDetailRequest(input);
  if (!request) return false;
  if (typeof document === "undefined") return false;
  ensureStyles();
  if (!root) {
    root = document.createElement("div");
    root.addEventListener("click", onRootClick);
    // 1120 单镜动作面:混音下拉走 change(select 点击不选值)
    root.addEventListener("change", onRootChange);
  }
  if (!root.isConnected && document.body?.appendChild) document.body.append(root);
  if (!escHandler) {
    escHandler = (event) => { if (event.key === "Escape") closeDetailInternal(); };
    document.addEventListener("keydown", escHandler);
  }
  if (!requireCtx(request)) return true;
  void showRequest(request);
  return true;
}
