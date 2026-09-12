// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 老画布节点模型 → ComfyUI 环节节点载荷 映射器(09-12 内容全量补全)。
 *
 * 真源=viewModel.productionFlowNodes(ProductionFlowNodeModel[],含技能/
 * 资产卡/逐镜队列进度/工作台轨道/渲染器降级链——hook 层数据,lib 同步链
 * 够不着);本映射器在组件层把这些全量转进 StageNodePayload,metrics 与
 * actions 逐字透传=与老画布 100% 同口径。autoOpen 与保鲜链共用。
 */
import type { ProductionFlowNodeModel } from "../../studio/workflow-node-model-schema";
import { shotPreviewName } from "@/lib/assist/image-studio/storyboard-overview-comfy";
import type { StageNodePayload, PipelineStageKey } from "@/lib/assist/image-studio/storyboard-pipeline-comfy";

const PREVIEW_LINE_CHARS = 50;
const PREVIEW_MAX_LINES = 60;
const STATUS_TEXT: Record<StageNodePayload["status"], string> = {
  ready: "已完成",
  pending: "进行中",
  empty: "未开始",
  warning: "有失败",
};

function wrapLines(lines: string[]): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    const text = String(line ?? "");
    if (!text.trim()) continue;
    for (let i = 0; i < text.length && wrapped.length < PREVIEW_MAX_LINES - 1; i += PREVIEW_LINE_CHARS) {
      wrapped.push(text.slice(i, i + PREVIEW_LINE_CHARS));
    }
  }
  if (wrapped.length >= PREVIEW_MAX_LINES - 1) wrapped.push("…正文较长已截断 · 进阶段面板看全文");
  return wrapped.length > 0 ? wrapped : ["暂无内容"];
}

function safePreviewName(id: string): string {
  return `manying-shot-${id.replace(/[^A-Za-z0-9._-]+/g, "_")}.jpg`;
}

/** ProductionFlowNodeModel[] → StageNodePayload[](七环节逐字段映射) */
export function mapProductionFlowNodesToStagePayloads(nodes: ProductionFlowNodeModel[]): StageNodePayload[] {
  const byKey = new Map(nodes.map((node) => [node.id as PipelineStageKey, node]));
  const keys: PipelineStageKey[] = [
    "script", "scriptPlan", "assets", "storyboardTable", "storyboard", "remotionProduction", "workbench",
  ];
  return keys.flatMap((key): StageNodePayload[] => {
    const node = byKey.get(key);
    if (!node) return [];
    return [{
      key,
      title: node.label,
      description: node.description,
      status: node.status as StageNodePayload["status"],
      statusText: STATUS_TEXT[node.status as StageNodePayload["status"]] ?? node.status,
      metrics: node.metrics.map(String),
      ...(node.previewTitle ? { previewTitle: node.previewTitle } : {}),
      ...(node.previewLines?.length ? { previewLines: wrapLines(node.previewLines) } : {}),
      ...(node.skills?.length ? { skills: node.skills.map((skill) => skill.name) } : {}),
      ...(key === "storyboard" && node.storyboardTiles ? {
        tiles: node.storyboardTiles.map((tile) => ({
          index: tile.index,
          title: (tile.title || `分镜 ${tile.index}`).slice(0, 12),
          preview: tile.id ? safePreviewName(tile.id) : undefined,
          hasImage: Boolean(tile.mediaPath),
          hasVideo: false,
          ...(tile.lines ? { lines: String(tile.lines).slice(0, 12) } : {}),
          ...(tile.state ? { state: String(tile.state) } : {}),
        })),
      } : {}),
      ...(key === "remotionProduction" && node.remotionShots ? {
        shots: node.remotionShots.map((shot) => ({
          index: shot.index,
          label: (shot.title || `分镜 ${shot.index}`).slice(0, 20),
          videoReady: shot.status === "succeeded" && Boolean(shot.outputPath),
          imageReady: Boolean(shot.mediaPath),
          ttsReady: shot.ttsStatus === "ready",
          sfxReady: shot.sfxStatus === "ready",
          revision: Math.max(1, shot.revision ?? 1),
          ...(shot.status !== "pending" ? { status: shot.status } : {}),
          ...(typeof shot.progress === "number" ? { progress: shot.progress } : {}),
        })),
      } : {}),
      ...(key === "assets" && node.assetGroups ? {
        assets: node.assetGroups.flatMap((group) =>
          [group.source, ...group.derived].map((card) => ({
            name: card.name,
            typeLabel: card.typeLabel,
            views: 1,
            ...(card.mediaPath || card.sourceImagePath ? { cover: card.mediaPath || card.sourceImagePath } : {}),
            ...(card.generationState ? { state: card.generationState } : {}),
          })),
        ),
      } : {}),
      ...(key === "workbench" && node.workbenchTracks ? {
        tracks: node.workbenchTracks.map((track) => ({
          name: (track.prompt || track.id).slice(0, 24),
          state: String(track.state),
          count: track.storyboardCount,
          mediaCount: track.mediaCount,
          ...(typeof track.videoCount === "number" ? { videoCount: track.videoCount } : {}),
          duration: Math.round(track.duration || 0),
        })),
      } : {}),
      ...(key === "workbench" ? {
        finalExport: Boolean(node.finalExportPath),
        ...(node.rendererSummary?.actual || node.rendererSummary?.requested ? {
          rendererLabel: node.rendererSummary.actual
            ? `${node.rendererSummary.lastRequested ?? node.rendererSummary.requested} → ${node.rendererSummary.actual}`
            : String(node.rendererSummary.requested),
        } : {}),
        ...(node.remotionQueueConcurrency ? { concurrency: node.remotionQueueConcurrency } : {}),
      } : {}),
      ...(node.actions?.length ? {
        actions: node.actions.map((action) => ({
          kind: action.id,
          label: action.label,
          ...(action.paid ? { paid: true } : {}),
          ...(action.disabled ? { disabled: true } : {}),
        })),
      } : {}),
    }];
  });
}

export { shotPreviewName };
