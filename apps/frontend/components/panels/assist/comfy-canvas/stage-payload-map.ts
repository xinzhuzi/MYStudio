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

const STATUS_TEXT: Record<StageNodePayload["status"], string> = {
  ready: "已完成",
  pending: "进行中",
  empty: "未开始",
  warning: "有失败",
};

/** 正文→md 段落结构(09-13 用户裁定:展示完全,禁截断):源行=独立段落,
 * 空行分隔,markdown-it 引擎侧按节点宽自然回流——不再 50 字硬切+60 行截断
 * (全文档走节点「全文/编辑」弹窗,预览即全量)。 */
function wrapLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const text = String(line ?? "").trim();
    if (!text) continue;
    if (out.length > 0) out.push("");
    out.push(text);
  }
  return out.length > 0 ? out : ["暂无内容"];
}

/** 进度对(09-13 用户裁定:要做多少/已做多少;total 缺省=纯计数)——
 * 全部从节点既有数据推导,零新数据源 */
function buildProgress(
  key: PipelineStageKey,
  node: ProductionFlowNodeModel,
): { label: string; done: number; total?: number }[] {
  if (key === "storyboard" && node.storyboardTiles?.length) {
    return [{ label: "已出图", done: node.storyboardTiles.filter((t) => t.mediaPath).length, total: node.storyboardTiles.length }];
  }
  if (key === "remotionProduction" && node.remotionShots?.length) {
    const total = node.remotionShots.length;
    return [
      { label: "视频", done: node.remotionShots.filter((s) => s.status === "succeeded" && s.outputPath).length, total },
      { label: "配音", done: node.remotionShots.filter((s) => s.ttsStatus === "ready").length, total },
    ];
  }
  if (key === "storyboardTable" && node.tableRows?.length) {
    return [{ label: "分镜", done: node.tableRows.length }];
  }
  if (key === "workbench" && node.workbenchTracks?.length) {
    return [{ label: "轨道完成", done: node.workbenchTracks.filter((t) => t.state === "ready").length, total: node.workbenchTracks.length }];
  }
  return [];
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
      ...(key === "storyboardTable" && node.tableRows?.length ? {
        // 结构化两行制表行直喂引擎(零 md 回流解析;全量行,禁截断)
        tableRows: node.tableRows.map((row) => ({
          index: row.index,
          scene: row.scene,
          title: row.title,
          description: row.description,
          shotSize: row.shotSize,
          cameraMove: row.cameraMove,
          duration: row.duration,
          lines: row.lines,
          action: row.action,
          sound: row.sound,
          assets: row.associateAssetsNames.join("、"),
        })),
      } : {}),
      ...(node.skills?.length ? {
        skills: node.skills.map((skill) => skill.name),
        // 技能详情(09-13 用户裁定:胶囊可点开;名称/来源/内容摘要)
        skillDetails: node.skills.map((skill) => ({
          name: skill.name,
          source: skill.source,
          summary: skill.summaryLines?.slice(0, 6),
        })),
      } : {}),
      ...(() => {
        const progress = buildProgress(key, node);
        return progress.length ? { progress } : {};
      })(),
      ...(key === "storyboard" && node.storyboardTiles ? {
        // 全量不截断(09-13 用户裁定):磁贴文字溢出交给 CSS ellipsis
        tiles: node.storyboardTiles.map((tile) => ({
          index: tile.index,
          // 09-14 用户裁定:磁贴只放标号(原 tile.title=描述铺字,弃用)
          title: `S${String(tile.index).padStart(2, "0")}`,
          preview: tile.id ? safePreviewName(tile.id) : undefined,
          hasImage: Boolean(tile.mediaPath),
          hasVideo: false,
          ...(tile.lines ? { lines: String(tile.lines) } : {}),
          ...(tile.state ? { state: String(tile.state) } : {}),
        })),
      } : {}),
      ...(key === "remotionProduction" && node.remotionShots ? {
        shots: node.remotionShots.map((shot) => ({
          index: shot.index,
          label: shot.title || `分镜 ${shot.index}`,
          videoReady: shot.status === "succeeded" && Boolean(shot.outputPath),
          imageReady: Boolean(shot.mediaPath),
          ttsReady: shot.ttsStatus === "ready",
          sfxReady: shot.sfxStatus === "ready",
          revision: Math.max(1, shot.revision ?? 1),
          ...(shot.status !== "pending" ? { status: shot.status } : {}),
          ...(typeof shot.progress === "number" ? { progress: shot.progress } : {}),
        })),
      } : {}),
      ...(key === "assets" ? {
        actions: [
          { kind: "extract-assets", label: node.assetGroups?.length ? "重新抽取资产" : "抽取资产" },
          ...(node.actions || []).map((action) => ({
            kind: action.id, label: action.label,
            ...(action.paid ? { paid: true } : {}),
            ...(action.disabled ? { disabled: true } : {}),
          })),
        ],
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
          name: track.prompt || track.id,
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
      // assets 的 actions 由上方注入块终态产出(抽取+透传合并),通用展开
      // 让位——后展开会整体覆盖注入块,assets 节点一旦有 actions 抽取键就丢
      ...(key !== "assets" && node.actions?.length ? {
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
