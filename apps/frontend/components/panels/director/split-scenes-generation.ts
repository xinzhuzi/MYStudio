/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 分镜生成动作钩子——单图/九宫格合并/尾帧三块生成工厂接线。
 * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;
 * 闭包引用经 ctx 注入(目录=原 deps 数组+通读核验);any 为迁移期务实妥协。
 */
import { useMemo, useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";
import { persistSceneImage } from "@/lib/utils/image-persist";
import { createStoryboardEndFrameGenerator } from "@/components/features/storyboard/storyboard-end-frame-generation";
import { createStoryboardSingleImageGenerator } from "@/components/features/storyboard/storyboard-single-image-generation";
import { collectOptimizedMergedFrameReferenceImages } from "@/components/features/storyboard/storyboard-merged-reference-utils";
import { runStoryboardMergedPages } from "@/components/features/storyboard/storyboard-merged-page-controller";
import { createStoryboardMergedPageGenerator } from "./storyboard-merged-page-generation";
import {
  buildMergedFrameTasks,
  isStoryboardSceneCompleted,
  paginateMergedFrameTasks,
  type MergedFrameTask as GridTask,
} from "@/components/features/storyboard/storyboard-merged-grid-utils";
import { optimizeReferenceImagesForModel } from "@/components/features/storyboard/storyboard-reference-utils";

export function useSplitScenesGeneration(ctx: {
  splitScenes: any;
  storyboardConfig: any;
  storyboardImage: any;
  defaultStoryboardAspectRatio: any;
  defaultStoryboardResolution: any;
  currentStyleId: any;
  getStylePrompt: any;
  getStyleNegativePrompt: any;
  getSceneCharacterContexts: any;
  getCharacterReferenceImages: any;
  getSceneIdentityLockLines: any;
  buildPromptWithIdentityLock: any;
  processReferenceImagesForApi: any;
  updateSplitSceneImage: any;
  updateSplitSceneImageStatus: any;
  updateSplitSceneEndFrame: any;
  updateSplitSceneEndFrameStatus: any;
  autoSaveImageToLibrary: any;
  setIsGenerating: any;
  imageAbortRef: any;
  endFrameAbortRef: any;
  mergedAbortRef: any;
  getImageFolderId: any;
  mediaProjectId: any;
  addMediaFromUrl: any;
  setIsMergedRunning: any;
  startMergedGeneration: any;
  finishMergedGeneration: any;
}) {
  const {
    splitScenes,
    storyboardConfig,
    storyboardImage,
    defaultStoryboardAspectRatio,
    defaultStoryboardResolution,
    currentStyleId,
    getStylePrompt,
    getStyleNegativePrompt,
    getSceneCharacterContexts,
    getCharacterReferenceImages,
    getSceneIdentityLockLines,
    buildPromptWithIdentityLock,
    processReferenceImagesForApi,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
    autoSaveImageToLibrary,
    setIsGenerating,
    imageAbortRef,
    endFrameAbortRef,
    mergedAbortRef,
    getImageFolderId,
    mediaProjectId,
    addMediaFromUrl,
    setIsMergedRunning,
    startMergedGeneration,
    finishMergedGeneration,
  } = ctx;

  // 单图传输由共享控制器负责，Director 只提供身份锁和参考图优化策略。
  const handleGenerateSingleImage = useMemo(
    () => createStoryboardSingleImageGenerator({
      getScene: (sceneId) => splitScenes.find((scene) => scene.id === sceneId),
      aspectRatio: storyboardConfig.aspectRatio || defaultStoryboardAspectRatio,
      resolution: storyboardConfig.resolution || defaultStoryboardResolution,
      prepareRequest: async ({ scene, model, promptToUse }) => {
        const fullStylePrompt = getStylePrompt(currentStyleId);
        let prompt = fullStylePrompt ? `${promptToUse}. Style: ${fullStylePrompt}` : promptToUse;
        const sceneCharacterContexts = getSceneCharacterContexts(scene.characterIds || [], scene.characterVariationMap);
        const sceneCharacterRefs = getCharacterReferenceImages(scene.characterIds || [], scene.characterVariationMap);
        const fallbackCharacterRefs = sceneCharacterContexts.length === 0
          ? (storyboardConfig.characterReferenceImages || [])
          : [];
        prompt = buildPromptWithIdentityLock(prompt, scene, model, sceneCharacterRefs.length > 0);

        const optimizedReferenceImages = optimizeReferenceImagesForModel(model, [
          { kind: 'scene', images: scene.sceneReferenceImage ? [scene.sceneReferenceImage] : [] },
          { kind: 'character', images: sceneCharacterRefs.length > 0 ? sceneCharacterRefs : fallbackCharacterRefs },
          { kind: 'style', images: storyboardImage ? [storyboardImage] : [] },
        ]);
        const apiReferenceImages = await processReferenceImagesForApi(optimizedReferenceImages, '[SingleImage]');
        const fallbackReferences: string[] = [];
        if (scene.sceneReferenceImage) fallbackReferences.push(scene.sceneReferenceImage);
        fallbackReferences.push(...(scene.characterIds?.length ? sceneCharacterRefs : fallbackCharacterRefs));
        if (storyboardImage) fallbackReferences.push(storyboardImage);
        const processedFallbackReferences = await processReferenceImagesForApi(
          fallbackReferences.slice(0, 14),
          '[SplitScenes]',
          false,
        );
        return {
          prompt,
          referenceImages: apiReferenceImages.length > 0 ? apiReferenceImages : processedFallbackReferences,
        };
      },
      updateStatus: updateSplitSceneImageStatus,
      updateImage: updateSplitSceneImage,
      autoSaveImage: autoSaveImageToLibrary,
      setGenerating: setIsGenerating,
      usePersistedHttpUrlOnly: true,
      createAbortController: () => {
        const controller = new AbortController();
        imageAbortRef.current = controller;
        return controller;
      },
    }),
// eslint-disable-next-line react-hooks/exhaustive-deps
    [
      splitScenes,
      storyboardConfig,
      storyboardImage,
      defaultStoryboardAspectRatio,
      defaultStoryboardResolution,
      currentStyleId,
      updateSplitSceneImage,
      updateSplitSceneImageStatus,
      autoSaveImageToLibrary,
      getSceneCharacterContexts,
      getCharacterReferenceImages,
      buildPromptWithIdentityLock,
      processReferenceImagesForApi,
    ],
  );

  // Shared merged-grid prompt rules live in storyboard-merged-grid-utils.
  const handleMergedGenerate = useCallback(async (mode: 'first'|'last'|'both', strategy: 'cluster'|'minimal'|'none' = 'cluster', exemplar: boolean = true) => {
    if (splitScenes.length === 0) {
      toast.error('没有可生成的分镜');
      return;
    }

    // 获取图像生成能力 - 使用服务映射配置
    const featureConfig = aiManager.featureConfig('character_generation');
    if (!featureConfig) {
      toast.error('请先在设置中配置图片生成服务映射');
      return;
    }
    
    const keyManager = featureConfig.keyManager;
    const apiKey = keyManager.getCurrentKey() || '';
    if (!apiKey) {
      toast.error('请先在设置中配置图片生成服务映射');
      return;
    }
    const model = featureConfig.models?.[0];
    if (!model) {
      toast.error('请先在设置中配置图片生成模型');
      return;
    }
    const imageBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
    if (!imageBaseUrl) {
      toast.error('请先在设置中配置图片生成服务映射');
      return;
    }
    

    setIsMergedRunning(true);
    const mergedSignal = startMergedGeneration();

    const aspect = storyboardConfig.aspectRatio || defaultStoryboardAspectRatio;
    // 始终使用 getStylePrompt 获取完整风格提示词（保证有默认值，即使 styleTokens 为空）
    const fullStylePrompt = getStylePrompt(currentStyleId);
    const fullStyleNegative = getStyleNegativePrompt(currentStyleId);

    // === 统一任务列表方案：支持混合九宫格 ===
    const tasks = buildMergedFrameTasks(splitScenes, mode);

    // 检查是否有需要生成的
    if (tasks.length === 0) {
      toast.info('所有分镜已生成完成，无需重复生成');
      finishMergedGeneration(mergedSignal);
      setIsMergedRunning(false);
      return;
    }

    // 统计信息
    const firstCount = tasks.filter(t => t.type === 'first').length;
    const endCount = tasks.filter(t => t.type === 'end').length;
    const parts: string[] = [];
    if (firstCount > 0) parts.push(`${firstCount}个首帧`);
    if (endCount > 0) parts.push(`${endCount}个尾帧`);
    const completedCount = splitScenes.filter(isStoryboardSceneCompleted).length;
    const skipInfo = completedCount > 0 ? `（跳过${completedCount}个已完成视频）` : '';
    toast.info(`开始九宫格合并生成：${parts.join('、')}${skipInfo}`);

    const taskPages = paginateMergedFrameTasks(tasks);

    // 生成九宫格图片并切割（支持混合首帧+尾帧任务）
    const generateGridAndSlice = createStoryboardMergedPageGenerator({
      aspect,
      resolution: storyboardConfig.resolution || defaultStoryboardResolution,
      fullStylePrompt,
      fullStyleNegative,
      model,
      apiKey,
      imageBaseUrl,
      keyManager,
      signal: mergedSignal,
      getSceneCharacterContexts,
      getSceneIdentityLockLines,
      processReferenceImagesForApi,
      updateFirstFrameStatus: updateSplitSceneImageStatus,
      updateEndFrameStatus: updateSplitSceneEndFrameStatus,
      folderId: getImageFolderId,
      projectId: mediaProjectId,
      persistImage: persistSceneImage,
      updateFirstFrame: updateSplitSceneImage,
      updateEndFrame: updateSplitSceneEndFrame,
      addMedia: addMediaFromUrl,
    });
    // 辅助：重置一页中所有任务的状态为 failed
    const resetPageTasksToError = (pageTasks: GridTask[], errorMsg: string) => {
      for (const task of pageTasks) {
        if (task.type === 'end') {
          updateSplitSceneEndFrameStatus(task.scene.id, { endFrameStatus: 'failed', endFrameProgress: 0, endFrameError: errorMsg });
        } else {
          updateSplitSceneImageStatus(task.scene.id, { imageStatus: 'failed', imageProgress: 0, imageError: errorMsg });
        }
      }
    };

    await runStoryboardMergedPages({
      pages: taskPages,
      signal: mergedSignal,
      isAborted: () => mergedAbortRef.current,
      getTaskType: (task) => task.type,
      collectReferences: (pageTasks) => collectOptimizedMergedFrameReferenceImages(pageTasks, {
        strategy,
        model,
        exemplar,
        getCharacterReferenceImages,
      }),
      generatePage: generateGridAndSlice,
      resetPageTasksToError,
      waitForRetry: waitForAbortableDelay,
      finish: finishMergedGeneration,
      setRunning: setIsMergedRunning,
      notify: toast,
    });
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    splitScenes,
    storyboardConfig,
    currentStyleId,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
    getSceneCharacterContexts,
    getSceneIdentityLockLines,
    getCharacterReferenceImages,
    processReferenceImagesForApi,
    getImageFolderId,
    addMediaFromUrl,
    mediaProjectId,
    startMergedGeneration,
    finishMergedGeneration,
  ]);

  // 尾帧生成由共享领域控制器负责，Director 只注入身份锁和参考图策略。
  const handleGenerateEndFrameImage = useMemo(
    () => createStoryboardEndFrameGenerator({
      getScene: (sceneId) => splitScenes.find((scene) => scene.id === sceneId),
      aspectRatio: storyboardConfig.aspectRatio || defaultStoryboardAspectRatio,
      resolution: storyboardConfig.resolution || defaultStoryboardResolution,
      prepareRequest: async ({ scene, model, promptToUse }) => {
        const fullStylePrompt = getStylePrompt(currentStyleId);
        let prompt = fullStylePrompt ? `${promptToUse}. Style: ${fullStylePrompt}` : promptToUse;
        const sceneCharacterRefs = getCharacterReferenceImages(scene.characterIds || [], scene.characterVariationMap);
        prompt = buildPromptWithIdentityLock(prompt, scene, model, sceneCharacterRefs.length > 0);

        const startFrameAnchor = scene.imageDataUrl || scene.imageHttpUrl || undefined;
        const endFrameSceneRef = scene.endFrameSceneReferenceImage || scene.sceneReferenceImage || undefined;
        const optimizedReferenceImages = optimizeReferenceImagesForModel(model, [
          { kind: "scene", images: endFrameSceneRef ? [endFrameSceneRef] : [] },
          { kind: "anchor", images: startFrameAnchor ? [startFrameAnchor] : [] },
          { kind: "character", images: sceneCharacterRefs },
        ]);
        const apiReferenceImages = await processReferenceImagesForApi(optimizedReferenceImages, "[EndFrame]");

        const fallbackReferences: string[] = [];
        if (endFrameSceneRef) fallbackReferences.push(endFrameSceneRef);
        if (scene.imageDataUrl) fallbackReferences.push(scene.imageDataUrl);
        fallbackReferences.push(...sceneCharacterRefs);
        const processedFallbackReferences = await processReferenceImagesForApi(
          fallbackReferences.slice(0, 14),
          "[SplitScenes]",
          false,
        );

        return {
          prompt,
          referenceImages: apiReferenceImages.length > 0 ? apiReferenceImages : processedFallbackReferences,
        };
      },
      updateStatus: updateSplitSceneEndFrameStatus,
      updateEndFrame: updateSplitSceneEndFrame,
      setGenerating: setIsGenerating,
      folderId: getImageFolderId,
      projectId: mediaProjectId,
      addMedia: addMediaFromUrl,
      createAbortController: () => {
        const controller = new AbortController();
        endFrameAbortRef.current = controller;
        return controller;
      },
    }),
// eslint-disable-next-line react-hooks/exhaustive-deps
    [
      splitScenes,
      storyboardConfig.aspectRatio,
      storyboardConfig.resolution,
      defaultStoryboardAspectRatio,
      defaultStoryboardResolution,
      currentStyleId,
      updateSplitSceneEndFrame,
      updateSplitSceneEndFrameStatus,
      getImageFolderId,
      addMediaFromUrl,
      mediaProjectId,
      getCharacterReferenceImages,
      buildPromptWithIdentityLock,
      processReferenceImagesForApi,
    ],
  );

  return { handleGenerateSingleImage, handleMergedGenerate, handleGenerateEndFrameImage };
}
