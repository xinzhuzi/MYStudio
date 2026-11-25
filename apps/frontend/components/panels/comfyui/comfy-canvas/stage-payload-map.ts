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
import { shotPreviewName, shotPreviewNameForId } from "@/lib/comfyui/storyboard/storyboard-overview-comfy";
import {
  remotionProductionStageActions,
  storyboardPanelStageActions,
  workbenchStageActions,
  type StageNodePayload,
  type PipelineStageKey,
} from "@/lib/comfyui/storyboard/storyboard-pipeline-comfy";

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

/** ProductionFlowNodeModel[] → StageNodePayload[](七环节逐字段映射) */
export function mapProductionFlowNodesToStagePayloads(nodes: ProductionFlowNodeModel[]): StageNodePayload[] {
  const byKey = new Map(nodes.map((node) => [node.id as PipelineStageKey, node]));
  const keys: PipelineStageKey[] = [
    "script", "scriptPlan", "assets", "storyboardTable", "storyboard", "remotionProduction", "workbench",
  ];
  return keys.flatMap((key): StageNodePayload[] => {
    const node = byKey.get(key);
    if (!node) return [];
    // 单镜生产逐镜队列(提升:actions 禁用态与 shots 载荷同源一份)
    const remotionShots = key === "remotionProduction" ? (node.remotionShots ?? []) : [];
    // 环节动作(1121 修复:三型节点=阶段契约动作族单源,与回落构建器同族——
    // 生产路径此前只透传老画布 node.actions:storyboard 模型 actions=[] /
    // workbench 模型无 actions / remotionProduction 模型动作是老画布派发 kind
    // enqueue-remotion-shots(桥 ALLOWED_KINDS 与宿主 handlers 均无消费方,
    // 活路径唯一钮点击即断链),六钮+H3 全家+重建轨道全缺席;同义钮统一为
    // 桥 kind generate-videos,故该模型动作不透传)。assets=抽取+透传合并;
    // 其余型(scriptPlan/storyboardTable)照节点模型逐字透传。
    let actions: StageNodePayload["actions"];
    if (key === "storyboard") {
      actions = storyboardPanelStageActions(node.storyboardTiles?.length ?? 0);
    } else if (key === "remotionProduction") {
      actions = remotionProductionStageActions(
        remotionShots.length,
        remotionShots.length > 0
          && remotionShots.every((shot) => shot.status === "succeeded" && Boolean(shot.outputPath)),
      );
    } else if (key === "workbench") {
      actions = workbenchStageActions();
    } else if (key === "assets") {
      actions = [
        { kind: "extract-assets", label: node.assetGroups?.length ? "重新抽取资产" : "抽取资产" },
        ...(node.actions || []).map((action) => ({
          kind: action.id, label: action.label,
          ...(action.paid ? { paid: true } : {}),
          ...(action.disabled ? { disabled: true } : {}),
        })),
      ];
    } else if (node.actions?.length) {
      actions = node.actions.map((action) => ({
        kind: action.id,
        label: action.label,
        ...(action.paid ? { paid: true } : {}),
        ...(action.disabled ? { disabled: true } : {}),
      }));
    }
    return [{
      key,
      title: node.label,
      description: node.description,
      status: node.status as StageNodePayload["status"],
      // 节点带 statusText(警示态具体口径)优先;缺省回落 STATUS_TEXT 默认表
      statusText: node.statusText ?? STATUS_TEXT[node.status as StageNodePayload["status"]] ?? node.status,
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
          // 1125 修复:补 id(引擎 storyboard-panel 磁贴行点击读 tile.id,
          // 此前生产路径丢此字段→data-shot-id 恒空=行点击哑)
          id: tile.id,
          // 09-14 用户裁定:磁贴只放标号(原 tile.title=描述铺字,弃用)
          title: `S${String(tile.index).padStart(2, "0")}`,
          preview: tile.id ? shotPreviewNameForId(tile.id) : undefined,
          hasImage: Boolean(tile.mediaPath),
          hasVideo: false,
          ...(tile.lines ? { lines: String(tile.lines) } : {}),
          ...(tile.state ? { state: String(tile.state) } : {}),
        })),
      } : {}),
      ...(key === "remotionProduction" && node.remotionShots ? {
        shots: remotionShots.map((shot) => ({
          index: shot.index,
          // 1121 修复:补 id(引擎 shot-production 的单镜 H3 直达钮读
          // shot.id,此前生产路径丢此字段→H3 小钮恒不渲染)
          id: shot.shotId,
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
      // 环节动作统一收口(上方按 key 计算):三型=阶段契约单源,其余=抽取/
      // 节点模型透传;无动作(script 等)不落 actions 键
      ...(actions ? { actions } : {}),
    }];
  });
}

export { shotPreviewName };
