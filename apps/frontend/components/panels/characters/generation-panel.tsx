// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Generation Panel - Left column
 * Character generation controls: style, views, description, reference images
 */

import { useState } from "react";
import { useCharacterLibraryStore, type Character } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import type { CharacterIdentityAnchors, CharacterNegativePrompt, PromptLanguage } from "@/types/script";
import { useActiveScriptProject } from "@/stores/script-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { useMediaStore } from "@/stores/media-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { saveImageToLocal } from "@/lib/image-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  ImagePlus,
  X,
  Shuffle,
  FileImage,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StylePicker } from "@/components/ui/style-picker";
import { getStyleById, DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";
import { buildCharacterDataText } from "./character-data-export";
import { CharacterCalibrationSection } from "./character-calibration-section";
import { usePendingCharacterIntake } from "./use-pending-character-intake";
import {
  SHEET_ELEMENTS,
  AGE_PRESETS,
  GENDER_PRESETS,
  buildCharacterSheetPrompt,
  type SheetElementId,
} from "./character-generation-prompt";

interface GenerationPanelProps {
  selectedCharacter: Character | null;
  onCharacterCreated?: (id: string) => void;
}

export function GenerationPanel({ selectedCharacter, onCharacterCreated }: GenerationPanelProps) {
  const { 
    addCharacter, 
    updateCharacter,
    addCharacterView,
    selectCharacter,
    generationStatus,
    generatingCharacterId,
    setGenerationStatus,
    setGeneratingCharacter,
    currentFolderId,
  } = useCharacterLibraryStore();
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  
  const { pendingCharacterData, setPendingCharacterData } = useMediaPanelStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gender, setGender] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [personality, setPersonality] = useState("");
  // Extended character fields (from script panel)
  const [role, setRole] = useState("");
  const [traits, setTraits] = useState("");
  const [skills, setSkills] = useState("");
  const [keyActions, setKeyActions] = useState("");
  const [appearance, setAppearance] = useState("");
  const [relationships, setRelationships] = useState(""); // 人物关系
  const [tags, setTags] = useState<string[]>([]);  // 角色标签
  const [notes, setNotes] = useState("");           // 角色备注
  // === 专业角色设计字段（世界级大师生成）===
  const [visualPromptEn, setVisualPromptEn] = useState(""); // 英文视觉提示词
  const [visualPromptZh, setVisualPromptZh] = useState(""); // 中文视觉提示词
  // === 6层身份锚点 ===
  const [identityAnchors, setIdentityAnchors] = useState<CharacterIdentityAnchors | undefined>();
  const [charNegativePrompt, setCharNegativePrompt] = useState<CharacterNegativePrompt | undefined>();
  // === 提示词语言偏好 ===
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>('zh');
  // === 年代信息（从剧本元数据传递）===
  const [storyYear, setStoryYear] = useState<number | undefined>();
  const [era, setEra] = useState<string | undefined>();
  // === 集作用域（从 pending 数据透传）===
  const [sourceEpisodeId, setSourceEpisodeId] = useState<string | undefined>();
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [styleId, setStyleId] = useState<string>(DEFAULT_STYLE_ID);
  const [selectedElements, setSelectedElements] = useState<SheetElementId[]>(
    SHEET_ELEMENTS.filter(e => e.default).map(e => e.id)
  );
  
  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewCharacterId, setPreviewCharacterId] = useState<string | null>(null);
  
  // AI 校准信息折叠区状态：有数据时默认展开
  const [calibrationExpanded, setCalibrationExpanded] = useState(true);
  const [isManuallyModified, setIsManuallyModified] = useState(false);

  const isGenerating = generationStatus === 'generating';
  
  // 检查是否有 AI 校准数据
  const hasCalibrationData = !!(identityAnchors || charNegativePrompt || visualPromptEn || visualPromptZh);

  // 注意：左边栏始终用于新建角色，不响应中间角色库的选择
  // 右边栏用于查看/编辑已有角色的详情

  usePendingCharacterIntake({
    pendingCharacterData,
    setPendingCharacterData,
    setName,
    setGender,
    setAge,
    setPersonality,
    setRole,
    setTraits,
    setSkills,
    setKeyActions,
    setAppearance,
    setRelationships,
    setDescription,
    setTags,
    setNotes,
    setPromptLanguage,
    setVisualPromptEn,
    setVisualPromptZh,
    setIdentityAnchors,
    setCharNegativePrompt,
    setStoryYear,
    setEra,
    setSourceEpisodeId,
    setStyleId,
  });

  const toggleElement = (elementId: SheetElementId) => {
    setSelectedElements(prev => 
      prev.includes(elementId) 
        ? prev.filter(e => e !== elementId)
        : [...prev, elementId]
    );
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const removeImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setGender("");
    setAge("");
    setPersonality("");
    setRole("");
    setTraits("");
    setSkills("");
    setKeyActions("");
    setAppearance("");
    setRelationships("");
    setTags([]);
    setNotes("");
    // === 重置专业视觉提示词 ===
    setVisualPromptEn("");
    setVisualPromptZh("");
    // === 重置6层身份锚点 ===
    setIdentityAnchors(undefined);
    setCharNegativePrompt(undefined);
    // === 重置年代信息 ===
    setStoryYear(undefined);
    setEra(undefined);
    // === 重置集作用域 ===
    setSourceEpisodeId(undefined);
    setReferenceImages([]);
    setStyleId(DEFAULT_STYLE_ID);
    setSelectedElements(SHEET_ELEMENTS.filter(e => e.default).map(e => e.id));
    setPreviewUrl(null);
    setPreviewCharacterId(null);
    // === 重置 AI 校准状态 ===
    setCalibrationExpanded(false);
    setIsManuallyModified(false);
  };

  // 创建新角色并生成图片（始终新建，不会覆盖已有角色）
  const handleCreateAndGenerate = async () => {
    if (!name.trim()) {
      toast.error("请输入角色名称");
      return;
    }
    if (!description.trim()) {
      toast.error("请输入角色描述");
      return;
    }
    if (selectedElements.length === 0) {
      toast.error("请至少选择一个生成内容");
      return;
    }

    // 始终创建新角色
    const targetId = addCharacter({
      name: name.trim(),
      description: description.trim(),
      visualTraits: "",
      gender: gender || undefined,
      age: age || undefined,
      personality: personality.trim() || undefined,
      role: role.trim() || undefined,
      traits: traits.trim() || undefined,
      skills: skills.trim() || undefined,
      keyActions: keyActions.trim() || undefined,
      appearance: appearance.trim() || undefined,
      relationships: relationships.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      notes: notes.trim() || undefined,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      styleId: styleId === "random" ? undefined : styleId,
      views: [],
      folderId: currentFolderId,
      projectId: activeProjectId || undefined,
      // === 6层身份锚点（角色一致性）===
      identityAnchors: identityAnchors,
      negativePrompt: charNegativePrompt,
      // === 集作用域 ===
      linkedEpisodeId: sourceEpisodeId,
    });
    selectCharacter(targetId);
    onCharacterCreated?.(targetId);

    // 开始生成图片
    setGenerationStatus('generating');
    setGeneratingCharacter(targetId);

    try {
      // 构建提示词：根据语言偏好选择提示词 + 6层身份锚点 + 参考图优先级逻辑 + 年代信息
      // 获取实时的语言偏好（优先使用 pending 传来的，其次从 scriptProject 读取）
      const effectiveLang = promptLanguage || scriptProject?.promptLanguage || 'zh';
      const prompt = buildCharacterSheetPrompt(
        description, 
        name, 
        selectedElements, 
        styleId, 
        visualPromptEn,
        visualPromptZh,
        effectiveLang,
        identityAnchors,
        referenceImages.length > 0,  // 有参考图时简化描述
        storyYear,
        era
      );
      const stylePreset = styleId && styleId !== 'random' 
        ? getStyleById(styleId) 
        : null;
      const isRealistic = stylePreset?.category === 'real';
      
      // 构建负面提示词：合并角色特定的负面提示词
      let negativePrompt = isRealistic
        ? 'blurry, low quality, watermark, text, cropped, anime, cartoon, illustration'
        : 'blurry, low quality, watermark, text, cropped';
      
      // 如果有角色特定的负面提示词，追加到后面
      if (charNegativePrompt) {
        const avoidList = charNegativePrompt.avoid || [];
        const styleExclusions = charNegativePrompt.styleExclusions || [];
        const charNegatives = [...avoidList, ...styleExclusions].join(', ');
        if (charNegatives) {
          negativePrompt = `${negativePrompt}, ${charNegatives}`;
        }
      }

      const result = await aiManager.image({
        prompt,
        negativePrompt,
        referenceImages,
        styleId,
      });
      
      setPreviewUrl(result.imageUrl);
      setPreviewCharacterId(targetId);
      setGenerationStatus('completed');
      toast.success("图片生成完成，请预览确认");
    } catch (error) {
      const err = error as Error;
      setGenerationStatus('error', err.message);
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setGeneratingCharacter(null);
    }
  };

  const handleSavePreview = async () => {
    if (!previewUrl || !previewCharacterId) return;

    toast.loading("正在保存图片到本地...", { id: 'saving-preview' });
    
    try {
      // Save image to local storage
      const localPath = await saveImageToLocal(
        previewUrl, 
        'characters', 
        `${name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.png`
      );

      // Save view with local path
      addCharacterView(previewCharacterId, {
        viewType: 'front',
        imageUrl: localPath,
      });

      const visualTraits = `${name} character, ${description.substring(0, 200)}`;
      updateCharacter(previewCharacterId, { visualTraits });

      // 同步归档到素材库 AI图片 文件夹
      const aiFolderId = getOrCreateCategoryFolder('ai-image');
      addMediaFromUrl({
        url: localPath,
        name: `角色-${name || '未命名'}`,
        type: 'image',
        source: 'ai-image',
        folderId: aiFolderId,
        projectId: activeProjectId || undefined,
      });

      setPreviewUrl(null);
      setPreviewCharacterId(null);
      toast.success("角色设定图已保存到本地！", { id: 'saving-preview' });
    } catch (error) {
      console.error('Failed to save preview:', error);
      toast.error("保存失败", { id: 'saving-preview' });
    }
  };

  const handleDiscardPreview = () => {
    setPreviewUrl(null);
    setPreviewCharacterId(null);
  };

  // If showing preview
  if (previewUrl) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="p-3 pb-2 border-b shrink-0">
          <h3 className="font-medium text-sm">预览角色设定图</h3>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-4 pb-32">
            <div className="relative rounded-lg overflow-hidden border-2 border-amber-500/50 bg-muted">
              <img 
                src={previewUrl} 
                alt="角色设定预览"
                className="w-full h-auto"
              />
              <div className="absolute top-2 left-2 bg-amber-500 text-white text-xs px-2 py-1 rounded">
                预览
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className="p-3 border-t space-y-2 shrink-0">
          <Button onClick={handleSavePreview} className="w-full">
            保存设定图
          </Button>
          <Button onClick={handleCreateAndGenerate} variant="outline" className="w-full" disabled={isGenerating}>
            重新生成
          </Button>
          <Button onClick={handleDiscardPreview} variant="ghost" className="w-full text-muted-foreground" size="sm">
            放弃并返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-3 pb-2 border-b shrink-0">
        <h3 className="font-medium text-sm">生成控制台</h3>
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-4">
          {/* Character name */}
          <div className="space-y-2">
            <Label className="text-xs">角色名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：小明、机器猫"
              disabled={isGenerating}
            />
          </div>

          {/* Gender and Age */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">性别</Label>
              <Select value={gender} onValueChange={setGender} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_PRESETS.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">年龄段</Label>
              <Select value={age} onValueChange={setAge} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {AGE_PRESETS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Personality */}
          <div className="space-y-2">
            <Label className="text-xs">性格特征</Label>
            <Input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="开朗、勇敢..."
              disabled={isGenerating}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs">角色描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述角色外观..."
              className="min-h-[80px] text-sm resize-none"
              disabled={isGenerating}
            />
          </div>

          <CharacterCalibrationSection
            hasCalibrationData={hasCalibrationData}
            identityAnchors={identityAnchors}
            setIdentityAnchors={setIdentityAnchors}
            charNegativePrompt={charNegativePrompt}
            setCharNegativePrompt={setCharNegativePrompt}
            visualPromptEn={visualPromptEn}
            setVisualPromptEn={setVisualPromptEn}
            visualPromptZh={visualPromptZh}
            setVisualPromptZh={setVisualPromptZh}
            promptLanguage={promptLanguage}
            scriptProject={scriptProject}
            calibrationExpanded={calibrationExpanded}
            setCalibrationExpanded={setCalibrationExpanded}
            isManuallyModified={isManuallyModified}
            setIsManuallyModified={setIsManuallyModified}
            isGenerating={isGenerating}
          />

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
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {referenceImages.length < 3 && (
                <>
                  <input
                    id="gen-panel-ref-image"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageChange}
                  />
                  <div
                    className="w-14 h-14 border-2 border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors gap-1 cursor-pointer"
                    onClick={() => document.getElementById('gen-panel-ref-image')?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span className="text-[10px]">上传</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sheet elements */}
          <div className="space-y-2">
            <Label className="text-xs">生成内容</Label>
            <div className="space-y-1.5">
              {SHEET_ELEMENTS.map((element) => (
                <div
                  key={element.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded border text-sm cursor-pointer transition-all",
                    "hover:border-foreground/20",
                    selectedElements.includes(element.id) && "border-primary bg-primary/5",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => !isGenerating && toggleElement(element.id)}
                >
                  <Checkbox
                    checked={selectedElements.includes(element.id)}
                    disabled={isGenerating}
                  />
                  <span>{element.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action button - inside scroll area */}
          <div className="pt-2 pb-4 space-y-2">
            <Button 
              onClick={handleCreateAndGenerate} 
              className="w-full"
              disabled={isGenerating || !name.trim() || !description.trim() || selectedElements.length === 0}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <FileImage className="h-4 w-4 mr-2" />
                  生成设定图
                </>
              )}
            </Button>
            
            {/* 复制角色数据按钮 */}
            <Button 
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(buildCharacterDataText({
                  name,
                  gender,
                  age,
                  personality,
                  description,
                  identityAnchors,
                  charNegativePrompt,
                  visualPromptEn,
                  visualPromptZh,
                  isManuallyModified,
                  storyYear,
                  era,
                  styleId,
                  referenceImageCount: referenceImages.length,
                  selectedElements,
                }));
                toast.success('角色数据已复制到剪贴板');
              }}
              className="w-full"
              disabled={isGenerating}
            >
              <Copy className="h-4 w-4 mr-2" />
              复制角色数据
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Note: generateCharacterImage and imageUrlToBase64 are now imported from @/lib/ai/image-generator
