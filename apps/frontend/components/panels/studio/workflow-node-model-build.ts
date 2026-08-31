import {
  PRODUCTION_FLOW_EDGES,
  type ProductionFlowBuildContext,
  type ProductionFlowModel,
        type ProductionFlowRendererSummary,
    type ProductionFlowWorkbenchTrack,
} from "./workflow-node-model-schema";
import {
  buildScriptNode,
  buildScriptPlanNode,
  buildAssetsNode,
  buildStoryboardTableNode,
  buildStoryboardPanelNode,
  buildRemotionProductionNode,
  buildWorkbenchNode,
  buildRemotionShots,
  buildStoryboardTiles,
  summarizeRemotionShots,
} from "./workflow-node-model-node-builders";
import {
  buildDirectorPlanSkills,
  buildNodeSkill,
  buildStoryboardSkills,
  buildStoryboardTableSkills,
  normalizeRemotionRendererSummary,
} from "./workflow-node-model-skills";
import type {} from "@/types/studio-assets";
import {
  buildStudioFlowData,
} from "@/lib/studio/studio-flow-data";
import {
  parseStoryboardPreviewRows,
} from "./storyboard-preview-model";
import {
  buildAssetDerivationModel,
 
 
} from "./workflow-asset-derivation-model";
import type {
 
 
  ProductionFlowModelInput,
} from "./workflow-asset-types";


export function buildProductionFlowModel(
  input: ProductionFlowModelInput & { rendererSummary?: ProductionFlowRendererSummary },
): ProductionFlowModel {
  const chapterStoryboards = input.episodeId
    ? input.storyboards.filter((storyboard) => storyboard.episodeId === input.episodeId)
    : input.storyboards;
  const remotionShotSlots = (input.remotionCurrentShotSlots ?? []).filter(
    (slot) => slot.target.kind === "shot"
      && (!input.episodeId || slot.target.chapterId === input.episodeId),
  );
  const flowData = buildStudioFlowData({
    ...input,
    storyboards: chapterStoryboards,
  });
  const scriptDrafts = input.agentWorkData.filter(
    (item) => item.key === "scriptDraft" && item.data.trim(),
  );
  const storyboardTableCount = input.agentWorkData.filter(
    (item) => item.key === "storyboardTable" && item.data.trim(),
  ).length;
  const assetCounts = flowData.assets.reduce(
    (counts, asset) => {
      counts.total += 1;
      counts[asset.type] += 1;
      return counts;
    },
    { total: 0, character: 0, scene: 0, prop: 0 },
  );
  const assetDerivation = buildAssetDerivationModel(
    flowData.assets,
    input.scriptPlans,
    input.assetMediaById,
    // R2 交叉核对吃章过滤后的分镜(与 chapterStoryboards 同一份数据);
    // 二期 R1 透传当前章剧本指纹给 derivation summary 做 planStale 比对
    {
      chapterStoryboards,
      ...(input.currentScriptFingerprint !== undefined
        ? { currentScriptFingerprint: input.currentScriptFingerprint }
        : {}),
    },
  );
  const assetMetrics = assetCounts.total
    ? [
        `${assetCounts.total} 个资产`,
        `${assetCounts.character} 角色`,
        `${assetCounts.scene} 场景`,
        `${assetCounts.prop} 道具`,
        ...(assetDerivation.summary.planned || assetDerivation.summary.existing
          ? [
              `衍生图 ${assetDerivation.summary.completed}/${assetDerivation.summary.linked} 已完成${assetDerivation.summary.unused ? `，未使用 ${assetDerivation.summary.unused}` : ""}`,
            ]
          : []),
        ...(assetDerivation.summary.missingParent
          ? [`缺父资产 ${assetDerivation.summary.missingParent}`]
          : []),
      ]
    : ["待提取资产"];
  const assetPreviewLines = assetDerivation.groups.slice(0, 18).flatMap((group) => [
    `${group.source.typeLabel} · ${group.source.name}${group.source.note ? ` · ${group.source.note}` : ""}`,
    ...group.derived.map((item) => `衍生 · ${item.name}${item.reason ? ` · ${item.reason}` : ""}`),
  ]);
  const rendererSummary = normalizeRemotionRendererSummary(input.rendererSummary);
  const remotionShots = buildRemotionShots(chapterStoryboards, input, remotionShotSlots);
  const ctx: ProductionFlowBuildContext = {
    input,
    chapterStoryboards,
    flowData,
    scriptDrafts,
    scriptChars: flowData.script.length,
    storyboardTableCount,
    assetCounts,
    assetDerivation,
    assetMetrics,
    assetPreviewLines,
    storyboardTableRows: parseStoryboardPreviewRows(flowData.storyboardTable),
    visualStoryboardCount: flowData.storyboard.filter((item) => item.mediaPath).length,
    rendererSummary,
    remotionFinalExportReady: rendererSummary.actual === "remotion"
      && Boolean(rendererSummary.outputPath),
    storyboardPreview: flowData.storyboard.slice(0, 4).map((item) =>
      [
        `#${item.id}`,
        `${item.duration}s`,
        item.videoDesc || item.prompt || item.lines || "未填写分镜内容",
      ].join(" · "),
    ),
    storyboardTiles: buildStoryboardTiles(chapterStoryboards, input.imageWorkflows),
    workbenchTracks: flowData.workbench.tracks
      .slice(0, 8)
      .map<ProductionFlowWorkbenchTrack>((track) => ({
        id: track.id,
        duration: track.duration,
        state: track.state,
        storyboardCount: track.storyboardIds.length,
        mediaCount: track.medias.length,
        videoCount: track.videoList.length,
        selectedVideoPath: track.selectedVideoPath,
        prompt: track.prompt,
        reason: track.reason,
      })),
    remotionShots,
    remotionQueueConcurrency: input.remotionQueueConcurrency ?? 1,
    remotionSummary: summarizeRemotionShots(
      remotionShots,
      input.remotionQueueLoading,
      input.remotionQueueError,
    ),
    directorPlanSkill: buildNodeSkill("production_execution_director_plan"),
    directorPlanSkills: buildDirectorPlanSkills(input.workflowConfig, input.manualCatalog),
    storyboardTableSkills: buildStoryboardTableSkills(input.workflowConfig, input.manualCatalog),
    storyboardSkills: buildStoryboardSkills(input.workflowConfig, input.manualCatalog),
    remotionShotSlots,
  };
  return {
    nodes: [
      buildScriptNode(ctx),
      buildScriptPlanNode(ctx),
      buildAssetsNode(ctx),
      buildStoryboardTableNode(ctx),
      buildStoryboardPanelNode(ctx),
      buildRemotionProductionNode(ctx),
      buildWorkbenchNode(ctx),
    ],
    edges: PRODUCTION_FLOW_EDGES,
    remotionShotSlots,
  };
}
