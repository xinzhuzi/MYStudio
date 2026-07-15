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
  TIME_PRESETS,
  ATMOSPHERE_PRESETS,
} from "@/stores/scene-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { useScriptStore, useActiveScriptProject } from "@/stores/script-store";
import type { PromptLanguage } from "@/types/script";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateMultiPageContactSheetData, type SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import type { PendingViewpointData, ContactSheetPromptSet } from "@/stores/media-panel-store";
import { saveImageToLocal } from "@/lib/image-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ImagePlus,
  X,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { StylePicker } from "@/components/ui/style-picker";
import { 
  VISUAL_STYLE_PRESETS, 
  STYLE_CATEGORIES,
  getStyleById, 
  getStylePrompt, 
  DEFAULT_STYLE_ID,
  type VisualStyleId 
} from "@/lib/constants/visual-styles";
import {
  buildScenePrompt,
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
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);

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

  // Reference image handlers
  const handleRefImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (referenceImages.length + newImages.length >= 3) break;
      try {
        const base64 = await fileToBase64(file);
        newImages.push(base64);
      } catch (err) {
        console.error("Failed to convert image:", err);
      }
    }

    if (newImages.length > 0) {
      setReferenceImages([...referenceImages, ...newImages].slice(0, 3));
    }
    e.target.value = "";
  };

  const removeRefImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
  };

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

  // Handle pending data from script panel
  // 当从剧本跳转过来时，自动创建场景并进入联合图生成模式
  useEffect(() => {
    if (!pendingSceneData) return;
    
    // 立即捕获数据并清除，防止 React 严格模式下重复执行
    const data = pendingSceneData;
    setPendingSceneData(null);
    
    // 同步提示词语言偏好
    if (data.promptLanguage) {
      setPromptLanguage(data.promptLanguage);
    } else if (scriptProject?.promptLanguage) {
      setPromptLanguage(scriptProject.promptLanguage);
    }
    
    // 如果有名称和地点，自动创建新场景
    if (data.name && data.location) {
      // 解析时间和氛围
      let timeId = "day";
      if (data.time) {
        const timePreset = TIME_PRESETS.find(
          t => t.label === data.time || t.id === data.time
        );
        timeId = timePreset?.id || "day";
      }

      let atmosphereId = "peaceful";
      if (data.atmosphere) {
        const atmospherePreset = ATMOSPHERE_PRESETS.find(
          a => a.label === data.atmosphere || a.id === data.atmosphere
        );
        atmosphereId = atmospherePreset?.id || "peaceful";
      }

      let parsedStyleId = DEFAULT_STYLE_ID;
      if (data.styleId) {
        const validStyle = getStyleById(data.styleId);
        if (validStyle) {
          parsedStyleId = validStyle.id;
        }
      }
      
      // 同步表单状态，确保 UI 显示正确的风格
      setStyleId(parsedStyleId);

      // 自动创建场景（包含专业设计字段）
      const newId = addScene({
        name: data.name.trim(),
        location: data.location.trim(),
        time: timeId,
        atmosphere: atmosphereId,
        visualPrompt: data.visualPrompt?.trim() || undefined,
        tags: data.tags?.length ? data.tags : undefined,
        notes: data.notes?.trim() || undefined,
        styleId: parsedStyleId || undefined,
        folderId: currentFolderId,
        projectId: resourceProjectId || undefined,
      // 专业场景设计字段
        architectureStyle: data.architectureStyle,
        lightingDesign: data.lightingDesign,
        colorPalette: data.colorPalette,
        eraDetails: data.eraDetails,
        keyProps: data.keyProps,
        spatialLayout: data.spatialLayout,
        // 集作用域
        linkedEpisodeId: data.sourceEpisodeId,
      } as any);

      // 选中新创建的场景
      selectScene(newId);
      onSceneCreated?.(newId);
      
      // 如果有多视角数据，直接进入联合图生成模式
      if (data.viewpoints && data.viewpoints.length > 0 &&
          data.contactSheetPrompts && data.contactSheetPrompts.length > 0) {
        setPendingViewpoints(data.viewpoints);
        setPendingContactSheetPrompts(data.contactSheetPrompts);
        setCurrentPageIndex(0);
        
        // 设置第一页的提示词
        const firstPage = data.contactSheetPrompts[0];
        setContactSheetPrompt(firstPage.prompt);
        setContactSheetPromptZh(firstPage.promptZh);
        
        // 同步布局设置，确保切割时使用正确的行列数
        if (firstPage.gridLayout) {
          const { rows, cols } = firstPage.gridLayout;
          const totalCells = rows * cols;
          
          // 根据总格数判断是 2x2 还是 3x3
          if (totalCells <= 4) {
            setContactSheetLayout('2x2');
          } else {
            setContactSheetLayout('3x3');
          }
          
          // 根据宽高比设置方向：正方形网格（3x3, 2x2）默认横屏
          if (cols >= rows) {
             setContactSheetAspectRatio('16:9');
          } else {
             setContactSheetAspectRatio('9:16');
          }
        }
        
        // 转换视角数据格式
        const firstPageViewpoints = data.viewpoints
          .filter(v => v.pageIndex === 0)
          .map(v => ({
            id: v.id,
            name: v.name,
            nameEn: v.nameEn,
            shotIds: v.shotIds,
            keyProps: v.keyProps,
            keyPropsEn: v.keyPropsEn,
            description: '',
            descriptionEn: '',
            gridIndex: v.gridIndex,
          }));
        setExtractedViewpoints(firstPageViewpoints);
        
        const pageCount = data.contactSheetPrompts.length;
        toast.success(
          `场景「${data.name}」已创建\n` +
          `✔ ${data.viewpoints.length} 个视角已加载${pageCount > 1 ? `（${pageCount}张联合图）` : ''}`
        );
      } else {
        toast.success(`场景「${data.name}」已自动创建`);
      }
    } else {
      // 只有部分数据，仅填充表单
      setName(data.name || "");
      setLocation(data.location || "");
      
      if (data.time) {
        const timePreset = TIME_PRESETS.find(
          t => t.label === data.time || t.id === data.time
        );
        setTime(timePreset?.id || "day");
      }

      if (data.atmosphere) {
        const atmospherePreset = ATMOSPHERE_PRESETS.find(
          a => a.label === data.atmosphere || a.id === data.atmosphere
        );
        setAtmosphere(atmospherePreset?.id || "peaceful");
      }

      if (data.styleId) {
        const validStyle = getStyleById(data.styleId);
        if (validStyle) {
          setStyleId(validStyle.id);
        }
      }

      if (data.visualPrompt) {
        setVisualPrompt(data.visualPrompt);
      }
      if (data.tags) {
        setTags(data.tags);
      }
      if (data.notes) {
        setNotes(data.notes);
      }
    }
  }, [pendingSceneData, setPendingSceneData, addScene, selectScene, onSceneCreated, currentFolderId]);

  // 当用户更改宽高比时，根据视角数量重新计算最优布局
  // 注意：不重新提取视角，只更新布局和提示词
  useEffect(() => {
    // 只在有 pendingViewpoints 时处理
    if (pendingViewpoints.length === 0) return;
    // 避免首次加载时重复处理
    if (pendingContactSheetPrompts.length === 0) return;
    
    const vpCount = pendingViewpoints.length;
    const isLandscape = contactSheetAspectRatio === '16:9';
    
    // 根据视角数量和宽高比计算最优布局
    // 强制使用 N x N 布局以保证宽高比一致性
    let newLayout: { rows: number; cols: number };
    
    // 如果视角数量 <= 4，使用 2x2
    // 如果视角数量 > 4，使用 3x3
    if (vpCount <= 4) {
      newLayout = { rows: 2, cols: 2 };
    } else {
      newLayout = { rows: 3, cols: 3 };
    }
    
    // 更新布局选择器
    const layoutKey = `${newLayout.rows}x${newLayout.cols}` as ContactSheetLayout;
    // 更新 UI 状态
    if (['2x2', '3x3'].includes(layoutKey)) {
      setContactSheetLayout(layoutKey);
    }
    
    // 更新 pendingContactSheetPrompts 中的 gridLayout
    const updatedPrompts = pendingContactSheetPrompts.map(p => ({
      ...p,
      gridLayout: newLayout,
    }));
    setPendingContactSheetPrompts(updatedPrompts);
    
    // 重新生成当前页的提示词（替换行列数）
    const currentPage = updatedPrompts[currentPageIndex] || updatedPrompts[0];
    if (currentPage && contactSheetPrompt) {
      const totalCells = newLayout.rows * newLayout.cols;
      const paddedCount = totalCells;
      const sceneName = selectedScene?.name || selectedScene?.location || 'scene';
      
      // 获取风格信息
      const stylePreset = getStyleById(styleId);
      const styleStr = stylePreset?.prompt || 'anime style, soft colors';
      
      // 获取视角描述
      const currentPageVps = pendingViewpoints.filter(v => v.pageIndex === currentPageIndex);
      const actualCount = currentPageVps.length;
      
      // 构建增强版提示词 (Structured Prompt)
      const promptParts: string[] = [];
      
      // 1. 核心指令区 (Instruction Block)
      promptParts.push('<instruction>');
      promptParts.push(`Generate a clean ${newLayout.rows}x${newLayout.cols} architectural concept grid with exactly ${paddedCount} equal-sized panels.`);
      promptParts.push(`Overall Image Aspect Ratio: ${isLandscape ? '16:9' : '9:16'}.`);
      
      // 明确指定单个格子的宽高比，防止 AI 混淆
      const panelAspect = isLandscape ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)';
      promptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);
      
      promptParts.push('Structure: No borders between panels, no text, no watermarks.');
      promptParts.push('Consistency: Maintain consistent perspective, lighting, and style across all panels.');
      promptParts.push('Subject: Interior design and architectural details only, NO people.');
      promptParts.push('</instruction>');
      
      // 2. 布局描述
      promptParts.push(`Layout: ${newLayout.rows} rows, ${newLayout.cols} columns, reading order left-to-right, top-to-bottom.`);
      
      // 2.5 从原始英文提示词中提取 Scene Context 和 Visual Description
      const originalPromptEn = currentPage.prompt || '';
      const sceneContextMatch = originalPromptEn.match(/Scene Context: ([^\n]+)/);
      if (sceneContextMatch && sceneContextMatch[1]) {
        promptParts.push(`Scene Context: ${sceneContextMatch[1]}`);
      }
      const visualDescMatch = originalPromptEn.match(/Visual Description: ([^\n]+)/);
      if (visualDescMatch && visualDescMatch[1]) {
        promptParts.push(`Visual Description: ${visualDescMatch[1]}`);
      }
      
      // 3. 每个格子的内容描述
      currentPageVps.forEach((vp, idx) => {
        const row = Math.floor(idx / newLayout.cols) + 1;
        const col = (idx % newLayout.cols) + 1;
        
        const content = vp.keyPropsEn && vp.keyPropsEn.length > 0 
          ? `showing ${vp.keyPropsEn.join(', ')}` 
          : (vp.nameEn === 'Overview' ? 'wide shot showing the entire room layout' : `${vp.nameEn || vp.name} angle of the room`);
          
        promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}`);
      });
      
      // 4. 空白占位格描述
      for (let i = actualCount; i < paddedCount; i++) {
        const row = Math.floor(i / newLayout.cols) + 1;
        const col = (i % newLayout.cols) + 1;
        promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
      }
      
      // 5. 风格与负面提示
      promptParts.push(`Style: ${styleStr}`);
      promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters.');
      
      const newPrompt = promptParts.join('\n');
      
      // 重新生成中文提示词
      const gridItemsZh = currentPageVps.map((vp, idx) => {
        const content = vp.keyProps && vp.keyProps.length > 0 
          ? `展示${vp.keyProps.join('、')}` 
          : (vp.name === '全景' ? '展示整个房间布局的宽角度全景' : `${vp.name}视角`);
        return `[${idx + 1}] ${vp.name}：${content}`;
      }).join('\n');
      
      // 从原始中文提示词中提取场景描述（建筑风格、色彩基调、时代特征、光影设计）
      // 这样即使 selectedScene 还没更新，也能保留正确的场景描述
      let sceneDescZh = '';
      let visualPromptZh = '';
      const originalPromptZh = currentPage.promptZh || '';
      
      // 场景描述在第一行和"场景氛围"或"X 个格子分别展示"之间
      const sceneDescMatch = originalPromptZh.match(/不同视角。\n([^\n]*(?:建筑风格|色彩基调|时代特征|光影设计)[^\n]*)/);
      if (sceneDescMatch && sceneDescMatch[1]) {
        sceneDescZh = sceneDescMatch[1].trim();
      } else {
        // 回退到从 selectedScene 构建（用于非跳转场景）
        const sceneDescParts: string[] = [];
        if (selectedScene?.architectureStyle) {
          sceneDescParts.push(`建筑风格：${selectedScene.architectureStyle}`);
        }
        if (selectedScene?.colorPalette) {
          sceneDescParts.push(`色彩基调：${selectedScene.colorPalette}`);
        }
        if (selectedScene?.eraDetails) {
          sceneDescParts.push(`时代特征：${selectedScene.eraDetails}`);
        }
        if (selectedScene?.lightingDesign) {
          sceneDescParts.push(`光影设计：${selectedScene.lightingDesign}`);
        }
        sceneDescZh = sceneDescParts.length > 0 ? sceneDescParts.join('，') : '';
      }
      
      // 提取视觉提示词（场景氛围）
      const visualPromptMatch = originalPromptZh.match(/场景氛围：([^\n]+)/);
      if (visualPromptMatch && visualPromptMatch[1]) {
        visualPromptZh = visualPromptMatch[1].trim();
      } else if (selectedScene?.visualPrompt) {
        visualPromptZh = selectedScene.visualPrompt;
      }
      
      const newPromptZh = `一张精确的 ${newLayout.rows}行${newLayout.cols}列 网格图（共 ${totalCells} 个格子），展示同一个「${sceneName}」场景的不同视角。
${sceneDescZh}${visualPromptZh ? `\n场景氛围：${visualPromptZh}` : ''}

${totalCells} 个格子分别展示：
${gridItemsZh}

重要：
- 必须精确生成 ${newLayout.rows} 行 ${newLayout.cols} 列，不能多也不能少。
- 这是一张干净的参考图，图片上不要添加任何文字覆盖。
- 不要添加标签、标题、说明文字、水印或任何类型的文字。

风格：${stylePreset?.name || '动画风格'}，所有格子光照一致，格子之间用细白边框分隔，只有背景，没有人物。`;
      
      setContactSheetPrompt(newPrompt);
      setContactSheetPromptZh(newPromptZh);
    }
    
    console.log('[ContactSheet] 宽高比变化，更新布局:', {
      aspectRatio: contactSheetAspectRatio,
      vpCount,
      newLayout,
      sceneDescExtracted: currentPage ? (currentPage.promptZh?.includes('建筑风格') || currentPage.promptZh?.includes('光影设计')) : false,
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

  const handleGenerate = async () => {
    const targetId = selectedScene?.id;
    if (!targetId) {
      toast.error("请先选择或创建场景");
      return;
    }
    if (!location.trim()) {
      toast.error("请输入地点描述");
      return;
    }

    const featureConfig = aiManager.featureConfig('character_generation');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('character_generation'));
      return;
    }

    // Update scene if changed
    if (location.trim() !== selectedScene.location || 
        time !== selectedScene.time ||
        atmosphere !== selectedScene.atmosphere ||
        visualPrompt.trim() !== (selectedScene.visualPrompt || '') ||
        notes.trim() !== (selectedScene.notes || '')) {
      updateScene(targetId, { 
        location: location.trim(),
        time,
        atmosphere,
        visualPrompt: visualPrompt.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: notes.trim() || undefined,
      });
    }

    setGenerationStatus('generating');
    setGeneratingScene(targetId);

    try {
      // 获取该场景下所有分镜的动作描写，提取关键道具
      const sceneShots = allShots.filter(shot => 
        shot.sceneRefId === selectedScene?.id ||
        shot.sceneId === selectedScene?.id
      );
      const actionDescriptions = sceneShots
        .map(shot => shot.actionSummary)
        .filter(Boolean)
        .slice(0, 10); // 最多取 10 个分镜
      
      console.log('[SceneGeneration] 找到', sceneShots.length, '个分镜用于场景:', selectedScene?.name);
      console.log('[SceneGeneration] 动作描写:', actionDescriptions);
      
      const prompt = buildScenePrompt({ ...selectedScene, location, time, atmosphere, styleId }, actionDescriptions);
      const stylePreset = styleId ? getStyleById(styleId) : null;
      const isRealistic = stylePreset?.category === 'real';
      const negativePrompt = isRealistic
        ? 'blurry, low quality, watermark, text, people, characters, anime, cartoon'
        : 'blurry, low quality, watermark, text, people, characters';

      const result = await aiManager.image({
        prompt,
        negativePrompt,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        styleId,
      });

      setPreviewUrl(result.imageUrl);
      setPreviewSceneId(targetId);
      setGenerationStatus('completed');
      toast.success("场景概念图生成完成，请预览确认");
    } catch (error) {
      const err = error as Error;
      setGenerationStatus('error', err.message);
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setGeneratingScene(null);
    }
  };

  const handleSavePreview = async () => {
    if (!previewUrl || !previewSceneId) return;

    toast.loading("正在保存图片到本地...", { id: 'saving-scene-preview' });

    try {
      const sceneName = (name || selectedScene?.name || 'scene').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      const localPath = await saveImageToLocal(
        previewUrl,
        'scenes',
        `${sceneName}_${Date.now()}.png`
      );

      updateScene(previewSceneId, {
        referenceImage: localPath,
        visualPrompt: buildScenePrompt({ 
          ...selectedScene!, 
          location, 
          time, 
          atmosphere, 
          styleId 
        }),
      });

      // 同步归档到素材库 AI图片 文件夹
      const aiFolderId = getOrCreateCategoryFolder('ai-image');
      addMediaFromUrl({
        url: localPath,
        name: `场景-${name || selectedScene?.name || '未命名'}`,
        type: 'image',
        source: 'ai-image',
        folderId: aiFolderId,
        projectId: resourceProjectId || undefined,
      });

      setPreviewUrl(null);
      setPreviewSceneId(null);
      toast.success("场景概念图已保存到本地！", { id: 'saving-scene-preview' });
    } catch (error) {
      console.error('Failed to save scene preview:', error);
      toast.error("保存失败", { id: 'saving-scene-preview' });
    }
  };

  const handleDiscardPreview = () => {
    setPreviewUrl(null);
    setPreviewSceneId(null);
    setGenerationStatus('idle');
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

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          {/* Scene name */}
          <div className="space-y-2">
            <Label className="text-xs">场景名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：城市街道、森林小屋"
              disabled={isGenerating}
            />
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label className="text-xs">地点描述</Label>
            <Textarea
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="详细描述场景的环境，例如：繁华的东京涩谷十字路口，霓虹灯闪烁..."
              className="min-h-[100px] text-sm resize-none"
              disabled={isGenerating}
            />
          </div>

          {/* Time and Atmosphere */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">时间</Label>
              <Select value={time} onValueChange={setTime} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_PRESETS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">氛围</Label>
              <Select value={atmosphere} onValueChange={setAtmosphere} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {ATMOSPHERE_PRESETS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Style */}
          <div className="space-y-2">
            <Label className="text-xs">视觉风格</Label>
            <StylePicker
              value={styleId}
              onChange={(id) => setStyleId(id)}
              disabled={isGenerating}
            />
          </div>

          {/* Reference images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">参考图片</Label>
              <span className="text-xs text-muted-foreground">{referenceImages.length}/3</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {referenceImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img}
                    alt={`参考图 ${i + 1}`}
                    className="w-14 h-14 object-cover rounded-md border"
                  />
                  <button
                    type="button"
                    onClick={() => removeRefImage(i)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {referenceImages.length < 3 && (
                <>
                  <input
                    id="scene-gen-ref-image"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleRefImageChange}
                  />
                  <div
                    className="w-14 h-14 border-2 border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors gap-1 cursor-pointer"
                    onClick={() => document.getElementById('scene-gen-ref-image')?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span className="text-[10px]">上传</span>
                  </div>
                </>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              AI 将参考这些图片生成场景概念图
            </p>
          </div>
        </div>
      </ScrollArea>

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Note: generateSceneImage is now imported from @/lib/ai/image-generator
