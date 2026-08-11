// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Director Context Panel Component
 * 全局右栏 - AI导演模式：显示剧本层级树，让用户选择要生成的内容
 */

import { useState, useMemo, useCallback } from "react";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useActiveScriptProject } from "@/stores/script/script-store";
import { getShotCompletionStatus, calculateProgress, SHOT_SIZE_MAP } from "@/lib/script/shot-utils";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  FileVideo,
  Plus,
} from "lucide-react";
import type { Shot, ScriptScene } from "@/types/script";
import { DEFAULT_STYLE_ID, getStyleById } from "@/lib/constants/visual-styles";
import { useDirectorStore, useActiveDirectorProject, type SoundEffectTag, type EmotionTag } from '@/stores/director/director-store';
import { useCharacterLibraryStore } from '@/stores/library/character-library-store';
import { useSceneStore } from '@/stores/library/scene-store';
import { useAppSettingsStore } from '@/stores/app/app-settings-store';
import { useProjectStore } from '@/stores/project/project-store';
import { toast } from "sonner";
import { matchSceneAndViewpoint, type ViewpointMatchResult } from '@/lib/scene/viewpoint-matcher';
import { DirectorContextTree } from "./director-context-tree";
import {
  findQuickSceneViewpointMatch,
  mapScriptCharactersToLibraryIds,
} from "./director-context-mapping";

// 导出组件
export function DirectorContextPanel() {
  const { setActiveTab, goToDirectorWithData } = useMediaPanelStore();
  const scriptProject = useActiveScriptProject();
  const { addScenesFromScript, setStoryboardConfig } = useDirectorStore();
  const { resourceSharing } = useAppSettingsStore();
  const { activeProjectId } = useProjectStore();
  
  // Get current project data
  const projectData = useActiveDirectorProject();
  const splitScenes = projectData?.splitScenes || [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const storyboardStatus = projectData?.storyboardStatus || 'idle';
  
  // 获取场景库数据
  const { scenes } = useSceneStore();
  const sceneLibraryScenes = useMemo(() => {
    if (resourceSharing.shareScenes) return scenes;
    if (!activeProjectId) return [];
    return scenes.filter((s) => s.projectId === activeProjectId);
  }, [scenes, resourceSharing.shareScenes, activeProjectId]);

  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set(["default", "ep_1"]));
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);

  const scriptData = scriptProject?.scriptData || null;
// eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = scriptProject?.shots || [];
  const styleId = scriptProject?.styleId ?? DEFAULT_STYLE_ID;

  // 从剧本添加分镜时，同步剧本风格到导演面板的 storyboardConfig
  const addScenesAndSyncStyle: typeof addScenesFromScript = useCallback((scenes) => {
    addScenesFromScript(scenes);
    // 如果导演面板尚未设置 visualStyleId，从剧本项目继承
    const directorStyleId = projectData?.storyboardConfig?.visualStyleId;
    if (!directorStyleId && scriptProject?.styleId) {
      const style = getStyleById(scriptProject.styleId);
      if (style) {
        setStoryboardConfig({ visualStyleId: style.id, styleTokens: [style.prompt] });
      }
    }
  }, [addScenesFromScript, setStoryboardConfig, projectData?.storyboardConfig?.visualStyleId, scriptProject?.styleId]);

  // 如果没有episodes，创建一个默认的
  const episodes = useMemo(() => {
    if (!scriptData) return [];
    if (scriptData.episodes && scriptData.episodes.length > 0) {
      return scriptData.episodes;
    }
    // 默认单集
    return [{
      id: "default",
      index: 1,
      title: scriptData.title || "第1集",
      sceneIds: scriptData.scenes.map((s) => s.id),
    }];
  }, [scriptData]);

  // 按场景分组的shots
  const shotsByScene = useMemo(() => {
    const map: Record<string, Shot[]> = {};
    shots.forEach((shot) => {
      const sceneId = shot.sceneRefId;
      if (!map[sceneId]) map[sceneId] = [];
      map[sceneId].push(shot);
    });
    return map;
  }, [shots]);

  const handleBackToScript = () => {
    setActiveTab("script");
  };

  const toggleEpisode = (id: string) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleScene = (id: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 获取角色库中的所有角色
  const { characters } = useCharacterLibraryStore();
  const libraryCharacters = useMemo(() => {
    if (resourceSharing.shareCharacters) return characters;
    if (!activeProjectId) return [];
    return characters.filter((c) => c.projectId === activeProjectId);
  }, [characters, resourceSharing.shareCharacters, activeProjectId]);
  
  // 在场景库中查找匹配的视角
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const findViewpointInLibrary = (sceneName: string, viewpointName: string): ViewpointMatchResult | null => {
    
    // 找到匹配的父场景
    const parentScenes = sceneLibraryScenes.filter(s => 
      !s.parentSceneId && !s.isViewpointVariant &&
      (s.name.includes(sceneName) || sceneName.includes(s.name))
    );
    
    
    if (parentScenes.length === 0) return null;
    
    // 在父场景的视角变体中查找匹配的视角
    for (const parent of parentScenes) {
      const variants = sceneLibraryScenes.filter(s => s.parentSceneId === parent.id);
      
      // 模糊匹配视角名称
      const matchedVariant = variants.find(v => {
        const variantName = v.viewpointName || v.name || '';
        const isMatch = variantName.includes(viewpointName) || viewpointName.includes(variantName);
        return isMatch;
      });
      
      if (matchedVariant) {
        return {
          sceneLibraryId: matchedVariant.id,
          viewpointId: matchedVariant.viewpointId,
          sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
          matchedSceneName: matchedVariant.viewpointName || matchedVariant.name,
          matchMethod: 'keyword' as const,
          confidence: 0.95,
        };
      }
    }
    
    // 没找到视角，返回父场景
    const bestParent = parentScenes[0];
    return {
      sceneLibraryId: bestParent.id,
      viewpointId: undefined,
      sceneReferenceImage: bestParent.referenceImage || bestParent.referenceImageBase64,
      matchedSceneName: bestParent.name,
      matchMethod: 'fallback' as const,
      confidence: 0.5,
    };
  };
  
  // 异步版本：关键词 + AI 匹配（用于批量添加）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const findMatchingSceneAndViewpointWithAI = async (sceneName: string, actionSummary: string): Promise<ViewpointMatchResult | null> => {
    return matchSceneAndViewpoint(sceneName, actionSummary, sceneLibraryScenes);
  };

  // 添加单个分镜到分镜编辑（模式二）
  const handleAddShotToSplitScenes = (shot: Shot, scene: ScriptScene) => {
    // Debug: 检查 Shot 中的三层提示词数据
    // 使用详细的视觉描述作为提示词（优先）
    let promptZh = shot.visualDescription || '';
    if (!promptZh) {
      const parts: string[] = [];
      if (scene.location) parts.push(scene.location);
      if (shot.actionSummary) parts.push(shot.actionSummary);
      promptZh = parts.join(' - ');
    }
    
    // 将剧本角色ID/名称映射到角色库ID
    const characterLibraryIds = mapScriptCharactersToLibraryIds({
      scriptCharacterIds: shot.characterIds || [],
      characterNames: shot.characterNames,
      scriptCharacters: scriptData?.characters || [],
      libraryCharacters,
    });
    
    // 获取分镜在场景内的序号
    const sceneShots = shotsByScene[scene.id] || [];
    const shotIndexInScene = sceneShots.findIndex(s => s.id === shot.id);
    
    // 自动匹配场景库中的场景和视角（优先使用已有的视角关联）
    const sceneMatch = findQuickSceneViewpointMatch({
      shot,
      scene,
      sceneLibraryScenes,
      shotIndexInScene: shotIndexInScene >= 0 ? shotIndexInScene : undefined,
    });
    
    addScenesAndSyncStyle([{
      // 场景信息
      sceneName: sceneMatch?.matchedSceneName || scene.name || '',
      sceneLocation: scene.location || '',
      // 旧提示词（兼容）
      promptZh,
      promptEn: shot.visualPrompt || shot.videoPrompt || '',
      // 三层提示词系统 (Seedance 1.5 Pro)
      imagePrompt: shot.imagePrompt || '',
      imagePromptZh: shot.imagePromptZh || '',
      videoPrompt: shot.videoPrompt || '',
      videoPromptZh: shot.videoPromptZh || '',
      endFramePrompt: shot.endFramePrompt || '',
      endFramePromptZh: shot.endFramePromptZh || '',
      needsEndFrame: shot.needsEndFrame || false,
      // 角色（使用角色库ID）
      characterIds: characterLibraryIds,
      // 情绪标签（AI校准产出）
      emotionTags: (shot.emotionTags || []) as EmotionTag[],
      // 景别
      shotSize: shot.shotSize ? SHOT_SIZE_MAP[shot.shotSize] || null : null,
      // 时长
      duration: shot.duration || 5,
      // 音频
      ambientSound: shot.ambientSound || '',
      soundEffects: [] as SoundEffectTag[],
      soundEffectText: shot.soundEffect || '',
      // 对白
      dialogue: shot.dialogue || '',
      // 动作描述
      actionSummary: shot.actionSummary || '',
      // 镜头运动
      cameraMovement: shot.cameraMovement || '',
      // 特殊拍摄手法
      specialTechnique: shot.specialTechnique || '',
      // 场景库关联（自动匹配）
      sceneLibraryId: sceneMatch?.sceneLibraryId,
      viewpointId: sceneMatch?.viewpointId,
      sceneReferenceImage: sceneMatch?.sceneReferenceImage,
      // 叙事驱动设计（基于《电影语言的语法》）
      narrativeFunction: shot.narrativeFunction || '',
      shotPurpose: shot.shotPurpose || '',
      visualFocus: shot.visualFocus || '',
      cameraPosition: shot.cameraPosition || '',
      characterBlocking: shot.characterBlocking || '',
      rhythm: shot.rhythm || '',
      visualDescription: shot.visualDescription || '',
      // 拍摄控制（灯光/焦点/器材/特效/速度）
      lightingStyle: shot.lightingStyle,
      lightingDirection: shot.lightingDirection,
      colorTemperature: shot.colorTemperature,
      lightingNotes: shot.lightingNotes,
      depthOfField: shot.depthOfField,
      focusTarget: shot.focusTarget,
      focusTransition: shot.focusTransition,
      cameraRig: shot.cameraRig,
      movementSpeed: shot.movementSpeed,
      atmosphericEffects: shot.atmosphericEffects,
      effectIntensity: shot.effectIntensity,
      playbackSpeed: shot.playbackSpeed,
      cameraAngle: shot.cameraAngle,
      focalLength: shot.focalLength,
      photographyTechnique: shot.photographyTechnique,
    }]);
    
    const matchInfo = sceneMatch ? ` (匹配: ${sceneMatch.matchedSceneName})` : '';
    toast.success(`已添加分镜到编辑列表${matchInfo}`);
  };

  // 添加整个场景的所有分镜到分镜编辑（模式二）
  const handleAddSceneToSplitScenes = (scene: ScriptScene) => {
    const sceneShots = shotsByScene[scene.id] || [];
    
    if (sceneShots.length === 0) {
      const fallbackPromptZh = scene.visualPrompt?.trim()
        || [scene.location, scene.atmosphere].filter(Boolean).join(' - ')
        || scene.name
        || '场景描述';
      const fallbackPromptEn = scene.visualPromptEn?.trim() || '';
      const matchedScene = sceneLibraryScenes.find((s) =>
        !s.parentSceneId &&
        !s.isViewpointVariant &&
        (
          (!!scene.name && (s.name.includes(scene.name) || scene.name.includes(s.name)))
          || (!!scene.location && (s.name.includes(scene.location) || scene.location.includes(s.name)))
        )
      );

      addScenesAndSyncStyle([{
        sceneName: scene.name || scene.location || '未命名场景',
        sceneLocation: scene.location || '',
        promptZh: fallbackPromptZh,
        promptEn: fallbackPromptEn,
        imagePrompt: fallbackPromptEn,
        imagePromptZh: fallbackPromptZh,
        videoPrompt: fallbackPromptEn,
        videoPromptZh: fallbackPromptZh,
        endFramePrompt: '',
        endFramePromptZh: '',
        needsEndFrame: false,
        characterIds: [],
        emotionTags: [],
        shotSize: null,
        duration: 5,
        ambientSound: scene.atmosphere || '',
        soundEffects: [] as SoundEffectTag[],
        soundEffectText: '',
        dialogue: '',
        actionSummary: scene.atmosphere || '',
        cameraMovement: '',
        specialTechnique: '',
        sceneLibraryId: matchedScene?.id,
        viewpointId: undefined,
        sceneReferenceImage: matchedScene?.referenceImage || matchedScene?.referenceImageBase64,
      }]);

      const matchInfo = matchedScene ? `（已匹配场景库：${matchedScene.name}）` : '';
      toast.success(`该场景暂无分镜，已创建 1 条场景分镜${matchInfo}`);
      return;
    }
    
    let matchedCount = 0;
    const scenesToAdd = sceneShots.map((shot, shotIndexInScene) => {
      // 使用详细的视觉描述作为提示词（优先）
      let promptZh = shot.visualDescription || '';
      if (!promptZh) {
        const parts: string[] = [];
        if (scene.location) parts.push(scene.location);
        if (shot.actionSummary) parts.push(shot.actionSummary);
        promptZh = parts.join(' - ');
      }
      
      // 将剧本角色ID/名称映射到角色库ID
      const characterLibraryIds = mapScriptCharactersToLibraryIds({
        scriptCharacterIds: shot.characterIds || [],
        characterNames: shot.characterNames,
        scriptCharacters: scriptData?.characters || [],
        libraryCharacters,
      });
      
      // 自动匹配场景库中的场景和视角（优先使用已有的视角关联，保底用序号）
      const sceneMatch = findQuickSceneViewpointMatch({
        shot,
        scene,
        sceneLibraryScenes,
        shotIndexInScene,
      });
      if (sceneMatch) matchedCount++;
      
      return {
        // 场景信息
        sceneName: sceneMatch?.matchedSceneName || scene.name || '',
        sceneLocation: scene.location || '',
        // 旧提示词（兼容）
        promptZh,
        promptEn: shot.visualPrompt || shot.videoPrompt || '',
        // 三层提示词系统 (Seedance 1.5 Pro)
        imagePrompt: shot.imagePrompt || '',
        imagePromptZh: shot.imagePromptZh || '',
        videoPrompt: shot.videoPrompt || '',
        videoPromptZh: shot.videoPromptZh || '',
        endFramePrompt: shot.endFramePrompt || '',
        endFramePromptZh: shot.endFramePromptZh || '',
        needsEndFrame: shot.needsEndFrame || false,
        // 角色（使用角色库ID）
        characterIds: characterLibraryIds,
        // 情绪标签（AI校准产出）
        emotionTags: (shot.emotionTags || []) as EmotionTag[],
        // 景别
        shotSize: shot.shotSize ? SHOT_SIZE_MAP[shot.shotSize] || null : null,
        // 时长
        duration: shot.duration || 5,
        // 音频
        ambientSound: shot.ambientSound || '',
        soundEffects: [] as SoundEffectTag[],
        soundEffectText: shot.soundEffect || '',
        // 对白
        dialogue: shot.dialogue || '',
        // 动作描述
        actionSummary: shot.actionSummary || '',
        // 镜头运动
        cameraMovement: shot.cameraMovement || '',
        // 特殊拍摄手法
        specialTechnique: shot.specialTechnique || '',
        // 场景库关联（自动匹配）
        sceneLibraryId: sceneMatch?.sceneLibraryId,
        viewpointId: sceneMatch?.viewpointId,
        sceneReferenceImage: sceneMatch?.sceneReferenceImage,
        // 叙事驱动设计（基于《电影语言的语法》）
        narrativeFunction: shot.narrativeFunction || '',
        shotPurpose: shot.shotPurpose || '',
        visualFocus: shot.visualFocus || '',
        cameraPosition: shot.cameraPosition || '',
        characterBlocking: shot.characterBlocking || '',
        rhythm: shot.rhythm || '',
        visualDescription: shot.visualDescription || '',
        // 拍摄控制（灯光/焦点/器材/特效/速度）
        lightingStyle: shot.lightingStyle,
        lightingDirection: shot.lightingDirection,
        colorTemperature: shot.colorTemperature,
        lightingNotes: shot.lightingNotes,
        depthOfField: shot.depthOfField,
        focusTarget: shot.focusTarget,
        focusTransition: shot.focusTransition,
        cameraRig: shot.cameraRig,
        movementSpeed: shot.movementSpeed,
        atmosphericEffects: shot.atmosphericEffects,
        effectIntensity: shot.effectIntensity,
        playbackSpeed: shot.playbackSpeed,
        cameraAngle: shot.cameraAngle,
        focalLength: shot.focalLength,
        photographyTechnique: shot.photographyTechnique,
      };
    });
    
    addScenesAndSyncStyle(scenesToAdd);
    const matchInfo = matchedCount > 0 ? ` (${matchedCount}个已匹配场景库)` : '';
    toast.success(`已添加 ${scenesToAdd.length} 个分镜到编辑列表${matchInfo}`);
  };

  // 发送单个分镜到AI导演输入（模式一）
  const handleSendShot = (shot: Shot, scene: ScriptScene) => {
    // 构建故事提示
    const parts: string[] = [];
    if (scene.location) parts.push(`场景：${scene.location}`);
    if (scene.time) parts.push(`时间：${scene.time}`);
    if (shot.actionSummary) parts.push(`动作：${shot.actionSummary}`);
    if (shot.dialogue) parts.push(`对白：${shot.dialogue}`);

    const storyPrompt = parts.join("\n");

    // 提取角色名
    const characterNames: string[] = [];
    if (shot.characterIds && scriptData) {
      shot.characterIds.forEach((charId) => {
        const char = scriptData.characters.find((c) => c.id === charId);
        if (char) characterNames.push(char.name);
      });
    }

    goToDirectorWithData({
      storyPrompt,
      characterNames,
      sceneLocation: scene.location,
      sceneTime: scene.time,
      shotId: shot.id,
      sceneCount: 1,
      styleId,
      sourceType: "shot",
    });

    setSelectedShotId(shot.id);
    setSelectedSceneId(null);
  };

  // 发送整个场景到AI导演输入
  const handleSendScene = (scene: ScriptScene) => {
    const sceneShots = shotsByScene[scene.id] || [];

    // 构建故事提示 - 合并场景下所有分镜
    const parts: string[] = [];
    if (scene.location) parts.push(`场景：${scene.location}`);
    if (scene.time) parts.push(`时间：${scene.time}`);
    if (scene.atmosphere) parts.push(`氛围：${scene.atmosphere}`);

    // 添加所有分镜的动作和对白
    sceneShots.forEach((shot, idx) => {
      const shotParts: string[] = [];
      if (shot.actionSummary) shotParts.push(shot.actionSummary);
      if (shot.dialogue) shotParts.push(`"${shot.dialogue}"`);
      if (shotParts.length > 0) {
        parts.push(`[镜头${idx + 1}] ${shotParts.join(" - ")}`);
      }
    });

    const storyPrompt = parts.join("\n");

    // 收集场景中所有角色
    const characterNames: string[] = [];
    if (scriptData) {
      const charIds = new Set<string>();
      sceneShots.forEach((shot) => {
        shot.characterIds?.forEach((id) => charIds.add(id));
      });
      charIds.forEach((charId) => {
        const char = scriptData.characters.find((c) => c.id === charId);
        if (char) characterNames.push(char.name);
      });
    }

    goToDirectorWithData({
      storyPrompt,
      characterNames,
      sceneLocation: scene.location,
      sceneTime: scene.time,
      sceneCount: sceneShots.length || 1,
      styleId,
      sourceType: "scene",
    });

    setSelectedSceneId(scene.id);
    setSelectedShotId(null);
  };

  // 没有剧本数据时显示提示
  if (!scriptData) {
    return (
      <div className="h-full min-w-0 flex flex-col overflow-x-hidden">
        <div className="p-3 border-b">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <FileVideo className="h-4 w-4" />
            剧本结构
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground text-sm">
            <p>暂无剧本数据</p>
            <p className="mt-1">请先在剧本面板解析剧本</p>
          </div>
        </div>
        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleBackToScript}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            去剧本面板
          </Button>
        </div>
      </div>
    );
  }

  // 计算整体进度
  const overallProgress = calculateProgress(
    shots.map((s) => ({ status: getShotCompletionStatus(s) }))
  );

  return (
    <div className="h-full min-w-0 flex flex-col overflow-x-hidden">
      {/* 标题和进度 */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">{scriptData.title}</h3>
            {scriptData.genre && (
              <span className="text-xs text-muted-foreground">{scriptData.genre}</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            进度: {overallProgress}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          点击场景/分镜可发送到AI导演输入
        </p>
        {/* 分镜编辑计数 */}
        {splitScenes.length > 0 && (
          <div className="mt-2 px-2 py-1 bg-green-500/10 rounded text-xs text-green-600 flex items-center gap-1">
            <Plus className="h-3 w-3" />
            <span>已添加 {splitScenes.length} 个分镜到编辑列表</span>
          </div>
        )}
      </div>

      <DirectorContextTree
        episodes={episodes}
        scenes={scriptData.scenes}
        shots={shots}
        shotsByScene={shotsByScene}
        expandedEpisodes={expandedEpisodes}
        expandedScenes={expandedScenes}
        selectedSceneId={selectedSceneId}
        selectedShotId={selectedShotId}
        onToggleEpisode={toggleEpisode}
        onToggleScene={toggleScene}
        onSendScene={handleSendScene}
        onAddScene={handleAddSceneToSplitScenes}
        onSendShot={handleSendShot}
        onAddShot={handleAddShotToSplitScenes}
      />

      {/* 底部操作 */}
      <div className="p-3 border-t space-y-2">
        {/* 模式说明 */}
        <div className="text-[10px] text-muted-foreground space-y-1">
          <p><span className="text-green-500">+</span> 添加到分镜（单独生成图片）</p>
          <p><span className="text-primary">→</span> 发送到输入（批量生成省钱）</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleBackToScript}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回剧本
        </Button>
      </div>
    </div>
  );
}
