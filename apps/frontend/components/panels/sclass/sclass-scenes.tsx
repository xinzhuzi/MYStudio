// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 分镜组件 (Split Scenes Component)
 * 显示分镜切割结果，支持编辑提示词、上传尾帧、选择角色库、添加情绪标签
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { 
  useDirectorStore, 
  useActiveDirectorProject,
  type SplitScene, 
  type EmotionTag,
  EMOTION_PRESETS,
  SHOT_SIZE_PRESETS,
  SOUND_EFFECT_PRESETS,
} from "@/stores/director-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { 
  ArrowLeft, 
  Play,
  ImageIcon,
  AlertCircle,
  Loader2,
  Sparkles,
  Clapperboard,
  Film,
  Square,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaStore } from "@/stores/media-store";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";
import { useMergedGenerationCancellation } from "@/hooks/use-merged-generation-cancellation";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { readImageAsBase64 } from '@/lib/image-storage';
import { persistSceneImage } from '@/lib/utils/image-persist';
import { SClassSceneCard } from "./sclass-scene-card";
import { SceneVoiceBatchToolbar } from "../director/scene-voice-batch-toolbar";
import { ShotGroupCard } from "./shot-group";
import { useSClassStore, type SClassAspectRatio } from "@/stores/sclass-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useSClassGeneration, type BatchGenerationProgress } from "./use-sclass-generation";
import { ExtendEditDialog } from "./extend-edit-dialog";
import { useSClassGroupingController } from "./use-sclass-grouping-controller";
import { useSceneStore } from "@/stores/scene-store";
import { Music } from "lucide-react";
import { 
  VISUAL_STYLE_PRESETS, 
  STYLE_CATEGORIES,
  getStyleById, 
  getStylePrompt,
  getStyleNegativePrompt,
  DEFAULT_STYLE_ID 
} from "@/lib/constants/visual-styles";
import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from "@/lib/constants/cinematography-profiles";
import { buildEmotionDescription as buildEmotionDesc } from "@/lib/generation/prompt-builder";
import { normalizeHorizontalVerticalAspectRatio } from "@/lib/ai/image-size-presets";
import { useStoryboardGenerationUi } from "../director/use-storyboard-generation-ui";
import { useStoryboardMediaLibrary } from "../director/use-storyboard-media-library";
import { saveStoryboardSceneToLibrary } from "../director/storyboard-media-library-actions";
import { useStoryboardSceneActions } from "../director/use-storyboard-scene-actions";
import { StoryboardGenerationDialogs } from "../director/storyboard-generation-dialogs";
import { useStoryboardAngleSwitch } from "../director/use-storyboard-angle-switch";
import { useStoryboardResultActions } from "../director/use-storyboard-result-actions";
import { useStoryboardPromptGeneration } from "../director/use-storyboard-prompt-generation";
import { useStoryboardVideoLastFrame } from "../director/use-storyboard-video-last-frame";
import { normalizeStoryboardReferenceImages } from "../director/storyboard-reference-image-normalizer";
import { collectMergedFrameReferenceImages } from "../director/storyboard-merged-reference-utils";
import { runStoryboardMergedPages } from "../director/storyboard-merged-page-controller";
import { createSClassMergedPageGenerator } from "./sclass-merged-page-generation";
import { StoryboardConfigToolbar } from "../director/storyboard-config-toolbar";
import { StoryboardMergedGenerationControls } from "../director/storyboard-merged-generation-controls";
import { SClassGenerationModeToggle } from "./sclass-generation-mode-toggle";
import { SClassStoryboardConfigToolbar } from "./sclass-storyboard-config-toolbar";
import { SClassTrailerScenesPanel } from "./sclass-trailer-scenes-panel";
import { useSClassQuadGridController } from "./use-sclass-quad-grid-controller";
import { createSClassLegacyVideoGenerator } from "./sclass-legacy-video-generation";
import { createSClassSingleVideoGenerator } from "./sclass-single-video-generation";
import { createSClassEndFrameGenerator } from "./sclass-end-frame-generation";
import { createStoryboardSingleImageGenerator } from "../director/storyboard-single-image-generation";
import {
  allocateStoryboardAngles as allocateAngles,
  buildMergedFrameTasks,
  calculateMergedGridAspectRatio as calculateGridAspectRatio,
  isStoryboardSceneCompleted,
  paginateMergedFrameTasks,
  composeStoryboardTilePrompt as composeTilePrompt,
  type MergedFrameTask as GridTask,
} from "../director/storyboard-merged-grid-utils";

interface SplitScenesProps {
  onBack?: () => void;
  onGenerateVideos?: () => void;
}

// SceneCard 使用 S级专属版本 SClassSceneCard
const SceneCard = SClassSceneCard;
const formatSClassDeletedSceneNumber = (sceneId: number) => sceneId;

export function SClassScenes({ onBack, onGenerateVideos }: SplitScenesProps) {
  const storyboardUi = useStoryboardGenerationUi({ defaultImageGenMode: "single" });
  const {
    imageGenMode, setImageGenMode,
    frameMode, setFrameMode,
    isMergedRunning, setIsMergedRunning,
    refStrategy, setRefStrategy,
    useExemplar, setUseExemplar,
    isGenerating, setIsGenerating,
    isGeneratingPrompts, setIsGeneratingPrompts,
    currentGeneratingId, setCurrentGeneratingId,
    activeTab, setActiveTab,
    angleSwitchOpen,
    angleSwitchResultOpen, setAngleSwitchResultOpen,
    angleSwitchTarget, setAngleSwitchTarget,
    angleSwitchResult, setAngleSwitchResult,
    selectedHistoryIndex, setSelectedHistoryIndex,
    isAngleSwitching,
    isExtractingFrame, setIsExtractingFrame,
    quadGridOpen, setQuadGridOpen,
    quadGridResultOpen, setQuadGridResultOpen,
    quadGridTarget, setQuadGridTarget,
    quadGridResult, setQuadGridResult,
    isQuadGridGenerating, setIsQuadGridGenerating,
  } = storyboardUi;
  const PAGE_CONCURRENCY = 2; // 每页并发集群数限制
  // 合并生成停止控制
  const {
    cancelledRef: mergedAbortRef,
    start: startMergedGeneration,
    stop: stopMergedGeneration,
    finish: finishMergedGeneration,
  } = useMergedGenerationCancellation();
  // Get current project data
  const projectData = useActiveDirectorProject();
  const imageGenerationSettings = useAppSettingsStore((state) => state.imageGenerationSettings);
  const defaultAspectRatio = normalizeHorizontalVerticalAspectRatio(imageGenerationSettings.defaultAspectRatio);
  const defaultResolution = imageGenerationSettings.defaultResolution;
  
  // Read from project data (with defaults)
  const splitScenes = projectData?.splitScenes || [];
  const storyboardStatus = projectData?.storyboardStatus || 'idle';
  const storyboardImage = projectData?.storyboardImage || null;
  const storyboardConfig = projectData?.storyboardConfig || {
    aspectRatio: defaultAspectRatio,
    resolution: defaultResolution,
    videoResolution: '480p' as const,
    sceneCount: 5,
    storyPrompt: '',
    styleTokens: [],
    characterReferenceImages: [],
    characterDescriptions: [],
  };
  const projectFolderId = projectData?.projectFolderId || null;
  // 预告片数据 - 直接从 splitScenes 筛选，保证功能一致
  const trailerConfig = projectData?.trailerConfig || null;
  const trailerShotIds = trailerConfig?.shotIds || [];
  
  // Debug: log raw data on every render (dev only)
  if (process.env.NODE_ENV === 'development') {
    console.log('[SplitScenes] Raw data:', {
      storyboardStatus,
      splitScenesLength: splitScenes.length,
      splitScenesIds: splitScenes.map(s => s.id),
      trailerConfigStatus: trailerConfig?.status,
      trailerShotIds,
      styleTokens: storyboardConfig.styleTokens,
      aspectRatio: storyboardConfig.aspectRatio,
      sceneCount: storyboardConfig.sceneCount,
    });
  }
  
  // 筛选预告片分镜：通过 sceneName 包含 "预告片" 关键字来识别
  const trailerScenes = useMemo(() => {
    // 通过 sceneName 包含 "预告片" 来筛选
    const filtered = splitScenes.filter(scene => {
      const sceneName = scene.sceneName || '';
      return sceneName.includes('预告片');
    });
    console.log('[SplitScenes] Trailer filter by sceneName:', {
      totalScenes: splitScenes.length,
      filteredCount: filtered.length,
      filteredNames: filtered.map(s => s.sceneName),
    });
    return filtered;
  }, [splitScenes]);

  const {
    activeProjectId,
    setStoryboardConfig,
    // Three-tier prompt methods
    updateSplitSceneImagePrompt,
    updateSplitSceneVideoPrompt,
    updateSplitSceneEndFramePrompt,
    updateSplitSceneNeedsEndFrame,
    // Other scene update methods
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneVideo,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
    // 场景库关联更新方法
    updateSplitSceneReference,
    updateSplitSceneEndFrameReference,
    // 通用字段更新方法（用于双击编辑）
    updateSplitSceneField,
    // 视角切换历史
    addAngleSwitchHistory,
    deleteSplitScene,
    // 预告片功能
    clearTrailer,
    // 摄影风格档案
    setCinematographyProfileId,
  } = useDirectorStore();
  const mediaProjectId = activeProjectId || undefined;
  const {
    updateEndFrame: handleUpdateEndFrame,
    updateCharacters: handleUpdateCharacters,
    updateCharacterVariationMap: handleUpdateCharacterVariationMap,
    updateEmotions: handleUpdateEmotions,
    updateShotSize: handleUpdateShotSize,
    updateDuration: handleUpdateDuration,
    updateAmbientSound: handleUpdateAmbientSound,
    updateSoundEffects: handleUpdateSoundEffects,
    deleteScene: handleDeleteScene,
    removeImage: handleRemoveImage,
    uploadImage: handleUploadImage,
    goBack: handleBack,
  } = useStoryboardSceneActions({
    scenes: splitScenes,
    onBack,
    formatDeletedSceneNumber: formatSClassDeletedSceneNumber,
  });

  const setLastGridImage = useSClassStore((state) => state.setLastGridImage);

  // S级 Seedance 2.0 生成 hook
  const {
    generateGroupVideo,
    generateAllGroups,
    generateSingleShot,
    abortGeneration: abortSClassGeneration,
    retryGroup,
    generateChainExtension,
  } = useSClassGeneration();
  const [batchProgress, setBatchProgress] = useState<BatchGenerationProgress | null>(null);
  const sceneLibrary = useSceneStore((state) => state.scenes);
  const allCharacters = useCharacterLibraryStore((state) => state.characters);
  const {
    generationMode: sclassGenMode,
    setGenerationMode: setSclassGenMode,
    shotGroups,
    sceneMap,
    isBatchCalibrationDisabled,
    batchCalibrate,
    regroup,
    calibrateGroup,
    generateGroup,
    openExtendEdit,
    extendEditOpen,
    setExtendEditOpen,
    extendEditMode,
    extendEditSourceGroup,
    confirmExtendEdit,
  } = useSClassGroupingController({
    splitScenes,
    allCharacters,
    sceneLibrary,
    generateGroupVideo,
    setIsGenerating,
  });
  // Get current style from config
  // 优先使用直接存储的 visualStyleId，回退到 styleTokens 反推（兼容旧项目）
  const currentStyleId = useMemo(() => {
    if (storyboardConfig.visualStyleId) {
      return storyboardConfig.visualStyleId;
    }
    // 向后兼容：将 styleTokens 合并后匹配 prompt 前缀
    if (storyboardConfig.styleTokens && storyboardConfig.styleTokens.length > 0) {
      const joinedTokens = storyboardConfig.styleTokens.join(', ');
      const found = VISUAL_STYLE_PRESETS.find(s => s.prompt.startsWith(joinedTokens));
      return found?.id || "";
    }
    return "";
  }, [storyboardConfig.visualStyleId, storyboardConfig.styleTokens]);

  // 读取当前摄影风格档案（未设置时使用默认经典电影摄影风格）
  const currentCinProfileId = projectData?.cinematographyProfileId || DEFAULT_CINEMATOGRAPHY_PROFILE_ID;

  // 切换摄影风格档案
  const handleCinProfileChange = useCallback((profileId: string) => {
    setCinematographyProfileId(profileId || undefined);
    toast.success('摄影风格已更新');
  }, [setCinematographyProfileId]);

  // Update style
  const handleStyleChange = useCallback((styleId: string) => {
    if (!styleId) {
      setStoryboardConfig({ visualStyleId: undefined, styleTokens: [] });
      toast.success('已清除视觉风格');
      return;
    }
    const style = getStyleById(styleId);
    if (style) {
      // 直接存储风格 ID，同时保留 styleTokens（完整 prompt）兼容旧逻辑
      setStoryboardConfig({ visualStyleId: styleId, styleTokens: [style.prompt] });
      toast.success(`已切换为 ${style.name} 风格`);
    }
  }, [setStoryboardConfig]);

  const handleAspectRatioChange = useCallback((ratio: SClassAspectRatio) => {
    setStoryboardConfig({ aspectRatio: ratio as '16:9' | '9:16' });
    toast.success(`画幅比已切换为 ${ratio}`);
  }, [setStoryboardConfig]);

  const { getProviderByPlatform, concurrency } = useAPIConfigStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  const {
    saveVideo: autoSaveVideoToLibrary,
    saveImage: autoSaveImageToLibrary,
  } = useStoryboardMediaLibrary(mediaProjectId);
  
  // Get system category folder IDs for auto-saving (images → AI图片, videos → AI视频)
  const getImageFolderId = useCallback(() => getOrCreateCategoryFolder('ai-image'), [getOrCreateCategoryFolder]);
  const getVideoFolderId = useCallback(() => getOrCreateCategoryFolder('ai-video'), [getOrCreateCategoryFolder]);

  const { extractVideoLastFrame: handleExtractVideoLastFrame } = useStoryboardVideoLastFrame({
    scenes: splitScenes,
    setIsExtractingFrame,
    updateSplitSceneImage,
  });

  // ========== 停止生成处理函数 ==========
  // 停止首帧图片生成
  const handleStopImageGeneration = useCallback((sceneId: number) => {
    updateSplitSceneImageStatus(sceneId, {
      imageStatus: 'idle',
      imageProgress: 0,
      imageError: '用户已取消',
    });
    setIsGenerating(false);
    setCurrentGeneratingId(null);
    toast.info(`分镜 ${sceneId + 1} 首帧生成已停止`);
  }, [updateSplitSceneImageStatus]);

  // 停止视频生成
  const handleStopVideoGeneration = useCallback((sceneId: number) => {
    updateSplitSceneVideo(sceneId, {
      videoStatus: 'idle',
      videoProgress: 0,
      videoError: '用户已取消',
    });
    setIsGenerating(false);
    setCurrentGeneratingId(null);
    toast.info(`分镜 ${sceneId + 1} 视频生成已停止`);
  }, [updateSplitSceneVideo]);

  // 停止尾帧图片生成
  const handleStopEndFrameGeneration = useCallback((sceneId: number) => {
    updateSplitSceneEndFrameStatus(sceneId, {
      endFrameStatus: 'idle',
      endFrameProgress: 0,
      endFrameError: '用户已取消',
    });
    setIsGenerating(false);
    toast.info(`分镜 ${sceneId + 1} 尾帧生成已停止`);
  }, [updateSplitSceneEndFrameStatus]);

  // 停止合并生成
  const handleStopMergedGeneration = useCallback(() => {
    stopMergedGeneration();
    setIsMergedRunning(false);
    toast.info('合并生成已停止');
  }, [stopMergedGeneration]);

  const getLatestSClassScenes = useCallback(() => splitScenes, [splitScenes]);
  const {
    openAngleSwitch: handleAngleSwitchClick,
    generate: handleAngleSwitchGenerate,
  } = useStoryboardAngleSwitch({
    scenes: splitScenes,
    controller: storyboardUi,
    getProviderByPlatform,
    addHistory: addAngleSwitchHistory,
    getLatestScenes: getLatestSClassScenes,
  });
  const {
    handleApplyQuadGrid,
    handleCopyQuadGridToScene,
    handleSaveQuadGridToLibrary,
    handleSaveAllQuadGridToLibrary,
    handleApplyAngleSwitch,
  } = useStoryboardResultActions({
    scenes: splitScenes,
    controller: storyboardUi,
    mediaProjectId,
    getImageFolderId,
    addMediaFromUrl,
    updateSplitSceneImage,
    updateSplitSceneEndFrame,
  });
  const handleAutoGeneratePrompts = useStoryboardPromptGeneration({
    storyboardImage,
    scenes: splitScenes,
    storyboardConfig,
    setIsGeneratingPrompts,
    updateSplitSceneImagePrompt,
    updateSplitSceneVideoPrompt,
    updateSplitSceneEndFramePrompt,
    updateSplitSceneNeedsEndFrame,
  });

  // 根据情绪标签生成氛围描述 - 使用统一 prompt-builder 模块
  const buildEmotionDescription = useCallback((emotionTags: EmotionTag[]): string => {
    return buildEmotionDesc(emotionTags);
  }, []);

  const {
    getCharacterReferenceImages,
    handleQuadGridClick,
    handleQuadGridGenerate,
  } = useSClassQuadGridController({
    scenes: splitScenes,
    storyboardConfig,
    defaultAspectRatio,
    defaultResolution,
    controller: storyboardUi,
    mediaProjectId,
    getImageFolderId,
    addMediaFromUrl,
    buildEmotionDescription,
  });

  /** @deprecated 使用 S级 generateAllGroups 或 handleGenerateSingleVideo 替代 */
  const handleGenerateVideos = useMemo(() => createSClassLegacyVideoGenerator({
    scenes: splitScenes,
    storyboardConfig,
    projectData,
    currentStyleId,
    concurrency,
    setIsGenerating,
    setCurrentGeneratingId,
    updateSplitSceneVideo,
  }), [
    concurrency,
    currentStyleId,
    projectData,
    setCurrentGeneratingId,
    setIsGenerating,
    splitScenes,
    storyboardConfig,
    updateSplitSceneVideo,
  ]);


  // 单场景视频生成由独立控制器负责，入口只注入当前项目状态和回写动作。
  const handleGenerateSingleVideo = useMemo(
    () => createSClassSingleVideoGenerator({
      scenes: splitScenes,
      storyboardConfig,
      projectData,
      currentStyleId,
      setIsGenerating,
      setCurrentGeneratingId,
      updateSplitSceneVideo,
      updateSplitSceneEndFrame,
      autoSaveVideoToLibrary,
      getCharacterReferenceImages,
    }),
    [
      splitScenes,
      storyboardConfig,
      projectData,
      currentStyleId,
      setIsGenerating,
      setCurrentGeneratingId,
      updateSplitSceneVideo,
      updateSplitSceneEndFrame,
      autoSaveVideoToLibrary,
      getCharacterReferenceImages,
    ],
  );

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
    const platform = featureConfig.platform;
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
    
    console.log('[MergedGen] Using config:', { platform, model, imageBaseUrl });

    setIsMergedRunning(true);
    const mergedSignal = startMergedGeneration();
    console.log('[MergedGen] 开始九宫格合并生成, mode:', mode, 'strategy:', strategy, 'exemplar:', exemplar);

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

  // 复用单图生成的 API 路径，封装为通用函数（支持首帧/尾帧）
  // 合并生成专用：使用预计算参考列表；不降级到单图通道
  const generateImageForSceneMerged = async (
    sceneId: number,
    prompt: string,
    apiKey: string,
    aspect: '16:9'|'9:16',
    isEndFrame: boolean,
    refUrls: string[],
    strategy: 'cluster'|'minimal'|'none'
  ): Promise<{ finalBase64?: string; directUrl?: string } | void> => {
    if (isEndFrame) {
      updateSplitSceneEndFrameStatus(sceneId, { endFrameStatus: 'generating', endFrameProgress: 0, endFrameError: null });
    } else {
      updateSplitSceneImageStatus(sceneId, { imageStatus: 'generating', imageProgress: 0, imageError: null });
    }
    // 使用服务映射配置
    const featureConfig = aiManager.featureConfig('character_generation');
    if (!featureConfig) {
      throw new Error('请先在设置中配置图片生成服务映射');
    }
    const platform = featureConfig.platform;
    const model = featureConfig.models?.[0];
    if (!model) {
      throw new Error('请先在设置中配置图片生成模型');
    }
    const apiKeyToUse = apiKey || featureConfig.keyManager.getCurrentKey() || '';
    if (!apiKeyToUse) {
      throw new Error('请先在设置中配置图片生成服务映射');
    }
    const imageBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
    if (!imageBaseUrl) {
      throw new Error('请先在设置中配置图片生成服务映射');
    }

    // Call image generation API with smart routing
    const mergedKeyManager = featureConfig.keyManager;
    const apiResult = await aiManager.imageGrid({
      model,
      prompt,
      apiKey: apiKeyToUse,
      baseUrl: imageBaseUrl,
      aspectRatio: aspect,
      resolution: storyboardConfig.resolution || defaultResolution,
      referenceImages: refUrls && refUrls.length > 0 ? refUrls.slice(0, 14) : undefined,
      keyManager: mergedKeyManager,
    });

    const normalizeUrlValue = (url: any): string | undefined => Array.isArray(url) ? (url[0] || undefined) : (typeof url === 'string' ? url : undefined);
    let directUrl = apiResult.imageUrl;
    let taskId: string | undefined = apiResult.taskId;

    if (!taskId && !directUrl) {
      // 对非常规响应：尝试一次"无参考"重试（保持合并模式，不降级到单图通道）
      if (refUrls.length > 0 && strategy !== 'none') {
        const retryResult = await aiManager.imageGrid({
          model,
          prompt,
          apiKey: apiKeyToUse,
          baseUrl: imageBaseUrl,
          aspectRatio: aspect,
          keyManager: mergedKeyManager,
        });
        directUrl = retryResult.imageUrl;
        taskId = retryResult.taskId;
      }
      if (!taskId && !directUrl) throw new Error('Invalid image task response');
    }

    if (!directUrl && taskId) {
      const pollInterval = 2000, maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const progress = Math.min(Math.floor((attempt / maxAttempts) * 100), 99);
        if (isEndFrame) updateSplitSceneEndFrameStatus(sceneId, { endFrameProgress: progress });
        else updateSplitSceneImageStatus(sceneId, { imageProgress: progress });
        const url = new URL(`${imageBaseUrl}/v1/tasks/${taskId}`);
        url.searchParams.set('_ts', Date.now().toString());
        const statusResp = await fetch(url.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${apiKeyToUse}`, 'Cache-Control': 'no-cache' } });
        if (!statusResp.ok) throw new Error(`Failed to check task status: ${statusResp.status}`);
        const statusData = await statusResp.json();
        const status = (statusData.status ?? statusData.data?.status ?? 'unknown').toString().toLowerCase();
        if (status === 'completed' || status === 'succeeded' || status === 'success') {
          const images = statusData.result?.images ?? statusData.data?.result?.images;
          if (images?.[0]) directUrl = normalizeUrlValue(images[0].url || images[0]);
          directUrl = directUrl || normalizeUrlValue(statusData.output_url) || normalizeUrlValue(statusData.result_url) || normalizeUrlValue(statusData.url);
          break;
        }
        if (status === 'failed' || status === 'error') throw new Error((statusData.error || statusData.message || 'image generation failed').toString());
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }

    if (!directUrl) throw new Error('任务完成但没有图片 URL');

    const frameType = isEndFrame ? 'end' as const : 'first' as const;
    const persistResult = await persistSceneImage(directUrl, sceneId, frameType);

    if (isEndFrame) {
      updateSplitSceneEndFrame(sceneId, persistResult.localPath, 'ai-generated', persistResult.httpUrl || directUrl);
    } else {
      const sceneObj = splitScenes.find(s => s.id === sceneId)!;
      updateSplitSceneImage(sceneId, persistResult.localPath, sceneObj.width, sceneObj.height, persistResult.httpUrl || directUrl);
    }
    return { finalBase64: persistResult.localPath, directUrl };
  };

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
  // Save to media library (image or video) - uses system category folders
  const handleSaveToLibrary = useCallback(async (scene: SplitScene, type: 'image' | 'video') => {
    saveStoryboardSceneToLibrary({
      scene,
      type,
      projectId: mediaProjectId,
      addMediaFromUrl,
      getImageFolderId,
      getVideoFolderId,
    });
  }, [addMediaFromUrl, getImageFolderId, getVideoFolderId, mediaProjectId]);

  // Show empty state
  if (storyboardStatus !== 'editing' || splitScenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">暂无切割的分镜</p>
        {onBack && (
          <Button variant="outline" onClick={onBack} className="mt-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
        )}
      </div>
    );
  }

  const renderSceneCard = (scene: SplitScene) => (
    <SceneCard
      key={scene.id}
      scene={scene}
      onUpdateImagePrompt={(id, prompt, promptZh) => updateSplitSceneImagePrompt(id, prompt, promptZh)}
      onUpdateVideoPrompt={(id, prompt, promptZh) => updateSplitSceneVideoPrompt(id, prompt, promptZh)}
      onUpdateEndFramePrompt={(id, prompt, promptZh) => updateSplitSceneEndFramePrompt(id, prompt, promptZh)}
      onUpdateNeedsEndFrame={(id, needsEndFrame) => updateSplitSceneNeedsEndFrame(id, needsEndFrame)}
      onUpdateEndFrame={handleUpdateEndFrame}
      onUpdateCharacters={handleUpdateCharacters}
      onUpdateCharacterVariationMap={handleUpdateCharacterVariationMap}
      onUpdateEmotions={handleUpdateEmotions}
      onUpdateShotSize={handleUpdateShotSize}
      onUpdateDuration={handleUpdateDuration}
      onUpdateAmbientSound={handleUpdateAmbientSound}
      onUpdateSoundEffects={handleUpdateSoundEffects}
      onUpdateSceneReference={(id, sceneLibId, viewpointId, refImage, subViewId) => updateSplitSceneReference(id, sceneLibId, viewpointId, refImage, subViewId)}
      onUpdateEndFrameSceneReference={(id, sceneLibId, viewpointId, refImage, subViewId) => updateSplitSceneEndFrameReference(id, sceneLibId, viewpointId, refImage, subViewId)}
      onDelete={handleDeleteScene}
      onSaveToLibrary={handleSaveToLibrary}
      onGenerateImage={handleGenerateSingleImage}
      onGenerateVideo={handleGenerateSingleVideo}
      onGenerateEndFrame={handleGenerateEndFrameImage}
      onRemoveImage={handleRemoveImage}
      onUploadImage={handleUploadImage}
      onUpdateField={(id, field, value) => updateSplitSceneField(id, field, value)}
      onAngleSwitch={handleAngleSwitchClick}
      onQuadGrid={handleQuadGridClick}
      onExtractVideoLastFrame={handleExtractVideoLastFrame}
      onStopImageGeneration={handleStopImageGeneration}
      onStopVideoGeneration={handleStopVideoGeneration}
      onStopEndFrameGeneration={handleStopEndFrameGeneration}
      isExtractingFrame={isExtractingFrame}
      isAngleSwitching={isAngleSwitching}
      isQuadGridGenerating={isQuadGridGenerating}
      isGeneratingAny={isGenerating}
    />
  );

  return (
    <div className="space-y-4">
      {/* 顶部 Tab 切换 */}
      <div className="border-b -mx-4 px-4 -mt-4 pt-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "editing" | "trailer")} className="w-full">
          <TabsList className="w-full justify-start h-9 rounded-none bg-transparent border-b-0 p-0">
            <TabsTrigger 
              value="editing" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
            >
              <Film className="h-3 w-3 mr-1" />
              分镜编辑
            </TabsTrigger>
            <TabsTrigger 
              value="trailer" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
            >
              <Clapperboard className="h-3 w-3 mr-1" />
              预告片 {trailerScenes.length > 0 ? `(${trailerScenes.length})` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 预告片 Tab 内容 - 完全复用分镜编辑的功能 */}
      {activeTab === "trailer" && (
        <SClassTrailerScenesPanel
          trailerScenes={trailerScenes}
          isGenerating={isGenerating}
          renderSceneCard={renderSceneCard}
          onDeleteScene={deleteSplitScene}
          onClearTrailer={clearTrailer}
          onGenerateVideo={handleGenerateSingleVideo}
          styleId={currentStyleId || ""}
          onStyleChange={handleStyleChange}
          aspectRatio={storyboardConfig.aspectRatio === "9:16" ? "9:16" : "16:9"}
          onAspectRatioChange={handleAspectRatioChange}
          imageResolution={storyboardConfig.resolution || defaultResolution}
          onImageResolutionChange={(resolution) => {
            setStoryboardConfig({ resolution });
            toast.success(`图片分辨率已切换为 ${resolution}`);
          }}
          videoResolution={storyboardConfig.videoResolution || "480p"}
          onVideoResolutionChange={(videoResolution) => {
            setStoryboardConfig({ videoResolution });
            toast.success(`视频分辨率已切换为 ${videoResolution}`);
          }}
          styleTokens={storyboardConfig.styleTokens}
        />
      )}

      {/* 分镜编辑 Tab 内容 */}
      {activeTab === "editing" && (
      <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">分镜编辑</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {splitScenes.length} 个分镜
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="text"
            size="sm"
            onClick={handleBack}
            className="h-7 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            重新生成
          </Button>
        </div>
      </div>

      <SClassStoryboardConfigToolbar
        styleId={currentStyleId || ""}
        onStyleChange={handleStyleChange}
        cinematographyProfileId={currentCinProfileId}
        onCinematographyProfileChange={handleCinProfileChange}
        aspectRatio={storyboardConfig.aspectRatio as SClassAspectRatio}
        onAspectRatioChange={handleAspectRatioChange}
        imageResolution={storyboardConfig.resolution || defaultResolution}
        onImageResolutionChange={(resolution) => {
          setStoryboardConfig({ resolution });
          toast.success(`图片分辨率已切换为 ${resolution}`);
        }}
        videoResolution={storyboardConfig.videoResolution || "480p"}
        onVideoResolutionChange={(videoResolution) => {
          setStoryboardConfig({ videoResolution });
          toast.success(`视频分辨率已切换为 ${videoResolution}`);
        }}
        imageGenerationMode={imageGenMode}
        onImageGenerationModeChange={setImageGenMode}
        styleTokens={storyboardConfig.styleTokens}
        disabled={isGenerating}
      />

      {/* Row 1.5: Seedance 2.0 音频/运镜提示（实际控制复用每个分镜的 per-scene 音频开关） */}
      <div className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-muted/20 border">
        <Music className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">音频/运镜: 复用每个分镜的独立开关（对白 / 音效 / 环境声 / 运镜）自动聚合</span>
        <span className="text-xs text-muted-foreground/60">时长上限 15s · Seedance 2.0</span>
      </div>

      {/* Row 2: 合并生成选项（仅在合并模式下显示） */}
      {imageGenMode === 'merged' && (
        <StoryboardMergedGenerationControls
          frameMode={frameMode}
          onFrameModeChange={setFrameMode}
          refStrategy={refStrategy}
          onRefStrategyChange={setRefStrategy}
          useExemplar={useExemplar}
          onUseExemplarChange={setUseExemplar}
          isGenerating={isGenerating}
          isMergedRunning={isMergedRunning}
          sceneCount={splitScenes.length}
          onGenerate={handleMergedGenerate}
          onStop={handleStopMergedGeneration}
        />
      )}

      {/* Warning if no prompts */}
      {splitScenes.some(s => !s.videoPrompt.trim()) && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <div className="text-xs text-yellow-600 dark:text-yellow-400">
            <p>部分分镜缺少提示词，点击分镜下方的文字区域可编辑。</p>
          </div>
        </div>
      )}

      <SClassGenerationModeToggle
        generationMode={sclassGenMode}
        groupCount={shotGroups.length}
        sceneCount={splitScenes.length}
        isBatchCalibrationDisabled={isBatchCalibrationDisabled}
        onGenerationModeChange={setSclassGenMode}
        onBatchCalibrate={batchCalibrate}
        onRegroup={regroup}
      />

      <SceneVoiceBatchToolbar scenes={splitScenes} />

      {/* ========== 分组模式: ShotGroupCard ========== */}
      {sclassGenMode === 'group' ? (
        <div className="flex flex-col gap-3">
          {shotGroups.map((group, groupIdx) => {
            const groupScenes = group.sceneIds
              .map(id => sceneMap.get(id))
              .filter(Boolean) as SplitScene[];
            return (
              <ShotGroupCard
                key={group.id}
                group={group}
                scenes={groupScenes}
                allScenes={splitScenes}
                groupIndex={groupIdx}
                isGeneratingAny={isGenerating}
                characters={allCharacters}
                sceneLibrary={sceneLibrary}
                onCalibrateGroup={calibrateGroup}
                onGenerateGroupVideo={generateGroup}
                onExtendGroup={(groupId) => openExtendEdit(groupId, 'extend')}
                onEditGroup={(groupId) => openExtendEdit(groupId, 'edit')}
                renderSceneCard={renderSceneCard}
              />
            );
          })}
        </div>
      ) : (
        /* ========== 单镜模式: 平铺 SceneCard ========== */
        <div className="flex flex-col gap-3">
          {splitScenes.map(renderSceneCard)}
        </div>
      )}

      {/* Action buttons — S级组级视频生成 */}
      {(() => {
        const scenesWithImages = splitScenes.filter(s => s.imageDataUrl).length;
        const scenesNeedVideo = splitScenes.filter(s => s.imageDataUrl && (s.videoStatus === 'idle' || s.videoStatus === 'failed')).length;
        const groupsNeedGen = shotGroups.filter(g => g.videoStatus === 'idle' || g.videoStatus === 'failed').length;
        const noImages = scenesWithImages === 0;
        return (
          <div className="flex gap-2 pt-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      if (sclassGenMode === 'group') {
                        // S级组级生成: 调用 Seedance 2.0 API 逐组生成
                        setIsGenerating(true);
                        setBatchProgress(null);
                        generateAllGroups((progress) => setBatchProgress(progress))
                          .finally(() => {
                            setIsGenerating(false);
                            setBatchProgress(null);
                          });
                      } else {
                        // 单镜模式: 使用导演面板原有逻辑
                        handleGenerateVideos();
                      }
                    }}
                    disabled={isGenerating || splitScenes.length === 0 || noImages}
                    className="flex-1"
                    size="lg"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {batchProgress
                          ? `生成中 (${batchProgress.completed}/${batchProgress.total})...`
                          : '生成中...'
                        }
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        {sclassGenMode === 'group'
                          ? `Seedance 2.0 组级生成 (${groupsNeedGen}/${shotGroups.length} 组)`
                          : `生成视频 (${scenesNeedVideo}/${splitScenes.length})`
                        }
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {noImages ? (
                    <p>请先为分镜生成图片，再生成视频</p>
                  ) : sclassGenMode === 'group' ? (
                    <p>{groupsNeedGen} 个组待生成，每组合并多镜头 + @引用 调用 Seedance 2.0，逐组尾帧传递</p>
                  ) : (
                    <p>{scenesWithImages} 个分镜已有图片，{scenesNeedVideo} 个待生成视频</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isGenerating && sclassGenMode === 'group' && (
              <Button
                variant="destructive"
                size="lg"
                onClick={abortSClassGeneration}
              >
                <Square className="h-4 w-4 mr-2" />
                停止
              </Button>
            )}
          </div>
        );
      })()}

      {/* Tips */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
        {sclassGenMode === 'group' ? (
          <p>💡 分组模式：每组 2~4 个镜头合并为一个视频，总时长 ≤15s。点击「重新分组」可重新自动分配。</p>
        ) : (
          <p>💡 单镜模式：每个镜头独立生成一个视频。点击分镜下方的文字区域可编辑提示词。</p>
        )}
      </div>
      </>
      )}

      <StoryboardGenerationDialogs
        controller={storyboardUi}
        scenes={splitScenes}
        onGenerateAngle={handleAngleSwitchGenerate}
        onApplyAngle={handleApplyAngleSwitch}
        onGenerateGrid={handleQuadGridGenerate}
        onApplyGrid={handleApplyQuadGrid}
        onCopyGridToScene={handleCopyQuadGridToScene}
      />

      {/* 视频延长/编辑对话框 */}
      <ExtendEditDialog
        open={extendEditOpen}
        onOpenChange={setExtendEditOpen}
        mode={extendEditMode}
        sourceGroup={extendEditSourceGroup}
        isGenerating={isGenerating}
        onConfirm={confirmExtendEdit}
      />
    </div>
  );
}
