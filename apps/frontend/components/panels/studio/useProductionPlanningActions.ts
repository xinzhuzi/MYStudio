import { useCallback } from "react";
import {
  buildDirectorPlanMessages,
  parseDirectorPlan,
} from "@/lib/studio/director-plan";
import { buildSeriesBible } from "@/lib/studio/series-bible";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildStudioManualContext,
  type StudioManualCatalog,
} from "@/lib/studio/manuals";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import { toast } from "sonner";
import {
  formatScriptPlanContext,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

export function useProductionPlanningActions({
  activeProjectId,
  manualCatalog,
  productionEpisodeId,
  handleStageChange,
  saveAgentWorkData,
  saveScriptPlan,
  saveSeriesBible,
}: {
  activeProjectId?: string;
  manualCatalog: StudioManualCatalog;
  productionEpisodeId: string;
  handleStageChange: (value: string) => void;
  saveAgentWorkData: StudioStore["saveAgentWorkData"];
  saveScriptPlan: StudioStore["saveScriptPlan"];
  saveSeriesBible: StudioStore["saveSeriesBible"];
}) {
  const handleDirectorPlan = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveProductionEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可规划的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const manualContext = buildStudioManualContext(
        store.workflowConfig,
        manualCatalog,
      );
      const messages = buildDirectorPlanMessages({
        episodeId: targetEpisodeId,
        scriptText,
        manualContext,
      });
      const userContent = userInstruction.trim()
        ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
        : messages.user;
      try {
        const result = await aiManager.text({
          binding: { agent: "productionAgent:directorPlanAgent" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: userContent },
          ],
          temperature: 0.4,
          maxTokens: 4096,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "导演规划失败");
        }

        const { plan, warnings } = parseDirectorPlan(
          result.text,
          targetEpisodeId,
        );
        saveScriptPlan(plan);

        const detail = `衍生预划 ${plan.derivedAssetPlan.length} 条`;
        if (warnings.length) {
          toast.warning(
            `导演规划完成（${detail}；光影提示 ${warnings.length} 处已剔除）`,
          );
        } else {
          toast.success(`导演规划完成（${detail}）`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [manualCatalog, saveScriptPlan],
  );

  const handleStoryboardTable = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveScriptPlanEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可生成分镜表的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const plan = store.scriptPlans.find(
        (item) => item.episodeId === targetEpisodeId,
      );
      if (!plan) {
        toast.error("尚无导演规划：请先在分镜视频生成节点中生成导演规划");
        return;
      }

      const messages = buildStoryboardTableMessages({
        episodeId: targetEpisodeId,
        scriptText,
        scriptPlanContext: formatScriptPlanContext(plan),
      });
      const userContent = userInstruction.trim()
        ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
        : messages.user;

      try {
        const result = await aiManager.text({
          binding: { agent: "productionAgent:storyboardTableAgent" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: userContent },
          ],
          temperature: 0.35,
          maxTokens: 8192,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "分镜表生成失败");
        }

        saveAgentWorkData("storyboardTable", result.text, targetEpisodeId);
        const parsed = parseStoryboardTable(result.text, targetEpisodeId);
        const items = toStoryboardItems(parsed.rows, targetEpisodeId);
        const workflowStore = useStudioStore.getState();
        for (const item of items) {
          if (
            workflowStore.storyboards.some((current) => current.id === item.id)
          ) {
            workflowStore.updateStoryboard(item.id, item);
          } else {
            workflowStore.addStoryboard(item);
          }
        }
        workflowStore.rebuildTracks();

        const warningText = parsed.warnings.length
          ? `，提示 ${parsed.warnings.length} 条`
          : "";
        toast.success(`分镜表完成：${items.length} 条分镜${warningText}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [saveAgentWorkData],
  );

  const handleProductionNodeAction = useCallback(
    async (action: {
      id: string;
      targetStage: string;
      userInstruction?: string;
    }) => {
      if (action.id === "generate-director-plan") {
        await handleDirectorPlan(
          productionEpisodeId,
          action.userInstruction ?? "",
        );
        return;
      }
      if (action.id === "generate-storyboard-table") {
        await handleStoryboardTable(
          productionEpisodeId,
          action.userInstruction ?? "",
        );
        return;
      }
      handleStageChange(action.targetStage);
    },
    [
      handleDirectorPlan,
      handleStageChange,
      handleStoryboardTable,
      productionEpisodeId,
    ],
  );

  const handleBuildSeriesBible = useCallback(() => {
    const projectId = activeProjectId;
    if (!projectId) {
      toast.error("未选择项目，无法锁定剧集圣经");
      return;
    }

    const characters = useCharacterLibraryStore
      .getState()
      .characters.filter(
        (item) => !item.projectId || item.projectId === projectId,
      );
    const scenes = useSceneStore
      .getState()
      .scenes.filter((item) => !item.projectId || item.projectId === projectId);

    const config = useStudioStore.getState().workflowConfig;
    const bible = buildSeriesBible({
      projectId,
      characters: characters.map((item) => ({
        id: item.id,
        appearance: item.appearance,
        description: item.description,
      })),
      scenes: scenes.map((item) => ({ name: item.name })),
      config: {
        visualManualId: config.visualManualId,
        directorManualId: config.directorManualId,
        platformSpec: config.platformSpec,
        stylePositioning: config.stylePositioning,
      },
    });

    saveSeriesBible(bible);
    toast.success(
      `剧集圣经已锁定（角色 ${bible.characterLocks.length} / 场景 ${bible.sceneLocks.length}，画幅 ${bible.aspectRatio}）`,
    );
  }, [activeProjectId, saveSeriesBible]);

  return {
    handleDirectorPlan,
    handleStoryboardTable,
    handleProductionNodeAction,
    handleBuildSeriesBible,
  };
}
