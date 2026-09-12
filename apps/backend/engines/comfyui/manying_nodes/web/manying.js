// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 漫影业务侧栏(09-09 comfyui-frontend-swap 阶段2 批3)。
 *
 * ComfyUI 原生前端 sidebar 扩展(自定义 DOM 渲染器):拉取漫影 sidecar 的
 * 分镜快照渲染列表;点选=把 shot id 回填到当前选中的 ManyingGenerated
 * 节点 shot_target widget——迁移流/手搭流的回写目标由此免手填。
 * 数据面:GET {BRIDGE}/comfy/bridge/storyboards(渲染层周期 POST 推)。
 */
import { app } from "/scripts/app.js";
// 模块内容策略(manying_module_policy.js,并行会话 09-12:模块分离裁定)——
// 漫影侧栏库过滤 / userdata 工作流树 fetch 过滤的唯一真源
import {
  filterUserDataWorkflowEntries,
  filterWorkflowsForScope,
  isUserDataWorkflowListUrl,
} from "./manying_module_policy.js";

const BRIDGE_URL = (window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
const BRIDGE_TOKEN = window.MANYING_BRIDGE_TOKEN || "manying-local-image";

async function fetchShots() {
  const response = await fetch(`${BRIDGE_URL}/comfy/bridge/storyboards`, {
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function applyShotToSelection(shotId, label) {
  const node = app.canvas?.selected_node;
  if (!node || node.comfyClass !== "ManyingGenerated") {
    return { ok: false, message: "请先选中一个「漫影 成图回写」节点再点分镜" };
  }
  const widget = (node.widgets || []).find((item) => item.name === "shot_target");
  if (!widget) return { ok: false, message: "节点缺少 shot_target 挂件" };
  widget.value = shotId;
  if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
  if (app.graph?.change) app.graph.change();
  return { ok: true, message: `已回填回写目标:${label}` };
}

// ── 漫影侧栏 v2:两页签按模块分工(09-11 用户裁定:所有模块都展示漫影标签,
// 内容随当前模块;模型页签撤——模型只在画布节点上呈现)────────────────
// 页签:分镜(分镜工作流主线点击即开+镜列表回填,工作流模块默认)· 工作流
// (漫影库按域→功能夹两级分组点击即开,本地模型模块默认)。模块标记由宿主
// webview URL 参数 manyingScope 传入(workflow/models;外部直访=分镜)。
function manyingScope() {
  try {
    return new URLSearchParams(window.location.search).get("manyingScope");
  } catch (error) {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "X-Manying-Image-Token": BRIDGE_TOKEN } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ── 侧栏设计系统(09-12 用户裁定:美术要用技能好好设计)──────────────────────
// 原则(照 apple-design/frontend-design 技能):层级清晰(分区标签小写间距)、
// 强调色系统(主色=漫影蓝,状态色=绿/琥珀/灰)、图标代替文字堆叠、
// 按压即时反馈(:active 缩放)、克制(无弹跳动画)。
const THEME = {
  accent: "#6ea8fe",       // 漫影蓝(主动作/主线项)
  accentDim: "rgba(110,168,254,0.14)",
  ok: "#4ade80",            // 已出视频
  pending: "#fbbf24",       // 待出/进行中
  idle: "rgba(255,255,255,0.35)",
  line: "rgba(255,255,255,0.10)",
  text2: "rgba(255,255,255,0.55)",
};

/** lucide 风格 stroke 图标(自绘路径,零依赖;14px 视口) */
function icon(pathD, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.cssText = "flex:none;vertical-align:-2px;";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  svg.append(path);
  return svg;
}
const ICONS = {
  clap: "M20.2 6 3 11l-.7-2.6a2 2 0 0 1 1.4-2.5l13.5-3.6a2 2 0 0 1 2.5 1.4Z", // 场记板=分镜
  film: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M9 7v2 M15 7v2 M9 11v2 M15 11v2 M9 15v2 M15 15v2",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z", // 一键生图
  play: "M6 4l14 8-14 8V4Z", // 一键视频
  refresh: "M21 12a9 9 0 1 1-2.6-6.4L21 8 M21 3v5h-5",
  folderOpen: "M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z",
  chevron: "M9 18l6-6-6-6",
};

/** 分区标签:小字号+字间距+弱色(不与内容抢层级) */
function sectionLabel(text, iconPath) {
  const el = document.createElement("div");
  el.style.cssText = `display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${THEME.text2};margin:12px 0 6px;`;
  if (iconPath) el.append(icon(iconPath, 12));
  const span = document.createElement("span");
  span.textContent = text;
  el.append(span);
  return el;
}

/** 状态徽章:彩点+文字(视频✓/待出/未绑定) */
function statusBadge(kind) {
  const map = { done: [THEME.ok, "视频✓"], pending: [THEME.pending, "待出"], idle: [THEME.idle, "未绑定"] };
  const [color, label] = map[kind] || map.idle;
  const el = document.createElement("span");
  el.style.cssText = `display:inline-flex;align-items:center;gap:4px;font-size:10px;color:${color};flex:none;`;
  const dot = document.createElement("span");
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${color};`;
  el.append(dot, document.createTextNode(label));
  return el;
}

/** 视频进度条:绿色填充+计数文本 */
function progressBar(done, total) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:4px 0 2px;";
  const bar = document.createElement("div");
  bar.style.cssText = `height:4px;border-radius:2px;background:${THEME.line};overflow:hidden;`;
  const fill = document.createElement("div");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.cssText = `height:100%;width:${pct}%;border-radius:2px;background:linear-gradient(90deg,${THEME.accent},${THEME.ok});transition:width 400ms ease;`;
  bar.append(fill);
  const label = document.createElement("div");
  label.style.cssText = `display:flex;justify-content:space-between;font-size:10px;color:${THEME.text2};margin-top:3px;`;
  const left = document.createElement("span");
  left.textContent = `已出视频 ${done}/${total}`;
  const right = document.createElement("span");
  right.textContent = `${pct}%`;
  label.append(left, right);
  wrap.append(bar, label);
  return wrap;
}

/** 折叠组(两页签共用):chevron 旋转+标题+计数徽章(tone 定色) */
function collapseGroup(title, count, { tone, indent = 0, open = false } = {}) {
  const color = tone === "ok" ? THEME.ok : tone === "pending" ? THEME.pending : THEME.accent;
  const bg = tone === "ok" ? "rgba(74,222,128,0.15)"
    : tone === "pending" ? "rgba(251,191,36,0.15)" : THEME.accentDim;
  const details = document.createElement("details");
  if (open) details.open = true;
  const summary = document.createElement("summary");
  summary.style.cssText = `display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;list-style:none;color:rgba(255,255,255,0.85);${indent ? `margin-left:${indent * 12}px;` : ""}`;
  const chev = icon(ICONS.chevron, 12);
  chev.style.cssText = "flex:none;transition:transform 150ms ease;";
  const text = document.createElement("span");
  text.textContent = title;
  const badge = document.createElement("span");
  badge.style.cssText = `margin-left:auto;font-size:10px;font-weight:500;padding:1px 7px;border-radius:999px;background:${bg};color:${color};flex:none;`;
  badge.textContent = String(count);
  summary.append(chev, text, badge);
  details.append(summary);
  details.addEventListener("toggle", () => {
    chev.style.transform = details.open ? "rotate(90deg)" : "";
  });
  return details;
}

/** 主按钮(强调填充)/次按钮(描边):按压即时缩放反馈 */
function actionButton({ label, iconPath, primary }) {
  const btn = document.createElement("button");
  btn.style.cssText = [
    "flex:1", "display:flex", "align-items:center", "justify-content:center", "gap:6px",
    "padding:8px 6px", "cursor:pointer", "border-radius:8px", "font-size:12px", "font-weight:500",
    primary
      ? `border:1px solid ${THEME.accent};background:${THEME.accentDim};color:${THEME.accent};`
      : `border:1px solid ${THEME.line};background:transparent;color:rgba(255,255,255,0.8);`,
    "transition:transform 80ms ease,filter 120ms ease",
  ].join(";");
  btn.append(icon(iconPath, 13));
  const span = document.createElement("span");
  span.textContent = label;
  btn.append(span);
  btn.onpointerdown = () => { btn.style.transform = "scale(0.97)"; };
  btn.onpointerup = btn.onpointerleave = () => { btn.style.transform = ""; };
  if (primary) {
    btn.onmouseenter = () => { btn.style.filter = "brightness(1.25)"; };
    btn.onmouseleave = () => { btn.style.filter = ""; };
  }
  return btn;
}

function paneStatus(text) {
  const p = document.createElement("p");
  p.style.cssText = `font-size:11px;color:${THEME.text2};margin:4px 0 6px;`;
  p.textContent = text;
  return p;
}

// ── 单实例打开协议(09-12 任务 workflow-single-open)────────────────────────
// 侧栏点击与宿主自动打开共用的唯一通道:永不重复建签/永不出现 Unsaved Workflow。
// 语义基础(ComfyUI_frontend 1.51.x TS 源+实弹双钉死):
//   · store.openWorkflow(entry)=注册签+激活+载内容,但不渲染画布(渲染只走 loadGraphData)
//   · loadGraphData(图, true, true, name) 字符串分支:name 须为 workflows/ 下的
//     完整相对路径(含子目录+.json)才能命中库内条目;同路径已激活且 id 相容→
//     复用既有签(id 相容=任一侧无 id 字段;我们生成的图恒无 id→恒相容)
//   · 条目内容懒载:须先 await entry.load() 才有 activeState
// 降级底线:扩展面缺席(旧前端)→带名临时打开(零 Unsaved 仍成立,仅失去文件绑定)。
const MANYING_STORE_BASE = "workflows/";

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

/** 静默关掉匹配的旧签(跳过活跃签,避免关掉活跃工作流后 activeWorkflow 悬挂)。
 * 09-12 实弹修正:历史带号残留「…chapter-001 (N).json」也一并匹配(防复用
 * 分支失效期堆积的草稿跨重载恢复后长存)。 */
async function closeStaleWorkflows(svc, match) {
  for (const wf of [...(svc.openWorkflows || [])]) {
    if (!match(wf)) continue;
    if (typeof svc.isActive === "function" && svc.isActive(wf)) continue;
    try { await svc.closeWorkflow(wf); } catch (error) { /* 已关/失败:下一轮兜底 */ }
  }
}

/** 主线签匹配器:精确库路径 + 带号复本(base (N).json)。 */
function mainlineTabMatcher(libraryPath) {
  const base = libraryPath.replace(/\.json$/, "");
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\(\\d+\\))?\\.json$");
  return (wf) => wf.path === libraryPath || (wf.isTemporary && re.test(wf.path));
}

/**
 * 打开漫影工作流(单实例,v3=实例分支)。
 * 09-12 实弹定谳:字符串名分支的 id 配对(activeState.id vs 画布 serialize id)
 * 在「库条目会被重派 id、画布 id 不随 configure 走」的现实下结构性不可满足
 * →每次落 createNewTemporary 叠 "(N)"。改走**实例分支**:loadGraphData 第 4 参
 * 传工作流实例(store 条目),activateLoadedWorkflow 直接 openWorkflow+reset,
 * 零临时签零 id 匹配;单实例由 store openWorkflow 的路径注册天然保证。
 * @param name 库内相对路径(含子目录与 .json)——兜底路径的命名与清扫锚点。
 * @param graph 库里还没有该文件时的兜底图内容(宿主生成器产物)。
 */
async function openWorkflowSingleInstance({ name, graph }) {
  const app2 = window.app;
  const libraryPath = MANYING_STORE_BASE + name;
  const svc = app2?.extensionManager?.workflow;
  if (!app2 || typeof app2.loadGraphData !== "function") return { ok: false, mode: "no-app" };
  // 旧前端无扩展面:带名临时兜底(零 Unsaved Workflow 底线仍成立)
  if (!svc || typeof svc.loadWorkflows !== "function" || typeof svc.getWorkflowByPath !== "function"
    || typeof svc.openWorkflow !== "function") {
    await app2.loadGraphData(cloneGraph(graph), true, true, name);
    return { ok: true, mode: "named-temp" };
  }
  // Q3a 顺带清场:自动打开的历史 Unsaved 产物(可从应用数据再生)静默关
  await cleanupLegacyUnsavedTabs();
  // 索引每页一次(重复 loadWorkflows 会重载条目重派 id,实例引用也会换——
  // 拿稳条目实例是实例分支的前提)
  if (!window.__manyingWfIndexed) {
    try { await svc.loadWorkflows(); } catch (error) { /* 索引失败→走兜底 */ }
    window.__manyingWfIndexed = true;
  }
  let entry = null;
  try { entry = svc.getWorkflowByPath(libraryPath) || null; } catch (error) { entry = null; }
  if (!entry) {
    // 保鲜链新写入的文件可能未入索引:重索引一次再找(仅条目缺失时)
    try { await svc.loadWorkflows(); } catch (error) { /* 二次失败→走兜底 */ }
    try { entry = svc.getWorkflowByPath(libraryPath) || null; } catch (error) { entry = null; }
  }
  const matcher = mainlineTabMatcher(libraryPath);
  const active = svc.activeWorkflow;
  // 陈旧修改标志自愈(09-12 同页切内容实测):上游装载序列在 loadGraphData 后
  // reset() 不重评 isModified,程序化装载恒带假 true → Q1a「保用户修改」会把
  // 主线刷新(切章/保鲜链重写后再点)全部误吞。图态确等时重评翻回 false;
  // 真用户修改(态不等)重评后仍 true,保用户态语义不受影响。自愈失败按原样走。
  try {
    const tracker = active && active.changeTracker;
    if (active && active.isModified && tracker && typeof tracker.updateModified === "function") {
      tracker.updateModified();
    }
  } catch (error) { /* 宁保勿丢 */ }
  // Q1a 刷新策略(用户裁定):我们的主线签已开且有未保存修改→保留用户状态,
  // 只确保激活,不重载(主线条目与同名临时签都算"我们的主线")
  if (active && (active.path === libraryPath || matcher(active)) && active.isModified) {
    try { await svc.openWorkflow(active); } catch (error) { /* 已活跃:幂等 */ }
    return { ok: true, mode: "kept-modified" };
  }
  // 库里没有该文件但同名临时签已活跃 → 内容已是我们的,不重开
  // (字符串分支对活跃同名签仍可能叠号,直接短路)
  if (!entry && active && matcher(active)) return { ok: true, mode: "named-active" };
  // 清带号残留与同名旧临时签(非活跃;活跃的由上面短路或下一轮收敛)
  await closeStaleWorkflows(svc, matcher);
  if (entry) {
    try {
      // 已载且未修改:load() 缓存命中不读盘(上游语义 Directly returns if already
      // loaded)——保鲜链同页重写库文件后(切章/后台生成落地),不 force 重读
      // activeState 永远停在旧内容,主线卡刷新拿不到新章。有未保存修改(草稿)
      // 不 force,保留用户态(Q1a 同理)。
      await entry.load(entry.isLoaded && !entry.isModified ? { force: true } : undefined);
    } catch (error) {
      entry = null; // 文件读失败(刚被删等)→按兜底图走
    }
    if (entry) {
      const content = entry.activeState || graph;
      await svc.openWorkflow(entry); // 未开→注册+激活;已开→激活;活跃→早退(路径注册=单实例)
      await app2.loadGraphData(cloneGraph(content), true, true, entry); // 实例分支:零临时签
      try { entry.changeTracker?.updateModified(); } catch (error) { /* 装载后重评:消程序化装载的假「未保存」点 */ }
      await cleanupLegacyUnsavedTabs(); // 主线接管活跃位后,再清一轮旧 Unsaved
      return { ok: true, mode: "library-bound" };
    }
  }
  await app2.loadGraphData(cloneGraph(graph), true, true, name);
  return { ok: true, mode: "named-temp" };
}
window.__manyingOpenWorkflow = openWorkflowSingleInstance;

/**
 * 旧 "Unsaved Workflow(N)" 签清场(Q3a 用户裁定):只关「图内含漫影环节节点」
 * 的(自动打开历史产物,可从应用数据再生);用户手搭(无漫影节点)一律不动。
 * 幂等:每次协议打开都会再扫一遍;活跃签跳过(由打开流程接管后再清)。
 */
async function cleanupLegacyUnsavedTabs() {
  const svc = window.app?.extensionManager?.workflow;
  if (!svc || !Array.isArray(svc.openWorkflows)) return;
  for (const wf of [...svc.openWorkflows]) {
    const file = String(wf.path || "").split("/").pop() || "";
    // 09-12 标题改「分镜工作流」:旧命名形态(· 章 / (N 章))的标签一并清——
    // 库文件已由保鲜链删除,残留标签=孤儿临时签
    const legacy =
      /^Unsaved Workflow( \(\d+\))?\.json$/.test(file) ||
      /^分镜工作流( · .+| \(\d+ 章\))\.json$/.test(file);
    if (!legacy) continue;
    const nodes = wf.activeState?.nodes;
    // 关闭判据两形态:①装过我们的图(含 ManyingStage)→孤儿主线签;
    // ②纯空白(零节点,引擎冷启自带的初始签)→关之无损,用户真在空白签
    // 上搭过的图(有节点但无 ManyingStage)不动。
    if (!Array.isArray(nodes) || !(nodes.length === 0 || nodes.some((n) => n && n.type === "ManyingStage"))) continue;
    if (typeof svc.isActive === "function" && svc.isActive(wf)) continue;
    try { await svc.closeWorkflow(wf); } catch (error) { /* 下一轮兜底 */ }
  }
}

/** 页签一·分镜:分镜工作流主线(点击即开)+原镜列表逻辑整迁(刷新+状态+点选回填) */
function renderShotsPane(pane) {
  pane.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:2px;";
  // ── 章节徽章(顶部,主色描边胶囊) ──
  const chapterPill = document.createElement("div");
  chapterPill.style.cssText = `display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:3px 10px;border-radius:999px;border:1px solid ${THEME.accent}55;background:${THEME.accentDim};color:${THEME.accent};font-size:11px;font-weight:600;letter-spacing:0.02em;`;
  const chapterDot = document.createElement("span");
  chapterDot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${THEME.accent};box-shadow:0 0 6px ${THEME.accent}88;`;
  const chapterText = document.createElement("span");
  chapterText.textContent = "获取章节…";
  chapterPill.append(chapterDot, chapterText);

  // ── 分镜工作流主线 ──
  const flowLabel = sectionLabel("分镜工作流", ICONS.folderOpen);
  const flowStatus = paneStatus("加载主线…");
  const flowList = document.createElement("div");
  flowList.style.cssText = "display:flex;flex-direction:column;gap:4px;";

  // ── 制作动作(主按钮=一键生图 主色填充;次按钮=一键视频 描边) ──
  const actionLabel = sectionLabel("制作动作", ICONS.zap);
  const actionBar = document.createElement("div");
  actionBar.style.cssText = "display:flex;gap:6px;";
  const actionStatus = paneStatus("");
  const genBtn = actionButton({ label: "一键生图", iconPath: ICONS.zap, primary: true });
  const vidBtn = actionButton({ label: "一键生成视频", iconPath: ICONS.play, primary: false });
  const submitAction = async (button, kind, label) => {
    actionStatus.textContent = `${label}:提交中…`;
    actionStatus.style.color = "";
    try {
      const result = await postJson(`${BRIDGE_URL}/comfy/bridge/actions`, { kind });
      actionStatus.textContent = result.duplicate
        ? `${label}:已提交过,等待宿主执行`
        : `${label}:已提交,宿主执行中`;
    } catch (error) {
      actionStatus.textContent = `${label}:提交失败(${error.message || error})`;
      actionStatus.style.color = "#e06c75";
    }
  };
  genBtn.onclick = () => void submitAction(genBtn, "generate-images", "一键生图");
  vidBtn.onclick = () => void submitAction(vidBtn, "generate-videos", "一键视频");
  actionBar.append(genBtn, vidBtn);

  // ── 视频进度(进度条)+镜列表(默认折叠分组) ──
  const progressLabel = sectionLabel("视频进度", ICONS.film);
  const progressHost = document.createElement("div");
  const status = paneStatus("");
  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-top:2px;";
  const refresh = document.createElement("button");
  refresh.style.cssText = `display:flex;align-items:center;justify-content:center;gap:5px;width:100%;padding:6px;cursor:pointer;border-radius:8px;border:1px solid ${THEME.line};background:transparent;color:${THEME.text2};font-size:11px;transition:transform 80ms ease;`;
  refresh.append(icon(ICONS.refresh, 12));
  const refreshText = document.createElement("span");
  refreshText.textContent = "刷新分镜列表";
  refresh.append(refreshText);
  refresh.onpointerdown = () => { refresh.style.transform = "scale(0.97)"; };
  refresh.onpointerup = refresh.onpointerleave = () => { refresh.style.transform = ""; };

  pane.append(chapterPill, flowLabel, flowStatus, flowList, actionLabel, actionBar, actionStatus, progressLabel, progressHost, status, list, refresh);

  // 09-11 续:按当前章节过滤+视频进度分类+镜列表默认折叠
  let currentEpisodeId = "";
  const isCurrentChapter = (text) => !currentEpisodeId || String(text || "").includes(currentEpisodeId);

  const applyChapter = () => {
    chapterText.textContent = currentEpisodeId ? currentEpisodeId : "未获取到章节";
  };
  applyChapter();

  void fetchJson(`${BRIDGE_URL}/comfy/bridge/storyboards`)
    .then((data) => {
      currentEpisodeId = data.currentEpisodeId || "";
      applyChapter();
    })
    .catch(() => undefined);

  const openBadges = [];
  void fetchJson(`${BRIDGE_URL}/comfy/workflows?prefix=${encodeURIComponent("漫影/1_图片/分镜/0_工作流主线/")}`)
    .then((data) => {
      const items = (data.workflows || []).filter((item) => item.id && isMainlineWorkflow(item.id));
      const chapterItems = items.filter((item) => isCurrentChapter(item.id));
      flowStatus.textContent = chapterItems.length > 0
        ? `${chapterItems.length} 条主线 · 点击在画布打开`
        : currentEpisodeId
          ? "当前章节还没有主线"
          : "还没有主线(进入工作流阶段自动生成)";
      for (const item of chapterItems) {
        const badge = makeOpenBadge();
        openBadges.push([`${MANYING_STORE_BASE}${item.id}`, badge]);
        flowList.append(manyingWorkflowRow(item, flowStatus, badge));
      }
      syncOpenBadges(openBadges);
    })
    .catch((error) => {
      flowStatus.textContent = `取不到工作流(${error.message || error});请确认漫影软件在运行`;
    });
  // 「已打开」徽章随标签开关实时亮灭(store 订阅;每页签渲染只挂一次)
  const svcStore = window.app?.extensionManager?.workflow;
  if (svcStore?.$subscribe && !pane.dataset.manyingOpenSub) {
    pane.dataset.manyingOpenSub = "1";
    svcStore.$subscribe(() => syncOpenBadges(openBadges));
  }

  const load = async () => {
    status.textContent = "加载分镜…";
    list.innerHTML = "";
    progressHost.innerHTML = "";
    try {
      const data = await fetchShots();
      const allShots = data.shots || [];
      currentEpisodeId = data.currentEpisodeId || currentEpisodeId;
      applyChapter();
      const shots = allShots.filter((shot) => isCurrentChapter(shot.episodeId));
      if (shots.length === 0) {
        status.textContent = currentEpisodeId
          ? "当前章节还没有分镜(打开漫影分镜面板后自动推送)"
          : "漫影里还没有分镜(打开漫影分镜面板后自动推送)";
        return;
      }
      const stale = data.updatedAt && Date.now() - data.updatedAt > (data.staleAfterMs || 900000);
      const withVideo = shots.filter((shot) => shot.videoReady).length;
      const withImage = shots.filter((shot) => shot.imageReady).length;
      progressHost.append(progressBar(withVideo, shots.length));
      status.textContent = `画面 ${withImage}/${shots.length}${stale ? " · 快照较旧(打开画布页刷新)" : ""}`;
      const groups = [
        { title: "已出视频", count: withVideo, shots: shots.filter((shot) => shot.videoReady), kind: "done" },
        { title: "待出视频", count: shots.length - withVideo, shots: shots.filter((shot) => !shot.videoReady), kind: "pending" },
      ].filter((group) => group.shots.length > 0);
      for (const group of groups) {
        const details = collapseGroup(group.title, group.count, { tone: group.kind }); // 默认折叠
          for (const shot of group.shots) {
            const row = document.createElement("button");
            row.title = `点击回填到选中的成图回写节点:${shot.id}`;
            row.style.cssText = [
              "display:flex", "align-items:center", "gap:6px", "width:100%", "text-align:left", "margin:2px 0",
              "padding:6px 8px", "cursor:pointer", "border-radius:6px",
              `border:1px solid ${THEME.line}`, "background:transparent",
              "color:inherit", "font-size:12px", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap",
              "transition:background 120ms ease,transform 80ms ease",
            ].join(";");
            const label = document.createElement("span");
            label.textContent = shot.label || shot.id;
            label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;";
            row.append(label, statusBadge(shot.videoReady ? "done" : shot.imageReady ? "pending" : "idle"));
            row.onmouseenter = () => { row.style.background = THEME.accentDim; };
            row.onmouseleave = () => { row.style.background = "transparent"; };
            row.onpointerdown = () => { row.style.transform = "scale(0.98)"; };
            row.onpointerup = row.onpointerleave = () => { row.style.transform = ""; };
            row.onclick = () => {
              const result = applyShotToSelection(shot.id, shot.label || shot.id);
              status.textContent = result.message;
              status.style.color = result.ok ? "" : "#e06c75";
            };
            details.append(row);
          }
        list.append(details);
      }
    } catch (error) {
      status.textContent = `取不到分镜(${error.message || error});请确认漫影软件在运行`;
    }
  };
  refresh.onclick = () => void load();
  void load();
}

/** 页签二·工作流:漫影库按域分组,点击在画布打开(本地模型模块默认页签) */
async function openManyingWorkflow(id, status) {
  const label = id.split("/").pop().replace(/\.json$/, "");
  try {
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows/${encodeURIComponent(id)}/content`);
    const graph = JSON.parse(data.content);
    if (window.app && typeof window.app.loadGraphData === "function") {
      // 09-12 单实例协议通道(id 即库内相对路径,直接作 name)
      await openWorkflowSingleInstance({ name: id, graph });
      status.textContent = `已打开:${label}`;
      status.style.color = "";
    } else {
      status.textContent = "画布还没就绪,稍候再点";
      status.style.color = "#e06c75";
    }
  } catch (error) {
    status.textContent = `打开失败(${error.message || error})`;
    status.style.color = "#e06c75";
  }
}

/** 分镜工作流主线判据(生成器落位「漫影/1_图片/分镜/0_工作流主线/」) */
function isMainlineWorkflow(id) {
  return id.startsWith("漫影/1_图片/分镜/0_工作流主线/") && !id.endsWith("/.keep.json");
}

/** 库工作流行(分镜/工作流两页签共用):标题+悬停+点击在画布打开;badgeEl=可选「已打开」徽章位 */
function manyingWorkflowRow(item, status, badgeEl) {
  const row = document.createElement("button");
  row.title = `点击在画布打开:${item.id}`;
  row.style.cssText = [
    "display:flex", "align-items:center", "gap:8px", "width:100%", "text-align:left", "padding:8px 10px",
    "cursor:pointer", "border-radius:8px",
    `border:1px solid ${THEME.accent}44`, `background:${THEME.accentDim}`,
    `color:${THEME.accent}`, "font-size:12px", "font-weight:500",
    "overflow:hidden", "transition:filter 120ms ease,transform 80ms ease",
  ].join(";");
  row.append(icon(ICONS.clap, 14));
  const label = document.createElement("span");
  label.textContent = item.name || item.id.split("/").pop().replace(/\.json$/, "");
  label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const chev = icon(ICONS.chevron, 12);
  chev.style.flex = "none";
  row.append(label);
  if (badgeEl) row.append(badgeEl);
  row.append(chev);
  row.onmouseenter = () => { row.style.filter = "brightness(1.25)"; };
  row.onmouseleave = () => { row.style.filter = ""; };
  row.onpointerdown = () => { row.style.transform = "scale(0.98)"; };
  row.onpointerup = row.onpointerleave = () => { row.style.transform = ""; };
  row.onclick = () => void openManyingWorkflow(item.id, status);
  return row;
}

/** 「已打开」徽章(09-12 AC5):openWorkflows 命中库路径即亮绿点 */
function makeOpenBadge() {
  const badge = document.createElement("span");
  badge.style.cssText = `display:none;align-items:center;gap:4px;flex:none;font-size:10px;color:${THEME.ok};`;
  const dot = document.createElement("span");
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${THEME.ok};box-shadow:0 0 6px ${THEME.ok}88;`;
  badge.append(dot, document.createTextNode("已打开"));
  return badge;
}

function syncOpenBadges(openBadges) {
  const svc = window.app?.extensionManager?.workflow;
  if (!svc) return;
  const open = new Set((svc.openWorkflows || []).map((wf) => wf.path));
  for (const [path, badge] of openBadges) {
    badge.style.display = open.has(path) ? "inline-flex" : "none";
  }
}

async function renderWorkflowsPane(pane) {
  pane.textContent = "";
  pane.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:2px;";
  // 09-12 模块分离语境化:本页签=本地模型模块专属,标题随模块说话
  // (用户裁定「为什么还展示漫影工作流模块里面的东西」——文案也分域)。
  pane.append(sectionLabel("本地模型工作流库", ICONS.folderOpen));
  // 搜索框:万条级库的实用入口(150ms 防抖,名字/路径子串,不分大小写)
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索工作流名…";
  search.style.cssText = [
    "width:100%", "box-sizing:border-box", "padding:6px 10px", "font-size:12px",
    `border:1px solid ${THEME.line}`, "border-radius:8px",
    "background:rgba(255,255,255,0.04)", "color:inherit", "outline:none",
  ].join(";");
  const status = paneStatus("加载工作流…");
  const host = document.createElement("div");
  host.style.cssText = "display:flex;flex-direction:column;";
  pane.append(search, status, host);
  try {
    // light=1:跳过逐文件 JSON 解析(海量库性能,09-12 桥新增参数)
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows?light=1`);
    // .keep.json=空夹占位(建夹机制),不作为工作流行展示;
    // models 域再剔分镜产线内容(漫影/1_图片/分镜/**=工作流模块内容),
    // 策略单源在 manying_module_policy.js
    const items = filterWorkflowsForScope((data.workflows || []).filter((item) =>
      item.id && item.id.startsWith("漫影/") && !item.id.endsWith("/.keep.json")), manyingScope());
    if (items.length === 0) {
      status.textContent = "还没有可用工作流(K2 图像 / H3 视频 / 音乐)";
      return;
    }
    // 两级分组:域(图片/视频/…)→功能夹(K2图像/H3视频/…)
    const domains = new Map();
    for (const item of items) {
      const segments = item.id.split("/");
      const domain = segments.length > 2 ? segments[1].replace(/^\d+_/, "") : "其他";
      const group = segments.length > 3 ? segments[2].replace(/^\d+_/, "") : "";
      if (!domains.has(domain)) domains.set(domain, new Map());
      const groups = domains.get(domain);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    const order = ["图片", "视频", "声音", "其他"];
    const orderedDomains = () => [...domains.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // 功能夹排序:按中文名(分镜产线不在本页签——models 域专属)
    const sortGroups = (groups) => [...groups.keys()].sort((a, b) => a.localeCompare(b, "zh"));

    // 组内 30 条帽+「显示全部」解帽(海量组首屏 DOM 有界)
    const GROUP_CAP = 30;
    const showAll = new Set(); // 已解帽功能夹键(域::夹)
    const appendCapped = (container, entries, groupKey) => {
      const cap = showAll.has(groupKey) ? entries.length : Math.min(GROUP_CAP, entries.length);
      for (const item of entries.slice(0, cap)) {
        const row = manyingWorkflowRow(item, status);
        row.style.margin = "2px 0 2px 12px";
        container.append(row);
      }
      if (entries.length > cap) {
        const more = document.createElement("button");
        more.textContent = `显示全部 ${entries.length} 个`;
        more.style.cssText = [
          "display:block", "margin:2px 0 2px 12px", "padding:5px 10px", "cursor:pointer",
          "font-size:11px", `border:1px dashed ${THEME.line}`, "border-radius:8px",
          "background:transparent", `color:${THEME.text2}`,
        ].join(";");
        more.onpointerdown = () => { more.style.transform = "scale(0.97)"; };
        more.onpointerup = more.onpointerleave = () => { more.style.transform = ""; };
        more.onclick = () => {
          showAll.add(groupKey);
          while (container.lastChild && container.lastChild !== container.firstElementChild) {
            container.lastChild.remove();
          }
          appendCapped(container, entries, groupKey);
        };
        container.append(more);
      }
    };

    let renderScheduled = false;
    // 首屏默认展开首个域(图片):进面板即见 K2 工作流,其余域保持折叠懒渲染;
    // 仅首次渲染生效,搜索/清空后回归各自的折叠态
    let firstPaint = true;
    const renderGroups = () => {
      renderScheduled = false;
      const query = search.value.trim().toLowerCase();
      const match = (item) => !query
        || String(item.name || "").toLowerCase().includes(query)
        || String(item.id).toLowerCase().includes(query);
      host.textContent = "";
      let hitsTotal = 0;
      const ordered = orderedDomains();
      for (const domain of ordered) {
        const groups = domains.get(domain);
        const domainEntries = [...groups.values()].flat().filter(match);
        if (query && domainEntries.length === 0) continue;
        hitsTotal += domainEntries.length;
        const openNow = Boolean(query) || (firstPaint && domain === ordered[0]);
        const details = collapseGroup(domain, domainEntries.length, { open: openNow });
        // 懒渲染:折叠态零行 DOM,首次展开才建(海量库首屏不冻的关键)
        const renderChildren = () => {
          if (details.dataset.manyingRendered) return;
          details.dataset.manyingRendered = "1";
          for (const groupName of sortGroups(groups)) {
            const entries = groups.get(groupName)
              .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "zh"))
              .filter(match);
            if (entries.length === 0) continue;
            if (!groupName) {
              appendCapped(details, entries, `${domain}::root`);
              continue;
            }
            const sub = collapseGroup(groupName, entries.length, {
              indent: 1,
              open: Boolean(query),
            });
            appendCapped(sub, entries, `${domain}::${groupName}`);
            details.append(sub);
          }
        };
        details.addEventListener("toggle", renderChildren);
        if (openNow) renderChildren(); // 搜索态/首屏默认域:建组即渲染
        host.append(details);
      }
      firstPaint = false;
      status.textContent = query
        ? (hitsTotal > 0 ? `${hitsTotal} 个匹配 · 点击在画布打开` : `没有匹配「${search.value.trim()}」的工作流`)
        : `${items.length} 个工作流(点击在画布打开)`;
    };
    search.oninput = () => {
      if (renderScheduled) return;
      renderScheduled = true;
      setTimeout(renderGroups, 150);
    };
    renderGroups();
  } catch (error) {
    status.textContent = `取不到工作流(${error.message || error});请确认漫影软件在运行`;
  }
}

/** 页签三·模型:引擎模型按域分组(件数+体积,多重归属各计) */
function renderSidebar(container) {
  container.style.padding = "8px";
  // 页签按当前模块展示,任何情况都只显一签(09-12 用户裁定×2:不能一次性
  // 都展示出来)——工作流模块=分镜;本地模型模块=工作流;外部直访=分镜。
  const scope = manyingScope();
  const tabs = [scope === "models"
    ? { id: "workflows", label: "工作流", render: renderWorkflowsPane }
    : { id: "shots", label: "分镜阶段", render: renderShotsPane }];
  const activeId = tabs[0].id;
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:2px;margin-bottom:6px;border-bottom:1px solid rgba(128,128,128,0.35);";
  const panes = new Map();
  const switchTab = (id) => {
    for (const [paneId, pane] of panes) pane.style.display = paneId === id ? "" : "none";
    for (const button of bar.querySelectorAll("button")) {
      const on = button.dataset.manyingTab === id;
      button.style.borderBottomColor = on ? "rgba(128,168,224,0.9)" : "transparent";
      button.style.fontWeight = on ? "600" : "normal";
    }
    const pane = panes.get(id);
    const tab = tabs.find((item) => item.id === id);
    if (pane && tab && !pane.dataset.rendered) {
      pane.dataset.rendered = "1";
      tab.render(pane);
    }
  };
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.textContent = tab.label;
    button.dataset.manyingTab = tab.id;
    button.style.cssText = [
      "flex:1", "padding:4px 6px", "cursor:pointer", "font-size:11px",
      "border:none", "border-bottom:2px solid transparent", "background:transparent", "color:inherit",
    ].join(";");
    button.onclick = () => switchTab(tab.id);
    panes.set(tab.id, document.createElement("div"));
    bar.append(button);
  }
  container.append(bar);
  for (const [, pane] of panes) container.append(pane);
  switchTab(activeId);
}

// 渲染兼容守卫(09-12 真跑根修):ComfyUI 前端的 Vue 节点渲染模式
// (Comfy.VueNodes.Enabled,测试期特性)会让 litegraph 的 drawNode 提前返回,
// onDrawBackground 自定义绘制整体失效——漫影环节节点的富内容/镜子缩略图全灭
// (所有依赖画布自绘的社区扩展同样中招)。漫影托管引擎须恒走经典画布渲染:
// 发现被开启即关回 ComfyUI 出厂默认 false,一次重载生效;sessionStorage 防循环。
app.registerExtension({
  name: "manying.render.compat",
  async setup() {
    try {
      const settings = app.ui?.settings;
      if (typeof settings?.getSettingValue !== "function") return;
      const key = "Comfy.VueNodes.Enabled";
      if ((await settings.getSettingValue(key)) !== true) return;
      if (sessionStorage.getItem("__manyingVueNodesGuarded") === "1") return;
      sessionStorage.setItem("__manyingVueNodesGuarded", "1");
      if (typeof settings.setSettingValueAsync === "function") {
        await settings.setSettingValueAsync(key, false);
      } else {
        settings.setSettingValue(key, false);
      }
      location.reload();
    } catch {
      // 设置面不可用(旧版前端)=经典渲染本就是默认,无动作
    }
  },
});

app.registerExtension({
  name: "manying.sidebar",
  async setup() {
    // 新版前端侧栏 API(官方 sidebar 扩展,自定义 DOM 渲染);旧版无此面=静默跳过
    if (app.extensionManager?.registerSidebarTab) {
      app.extensionManager.registerSidebarTab({
        id: "manying.shots",
        icon: "icon-[lucide--list]",
        title: "漫影",
        tooltip: "漫影:分镜/工作流——按所在模块定默认页签",
        render: renderSidebar,
      });
      installSidebarTabDecorations();
      installDockModelEntryRemoval();
      // 旧 Unsaved 签清场(Q3a 09-12):等图就绪(草稿恢复完)扫一轮;幂等,
      // 协议通道每次打开也会再扫。只关含漫影环节节点的(可再生),用户手搭不动。
      const sweepUnsaved = (attempt) => {
        if (app.isGraphReady === true) { void cleanupLegacyUnsavedTabs(); return; }
        if (attempt < 40) setTimeout(() => sweepUnsaved(attempt + 1), 300);
      };
      sweepUnsaved(0);
    }
  },
});

// ── dock「模型」入口移除(09-11 用户裁定:模型只在画布节点上呈现,侧栏
// 模型库入口不需要;用户点名的原生项豁免,仍走外挂 DOM 形式不改本体)──
// dock 按钮为前端渲染的侧栏项,按标签文本识别「模型」后隐藏;观察器常驻
// (侧栏随模块/窗口重渲染,一次性隐藏会被冲掉)。
function installDockModelEntryRemoval() {
  const hideModelEntry = () => {
    const buttons = document.querySelectorAll(".side-tool-bar-container button, [class*=\"side-tool-bar\"] button");
    for (const button of buttons) {
      const label = ((button.title || "") + " " + (button.getAttribute("aria-label") || "") + " " + (button.textContent || "")).trim();
      if (label.indexOf("模型") >= 0 && button.style.display !== "none") {
        button.style.display = "none";
      }
    }
  };
  hideModelEntry();
  const observer = new MutationObserver(hideModelEntry);
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── 侧栏漫影标签:品牌龙徽标 + 置顶(09-10 用户裁定×3:弃代码线稿改用真标) ──
// ComfyUI 侧栏图标走 iconify 名册只认 lucide 名——自定义图标用注册后
// DOM 置换;标签排序按注册序(扩展殿后),置顶用 DOM 前插。观察器兜底
// Vue 重渲染回滚。图标=品牌 logo(apps/frontend/assets/brand/logo-32x32.png,
// 原图 1254²/1.3MB,缩至 64²/6.5KB 后 base64 内嵌=data URL,零 URL 假设;
// 形=红金龙徽,alpha 透明底,深浅主题通吃)。
// 品牌 logo 数据(assets/brand/logo-32x32.png 缩 64²/6.5KB;base64 内嵌=零 URL 假设)
const LOGO_PNG_DATA_URL =
  'data:image/png;base64,'
  + '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';

// 图标=品牌龙徽的单色化:CSS mask 用 logo alpha 通道,currentColor 上色——
// 暗主题白/亮主题黑,与侧栏 lucide 图标(stroke=currentColor)同一主题机制,
// 细节(须/鳞/爪)经 alpha 全保留。
const MANYING_LOGO_ICON =
  '<span aria-hidden="true" '
  + 'style="display:inline-block;width:1.8em;height:1.8em;background-color:currentColor;'
  + '-webkit-mask-image:url(\'' + LOGO_PNG_DATA_URL + '\');'
  + 'mask-image:url(\'' + LOGO_PNG_DATA_URL + '\');'
  + '-webkit-mask-size:contain;mask-size:contain;'
  + '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;'
  + '-webkit-mask-position:center;mask-position:center"/>';

function decorateSidebarTab() {
  // 金锚点:SideToolbar 每个标签按钮带 data-testid="<tabId>-tab-button"(bundle 实证)
  const root = document.querySelector('[data-testid="manying.shots-tab-button"]');
  if (!root) return;
  // 置顶:插到本容器第一个标签钮之前(顶部品牌徽标之后)=在队列/资产等所有标签之上
  const container = root.parentElement;
  if (container) {
    const firstTab = container.querySelector('[data-testid$="-tab-button"]');
    if (firstTab && firstTab !== root) container.insertBefore(root, firstTab);
  }
  // 图标置换:图标槽=组件内部 i.side-bar-button-icon(iconify 类渲染位)→ 品牌龙徽单色 mask
  // 沿用槽位类名吃原生尺寸,外加 object-fit;标记防重渲染后重复嵌套
  const iconHost = root.querySelector("i.side-bar-button-icon");
  if (iconHost && !root.querySelector("[data-manying-dragon]")) {
    const holder = document.createElement("span");
    holder.innerHTML = MANYING_LOGO_ICON;
    const dragon = holder.firstElementChild;
    if (dragon) {
      dragon.setAttribute("data-manying-dragon", "1");
      dragon.classList.add("side-bar-button-icon");
      iconHost.replaceWith(dragon);
    }
  }
}

function installSidebarTabDecorations() {
  if (window.__manyingSidebarDecorated) return;
  window.__manyingSidebarDecorated = true;
  let scheduled = false;
  const sweep = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateSidebarTab();
    });
  };
  const start = () => {
    sweep();
    new MutationObserver(sweep).observe(document.body, { subtree: true, childList: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}


// ── 漫影节点图片带(09-10 用户裁定:节点要展示该镜成图,风格贴原生) ───────
// properties.manyingPreview = 引擎 input 目录缩略图名(总览保鲜上传,
// manying-shot-*.jpg 同名覆写);onDrawBackground 画布直绘:零前端组件
// API 依赖、不进 widgets_values(序列化契约零影响)、缺图/无键=纯文字卡
// 优雅退化。图带锚节点底部,节点加高由总览生成器(NODE_HEIGHT)负责。
app.registerExtension({
  name: "manying.shot.preview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ManyingShot") return;
    const PREVIEW_H = 170;
    const PAD = 10;
    const images = new Map(); // filename -> HTMLImageElement(全图共用缓存)
    const ensureImage = (name) => {
      if (!images.has(name)) {
        const img = new Image();
        img.onload = () => { if (app.canvas?.setDirty) app.canvas.setDirty(true, true); };
        // 同名覆写下加时间戳防浏览器缓存旧图
        img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
        images.set(name, img);
      }
      return images.get(name);
    };
    const roundedPath = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    const drawPreview = (node, ctx) => {
      const name = node.properties?.manyingPreview;
      if (!name || node.flags?.collapsed) return;
      const img = ensureImage(name);
      if (!img || !img.complete || !img.naturalWidth) return; // 未载/404=不画
      const w = node.size[0] - PAD * 2;
      const h = PREVIEW_H;
      const x = PAD;
      const y = node.size[1] - h - PAD;
      ctx.save();
      roundedPath(ctx, x, y, w, h, 8);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.25)"; // letterbox 底色,与深色节点同调
      ctx.fillRect(x, y, w, h);
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
      roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
      onDrawBackground?.apply(this, arguments);
      drawPreview(this, ctx);
    };
  },
});

// ── 环节节点富内容自绘 v3(09-12 用户终裁×2:内容全量**+功能完备+精致**)──
// v3 增量:①动作按钮行(老画布节点按钮回流:生成导演规划/生成分镜表=付费金,
// 一键生图/一键生成所有视频/重建轨道;点击→bridge_actions→宿主老画布同款
// 派发器);②精致化(标题带/斑马行/磁贴描边/预览标题胶囊/按钮态)。
// 载荷=生成器写进 properties.manyingStage(v2:全量正文行/缩略图 tiles/表行/
// 逐镜双状态/资产分组/轨道全列);布局标尺与生成器 STAGE_METRICS 同源
// (headerTop=150,contentTop=218,lineH=15,tileH=100,tilesPerRow=6)。
// collapsed 或无载荷=不画(旧文件优雅退化,原生 widget 照常)。
app.registerExtension({
  name: "manying.stage.render",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ManyingStage") return;
    const STAGE_COLORS = {
      ready: THEME.ok, pending: THEME.pending, empty: THEME.idle, warning: "#e06c75",
    };
    const PAID_GOLD = "#e6b054"; // 付费云端动作(--paid 亮档,画布深底可读)
    const HEADER_TOP = 150;
    const CONTENT_TOP = 218;
    const LINE_H = 15;
    const TILE_H = 100;
    const TILES_PER_ROW = 6;
    const ACTION_ROW_H = 44; // 与生成器 STAGE_METRICS.actionRowH 同源
    const SKILL_ROW_H = 20;  // 技能芯片行(v4)
    const ASSET_CARD_H = 76; // 资产卡行高(v4:64 卡 + 12 间距)
    const ASSETS_PER_ROW = 3;
    const stageImages = new Map(); // filename -> {img, tries}(缩略图缓存+限次重试)
    const ensureStageImage = (name) => {
      if (!stageImages.has(name)) {
        const img = new Image();
        const entry = { img, tries: 0 };
        img.onload = () => { if (app.canvas?.setDirty) app.canvas.setDirty(true, true); };
        // 09-12 真跑根修兜底:引擎就绪瞬保鲜链补传,文件可能晚于画布首绘到——
        // 404 不永久留白:2.5s 后换缓存戳重试,至多 3 次;仍败=占位(best-effort 契约)
        img.onerror = () => {
          entry.tries += 1;
          if (entry.tries <= 3 && stageImages.get(name) === entry) {
            setTimeout(() => {
              if (stageImages.get(name) === entry) {
                img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
              }
            }, 2500);
          }
        };
        img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
        stageImages.set(name, entry);
      }
      return stageImages.get(name).img;
    };
    const roundBox = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    nodeType.prototype.onDrawBackground = function (ctx) {
      const payload = this.properties?.manyingStage;
      if (!payload || this.flags?.collapsed) return;
      const w = this.size[0] - 10;
      const bottom = this.size[1] - 6;
      if (bottom - CONTENT_TOP < 40) return;
      const statusColor = STAGE_COLORS[payload.status] || THEME.idle;
      ctx.save();
      try {
        // ── 头区:左缘状态色条+标题+状态点文案+导出徽章+描述+指标芯片 ──
        // 精致化:头区衬带(标题/状态/描述/指标的整块底,浅圆角)
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        roundBox(ctx, 10, HEADER_TOP - 10, w - 8, CONTENT_TOP - HEADER_TOP - 2, 8);
        ctx.fill();
        ctx.fillStyle = statusColor;
        roundBox(ctx, 6, HEADER_TOP - 8, 3.5, bottom - HEADER_TOP + 6, 2);
        ctx.fill();
        let y = HEADER_TOP;
        ctx.font = "600 13px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillText(String(payload.title || ""), 14, y + 10);
        ctx.font = "10px sans-serif";
        const statusText = String(payload.statusText || "");
        const stWidth = ctx.measureText(statusText).width;
        ctx.fillStyle = statusColor;
        ctx.fillText(statusText, w - stWidth, y + 10);
        ctx.beginPath();
        ctx.arc(w - stWidth - 7, y + 6.5, 3, 0, Math.PI * 2);
        ctx.fill();
        if (payload.finalExport) {
          ctx.fillStyle = THEME.accent;
          ctx.fillText("已导出成片", w - stWidth - 74, y + 10);
        }
        y += 22;
        ctx.font = "10px sans-serif";
        ctx.fillStyle = THEME.text2;
        ctx.fillText(String(payload.description || "").slice(0, 40), 14, y + 8);
        y += 20;
        let x = 14;
        for (const metric of (payload.metrics || []).slice(0, 4)) {
          const label = String(metric);
          const chipWidth = ctx.measureText(label).width + 12;
          if (x + chipWidth > w - 4) break;
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          roundBox(ctx, x, y, chipWidth, 16, 4);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.78)";
          ctx.fillText(label, x + 6, y + 11.5);
          x += chipWidth + 6;
        }
        // ── 内容框(裁剪安全:生成器已按内容定高,这里 clip 兜底) ──
        const boxTop = CONTENT_TOP;
        const boxHeight = bottom - boxTop - 2;
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        roundBox(ctx, 12, boxTop, w - 6, boxHeight, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.save();
        roundBox(ctx, 12, boxTop, w - 6, boxHeight, 8);
        ctx.clip();
        const innerX = 20;
        const innerW = w - 6 - 16;
        let iy = boxTop + 15;
        if (payload.previewTitle) {
          ctx.font = "600 9px sans-serif";
          const pillW = ctx.measureText(payload.previewTitle).width + 12;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          roundBox(ctx, innerX - 4, iy - 10, pillW, 14, 7);
          ctx.fill();
          ctx.fillStyle = THEME.text2;
          ctx.fillText(payload.previewTitle, innerX + 2, iy);
          iy += 16;
        }
        // 参与技能芯片(v4 老画布 skills 徽标;超出右缘截断)
        if (Array.isArray(payload.skills) && payload.skills.length > 0) {
          let sx = innerX;
          ctx.font = "9px sans-serif";
          for (const skillName of payload.skills) {
            const label = String(skillName);
            const chipW = ctx.measureText(label).width + 14;
            if (sx + chipW > innerX + innerW) break;
            ctx.fillStyle = THEME.accentDim;
            roundBox(ctx, sx, iy - 9, chipW, 14, 7);
            ctx.fill();
            ctx.strokeStyle = "rgba(110,168,254,0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = THEME.accent;
            ctx.fillText(label, sx + 7, iy + 1);
            sx += chipW + 6;
          }
          iy += SKILL_ROW_H;
        }
        if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
          // 分镜 tiles:6 列缩略图格(84 图+标题;缺图=深底占位+态点)
          const cellW = innerW / TILES_PER_ROW;
          for (let i = 0; i < payload.tiles.length; i += 1) {
            const tile = payload.tiles[i];
            const col = i % TILES_PER_ROW;
            const row = Math.floor(i / TILES_PER_ROW);
            const cx = innerX + col * cellW;
            const cy = boxTop + 10 + row * TILE_H;
            const imgW = cellW - 10;
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            roundBox(ctx, cx, cy, imgW, 84, 6);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 1;
            ctx.stroke();
            const img = tile.preview ? ensureStageImage(tile.preview) : null;
            if (img && img.complete && img.naturalWidth) {
              const scale = Math.min(imgW / img.naturalWidth, 84 / img.naturalHeight);
              const dw = img.naturalWidth * scale;
              const dh = img.naturalHeight * scale;
              ctx.drawImage(img, cx + (imgW - dw) / 2, cy + (84 - dh) / 2, dw, dh);
            } else {
              ctx.font = "600 12px sans-serif";
              ctx.fillStyle = THEME.text2;
              const idx = `#${tile.index}`;
              ctx.fillText(idx, cx + (imgW - ctx.measureText(idx).width) / 2, cy + 46);
            }
            const dot = tile.hasVideo ? THEME.accent : tile.hasImage ? THEME.ok : THEME.idle;
            ctx.fillStyle = dot;
            ctx.beginPath();
            ctx.arc(cx + imgW - 8, cy + 8, 3.5, 0, Math.PI * 2);
            ctx.fill();
            if (tile.state) {
              ctx.font = "8px sans-serif";
              ctx.fillStyle = THEME.text2;
              const st = String(tile.state).slice(0, 6);
              const stw = ctx.measureText(st).width;
              ctx.fillText(st, cx + imgW - stw - 4, cy + 79);
            }
            ctx.font = "9px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.fillText(`#${tile.index} ${tile.title}`, cx + 3, cy + 97, imgW - 6);
            if (tile.lines) {
              ctx.font = "8px sans-serif";
              ctx.fillStyle = THEME.text2;
              ctx.fillText(tile.lines, cx + 3, cy + 108, imgW - 6);
            }
          }
        } else if (Array.isArray(payload.tableRows) && payload.tableRows.length > 0) {
          // 分镜表行:#N 场景 · 描述 · 景别 · 时长
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.tableRows.length; ri += 1) {
            const row = payload.tableRows[ri];
            const twoLine = Boolean(row.lines || row.sound || row.assets);
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, twoLine ? LINE_H * 2 + 2 : LINE_H);
            }
            // 首行:镜号/场景/描述/景别·运镜/时长
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillText(`#${String(row.index).padStart(2, "0")}`, innerX, iy);
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillText(row.scene, innerX + 34, iy);
            ctx.fillText(row.title, innerX + 108, iy);
            const right = [
              [row.shotSize, row.cameraMove].filter(Boolean).join("·"),
              row.duration ? `${row.duration}s` : "",
            ].filter(Boolean).join(" · ");
            ctx.fillStyle = THEME.text2;
            const rw = ctx.measureText(right).width;
            ctx.fillText(right, innerX + innerW - rw, iy);
            iy += LINE_H;
            // 次行:台词(斜灰)/表演/声音/关联资产
            if (twoLine) {
              ctx.font = "10px sans-serif";
              ctx.fillStyle = "rgba(255,255,255,0.6)";
              const sub = [
                row.lines ? `“${row.lines}”` : "",
                row.action,
                row.sound,
                row.assets ? `【${row.assets}】` : "",
              ].filter(Boolean).join("  ");
              ctx.fillText(sub, innerX + 34, iy, innerW - 40);
              iy += LINE_H + 2;
              ctx.font = "11px sans-serif";
            }
          }
        } else if (Array.isArray(payload.shots) && payload.shots.length > 0) {
          // 逐镜队列:#N 标签 + 配音/视频双状态徽章(照老画布 remotionShots)
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.shots.length; ri += 1) {
            const shotItem = payload.shots[ri];
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, LINE_H);
            }
            ctx.fillStyle = "rgba(255,255,255,0.82)";
            ctx.fillText(`#${String(shotItem.index).padStart(2, "0")} ${shotItem.label}`, innerX, iy);
            const badges = [];
            // 队列实时态(v4:渲染器进程注入;最左优先)
            if (shotItem.status === "running") {
              badges.push([`渲染中 ${Math.round((shotItem.progress ?? 0) * 100)}%`, THEME.accent]);
            } else if (shotItem.status === "failed") badges.push(["失败", "#e06c75"]);
            else if (shotItem.status === "blocked") badges.push(["阻塞", THEME.pending]);
            else if (shotItem.status === "queued") badges.push(["排队", THEME.text2]);
            if (shotItem.ttsReady) badges.push(["配音✓", THEME.ok]);
            if (shotItem.sfxReady) badges.push(["音效✓", THEME.ok]);
            if (shotItem.videoReady) badges.push(["视频✓", THEME.accent]);
            else if (shotItem.imageReady && !shotItem.status) badges.push(["待出", THEME.pending]);
            else if (!shotItem.status && !shotItem.imageReady) badges.push(["未生成", THEME.idle]);
            if (shotItem.revision > 1) badges.push([`v${shotItem.revision}`, THEME.text2]);
            if (shotItem.status === "running") {
              const pct = Math.max(0, Math.min(1, shotItem.progress ?? 0));
              const barW = 44;
              const barX = innerX + innerW - 150;
              ctx.fillStyle = "rgba(255,255,255,0.10)";
              ctx.fillRect(barX, iy - 6, barW, 4);
              ctx.fillStyle = THEME.accent;
              ctx.fillRect(barX, iy - 6, Math.round(barW * pct), 4);
            }
            let bx = innerX + innerW;
            for (let b = badges.length - 1; b >= 0; b -= 1) {
              const [text, color] = badges[b];
              ctx.fillStyle = color;
              const tw = ctx.measureText(text).width;
              bx -= tw + 10;
              ctx.fillText(text, bx, iy);
              ctx.beginPath();
              ctx.arc(bx - 5, iy - 3.5, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            iy += LINE_H;
          }
        } else if (Array.isArray(payload.assets) && payload.assets.length > 0) {
          // 资产卡(v4 老画布 assetGroups 卡片):封面缩略+名+类别+生成态,3 列
          const cardW = innerW / ASSETS_PER_ROW;
          const stageAssetImages = ensureStageImage;
          for (let ai = 0; ai < payload.assets.length; ai += 1) {
            const card = payload.assets[ai];
            const col = ai % ASSETS_PER_ROW;
            const row = Math.floor(ai / ASSETS_PER_ROW);
            const ax = innerX + col * cardW;
            const ay = boxTop + 10 + row * ASSET_CARD_H;
            if (ay + 64 > boxTop + boxHeight - 4) break;
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            roundBox(ctx, ax, ay, cardW - 10, 64, 8);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 1;
            ctx.stroke();
            const cover = card.cover ? stageAssetImages(String(card.cover)) : null;
            if (cover && cover.complete && cover.naturalWidth) {
              const sc = Math.min(52 / cover.naturalWidth, 52 / cover.naturalHeight);
              const cw = cover.naturalWidth * sc;
              const ch = cover.naturalHeight * sc;
              ctx.save();
            roundBox(ctx, ax + 6, ay + 6, 52, 52, 6);
            ctx.clip();
            ctx.drawImage(cover, ax + 6 + (52 - cw) / 2, ay + 6 + (52 - ch) / 2, cw, ch);
            ctx.restore();
            } else {
              ctx.fillStyle = "rgba(255,255,255,0.06)";
            roundBox(ctx, ax + 6, ay + 6, 52, 52, 6);
            ctx.fill();
              ctx.font = "600 14px sans-serif";
              ctx.fillStyle = THEME.text2;
              ctx.fillText(String(card.name || "?").slice(0, 1), ax + 26, ay + 36);
            }
            ctx.font = "600 10px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.88)";
            ctx.fillText(String(card.name || "").slice(0, 8), ax + 64, ay + 20, cardW - 78);
            ctx.font = "8px sans-serif";
            ctx.fillStyle = THEME.text2;
            ctx.fillText(String(card.typeLabel || ""), ax + 64, ay + 32, cardW - 78);
            if (card.state) {
              const stateColor = card.state === "生成失败" ? "#e06c75"
                : card.state === "已完成" ? THEME.ok
                : card.state === "生成中" ? THEME.pending : THEME.text2;
              ctx.fillStyle = stateColor;
              ctx.fillText(String(card.state), ax + 64, ay + 46, cardW - 78);
            }
          }
        } else if (payload.assetGroups) {
          // 资产分组:角色/场景/道具名全列(两名一行,照老画布资产预览)
          const groups = [
            ["角色", payload.assetGroups.characters],
            ["场景", payload.assetGroups.scenes],
            ["道具", payload.assetGroups.props],
          ];
          for (const [label, names] of groups) {
            ctx.font = "600 9px sans-serif";
            ctx.fillStyle = THEME.text2;
            ctx.fillText(`${label} ${names.length}`, innerX, iy);
            iy += 14;
            ctx.font = "11px sans-serif";
            if (names.length === 0) {
              ctx.fillStyle = THEME.idle;
              ctx.fillText("—", innerX, iy);
              iy += LINE_H;
            }
            for (let i = 0; i < names.length; i += 2) {
              ctx.fillStyle = "rgba(255,255,255,0.8)";
              ctx.fillText(names.slice(i, i + 2).join(" · "), innerX, iy);
              iy += LINE_H;
            }
            iy += 4;
          }
        } else if (Array.isArray(payload.tracks) && payload.tracks.length > 0) {
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.tracks.length; ri += 1) {
            const track = payload.tracks[ri];
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, LINE_H);
            }
            ctx.fillStyle = "rgba(255,255,255,0.82)";
            const trackBits = [
              track.name,
              track.count > 0 ? `${track.count} 镜` : "",
              track.mediaCount > 0 ? `${track.mediaCount} 素材` : "",
              track.duration > 0 ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, "0")}` : "",
            ].filter(Boolean).join(" · ");
            ctx.fillText(trackBits, innerX, iy);
            if (track.state) {
              ctx.fillStyle = track.state === "ready" ? THEME.ok : THEME.text2;
              const tw = ctx.measureText(track.state).width;
              ctx.fillText(track.state, innerX + innerW - tw, iy);
            }
            iy += LINE_H;
          }
        } else {
          // 正文全量行(生成器已换行,≤60 行)
          ctx.font = "11px sans-serif";
          for (const line of (payload.previewLines || [])) {
            ctx.fillStyle = "rgba(255,255,255,0.78)";
            ctx.fillText(String(line), innerX, iy);
            iy += LINE_H;
          }
        }
        ctx.restore();
        // ── 动作按钮行(老画布节点按钮回流;点击→bridge_actions→宿主) ──
        const actions = payload.actions || [];
        const rects = [];
        if (actions.length > 0) {
          const rowY = bottom - ACTION_ROW_H + 8;
          let bx = 14;
          for (const action of actions) {
            ctx.font = "600 11px sans-serif";
            const label = String(action.label || action.kind);
            const bw = Math.min(ctx.measureText(label).width + 26, w - 20);
            const disabled = Boolean(action.disabled);
            if (bx + Math.min(ctx.measureText(String(action.label || action.kind)).width + 26, w - 20) > w - 8) break; // 行宽守卫(多按钮拓展)
            const flash = this.__manyingActionFlash
              && this.__manyingActionFlash.kind === action.kind
              && Date.now() < this.__manyingActionFlash.until;
            const base = action.paid ? PAID_GOLD : THEME.accent;
            ctx.globalAlpha = disabled ? 0.32 : 1;
            ctx.fillStyle = action.paid ? "rgba(230,176,84,0.12)" : THEME.accentDim;
            roundBox(ctx, bx, rowY, bw, 27, 7);
            ctx.fill();
            ctx.strokeStyle = disabled ? "rgba(255,255,255,0.12)" : base + (action.paid ? "99" : "88");
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = disabled ? THEME.text2 : base;
            const tw = ctx.measureText(label).width;
            ctx.fillText(label, bx + (bw - tw) / 2, rowY + 17.5);
            if (flash) {
              ctx.strokeStyle = base;
              ctx.lineWidth = 2;
              roundBox(ctx, bx - 2, rowY - 2, bw + 4, 31, 9);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            rects.push({ x: bx, y: rowY, w: bw, h: 27, kind: action.kind, disabled });
            bx += bw + 8;
          }
        }
        this.__manyingActionRects = rects;
      } finally {
        ctx.restore();
      }
    };
    // 命中:按钮区点击→提交 bridge 动作(宿主消费走老画布同款派发器)。
    // litegraph 以节点本地坐标调 onMouseDown;命中即消费(返回 true)。
    nodeType.prototype.onMouseDown = function (pos) {
      const rects = this.__manyingActionRects || [];
      for (const rect of rects) {
        if (rect.disabled) continue;
        if (pos && pos[0] >= rect.x && pos[0] <= rect.x + rect.w
          && pos[1] >= rect.y && pos[1] <= rect.y + rect.h) {
          this.__manyingActionFlash = { kind: rect.kind, until: Date.now() + 1200 };
          if (app.canvas?.setDirty) app.canvas.setDirty(true, true);
          fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
            method: "POST",
            headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ kind: rect.kind }),
          }).catch(() => undefined);
          return true;
        }
      }
      return false;
    };
  },
});

// ── 工作流模块模板数据过滤(09-11 用户裁定:分类按当前模块展示)──────────────
// 工作流模块(manyingScope=workflow)的工作流浏览/搜索只出现漫影库:官方核心
// 模板清单(/templates/index*.json,fileURL 无前缀)与自定义模板清单
// (/api/workflow_templates,apiURL 带 /api)响应置空;本地模型模块与外部
// 直访不装过滤(全量)。纯外挂数据层过滤:不改 ComfyUI 原生 UI/DOM;桥请求
// (BRIDGE_URL 绝对地址)与缩略图(/api/workflow_templates/<路径>)不匹配,
// 天然不受影响。幂等:每页面加载只装一次。
(function installTemplateScopeFilter() {
  if (window.__manyingTplScope) return;
  window.__manyingTplScope = true;
  const scope = manyingScope();
  if (scope !== "workflow" && scope !== "models") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (scope === "workflow") {
      // 工作流模块=漫影库单源:官方核心/自定义模板清单置空(原行为)
      if (/^\/templates\/index(\.[A-Za-z-]+)?\.json(\?|$)/.test(url)) {
        return Promise.resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
      }
      if (/^\/api\/workflow_templates(\?|$)/.test(url)) {
        return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } }));
      }
    }
    if (scope === "models" && isUserDataWorkflowListUrl(url)) {
      // 本地模型模块:userdata 工作流树剔除分镜产线条目(策略单源,
      // 判定/路径归一都在 manying_module_policy.js;v1 数组/v2 items 两形态)
      return originalFetch(input, init).then(async (response) => {
        try {
          const body = await response.clone().json();
          const pass = (entries) => filterUserDataWorkflowEntries(entries);
          let patched = null;
          if (Array.isArray(body)) {
            patched = pass(body);
          } else if (body && Array.isArray(body.items)) {
            patched = { ...body, items: pass(body.items) };
          }
          if (patched === null) return response;
          return new Response(JSON.stringify(patched), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return response; // 解析失败=原样直通(过滤面永不制造故障)
        }
      });
    }
    return originalFetch(input, init);
  };
  if (scope === "models") void reindexWorkflowsOnce(0);
})();

// 启动竞态补刀(09-13 实弹根修):工作流树的**首次预取**发生在扩展装载之前
// (fetch 补丁未及就位),预取缓存带着分镜条目——原生浏览器首开仍见分镜
// (persistedWorkflows=143,实弹复现)。补丁就位后经官方 workflow store 的
// syncWorkflows() 重取一次(实弹验证:143→62、分镜归零),首开即过滤后的
// 世界。纯数据面刷新零 DOM 干预;window.app 异步赋值→轮询等服,拿不到=
// 静默放弃(与主线路同款)。loadWorkflows() 不触网(只重排本地索引),勿换。
async function reindexWorkflowsOnce(attempt) {
  const svc = window.app?.extensionManager?.workflow;
  if (!svc || typeof svc.syncWorkflows !== "function") {
    if (attempt < 40) setTimeout(() => void reindexWorkflowsOnce(attempt + 1), 500);
    return;
  }
  try { await svc.syncWorkflows(); } catch (error) { /* 重取失败:保持预取态,刷新钮兜底 */ }
}
