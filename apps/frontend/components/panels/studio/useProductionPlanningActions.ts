import { useCallback } from "react";
import {
  auditDirectorPlanStructure,
  buildDirectorPlanRepairUserMessage,
  buildDirectorPlanMessages,
  formatDirectorPlanAuditError,
  summarizeDirectorPlanAudit,
} from "@/lib/studio/director-plan";
import { createProductionAgentToolRegistry } from "@/lib/studio/production-agent-tools";
import { captureError, createOperationId, logEvent } from "@/lib/diagnostics/logger";
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
import {
  buildProjectMemoryRecords,
  formatProjectMemoryContext,
  retrieveProjectMemory,
} from "@/lib/studio/project-memory";
import { DAOJIE_VISUAL_MANUAL_ID } from "@/lib/studio/visual-manual-classification";
import type { AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import type { EntityResolver } from "@/lib/studio/derived-asset-sync";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
import { toast } from "sonner";
import {
  formatScriptPlanContext,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";
import type { ScriptPlan, StoryboardItem } from "@/types/studio";

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
      const projectId = activeProjectId ?? useProjectStore.getState().activeProjectId ?? "studio-current-project";
      const projectMemoryContext = formatProjectMemoryContext(retrieveProjectMemory({
        records: buildProjectMemoryRecords({
          projectId,
          chapters: store.novelChapters,
          entityExtractions: store.entityExtractions,
          seriesBible: store.seriesBible,
        }),
        projectId,
        episodeId: targetEpisodeId,
        query: scriptText.slice(0, 240),
      }));
      const messages = buildDirectorPlanMessages({
        episodeId: targetEpisodeId,
        scriptText,
        manualContext: [manualContext, projectMemoryContext].filter(Boolean).join("\n\n---\n\n"),
      });
      const userContent = userInstruction.trim()
        ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
        : messages.user;
      const operationId = createOperationId("director-plan");
      const runId = store.startAgentRun({
        key: "directorPlan",
        phase: "scriptPlan",
        inputSummary: `directorPlan:${targetEpisodeId}:${scriptText.length}`,
        inputFingerprint: stableRunFingerprint({
          targetEpisodeId,
          scriptText,
          manualContext,
          userInstruction,
        }),
        checkpointRef: operationId,
      });
      let blockedLogged = false;
      const logDirectorPlanAudit = async (
        message: "directorPlan.audit.first" | "directorPlan.audit.repair",
        audit: ReturnType<typeof auditDirectorPlanStructure>,
      ) => {
        await logEvent({
          level: audit.passed ? "info" : "warn",
          category: "workflow",
          operationId,
          message,
          context: {
            episodeId: targetEpisodeId,
            audit: summarizeDirectorPlanAudit(audit),
          },
        });
      };
      const logDirectorPlanWriteback = async (
        message: "directorPlan.writeback.saved" | "directorPlan.writeback.blocked",
        context: Record<string, unknown>,
      ) => {
        if (message === "directorPlan.writeback.blocked") blockedLogged = true;
        await logEvent({
          level: message === "directorPlan.writeback.saved" ? "info" : "error",
          category: "workflow",
          operationId,
          message,
          context: {
            episodeId: targetEpisodeId,
            ...context,
          },
        });
      };
      try {
        const result = await aiManager.textStream({
          binding: { agent: "productionAgent:directorPlanAgent" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: userContent },
          ],
          temperature: 0.4,
          maxTokens: 4096,
        }, () => undefined);
        if (!result.success || !result.text) {
          throw new Error(result.error || "导演规划失败");
        }

        let finalText = result.text;
        let audit = auditDirectorPlanStructure(finalText);
        await logDirectorPlanAudit("directorPlan.audit.first", audit);
        let repairAttempted = false;
        if (!audit.passed) {
          repairAttempted = true;
          const repairResult = await aiManager.textStream({
            binding: { agent: "productionAgent:directorPlanAgent" },
            messages: [
              { role: "system", content: messages.system },
              {
                role: "user",
                content: buildDirectorPlanRepairUserMessage({
                  originalUserContent: userContent,
                  invalidOutput: finalText,
                  issues: audit.issues,
                }),
              },
            ],
            temperature: 0.25,
            maxTokens: 6144,
          }, () => undefined);
          if (!repairResult.success || !repairResult.text) {
            await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
              phase: "repair_request",
              firstAudit: summarizeDirectorPlanAudit(audit),
              repairError: repairResult.error || "empty repair output",
            });
            throw new Error(repairResult.error || "导演规划结构修复失败");
          }
          finalText = repairResult.text;
          audit = auditDirectorPlanStructure(finalText);
          await logDirectorPlanAudit("directorPlan.audit.repair", audit);
        }
        if (!audit.passed) {
          await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
            phase: "final_audit",
            repairAttempted,
            audit: summarizeDirectorPlanAudit(audit),
          });
          throw new Error(formatDirectorPlanAuditError(audit));
        }

        const tools = createProductionAgentToolRegistry();
        const writeResult = tools.writeDirectorPlan({
          text: finalText,
          episodeId: targetEpisodeId,
          saveAgentWorkData,
          saveScriptPlan,
        });
        if (!writeResult.approved || !writeResult.plan) {
          await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
            phase: "tool_supervision",
            repairAttempted,
            audit: writeResult.audit,
            issues: writeResult.issues,
            error: writeResult.error,
          });
          throw new Error(writeResult.error || "导演规划工具写回未通过监督");
        }
        useStudioStore.getState().finishAgentRun(runId, {
          outputRef: writeResult.workId,
          outputRefs: [writeResult.workId, writeResult.plan.id].filter((ref): ref is string => Boolean(ref)),
          checkpointRef: operationId,
        });
        await logDirectorPlanWriteback("directorPlan.writeback.saved", {
          repairAttempted,
          audit: writeResult.audit,
          derivedAssetPlanCount: writeResult.plan.derivedAssetPlan.length,
          sceneIntentCount: writeResult.plan.sceneIntents.length,
        });

        const detail = `6段规划，场景 ${writeResult.audit.metrics.sceneSections} 段，衍生预划 ${writeResult.plan.derivedAssetPlan.length} 条`;
        const repairDetail = repairAttempted ? "；已自动修复结构" : "";
        if (writeResult.warnings.length) {
          toast.warning(
            `导演规划完成（${detail}${repairDetail}；光影提示 ${writeResult.warnings.length} 处已剔除）`,
          );
        } else {
          toast.success(`导演规划完成（${detail}${repairDetail}）`);
        }
      } catch (error) {
        useStudioStore.getState().failAgentRun(runId, captureError(error).message, operationId);
        if (!blockedLogged) {
          await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
            phase: "exception",
            error: captureError(error),
          });
        }
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectId, manualCatalog, saveAgentWorkData, saveScriptPlan],
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
      const runId = store.startAgentRun({
        key: "storyboardTable",
        phase: "storyboardTable",
        inputSummary: `storyboardTable:${targetEpisodeId}:${scriptText.length}`,
        inputFingerprint: stableRunFingerprint({
          targetEpisodeId,
          scriptText,
          scriptPlanId: plan.id,
          userInstruction,
        }),
      });

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

        const parsed = parseStoryboardTable(result.text, targetEpisodeId, {
          requireShotSemantics: true,
        });
        if (parsed.errors.length) {
          throw new Error(`分镜表结构无效：${parsed.errors.join("；")}`);
        }
        const workId = saveAgentWorkData("storyboardTable", result.text, targetEpisodeId);
        const workflowStore = useStudioStore.getState();
        const characters = workflowStore.entityExtractions.find(
          (item) => item.episodeId === targetEpisodeId,
        )?.characters ?? [];
        const items = toStoryboardItems(
          parsed.rows,
          targetEpisodeId,
          characters,
        );
        workflowStore.replaceStoryboardsForEpisode(targetEpisodeId, items);
        workflowStore.finishAgentRun(runId, {
          outputRef: workId,
          outputRefs: [workId, ...items.map((item) => item.id)],
        });

        const warningText = parsed.warnings.length
          ? `，提示 ${parsed.warnings.length} 条`
          : "";
        toast.success(`分镜表完成：${items.length} 条分镜${warningText}`);
      } catch (error) {
        useStudioStore.getState().failAgentRun(runId, error instanceof Error ? error.message : String(error));
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [saveAgentWorkData],
  );

  const handleRebuildWorkbenchTracks = useCallback(() => {
    const store = useStudioStore.getState();
    if (!store.storyboards.length) {
      toast.error("尚无分镜：请先生成分镜表");
      return;
    }
    store.rebuildTracks();
    handleStageChange("workbench");
    toast.success(`视频轨道已重建：${store.storyboards.length} 个分镜`);
  }, [handleStageChange]);

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
      if (action.id === "rebuild-workbench-tracks") {
        handleRebuildWorkbenchTracks();
        return;
      }
      handleStageChange(action.targetStage);
    },
    [
      handleDirectorPlan,
      handleStageChange,
      handleRebuildWorkbenchTracks,
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
        (item) => item.projectId === projectId,
      );
    const scenes = useSceneStore
      .getState()
      .scenes.filter((item) => item.projectId === projectId);

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

function stableRunFingerprint(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

type CharacterVariationGenerationTask = {
  characterId: string;
  variationId: string;
  projectId: string;
  name: string;
  prompt: string;
  referenceImages?: string[];
  imageWorkflowId?: string;
};

function buildCharacterDerivativeImagePrompt(input: {
  characterName: string;
  variationName: string;
  basePrompt: string;
  reason: string;
  visualManualId: string;
}) {
  const basePrompt = input.basePrompt.trim() || `${input.variationName}：${input.reason}`.trim();
  const styleLock =
    input.visualManualId === DAOJIE_VISUAL_MANUAL_ID
      ? [
          "道劫彩色工笔水墨角色设定：媒介规则优先于父图的数字渲染，脸、手、发丝、衣褶与服饰结构先以连续白描和铁线描建立，再以矿物薄层分染与罩染；主体密、背景疏",
          "水墨与纸白占画面大部，30%-70%可辨彩色且目标约30%-40%，只用石青、石绿、赭石、朱砂或旧金等2-3种低饱和点缀色；均匀平光宣纸照明与纸面散射光",
          "禁止写实摄影，禁止3D写实渲染，CGI，赛璐璐平涂，高饱和霓虹，电影级体积雾，HDR高光，镜面湿面反光和全幅冷青或灰蓝渲染",
        ]
      : [
          "character reference sheet, character turnaround",
          "consistent identity, face consistency, outfit detail clarity",
        ];

  return [
    basePrompt,
    `角色衍生资产：${input.characterName} · ${input.variationName}`,
    "以父角色基础形象图为参考，保持同一角色身份、面容、体态、发型识别点不变，只叠加服化妆造与局部状态变化",
    "必须输出角色四视图设定图/三视图参考图，不要生成单张全身插画或说明卡",
    "同一画面左至右并排展示人像特写、正视图、侧视图、后视图，portrait closeup, front view, side view, back view, character reference sheet, character turnaround",
    "自然站立，宣纸白底色背景，均匀散光，无硬阴影，四视图服化妆造一致，图中不要有任何文字",
    ...styleLock,
  ].join("\n");
}

export function collectDerivedAssetGenerationTasks(
  plan: ScriptPlan["derivedAssetPlan"],
  resolver: EntityResolver,
  visualManualId: string,
  projectId: string,
): {
  characterVariationTasks: CharacterVariationGenerationTask[];
  storeTasks: AssetGenerationTask[];
  total: number;
} {
  const characters = useCharacterLibraryStore.getState().characters;
  const scenes = useSceneStore.getState().scenes;
  const props = usePropsLibraryStore.getState().items;
  const characterVariationTasks: CharacterVariationGenerationTask[] = [];
  const storeTasks: AssetGenerationTask[] = [];

  for (const item of plan) {
    const target = resolver(item.parentAssetId);
    if (!target) continue;

    if (target.kind === "character") {
      const character = characters.find((current) => current.id === target.id);
      const variation = character?.variations.find(
        (current) => current.name === item.state,
      );
      if (!character || !variation || variation.referenceImage) continue;
      characterVariationTasks.push({
        characterId: character.id,
        variationId: variation.id,
        projectId,
        name: `${character.name}-${variation.name}`,
        prompt: buildCharacterDerivativeImagePrompt({
          characterName: character.name,
          variationName: variation.name,
          basePrompt:
            variation.visualPromptZh ||
            variation.visualPrompt ||
            `${variation.name}：${item.reason}`,
          reason: item.reason,
          visualManualId,
        }),
        referenceImages: [
          character.thumbnailUrl,
          character.views[0]?.imageUrl,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: variation.imageWorkflowId,
      });
      continue;
    }

    if (target.kind === "scene") {
      const parentScene = scenes.find((current) => current.id === target.id);
      const scene = scenes.find(
        (current) =>
          current.parentSceneId === target.id &&
          current.viewpointName === item.state &&
          current.projectId === projectId,
      );
      if (!scene || scene.referenceImage) continue;
      const existingPrompt = scene.visualPrompt || `${item.state}：${item.reason}`;
      storeTasks.push({
        assetId: scene.id,
        assetType: "scene",
        projectId,
        name: scene.name,
        description:
          [scene.location, scene.time, scene.atmosphere, scene.notes]
            .filter(Boolean)
            .join("，") || item.reason,
        isDerivative: true,
        visualManualId,
        skipPolish: Boolean(scene.visualPrompt),
        existingPrompt,
        referenceImages: [
          parentScene?.referenceImage,
          parentScene?.referenceImageBase64,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: scene.imageWorkflowId,
      });
      continue;
    }

    const parentProp = props.find((current) => current.id === target.id);
    const prop = props.find(
      (current) =>
        current.parentId === target.id &&
        current.category === item.state &&
        current.projectId === projectId,
    );
    if (!prop || prop.imageUrl) continue;
    const existingPrompt = prop.visualPrompt || `${item.state}：${item.reason}`;
    storeTasks.push({
      assetId: prop.id,
      assetType: "prop",
      projectId,
      name: prop.name,
      description: prop.description || item.reason,
      isDerivative: true,
      visualManualId,
      skipPolish: Boolean(prop.visualPrompt),
      existingPrompt,
      referenceImages: [
        parentProp?.imageUrl,
        ...(parentProp?.referenceImages ?? []),
      ].filter((image): image is string => Boolean(image)),
      imageWorkflowId: prop.imageWorkflowId,
    });
  }

  return {
    characterVariationTasks,
    storeTasks,
    total: characterVariationTasks.length + storeTasks.length,
  };
}
