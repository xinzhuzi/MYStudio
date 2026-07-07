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
import {
  batchGenerateAssets,
  type AssetGenerationTask,
} from "@/lib/studio/asset-generation-orchestrator";
import {
  createAssetImageWorkflowGraph,
  createStoryboardImageWorkflowGraph,
  getGeneratedNode,
} from "@/lib/studio/image-workflow";
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";
import {
  buildEntityResolver,
  createMystudioDerivedSinks,
  syncDerivedAssets,
  type EntityResolver,
} from "@/lib/studio/derived-asset-sync";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useFreedomStore } from "@/stores/freedom-store";
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
import type { EntityExtractionResult, ImageWorkflowAssetTargetType, ScriptPlan, StoryboardItem } from "@/types/studio";

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
        saveAgentWorkData("directorPlan", result.text, targetEpisodeId);
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
    [manualCatalog, saveAgentWorkData, saveScriptPlan],
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
        workflowStore.replaceStoryboardsForEpisode(targetEpisodeId, items);

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

  const handleSyncDerivedAssets = useCallback((options?: { silent?: boolean }) => {
    const projectId = activeProjectId;
    if (!projectId) {
      toast.error("未选择项目，无法落地衍生资产");
      return null;
    }
    const store = useStudioStore.getState();
    const context = resolveDerivedAssetActionContext(store, productionEpisodeId);
    if (!context) return null;

    const { plan, batch } = context;
    const resolver = buildEntityResolver(
      batch.characters.map((item) => ({
        id: item.characterId,
        name: item.name,
        aliases: item.aliases,
      })),
      batch.scenes.map((item) => ({ id: item.sceneId, name: item.name })),
      batch.props.map((item) => ({ id: item.assetId, name: item.name })),
    );
    const { summary } = syncDerivedAssets(plan.derivedAssetPlan, {
      projectId,
      resolver,
      ...createMystudioDerivedSinks(),
    });
    if (options?.silent) {
      return { plan, batch, resolver, projectId };
    }
    if (summary.skipped) {
      toast.warning(
        `衍生资产落地 ${summary.created} 条，跳过 ${summary.skipped} 条（父资产未匹配）`,
      );
    } else {
      toast.success(`衍生资产已落地 ${summary.created} 条`);
    }
    return { plan, batch, resolver, projectId };
  }, [activeProjectId, productionEpisodeId]);

  const handleGenerateDerivedAssets = useCallback(async () => {
    const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    const synced = handleSyncDerivedAssets({ silent: true });
    if (!synced) return;

    const tasks = collectDerivedAssetGenerationTasks(
      synced.plan.derivedAssetPlan,
      synced.resolver,
      visualManualId,
      synced.projectId,
    );
    if (tasks.total === 0) {
      toast.info("没有待生成图片的衍生资产");
      return;
    }

    let success = 0;
    let failed = 0;
    for (const task of tasks.characterVariationTasks) {
      const result = await generateCharacterVariationAsset(task);
      if (result) success += 1;
      else failed += 1;
    }
    if (tasks.storeTasks.length) {
      const results = await batchGenerateAssets(tasks.storeTasks, {
        concurrency: 1,
      });
      const done = [...results.values()].filter(
        (result) => result.phase === "done",
      ).length;
      success += done;
      failed += results.size - done;
    }

    if (failed) {
      toast.warning(`衍生图片生成完成：${success} 成功，${failed} 失败`);
    } else {
      toast.success(`衍生图片生成完成：${success} 个资产已就绪`);
    }
  }, [handleSyncDerivedAssets]);

  const handleGenerateStoryboardImages = useCallback(
    async (userInstruction = "") => {
      const projectId = activeProjectId;
      if (!projectId) {
        toast.error("未选择项目，无法保存分镜图");
        return;
      }
      if (!window.projectFiles?.saveImage) {
        toast.error("当前环境不支持项目内图片保存");
        return;
      }

      const store = useStudioStore.getState();
      if (!store.workflowConfig.visualManualId) {
        toast.error("请先在「风格与导演」中选择视觉手册");
        return;
      }

      const targetEpisodeId = resolveScriptPlanEpisodeId(
        store,
        productionEpisodeId,
      );
      const targets = collectStoryboardsNeedingImages(
        store.storyboards,
        targetEpisodeId,
      );
      if (!store.storyboards.length) {
        toast.error("尚无分镜：请先生成分镜表");
        return;
      }
      if (!targets.length) {
        toast.info("当前分镜图已齐全");
        return;
      }

      const manualContext = buildStudioManualContext(
        store.workflowConfig,
        manualCatalog,
      );
      const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
      const freedomImage = useFreedomStore.getState();
      const imageModel = freedomImage.selectedImageModel.trim() || undefined;
      let success = 0;
      let failed = 0;

      for (const storyboard of targets) {
        try {
          useStudioStore.getState().updateStoryboard(storyboard.id, {
            state: "rendering",
            reason: undefined,
          });
          const prompt = buildStoryboardImagePrompt({
            storyboard,
            manualContext,
            userInstruction,
          });
          const referenceImages = collectStoryboardReferenceImages(storyboard);
          const preparedReferenceImages = await prepareImageWorkflowReferenceImages(
            referenceImages.map((item) => item.imageUrl),
            { readProjectFileAsBase64: window.projectFiles.readAsBase64 },
          );
          const result = await aiManager.freedomImage({
            prompt,
            model: imageModel,
            aspectRatio: imageSettings.defaultAspectRatio,
            resolution: imageSettings.defaultResolution,
            referenceImages: preparedReferenceImages.length
              ? preparedReferenceImages
              : undefined,
          });
          if (!result.url) throw new Error("图片生成未返回地址");

          const filename = createStoryboardImageFilename(storyboard);
          const saved = await window.projectFiles.saveImage({
            projectId,
            relativePath: storyboardImageRelativePath(
              storyboard.episodeId,
              filename,
            ),
            source: result.url,
          });
          if (!saved.success || !saved.url) {
            throw new Error(saved.error || "项目内分镜图保存失败");
          }

          const workflowStore = useStudioStore.getState();
          workflowStore.addMaterial({
            name: filename,
            localPath: saved.url,
            size: saved.size ?? 0,
          });
          const graph = createStoryboardImageWorkflowGraph({
            storyboard,
            prompt,
            resultImagePath: saved.url,
            projectName: useProjectStore.getState().activeProject?.name || "MYStudio",
            model: imageModel,
            aspectRatio: imageSettings.defaultAspectRatio,
            resolution: imageSettings.defaultResolution,
            referenceImages,
          });
          const generatedNode = graph.nodes.find((node) => node.type === "generated");
          if (!generatedNode) throw new Error("分镜图片工作流缺少生成节点");
          workflowStore.upsertImageWorkflow(graph);
          workflowStore.applyImageWorkflowResultToStoryboard(
            storyboard.id,
            graph.id,
            getGeneratedNode(graph, generatedNode.id).id,
          );
          saveAgentWorkData(
            "storyboardImage",
            `分镜 ${storyboard.index} 图片已保存：${saved.url}`,
            storyboard.episodeId,
          );
          success += 1;
        } catch (error) {
          failed += 1;
          useStudioStore.getState().updateStoryboard(storyboard.id, {
            state: "failed",
            reason: error instanceof Error ? error.message : "分镜图生成失败",
          });
        }
      }

      if (failed) {
        toast.warning(`分镜图生成完成：${success} 成功，${failed} 失败`);
      } else {
        toast.success(`分镜图生成完成：${success} 张图片已保存到当前项目`);
      }
    },
    [activeProjectId, manualCatalog, productionEpisodeId, saveAgentWorkData],
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
      if (action.id === "sync-derived-assets") {
        handleSyncDerivedAssets();
        return;
      }
      if (action.id === "generate-derived-assets") {
        await handleGenerateDerivedAssets();
        return;
      }
      if (action.id === "generate-storyboard-images") {
        await handleGenerateStoryboardImages(action.userInstruction ?? "");
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
      handleGenerateDerivedAssets,
      handleGenerateStoryboardImages,
      handleStageChange,
      handleRebuildWorkbenchTracks,
      handleStoryboardTable,
      handleSyncDerivedAssets,
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

function resolveDerivedAssetActionContext(
  store: StudioStore,
  episodeId: string,
): { plan: ScriptPlan; batch: EntityExtractionResult } | null {
  const targetEpisodeId = resolveScriptPlanEpisodeId(store, episodeId);
  const plan =
    store.scriptPlans.find((item) => item.episodeId === targetEpisodeId) ??
    store.scriptPlans[store.scriptPlans.length - 1];
  if (!plan) {
    toast.error("尚无导演规划：请先生成导演规划");
    return null;
  }
  if (!plan.derivedAssetPlan.length) {
    toast.info("当前导演规划没有衍生资产预划");
    return null;
  }
  const batch =
    store.entityExtractions.find((item) => item.episodeId === plan.episodeId) ??
    store.entityExtractions[0];
  if (!batch) {
    toast.error("尚无实体库：请先在「剧本资产管理」完成资产提取");
    return null;
  }
  return { plan, batch };
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

type StoryboardReferenceImage = {
  assetId: string;
  assetType: ImageWorkflowAssetTargetType;
  title: string;
  imageUrl: string;
  evidence: string;
};

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
        prompt:
          variation.visualPromptZh ||
          variation.visualPrompt ||
          `${variation.name}：${item.reason}`,
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

export function collectStoryboardReferenceImages(
  storyboard: Pick<StoryboardItem, "assetIds">,
): StoryboardReferenceImage[] {
  const characters = useCharacterLibraryStore.getState().characters;
  const scenes = useSceneStore.getState().scenes;
  const props = usePropsLibraryStore.getState().items;
  const results: StoryboardReferenceImage[] = [];

  for (const assetId of storyboard.assetIds) {
    const character = characters.find((item) => item.id === assetId);
    if (character) {
      const characterImages: Array<{ title: string; imageUrl?: string; evidence: string }> = [
        {
          title: `角色参考：${character.name}`,
          imageUrl: character.thumbnailUrl,
          evidence: `${assetId}.thumbnailUrl`,
        },
        ...character.variations.map((variation) => ({
          title: `角色变体参考：${character.name}·${variation.name}`,
          imageUrl: variation.referenceImage,
          evidence: `${assetId}.variations.${variation.id}.referenceImage`,
        })),
        ...character.views.map((view) => ({
          title: `角色视图参考：${character.name}·${view.viewType}`,
          imageUrl: view.imageUrl,
          evidence: `${assetId}.views.${view.viewType}.imageUrl`,
        })),
      ];
      for (const image of characterImages) {
        if (!image.imageUrl) continue;
        results.push({
          assetId,
          assetType: "character",
          title: image.title,
          imageUrl: image.imageUrl,
          evidence: image.evidence,
        });
      }
      continue;
    }

    const scene = scenes.find((item) => item.id === assetId);
    if (scene?.referenceImage) {
      results.push({
        assetId,
        assetType: "scene",
        title: `场景参考：${scene.name}`,
        imageUrl: scene.referenceImage,
        evidence: `${assetId}.referenceImage`,
      });
      continue;
    }

    const prop = props.find((item) => item.id === assetId);
    if (prop?.imageUrl) {
      results.push({
        assetId,
        assetType: "prop",
        title: `道具参考：${prop.name}`,
        imageUrl: prop.imageUrl,
        evidence: `${assetId}.imageUrl`,
      });
    }
  }

  return results;
}

async function generateCharacterVariationAsset(
  task: CharacterVariationGenerationTask,
): Promise<boolean> {
  const result = await aiManager.image(
    {
      prompt: task.prompt,
      referenceImages: task.referenceImages?.length
        ? task.referenceImages
        : undefined,
    },
    "character",
  );
  if (!result.imageUrl) return false;

  if (!window.projectFiles?.saveImage) return false;
  const saved = await window.projectFiles.saveImage({
    projectId: task.projectId,
    relativePath: `workflow-images/assets/character/${createAssetImageFilename(task.variationId, task.name)}`,
    source: result.imageUrl,
  });
  if (!saved.success || !saved.url) return false;
  const workflowPatch = buildCharacterVariationWorkflowPatch(task, saved.url);
  useCharacterLibraryStore.getState().updateVariation(
    task.characterId,
    task.variationId,
    {
      referenceImage: saved.url,
      ...workflowPatch,
      generatedAt: Date.now(),
    },
  );
  return true;
}

function buildCharacterVariationWorkflowPatch(
  task: CharacterVariationGenerationTask,
  resultImagePath: string,
) {
  const graph = createAssetImageWorkflowGraph(
    {
      target: {
        kind: "asset",
        assetType: "character",
        parentId: task.characterId,
        id: task.variationId,
      },
      title: task.name,
      prompt: task.prompt,
      sourceImagePath: task.referenceImages?.[0],
      resultImagePath,
      imageWorkflowId: task.imageWorkflowId,
    },
    useProjectStore.getState().activeProject?.name || "MYStudio",
  );
  const generatedNode = graph.nodes.find((node) => node.type === "generated");
  if (!generatedNode) return {};
  useStudioStore.getState().upsertImageWorkflow(graph);
  return {
    imageWorkflowId: graph.id,
    imageWorkflowNodeId: generatedNode.id,
  };
}

function collectStoryboardsNeedingImages(
  storyboards: StoryboardItem[],
  episodeId: string,
): StoryboardItem[] {
  const scoped = storyboards.filter((item) => item.episodeId === episodeId);
  const candidates = scoped.length ? scoped : storyboards;
  return candidates
    .filter(
      (item) =>
        item.shouldGenerateImage !== false &&
        (!item.mediaRef || item.mediaRef.kind === "audio"),
    )
    .sort((a, b) => a.index - b.index);
}

function buildStoryboardImagePrompt({
  storyboard,
  manualContext,
  userInstruction,
}: {
  storyboard: StoryboardItem;
  manualContext: string;
  userInstruction: string;
}) {
  return [
    "为分镜视频生成可直接作为首帧/分镜图的单张画面。",
    manualContext && `【视觉与制作手册】\n${manualContext}`,
    [
      "【分镜信息】",
      `镜头：${storyboard.index}`,
      storyboard.videoDesc && `画面描述：${storyboard.videoDesc}`,
      storyboard.prompt && `生成提示词：${storyboard.prompt}`,
      storyboard.lines && `台词：${storyboard.lines}`,
      storyboard.emotion && `情绪：${storyboard.emotion}`,
      storyboard.orientation && `调度：${storyboard.orientation}`,
      storyboard.spatialRelation && `空间关系：${storyboard.spatialRelation}`,
      storyboard.associateAssetsNames?.length
        ? `关联资产：${storyboard.associateAssetsNames.join("、")}`
        : "",
      storyboard.sound && `声音：${storyboard.sound}`,
    ]
      .filter(Boolean)
      .join("\n"),
    userInstruction.trim() &&
      `【本次节点补充要求】\n${userInstruction.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function storyboardImageRelativePath(episodeId: string, filename: string) {
  return `workflow-images/storyboards/${safePathSegment(episodeId)}/${safePathSegment(filename)}`;
}

function createStoryboardImageFilename(storyboard: StoryboardItem) {
  return `shot-${String(storyboard.index).padStart(3, "0")}-${safePathSegment(storyboard.id)}-${Date.now()}.png`;
}

function createAssetImageFilename(assetId: string, assetName: string) {
  return `${safePathSegment(assetId)}-${safePathSegment(assetName)}-${Date.now()}.png`;
}

function safePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "file"
  );
}
