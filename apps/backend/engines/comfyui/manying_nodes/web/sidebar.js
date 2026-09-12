// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 漫影业务侧栏(sidebar 模块,09-13 模块拆分):分镜阶段/工作流单页签
 * (模块分野)+dock「模型」入口隐藏+品牌龙徽置顶(外挂 DOM)。
 */

import {
  BRIDGE_URL, BRIDGE_TOKEN, fetchShots, applyShotToSelection, manyingScope,
  fetchJson, postJson, THEME, icon, ICONS, sectionLabel, statusBadge,
  progressBar, collapseGroup, actionButton, paneStatus,
} from "./theme.js";
import { MANYING_STORE_BASE, openWorkflowSingleInstance, cleanupLegacyUnsavedTabs } from "./open-workflow.js";
import { filterWorkflowsForScope } from "./manying_module_policy.js";

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

export { renderShotsPane, renderWorkflowsPane, renderSidebar };
