// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Script View
 * 剧本板块 - 三栏布局
 * 左栏：剧本输入（导入/创作）
 * 中间栏：层级结构（集→场景→分镜）
 * 右栏：属性面板和跳转操作
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useScriptStore,
  useActiveScriptProject,
  type ScriptCalibrationStatus,
  type ScriptViewpointStatus,
  type ScriptStructureStatus,
} from "@/stores/script-store";
import { useProjectStore } from "@/stores/project-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { parseScript, generateShotList, generateScriptFromIdea } from "@/lib/script/script-parser";
import { 
  importSingleEpisodeContent,
  regenerateAllEpisodeShots,
  getMissingTitleEpisodes,
  calibrateEpisodeShots,
  calibrateSingleShot,
  getMissingSynopsisEpisodes,
} from "@/lib/script/full-script-service";
import {
  detectMultiStageHints,
} from "@/lib/script/character-stage-analyzer";
import { generateMultiPageContactSheetData, buildContactSheetDataFromViewpoints } from "@/lib/script/scene-viewpoint-generator";
import { resolveSafeScriptCharacters } from "@/lib/script/character-calibrator";
import { findCharacterByDescription } from "@/lib/script/ai-character-finder";
import { findSceneByDescription } from "@/lib/script/ai-scene-finder";
import {
  sortByImportance as sortScenesByImportance,
} from "@/lib/script/scene-calibrator";
import { syncToSeriesMeta } from "@/lib/script/series-meta-sync";
import { exportProjectMetadata } from "@/lib/script/full-script-service";
import type { TrailerGenerationOptions } from "@/lib/script/trailer-service";
import { useDirectorStore, useActiveDirectorProject } from "@/stores/director-store";
import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from "@/lib/constants/cinematography-profiles";
import { ScriptInput } from "./script-input";
import { EpisodeTree } from "./episode-tree";
import { PropertyPanel } from "./property-panel";
import { useScriptSelection } from "./use-script-selection";
import { useScriptEpisodeGeneration } from "./use-script-episode-generation";
import { useScriptTitleCalibration } from "./use-script-title-calibration";
import { useScriptSynopsisGeneration } from "./use-script-synopsis-generation";
import { useScriptFullImport } from "./use-script-full-import";
import { useScriptSceneCalibration } from "./use-script-scene-calibration";
import { useScriptTrailerGeneration } from "./use-script-trailer-generation";
import { useScriptCharacterCalibration } from "./use-script-character-calibration";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { getStyleTokens, DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { CalibrationStrictness, FilteredCharacterRecord } from "@/types/script";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ScriptView() {
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const {
    setActiveProjectId,
    ensureProject,
    setRawScript,
    setLanguage,
    setTargetDuration,
    setStyleId,
    setSceneCount,
    setShotCount,
    setScriptData,
    setParseStatus,
    setShots,
    setShotStatus,
    // CRUD operations
    addEpisode,
    updateEpisode,
    deleteEpisode,
    // Bundle 操作（同步 episodeRawScripts）
    addEpisodeBundle,
    updateEpisodeBundle,
    deleteEpisodeBundle,
    addScene,
    updateScene,
    deleteScene,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    updateShot,
    deleteShot,
    // 完整剧本管理
    setProjectBackground,
    setEpisodeRawScripts,
    updateEpisodeRawScript,
    setPromptLanguage,
    setCalibrationState: setScriptCalibrationState,
    setSingleShotCalibrationStatus: setSingleShotCalibrationStatusInStore,
    setCalibrationStrictness,
    setLastFilteredCharacters,
  } = useScriptStore();

  const { getApiKey, checkChatKeys, isFeatureConfigured } = useAPIConfigStore();
  const { 
    characters: allCharacters, 
    selectCharacter: selectLibraryCharacter,
  } = useCharacterLibraryStore();
  const { setActiveTab, goToDirectorWithData, goToCharacterWithData, goToSceneWithData, activeEpisodeIndex, enterEpisode } = useMediaPanelStore();

  // 完整剧本导入状态
  const [importError, setImportError] = useState<string | undefined>();

  // AI校准状态
  const calibrationState = scriptProject?.calibrationState;
  const calibrationStatus = calibrationState?.titleCalibrationStatus || 'idle';
  const [missingTitleCount, setMissingTitleCount] = useState(0);

  // 导入/大纲生成状态持久化到 store，面板切换后可恢复
  const importStatus = calibrationState?.importStatus || 'idle';
  const synopsisStatus = calibrationState?.synopsisStatus || 'idle';

  // 大纲生成状态
  const [missingSynopsisCount, setMissingSynopsisCount] = useState(0);
  
  // 角色阶段分析状态
  const [stageAnalysisStatus, setStageAnalysisStatus] = useState<'idle' | 'analyzing' | 'completed' | 'error'>('idle');
  const [multiStageHints, setMultiStageHints] = useState<string[]>([]);
  const [suggestMultiStage, setSuggestMultiStage] = useState(false);
  
  // 角色校准状态
  const characterCalibrationStatus = calibrationState?.characterCalibrationStatus || 'idle';
  const [characterCalibrationResult, setCharacterCalibrationResult] = useState<{
    filteredCount: number;
    mergedCount: number;
    finalCount: number;
  } | null>(null);
  
  // 角色校准确认弹窗状态
  const pendingCalibrationCharacters = calibrationState?.pendingCalibrationCharacters || null;
  const pendingFilteredCharacters = calibrationState?.pendingFilteredCharacters || [];
  const calibrationDialogOpen = calibrationState?.calibrationDialogOpen || false;
  
  // 场景校准状态
  const sceneCalibrationStatus = calibrationState?.sceneCalibrationStatus || 'idle';
  // 视角分析状态（强制工作流）
  const viewpointAnalysisStatus = calibrationState?.viewpointAnalysisStatus || 'idle';
  
  // 单个分镜校准状态
  const singleShotCalibrationStatus = calibrationState?.singleShotCalibrationStatus || {};
  
  // 单集结构补全状态
  const structureCompletionStatus = calibrationState?.structureCompletionStatus || 'idle';
  const [structureOverwriteConfirmOpen, setStructureOverwriteConfirmOpen] = useState(false);
  const prevEpisodeRef = useRef<{ index: number | null; rawLen: number }>({ index: null, rawLen: 0 });

  // 二次校准追踪（中栏独立按钮触发时标记，用于进度面板区分首次/二次）
  const [secondPassTypes, setSecondPassTypes] = useState<Set<string>>(new Set());
  const addSecondPass = useCallback((type: string) => {
    setSecondPassTypes(prev => new Set(prev).add(type));
  }, []);
  const removeSecondPass = useCallback((type: string) => {
    setSecondPassTypes(prev => { const next = new Set(prev); next.delete(type); return next; });
  }, []);
  
  // 预告片状态
  const { 
    setTrailerConfig, 
    setTrailerScenes, 
    clearTrailer,
    addScenesFromScript,
  } = useDirectorStore();
  const directorProject = useActiveDirectorProject();
  const trailerConfig = directorProject?.trailerConfig || null;
  const currentSplitScenes = directorProject?.splitScenes || [];

  // Sync activeProjectId from project-store to script-store
  useEffect(() => {
    if (activeProjectId) {
      setActiveProjectId(activeProjectId);
      ensureProject(activeProjectId);
    }
  }, [activeProjectId, setActiveProjectId, ensureProject]);

  // 面板重新挂载时，将"进行中"的瞬态状态重置为 idle，避免显示虚假的 loading 状态
  useEffect(() => {
    if (!activeProjectId) return;
    const state = useScriptStore.getState().projects[activeProjectId]?.calibrationState;
    if (!state) return;
    const fixes: Record<string, string> = {};
    if (state.importStatus === 'importing') fixes.importStatus = 'idle';
    if (state.synopsisStatus === 'generating') fixes.synopsisStatus = 'idle';
    if (Object.keys(fixes).length > 0) {
      setScriptCalibrationState(activeProjectId, fixes as never);
    }
   
  }, [activeProjectId]);

  // Keep last stable project id during transient null windows (e.g. duplicate flow)
  // to avoid creating phantom project keys like "default".
  const stableProjectIdRef = useRef<string>("default-project");
  useEffect(() => {
    if (activeProjectId) {
      stableProjectIdRef.current = activeProjectId;
    }
  }, [activeProjectId]);

  const projectId = activeProjectId || stableProjectIdRef.current;

  const setProjectSynopsisStatus = useCallback((status: 'idle' | 'generating' | 'completed' | 'error') => {
    setScriptCalibrationState(projectId, { synopsisStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setImportStatus = useCallback((status: 'importing' | 'ready' | 'error') => {
    setScriptCalibrationState(projectId, { importStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setCalibrationStatus = useCallback((status: ScriptCalibrationStatus) => {
    setScriptCalibrationState(projectId, { titleCalibrationStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setCharacterCalibrationStatus = useCallback((status: ScriptCalibrationStatus) => {
    setScriptCalibrationState(projectId, { characterCalibrationStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setSceneCalibrationStatus = useCallback((status: ScriptCalibrationStatus) => {
    setScriptCalibrationState(projectId, { sceneCalibrationStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setViewpointAnalysisStatus = useCallback((status: ScriptViewpointStatus) => {
    setScriptCalibrationState(projectId, { viewpointAnalysisStatus: status });
  }, [projectId, setScriptCalibrationState]);

  const setStructureCompletionStatus = useCallback((status: ScriptStructureStatus) => {
    setScriptCalibrationState(projectId, { structureCompletionStatus: status });
  }, [projectId, setScriptCalibrationState]);

  // Local state fallbacks
  const rawScript = scriptProject?.rawScript || "";
  const language = scriptProject?.language || "中文";
  const targetDuration = scriptProject?.targetDuration || "60s";
  const styleId = scriptProject?.styleId ?? DEFAULT_STYLE_ID;
  const sceneCount = scriptProject?.sceneCount;
  const shotCount = scriptProject?.shotCount;
  const scriptData = scriptProject?.scriptData || null;
  const parseStatus = scriptProject?.parseStatus || "idle";
  const parseError = scriptProject?.parseError;
  const shots = scriptProject?.shots || [];
  const promptLanguage = scriptProject?.promptLanguage || 'zh';
  const episodeRawScripts = scriptProject?.episodeRawScripts || [];
  const handleGenerateTrailer = useScriptTrailerGeneration({
    shots,
    background: scriptProject?.projectBackground || null,
    splitScenes: currentSplitScenes,
    setTrailerConfig,
    addScenesFromScript,
  });

  const {
    selectedItemId,
    setSelectedItemId,
    selectedItemType,
    setSelectedItemType,
    selectItem: handleSelectItem,
    selectedCharacter,
    selectedScene,
    selectedShot,
    selectedEpisode,
    selectedSceneShots,
    selectedEpisodeShots,
  } = useScriptSelection({
    scriptData,
    shots,
    episodeRawScripts,
    activeEpisodeIndex,
    projectId,
    enterEpisode,
  });

  // 当前集作用域：从 activeEpisodeIndex 映射到 episodeId
  const activeEpisodeId = activeEpisodeIndex != null
    ? scriptData?.episodes.find(ep => ep.index === activeEpisodeIndex)?.id ?? undefined
    : undefined;

  // 优先检查新的服务映射
  const chatConfigured = isFeatureConfigured('script_analysis') || checkChatKeys().isAllConfigured;

  // 集作用域下显示该集原始内容，全剧视图显示完整 rawScript
  const effectiveRawScript = activeEpisodeIndex != null
    ? episodeRawScripts.find(ep => ep.episodeIndex === activeEpisodeIndex)?.rawContent ?? ""
    : rawScript;
  
  // === 单集结构补全: rawContent 从空→非空 自动触发 ===
  const handleStructureCompletion = useCallback(async () => {
    if (activeEpisodeIndex == null || !scriptData) return;
    setStructureCompletionStatus('processing');
    try {
      const result = await importSingleEpisodeContent(
        effectiveRawScript,
        activeEpisodeIndex,
        projectId,
      );
      if (result.success) {
        setStructureCompletionStatus('completed');
        if (result.sceneCount > 0) {
          toast.success(`结构补全完成：解析出 ${result.sceneCount} 个场景`);
        }
      } else {
        setStructureCompletionStatus('error');
        toast.error(result.error || '结构补全失败');
      }
    } catch (e) {
      setStructureCompletionStatus('error');
      console.error('[handleStructureCompletion]', e);
    }
    // 3秒后重置为 idle，允许再次触发
    setTimeout(() => setStructureCompletionStatus('idle'), 3000);
  }, [activeEpisodeIndex, effectiveRawScript, projectId, scriptData]);

  useEffect(() => {
    const prev = prevEpisodeRef.current;
    const currentLen = effectiveRawScript.length;

    // 集切换 → 只更新 ref
    if (prev.index !== (activeEpisodeIndex ?? null)) {
      prevEpisodeRef.current = { index: activeEpisodeIndex ?? null, rawLen: currentLen };
      return;
    }

    prevEpisodeRef.current = { index: activeEpisodeIndex ?? null, rawLen: currentLen };

    // 只在集作用域 + idle 状态下触发
    if (activeEpisodeIndex == null) return;
    if (structureCompletionStatus !== 'idle') return;

    // 检测粘贴：从短内容跳变到大量内容
    if (prev.rawLen < 20 && currentLen > 50) {
      const ep = scriptData?.episodes?.find(e => e.index === activeEpisodeIndex);
      const hasScenes = ep && ep.sceneIds.length > 0;

      if (hasScenes) {
        setStructureOverwriteConfirmOpen(true);
      } else {
        handleStructureCompletion();
      }
    }
   
  }, [effectiveRawScript, activeEpisodeIndex, structureCompletionStatus]);

  // 计算各集的分镜生成状态
  const episodeGenerationStatus = episodeRawScripts.reduce((acc, ep) => {
    acc[ep.episodeIndex] = ep.shotGenerationStatus;
    return acc;
  }, {} as Record<number, 'idle' | 'generating' | 'completed' | 'error'>);

  const handleGenerateEpisodeShots = useScriptEpisodeGeneration({
    projectId,
    styleId,
    targetDuration,
    promptLanguage,
    setViewpointAnalysisStatus,
  });

  const handleCalibrate = useScriptTitleCalibration({
    projectId,
    setStatus: setCalibrationStatus,
    setMissingTitleCount,
  });

  const handleGenerateSynopses = useScriptSynopsisGeneration({
    projectId,
    episodeCount: episodeRawScripts.length,
    setStatus: setProjectSynopsisStatus,
    setMissingSynopsisCount,
  });

  const handleImportFullScript = useScriptFullImport({
    projectId,
    styleId,
    promptLanguage,
    handleGenerateEpisodeShots,
    setImportStatus,
    setImportError,
    setMissingTitleCount,
    setCalibrationStatus,
    setProjectSynopsisStatus,
    setMissingSynopsisCount,
    setCharacterCalibrationStatus,
    setCharacterCalibrationResult,
    setScriptData,
  });

  const { handleCalibrateScenes, handleCalibrateEpisodeScenes } = useScriptSceneCalibration({
    projectId,
    background: scriptProject?.projectBackground,
    episodeRawScripts,
    scriptData,
    promptLanguage,
    setScriptData,
    setSceneCalibrationStatus,
    addSecondPass,
    removeSecondPass,
  });

  const { handleCalibrateCharacters } = useScriptCharacterCalibration({
    projectId,
    scriptData,
    background: scriptProject?.projectBackground,
    calibrationStrictness: scriptProject?.calibrationStrictness,
    episodeRawScripts,
    promptLanguage,
    setCalibrationState: setScriptCalibrationState,
    setCharacterCalibrationStatus,
    setStageAnalysisStatus,
    setMultiStageHints,
    setSuggestMultiStage,
    setCharacterCalibrationResult,
    addSecondPass,
    removeSecondPass,
  });

  // 更新全部分镜
  const handleRegenerateAllShots = useCallback(async () => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    
    if (episodeRawScripts.length === 0) {
      toast.error("没有可生成的集");
      return;
    }
    
    try {
      toast.info(`正在为全部 ${episodeRawScripts.length} 集生成分镜...（可能需要较长时间）`);
      
      const options = {
        apiKey: featureConfig?.allApiKeys.join(',') || '',
        provider: (featureConfig?.platform === 'zhipu' ? 'zhipu' : 'openai') as string,
        styleId,
        targetDuration,
        promptLanguage,
      };
      
      await regenerateAllEpisodeShots(
        projectId,
        options,
        (current, total, msg) => {
          console.log(`[ScriptView] ${msg} (${current}/${total})`);
        }
      );
      
      toast.success(`全部 ${episodeRawScripts.length} 集分镜生成完成！`);
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] All episodes shot generation failed:", err);
      toast.error(`分镜生成失败: ${err.message}`);
    }
  }, [projectId, styleId, targetDuration, promptLanguage, episodeRawScripts.length]);

  // 计算缺失标题和大纲的集数
  useEffect(() => {
    if (importStatus === 'ready' && projectId) {
      const missingTitles = getMissingTitleEpisodes(projectId);
      setMissingTitleCount(missingTitles.length);
      
      const missingSynopses = getMissingSynopsisEpisodes(projectId);
      setMissingSynopsisCount(missingSynopses.length);
    }
  }, [importStatus, projectId, episodeRawScripts]);

  // AI校准分镜：优化中文描述、生成英文visualPrompt、优化镜头设计
  const handleCalibrateShots = useCallback(async (episodeIndex: number) => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }
    
    addSecondPass('shots');
    setViewpointAnalysisStatus('analyzing');
    toast.info(`正在校准第 ${episodeIndex} 集的分镜...`);
    
    try {
      const result = await calibrateEpisodeShots(
        episodeIndex,
        projectId,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform,  // 直接用设置里的platform
          baseUrl: featureConfig.baseUrl,
          model: featureConfig.models?.[0],  // 使用配置的第一个模型
          styleId,
          cinematographyProfileId: directorProject?.cinematographyProfileId || DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
          promptLanguage,
        },
        (current, total, msg) => {
          console.log(`[ScriptView] Shot Calibration: ${msg}`);
        }
      );
      
      if (result.success) {
        setViewpointAnalysisStatus('completed');
        removeSecondPass('shots');
        toast.success(`分镜校准完成！已优化 ${result.calibratedCount}/${result.totalShots} 个分镜`);
        
        // P2b: 分镜校准回写 SeriesMeta
        try {
          const store = useScriptStore.getState();
          const meta = store.projects[projectId]?.seriesMeta;
          if (meta) {
            const updates = syncToSeriesMeta(meta, 'shot', {});
            if (Object.keys(updates).length > 0) {
              store.updateSeriesMeta(projectId, updates);
              console.log('[handleCalibrateShots] SeriesMeta 分镜回写完成');
            }
            const mdContent = exportProjectMetadata(projectId);
            store.setMetadataMarkdown(projectId, mdContent);
          }
        } catch (e) {
          console.warn('[handleCalibrateShots] SeriesMeta 回写失败:', e);
        }
      } else {
        throw new Error(result.error || '分镜校准失败');
      }
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] Shot calibration failed:", err);
      setViewpointAnalysisStatus('error');
      removeSecondPass('shots');
      toast.error(`分镜校准失败: ${err.message}`);
    }
  }, [projectId, styleId, promptLanguage, directorProject?.cinematographyProfileId, addSecondPass, removeSecondPass]);

  // AI校准场景分镜：只校准指定场景下的分镜
  const handleCalibrateScenesShots = useCallback(async (sceneId: string) => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }

    // 找到场景所属的集
    const episode = scriptData?.episodes.find(ep => ep.sceneIds.includes(sceneId));
    if (!episode) {
      toast.error('找不到场景所属的集');
      return;
    }

    const scene = scriptData?.scenes.find(s => s.id === sceneId);
    const sceneName = scene?.name || scene?.location || '场景';

    addSecondPass('shots');
    setViewpointAnalysisStatus('analyzing');
    toast.info(`正在校准「${sceneName}」的分镜...`);

    try {
      const result = await calibrateEpisodeShots(
        episode.index,
        projectId,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform,
          baseUrl: featureConfig.baseUrl,
          model: featureConfig.models?.[0],
          styleId,
          cinematographyProfileId: directorProject?.cinematographyProfileId || DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
          promptLanguage,
        },
        (current, total, msg) => {
          console.log(`[ScriptView] Scene Shot Calibration: ${msg}`);
        },
        sceneId,
      );

      if (result.success) {
        setViewpointAnalysisStatus('completed');
        removeSecondPass('shots');
        toast.success(`「${sceneName}」分镜校准完成！已优化 ${result.calibratedCount}/${result.totalShots} 个分镜`);
      } else {
        throw new Error(result.error || '分镜校准失败');
      }
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] Scene shot calibration failed:", err);
      setViewpointAnalysisStatus('error');
      removeSecondPass('shots');
      toast.error(`分镜校准失败: ${err.message}`);
    }
  }, [projectId, scriptData, styleId, promptLanguage, directorProject?.cinematographyProfileId, addSecondPass, removeSecondPass]);

  // AI校准单个分镜（用于预告片分镜）
  const handleCalibrateSingleShot = useCallback(async (shotId: string) => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }
    
    // 设置状态为 calibrating
    setSingleShotCalibrationStatusInStore(projectId, shotId, 'calibrating');
    
    const shot = shots.find(s => s.id === shotId);
    if (!shot) {
      toast.error('找不到分镜');
      setSingleShotCalibrationStatusInStore(projectId, shotId, 'error');
      return;
    }
    
    toast.info(`正在校准分镜: ${shot.actionSummary?.slice(0, 20)}...`);
    
    try {
      const result = await calibrateSingleShot(
        shotId,
        projectId,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform,
          baseUrl: featureConfig.baseUrl,
          model: featureConfig.models?.[0],
          styleId,
          cinematographyProfileId: directorProject?.cinematographyProfileId || DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
          promptLanguage,
        },
        (msg: string) => {
          console.log(`[ScriptView] Single Shot Calibration: ${msg}`);
        }
      );
      
      if (result.success) {
        setSingleShotCalibrationStatusInStore(projectId, shotId, 'completed');
        toast.success(`分镜校准完成！`);
      } else {
        throw new Error(result.error || '分镜校准失败');
      }
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] Single shot calibration failed:", err);
      setSingleShotCalibrationStatusInStore(projectId, shotId, 'error');
      toast.error(`分镜校准失败: ${err.message}`);
    }
  }, [projectId, styleId, promptLanguage, shots, directorProject?.cinematographyProfileId, setSingleShotCalibrationStatusInStore]);

  // 角色校准由 useScriptCharacterCalibration 负责。

  // 确认角色校准结果
  const handleConfirmCalibration = useCallback((
    keptCharacters: import("@/types/script").ScriptCharacter[],
    filteredCharacters: FilteredCharacterRecord[]
  ) => {
    const currentProject = useScriptStore.getState().projects[projectId];
    const currentScriptData = currentProject?.scriptData;
    const safeCharacters = keptCharacters.length > 0
      ? keptCharacters
      : resolveSafeScriptCharacters([], {
          existingCharacters: currentProject?.scriptData?.characters,
          seriesMetaCharacters: currentProject?.seriesMeta?.characters,
        }).characters;
    if (currentScriptData) {
      setScriptData(projectId, {
        ...currentScriptData,
        characters: safeCharacters,
      });
      console.log('[handleConfirmCalibration] 已保存到 store，角色数:', safeCharacters.length);
    }
    setLastFilteredCharacters(projectId, filteredCharacters);
    setScriptCalibrationState(projectId, {
      calibrationDialogOpen: false,
      pendingCalibrationCharacters: null,
      pendingFilteredCharacters: [],
    });
    toast.success(`角色校准确认: ${safeCharacters.length} 个角色已保存`);
    
    // P2b: 校准回写 SeriesMeta
    try {
      const store = useScriptStore.getState();
      const meta = store.projects[projectId]?.seriesMeta;
      if (meta) {
        const updates = syncToSeriesMeta(meta, 'character', { characters: safeCharacters });
        if (Object.keys(updates).length > 0) {
          store.updateSeriesMeta(projectId, updates);
          console.log('[handleConfirmCalibration] SeriesMeta 角色回写完成');
        }
        // 重新生成元数据 MD
        const mdContent = exportProjectMetadata(projectId);
        store.setMetadataMarkdown(projectId, mdContent);
      }
    } catch (e) {
      console.warn('[handleConfirmCalibration] SeriesMeta 回写失败:', e);
    }
  }, [projectId, setScriptData, setLastFilteredCharacters, setScriptCalibrationState]);

  // 取消角色校准
  const handleCancelCalibration = useCallback(() => {
    setScriptCalibrationState(projectId, {
      calibrationDialogOpen: false,
      pendingCalibrationCharacters: null,
      pendingFilteredCharacters: [],
    });
    toast.info('已取消角色校准');
  }, [projectId, setScriptCalibrationState]);

  // 校准严格度变更
  const handleCalibrationStrictnessChange = useCallback((strictness: CalibrationStrictness) => {
    setCalibrationStrictness(projectId, strictness);
  }, [projectId, setCalibrationStrictness]);

  // 从被过滤列表恢复角色
  const handleRestoreFilteredCharacter = useCallback((characterName: string) => {
    const currentScriptData = useScriptStore.getState().projects[projectId]?.scriptData;
    if (!currentScriptData) return;
    
    const newChar: import("@/types/script").ScriptCharacter = {
      id: `char_restored_${Date.now()}`,
      name: characterName,
      tags: ['extra', 'restored'],
    };
    
    setScriptData(projectId, {
      ...currentScriptData,
      characters: [...currentScriptData.characters, newChar],
    });
    
    const current = useScriptStore.getState().projects[projectId]?.lastFilteredCharacters || [];
    setLastFilteredCharacters(projectId, current.filter(fc => fc.name !== characterName));
    toast.success(`已恢复角色: ${characterName}`);
  }, [projectId, setScriptData, setLastFilteredCharacters]);

  // 导入剧本后检测是否需要多阶段角色（仅用于显示提示）
  const handleAnalyzeCharacterStages = useCallback(async () => {
    // 已整合到 handleCalibrateCharacters 中，直接调用即可
    await handleCalibrateCharacters();
  }, [handleCalibrateCharacters]);

  // 导入剧本后检测是否需要多阶段角色
  useEffect(() => {
    if (importStatus === 'ready' && scriptProject?.projectBackground?.outline) {
      const result = detectMultiStageHints(
        scriptProject.projectBackground.outline,
        episodeRawScripts.length
      );
      setMultiStageHints(result.hints);
      setSuggestMultiStage(result.suggestMultiStage);
      
      if (result.suggestMultiStage) {
        console.log('[ScriptView] 检测到多阶段角色线索:', result.hints);
      }
    }
  }, [importStatus, scriptProject?.projectBackground?.outline, episodeRawScripts.length]);

  // Generate script from idea (创作模式)
  // AI分析用户输入，生成标准格式剧本，然后走导入流程
  const handleGenerateFromIdea = useCallback(async (idea: string) => {
    if (!idea.trim()) {
      toast.error("请输入故事创意");
      return;
    }

    // Use feature router to get script_analysis config
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }

    setParseStatus(projectId, "parsing");
    toast.info("正在根据创意生成剧本...");

    try {
      const allKeysString = featureConfig.allApiKeys.join(',');
      const provider = featureConfig.platform === 'zhipu' ? 'zhipu' : 'openai';
      const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
      const model = featureConfig.models?.[0];
      
      if (!baseUrl || !model) {
        toast.error('请先在设置中配置「剧本分析」的 Base URL 和模型');
        setParseStatus(projectId, "error", "缺少 Base URL 或模型配置");
        return;
      }

      console.log(`[ScriptView] Generating script from idea with ${featureConfig.allApiKeys.length} API keys`);

      // 第一步：AI 生成剧本文本（符合导入格式）
      const generatedScript = await generateScriptFromIdea(idea, {
        apiKey: allKeysString,
        provider: provider as string,
        baseUrl,
        model,
        language,
        targetDuration,
        sceneCount: sceneCount ? parseInt(sceneCount) : undefined,
        shotCount: shotCount ? parseInt(shotCount) : undefined,
        styleId,
      });

      // 保存生成的剧本到 rawScript（方便用户查看/编辑）
      setRawScript(projectId, generatedScript);
      setParseStatus(projectId, "idle");
      toast.success('剧本生成成功！正在自动导入...');

      // 第二步：自动调用导入流程（复用导入的所有后续逻辑）
      await handleImportFullScript(generatedScript);
      
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] Script generation failed:", err);
      setParseStatus(projectId, "error", err.message);
      toast.error(`剧本生成失败: ${err.message}`);
    }
  }, [projectId, language, targetDuration, sceneCount, shotCount, styleId, setRawScript, setParseStatus, handleImportFullScript]);

  // Parse screenplay (AI解析)
  const handleParse = useCallback(async () => {
    if (!rawScript.trim()) {
      toast.error("请输入剧本内容");
      return;
    }

    // Use feature router to get script_analysis config (with multi-key support)
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }

    setParseStatus(projectId, "parsing");

    try {
      // Pass all API keys (comma-separated) for rotation
      const allKeysString = featureConfig.allApiKeys.join(',');
      const provider = featureConfig.platform === 'zhipu' ? 'zhipu' : 'openai';
      
      console.log(`[ScriptView] Parsing with ${featureConfig.allApiKeys.length} API keys`);

      const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
      const model = featureConfig.models?.[0];
      if (!baseUrl || !model) {
        toast.error('请先在设置中配置「剧本分析」的 Base URL 和模型');
        setParseStatus(projectId, "error", "缺少 Base URL 或模型配置");
        return;
      }

      const result = await parseScript(rawScript, {
        apiKey: allKeysString, // Pass all keys for rotation
        provider: provider as string,
        baseUrl,
        model,
        language,
        sceneCount: sceneCount ? parseInt(sceneCount) : undefined,
        shotCount: shotCount ? parseInt(shotCount) : undefined,
      });

      // 确保有episodes字段
      if (!result.episodes || result.episodes.length === 0) {
        result.episodes = [{
          id: "default",
          index: 1,
          title: result.title || "第1集",
          sceneIds: result.scenes.map((s) => s.id),
        }];
      }

      setScriptData(projectId, result);
      setParseStatus(projectId, "ready");
      toast.success(
        `解析完成: ${result.characters.length} 角色, ${result.scenes.length} 场景`
      );

      // 自动生成分镜
      await handleGenerateShots(result);
    } catch (error) {
      const err = error as Error;
      console.error("[ScriptView] Parse failed:", err);
      setParseStatus(projectId, "error", err.message);
      toast.error(`解析失败: ${err.message}`);
    }
  }, [
    rawScript,
    language,
    sceneCount,
    shotCount,
    projectId,
    setParseStatus,
    setScriptData,
  ]);

  // Generate shot list with streaming updates
  const handleGenerateShots = useCallback(
    async (data?: typeof scriptData) => {
      const targetData = data || scriptData;
      if (!targetData) {
        return;
      }

      // Use feature router for script_analysis (shot generation uses same API)
      const featureConfig = aiManager.featureConfig('script_analysis');
      if (!featureConfig) {
        return;
      }

      setShotStatus(projectId, "generating");
      
      // Clear existing shots and prepare for streaming updates
      setShots(projectId, []);
      let accumulatedShots: import("@/types/script").Shot[] = [];

      try {
        // Pass all API keys for rotation
        const allKeysString = featureConfig.allApiKeys.join(',');
        const provider = featureConfig.platform === 'zhipu' ? 'zhipu' : 'openai';
        
        console.log(`[ScriptView] Generating shots with ${featureConfig.allApiKeys.length} API keys`);

        // Build character descriptions from library if available
        const characterDescriptions: Record<string, string> = {};
        targetData.characters.forEach((char) => {
          const libChar = allCharacters.find(
            (c) => c.name === char.name || c.name.includes(char.name)
          );
          if (libChar) {
            characterDescriptions[char.id] =
              libChar.visualTraits || libChar.description || "";
          }
        });

        // Streaming callback: update UI immediately when each scene completes
        const onShotsGenerated = (newShots: import("@/types/script").Shot[], sceneIndex: number) => {
          // Re-index new shots to be sequential
          const reindexedShots = newShots.map((shot, idx) => ({
            ...shot,
            id: `shot-${accumulatedShots.length + idx + 1}`,
            index: accumulatedShots.length + idx + 1,
          }));
          
          accumulatedShots = [...accumulatedShots, ...reindexedShots];
          
          // Update UI immediately
          setShots(projectId, [...accumulatedShots]);
          
          console.log(`[ScriptView] 场景 ${sceneIndex + 1} 完成，已生成 ${accumulatedShots.length} 个分镜`);
        };

        // Progress callback
        const onProgress = (completed: number, total: number) => {
          console.log(`[ScriptView] 进度: ${completed}/${total} 场景`);
        };

        const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
        const model = featureConfig.models?.[0];
        if (!baseUrl || !model) {
          toast.error('请先在设置中配置「剧本分析」的 Base URL 和模型');
          setShotStatus(projectId, "error", "缺少 Base URL 或模型配置");
          return;
        }

        const result = await generateShotList(
          targetData,
          {
            apiKey: allKeysString,
            provider: provider as string,
            baseUrl,
            model,
            targetDuration,
            styleId,
            characterDescriptions,
            shotCount: shotCount ? parseInt(shotCount) : undefined,
          },
          onProgress,
          onShotsGenerated // 流式回调
        );

        // Final update with all shots (in case streaming missed any)
        setShots(projectId, result);
        setShotStatus(projectId, "ready");
        toast.success(`生成完成: ${result.length} 个分镜`);
      } catch (error) {
        const err = error as Error;
        console.error("[ScriptView] Shot generation failed:", err);
        setShotStatus(projectId, "error", err.message);
        toast.error(`分镜生成失败: ${err.message}`);
      }
    },
    [
      scriptData,
      targetDuration,
      styleId,
      shotCount,
      projectId,
      allCharacters,
      setShotStatus,
      setShots,
    ]
  );

  // 跳转到角色库（传递数据到生成控制台）
  const handleGoToCharacterLibrary = useCallback(
    (characterId: string) => {
      // 查找角色数据
      const character = scriptData?.characters.find((c) => c.id === characterId);
      if (!character) {
        setActiveTab("characters");
        toast.info("已跳转到角色库");
        return;
      }

      // 检查是否已关联角色库
      if (character.characterLibraryId) {
        // 已关联，直接跳转并选中
        selectLibraryCharacter(character.characterLibraryId);
        setActiveTab("characters");
        toast.info(`已跳转到角色库，选中「${character.name}」`);
        return;
      }

      // 传递角色数据到角色库生成控制台（包含世界级大师生成的视觉提示词）
      // 获取剧本元数据中的年代信息
      const background = scriptProject?.projectBackground;
      
      goToCharacterWithData({
        name: character.name,
        gender: character.gender,
        age: character.age,
        personality: character.personality,
        role: character.role,
        traits: character.traits,
        skills: character.skills,
        keyActions: character.keyActions,
        appearance: character.appearance,
        relationships: character.relationships,
        tags: character.tags,
        notes: character.notes,
        styleId,
        // === 提示词语言偏好 ===
        promptLanguage: scriptProject?.promptLanguage || 'zh',
        // === 专业角色设计字段（世界级大师生成）===
        visualPromptEn: character.visualPromptEn,
        visualPromptZh: character.visualPromptZh,
        // === 6层身份锚点（角色一致性）===
        identityAnchors: character.identityAnchors,
        negativePrompt: character.negativePrompt,
        // === 多阶段角色支持 ===
        stageInfo: character.stageInfo,
        consistencyElements: character.consistencyElements,
        // === 年代信息（从剧本元数据传递）===
        storyYear: background?.storyStartYear,
        era: background?.era || background?.timelineSetting,
        // === 集作用域透传 ===
        sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
        sourceEpisodeId: activeEpisodeId,
      });

      toast.success(`已跳转到角色库，角色「${character.name}」信息已填充到生成控制台`);
    },
    [scriptData, styleId, setActiveTab, selectLibraryCharacter, goToCharacterWithData, activeEpisodeIndex, activeEpisodeId]
  );

  // 获取当前风格的 tokens（从统一风格库导入）
  const getStyleTokensLocal = useCallback((currentStyleId: string) => {
    return getStyleTokens(currentStyleId);
  }, []);

  // 跳转到场景库（使用 AI 分析的完整数据，或基础场景信息）
  const handleGoToSceneLibrary = useCallback(
    (sceneId: string) => {
      // 查找场景数据
      const scene = scriptData?.scenes.find((s) => s.id === sceneId);
      if (!scene) {
        setActiveTab("scenes");
        toast.info("已跳转到场景库");
        return;
      }

      const hasViewpoints = scene.viewpoints && scene.viewpoints.length > 0;
      const hasCalibrationData = scene.architectureStyle || scene.keyProps?.length || scene.lightingDesign;

      if (hasViewpoints) {
        // 【完整路径】有 AI 视角分析结果，构建联合图数据
        const invalidViewpoints = scene.viewpoints!.filter(vp => !vp.name || !vp.id);
        if (invalidViewpoints.length > 0) {
          console.warn('[handleGoToSceneLibrary] 发现不完整的 viewpoints:', invalidViewpoints);
          toast.warning('视角数据不完整，请重新执行"AI 分析场景视角"');
          return;
        }

        const styleTokens = getStyleTokens(styleId);
        const contactSheetData = buildContactSheetDataFromViewpoints(
          scene.viewpoints!,
          scene,
          shots,
          styleTokens,
          '16:9'
        );

        console.log('[handleGoToSceneLibrary] 使用 AI 分析数据生成联合图:', {
          sceneId: scene.id,
          viewpointsCount: scene.viewpoints!.length,
          pendingViewpointsCount: contactSheetData.viewpoints.length,
          contactSheetPromptsCount: contactSheetData.contactSheetPrompts.length,
        });

        goToSceneWithData({
          name: scene.name || scene.location,
          location: scene.location,
          time: scene.time,
          atmosphere: scene.atmosphere,
          styleId,
          tags: scene.tags,
          notes: scene.notes,
          visualPrompt: scene.visualPrompt,
          visualPromptEn: scene.visualPromptEn,
          architectureStyle: scene.architectureStyle,
          lightingDesign: scene.lightingDesign,
          colorPalette: scene.colorPalette,
          eraDetails: scene.eraDetails,
          keyProps: scene.keyProps,
          spatialLayout: scene.spatialLayout,
          viewpoints: contactSheetData.viewpoints,
          contactSheetPrompts: contactSheetData.contactSheetPrompts,
          // === 集作用域透传 ===
          sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
          sourceEpisodeId: activeEpisodeId,
          // === 提示词语言偏好 ===
          promptLanguage: scriptProject?.promptLanguage || 'zh',
        });

        const viewpointCount = scene.viewpoints!.length;
        toast.success(
          `已跳转到场景库，场景「${scene.name || scene.location}」已填充\n` +
          `✔ ${viewpointCount} 个 AI 分析视角已加载`
        );
      } else {
        // 【简单路径】无视角分析（创作模式或未校准），传递基础场景信息
        goToSceneWithData({
          name: scene.name || scene.location,
          location: scene.location,
          time: scene.time,
          atmosphere: scene.atmosphere,
          styleId,
          tags: scene.tags,
          notes: scene.notes,
          ...(hasCalibrationData && {
            visualPrompt: scene.visualPrompt,
            visualPromptEn: scene.visualPromptEn,
            architectureStyle: scene.architectureStyle,
            lightingDesign: scene.lightingDesign,
            colorPalette: scene.colorPalette,
            eraDetails: scene.eraDetails,
            keyProps: scene.keyProps,
            spatialLayout: scene.spatialLayout,
          }),
          // === 集作用域透传 ===
          sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
          sourceEpisodeId: activeEpisodeId,
          // === 提示词语言偏好 ===
          promptLanguage: scriptProject?.promptLanguage || 'zh',
        });

        toast.success(
          `已跳转到场景库，场景「${scene.name || scene.location}」基础信息已填充`
        );
      }
    },
    [scriptData, styleId, setActiveTab, goToSceneWithData, shots, activeEpisodeIndex, activeEpisodeId]
  );

  // 跳转到AI导演
  const handleGoToDirector = useCallback(
    (shotId: string) => {
      // 查找分镜数据
      const shot = shots.find((s) => s.id === shotId);
      if (!shot) {
        setActiveTab("director");
        toast.info("已跳转到AI导演");
        return;
      }

      // 查找场景信息
      const scene = scriptData?.scenes.find((s) => s.id === shot.sceneRefId);

      // 组合故事prompt: 场景 + 动作 + 对白
      const promptParts: string[] = [];
      if (scene) {
        promptParts.push(`场景：${scene.location || scene.name}`);
        if (scene.time) promptParts.push(`时间：${scene.time}`);
        if (scene.atmosphere) promptParts.push(`氛围：${scene.atmosphere}`);
      }
      if (shot.actionSummary) {
        promptParts.push(`\n动作：${shot.actionSummary}`);
      }
      if (shot.dialogue) {
        promptParts.push(`对白：「${shot.dialogue}」`);
      }

      const storyPrompt = promptParts.join("\n");

      // 传递数据并跳转 - 单个分镜 sceneCount=1
      goToDirectorWithData({
        storyPrompt,
        characterNames: shot.characterNames,
        sceneLocation: scene?.location,
        sceneTime: scene?.time,
        shotId,
        sceneCount: 1, // 单个分镜
        styleId, // 继承剧本的风格
        sourceType: 'shot',
        // === 集作用域透传 ===
        sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
        sourceEpisodeId: activeEpisodeId,
      });

      toast.success("已跳转到AI导演，分镜内容已填充");
    },
    [shots, scriptData, styleId, goToDirectorWithData, setActiveTab, activeEpisodeIndex, activeEpisodeId]
  );

  // 从场景跳转到AI导演（整个场景的所有分镜）
  const handleGoToDirectorFromScene = useCallback(
    (sceneId: string) => {
      // 查找场景数据
      const scene = scriptData?.scenes.find((s) => s.id === sceneId);
      if (!scene) {
        setActiveTab("director");
        toast.info("已跳转到AI导演");
        return;
      }

      // 查找该场景下的所有分镜
      const sceneShots = shots.filter((s) => s.sceneRefId === sceneId);
      const shotCount = sceneShots.length || 1;

      // 组合故事prompt: 场景信息 + 所有分镜内容
      const promptParts: string[] = [];
      promptParts.push(`场景：${scene.location || scene.name}`);
      if (scene.time) promptParts.push(`时间：${scene.time}`);
      if (scene.atmosphere) promptParts.push(`氛围：${scene.atmosphere}`);

      if (sceneShots.length > 0) {
        promptParts.push(`\n--- 分镜列表 (${sceneShots.length}个) ---`);
        sceneShots.forEach((shot, idx) => {
          const shotDesc = [
            `\n[分镜${idx + 1}]`,
            shot.actionSummary ? `动作：${shot.actionSummary}` : null,
            shot.dialogue ? `对白：「${shot.dialogue}」` : null,
          ].filter(Boolean).join(" ");
          promptParts.push(shotDesc);
        });
      }

      const storyPrompt = promptParts.join("\n");

      // 收集所有分镜的角色
      const allCharacterNames = new Set<string>();
      sceneShots.forEach((shot) => {
        shot.characterNames?.forEach((name) => allCharacterNames.add(name));
      });

      // 传递数据并跳转 - 场景级别 sceneCount=分镜数
      goToDirectorWithData({
        storyPrompt,
        characterNames: Array.from(allCharacterNames),
        sceneLocation: scene.location,
        sceneTime: scene.time,
        sceneCount: shotCount,
        styleId,
        sourceType: 'scene',
        // === 集作用域透传 ===
        sourceEpisodeIndex: activeEpisodeIndex ?? undefined,
        sourceEpisodeId: activeEpisodeId,
      });

      toast.success(`已跳转到AI导演，场景「${scene.name || scene.location}」已填充 (${shotCount}个分镜)`);
    },
    [shots, scriptData, styleId, goToDirectorWithData, setActiveTab, activeEpisodeIndex, activeEpisodeId]
  );

  // CRUD handlers - 封装projectId
  // Episode 使用 Bundle 版本（同步 episodeRawScripts）
  const handleAddEpisodeBundle = useCallback((title: string, synopsis: string) => {
    addEpisodeBundle(projectId, title, synopsis);
  }, [projectId, addEpisodeBundle]);

  const handleUpdateEpisodeBundle = useCallback((episodeIndex: number, updates: { title?: string; synopsis?: string }) => {
    updateEpisodeBundle(projectId, episodeIndex, updates);
  }, [projectId, updateEpisodeBundle]);

  const handleDeleteEpisodeBundle = useCallback((episodeIndex: number) => {
    deleteEpisodeBundle(projectId, episodeIndex);
    // 清除选中状态（如果删除的是当前选中集）
    const ep = scriptData?.episodes?.find(e => e.index === episodeIndex);
    if (ep && selectedItemId === ep.id) {
      setSelectedItemId(null);
      setSelectedItemType(null);
    }
  }, [projectId, deleteEpisodeBundle, scriptData?.episodes, selectedItemId]);

  const handleAddScene = useCallback((scene: import("@/types/script").ScriptScene, episodeId?: string) => {
    addScene(projectId, scene, episodeId);
  }, [projectId, addScene]);

  const handleUpdateScene = useCallback((id: string, updates: Partial<import("@/types/script").ScriptScene>) => {
    updateScene(projectId, id, updates);
  }, [projectId, updateScene]);

  const handleDeleteScene = useCallback((id: string) => {
    deleteScene(projectId, id);
    if (selectedItemId === id) {
      setSelectedItemId(null);
      setSelectedItemType(null);
    }
  }, [projectId, deleteScene, selectedItemId]);

  const handleAddCharacter = useCallback((character: import("@/types/script").ScriptCharacter) => {
    addCharacter(projectId, character);
  }, [projectId, addCharacter]);

  const handleUpdateCharacter = useCallback((id: string, updates: Partial<import("@/types/script").ScriptCharacter>) => {
    updateCharacter(projectId, id, updates);
  }, [projectId, updateCharacter]);

  const handleDeleteCharacter = useCallback((id: string) => {
    deleteCharacter(projectId, id);
    if (selectedItemId === id) {
      setSelectedItemId(null);
      setSelectedItemType(null);
    }
  }, [projectId, deleteCharacter, selectedItemId]);

  const handleUpdateShot = useCallback((id: string, updates: Partial<import("@/types/script").Shot>) => {
    updateShot(projectId, id, updates);
  }, [projectId, updateShot]);

  const handleDeleteShot = useCallback((id: string) => {
    deleteShot(projectId, id);
    if (selectedItemId === id) {
      setSelectedItemId(null);
      setSelectedItemType(null);
    }
  }, [projectId, deleteShot, selectedItemId]);

  // AI 角色查找回调
  const handleAIFindCharacter = useCallback(async (query: string) => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      return {
        found: false,
        name: '',
        message: '请先配置 AI 接口',
      };
    }
    
    const background = scriptProject?.projectBackground;
    if (!background) {
      return {
        found: false,
        name: '',
        message: '请先导入剧本',
      };
    }
    
    const existingCharacters = scriptData?.characters || [];
    
    try {
      const result = await findCharacterByDescription(
        query,
        background,
        episodeRawScripts,
        existingCharacters,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform as string,
          baseUrl: featureConfig.baseUrl,
        }
      );
      
      return {
        found: result.found,
        name: result.name,
        message: result.message,
        character: result.character,
      };
    } catch (error) {
      console.error('[handleAIFindCharacter] 错误:', error);
      return {
        found: false,
        name: '',
        message: '查找失败，请重试',
      };
    }
  }, [scriptProject?.projectBackground, episodeRawScripts, scriptData?.characters]);

  // AI 场景查找回调
  const handleAIFindScene = useCallback(async (query: string) => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      return {
        found: false,
        message: '请先配置 AI 接口',
      };
    }
    
    const background = scriptProject?.projectBackground;
    if (!background) {
      return {
        found: false,
        message: '请先导入剧本',
      };
    }
    
    const existingScenes = scriptData?.scenes || [];
    
    try {
      const result = await findSceneByDescription(
        query,
        background,
        episodeRawScripts,
        existingScenes,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform as string,
          baseUrl: featureConfig.baseUrl,
        }
      );
      
      return {
        found: result.found,
        message: result.message,
        scene: result.scene,
      };
    } catch (error) {
      console.error('[handleAIFindScene] 错误:', error);
      return {
        found: false,
        message: '查找失败，请重试',
      };
    }
  }, [scriptProject?.projectBackground, episodeRawScripts, scriptData?.scenes]);

  // 清除预告片
  const handleClearTrailer = useCallback(() => {
    clearTrailer();
    toast.success('预告片已清除');
  }, [clearTrailer]);
  
  // 获取预告片 API 配置
  const trailerApiOptions = useCallback((): TrailerGenerationOptions | null => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) return null;
    return {
      apiKey: featureConfig.allApiKeys.join(','),
      provider: featureConfig.platform as string,
      baseUrl: featureConfig.baseUrl,
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 pb-2 bg-panel border-b">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            剧本编辑
          </h2>
          <span className="text-xs text-muted-foreground">
            {parseStatus === "parsing"
              ? "解析中..."
              : scriptProject?.shotStatus === "generating"
              ? "分镜生成中..."
              : parseStatus === "ready" && scriptData
              ? `${scriptData.title}`
              : ""}
          </span>
        </div>
      </div>

      {/* 三栏布局 */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* 左栏：剧本输入 */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <ScriptInput
            rawScript={effectiveRawScript}
            language={language}
            targetDuration={targetDuration}
            styleId={styleId}
            sceneCount={sceneCount}
            shotCount={shotCount}
            parseStatus={parseStatus}
            parseError={parseError}
            chatConfigured={chatConfigured}
            onRawScriptChange={activeEpisodeIndex != null
              ? (v) => updateEpisodeRawScript(projectId, activeEpisodeIndex, { rawContent: v })
              : (v) => setRawScript(projectId, v)}
            onLanguageChange={(v) => setLanguage(projectId, v)}
            onDurationChange={(v) => setTargetDuration(projectId, v)}
            onStyleChange={(v) => setStyleId(projectId, v)}
            onSceneCountChange={(v) => setSceneCount(projectId, v === "auto" ? undefined : v)}
            onShotCountChange={(v) => setShotCount(projectId, v === "auto" ? undefined : v)}
            onParse={handleParse}
            onGenerateFromIdea={handleGenerateFromIdea}
            onImportFullScript={handleImportFullScript}
            importStatus={importStatus}
            importError={importError}
            onCalibrate={handleCalibrate}
            calibrationStatus={calibrationStatus}
            missingTitleCount={missingTitleCount}
            onGenerateSynopses={handleGenerateSynopses}
            synopsisStatus={synopsisStatus}
            missingSynopsisCount={missingSynopsisCount}
            viewpointAnalysisStatus={viewpointAnalysisStatus}
            characterCalibrationStatus={characterCalibrationStatus}
            sceneCalibrationStatus={sceneCalibrationStatus}
            secondPassTypes={secondPassTypes}
            promptLanguage={promptLanguage}
            onPromptLanguageChange={(v) => setPromptLanguage(projectId, v)}
          />
        </ResizablePanel>

        <ResizableHandle />

        {/* 中间栏：层级结构 */}
        <ResizablePanel defaultSize={40} minSize={25}>
          <EpisodeTree
            scriptData={scriptData}
            shots={shots}
            shotStatus={scriptProject?.shotStatus}
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
            onSelectItem={handleSelectItem}
            onAddEpisodeBundle={handleAddEpisodeBundle}
            onUpdateEpisodeBundle={handleUpdateEpisodeBundle}
            onDeleteEpisodeBundle={handleDeleteEpisodeBundle}
            onAddScene={handleAddScene}
            onUpdateScene={handleUpdateScene}
            onDeleteScene={handleDeleteScene}
            onAddCharacter={handleAddCharacter}
            onUpdateCharacter={handleUpdateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onDeleteShot={handleDeleteShot}
            onGenerateEpisodeShots={handleGenerateEpisodeShots}
            onRegenerateAllShots={handleRegenerateAllShots}
            episodeGenerationStatus={episodeGenerationStatus}
            onCalibrateShots={handleCalibrateShots}
            onCalibrateScenesShots={handleCalibrateScenesShots}
            onCalibrateCharacters={handleCalibrateCharacters}
            characterCalibrationStatus={characterCalibrationStatus}
            // AI 角色查找相关
            projectBackground={scriptProject?.projectBackground ?? undefined}
            episodeRawScripts={episodeRawScripts}
            onAIFindCharacter={scriptProject?.projectBackground ? handleAIFindCharacter : undefined}
            // AI 场景查找相关
            onAIFindScene={scriptProject?.projectBackground ? handleAIFindScene : undefined}
            // 场景校准相关
            onCalibrateScenes={scriptProject?.projectBackground ? handleCalibrateScenes : undefined}
            onCalibrateEpisodeScenes={scriptProject?.projectBackground ? handleCalibrateEpisodeScenes : undefined}
            sceneCalibrationStatus={sceneCalibrationStatus}
            // 预告片相关
            trailerConfig={trailerConfig}
            onGenerateTrailer={handleGenerateTrailer}
            onClearTrailer={handleClearTrailer}
            trailerApiOptions={trailerApiOptions()}
            // 单个分镜校准
            onCalibrateSingleShot={handleCalibrateSingleShot}
            singleShotCalibrationStatus={singleShotCalibrationStatus}
            // 校准严格度相关
            calibrationStrictness={scriptProject?.calibrationStrictness || 'normal'}
            onCalibrationStrictnessChange={handleCalibrationStrictnessChange}
            lastFilteredCharacters={scriptProject?.lastFilteredCharacters || []}
            onRestoreFilteredCharacter={handleRestoreFilteredCharacter}
            // 校准确认弹窗
            calibrationDialogOpen={calibrationDialogOpen}
            pendingCalibrationCharacters={pendingCalibrationCharacters}
            pendingFilteredCharacters={pendingFilteredCharacters}
            onConfirmCalibration={handleConfirmCalibration}
            onCancelCalibration={handleCancelCalibration}
          />
        </ResizablePanel>

        <ResizableHandle />

        {/* 右栏：属性面板 */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <PropertyPanel
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
            character={selectedCharacter}
            scene={selectedScene}
            shot={selectedShot}
            episode={selectedEpisode}
            episodeShots={selectedEpisodeShots}
            sceneShots={selectedSceneShots}
            onGoToCharacterLibrary={handleGoToCharacterLibrary}
            onGoToSceneLibrary={handleGoToSceneLibrary}
            onGoToDirector={handleGoToDirector}
            onGoToDirectorFromScene={handleGoToDirectorFromScene}
            onGenerateEpisodeShots={handleGenerateEpisodeShots}
            onCalibrateShots={handleCalibrateShots}
            onUpdateCharacter={handleUpdateCharacter}
            onUpdateScene={handleUpdateScene}
            onUpdateShot={handleUpdateShot}
            onDeleteCharacter={handleDeleteCharacter}
            onDeleteScene={handleDeleteScene}
            onDeleteShot={handleDeleteShot}
            // 角色阶段分析
            onAnalyzeCharacterStages={handleAnalyzeCharacterStages}
            stageAnalysisStatus={stageAnalysisStatus}
            suggestMultiStage={suggestMultiStage}
            multiStageHints={multiStageHints}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 结构补全覆盖确认弹窗 */}
      <AlertDialog open={structureOverwriteConfirmOpen} onOpenChange={setStructureOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖现有场景结构？</AlertDialogTitle>
            <AlertDialogDescription>
              该集已有场景数据，重新解析将替换现有场景并清理对应分镜。确认继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleStructureCompletion()}>
              确认覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
