// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Scene Generation Panel - Left column
 * Scene creation controls: name, location, time, atmosphere, style, generate
 */

import { useState, useEffect } from "react";
import { 
  useSceneStore,
  type Scene,
} from "@/stores/scene-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { useScriptStore, useActiveScriptProject } from "@/stores/script-store";
import type { PromptLanguage } from "@/types/script";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media-store";
import { generateMultiPageContactSheetData, type SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import type { PendingViewpointData, ContactSheetPromptSet } from "@/stores/media-panel-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { 
  Loader2,
  MapPin,
  Plus,
  Grid3X3,
  Upload,
  Scissors,
  Copy,
  Image as ImageIcon,
  Box,
  LayoutGrid,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { 
  VISUAL_STYLE_PRESETS, 
  STYLE_CATEGORIES,
  getStylePrompt, 
  DEFAULT_STYLE_ID,
  type VisualStyleId 
} from "@/lib/constants/visual-styles";
import {
  getLayoutDimensions,
  type ContactSheetLayout,
} from "./generation-panel-utils";
import {
  useGenerationPreferences,
  type GenerationMode,
} from "./use-generation-preferences";
import { useContactSheetController } from "./use-contact-sheet-controller";
import { useContactSheetSplitting } from "./use-contact-sheet-splitting";
import { useContactSheetSave } from "./use-contact-sheet-save";
import { useAutoContactSheet } from "./use-auto-contact-sheet";
import { useBatchOrthographic } from "./use-batch-orthographic";
import { useOrthographicController } from "./use-orthographic-controller";
import { OrthographicGenerationView } from "./orthographic-generation-view";
import { ContactSheetGenerationView } from "./contact-sheet-generation-view";
import { ScenePreviewView } from "./scene-preview-view";
import { SceneGenerationForm } from "./scene-generation-form";
import { useSceneGenerationController } from "./use-scene-generation-controller";
import { buildContactSheetLayoutSync } from './contact-sheet-layout-sync';
import { usePendingSceneIntake } from './use-pending-scene-intake';

interface GenerationPanelProps {
  selectedScene: Scene | null;
  onSceneCreated?: (id: string) => void;
}

export function GenerationPanel({ selectedScene, onSceneCreated }: GenerationPanelProps) {
  const {
    addScene,
    updateScene,
    selectScene,
    generationStatus,
    generatingSceneId,
    setGenerationStatus,
    setGeneratingScene,
    generationPrefs,
    setGenerationPrefs,
    currentFolderId,
    setContactSheetTask,
  } = useSceneStore();

  const { pendingSceneData, setPendingSceneData } = useMediaPanelStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  
  // 获取当前项目的分镜数据，用于提取场景道具
  const { activeProjectId: scriptProjectId, projects } = useScriptStore();
  const { activeProjectId: resourceProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const currentProject = scriptProjectId ? projects[scriptProjectId] : null;
  const allShots = currentProject?.shots || [];

  // 提示词语言偏好（从剧本设置同步）
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>('zh');

  // Form state
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [time, setTime] = useState("day");
  const [atmosphere, setAtmosphere] = useState("peaceful");
  const [visualPrompt, setVisualPrompt] = useState(""); // 场景视觉描述
  const [tags, setTags] = useState<string[]>([]);       // 场景标签
  const [notes, setNotes] = useState("");               // 场景备注
  const [styleId, setStyleId] = useState<string>(DEFAULT_STYLE_ID);

  // Contact sheet state
  const [contactSheetPrompt, setContactSheetPrompt] = useState<string | null>(null);
  const [contactSheetPromptZh, setContactSheetPromptZh] = useState<string | null>(null);
  const [extractedViewpoints, setExtractedViewpoints] = useState<SceneViewpoint[]>([]);
  const [contactSheetImage, setContactSheetImage] = useState<string | null>(null);
  const [splitViewpointImages, setSplitViewpointImages] = useState<Record<string, { imageUrl: string; gridIndex: number }>>({});
  const [isSplitting, setIsSplitting] = useState(false);
  const [isGeneratingContactSheet, setIsGeneratingContactSheet] = useState(false);
  const [contactSheetProgress, setContactSheetProgress] = useState(0);
  // Orthographic (四视图) state
  const [orthographicPrompt, setOrthographicPrompt] = useState<string | null>(null);
  const [orthographicPromptZh, setOrthographicPromptZh] = useState<string | null>(null);
  const [orthographicImage, setOrthographicImage] = useState<string | null>(null);
  const [isGeneratingOrthographic, setIsGeneratingOrthographic] = useState(false);
  const [orthographicProgress, setOrthographicProgress] = useState(0);
  // 四视图切割结果
  const [orthographicViews, setOrthographicViews] = useState<{
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
  }>({ front: null, back: null, left: null, right: null });
  
  // 从剧本传递过来的多视角数据
  const [pendingViewpoints, setPendingViewpoints] = useState<PendingViewpointData[]>([]);
  const [pendingContactSheetPrompts, setPendingContactSheetPrompts] = useState<ContactSheetPromptSet[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  // 批量四视图状态
  const [savedChildSceneIds, setSavedChildSceneIds] = useState<string[]>([]); // 刚保存的子场景 ID

  const isGenerating = generationStatus === 'generating';

  const {
    generationMode,
    setGenerationMode,
    contactSheetLayout,
    setContactSheetLayout,
    contactSheetAspectRatio,
    setContactSheetAspectRatio,
    orthographicAspectRatio,
    setOrthographicAspectRatio,
  } = useGenerationPreferences(generationPrefs, setGenerationPrefs);

  const { handleGenerateContactSheetPrompt, handleCopyPrompt, handleGenerateContactSheetImage } = useContactSheetController({
    selectedScene,
    allShots,
    name,
    location,
    styleId,
    contactSheetAspectRatio,
    contactSheetLayout,
    contactSheetPrompt,
    contactSheetPromptZh,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setExtractedViewpoints,
    setContactSheetImage,
    setIsGeneratingContactSheet,
    setContactSheetProgress,
  });

  const {
    handleUploadContactSheet,
    handleDirectUploadContactSheet,
    handleContactSheetLayoutChange,
    handleSplitContactSheet,
  } = useContactSheetSplitting({
    contactSheetImage,
    contactSheetPrompt,
    contactSheetLayout,
    contactSheetAspectRatio,
    extractedViewpoints,
    pendingViewpoints,
    pendingContactSheetPrompts,
    currentPageIndex,
    selectScene,
    setName,
    setLocation,
    setContactSheetLayout,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setContactSheetImage,
    setExtractedViewpoints,
    setPendingViewpoints,
    setPendingContactSheetPrompts,
    setCurrentPageIndex,
    setSplitViewpointImages,
    setIsSplitting,
  });

  const handleSaveViewpointImages = useContactSheetSave({
    selectedScene,
    splitViewpointImages,
    contactSheetImage,
    extractedViewpoints,
    pendingViewpoints,
    pendingContactSheetPrompts,
    currentPageIndex,
    allShots,
    scriptScenes: currentProject?.scriptData?.scenes || [],
    name,
    location,
    time,
    atmosphere,
    styleId,
    currentFolderId,
    resourceProjectId,
    addScene,
    updateScene,
    selectScene,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setSavedChildSceneIds,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setContactSheetImage,
    setSplitViewpointImages,
    setExtractedViewpoints,
    setPendingViewpoints,
    setPendingContactSheetPrompts,
  });

  const handleAutoGenerateContactSheet = useAutoContactSheet({
    selectedScene,
    contactSheetPrompt,
    styleId,
    contactSheetAspectRatio,
    contactSheetLayout,
    pendingViewpoints,
    extractedViewpoints,
    pendingContactSheetPrompts,
    currentPageIndex,
    name,
    location,
    time,
    atmosphere,
    visualPrompt,
    tags,
    notes,
    currentFolderId,
    resourceProjectId,
    allShots,
    scriptScenes: currentProject?.scriptData?.scenes || [],
    addScene,
    updateScene,
    selectScene,
    setContactSheetTask,
    onSceneCreated,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setContactSheetImage,
    setSplitViewpointImages,
    setIsGeneratingContactSheet,
  });

  const { handleClearBatchOrthographic, handleBatchGenerateOrthographic } = useBatchOrthographic({
    savedChildSceneIds,
    styleId,
    aspectRatio: orthographicAspectRatio,
    resourceProjectId,
    addScene,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setSavedChildSceneIds,
  });

  const {
    handleGenerateOrthographicPrompt,
    handleGenerateOrthographicImage,
    handleUploadOrthographic,
    handleSplitOrthographic,
    handleSaveOrthographicViews,
    handleCancelOrthographic,
    handleCopyOrthographicPrompt,
  } = useOrthographicController({
    selectedScene,
    styleId,
    aspectRatio: orthographicAspectRatio,
    prompt: orthographicPrompt,
    promptZh: orthographicPromptZh,
    image: orthographicImage,
    views: orthographicViews,
    resourceProjectId,
    addScene,
    updateScene,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setPrompt: setOrthographicPrompt,
    setPromptZh: setOrthographicPromptZh,
    setImage: setOrthographicImage,
    setViews: setOrthographicViews,
    setIsGenerating: setIsGeneratingOrthographic,
    setProgress: setOrthographicProgress,
    setIsSplitting,
  });

  const {
    referenceImages,
    previewUrl,
    handleRefImageChange,
    removeRefImage,
    handleGenerate,
    handleSavePreview,
    handleDiscardPreview,
  } = useSceneGenerationController({
    selectedScene,
    allShots,
    name,
    location,
    time,
    atmosphere,
    visualPrompt,
    tags,
    notes,
    styleId,
    resourceProjectId,
    updateScene,
    setGenerationStatus,
    setGeneratingScene,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
  });

  // Fill form when scene selected
  useEffect(() => {
    if (selectedScene) {
      setName(selectedScene.name);
      setLocation(selectedScene.location);
      setTime(selectedScene.time || "day");
      setAtmosphere(selectedScene.atmosphere || "peaceful");
      setVisualPrompt(selectedScene.visualPrompt || "");
      setTags(selectedScene.tags || []);
      setNotes(selectedScene.notes || "");
      setStyleId(selectedScene.styleId ?? DEFAULT_STYLE_ID);
    }
  }, [selectedScene]);

  usePendingSceneIntake({
    pendingSceneData, setPendingSceneData,
    scriptPromptLanguage: scriptProject?.promptLanguage,
    currentFolderId, resourceProjectId, addScene, selectScene, onSceneCreated,
    setPromptLanguage, setName, setLocation, setTime, setAtmosphere,
    setVisualPrompt, setTags, setNotes, setStyleId, setPendingViewpoints,
    setPendingContactSheetPrompts, setCurrentPageIndex, setContactSheetPrompt,
    setContactSheetPromptZh, setContactSheetLayout, setContactSheetAspectRatio,
    setExtractedViewpoints,
  });

  // Keep the original aspect-ratio-only synchronization trigger.
  useEffect(() => {
    const sync = buildContactSheetLayoutSync({
      aspectRatio: contactSheetAspectRatio,
      viewpoints: pendingViewpoints,
      prompts: pendingContactSheetPrompts,
      currentPageIndex,
      hasCurrentPrompt: Boolean(contactSheetPrompt),
      selectedScene,
      styleId,
    });
    if (!sync) return;
    setContactSheetLayout(sync.layout);
    setPendingContactSheetPrompts(sync.prompts);
    if (sync.prompt) setContactSheetPrompt(sync.prompt);
    if (sync.promptZh) setContactSheetPromptZh(sync.promptZh);
    console.log('[ContactSheet] 宽高比变化，更新布局:', {
      aspectRatio: contactSheetAspectRatio,
      vpCount: pendingViewpoints.length,
      newLayout: sync.prompts[0]?.gridLayout,
      selectedSceneId: selectedScene?.id,
    });
  }, [contactSheetAspectRatio]); // 只监听宽高比变化

  const handleCreateScene = () => {
    if (!name.trim()) {
      toast.error("请输入场景名称");
      return;
    }
    if (!location.trim()) {
      toast.error("请输入地点描述");
      return;
    }

    // 获取当前集作用域
    const { activeEpisodeIndex } = useMediaPanelStore.getState();
    const scriptState = useScriptStore.getState();
    const activeScriptProject = scriptState.activeProjectId ? scriptState.projects[scriptState.activeProjectId] : null;
    const manualEpisodeId = activeEpisodeIndex != null
      ? activeScriptProject?.scriptData?.episodes.find(ep => ep.index === activeEpisodeIndex)?.id
      : undefined;

    const id = addScene({
      name: name.trim(),
      location: location.trim(),
      time,
      atmosphere,
      visualPrompt: visualPrompt.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      notes: notes.trim() || undefined,
      styleId,
      folderId: currentFolderId,
      projectId: resourceProjectId || undefined,
      linkedEpisodeId: manualEpisodeId,
    });

    toast.success("场景已创建");
    selectScene(id);
    onSceneCreated?.(id);
  };

  // ========== 多视角联合图功能 ==========

  /**
   * 取消多视角操作
   */
  const handleCancelContactSheet = () => {
    setContactSheetPrompt(null);
    setContactSheetPromptZh(null);
    setContactSheetImage(null);
    setSplitViewpointImages({});
    setExtractedViewpoints([]);
  };

  // ========== 四视图 UI ==========
  if (orthographicPrompt !== null) {
    return (
      <OrthographicGenerationView
        selectedScene={selectedScene}
        styleId={styleId}
        aspectRatio={orthographicAspectRatio}
        prompt={orthographicPrompt}
        promptZh={orthographicPromptZh}
        promptLanguage={promptLanguage || scriptProject?.promptLanguage || "zh"}
        image={orthographicImage}
        views={orthographicViews}
        isGenerating={isGeneratingOrthographic}
        progress={orthographicProgress}
        isSplitting={isSplitting}
        onStyleChange={setStyleId}
        onAspectRatioChange={setOrthographicAspectRatio}
        onPromptChange={(value, isZh) => {
          if (isZh) setOrthographicPromptZh(value);
          setOrthographicPrompt(value);
        }}
        onCancel={handleCancelOrthographic}
        onGenerate={handleGenerateOrthographicImage}
        onUpload={handleUploadOrthographic}
        onCopyPrompt={handleCopyOrthographicPrompt}
        onSplit={handleSplitOrthographic}
        onSave={handleSaveOrthographicViews}
      />
    );
  }
  // If showing contact sheet mode
  if (contactSheetPrompt !== null) {
    return (
      <ContactSheetGenerationView
        prompt={contactSheetPrompt}
        promptZh={contactSheetPromptZh}
        promptLanguage={promptLanguage || scriptProject?.promptLanguage || "zh"}
        promptPages={pendingContactSheetPrompts}
        pendingViewpoints={pendingViewpoints}
        extractedViewpoints={extractedViewpoints}
        currentPageIndex={currentPageIndex}
        styleId={styleId}
        aspectRatio={contactSheetAspectRatio}
        layout={contactSheetLayout}
        image={contactSheetImage}
        splitImages={splitViewpointImages}
        isGenerating={isGeneratingContactSheet}
        progress={contactSheetProgress}
        isSplitting={isSplitting}
        onCancel={handleCancelContactSheet}
        onPageChange={(pageIndex) => {
          const page = pendingContactSheetPrompts[pageIndex];
          if (!page) return;
          setCurrentPageIndex(pageIndex);
          setContactSheetPrompt(page.prompt);
          setContactSheetPromptZh(page.promptZh);
          setContactSheetImage(null);
          setSplitViewpointImages({});
        }}
        onStyleChange={setStyleId}
        onAspectRatioChange={setContactSheetAspectRatio}
        onLayoutChange={handleContactSheetLayoutChange}
        onGenerate={handleAutoGenerateContactSheet}
        onUpload={handleUploadContactSheet}
        onPromptChange={(value, isZh) => {
          if (isZh) setContactSheetPromptZh(value);
          setContactSheetPrompt(value);
        }}
        onCopyPrompt={handleCopyPrompt}
        onSplit={handleSplitContactSheet}
        onSave={handleSaveViewpointImages}
      />
    );
  }
  // If showing preview
  if (previewUrl) {
    return (
      <ScenePreviewView
        previewUrl={previewUrl}
        isGenerating={isGenerating}
        onSave={handleSavePreview}
        onRegenerate={handleGenerate}
        onDiscard={handleDiscardPreview}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-2 border-b space-y-2">
        <h3 className="font-medium text-sm">生成控制台</h3>
        {/* 生成模式切换 */}
        <ToggleGroup 
          type="single" 
          value={generationMode} 
          onValueChange={(v) => v && setGenerationMode(v as GenerationMode)}
          className="justify-start"
        >
          <ToggleGroupItem value="single" aria-label="单图" className="text-xs px-2.5 h-7 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            <ImageIcon className="h-3 w-3 mr-1" />
            单图
          </ToggleGroupItem>
          <ToggleGroupItem value="contact-sheet" aria-label="联合图" className="text-xs px-2.5 h-7 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            <Grid3X3 className="h-3 w-3 mr-1" />
            联合图
          </ToggleGroupItem>
          <ToggleGroupItem value="orthographic" aria-label="四视图" className="text-xs px-2.5 h-7 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            <Box className="h-3 w-3 mr-1" />
            四视图
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <SceneGenerationForm
        name={name}
        location={location}
        time={time}
        atmosphere={atmosphere}
        styleId={styleId}
        referenceImages={referenceImages}
        isGenerating={isGenerating}
        onNameChange={setName}
        onLocationChange={setLocation}
        onTimeChange={setTime}
        onAtmosphereChange={setAtmosphere}
        onStyleChange={setStyleId}
        onReferenceImagesChange={handleRefImageChange}
        onRemoveReferenceImage={removeRefImage}
      />

      {/* Action buttons */}
      <div className="p-3 border-t space-y-2">
        {/* 批量四视图按钮（在保存联合图视角后显示） */}
        {savedChildSceneIds.length > 0 && (
          <div className="p-3 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 space-y-2">
            <div className="text-xs text-center">
              <span className="font-medium">已保存 {savedChildSceneIds.length} 个子场景</span>
              <p className="text-muted-foreground">可为每个子场景生成四视图（共 {savedChildSceneIds.length * 4} 张）</p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleBatchGenerateOrthographic} 
                className="flex-1"
                size="sm"
              >
                <Box className="h-3 w-3 mr-1" />
                批量生成四视图
              </Button>
              <Button 
                onClick={handleClearBatchOrthographic} 
                variant="ghost"
                size="sm"
              >
                跳过
              </Button>
            </div>
          </div>
        )}
        
        {/* 单图模式 */}
        {generationMode === 'single' && (
          !selectedScene ? (
            <Button onClick={handleCreateScene} className="w-full" disabled={!name.trim() || !location.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              创建场景
            </Button>
          ) : (
            <Button 
              onClick={handleGenerate} 
              className="w-full"
              disabled={isGenerating || !location.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  {selectedScene.referenceImage ? '重新生成概念图' : '生成场景概念图'}
                </>
              )}
            </Button>
          )
        )}
        
        {/* 联合图模式 - 无论是否选中场景都显示上传选项 */}
        {generationMode === 'contact-sheet' && (
          <div className="space-y-2">
            {/* 布局选择器 */}
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">网格布局</Label>
              <Select value={contactSheetLayout} onValueChange={(v) => setContactSheetLayout(v as ContactSheetLayout)} disabled={isGenerating}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2x2">2×2 (4格)</SelectItem>
                  <SelectItem value="3x3">3×3 (9格)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedScene ? (
              <Button 
                onClick={handleGenerateContactSheetPrompt} 
                className="w-full"
                disabled={isGenerating}
              >
                <Grid3X3 className="h-4 w-4 mr-2" />
                生成多视角联合图
              </Button>
            ) : (
              <Button onClick={handleCreateScene} className="w-full" disabled={!name.trim() || !location.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                创建场景
              </Button>
            )}
            {/* 或直接上传 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">或</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <label className="block">
              <input
                type="file"
                accept="image/*"
                onChange={handleDirectUploadContactSheet}
                className="hidden"
                disabled={isGenerating}
              />
              <div className="flex items-center justify-center gap-2 p-2 border border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors">
                <Upload className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">直接上传联合图切割</span>
              </div>
            </label>
          </div>
        )}
        
        {/* 四视图模式 */}
        {generationMode === 'orthographic' && (
          !selectedScene ? (
            <Button onClick={handleCreateScene} className="w-full" disabled={!name.trim() || !location.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              创建场景
            </Button>
          ) : (
            <Button 
              onClick={handleGenerateOrthographicPrompt} 
              className="w-full"
              disabled={isGenerating}
            >
              <Box className="h-4 w-4 mr-2" />
              生成四视图
            </Button>
          )
        )}
        <p className="text-xs text-muted-foreground text-center">
          {generationMode === 'single' && '💡 单图模式：生成单一视角的场景概念图'}
          {generationMode === 'contact-sheet' && '💡 联合图模式：生成 2x3 多视角场景网格'}
          {generationMode === 'orthographic' && '💡 四视图模式：生成前/后/左/右正交视角'}
        </p>
      </div>
    </div>
  );
}

// Note: generateSceneImage is now imported from @/lib/ai/image-generator
