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

function renderSidebar(container) {
  container.style.padding = "8px";
  const status = document.createElement("div");
  status.style.cssText = "font-size:11px;opacity:0.7;margin:4px 0 8px;";
  const list = document.createElement("div");
  const refresh = document.createElement("button");
  refresh.textContent = "刷新分镜列表";
  refresh.style.cssText = "width:100%;margin-bottom:8px;padding:4px 8px;cursor:pointer;";
  container.append(refresh, status, list);

  const load = async () => {
    status.textContent = "加载分镜…";
    list.innerHTML = "";
    try {
      const data = await fetchShots();
      const shots = data.shots || [];
      if (shots.length === 0) {
        status.textContent = "漫影里还没有分镜(打开漫影分镜面板后自动推送)";
        return;
      }
      const stale = data.updatedAt && Date.now() - data.updatedAt > (data.staleAfterMs || 900000);
      status.textContent = `${shots.length} 个分镜${stale ? "(快照较旧,打开漫影画布页刷新)" : ""}`;
      for (const shot of shots) {
        const row = document.createElement("button");
        row.textContent = shot.label || shot.id;
        row.title = `点击回填到选中的成图回写节点:${shot.id}`;
        row.style.cssText = [
          "display:block", "width:100%", "text-align:left", "margin:2px 0",
          "padding:5px 8px", "cursor:pointer", "border-radius:4px",
          "border:1px solid rgba(128,128,128,0.35)", "background:transparent",
          "color:inherit", "font-size:12px", "overflow:hidden", "text-overflow:ellipsis",
          "white-space:nowrap",
        ].join(";");
        row.onmouseenter = () => { row.style.background = "rgba(128,128,128,0.2)"; };
        row.onmouseleave = () => { row.style.background = "transparent"; };
        row.onclick = () => {
          const result = applyShotToSelection(shot.id, shot.label || shot.id);
          status.textContent = result.message;
          status.style.color = result.ok ? "" : "#e06c75";
        };
        list.append(row);
      }
    } catch (error) {
      status.textContent = `取不到分镜(${error.message || error});请确认漫影软件在运行`;
    }
  };
  refresh.onclick = () => void load();
  void load();
}

app.registerExtension({
  name: "manying.sidebar",
  async setup() {
    // 新版前端侧栏 API(官方 sidebar 扩展,自定义 DOM 渲染);旧版无此面=静默跳过
    if (app.extensionManager?.registerSidebarTab) {
      app.extensionManager.registerSidebarTab({
        id: "manying.shots",
        icon: "list",
        title: "漫影 分镜",
        tooltip: "分镜列表:点选回填成图回写目标",
        render: renderSidebar,
      });
    }
  },
});
