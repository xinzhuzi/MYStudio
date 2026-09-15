// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 漫影业务侧栏(sidebar 模块,09-13 模块拆分):分镜阶段/工作流单页签
 * (模块分野)+dock「模型」入口隐藏+品牌龙徽置顶(外挂 DOM)。
 */

import {
  BRIDGE_URL, BRIDGE_TOKEN, fetchShots, applyShotToSelection, myScope,
  fetchJson, postJson, THEME, icon, ICONS, sectionLabel, statusBadge,
  progressBar, collapseGroup, actionButton, paneStatus,
  myTooltipsEnabled, syncMySettingsFlags,
} from "./theme.js";
import { MY_STORE_BASE, cloneGraph, openWorkflowSingleInstance, cleanupLegacyUnsavedTabs } from "./open-workflow.js";

/** 页签一·分镜:分镜工作流主线(点击即开)+原镜列表逻辑整迁(刷新+状态+点选回填) */
function renderShotsPane(pane) {
  pane.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:2px;";
  // ── 章节徽章(顶部,主色描边胶囊) ──
  const chapterPill = document.createElement("div");
  chapterPill.style.cssText = `display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:3px 10px;border-radius:999px;border:1px solid ${THEME.accent}55;background:${THEME.accentDim};color:${THEME.accent};font-size:var(--my-fs-11);font-weight:600;letter-spacing:0.02em;`;
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
  refresh.style.cssText = `display:flex;align-items:center;justify-content:center;gap:5px;width:100%;padding:6px;cursor:pointer;border-radius:8px;border:1px solid ${THEME.line};background:transparent;color:${THEME.text2};font-size:var(--my-fs-11);transition:transform 80ms ease;`;
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

  // 09-14 通用化(零文件):主线不再落库文件,主线卡退役——主线随
  // 「分镜制作」阶段进入自动打开(通用模板+当前章载荷注入),此处仅提示。
  flowStatus.textContent = "主线随「分镜制作」阶段自动打开";

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
              "color:inherit", "font-size:var(--my-fs-12)", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap",
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
async function openMyWorkflow(id, status) {
  const label = id.split("/").pop().replace(/\.json$/, "");
  try {
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows/${encodeURIComponent(id)}/content`);
    const graph = JSON.parse(data.content);
    if (window.app && typeof window.app.loadGraphData === "function") {
      // 09-14 存放架构:repo 真源流不在引擎家(单实例绑 workflows/ 库路径,
      // 引擎家无此文件→装载挂起,装机实弹 30s 不切画布)——走带名临时流
      // 直载;引擎家条目(分镜产线)保留 09-12 单实例协议(绑库复用签)
      if (id.startsWith("repo:")) {
        await window.app.loadGraphData(cloneGraph(graph), true, true, id.slice("repo:".length));
      } else {
        await openWorkflowSingleInstance({ name: id, graph });
      }
      // 09-15 用户裁定:成功反馈文案不展示(「已打开:xxx」退役)——
      // 仅保留加载中/错误态提示;成功时恢复顶栏工作流条数总览
      status.textContent = status._summaryText || "";
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

/** 分镜工作流主线判据(生成器落位「分镜/0_工作流主线/」;旧根双收防回流) */
function isMainlineWorkflow(id) {
  return (id.startsWith("分镜/0_工作流主线/") || id.startsWith("漫影/1_图片/分镜/0_工作流主线/"))
    && !id.endsWith("/.keep.json");
}


/** 「已打开」徽章(09-12 AC5):openWorkflows 命中库路径即亮绿点 */
function makeOpenBadge() {
  const badge = document.createElement("span");
  badge.style.cssText = `display:none;align-items:center;gap:4px;flex:none;margin-left:auto;font-size:var(--my-fs-10);color:${THEME.ok};`;
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
  // 满宽无空隙容器(09-15 用户铁律:布局要拓展至满控件,不要留空隙)
  pane.style.cssText = "padding:6px 6px;display:flex;flex-direction:column;gap:4px;width:100%;height:100%;flex:1;min-height:0;box-sizing:border-box;";
  const status = paneStatus("加载自研工作流…");
  status.style.padding = "0 4px";
  const host = document.createElement("div");
  host.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;width:100%;box-sizing:border-box;";
  pane.append(status, host);

  try {
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows?light=1`);
    const items = (data.workflows || []).filter((item) =>
      item.id && String(item.id).startsWith("repo:"));
    if (items.length === 0) {
      status.textContent = "还没有漫影工作流(仓库真源为空)";
      return;
    }
    const summaryText = `共 ${items.length} 条自研工作流 · 点击在画布打开`;
    status.textContent = summaryText;
    status._summaryText = summaryText;
    items.sort((a, b) => String(a.id).localeCompare(String(b.id), "zh"));

    // 按路径段建树(段名原样保留编号;目录序=编号序)
    const buildTree = (list) => {
      const tree = new Map();
      for (const item of list) {
        const segs = String(item.id).slice("repo:".length).split("/");
        let level = tree;
        for (let i = 0; i < segs.length - 1; i++) {
          if (!level.has(segs[i])) level.set(segs[i], new Map());
          level = level.get(segs[i]);
        }
        if (!level.has("__files__")) level.set("__files__", []);
        level.get("__files__").push(item);
      }
      return tree;
    };
    const tree = buildTree(items);

    // 09-15 视觉质感体系(Cinema Studio):东方影视工业水墨质感、拟物双态文件夹、
    // 自研闪电标识、独立缩进导轨(防 ComfyUI 样式劫持)、满控件行悬浮覆盖、靠右胶囊徽章
    const DOMAIN_THEMES = {
      "0_分镜": { color: "#6ea8fe", bg: "rgba(110,168,254,0.12)" },
      "1_图片": { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
      "2_视频": { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
      "3_声音": { color: "#c084fc", bg: "rgba(192,132,252,0.12)" },
    };

    let activeRowEl = null;
    const openBadges = new Map();

    const renderLevel = (level, depth, openNow, parentDomain) => {
      const ul = document.createElement("ul");
      ul.className = depth === 0 ? "my-tree-root" : "my-tree-children";
      ul.setAttribute("role", depth === 0 ? "tree" : "group");

      for (const name of [...level.keys()].filter((k) => k !== "__files__").sort((a, b) => a.localeCompare(b, "zh"))) {
        const sub = level.get(name);
        let count = (sub.get("__files__") || []).length;
        const countDir = (m) => {
          for (const [k, v] of m.entries()) {
            if (k === "__files__") count += v.length;
            else countDir(v);
          }
        };
        for (const [k, v] of sub.entries()) {
          if (k !== "__files__") countDir(v);
        }

        const domainKey = depth === 0 ? name : parentDomain;
        const theme = DOMAIN_THEMES[domainKey] || { color: THEME.accent, bg: THEME.accentDim };
        const open = depth === 0 ? openNow : false;

        const li = document.createElement("li");
        li.className = "my-tree-item";
        li.setAttribute("role", "treeitem");
        li.setAttribute("aria-expanded", String(open));

        const row = document.createElement("div");
        row.className = "my-tree-row";
        row.tabIndex = 0;

        // 独立缩进导轨 (每个深阶 14px，绝不受 ComfyUI 原生 padding !important 冲刷)
        const indent = document.createElement("span");
        indent.style.cssText = `width:${depth * 14}px;flex:none;`;

        // 折叠切换钮
        const toggler = document.createElement("button");
        toggler.type = "button";
        toggler.setAttribute("aria-label", "切换折叠");
        toggler.style.cssText = "border:none;background:transparent;color:inherit;cursor:pointer;padding:0 2px;display:inline-flex;align-items:center;flex:none;";
        const chev = icon(ICONS.chevron, 11);
        chev.style.transition = "transform 140ms ease";
        chev.style.transform = open ? "rotate(90deg)" : "";
        toggler.append(chev);

        // 拟物双态文件夹图标 (带域高光色)
        const folderIconWrap = document.createElement("span");
        folderIconWrap.style.cssText = `display:inline-flex;align-items:center;color:${theme.color};flex:none;margin-right:4px;`;
        const updateFolderIcon = (isOpen) => {
          folderIconWrap.textContent = "";
          folderIconWrap.append(icon(isOpen ? ICONS.folderOpen : ICONS.folder, 14));
        };
        updateFolderIcon(open);

        // 目录名标签
        const labelEl = document.createElement("span");
        labelEl.className = "my-tree-label";
        labelEl.textContent = name;
        labelEl.style.fontWeight = depth === 0 ? "600" : "500";
        labelEl.style.fontSize = depth === 0 ? "var(--my-fs-12)" : "var(--my-fs-11)";
        if (depth === 0) labelEl.style.color = "var(--my-text, #f1f5f9)";

        // 胶囊药丸计数徽章 (靠右排布)
        const badgeEl = document.createElement("span");
        badgeEl.className = "my-tree-badge";
        badgeEl.textContent = String(count);
        if (depth === 0) {
          badgeEl.style.background = theme.bg;
          badgeEl.style.color = theme.color;
        }

        row.append(indent, toggler, folderIconWrap, labelEl, badgeEl);

        const childrenUl = renderLevel(sub, depth + 1, open, domainKey);
        childrenUl.style.display = open ? "" : "none";

        const toggleOpen = () => {
          const willOpen = childrenUl.style.display === "none";
          childrenUl.style.display = willOpen ? "" : "none";
          chev.style.transform = willOpen ? "rotate(90deg)" : "";
          updateFolderIcon(willOpen);
          li.setAttribute("aria-expanded", String(willOpen));
        };

        toggler.onclick = (e) => { e.stopPropagation(); toggleOpen(); };
        row.onclick = toggleOpen;
        row.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); }
        };

        li.append(row, childrenUl);
        ul.append(li);
      }

      // 叶子文件节点
      for (const item of level.get("__files__") || []) {
        const li = document.createElement("li");
        li.className = "my-tree-item";
        li.setAttribute("role", "treeitem");

        const row = document.createElement("div");
        row.className = "my-tree-row";
        row.tabIndex = 0;
        row.title = `点击在画布打开: ${item.id}`;

        const indent = document.createElement("span");
        indent.style.cssText = `width:${depth * 14}px;flex:none;`;

        const spacer = document.createElement("span");
        spacer.style.cssText = "width:15px;flex:none;"; // 替代 toggler 宽度，确保图标垂直对齐

        const zapIcon = icon(ICONS.zap, 13);
        zapIcon.style.color = "#6ea8fe";
        zapIcon.style.marginRight = "4px";
        zapIcon.style.flex = "none";

        // 09-15 铁律:保留真实 MY- 前缀(文件名即展示名,仅剔除 .json 后缀)
        const rawName = String(item.name || item.id.split("/").pop()).replace(/\.json$/, "");
        const labelEl = document.createElement("span");
        labelEl.className = "my-tree-label";
        labelEl.textContent = rawName;
        labelEl.style.fontSize = "var(--my-fs-11)";

        const openBadge = makeOpenBadge();
        const relPath = String(item.id).slice("repo:".length);
        openBadges.set(relPath, openBadge);
        openBadges.set(`workflows/${relPath}`, openBadge);
        openBadges.set(item.id, openBadge);

        row.append(indent, spacer, zapIcon, labelEl, openBadge);

        const openIt = async () => {
          if (activeRowEl) activeRowEl.classList.remove("my-tree-row--active");
          row.classList.add("my-tree-row--active");
          activeRowEl = row;
          await openMyWorkflow(item.id, status);
          syncOpenBadges(openBadges);
        };

        row.onclick = openIt;
        row.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openIt(); }
        };

        li.append(row);
        ul.append(li);
      }

      return ul;
    };

    host.append(renderLevel(tree, 0, true, null));
    syncOpenBadges(openBadges);
  } catch (error) {
    status.textContent = `取不到工作流(${error.message || error});请确认漫影软件在运行`;
  }
}


/** 页签三·模型:引擎模型按域分组(件数+体积,多重归属各计) */
function renderSidebar(container) {
  container.setAttribute("data-my-ui", "1"); // 禁动画桥作用域根
  void syncMySettingsFlags(); // 渲染期刷新旗标(设置中途改动兜底)
  container.style.padding = "8px";
  // 页签按当前模块展示,任何情况都只显一签(09-12 用户裁定×2:不能一次性
  // 都展示出来)——工作流模块=分镜;本地模型模块=本地模型(09-14 用户裁定:
  // 该模块标题由「工作流」正名「本地模型」,名实相符);外部直访=分镜。
  const scope = myScope();
  const tabs = [scope === "models"
    ? { id: "workflows", label: "本地模型", render: renderWorkflowsPane }
    : { id: "shots", label: "分镜阶段", render: renderShotsPane }];
  const activeId = tabs[0].id;
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:2px;margin-bottom:6px;border-bottom:1px solid rgba(128,128,128,0.35);";
  const panes = new Map();
  const switchTab = (id) => {
    for (const [paneId, pane] of panes) pane.style.display = paneId === id ? "" : "none";
    for (const button of bar.querySelectorAll("button")) {
      const on = button.dataset.myTab === id;
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
    button.dataset.myTab = tab.id;
    button.style.cssText = [
      "flex:1", "padding:4px 6px", "cursor:pointer", "font-size:var(--my-fs-11)",
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

export { renderShotsPane, renderWorkflowsPane, renderSidebar };
