// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节节点全文文档构建器(09-13 用户裁定:每一型节点都要「查看完全」)。
 * 纯函数、零 React、零 store——NodeDocViewer 只做弹窗壳;本模块是全文内容
 * 的唯一组装点,截断在这里无处存在(全量进 md,滚动/缩放交给弹窗)。
 */
import type { StudioFlowData } from "@/lib/studio/studio-flow-data";
import type { ProductionFlowNodeModel } from "./workflow-node-model-schema";

/** 数据包装标签剥除(scriptPlan/storyboardTable/script 原始 TextPreview 包裹,
 * 不剥会渲染成可见文本——NodeDocViewer 旧逻辑同款,收编单源) */
function stripWrapperTags(text: string): string {
  return String(text || "").replace(/<\/?(?:scriptPlan|storyboardTable|script)>\s*/g, "").trim();
}

function buildAssetsDoc(flowData: StudioFlowData): string {
  const groups: Array<[string, string]> = [
    ["character", "角色"],
    ["scene", "场景"],
    ["prop", "道具"],
  ];
  const sections = groups.map(([type, label]) => {
    const items = flowData.assets.filter((asset) => asset.type === type);
    if (!items.length) return "";
    const lines = items.map((asset) =>
      `- **${asset.name}**${asset.note ? `：${asset.note}` : ""}`,
    );
    return `## ${label}（${items.length}）\n\n${lines.join("\n")}`;
  }).filter(Boolean);
  return sections.length ? sections.join("\n\n") : "暂无衍生资产";
}

function buildStoryboardDoc(flowData: StudioFlowData): string {
  const shots = flowData.storyboard;
  if (!shots.length) return "暂无分镜内容";
  const sections = shots.map((shot) => {
    const head = `### S${String(shot.index).padStart(2, "0")}${shot.duration ? ` · ${shot.duration}s` : ""}`;
    const parts = [
      shot.videoDesc ? `画面：${shot.videoDesc}` : "",
      shot.lines ? `台词：「${shot.lines}」` : "",
      shot.prompt ? `提示词：${shot.prompt}` : "",
    ].filter(Boolean);
    return `${head}\n\n${parts.join("\n\n")}`;
  });
  return `## 分镜全文（${shots.length} 镜）\n\n${sections.join("\n\n")}`;
}

function buildShotsDoc(node: Pick<ProductionFlowNodeModel, "id" | "remotionShots">): string {
  const shots = node.remotionShots ?? [];
  if (!shots.length) return "暂无单镜视频生产数据";
  const statusText: Record<string, string> = {
    succeeded: "✅ 完成", running: "🔄 渲染中", failed: "❌ 失败",
    pending: "⏳ 排队", canceled: "🚫 已取消", blocked: "⛔ 阻塞",
  };
  const lines = shots.map((shot) => {
    const bits = [
      statusText[shot.status] ?? shot.status,
      shot.ttsStatus ? `配音:${shot.ttsStatus}` : "",
      shot.sfxStatus ? `音效:${shot.sfxStatus}` : "",
      shot.revision && shot.revision > 1 ? `v${shot.revision}` : "",
      shot.error ? `（${shot.error}）` : "",
    ].filter(Boolean);
    return `- **#${String(shot.index).padStart(2, "0")} ${shot.title}** — ${bits.join(" · ")}`;
  });
  return `## 单镜视频生产（${shots.length} 镜）\n\n${lines.join("\n")}`;
}

function buildWorkbenchDoc(flowData: StudioFlowData): string {
  const tracks = flowData.workbench.tracks;
  if (!tracks.length) return "暂无视频工作台轨道";
  const lines = tracks.map((track) => {
    const bits = [
      track.duration ? `${track.duration}s` : "",
      track.state || "",
      track.storyboardIds?.length ? `关联分镜 ${track.storyboardIds.length}` : "",
      track.medias?.length ? `产物 ${track.medias.length}` : "",
    ].filter(Boolean);
    return `- **${track.id}** — ${bits.join(" · ")}${track.prompt ? `\n  ${track.prompt}` : ""}`;
  });
  return `## 视频工作台轨道（${tracks.length}）\n\n${lines.join("\n")}`;
}

/** 环节 id → 全文 markdown(storyboardTable 走查看器 TableRender 平铺表,
 * 此处 md 为其兜底;七型全覆盖,无截断路径) */
export function buildNodeDocMarkdown(
  node: Pick<ProductionFlowNodeModel, "id" | "remotionShots">,
  flowData: StudioFlowData,
): string {
  switch (node.id) {
    case "script":
      return stripWrapperTags(flowData.script) || "暂无剧本内容";
    case "scriptPlan":
      return stripWrapperTags(flowData.scriptPlan) || "暂无导演规划";
    case "assets":
      return buildAssetsDoc(flowData);
    case "storyboardTable":
      return stripWrapperTags(flowData.storyboardTable) || "暂无分镜表";
    case "storyboard":
      return buildStoryboardDoc(flowData);
    case "remotionProduction":
      return buildShotsDoc(node as ProductionFlowNodeModel);
    case "workbench":
      return buildWorkbenchDoc(flowData);
    default:
      return "暂无内容";
  }
}
