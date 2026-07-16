// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 分镜组件 (Split Scenes Component)
 * 显示分镜切割结果，支持编辑提示词、上传尾帧、选择角色库、添加情绪标签
 */

import React, { useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
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
import { useScriptStore } from "@/stores/script-store";
import { 
  ArrowLeft, 
  Trash2, 
  Play,
  ImageIcon,
  Loader2,
  Sparkles,
  Clapperboard,
  Film,
  Square,
  Plus,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaStore } from "@/stores/media-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { toast } from "sonner";
import { normalizeHorizontalVerticalAspectRatio } from "@/lib/ai/image-size-presets";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";
import { useMergedGenerationCancellation } from "@/hooks/use-merged-generation-cancellation";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { readImageAsBase64 } from '@/lib/image-storage';
import { persistSceneImage } from '@/lib/utils/image-persist';
import { SplitSceneCard } from "./split-scene-card";
import { SplitSceneVideoActionBar } from "./split-scene-video-action-bar";
import { SplitScenesPromptWarning } from "./split-scenes-prompt-warning";
import { StoryboardMergedGenerationControls } from "./storyboard-merged-generation-controls";
import { SceneVoiceBatchToolbar } from "./scene-voice-batch-toolbar";
import { 
  VISUAL_STYLE_PRESETS, 
  STYLE_CATEGORIES,
  getStyleById, 
  getStylePrompt,
  getStyleNegativePrompt,
  DEFAULT_STYLE_ID 
} from "@/lib/constants/visual-styles";
import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from "@/lib/constants/cinematography-profiles";
import { buildVideoPrompt, buildEmotionDescription as buildEmotionDesc } from "@/lib/generation/prompt-builder";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";
import { StoryboardConfigToolbar } from "./storyboard-config-toolbar";
import { useStoryboardMediaLibrary } from "./use-storyboard-media-library";
import { saveStoryboardSceneToLibrary } from "./storyboard-media-library-actions";
import { useStoryboardSceneActions } from "./use-storyboard-scene-actions";
import { StoryboardGenerationDialogs } from "./storyboard-generation-dialogs";
import { useStoryboardAngleSwitch } from "./use-storyboard-angle-switch";
import { useStoryboardResultActions } from "./use-storyboard-result-actions";
import { useStoryboardPromptGeneration } from "./use-storyboard-prompt-generation";
import { useStoryboardVideoLastFrame } from "./use-storyboard-video-last-frame";
import { useSplitSceneVideoGeneration } from "./use-split-scene-video-generation";
import { createStoryboardEndFrameGenerator } from "./storyboard-end-frame-generation";
import { createStoryboardSingleImageGenerator } from "./storyboard-single-image-generation";
import { useDirectorQuadGridController } from "./use-director-quad-grid-controller";
import { normalizeStoryboardReferenceImages } from "./storyboard-reference-image-normalizer";
import { collectOptimizedMergedFrameReferenceImages } from "./storyboard-merged-reference-utils";
import { runStoryboardMergedPages } from "./storyboard-merged-page-controller";
import { createStoryboardMergedPageGenerator } from "./storyboard-merged-page-generation";
import {
  allocateStoryboardAngles as allocateAngles,
  buildMergedFrameTasks,
  calculateMergedGridAspectRatio as calculateGridAspectRatio,
  isStoryboardSceneCompleted,
  paginateMergedFrameTasks,
  composeStoryboardTilePrompt as composeTilePrompt,
  type MergedFrameTask as GridTask,
} from "./storyboard-merged-grid-utils";
import {
  MAX_REFERENCE_IMAGES,
  buildCharacterIdentityBlock,
  buildReferencePriorityHint,
  buildSceneCharacterContexts,
  buildSceneCharacterCastLine,
  optimizeReferenceImagesForModel,
  type SceneCharacterContext,
} from "./storyboard-reference-utils";
import { buildStoryboardQuadGridPrompt } from "./storyboard-quad-grid-prompt";

interface SplitScenesProps {
  onBack?: () => void;
  onGenerateVideos?: () => void;
}

// SceneCard 已移至 split-scene-card.tsx，此处使用 SplitSceneCard
const SceneCard = SplitSceneCard;
const formatDirectorDeletedSceneNumber = (sceneId: number) => sceneId + 1;

export function SplitScenes({ onBack, onGenerateVideos }: SplitScenesProps) {
  const storyboardUi = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });
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
    isQuadGridGenerating,
  } = storyboardUi;
  const PAGE_CONCURRENCY = 2; // 每页并发集群数限制
  // 合并生成停止控制
  const {
    cancelledRef: mergedAbortRef,
    start: startMergedGeneration,
    stop: stopMergedGeneration,
    finish: finishMergedGeneration,
  } = useMergedGenerationCancellation();
  // 首帧/尾帧生成的 AbortController（用于真正取消底层 fetch 和轮询）
  const imageAbortRef = useRef<AbortController | null>(null);
  const endFrameAbortRef = useRef<AbortController | null>(null);
  // Get current project data
  const projectData = useActiveDirectorProject();
  const imageGenerationSettings = useAppSettingsStore((state) => state.imageGenerationSettings);
  const defaultStoryboardAspectRatio = normalizeHorizontalVerticalAspectRatio(imageGenerationSettings.defaultAspectRatio);
  const defaultStoryboardResolution = imageGenerationSettings.defaultResolution === '4K' ? '4K' as const : '2K' as const;

  // 获取当前项目的提示词语言设置（来自剧本面板）
  const promptLanguage = useScriptStore(state => {
    const pid = state.activeProjectId;
    return pid ? state.projects[pid]?.promptLanguage : undefined;
  }) || 'zh';

  // Read from project data (with defaults)
  const splitScenes = projectData?.splitScenes || [];
  const storyboardStatus = projectData?.storyboardStatus || 'idle';
  const storyboardImage = projectData?.storyboardImage || null;
  const storyboardConfig = projectData?.storyboardConfig || {
    aspectRatio: defaultStoryboardAspectRatio,
    resolution: defaultStoryboardResolution,
    videoResolution: '480p' as const,
    sceneCount: 5,
    storyPrompt: '',
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
    addBlankSplitScene,
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
    formatDeletedSceneNumber: formatDirectorDeletedSceneNumber,
  });

  // Get current style from config
  // 优先使用直接存储的 visualStyleId，回退到 styleTokens 反推（兼容旧项目）
  // 未设置时为 null（不施加任何风格），避免默认强制 2D 吉卜力
  const currentStyleId = useMemo(() => {
    if (storyboardConfig.visualStyleId) {
      return storyboardConfig.visualStyleId;
    }
    // 向后兼容：将 styleTokens 合并后匹配 prompt 前缀
    if (storyboardConfig.styleTokens && storyboardConfig.styleTokens.length > 0) {
      const joinedTokens = storyboardConfig.styleTokens.join(', ');
      const found = VISUAL_STYLE_PRESETS.find(s => s.prompt.startsWith(joinedTokens));
      return found?.id || null;
    }
    return null;
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

  // Update aspect ratio
  const handleAspectRatioChange = useCallback((ratio: '16:9' | '9:16') => {
    setStoryboardConfig({ aspectRatio: ratio });
    toast.success(`已切换为 ${ratio === '16:9' ? '横屏' : '竖屏'} 模式`);
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
    imageAbortRef.current?.abort();
    imageAbortRef.current = null;
    updateSplitSceneImageStatus(sceneId, {
      imageStatus: 'idle',
      imageProgress: 0,
      imageError: '用户已取消',
    });
    setIsGenerating(false);
    setCurrentGeneratingId(null);
    toast.info(`分镜 ${sceneId + 1} 首帧生成已停止`);
  }, [updateSplitSceneImageStatus]);

  // 停止尾帧图片生成
  const handleStopEndFrameGeneration = useCallback((sceneId: number) => {
    endFrameAbortRef.current?.abort();
    endFrameAbortRef.current = null;
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

  const getLatestDirectorScenes = useCallback(() => {
    const { activeProjectId: latestProjectId, projects } = useDirectorStore.getState();
    return latestProjectId ? (projects[latestProjectId]?.splitScenes || []) : [];
  }, []);
  const {
    openAngleSwitch: handleAngleSwitchClick,
    generate: handleAngleSwitchGenerate,
  } = useStoryboardAngleSwitch({
    scenes: splitScenes,
    controller: storyboardUi,
    getProviderByPlatform,
    addHistory: addAngleSwitchHistory,
    getLatestScenes: getLatestDirectorScenes,
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

  const getSceneCharacterContexts = useCallback((
    characterIds: string[],
    variationMap?: Record<string, string>,
  ): SceneCharacterContext[] => {
    const { characters } = useCharacterLibraryStore.getState();
    return buildSceneCharacterContexts(characters, characterIds, variationMap);
  }, []);

  // 收集角色参考图片 - 必须在 handleQuadGridGenerate 之前定义
  const getCharacterReferenceImages = useCallback((
    characterIds: string[],
    variationMap?: Record<string, string>,
  ): string[] => {
    const contexts = getSceneCharacterContexts(characterIds, variationMap);
    if (contexts.length === 0) return [];

    const refs: string[] = [];
    const seen = new Set<string>();

    const maxDepth = contexts.reduce((depth, context) => Math.max(depth, context.referenceImages.length), 0);

    for (let index = 0; index < maxDepth; index += 1) {
      for (const context of contexts) {
        const image = context.referenceImages[index];
        if (!image || seen.has(image)) continue;
        seen.add(image);
        refs.push(image);
        if (refs.length >= MAX_REFERENCE_IMAGES) {
          return refs;
        }
      }
    }

    return refs.slice(0, MAX_REFERENCE_IMAGES);
  }, [getSceneCharacterContexts]);

  const getSceneIdentityLockLines = useCallback((
    scene: SplitScene,
    model?: string,
    hasCharacterRefs?: boolean,
  ): string[] => {
    const contexts = getSceneCharacterContexts(scene.characterIds || [], scene.characterVariationMap);
    if (contexts.length === 0) return [];

    const lines: string[] = [];
    const castLine = buildSceneCharacterCastLine(contexts);
    const resolvedHasCharacterRefs = hasCharacterRefs ?? contexts.some((context) => context.referenceImages.length > 0);

    if (castLine) {
      lines.push(castLine);
    }

    const identityBlock = buildCharacterIdentityBlock(contexts);
    if (identityBlock) {
      lines.push(...identityBlock.split('\n'));
    }

    const priorityHint = buildReferencePriorityHint(model, resolvedHasCharacterRefs);
    if (priorityHint) {
      lines.push(priorityHint);
    }

    return lines;
  }, [getSceneCharacterContexts]);

  const buildPromptWithIdentityLock = useCallback((
    basePrompt: string,
    scene: SplitScene,
    model?: string,
    hasCharacterRefs?: boolean,
  ): string => {
    const prompt = basePrompt.trim();
    const identityLines = getSceneIdentityLockLines(scene, model, hasCharacterRefs);
    if (identityLines.length === 0) return prompt;

    return [prompt, identityLines.join('\n')].filter(Boolean).join('\n\n');
  }, [getSceneIdentityLockLines]);

  const processReferenceImagesForApi = useCallback(async (
    referenceImages: string[],
    logPrefix: string,
    validateLocalDataUri = true,
  ): Promise<string[]> => {
    return normalizeStoryboardReferenceImages(referenceImages, {
      readLocalImage: readImageAsBase64,
      validateLocalDataUri,
      onReadError: (url, error) => console.warn(`${logPrefix} Failed to read local image:`, url, error),
    });
  }, []);

  const videoGeneration = useSplitSceneVideoGeneration({
    scenes: splitScenes,
    storyboardConfig,
    projectData,
    currentStyleId,
    concurrency,
    setIsGenerating,
    setCurrentGeneratingId,
    updateSplitSceneVideo,
    updateSplitSceneEndFrame,
    autoSaveVideoToLibrary,
    getCharacterReferenceImages,
  });
  const { handleQuadGridClick, handleQuadGridGenerate } = useDirectorQuadGridController({
    scenes: splitScenes,
    storyboardConfig,
    defaultAspectRatio: defaultStoryboardAspectRatio,
    defaultResolution: defaultStoryboardResolution,
    controller: storyboardUi,
    mediaProjectId,
    getImageFolderId,
    addMediaFromUrl,
    buildEmotionDescription,
    getSceneCharacterContexts,
    getCharacterReferenceImages,
    buildPromptWithIdentityLock,
    optimizeReferenceImagesForModel,
    processReferenceImagesForApi,
  });

  const {
    stopVideoGeneration: handleStopVideoGeneration,
    generateSingleVideo: handleGenerateSingleVideo,
    generateVideos: handleGenerateVideos,
  } = videoGeneration;

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

    const aspect = storyboardConfig.aspectRatio || defaultStoryboardAspectRatio;
    const styleTokens = storyboardConfig.styleTokens || [];
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
      resolution: storyboardConfig.resolution || defaultStoryboardResolution,
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
        // 检查合并生成是否已被用户停止
        if (mergedAbortRef.current) {
          console.log(`[MergedGen] Scene ${sceneId} polling cancelled by user`);
          return;
        }
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
      updateSplitSceneEndFrame(sceneId, persistResult.localPath, 'ai-generated', persistResult.httpUrl);
    } else {
      const sceneObj = splitScenes.find(s => s.id === sceneId)!;
      updateSplitSceneImage(sceneId, persistResult.localPath, sceneObj.width, sceneObj.height, persistResult.httpUrl || undefined);
    }
    return { finalBase64: persistResult.localPath, directUrl };
  };

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
  if (splitScenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">暂无切割的分镜</p>
      </div>
    );
  }

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
        <>
          {trailerScenes.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              <Clapperboard className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>预告片功能</p>
              <p className="text-xs mt-1">请在左侧「剧本」面板中的「预告片」标签页生成预告片</p>
              <p className="text-xs mt-1">挑选的分镜将在此显示并可进行图片/视频生成</p>
            </div>
          ) : (
            <>
              {/* Header - 与分镜编辑一致 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">预告片分镜</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {trailerScenes.length} 个分镜
                  </span>
                  <span className="text-xs text-muted-foreground">
                    预计 {trailerScenes.reduce((sum, s) => sum + (s.duration || 5), 0)} 秒
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoGeneratePrompts}
                    disabled={isGeneratingPrompts || isGenerating}
                    className="hidden h-7 px-2 text-xs"
                  >
                    {isGeneratingPrompts ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 mr-1 text-yellow-500" />
                    )}
                    AI 自动填写提示词
                  </Button>
                  {/* 一键清空预告片分镜 */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={isGenerating}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        清空分镜
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认清空预告片分镜</AlertDialogTitle>
                        <AlertDialogDescription>
                          这将删除所有 {trailerScenes.length} 个预告片分镜（包括已生成的图片和视频）。此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            // 删除所有预告片分镜
                            trailerScenes.forEach(scene => {
                              deleteSplitScene(scene.id);
                            });
                            // 清空预告片配置
                            clearTrailer();
                            toast.success(`已清空 ${trailerScenes.length} 个预告片分镜`);
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          确认清空
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <StoryboardConfigToolbar
                styleId={currentStyleId || ""}
                onStyleChange={handleStyleChange}
                aspectRatio={storyboardConfig.aspectRatio}
                onAspectRatioChange={handleAspectRatioChange}
                imageResolution={storyboardConfig.resolution || defaultStoryboardResolution}
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
                disabled={isGenerating}
              />

              {/* Scene list - 完全复用分镜编辑的 SceneCard */}
              <div className="flex flex-col gap-3">
                {trailerScenes.map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    promptLanguage={promptLanguage}
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
                ))}
              </div>

              {/* Action buttons - 与分镜编辑一致 */}
              <div className="flex gap-2 pt-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          // 仅为预告片分镜生成视频
                          toast.info(`开始生成 ${trailerScenes.length} 个预告片视频...`);
                          // 循环调用单个生成
                          trailerScenes.forEach(scene => {
                            if (scene.imageDataUrl && scene.videoStatus !== 'completed') {
                              handleGenerateSingleVideo(scene.id);
                            }
                          });
                        }}
                        disabled={isGenerating || trailerScenes.length === 0}
                        className="flex-1"
                        size="lg"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            生成中...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            生成预告片视频 ({trailerScenes.length})
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>为预告片分镜生成视频</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Tips */}
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                <p>💡 预告片分镜与主分镜共享数据，修改会同步。点击每个分镜下方的文字区域可编辑提示词。</p>
              </div>
            </>
          )}
        </>
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
            variant="outline"
            size="sm"
            onClick={handleAutoGeneratePrompts}
            disabled={isGeneratingPrompts || isGenerating}
            className="hidden h-7 px-2 text-xs"
          >
            {isGeneratingPrompts ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1 text-yellow-500" />
            )}
            AI 自动填写提示词
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={handleBack}
            className="hidden h-7 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            重新生成
          </Button>
        </div>
      </div>

      <StoryboardConfigToolbar
        styleId={currentStyleId || ""}
        onStyleChange={handleStyleChange}
        cinematographyProfileId={currentCinProfileId}
        onCinematographyProfileChange={handleCinProfileChange}
        aspectRatio={storyboardConfig.aspectRatio}
        onAspectRatioChange={handleAspectRatioChange}
        imageResolution={storyboardConfig.resolution || defaultStoryboardResolution}
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

      <SplitScenesPromptWarning
        hasMissingPrompt={splitScenes.some(s => !(s.videoPromptZh?.trim() || s.videoPrompt?.trim()))}
      />

      <SceneVoiceBatchToolbar scenes={splitScenes} />

      {/* Scene list */}
      <div className="flex flex-col gap-3">
        {splitScenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            promptLanguage={promptLanguage}
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
        ))}

        {/* 添加空白分镜按钮 */}
        <button
          type="button"
          onClick={addBlankSplitScene}
          disabled={isGenerating}
          className={cn(
            "w-full rounded-lg border-2 border-dashed border-muted-foreground/25",
            "flex items-center justify-center gap-2 py-6",
            "text-sm text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5",
            "transition-colors cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Plus className="h-5 w-5" />
          <span>添加空白分镜</span>
        </button>
      </div>

      <SplitSceneVideoActionBar
        scenes={splitScenes}
        isGenerating={isGenerating}
        onGenerateVideos={handleGenerateVideos}
      />

      {/* Tips */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
        <p>💡 点击每个分镜下方的文字区域可编辑视频生成提示词。悬停在分镜上可以删除不需要的分镜。</p>
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
    </div>
  );
}
