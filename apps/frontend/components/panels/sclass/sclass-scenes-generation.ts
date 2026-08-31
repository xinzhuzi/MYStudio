/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * S-Class 分镜生成动作钩子——单图/九宫格合并/尾帧三块生成工厂接线。
 * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;
 * 闭包引用经 ctx 注入(目录=原 deps 数组+通读核验);any 为迁移期务实妥协。
 */
import { useMemo, useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";
import { readImageAsBase64 } from '@/lib/media/image-storage';
import { persistSceneImage } from "@/lib/utils/image-persist";
import { normalizeStoryboardReferenceImages } from "@/components/features/storyboard/storyboard-reference-image-normalizer";
import { collectMergedFrameReferenceImages } from "@/components/features/storyboard/storyboard-merged-reference-utils";
import { runStoryboardMergedPages } from "@/components/features/storyboard/storyboard-merged-page-controller";
import { createStoryboardSingleImageGenerator } from "@/components/features/storyboard/storyboard-single-image-generation";
import { createSClassMergedPageGenerator } from "./sclass-merged-page-generation";
import { createSClassEndFrameGenerator } from "./sclass-end-frame-generation";
import {
  buildMergedFrameTasks,
  isStoryboardSceneCompleted,
  paginateMergedFrameTasks,
  type MergedFrameTask as GridTask,
} from "@/components/features/storyboard/storyboard-merged-grid-utils";

export function useSClassScenesGeneration(ctx: {
  splitScenes: any;
  storyboardConfig: any;
  storyboardImage: any;
  defaultAspectRatio: any;
  defaultResolution: any;
  currentStyleId: any;
  getStylePrompt: any;
  getStyleNegativePrompt: any;
  getCharacterReferenceImages: any;
  updateSplitSceneImage: any;
  updateSplitSceneImageStatus: any;
  updateSplitSceneEndFrame: any;
  updateSplitSceneEndFrameStatus: any;
  autoSaveImageToLibrary: any;
  setIsGenerating: any;
  setIsMergedRunning: any;
  startMergedGeneration: any;
  finishMergedGeneration: any;
  mergedAbortRef: any;
  getImageFolderId: any;
  mediaProjectId: any;
  addMediaFromUrl: any;
  setLastGridImage: any;
}) {
  const {
    splitScenes,
    storyboardConfig,
    storyboardImage,
    defaultAspectRatio,
    defaultResolution,
    currentStyleId,
    getStylePrompt,
    getStyleNegativePrompt,
    getCharacterReferenceImages,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
    autoSaveImageToLibrary,
    setIsGenerating,
    setIsMergedRunning,
    startMergedGeneration,
    finishMergedGeneration,
    mergedAbortRef,
    getImageFolderId,
    mediaProjectId,
    addMediaFromUrl,
    setLastGridImage,
  } = ctx;

  // 单图传输由共享控制器负责，S-Class 只提供提示词和参考图适配器。
  const handleGenerateSingleImage = useMemo(
    () => createStoryboardSingleImageGenerator({
      getScene: (sceneId) => splitScenes.find((scene) => scene.id === sceneId),
      aspectRatio: storyboardConfig.aspectRatio || defaultAspectRatio,
      resolution: storyboardConfig.resolution || defaultResolution,
      prepareRequest: async ({ scene, promptToUse }) => {
        const stylePrompt = getStylePrompt(currentStyleId);
        const prompt = stylePrompt ? `${promptToUse}. Style: ${stylePrompt}` : promptToUse;
        const referenceImages: string[] = [];
        if (scene.sceneReferenceImage) referenceImages.push(scene.sceneReferenceImage);
        if (scene.characterIds?.length) {
          referenceImages.push(...getCharacterReferenceImages(scene.characterIds, scene.characterVariationMap));
        } else if (storyboardConfig.characterReferenceImages?.length) {
          referenceImages.push(...storyboardConfig.characterReferenceImages);
        }
        if (storyboardImage) referenceImages.push(storyboardImage);
        const processedReferences = await normalizeStoryboardReferenceImages(referenceImages, {
          readLocalImage: readImageAsBase64,
          max: 14,
          onReadError: (url, error) => console.warn('[SplitScenes] Failed to read local image:', url, error),
        });
        return { prompt, referenceImages: processedReferences };
      },
      updateStatus: updateSplitSceneImageStatus,
      updateImage: updateSplitSceneImage,
      autoSaveImage: autoSaveImageToLibrary,
      setGenerating: setIsGenerating,
    }),
// eslint-disable-next-line react-hooks/exhaustive-deps
    [
      splitScenes,
      storyboardConfig,
      storyboardImage,
      defaultAspectRatio,
      defaultResolution,
      currentStyleId,
      updateSplitSceneImage,
      updateSplitSceneImageStatus,
      autoSaveImageToLibrary,
      getCharacterReferenceImages,
    ],
  );

  // Shared merged-grid prompt rules live in storyboard-merged-grid-utils.
 
  const handleMergedGenerate = useCallback(async (mode: 'first'|'last'|'both', strategy: 'cluster'|'minimal'|'none' = 'cluster', _exemplar: boolean = true) => {
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

    const aspect = storyboardConfig.aspectRatio || defaultAspectRatio;
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

    const generateGridAndSlice = createSClassMergedPageGenerator({
      aspect,
      fullStylePrompt,
      fullStyleNegative,
      model,
      apiKey,
      imageBaseUrl,
      resolution: storyboardConfig.resolution || defaultResolution,
      keyManager,
      signal: mergedSignal,
      updateFirstFrameStatus: updateSplitSceneImageStatus,
      updateEndFrameStatus: updateSplitSceneEndFrameStatus,
      folderId: getImageFolderId,
      projectId: mediaProjectId,
      persistImage: persistSceneImage,
      updateFirstFrame: updateSplitSceneImage,
      updateEndFrame: updateSplitSceneEndFrame,
      addMedia: addMediaFromUrl,
      setLastGridImage,
      readImage: readImageAsBase64,
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
      collectReferences: (pageTasks) => collectMergedFrameReferenceImages(pageTasks, {
        strategy,
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
    defaultAspectRatio,
    defaultResolution,
    currentStyleId,
    mediaProjectId,
    getImageFolderId,
    persistSceneImage,
    addMediaFromUrl,
    getCharacterReferenceImages,
    readImageAsBase64,
    setLastGridImage,
    mergedAbortRef,
    setIsMergedRunning,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
    startMergedGeneration,
    finishMergedGeneration,
    getStylePrompt,
    getStyleNegativePrompt,
  ]);

  // Generate end frame image for a single scene using image API
  const handleGenerateEndFrameImage = useMemo(
    () => createSClassEndFrameGenerator({
      getScene: (sceneId) => splitScenes.find((scene) => scene.id === sceneId),
      currentStyleId,
      aspectRatio: storyboardConfig.aspectRatio || defaultAspectRatio,
      resolution: storyboardConfig.resolution || defaultResolution,
      readImage: readImageAsBase64,
      getCharacterReferenceImages,
      updateStatus: updateSplitSceneEndFrameStatus,
      updateEndFrame: updateSplitSceneEndFrame,
      setGenerating: setIsGenerating,
      folderId: getImageFolderId,
      projectId: mediaProjectId,
      addMedia: addMediaFromUrl,
    }),
    [
      splitScenes,
      currentStyleId,
      storyboardConfig.aspectRatio,
      storyboardConfig.resolution,
      defaultAspectRatio,
      defaultResolution,
      getCharacterReferenceImages,
      updateSplitSceneEndFrameStatus,
      updateSplitSceneEndFrame,
      setIsGenerating,
      getImageFolderId,
      mediaProjectId,
      addMediaFromUrl,
    ],
  );

  return { handleGenerateSingleImage, handleMergedGenerate, handleGenerateEndFrameImage };
}
