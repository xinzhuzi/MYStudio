// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 漫影共享主题与工具(theme 模块,09-13 模块拆分)。
 * 设计系统(照 apple-design/frontend-design 技能);桥接面=sidecar
 * /comfy/bridge/*;模块内容策略在 my_module_policy.js 由消费方直连。
 */

// 双读注入变量:新名 MY_* 优先,旧名 MANYING_* 兼容(装机旧 asar 注入期防漂)
// 设置旗标桥(09-15):承接 Comfy.Appearance.DisableAnimations 与 Comfy.EnableTooltips;
// app.ui 就绪后同步(侧栏 setup 里调用),失败保底全开。
export let myAnimationsEnabled = true;
export let myTooltipsEnabled = true;
export async function syncMySettingsFlags() {
  try {
    const settings = window.app?.ui?.settings;
    if (settings?.getSettingValueAsync) {
      myAnimationsEnabled = (await settings.getSettingValueAsync("Comfy.Appearance.DisableAnimations")) !== true;
      myTooltipsEnabled = (await settings.getSettingValueAsync("Comfy.EnableTooltips")) !== false;
    }
    document.documentElement.dataset.myNoAnim = myAnimationsEnabled ? "" : "1";
  } catch (error) { /* 保底全开 */ }
}

// 字体承接桥(09-15):一次性注入派生变量表(幂等)
if (typeof document !== "undefined" && !document.getElementById("my-font-bridge")) {
  const style = document.createElement("style");
  style.id = "my-font-bridge";
  style.textContent = `:root {
  /* 09-15 设置桥批次:调色板派生(基=ComfyUI 调色板变量,回落=现深色值零漂移)——
     切浅色主题时文字/线/悬停自动换相;树密度=TreeExplorer.ItemPadding 官方变量 */
  --my-text: var(--fg-color, rgba(255,255,255,0.92));
  --my-text-2: color-mix(in srgb, var(--fg-color, #ffffff) 55%, transparent);
  --my-text-dim: color-mix(in srgb, var(--fg-color, #ffffff) 35%, transparent);
  --my-text-soft: color-mix(in srgb, var(--fg-color, #ffffff) 78%, transparent);
  --my-line: color-mix(in srgb, var(--fg-color, #ffffff) 10%, transparent);
  --my-hover: color-mix(in srgb, var(--fg-color, #ffffff) 5%, transparent);
  --my-hover-2: color-mix(in srgb, var(--fg-color, #ffffff) 8%, transparent);
  --my-accent-soft: color-mix(in srgb, var(--fg-color, #ffffff) 85%, #6ea8fe 15%);
  --my-tree-pad: var(--comfy-tree-explorer-item-padding, 4px);
  --my-border: var(--border-color, var(--my-line));
  /* 09-15 字体承接桥:基=ComfyUI 设置 Comfy.TextareaWidget.FontSize
     (watcher 写入根变量 --comfy-textarea-font-size,默认10px)。派生档位
     calc 自动重算——用户改设置,漫影全部DOM字体即时跟随,零JS订阅。 */
    --my-fs-8-5: calc(var(--comfy-textarea-font-size, 10px) * 0.85);
  --my-fs-9: calc(var(--comfy-textarea-font-size, 10px) * 0.9);
  --my-fs-9-5: calc(var(--comfy-textarea-font-size, 10px) * 0.95);
  --my-fs-10: calc(var(--comfy-textarea-font-size, 10px) * 1);
  --my-fs-10-5: calc(var(--comfy-textarea-font-size, 10px) * 1.05);
  --my-fs-11: calc(var(--comfy-textarea-font-size, 10px) * 1.1);
  --my-fs-11-5: calc(var(--comfy-textarea-font-size, 10px) * 1.15);
  --my-fs-12: calc(var(--comfy-textarea-font-size, 10px) * 1.2);
  --my-fs-13: calc(var(--comfy-textarea-font-size, 10px) * 1.3);
  --my-fs-14: calc(var(--comfy-textarea-font-size, 10px) * 1.4);
  --my-fs-13: calc(var(--comfy-textarea-font-size, 10px) * 1.3);
  --my-fs-15: calc(var(--comfy-textarea-font-size, 10px) * 1.5);
  }`;
  // 禁动画桥(09-15):html[data-my-no-anim] 域内 !important 盖过内联 transition/animation
  style.textContent += '\n[data-my-no-anim="1"] [data-my-ui], [data-my-no-anim="1"] [data-my-ui] *{transition:none !important;animation:none !important;}';
  document.head.append(style);
}

const BRIDGE_URL = (window.MY_BRIDGE_URL || window.MANYING_BRIDGE_URL || "http://127.0.0.1:17595").replace(/\/$/, "");
const BRIDGE_TOKEN = window.MY_BRIDGE_TOKEN || window.MANYING_BRIDGE_TOKEN || "manying-local-image";

async function fetchShots() {
  const response = await fetch(`${BRIDGE_URL}/comfy/bridge/storyboards`, {
    headers: { "X-Manying-Image-Token": BRIDGE_TOKEN },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function applyShotToSelection(shotId, label) {
  const node = app.canvas?.selected_node;
  // 旧名 ManyingGenerated=存量画布节点兼容(09-14 manying→my 改名)
  if (!node || (node.comfyClass !== "MyGenerated" && node.comfyClass !== "ManyingGenerated")) {
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
// webview URL 参数 myScope 传入(workflow/models;外部直访=分镜)。
function myScope() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("myScope") || params.get("manyingScope");
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
  accent: "#6ea8fe",       // 漫影蓝(品牌 accent,深浅主题恒色)
  accentDim: "rgba(110,168,254,0.14)",
  ok: "#4ade80",            // 已出视频(语义色,双主题可读)
  pending: "#fbbf24",       // 待出/进行中
  // 09-15 设置桥:以下三槽=调色板派生(随 ComfyUI.ColorPalette 换相,回落=原深色值)
  idle: "var(--my-text-dim, var(--my-text-dim))",
  line: "var(--my-line, var(--my-line))",
  text2: "var(--my-text-2, var(--my-text-2))",
};

/** 东方影视设计代币系统(Cinema Tokens):环节节点磨砂质感与正方形常理尺寸规范 */
export const STAGE_SIZE_CONSTRAINTS = {
  minSize: 540,      // 紧凑正方形下限 (px)
  defaultSize: 600,  // 标准正方形基准 (px)
  largeSize: 680,    // 充实正方形档位 (px)
  maxSize: 720,      // 正常最大上限 (px)
  hardMax: 760,      // 绝对硬天花板 (px)
  targetRatio: 1.0,  // 目标宽高比 (1:1 正方形)
  maxBodyH: 480,     // 正文内滚动区最大高度 (px)
};

export const CINEMA_TOKENS = {
  glassBg: "linear-gradient(180deg, rgba(18, 24, 38, 0.78) 0%, rgba(10, 14, 24, 0.84) 100%)",
  glassBorder: "rgba(255, 255, 255, 0.09)",
  glassHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  glassShadow: "0 12px 32px -6px rgba(0, 0, 0, 0.65), 0 4px 12px rgba(0, 0, 0, 0.4)",
  glassRadius: "12px",
  status: {
    ready: { accent: "#34d399", dim: "rgba(52, 211, 153, 0.14)", border: "rgba(52, 211, 153, 0.35)", glow: "0 0 10px rgba(52, 211, 153, 0.55)" },
    running: { accent: "#fbbf24", dim: "rgba(251, 191, 36, 0.14)", border: "rgba(251, 191, 36, 0.35)", glow: "0 0 10px rgba(251, 191, 36, 0.55)" },
    warning: { accent: "#f87171", dim: "rgba(248, 113, 113, 0.14)", border: "rgba(248, 113, 113, 0.35)", glow: "0 0 10px rgba(248, 113, 113, 0.55)" },
    empty: { accent: "#94a3b8", dim: "rgba(148, 163, 184, 0.10)", border: "rgba(148, 163, 184, 0.22)", glow: "none" },
  },
  fontSans: '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontMono: 'ui-monospace, "SF Mono", Menlo, "Cascadia Code", monospace',
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
  el.style.cssText = `display:flex;align-items:center;gap:6px;font-size:var(--my-fs-10);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${THEME.text2};margin:12px 0 6px;`;
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
  el.style.cssText = `display:inline-flex;align-items:center;gap:4px;font-size:var(--my-fs-10);color:${color};flex:none;`;
  const dot = document.createElement("span");
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${color};`;
  el.append(dot, document.createTextNode(label));
  return el;
}

/** 视频进度条:翠绿流光渐变填充+计数文本 */
function progressBar(done, total) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:4px 0 2px;";
  const bar = document.createElement("div");
  bar.style.cssText = `height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.5);`;
  const fill = document.createElement("div");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.cssText = `height:100%;width:${pct}%;border-radius:3px;background:linear-gradient(90deg,#3b82f6,#34d399);box-shadow:0 0 6px rgba(52,211,153,0.6);transition:width 400ms ease;`;
  bar.append(fill);
  const label = document.createElement("div");
  label.style.cssText = `display:flex;justify-content:space-between;font-size:var(--my-fs-10);color:${THEME.text2};margin-top:3px;`;
  const left = document.createElement("span");
  left.textContent = `已出视频 ${done}/${total}`;
  const right = document.createElement("span");
  right.textContent = `${pct}%`;
  label.append(left, right);
  wrap.append(bar, label);
  return wrap;
}

/** 折叠组(两页签共用):chevron 旋转+标题+计数徽章(tone 定色) */
/** ComfyUI 图标体系桥(09-15):复用其 iconify 类(tailwind 构建期 CSS,
 * 坑1 先例=侧栏 tab 同款机制);尺寸/颜色随行内联,mask 单色随 currentColor。
 * 探测类 CSS 缺席(裸环境)则回落自绘 svg,永不空框。 */
function comfyIconify(cls, fallbackPathD, size = 14) {
  const span = document.createElement("span");
  span.className = cls;
  span.style.cssText = `display:inline-block;width:${size}px;height:${size}px;flex:none;background-color:currentColor;`;
  const fallback = icon(fallbackPathD, size);
  fallback.style.display = "none";
  const host = document.createElement("span");
  host.style.cssText = `display:inline-flex;flex:none;`;
  host.append(span, fallback);
  requestAnimationFrame(() => {
    try {
      const probe = span.cloneNode(true);
      probe.style.cssText += "position:absolute;visibility:hidden;";
      document.body.append(probe);
      const styled = getComputedStyle(probe).maskImage !== "none" || getComputedStyle(probe).backgroundImage !== "none";
      probe.remove();
      if (!styled) { span.style.display = "none"; fallback.style.display = ""; }
    } catch (error) { /* 保底显示类图标位 */ }
  });
  return host;
}

function collapseGroup(title, count, { tone, indent = 0, open = false } = {}) {
  const color = tone === "ok" ? THEME.ok : tone === "pending" ? THEME.pending : THEME.accent;
  const bg = tone === "ok" ? "rgba(74,222,128,0.15)"
    : tone === "pending" ? "rgba(251,191,36,0.15)"
    : THEME.accentDim;
  const details = document.createElement("details");
  if (open) details.open = true;
  if (indent > 0) details.style.paddingLeft = `${indent * 12}px`;
  const summary = document.createElement("summary");
  summary.style.cssText = `display:flex;align-items:center;gap:6px;padding:calc(var(--my-tree-pad, 4px) + 1px) 6px;cursor:pointer;list-style:none;font-size:var(--my-fs-14);font-weight:600;color:var(--my-text-soft);border-radius:6px;transition:background 100ms ease;`;
  summary.onmouseenter = () => { summary.style.background = "rgba(255,255,255,0.05)"; };
  summary.onmouseleave = () => { summary.style.background = ""; };
  const chev = icon(ICONS.chevron, 11);
  chev.style.transition = "transform 150ms ease";
  if (open) chev.style.transform = "rotate(90deg)";
  const text = document.createElement("span");
  text.textContent = title;
  const badge = document.createElement("span");
  badge.style.cssText = `margin-left:auto;font-size:var(--my-fs-10);font-weight:500;padding:1px 7px;border-radius:999px;background:${bg};color:${color};flex:none;`;
  badge.textContent = String(count);
  const folderIcon = comfyIconify("icon-[lucide--folder]", ICONS.folderOpen, 14);
  summary.append(chev, folderIcon, text, badge);
  details.append(summary);
  details.addEventListener("toggle", () => {
    chev.style.transform = details.open ? "rotate(90deg)" : "";
  });
  return details;
}

/** 主按钮(深蓝微光漫射)/次按钮(金属冷金微边):按压弹性反馈与立体质感 */
function actionButton({ label, iconPath, primary }) {
  const btn = document.createElement("button");
  btn.style.cssText = [
    "flex:1", "display:flex", "align-items:center", "justify-content:center", "gap:6px",
    "padding:8px 8px", "cursor:pointer", "border-radius:8px", "font-size:var(--my-fs-12)", "font-weight:600",
    primary
      ? "border:1px solid #3b82f6;background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;box-shadow:0 3px 12px rgba(59,130,246,0.35);"
      : "border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.08);color:#fbbf24;box-shadow:0 2px 8px rgba(0,0,0,0.3);",
    "transition:transform 80ms cubic-bezier(0.16,1,0.3,1),box-shadow 150ms ease,filter 120ms ease",
  ].join(";");
  btn.append(icon(iconPath, 13));
  const span = document.createElement("span");
  span.textContent = label;
  btn.append(span);
  btn.onpointerdown = () => { btn.style.transform = "scale(0.96)"; };
  btn.onpointerup = btn.onpointerleave = () => { btn.style.transform = ""; };
  btn.onmouseenter = () => {
    btn.style.filter = "brightness(1.15)";
    if (primary) btn.style.boxShadow = "0 4px 16px rgba(59,130,246,0.55)";
  };
  btn.onmouseleave = () => {
    btn.style.filter = "";
    if (primary) btn.style.boxShadow = "0 3px 12px rgba(59,130,246,0.35)";
  };
  return btn;
}

function paneStatus(text) {
  const p = document.createElement("p");
  p.style.cssText = `font-size:var(--my-fs-11);color:${THEME.text2};margin:4px 0 6px;`;
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

export {
  BRIDGE_URL, BRIDGE_TOKEN, fetchShots, applyShotToSelection, myScope,
  fetchJson, postJson, THEME, icon, ICONS, sectionLabel, statusBadge,
  progressBar, collapseGroup, actionButton, paneStatus,
};
