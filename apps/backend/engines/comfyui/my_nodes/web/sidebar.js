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
} from "./theme.js";
import { MY_STORE_BASE, openWorkflowSingleInstance, cleanupLegacyUnsavedTabs } from "./open-workflow.js";
import { filterWorkflowsForScope } from "./my_module_policy.js";

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
        openBadges.push([`${MY_STORE_BASE}${item.id}`, badge]);
        flowList.append(myWorkflowRow(item, flowStatus, badge));
      }
      syncOpenBadges(openBadges);
    })
    .catch((error) => {
      flowStatus.textContent = `取不到工作流(${error.message || error});请确认漫影软件在运行`;
    });
  // 「已打开」徽章随标签开关实时亮灭(store 订阅;每页签渲染只挂一次)
  const svcStore = window.app?.extensionManager?.workflow;
  if (svcStore?.$subscribe && !pane.dataset.myOpenSub) {
    pane.dataset.myOpenSub = "1";
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
async function openMyWorkflow(id, status) {
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
function myWorkflowRow(item, status, badgeEl) {
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
  // 09-14 用户裁定:本地模型模块不做全库浏览(36 个工作流树对生图无意义,
  // 「本地模型工作流库」标题与计数行一并退役);只列漫影 K2 生图直达——
  // K2图像 文生图/图生图 夹内的 MY-K2 自研流(行点击=画布打开,协议复用)
  pane.append(sectionLabel("漫影 K2 生图", ICONS.folderOpen));
  const status = paneStatus("加载工作流…");
  const host = document.createElement("div");
  host.style.cssText = "display:flex;flex-direction:column;";
  pane.append(status, host);
  try {
    // light=1:跳过逐文件 JSON 解析(海量库性能,09-12 桥新增参数)
    const data = await fetchJson(`${BRIDGE_URL}/comfy/workflows?light=1`);
    // 09-14 工作流存放架构:静态自研 MY- 真源=仓库(repo: 前缀,只读);
    // 引擎家=用户区(漫影/ 前缀,分镜产线 D3 过渡仍在)。两形态并收。
    const items = filterWorkflowsForScope((data.workflows || []).filter((item) =>
      item.id && /^(repo:|漫影\/)1_图片\/K2图像\/(1_文生图|2_图生图)\/MY-K2-[^/]+\.json$/.test(item.id)), myScope());
    if (items.length === 0) {
      status.textContent = "还没有漫影 K2 生图工作流";
      return;
    }
    items.sort((a, b) => String(a.id).localeCompare(String(b.id), "zh"));
    for (const item of items) {
      const row = myWorkflowRow(item, status);
      row.style.margin = "2px 0 2px 12px";
      host.append(row);
    }
    status.textContent = "点击在画布打开";
  } catch (error) {
    status.textContent = `取不到工作流(${error.message || error});请确认漫影软件在运行`;
  }
}

/** 页签三·模型:引擎模型按域分组(件数+体积,多重归属各计) */
function renderSidebar(container) {
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

export { renderShotsPane, renderWorkflowsPane, renderSidebar };
