// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 分镜组件 (Split Scenes Component)
 * 显示分镜切割结果，支持编辑提示词、上传尾帧、选择角色库、添加情绪标签
 */

import { useCallback, useMemo, useRef } from "react";
import { 
  useDirectorStore, 
  useActiveDirectorProject,
  type SplitScene, 
  type EmotionTag,
 
 
 
} from "@/stores/director/director-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useScriptStore } from "@/stores/script/script-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { toast } from "sonner";
import { normalizeHorizontalVerticalAspectRatio } from "@/lib/ai/image-size-presets";

import { useSplitScenesGeneration } from "./split-scenes-generation";
import { useMergedGenerationCancellation } from "@/hooks/use-merged-generation-cancellation";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { readImageAsBase64 } from '@/lib/media/image-storage';
import { SplitSceneCard } from "./split-scene-card";
import { SplitScenesEditingPanel } from "./split-scenes-editing-panel";
import { 
  VISUAL_STYLE_PRESETS, 
 
  getStyleById, 
  getStylePrompt,
  getStyleNegativePrompt,
 
} from "@/lib/constants/visual-styles";
import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from "@/lib/constants/cinematography-profiles";
import { buildEmotionDescription as buildEmotionDesc } from "@/lib/generation/prompt-builder";
import { useStoryboardGenerationUi } from "@/components/features/storyboard/use-storyboard-generation-ui";
import { useStoryboardMediaLibrary } from "@/components/features/storyboard/use-storyboard-media-library";
import { saveStoryboardSceneToLibrary } from "@/components/features/storyboard/storyboard-media-library-actions";
import { useStoryboardSceneActions } from "@/components/features/storyboard/use-storyboard-scene-actions";
import { StoryboardGenerationDialogs } from "@/components/features/storyboard/storyboard-generation-dialogs";
import { useStoryboardAngleSwitch } from "@/components/features/storyboard/use-storyboard-angle-switch";
import { useStoryboardResultActions } from "@/components/features/storyboard/use-storyboard-result-actions";
import { useStoryboardPromptGeneration } from "./use-storyboard-prompt-generation";
import { useStoryboardVideoLastFrame } from "@/components/features/storyboard/use-storyboard-video-last-frame";
import { useSplitSceneVideoGeneration } from "./use-split-scene-video-generation";
import { SplitScenesEmptyState } from "./split-scenes-empty-state";
import { SplitScenesTrailerTab } from "./split-scenes-trailer-tab";
import { filterTrailerScenes } from "../storyboard-scenes-utils";
import { StoryboardScenesTabs } from "../storyboard-scenes-tabs";
import { useStoryboardResolutionToastHandlers } from "../use-storyboard-resolution-toast-handlers";
import { useDirectorQuadGridController } from "./use-director-quad-grid-controller";
import { normalizeStoryboardReferenceImages } from "@/components/features/storyboard/storyboard-reference-image-normalizer";
import {
  allocateStoryboardAngles as _allocateAngles,
  calculateMergedGridAspectRatio as _calculateGridAspectRatio,
  composeStoryboardTilePrompt as _composeTilePrompt,
} from "@/components/features/storyboard/storyboard-merged-grid-utils";
import {
  MAX_REFERENCE_IMAGES,
  collectCharacterReferenceImages,
  buildCharacterIdentityBlock,
  buildReferencePriorityHint,
  buildSceneCharacterContexts,
  buildSceneCharacterCastLine,
  optimizeReferenceImagesForModel,
  type SceneCharacterContext,
} from "@/components/features/storyboard/storyboard-reference-utils";
import { SplitScenesProps, formatDirectorDeletedSceneNumber } from "./split-scenes-utils";

export function SplitScenes({ onBack }: SplitScenesProps) {
  const storyboardUi = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });
  const {
    imageGenMode, setImageGenMode,
    frameMode, setFrameMode,
    isMergedRunning, setIsMergedRunning,
    refStrategy, setRefStrategy,
    useExemplar, setUseExemplar,
    isGenerating, setIsGenerating,
    isGeneratingPrompts, setIsGeneratingPrompts,
    setCurrentGeneratingId,
    activeTab, setActiveTab,
    isAngleSwitching,
    isExtractingFrame, setIsExtractingFrame,
    isQuadGridGenerating,
  } = storyboardUi;
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
// eslint-disable-next-line react-hooks/exhaustive-deps
  const splitScenes = projectData?.splitScenes || [];
  const storyboardImage = projectData?.storyboardImage || null;
  const storyboardConfig = projectData?.storyboardConfig || {
    aspectRatio: defaultStoryboardAspectRatio,
    resolution: defaultStoryboardResolution,
    videoResolution: '480p' as const,
    sceneCount: 5,
    storyPrompt: '',
  };
  // 预告片数据 - 直接从 splitScenes 筛选，保证功能一致
  
  // Debug: log raw data on every render (dev only)
  if (process.env.NODE_ENV === 'development') {
  }
  
  // 筛选预告片分镜：通过 sceneName 包含 "预告片" 关键字来识别
  const trailerScenes = useMemo(() => {
    // 通过 sceneName 包含 "预告片" 来筛选
    const filtered = filterTrailerScenes(splitScenes);
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
// eslint-disable-next-line react-hooks/exhaustive-deps
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
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSplitSceneEndFrameStatus]);

  // 停止合并生成
  const handleStopMergedGeneration = useCallback(() => {
    stopMergedGeneration();
    setIsMergedRunning(false);
    toast.info('合并生成已停止');
// eslint-disable-next-line react-hooks/exhaustive-deps
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
    return collectCharacterReferenceImages(contexts, MAX_REFERENCE_IMAGES);
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

  const { handleGenerateSingleImage, handleMergedGenerate, handleGenerateEndFrameImage } = useSplitScenesGeneration({
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
  });

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

  const { handleImageResolutionChange, handleVideoResolutionChange } = useStoryboardResolutionToastHandlers(setStoryboardConfig);

  const renderSceneCard = (scene: SplitScene) => (
    <SplitSceneCard
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
  );

  // Show empty state
  if (splitScenes.length === 0) {
    return <SplitScenesEmptyState />;
  }

  return (
    <div className="space-y-4">
      <StoryboardScenesTabs
        activeTab={activeTab}
        trailerCount={trailerScenes.length}
        onActiveTabChange={setActiveTab}
      />

      {/* 预告片 Tab 内容 - 完全复用分镜编辑的功能 */}
      {activeTab === "trailer" && (
        <SplitScenesTrailerTab
          trailerScenes={trailerScenes}
          isGenerating={isGenerating}
          isGeneratingPrompts={isGeneratingPrompts}
          renderSceneCard={renderSceneCard}
          onAutoGeneratePrompts={handleAutoGeneratePrompts}
          onDeleteScene={deleteSplitScene}
          onClearTrailer={clearTrailer}
          onGenerateVideo={handleGenerateSingleVideo}
          styleId={currentStyleId || ""}
          onStyleChange={handleStyleChange}
          aspectRatio={storyboardConfig.aspectRatio}
          onAspectRatioChange={handleAspectRatioChange}
          imageResolution={storyboardConfig.resolution || defaultStoryboardResolution}
          onImageResolutionChange={handleImageResolutionChange}
          videoResolution={storyboardConfig.videoResolution || "480p"}
          onVideoResolutionChange={handleVideoResolutionChange}
          styleTokens={storyboardConfig.styleTokens ?? []}
        />
      )}

      {/* 分镜编辑 Tab 内容 */}
      {activeTab === "editing" && (
        <SplitScenesEditingPanel
          scenes={splitScenes}
          renderSceneCard={renderSceneCard}
          isGenerating={isGenerating}
          isGeneratingPrompts={isGeneratingPrompts}
          onAutoGeneratePrompts={handleAutoGeneratePrompts}
          onBack={handleBack}
          styleId={currentStyleId || ""}
          onStyleChange={handleStyleChange}
          cinematographyProfileId={currentCinProfileId}
          onCinematographyProfileChange={handleCinProfileChange}
          aspectRatio={storyboardConfig.aspectRatio}
          onAspectRatioChange={handleAspectRatioChange}
          imageResolution={storyboardConfig.resolution || defaultStoryboardResolution}
          onImageResolutionChange={handleImageResolutionChange}
          videoResolution={storyboardConfig.videoResolution || "480p"}
          onVideoResolutionChange={handleVideoResolutionChange}
          imageGenerationMode={imageGenMode}
          onImageGenerationModeChange={setImageGenMode}
          styleTokens={storyboardConfig.styleTokens ?? []}
          frameMode={frameMode}
          onFrameModeChange={setFrameMode}
          refStrategy={refStrategy}
          onRefStrategyChange={setRefStrategy}
          useExemplar={useExemplar}
          onUseExemplarChange={setUseExemplar}
          isMergedRunning={isMergedRunning}
          onMergedGenerate={handleMergedGenerate}
          onStopMerged={handleStopMergedGeneration}
          hasMissingPrompt={splitScenes.some(s => !(s.videoPromptZh?.trim() || s.videoPrompt?.trim()))}
          onAddBlank={addBlankSplitScene}
          onGenerateVideos={handleGenerateVideos}
        />
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
