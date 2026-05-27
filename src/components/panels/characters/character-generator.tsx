// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Character Generator Component
 * AI-powered character design sheet generation
 * Generates a comprehensive character sheet including:
 * - Character Design
 * - Proportion reference
 * - Three views (front, side, back)
 * - Expression sheet
 * - Pose sheet
 */

import { useState } from "react";
import { type Character, type CharacterView, useCharacterLibraryStore } from "@/stores/character-library-store";
import { generateCharacterImage as generateCharacterImageAPI } from "@/lib/ai/image-generator";
import { saveImageToLocal } from "@/lib/image-storage";
import { useMediaStore } from "@/stores/media-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Wand2,
  Loader2,
  Check,
  AlertCircle,
  RotateCcw,
  User,
  FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getStyleById, getStylePrompt } from "@/lib/constants/visual-styles";

// Character sheet elements that can be included
const SHEET_ELEMENTS = [
  { id: 'three-view', label: '三视图', prompt: 'front view, side view, back view, turnaround', default: true },
  { id: 'expressions', label: '表情设定', prompt: 'expression sheet, multiple facial expressions, happy, sad, angry, surprised', default: true },
  { id: 'proportions', label: '比例设定', prompt: 'height chart, body proportions, head-to-body ratio reference', default: false },
  { id: 'poses', label: '动作设定', prompt: 'pose sheet, various action poses, standing, sitting, running', default: false },
] as const;

type SheetElementId = typeof SHEET_ELEMENTS[number]['id'];

interface CharacterGeneratorProps {
  character: Character;
}

export function CharacterGenerator({ character }: CharacterGeneratorProps) {
  const { 
    updateCharacter, 
    addCharacterView, 
    setGenerationStatus,
    generationStatus,
    generatingCharacterId,
    setGeneratingCharacter,
  } = useCharacterLibraryStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  
  const [description, setDescription] = useState(character.description);
  const [selectedElements, setSelectedElements] = useState<SheetElementId[]>(
    SHEET_ELEMENTS.filter(e => e.default).map(e => e.id)
  );
  // Preview state - generated image waiting for confirmation
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string>('');

  const isGenerating = generationStatus === 'generating' && generatingCharacterId === character.id;

  const toggleElement = (elementId: SheetElementId) => {
    setSelectedElements(prev => 
      prev.includes(elementId) 
        ? prev.filter(e => e !== elementId)
        : [...prev, elementId]
    );
  };

  const handleSaveDescription = () => {
    if (description.trim() !== character.description) {
      updateCharacter(character.id, { description: description.trim() });
      toast.success("描述已保存");
    }
  };

  const handleGenerateSheet = async () => {
    if (!description.trim()) {
      toast.error("请输入角色描述");
      return;
    }

    if (selectedElements.length === 0) {
      toast.error("请至少选择一个内容");
      return;
    }

    // Save description first
    if (description.trim() !== character.description) {
      updateCharacter(character.id, { description: description.trim() });
    }

    setGenerationStatus('generating');
    setGeneratingCharacter(character.id);

    try {
      // Build comprehensive character sheet prompt with selected style
      const sheetPrompt = buildCharacterSheetPrompt(description, character.name, selectedElements, character.styleId);
      setPreviewPrompt(sheetPrompt);

      // Get reference images if available
      const referenceImages = character.referenceImages || [];

      // Get style preset for negative prompt
      const stylePreset = character.styleId ? getStyleById(character.styleId) : null;
      const isRealistic = stylePreset?.category === 'real';
      const negativePrompt = isRealistic
        ? 'blurry, low quality, watermark, text, cropped, anime, cartoon, illustration'
        : 'blurry, low quality, watermark, text, cropped';

      // Generate character sheet using unified image-generator module
      const result = await generateCharacterImageAPI({
        prompt: sheetPrompt,
        negativePrompt,
        aspectRatio: '1:1',
        referenceImages,
        styleId: character.styleId,
      });

      // Show preview instead of saving directly
      setPreviewUrl(result.imageUrl);
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

  // Save the previewed image to character
  const handleSavePreview = async () => {
    if (!previewUrl) return;

    // Show saving status
    toast.loading("正在保存图片到本地...", { id: 'saving-preview' });

    try {
      // Save image to local file storage
      const safeName = character.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      const localPath = await saveImageToLocal(
        previewUrl,
        'characters',
        `${safeName}_${Date.now()}.png`
      );

      // Save as front view with local-image:// path
      addCharacterView(character.id, {
        viewType: 'front',
        imageUrl: localPath,
      });

      // Generate visual traits from description (English)
      const visualTraits = generateVisualTraits(description, character.name);
      updateCharacter(character.id, { visualTraits });

      // 同步归档到素材库 AI图片 文件夹
      const aiFolderId = getOrCreateCategoryFolder('ai-image');
      addMediaFromUrl({
        url: localPath,
        name: `角色-${character.name}`,
        type: 'image',
        source: 'ai-image',
        folderId: aiFolderId,
        projectId: character.projectId || undefined,
      });

      setPreviewUrl(null);
      setPreviewPrompt('');
      toast.success("角色设定图已保存到本地！", { id: 'saving-preview' });
    } catch (error) {
      console.error('Failed to save preview:', error);
      toast.error("保存失败", { id: 'saving-preview' });
    }
  };

  // Discard preview and regenerate
  const handleDiscardPreview = () => {
    setPreviewUrl(null);
    setPreviewPrompt('');
  };

  // Regenerate with same settings
  const handleRegenerate = () => {
    setPreviewUrl(null);
    handleGenerateSheet();
  };

  // Check if character sheet already exists
  const existingSheet = character.views.find(v => v.viewType === 'front');

  // If we have a preview waiting for confirmation
  if (previewUrl) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">预览角色设定图</h3>
          <span className="text-xs text-amber-500 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            待确认
          </span>
        </div>

        {/* Preview image */}
        <div className="relative rounded-lg overflow-hidden border-2 border-amber-500/50 bg-muted">
          <img 
            src={previewUrl} 
            alt={`${character.name} 角色设定预览`}
            className="w-full h-auto"
          />
          <div className="absolute top-2 left-2 bg-amber-500 text-white text-xs px-2 py-1 rounded">
            预览
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button 
            onClick={handleSavePreview}
            className="flex-1"
            size="lg"
          >
            <Check className="h-4 w-4 mr-2" />
            保存设定图
          </Button>
          <Button 
            onClick={handleRegenerate}
            variant="outline"
            size="lg"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            重新生成
          </Button>
        </div>

        {/* Discard option */}
        <Button 
          onClick={handleDiscardPreview}
          variant="ghost"
          className="w-full text-muted-foreground"
          size="sm"
        >
          放弃并返回
        </Button>

        {/* Prompt info */}
        {previewPrompt && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">查看生成提示词</summary>
            <p className="mt-2 p-2 bg-muted rounded text-xs break-all">{previewPrompt}</p>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">生成角色设定图</h3>
        {isGenerating && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            生成中...
          </span>
        )}
      </div>

      {/* Existing sheet preview */}
      {existingSheet && (
        <div className="relative rounded-lg overflow-hidden border bg-muted">
          <img 
            src={existingSheet.imageUrl} 
            alt={`${character.name} 角色设定`}
            className="w-full h-auto"
          />
          <div className="absolute top-2 right-2">
            <Check className="h-5 w-5 text-green-500 bg-white rounded-full p-0.5" />
          </div>
          <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded">
            已保存
          </div>
        </div>
      )}

      {/* Description editor */}
      <div className="space-y-2">
        <Label className="text-xs">角色描述（用于AI生成）</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleSaveDescription}
          placeholder="详细描述角色外观，例如：一只橙色的小猫，有大大的蓝色眼睛，毛茸茸的尾巴，戴着红色铃铛项圈..."
          className="min-h-[80px] text-sm resize-none"
          disabled={isGenerating}
        />
      </div>

      {/* Sheet content selection */}
      <div className="space-y-2">
        <Label className="text-xs">设定图内容</Label>
        <div className="space-y-2">
          {SHEET_ELEMENTS.map((element) => (
            <div
              key={element.id}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg border transition-all cursor-pointer",
                "hover:border-foreground/20",
                selectedElements.includes(element.id) && "border-primary bg-primary/5",
                isGenerating && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => !isGenerating && toggleElement(element.id)}
            >
              <Checkbox
                checked={selectedElements.includes(element.id)}
                disabled={isGenerating}
                onCheckedChange={() => toggleElement(element.id)}
              />
              <div className="flex-1">
                <span className="text-sm font-medium">{element.label}</span>
                <p className="text-xs text-muted-foreground">
                  {element.id === 'three-view' && '正面、侧面、背面三视图结构'}
                  {element.id === 'expressions' && '多种面部表情展示'}
                  {element.id === 'proportions' && '身体比例、头身比参考'}
                  {element.id === 'poses' && '各种常见动作姿势'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <Button 
        onClick={handleGenerateSheet}
        disabled={isGenerating || selectedElements.length === 0 || !description.trim()}
        className="w-full"
        size="lg"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            正在生成角色设定图...
          </>
        ) : (
          <>
            <FileImage className="h-4 w-4 mr-2" />
            {existingSheet ? '重新生成设定图' : '生成角色设定图'}
          </>
        )}
      </Button>

      {/* Reference images preview */}
      {character.referenceImages && character.referenceImages.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">参考图片</Label>
          <div className="flex gap-2 flex-wrap">
            {character.referenceImages.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`参考图 ${i + 1}`}
                className="w-12 h-12 object-cover rounded border"
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            AI将参考这些图片生成角色设定图
          </p>
        </div>
      )}

      {/* Tips */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>💡 生成后可预览确认，满意再保存</p>
        <p>💡 保存的角色可拖拽到 AI 导演面板使用</p>
      </div>
    </div>
  );
}

// Helper: Build comprehensive character sheet prompt
function buildCharacterSheetPrompt(
  description: string, 
  name: string, 
  selectedElements: SheetElementId[],
  styleId?: string
): string {
  // Get style preset based on styleId
  const stylePreset = styleId ? getStyleById(styleId) : null;
  const styleTokens = stylePreset?.prompt || 'anime style, professional quality';
  const isRealistic = stylePreset?.category === 'real';
  
  // Base character design prompt - different wording for realistic vs animation
  const basePrompt = isRealistic
    ? `professional character reference for "${name}", ${description}, real person`
    : `professional character design sheet for "${name}", ${description}`;
  
  // Build content sections based on selection
  const contentParts: string[] = [];
  
  if (selectedElements.includes('three-view')) {
    contentParts.push('three-view turnaround (front view, side view, back view)');
  }
  
  if (selectedElements.includes('expressions')) {
    contentParts.push('expression sheet with multiple facial expressions (happy, sad, angry, surprised, neutral)');
  }
  
  if (selectedElements.includes('proportions')) {
    contentParts.push('body proportion reference, height chart, head-to-body ratio guide');
  }
  
  if (selectedElements.includes('poses')) {
    contentParts.push('pose sheet with various action poses (standing, sitting, running, jumping)');
  }
  
  const contentPrompt = contentParts.join(', ');
  
  // Full prompt with selected style - different endings for realistic vs animation
  if (isRealistic) {
    // Realistic style: emphasize photography and real human
    return `${basePrompt}, ${contentPrompt}, character reference sheet layout, white background, clean presentation, ${styleTokens}, photorealistic, real human, NOT anime, NOT cartoon, NOT illustration, NOT drawing`;
  } else {
    // Animation style: keep illustration terms
    return `${basePrompt}, ${contentPrompt}, character reference sheet layout, white background, clean presentation, ${styleTokens}, detailed illustration, concept art, character model sheet`;
  }
}

// Helper: Generate English visual traits from description
function generateVisualTraits(description: string, name: string): string {
  // Simple translation/conversion - in production this could use AI
  return `${name} character, ${description.substring(0, 200)}`;
}

// Note: generateCharacterImage is imported from @/lib/ai/image-generator
// Note: saveImageToLocal is imported from @/lib/image-storage
// Note: useMediaStore is imported from @/stores/media-store for archiving to media library
