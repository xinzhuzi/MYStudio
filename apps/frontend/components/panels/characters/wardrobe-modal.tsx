// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Wardrobe Modal Component
 * Manages character variations (outfits/states) with AI generation support
 * Leverages Nano Banana (Gemini) multi-image fusion for outfit swapping:
 *   - Character base portrait for face/body consistency
 *   - User-uploaded clothing reference images for target outfit
 *   - Text prompt for fine-grained control
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type Character,
  type CharacterVariation,
  useCharacterLibraryStore,
} from "@/stores/library/character-library-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project/project-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateVariationImage } from "@/lib/ai/wardrobe-image-generation";
import { saveImageToLocal } from "@/lib/media/image-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Wand2,
  Loader2,
  Shirt,
  ImageIcon,
  Check,
  X,
  RotateCcw,
  Upload,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LocalImage } from "@/components/ui/local-image";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";

// Preset variation types for quick creation
const VARIATION_PRESETS = [
  { name: "日常装", prompt: "casual everyday clothing, relaxed outfit" },
  { name: "正装", prompt: "formal attire, business suit, elegant clothing" },
  { name: "战斗装", prompt: "tactical gear, combat outfit, armor" },
  { name: "睡衣", prompt: "sleepwear, pajamas, nightwear" },
  { name: "运动装", prompt: "sportswear, athletic clothing, workout outfit" },
  { name: "受伤状态", prompt: "injured appearance, bandages, wounds" },
  { name: "雨天装扮", prompt: "raincoat, umbrella, wet weather gear" },
  { name: "冬装", prompt: "winter clothing, warm coat, scarf" },
] as const;

// Max clothing reference images per variation
const MAX_CLOTHING_REFS = 3;

export interface WardrobeModalProps {
  character: Character | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerateVariation?: (
    characterId: string,
    variationId: string,
    visualPrompt: string,
  ) => Promise<string>;
}

export function WardrobeModal({
  character,
  open,
  onOpenChange,
  onGenerateVariation: generateVariationExternally,
}: WardrobeModalProps) {
  const { addVariation, updateVariation, deleteVariation } = useCharacterLibraryStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  const { activeProjectId } = useProjectStore();
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVariationName, setNewVariationName] = useState("");
  const [newVariationPrompt, setNewVariationPrompt] = useState("");
  const [newClothingRefs, setNewClothingRefs] = useState<string[]>([]);
  const [generatingVariationId, setGeneratingVariationId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    variationId: string;
    imageUrl: string;
  } | null>(null);
  const clothingInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);

  // Auto-focus name input when custom form opens (fix Radix Dialog focus trap issue)
  useEffect(() => {
    if (showAddForm) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [showAddForm]);

  const variations = character?.variations || [];

  // Get character base portrait
  const characterBaseImage = character?.thumbnailUrl || character?.views[0]?.imageUrl;

  // ---- Image Upload ----
  const handleClothingImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = MAX_CLOTHING_REFS - newClothingRefs.length;
    if (remaining <= 0) {
      toast.error(`最多上传 ${MAX_CLOTHING_REFS} 张参考图`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);

    filesToProcess.forEach((file) => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} 超过 5MB 限制`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) {
          setNewClothingRefs((prev) => {
            if (prev.length >= MAX_CLOTHING_REFS) return prev;
            return [...prev, base64];
          });
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected
    e.target.value = "";
  }, [newClothingRefs.length]);

  const handleRemoveClothingRef = useCallback((index: number) => {
    setNewClothingRefs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (!character) return null;

  // ---- Add Variation ----
  const handleAddVariation = () => {
    if (!newVariationName.trim()) {
      toast.error("请输入变体名称");
      return;
    }

    addVariation(character.id, {
      name: newVariationName.trim(),
      visualPrompt: newVariationPrompt.trim() || `${newVariationName.trim()} outfit`,
      clothingReferenceImages: newClothingRefs.length > 0 ? newClothingRefs : undefined,
    });

    resetAddForm();
    toast.success("变体已添加");
  };

  const handleQuickAdd = (preset: typeof VARIATION_PRESETS[number]) => {
    addVariation(character.id, {
      name: preset.name,
      visualPrompt: preset.prompt,
    });
    toast.success(`已添加 "${preset.name}" 变体`);
  };

  const resetAddForm = () => {
    setShowAddForm(false);
    setNewVariationName("");
    setNewVariationPrompt("");
    setNewClothingRefs([]);
  };

  // ---- Delete Variation ----
  const handleDeleteVariation = (variationId: string, name: string) => {
    if (confirm(`确定要删除变体 "${name}" 吗？`)) {
      deleteVariation(character.id, variationId);
      toast.success("变体已删除");
    }
  };

  // ---- Generate Variation Image ----
  const handleGenerateVariation = async (variation: CharacterVariation) => {
    if (generateVariationExternally) {
      setGeneratingVariationId(variation.id);
      try {
        const imageUrl = await generateVariationExternally(
          character.id,
          variation.id,
          variation.visualPrompt,
        );
        updateVariation(character.id, variation.id, {
          referenceImage: imageUrl,
          generatedAt: Date.now(),
        });
        toast.success(`变体图片生成完成: ${variation.name}`);
      } catch (error) {
        toast.error(`生成失败: ${(error as Error).message}`);
      } finally {
        setGeneratingVariationId(null);
      }
      return;
    }

    const featureConfig = aiManager.featureConfig('character_generation');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('character_generation'));
      return;
    }

    // Need base character image for face consistency
    if (!characterBaseImage) {
      toast.error("请先生成角色基础定妆照，以保持一致性");
      return;
    }

    setGeneratingVariationId(variation.id);

    try {
      const imageUrl = await generateVariationImage({
        character,
        variation,
        featureConfig,
      });

      // Show preview
      setPreviewData({
        variationId: variation.id,
        imageUrl,
      });

      toast.success("变体图片生成完成，请预览确认");
    } catch (error) {
      const err = error as Error;
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setGeneratingVariationId(null);
    }
  };

  // ---- Preview Actions ----
  const handleSavePreview = async () => {
    if (!previewData) return;

    const variation = variations.find(v => v.id === previewData.variationId);
    const varName = variation?.name || 'variation';
    const ts = Date.now();
    const safeName = `${character.name}_${varName}_${ts}`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '_');

    toast.loading("正在保存图片到本地...", { id: 'saving-wardrobe' });

    try {
      // 1. Persist image locally (same as generation-panel)
      const localPath = await saveImageToLocal(
        previewData.imageUrl,
        'wardrobe',
        `${safeName}.png`
      );

      // 2. Update variation in store with local path
      updateVariation(character.id, previewData.variationId, {
        referenceImage: localPath,
        generatedAt: ts,
      });

      // 3. Archive to media library (AI图片 folder)
      const aiFolderId = getOrCreateCategoryFolder('ai-image');
      addMediaFromUrl({
        url: localPath,
        name: `衣橱-${character.name}-${varName}`,
        type: 'image',
        source: 'ai-image',
        folderId: aiFolderId,
        projectId: activeProjectId || undefined,
      });

      setPreviewData(null);
      toast.success("变体图片已保存到本地！", { id: 'saving-wardrobe' });
    } catch (error) {
      console.error('[Wardrobe] Failed to save preview:', error);
      toast.error("保存失败", { id: 'saving-wardrobe' });
    }
  };

  const handleDiscardPreview = () => {
    setPreviewData(null);
  };

  // ======== Preview Dialog ========
  if (previewData) {
    const variation = variations.find(v => v.id === previewData.variationId);
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[80vh] p-0 gap-0 flex flex-col">
          <div className="px-6 pt-6 pb-3 shrink-0">
            <DialogHeader>
              <DialogTitle>预览变体图片 - {variation?.name}</DialogTitle>
              <DialogDescription>
                确认图片是否满意，满意则保存
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6">
            <div className="relative rounded-lg overflow-hidden border-2 border-warning/50 bg-muted">
              <img 
                src={previewData.imageUrl} 
                alt={`${character.name} - ${variation?.name}`}
                className="w-full h-auto"
              />
              <ResolutionBadge src={previewData.imageUrl} />
              <div className="absolute top-2 left-2 bg-warning text-white text-xs px-2 py-1 rounded">
                预览
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 pt-3 space-y-2 shrink-0 border-t">
            <div className="flex gap-2">
              <Button onClick={handleSavePreview} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                保存
              </Button>
              <Button 
                onClick={() => handleGenerateVariation(variation!)} 
                variant="outline"
                disabled={generatingVariationId !== null}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                重新生成
              </Button>
            </div>
            <Button onClick={handleDiscardPreview} variant="ghost" className="w-full">
              放弃并返回
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ======== Main Dialog ========
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] p-0 gap-0 flex flex-col">
        <div className="px-6 pt-6 pb-3 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="h-5 w-5" />
              {character.name} 的衣橱
            </DialogTitle>
            <DialogDescription>
              管理角色的不同造型变体，AI 生成时将保持面部特征一致
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
          <div className="space-y-4 pb-4">
          {/* Character base portrait preview */}
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
              {characterBaseImage ? (
                <LocalImage
                  src={characterBaseImage}
                  alt={character.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">{character.name}</h4>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">基础定妆照</span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {character.visualTraits || character.description || '未设置视觉描述'}
              </p>
              {!characterBaseImage && (
                <p className="text-xs text-warning mt-1">
                  ⚠ 请先生成角色基础图片，衣橱变体需要基础定妆照作为参考
                </p>
              )}
            </div>
          </div>

          {/* Existing variations */}
          {variations.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">已有变体 ({variations.length})</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {variations.map((variation) => (
                  <div
                    key={variation.id}
                    className={cn(
                      "p-3 rounded-lg border bg-card min-w-0",
                      generatingVariationId === variation.id && "opacity-70"
                    )}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Thumbnail — double-click to zoom */}
                      <div
                        className={cn(
                          "w-14 h-14 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0",
                          variation.referenceImage && "cursor-pointer ring-offset-background hover:ring-2 hover:ring-primary/40 hover:ring-offset-1 transition-shadow"
                        )}
                        onDoubleClick={() => variation.referenceImage && setZoomedImageUrl(variation.referenceImage)}
                        title={variation.referenceImage ? "双击放大查看" : undefined}
                      >
                        {variation.referenceImage ? (
                          <img 
                            src={variation.referenceImage} 
                            alt={variation.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-medium text-sm truncate flex-1 min-w-0">{variation.name}</h4>
                          <Button
                            size="icon"
                            variant="text"
                            className="h-6 w-6 text-destructive"
                            onClick={() => handleDeleteVariation(variation.id, variation.name)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-all">
                          {variation.visualPrompt}
                        </p>

                        {/* Clothing ref thumbnails */}
                        {variation.clothingReferenceImages && variation.clothingReferenceImages.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {variation.clothingReferenceImages.map((img, i) => (
                              <div key={i} className="w-6 h-6 rounded border bg-muted overflow-hidden flex-shrink-0">
                                <img src={img} alt="ref" className="w-full h-full object-cover" />
                              </div>
                            ))}
                            <span className="text-[10px] text-muted-foreground self-center">参考</span>
                          </div>
                        )}

                        {/* Generate button */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 w-full h-7 text-xs"
                          onClick={() => handleGenerateVariation(variation)}
                          disabled={
                            generatingVariationId !== null ||
                            (!generateVariationExternally && !characterBaseImage)
                          }
                        >
                          {generatingVariationId === variation.id ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              生成中...
                            </>
                          ) : variation.referenceImage ? (
                            <>
                              <RotateCcw className="h-3 w-3 mr-1" />
                              重新生成
                            </>
                          ) : (
                            <>
                              <Wand2 className="h-3 w-3 mr-1" />
                              生成图片
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick add presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">快速添加</Label>
            <div className="flex flex-wrap gap-2">
              {VARIATION_PRESETS.map((preset) => {
                const exists = variations.some(v => v.name === preset.name);
                return (
                  <Button
                    key={preset.name}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => handleQuickAdd(preset)}
                    disabled={exists}
                  >
                    {exists ? (
                      <>
                        <Check className="h-3 w-3 mr-1 text-success" />
                        {preset.name}
                      </>
                    ) : (
                      <>
                        <Plus className="h-3 w-3 mr-1" />
                        {preset.name}
                      </>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Custom variation form */}
          {showAddForm ? (
            <div
              className="space-y-4 p-4 border rounded-lg bg-muted/30 min-w-0"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Label className="text-sm font-medium">添加自定义变体</Label>

              {/* Variation name */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">变体名称 *</Label>
                <Input
                  ref={nameInputRef}
                  placeholder="如：婚纱、披风装、校服、古风汉服"
                  value={newVariationName}
                  onChange={(e) => setNewVariationName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Clothing reference images upload */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  服装参考图（可选，最多 {MAX_CLOTHING_REFS} 张）
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  上传想要角色穿的衣服/造型照片，AI 会将角色融合到该服装中
                </p>

                {/* Uploaded clothing refs */}
                <div className="flex flex-wrap gap-2">
                  {newClothingRefs.map((img, idx) => (
                    <div
                      key={idx}
                      className="relative w-20 h-20 rounded-lg border-2 border-primary/30 overflow-hidden group"
                    >
                      <img
                        src={img}
                        alt={`服装参考 ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <ResolutionBadge src={img} className="left-1 right-auto top-1" />
                      <button
                        onClick={() => handleRemoveClothingRef(idx)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[9px] text-white text-center py-0.5">
                        参考 {idx + 1}
                      </div>
                    </div>
                  ))}

                  {/* Upload button */}
                  {newClothingRefs.length < MAX_CLOTHING_REFS && (
                    <button
                      onClick={() => clothingInputRef.current?.click()}
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-muted/50 transition-colors"
                    >
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">上传</span>
                    </button>
                  )}
                </div>

                <input
                  ref={clothingInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleClothingImageUpload}
                />
              </div>

              {/* Visual prompt */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">视觉描述（可选）</Label>
                <Textarea
                  placeholder="描述服装细节或整体造型，如：\n- 白色蕾丝婚纱，长拖尾，头戴花冠\n- elegant white lace wedding dress, long train, floral headpiece"
                  value={newVariationPrompt}
                  onChange={(e) => setNewVariationPrompt(e.target.value)}
                  className="min-h-[72px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  可用中文或英文描述，支持混合。有参考图时可简短描述补充细节
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleAddVariation} disabled={!newVariationName.trim()}>
                  <Check className="h-3 w-3 mr-1" />
                  添加变体
                </Button>
                <Button size="sm" variant="outline" onClick={resetAddForm}>
                  <X className="h-3 w-3 mr-1" />
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加自定义变体
            </Button>
          )}

          {/* Tips */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p>💡 变体生成会参考角色基础定妆照，保持面部特征一致</p>
            <p>💡 上传服装参考图可让 AI 更精准地生成目标造型</p>
            <p>💡 建议先生成角色基础图片，再添加变体</p>
          </div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-3 border-t shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>

      {/* Fullscreen image preview */}
      <ImagePreviewModal
        imageUrl={zoomedImageUrl || ''}
        isOpen={!!zoomedImageUrl}
        onClose={() => setZoomedImageUrl(null)}
      />
    </Dialog>
  );
}
