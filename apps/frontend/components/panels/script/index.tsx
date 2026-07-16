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

import { useState, useCallback } from "react";
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
import { generateMultiPageContactSheetData } from "@/lib/script/scene-viewpoint-generator";
import {
  sortByImportance as sortScenesByImportance,
} from "@/lib/script/scene-calibrator";
import type { TrailerGenerationOptions } from "@/lib/script/trailer-service";
import { useDirectorStore, useActiveDirectorProject } from "@/stores/director-store";
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
import { useScriptCrudActions } from "./use-script-crud-actions";
import { useScriptStructureCompletion } from "./use-script-structure-completion";
import { useScriptNavigation } from "./use-script-navigation";
import { useScriptShotCalibration } from "./use-script-shot-calibration";
import { useScriptAuthoringActions } from "./use-script-authoring-actions";
import { useScriptEntityLookup } from "./use-script-entity-lookup";
import { useScriptCharacterReviewActions } from "./use-script-character-review-actions";
import { useScriptProjectLifecycle } from "./use-script-project-lifecycle";
import { useScriptBatchShotRegeneration } from "./use-script-batch-shot-regeneration";
import { useScriptMissingEpisodeCounts } from "./use-script-missing-episode-counts";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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

  // 导入/大纲生成状态持久化到 store，面板切换后可恢复
  const importStatus = calibrationState?.importStatus || 'idle';
  const synopsisStatus = calibrationState?.synopsisStatus || 'idle';

  // 大纲生成状态
  
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

  const {
    projectId,
    setProjectSynopsisStatus,
    setImportStatus,
    setCalibrationStatus,
    setCharacterCalibrationStatus,
    setSceneCalibrationStatus,
    setViewpointAnalysisStatus,
  } = useScriptProjectLifecycle({
    activeProjectId,
    setActiveProjectId,
    ensureProject,
    setCalibrationState: setScriptCalibrationState,
  });

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
  const setStructureCompletionStatus = useCallback((status: ScriptStructureStatus) => {
    setScriptCalibrationState(projectId, { structureCompletionStatus: status });
  }, [projectId, setScriptCalibrationState]);
  
  const {
    overwriteConfirmOpen: structureOverwriteConfirmOpen,
    setOverwriteConfirmOpen: setStructureOverwriteConfirmOpen,
    completeStructure: handleStructureCompletion,
  } = useScriptStructureCompletion({
    projectId,
    activeEpisodeIndex,
    effectiveRawScript,
    scriptData,
    status: structureCompletionStatus,
    setStatus: setStructureCompletionStatus,
  });

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

  const {
    missingTitleCount,
    setMissingTitleCount,
    missingSynopsisCount,
    setMissingSynopsisCount,
  } = useScriptMissingEpisodeCounts({
    importStatus,
    projectId,
    episodeRawScripts,
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
    background: scriptProject?.projectBackground ?? undefined,
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
    background: scriptProject?.projectBackground ?? undefined,
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

  const handleRegenerateAllShots = useScriptBatchShotRegeneration({
    projectId,
    episodeCount: episodeRawScripts.length,
    styleId,
    targetDuration,
    promptLanguage,
  });

  const {
    handleCalibrateShots,
    handleCalibrateScenesShots,
    handleCalibrateSingleShot,
  } = useScriptShotCalibration({
    projectId,
    scriptData,
    shots,
    styleId,
    promptLanguage,
    cinematographyProfileId: directorProject?.cinematographyProfileId,
    setViewpointAnalysisStatus,
    setSingleShotCalibrationStatus: setSingleShotCalibrationStatusInStore,
    addSecondPass,
    removeSecondPass,
  });

  const {
    handleAnalyzeCharacterStages,
    handleConfirmCalibration,
    handleCancelCalibration,
    handleCalibrationStrictnessChange,
    handleRestoreFilteredCharacter,
  } = useScriptCharacterReviewActions({
    projectId,
    importStatus,
    outline: scriptProject?.projectBackground?.outline,
    episodeCount: episodeRawScripts.length,
    calibrateCharacters: handleCalibrateCharacters,
    setMultiStageHints,
    setSuggestMultiStage,
    setScriptData,
    setLastFilteredCharacters,
    setCalibrationState: setScriptCalibrationState,
    setCalibrationStrictness,
  });

  const {
    handleGenerateFromIdea,
    handleParse,
  } = useScriptAuthoringActions({
    projectId,
    rawScript,
    language,
    targetDuration,
    styleId,
    sceneCount,
    shotCount,
    scriptData,
    libraryCharacters: allCharacters,
    setRawScript,
    setParseStatus,
    setScriptData,
    setShots,
    setShotStatus,
    importFullScript: handleImportFullScript,
  });

  const {
    handleGoToCharacterLibrary,
    handleGoToSceneLibrary,
    handleGoToDirector,
    handleGoToDirectorFromScene,
  } = useScriptNavigation({
    scriptData,
    shots,
    styleId,
    promptLanguage,
    projectBackground: scriptProject?.projectBackground ?? null,
    activeEpisodeIndex,
    activeEpisodeId,
    setActiveTab,
    selectLibraryCharacter,
    goToCharacterWithData,
    goToSceneWithData,
    goToDirectorWithData,
  });
  const {
    handleAddEpisodeBundle,
    handleUpdateEpisodeBundle,
    handleDeleteEpisodeBundle,
    handleAddScene,
    handleUpdateScene,
    handleDeleteScene,
    handleAddCharacter,
    handleUpdateCharacter,
    handleDeleteCharacter,
    handleUpdateShot,
    handleDeleteShot,
  } = useScriptCrudActions({
    projectId,
    episodes: scriptData?.episodes,
    selectedItemId,
    setSelectedItemId,
    setSelectedItemType,
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
  });

  const {
    handleAIFindCharacter,
    handleAIFindScene,
  } = useScriptEntityLookup({
    background: scriptProject?.projectBackground ?? undefined,
    episodes: episodeRawScripts,
    characters: scriptData?.characters || [],
    scenes: scriptData?.scenes || [],
  });

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
