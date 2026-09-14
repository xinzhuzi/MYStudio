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
      // 仅保留加载中/错误态提示
      status.textContent = "";
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

/** 库工作流行(分镜/工作流两页签共用):标题+悬停+点击在画布打开;badgeEl=可选「已打开」徽章位 */
function myWorkflowRow(item, status, badgeEl) {
  const row = document.createElement("button");
  row.title = myTooltipsEnabled ? `点击在画布打开:${item.id}` : "";
  row.style.cssText = [
    "display:flex", "align-items:center", "gap:8px", "width:100%", "text-align:left", "padding:calc(var(--my-tree-pad, 4px) + 4px) 10px",
    "cursor:pointer", "border-radius:8px",
    `border:1px solid ${THEME.accent}44`, `background:${THEME.accentDim}`,
    `color:${THEME.accent}`, "font-size:var(--my-fs-14)", "font-weight:400",
    "overflow:hidden", "transition:filter 120ms ease,transform 80ms ease",
  ].join(";");
  row.append(icon(ICONS.clap, 16));
  const label = document.createElement("span");
  // 09-14 用户裁定:MY- 前缀是磁盘文件名标识;侧栏展示剥前缀(整树皆漫影
  // 内容,前缀在列表里冗余)。悬停 title 仍给全量真名。
  label.textContent = String(item.name || item.id.split("/").pop().replace(/\.json$/, "")).replace(/^MY-/, "");
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
  row.onclick = () => void openMyWorkflow(item.id, status);
  return row;
}

/** 「已打开」徽章(09-12 AC5):openWorkflows 命中库路径即亮绿点 */
function makeOpenBadge() {
  const badge = document.createElement("span");
  badge.style.cssText = `display:none;align-items:center;gap:4px;flex:none;font-size:var(--my-fs-10);color:${THEME.ok};`;
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
  // 09-15 用户裁定:仓库 workflows 目录结构=完整展示逻辑——侧栏一棵树原样
  // 镜像(域→功能夹→文件,编号前缀从 0 向后即顺序,不剥不改),不再拆
  // 「K2 直达区+库区」两块;区标题「漫影工作流库」不展示(树即全部)。
  // 数据=仓库 repo 真源(桥列表);行点击=画布打开。
  const status = paneStatus("加载工作流…");
  const host = document.createElement("div");
  host.style.cssText = "display:flex;flex-direction:column;";
  pane.append(status, host);
  try {
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows?light=1`);
    const items = (data.workflows || []).filter((item) =>
      item.id && String(item.id).startsWith("repo:"));
    if (items.length === 0) {
      status.textContent = "还没有漫影工作流(仓库真源为空)";
      return;
    }
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
        const fname = segs[segs.length - 1];
        if (!level.has("__files__")) level.set("__files__", []);
        level.get("__files__").push(item);
      }
      return tree;
    };
    const tree = buildTree(items);
    const renderLevel = (level, depth) => {
      const container = document.createDocumentFragment();
      for (const name of [...level.keys()].sort((a, b) => a.localeCompare(b, "zh"))) {
        if (name === "__files__") continue;
        const sub = level.get(name);
        const files = sub.get("__files__") || [];
        let count = files.length;
        const countDir = (m) => { for (const k of m.keys()) { if (k === "__files__") count += m.get(k).length; else countDir(m.get(k)); } };
        countDir(sub);
        const details = collapseGroup(name, count, { indent: Math.max(0, depth - 1), open: depth <= 1 });
        for (const item of files) {
          const row = myWorkflowRow(item, status);
          row.style.margin = "2px 0 2px 12px";
          details.append(row);
        }
        details.append(renderLevel(sub, depth + 1));
        container.append(details);
      }
      return container;
    };
    host.append(renderLevel(tree, 0));
    status.textContent = `共 ${items.length} 条 · 点击在画布打开`;
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
