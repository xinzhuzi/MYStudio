import { useCallback, useMemo, useState } from "react";
import {
  auditDirectorPlanStructure,
  formatDirectorPlanAuditError,
  parseDirectorPlan,
  summarizeDirectorPlanAudit,
} from "@/lib/studio/director-plan";
import { captureError, createOperationId, logEvent } from "@/lib/diagnostics/logger";
import {
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { useStudioStore } from "@/stores/studio-store";
import type { ScriptPlan } from "@/types/studio";
import { toast } from "sonner";
import {
  formatScriptPlanContext,
  latestAgentWork,
  resolveProductionEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";
import type {
  ProductionFlowModel,
  ProductionFlowNodeId,
} from "./workflow-node-model";

export function useWorkflowNodeEditor({
  productionFlowModel,
  productionEpisodeId,
  saveAgentWorkData,
  saveScriptPlan,
}: {
  productionFlowModel: ProductionFlowModel;
  productionEpisodeId: string;
  saveAgentWorkData: ReturnType<
    typeof useStudioStore.getState
  >["saveAgentWorkData"];
  saveScriptPlan: (plan: ScriptPlan) => void;
}) {
  const [editingWorkflowNodeId, setEditingWorkflowNodeId] =
    useState<ProductionFlowNodeId | null>(null);
  const [workflowNodeDraft, setWorkflowNodeDraft] = useState("");

  const workflowNodeEditTitle = useMemo(() => {
    const node = productionFlowModel.nodes.find(
      (item) => item.id === editingWorkflowNodeId,
    );
    return node ? `编辑${node.label}` : "编辑节点";
  }, [editingWorkflowNodeId, productionFlowModel.nodes]);

  const workflowNodeEditWritable =
    editingWorkflowNodeId === "script" ||
    editingWorkflowNodeId === "scriptPlan" ||
    editingWorkflowNodeId === "storyboardTable";

  const buildWorkflowNodeDraft = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      const store = useStudioStore.getState();
      const episodeId = resolveProductionEpisodeId(store, productionEpisodeId);
      if (nodeId === "script") {
        return (
          latestAgentWork(store.agentWorkData, "scriptDraft", episodeId) ||
          resolveScriptTextForEpisode(store, episodeId)
        );
      }
      if (nodeId === "scriptPlan") {
        const rawDirectorPlan = latestAgentWork(
          store.agentWorkData,
          "directorPlan",
          episodeId,
        );
        if (rawDirectorPlan) return rawDirectorPlan;
        const plan = store.scriptPlans.find(
          (item) => item.episodeId === episodeId,
        );
        return plan ? formatScriptPlanContext(plan) : "";
      }
      if (nodeId === "storyboardTable") {
        return latestAgentWork(
          store.agentWorkData,
          "storyboardTable",
          episodeId,
        );
      }
      if (nodeId === "assets") {
        return store.entityExtractions
          .flatMap((batch) => [
            `# ${batch.episodeId} 衍生资产`,
            "",
            "## 角色",
            ...batch.characters.map(
              (item) =>
                `- ${item.name} (${item.characterId})${item.note ? `：${item.note}` : ""}`,
            ),
            "",
            "## 场景",
            ...batch.scenes.map(
              (item) =>
                `- ${item.name} (${item.sceneId})${item.note ? `：${item.note}` : ""}`,
            ),
            "",
            "## 道具",
            ...batch.props.map(
              (item) =>
                `- ${item.name} (${item.assetId})${item.note ? `：${item.note}` : ""}`,
            ),
            "",
          ])
          .join("\n");
      }
      if (nodeId === "storyboard") {
        return [
          "| 序号 | 分镜 | 时长 | 台词 | 音效 | 资产 |",
          "| --- | --- | ---: | --- | --- | --- |",
          ...store.storyboards
            .slice()
            .sort((left, right) => left.index - right.index)
            .map((item) =>
              [
                item.index,
                item.videoDesc || item.prompt || item.id,
                item.duration,
                item.lines ?? "",
                item.sound ?? "",
                item.assetIds.join(", "),
              ]
                .map((cell) => String(cell).replace(/\|/g, "\\|"))
                .join(" | "),
            )
            .map((row) => `| ${row} |`),
        ].join("\n");
      }
      return [
        "| Track | 时长 | 状态 | 分镜 | 候选 |",
        "| --- | ---: | --- | --- | --- |",
        ...store.productionTracks.map(
          (track) =>
            `| ${track.trackKey || track.id} | ${track.duration} | ${track.state} | ${track.storyboardIds.length} | ${track.candidateVideoIds.length} |`,
        ),
      ].join("\n");
    },
    [productionEpisodeId],
  );

  const openNodeEditor = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      setEditingWorkflowNodeId(nodeId);
      setWorkflowNodeDraft(buildWorkflowNodeDraft(nodeId));
    },
    [buildWorkflowNodeDraft],
  );

  const closeNodeEditor = useCallback(() => {
    setEditingWorkflowNodeId(null);
  }, []);

  const saveWorkflowNodeEdit = useCallback(async () => {
    if (!editingWorkflowNodeId) return;
    const store = useStudioStore.getState();
    const episodeId = resolveProductionEpisodeId(store, productionEpisodeId);
    const text = workflowNodeDraft.trim();
    if (editingWorkflowNodeId === "script") {
      saveAgentWorkData("scriptDraft", workflowNodeDraft, episodeId);
      toast.success("剧本已保存");
      setEditingWorkflowNodeId(null);
      return;
    }
    if (editingWorkflowNodeId === "scriptPlan") {
      const operationId = createOperationId("director-plan-edit");
      let blockedLogged = false;
      try {
        const audit = auditDirectorPlanStructure(workflowNodeDraft);
        await logEvent({
          level: audit.passed ? "info" : "warn",
          category: "workflow",
          operationId,
          message: "directorPlan.audit.first",
          context: {
            episodeId,
            source: "node_editor",
            audit: summarizeDirectorPlanAudit(audit),
          },
        });
        if (!audit.passed) {
          await logEvent({
            level: "error",
            category: "workflow",
            operationId,
            message: "directorPlan.writeback.blocked",
            context: {
              episodeId,
              source: "node_editor",
              phase: "manual_edit_audit",
              audit: summarizeDirectorPlanAudit(audit),
            },
          });
          blockedLogged = true;
          throw new Error(formatDirectorPlanAuditError(audit));
        }
        const { plan, warnings } = parseDirectorPlan(
          workflowNodeDraft,
          episodeId,
        );
        saveAgentWorkData("directorPlan", workflowNodeDraft, episodeId);
        saveScriptPlan(plan);
        await logEvent({
          level: "info",
          category: "workflow",
          operationId,
          message: "directorPlan.writeback.saved",
          context: {
            episodeId,
            source: "node_editor",
            audit: summarizeDirectorPlanAudit(audit),
            derivedAssetPlanCount: plan.derivedAssetPlan.length,
            sceneIntentCount: plan.sceneIntents.length,
          },
        });
        toast.success(
          warnings.length
            ? `导演规划已保存（提示 ${warnings.length} 条）`
            : "导演规划已保存",
        );
        setEditingWorkflowNodeId(null);
      } catch (error) {
        if (!blockedLogged) {
          await logEvent({
            level: "error",
            category: "workflow",
            operationId,
            message: "directorPlan.writeback.blocked",
            context: {
              episodeId,
              source: "node_editor",
              phase: "exception",
              error: captureError(error),
            },
          });
        }
        toast.error(
          error instanceof Error ? error.message : "导演规划保存失败",
        );
      }
      return;
    }
    if (editingWorkflowNodeId === "storyboardTable") {
      saveAgentWorkData("storyboardTable", workflowNodeDraft, episodeId);
      const parsed = parseStoryboardTable(text, episodeId);
      const workflowStore = useStudioStore.getState();
      const characters = workflowStore.entityExtractions.find(
        (item) => item.episodeId === episodeId,
      )?.characters ?? [];
      const items = toStoryboardItems(parsed.rows, episodeId, characters);
      workflowStore.replaceStoryboardsForEpisode(episodeId, items);
      const warningText = parsed.errors.length
        ? `，忽略非法行 ${parsed.errors.length} 条`
        : "";
      toast.success(`分镜表已保存：${items.length} 条分镜${warningText}`);
      setEditingWorkflowNodeId(null);
      return;
    }
    toast.info("该节点是结构化数据，请进入对应阶段编辑。");
  }, [
    editingWorkflowNodeId,
    productionEpisodeId,
    saveAgentWorkData,
    saveScriptPlan,
    workflowNodeDraft,
  ]);

  return {
    editingWorkflowNodeId,
    workflowNodeDraft,
    workflowNodeEditTitle,
    workflowNodeEditWritable,
    setWorkflowNodeDraft,
    openNodeEditor,
    closeNodeEditor,
    saveWorkflowNodeEdit,
  };
}
