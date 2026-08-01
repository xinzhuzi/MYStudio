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
  serializeStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ScriptPlan } from "@/types/studio";
import { toast } from "sonner";
import {
  formatRemotionStoryboardJson,
  formatStoryboardJson,
  validateStoryboardJson,
} from "@/lib/studio/storyboard-json";
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
  projectId,
  productionEpisodeId,
  saveAgentWorkData,
  saveScriptPlan,
}: {
  productionFlowModel: ProductionFlowModel;
  projectId?: string;
  productionEpisodeId: string;
  saveAgentWorkData: ReturnType<
    typeof useStudioStore.getState
  >["saveAgentWorkData"];
  saveScriptPlan: (plan: ScriptPlan) => void;
}) {
  const [editingWorkflowNodeId, setEditingWorkflowNodeId] =
    useState<ProductionFlowNodeId | null>(null);
  const [workflowNodeDraft, setWorkflowNodeDraft] = useState("");
  const [workflowNodeJsonMode, setWorkflowNodeJsonMode] = useState<"canonical" | "remotion" | null>(null);

  const workflowNodeEditTitle = useMemo(() => {
    const node = productionFlowModel.nodes.find(
      (item) => item.id === editingWorkflowNodeId,
    );
    if (!node) return "编辑节点";
    if (workflowNodeJsonMode === "canonical") return "Remotion 分镜源数据";
    if (workflowNodeJsonMode === "remotion") return `Remotion JSON · ${node.label}`;
    return `编辑${node.label}`;
  }, [editingWorkflowNodeId, productionFlowModel.nodes, workflowNodeJsonMode]);

  const workflowNodeEditWritable =
    workflowNodeJsonMode !== "remotion" && (
      editingWorkflowNodeId === "script" ||
      editingWorkflowNodeId === "scriptPlan" ||
      editingWorkflowNodeId === "storyboardTable"
    );

  const buildWorkflowNodeDraft = useCallback(
    (nodeId: ProductionFlowNodeId, jsonMode = workflowNodeJsonMode) => {
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
        if (jsonMode === "canonical") {
          const canonical = store.storyboards
            .filter((item) => item.episodeId === episodeId)
            .sort((a, b) => a.index - b.index);
          if (canonical.length) return formatStoryboardJson(canonical);
          const source = latestAgentWork(
            store.agentWorkData,
            "storyboardTable",
            episodeId,
            { allowUnscopedFallback: false },
          );
          if (!source) return "[]";
          const parsed = parseStoryboardTable(source, episodeId, { requireShotSemantics: true });
          if (parsed.errors.length || !parsed.rows.length) return "[]";
          const characters = store.entityExtractions.find((item) => item.episodeId === episodeId)?.characters ?? [];
          return formatStoryboardJson(toStoryboardItems(parsed.rows, episodeId, characters));
        }
        return latestAgentWork(
          store.agentWorkData,
          "storyboardTable",
          episodeId,
          { allowUnscopedFallback: false },
        );
      }
      if (nodeId === "storyboard" && jsonMode === "remotion") {
        return formatRemotionStoryboardJson({
          projectId,
          episodeId,
          items: store.storyboards.filter((item) => item.episodeId === episodeId),
        });
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
    [projectId, productionEpisodeId, workflowNodeJsonMode],
  );

  const openNodeEditor = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      setWorkflowNodeJsonMode(null);
      setEditingWorkflowNodeId(nodeId);
      setWorkflowNodeDraft(buildWorkflowNodeDraft(nodeId, null));
    },
    [buildWorkflowNodeDraft, projectId],
  );

  const openNodeJson = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      if (nodeId !== "storyboardTable" && nodeId !== "storyboard") return;
      if (!projectId) {
        toast.error("请先选择项目，再查看章节 JSON");
        return;
      }
      const mode = nodeId === "storyboardTable" ? "canonical" : "remotion";
      setWorkflowNodeJsonMode(mode);
      setEditingWorkflowNodeId(nodeId);
      setWorkflowNodeDraft(buildWorkflowNodeDraft(nodeId, mode));
    },
    [buildWorkflowNodeDraft, projectId],
  );

  const closeNodeEditor = useCallback(() => {
    setEditingWorkflowNodeId(null);
    setWorkflowNodeJsonMode(null);
  }, []);

  const saveWorkflowNodeEdit = useCallback(async () => {
    if (!editingWorkflowNodeId || workflowNodeJsonMode === "remotion") return;
    if (!projectId) {
      toast.error("请先选择项目，再保存章节 JSON");
      return;
    }
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
      const jsonResult = validateStoryboardJson(workflowNodeDraft, episodeId, projectId);
      if (jsonResult.items) {
        saveAgentWorkData(
          "storyboardTable",
          serializeStoryboardTable(jsonResult.items),
          episodeId,
        );
        useStudioStore.getState().replaceStoryboardsForEpisode(episodeId, jsonResult.items);
        toast.success(`分镜表已保存：${jsonResult.items.length} 条分镜`);
        setEditingWorkflowNodeId(null);
        return;
      }
      if (workflowNodeJsonMode === "canonical") {
        toast.error(`Remotion 分镜源数据不可保存: ${jsonResult.error ?? "JSON 格式无效"}`);
        return;
      }
      const parsed = parseStoryboardTable(text, episodeId, {
        requireShotSemantics: true,
      });
      if (parsed.errors.length > 0 || parsed.rows.length === 0) {
        toast.error(`分镜表不可保存: ${parsed.errors.join("；") || "没有分镜"}`);
        return;
      }
      saveAgentWorkData("storyboardTable", workflowNodeDraft, episodeId);
      const workflowStore = useStudioStore.getState();
      const characters = workflowStore.entityExtractions.find(
        (item) => item.episodeId === episodeId,
      )?.characters ?? [];
      const items = toStoryboardItems(parsed.rows, episodeId, characters);
      workflowStore.replaceStoryboardsForEpisode(episodeId, items);
      toast.success(`分镜表已保存：${items.length} 条分镜`);
      setEditingWorkflowNodeId(null);
      return;
    }
    toast.info("该节点是结构化数据，请进入对应阶段编辑。");
  }, [
    editingWorkflowNodeId,
    projectId,
    productionEpisodeId,
    saveAgentWorkData,
    saveScriptPlan,
    workflowNodeDraft,
    workflowNodeJsonMode,
  ]);

  return {
    editingWorkflowNodeId,
    workflowNodeDraft,
    workflowNodeEditTitle,
    workflowNodeEditWritable,
    workflowNodeEditJson: workflowNodeJsonMode !== null,
    workflowNodeEditReadOnlyJson: workflowNodeJsonMode === "remotion",
    setWorkflowNodeDraft,
    openNodeEditor,
    openNodeJson,
    closeNodeEditor,
    saveWorkflowNodeEdit,
  };
}
