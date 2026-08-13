"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";
import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";
import {
  Box,
  Copy,
  ImageIcon,
  Loader2,
  Map,
  Music2,
 
  Sparkles,
  UserCircle,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/lib/events/event-bus";
import { polishAssetPrompt, type PolishResult } from "@/lib/ai/prompt-polisher";
import { generateAsset } from "@/lib/studio/asset-generation-orchestrator";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetImageOpenTarget, getAssetOperationError, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
import { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";
import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import { subscribeAssetCarouselIndex } from "./studio-asset-detail-carousel";
import { StudioAssetRoleAttributes } from "./studio-asset-role-attributes";

export { buildAssetRegenerationPrompt, getAssetDisplayName, getAssetImageOpenTarget, getAssetOperationError, getAssetSpokenText, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
export { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: ImageIcon,
  audio: Music2,
} as const;

const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "视频素材",
  audio: "音频",
} as const;

export function StudioAssetDetailDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: StudioAssetSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);
  const setImagePrompt = useFreedomStore((state) => state.setImagePrompt);
  const setImageResult = useFreedomStore((state) => state.setImageResult);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSetting, setDraftSetting] = useState("");
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<"polishing" | "generating" | "saving" | "done" | "failed" | null>(null);
  const [generateMessage, setGenerateMessage] = useState("");
  const [voiceAssignOpen, setVoiceAssignOpen] = useState(false);

  // 获取当前项目的视觉手册 ID
  const visualManualId = useStudioStore((s) => s.workflowConfig?.visualManualId);
  const activeTtsProjectId = useTtsStore((s) => s.activeProjectId);
  const ttsProjects = useTtsStore((s) => s.projects);
  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);

  const [images, setImages] = useState<AssetImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullAsset, setFullAsset] = useState<StudioAssetSummary | null>(null);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const regenerationPrompt = useMemo(() => buildAssetRegenerationPrompt(fullAsset || asset), [fullAsset, asset]);
  const syncCarouselIndex = useCallback((api: CarouselApi) => {
    subscribeAssetCarouselIndex(api, setCurrentIndex);
  }, []);

  useEffect(() => {
    if (!asset) {
      setFullAsset(null);
      setImages([]);
      setCurrentIndex(0);
      setRecognizedText(null);
      setVoiceAssignOpen(false);
      return;
    }

    let cancelled = false;
    const initialImages: AssetImage[] = [];
    if (asset.previewUrl || asset.thumbnailUrl) {
      initialImages.push({ name: "主图", filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
    }
    if (asset.images?.length) {
      initialImages.push(...asset.images);
    }
    setFullAsset(null);
    setRecognizedText(null);
    setImages(initialImages);
    setCurrentIndex(0);
    setDraftName(asset.name || "");
    setDraftDescription(asset.description || "");
    setDraftPrompt(asset.prompt || "");
    setDraftSetting(asset.setting || "");

    if (getStudioAssetsBridge()?.get) {
      getStudioAssetsBridge()!.get(asset.id).then((result) => {
        if (!result || cancelled) return;
        setFullAsset(result);
        setDraftName(result.name || "");
        setDraftDescription(result.description || "");
        setDraftPrompt(result.prompt || "");
        setDraftSetting(result.setting || "");
        const updatedImgs: AssetImage[] = [];
        if (result.previewUrl || result.thumbnailUrl) {
          updatedImgs.push({ name: "主图", filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl });
        }
        if (result.images?.length) {
          updatedImgs.push(...result.images);
        }
        setImages(updatedImgs);
      }).catch((error: unknown) => {
        if (!cancelled) {
          toast.error(getAssetOperationError(error, "加载资产详情失败"));
        }
      });
    }

    return () => {
      cancelled = true;
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);

  if (!asset) return null;

  const detail = fullAsset || asset;
  const Icon = TYPE_ICON[asset.type];
  const displayName = getAssetDisplayName(asset);
  const parsedDraftName = parseAssetNames(draftName || detail.name || asset.name);
  const spokenText = recognizedText ?? (draftDescription.trim() || "");
  const audioSrc = asset.previewUrl || asset.filePath || "";
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  const roleSpeakerId = toRoleSpeakerId(asset.id);
  const roleVoiceBindings = activeTtsProjectId ? (ttsProjects[activeTtsProjectId]?.bindings ?? {}) : {};
  const roleVoiceBinding = asset.type === "role" ? roleVoiceBindings[roleSpeakerId] : undefined;
  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;

  /** 润色当前资产的提示词 */
  const handlePolishPrompt = async () => {
    if (!asset || !visualManualId) {
      toast.error(!visualManualId ? "请先选择视觉手册" : "无资产信息");
      return;
    }

    setIsPolishingPrompt(true);
    try {
      const assetType = asset.type === "tool" ? "prop" as const
        : asset.type === "role" ? "character" as const
        : asset.type === "scene" ? "scene" as const
        : "prop" as const;

      const result = await polishAssetPrompt({
        assetType,
        name: asset.name,
        description: draftDescription || asset.description || "",
        isDerivative: false,
        visualManualId,
      });

      if (result.status === "success") {
        setDraftPrompt(result.prompt);
        toast.success("提示词润色完成");
      } else {
        toast.error(`润色失败: ${result.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`润色出错: ${message}`);
    } finally {
      setIsPolishingPrompt(false);
    }
  };

  const handleSave = async () => {
    if (!getStudioAssetsBridge()?.update) {
      toast.error("当前环境不支持保存");
      return;
    }
    const updates: Record<string, unknown> = {};
    updates.name = draftName;
    updates.description = draftDescription;
    updates.prompt = draftPrompt;
    updates.setting = draftSetting;
    try {
      const result = await getStudioAssetsBridge()!.update({ id: asset.id, updates });
      if (result) {
        toast.success("已保存");
      } else {
        toast.error("保存失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "保存失败"));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除「${asset.name}」？此操作不可撤销。`)) return;

    let success = false;
    try {
      if (asset.id.startsWith("manying-prop:")) {
        // 本地道具库数据，从 localStorage store 删除
        const realId = asset.id.replace("manying-prop:", "");
        usePropsLibraryStore.getState().deleteProp(realId);
        success = true;
      } else if (getStudioAssetsBridge()?.delete) {
        success = await getStudioAssetsBridge()!.delete(asset.id);
      } else {
        toast.error("当前环境不支持删除");
        return;
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "删除失败"));
      return;
    }

    if (success) {
      toast.success("已删除");
      eventBus.emit("asset:deleted", { id: asset.id, type: asset.type });
      onOpenChange(false);
    } else {
      toast.error("删除失败");
    }
  };

  const copyText = async (label: string, value?: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label}为空`);
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success(`已复制${label}`);
  };

  const handleOneClickGenerateAssetImage = async () => {
    if (!visualManualId) {
      toast.error("请先在「风格与导演选择」中选择视觉手册");
      return;
    }
    const existingPrompt = draftPrompt.trim();
    const shouldGeneratePrompt = !existingPrompt;
    setGeneratePhase(shouldGeneratePrompt ? "polishing" : "generating");
    setGenerateMessage(shouldGeneratePrompt ? `正在根据风格生成 ${asset.name} 的出图提示词...` : `正在生成 ${asset.name} 的图片...`);
    try {
      const assetType = asset.type === "role" ? "character" as const : asset.type === "scene" ? "scene" as const : "prop" as const;
      let promptPersistPromise: Promise<boolean> | null = null;
      const applyPolishedPrompt = (polishResult?: PolishResult) => {
        const prompt = polishResult?.status === "success" ? polishResult.prompt?.trim() : "";
        if (!prompt) return;
        setDraftPrompt(prompt);
        setFullAsset((current) => current ? { ...current, prompt } : current);
      };
      const result = await generateAsset(
        {
          assetId: asset.id,
          assetType,
          name: asset.name,
          description: draftDescription || asset.name,
          isDerivative: false,
          visualManualId,
          skipPolish: !shouldGeneratePrompt,
          existingPrompt: shouldGeneratePrompt ? undefined : existingPrompt,
        },
        (progress) => {
          if (progress.polishResult?.status === "success" && progress.polishResult.prompt?.trim()) {
            applyPolishedPrompt(progress.polishResult);
            promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, progress.polishResult);
          }
          if (progress.phase === "polishing") {
            setGeneratePhase("polishing");
            setGenerateMessage(`正在根据风格生成 ${asset.name} 的出图提示词...`);
          } else if (progress.phase === "generating") {
            setGeneratePhase("generating");
            setGenerateMessage(`正在生成 ${asset.name} 的图片...`);
          } else if (progress.phase === "saving") {
            setGeneratePhase("saving");
            setGenerateMessage(`正在保存 ${asset.name} 的图片...`);
          }
        },
      );
      if (result.phase === "done") {
        setGeneratePhase("done");
        setGenerateMessage("生成完成！");
        applyPolishedPrompt(result.polishResult);
        promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, result.polishResult);
        if (promptPersistPromise) {
          await promptPersistPromise;
        }
        const savedToLibrary = await saveGeneratedAssetImageToLibrary(
          asset.id,
          result.imageLocalPath,
          result.polishResult,
        );
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated) {
            setDraftName(updated.name || "");
            setDraftDescription(updated.description || "");
            setDraftPrompt(updated.prompt || "");
            setDraftSetting(updated.setting || "");
            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              newImgs.push({ name: "主图", filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            setImages(newImgs);
          }
        }
        if (!savedToLibrary) {
          toast.warning(`「${asset.name}」图片已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」资产生成完成`);
        }
      } else {
        applyPolishedPrompt(result.polishResult);
        promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, result.polishResult);
        if (promptPersistPromise) {
          await promptPersistPromise;
        }
        setGeneratePhase("failed");
        setGenerateMessage(`生成失败: ${result.error || "未知错误"}`);
        toast.error(`生成失败: ${result.error || "未知错误"}`);
      }
    } catch (err: unknown) {
      setGeneratePhase("failed");
      setGenerateMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => {
        setGeneratePhase(null);
        setGenerateMessage("");
      }, 3000);
    }
  };

  const handleRegenerate = async () => {
    const currentPrompt = draftPrompt.trim()
      || draftDescription.trim()
      || detail.prompt?.trim()
      || detail.description?.trim()
      || "";
    if (!currentPrompt) {
      toast.error("没有可用于出图的描述或提示词");
      return;
    }

    // 监听图片生成完成事件，自动保存回素材
    eventBus.once("image:generated", async (data: { url: string }) => {
      if (!data.url) return;
      try {
        const saved = await saveGeneratedAssetImageToLibrary(asset.id, data.url);
        if (saved) {
          toast.success("已自动保存回素材");
        }
      } catch (e) {
        console.warn("[Asset] Auto-save after regeneration failed:", e);
      }
    });

    setActiveStudio("image");
    setImagePrompt(currentPrompt);
    setImageResult(null);
    setActiveTab("freedom");
    onOpenChange(false);
    toast.success("已带入图片工作室，生成完成后将自动保存回素材");
  };

  const handleOpenSource = async () => {
    const target = getAssetImageOpenTarget(images, currentIndex, detail);
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    try {
      const result = await window.electronAPI.openPath(target);
      if (!result.success) {
        toast.error(result.error || "打开失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "打开失败"));
    }
  };

  const handleOpenFolder = async () => {
    const target = asset.sourcePath || asset.filePath;
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    const dir = target.substring(0, target.lastIndexOf("/")) || target;
    try {
      const result = await window.electronAPI.openPath(dir);
      if (!result.success) {
        toast.error(result.error || "打开失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "打开失败"));
    }
  };

  const handleAddImage = async () => {
    if (!getStudioAssetsBridge()?.selectImageFiles || !getStudioAssetsBridge()?.addImage) {
      toast.error("当前环境不支持添加图片");
      return;
    }
    try {
      const filePaths = await getStudioAssetsBridge()!.selectImageFiles();
      if (!filePaths.length) return;

      let lastResult: StudioAssetSummary | null = null;
      let addedCount = 0;
      let failedCount = 0;
      for (const filePath of filePaths) {
        const imageName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "新图片";
        try {
          const result = await getStudioAssetsBridge()!.addImage({
            assetId: asset.id,
            imageName: imageName.trim(),
            sourceFilePath: filePath,
          });
          if (result?.images) {
            lastResult = result;
            addedCount += 1;
          } else {
            failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      if (lastResult?.images) {
        const newImgs: AssetImage[] = [];
        if (lastResult.previewUrl || lastResult.thumbnailUrl) {
          newImgs.push({ name: "主图", filePath: lastResult.filePath || "", url: lastResult.previewUrl || lastResult.thumbnailUrl });
        }
        newImgs.push(...lastResult.images);
        setFullAsset(lastResult);
        setImages(newImgs);
        setCurrentIndex(newImgs.length - 1);
        if (failedCount > 0) {
          toast.warning(`已添加 ${addedCount} 张图片，${failedCount} 张未添加`);
        } else {
          toast.success(`已添加 ${addedCount} 张图片`);
        }
      } else {
        toast.error(`添加失败：${failedCount} 张图片均未添加`);
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "添加失败"));
    }
  };

  const handleReplaceImage = async () => {
    if (!getStudioAssetsBridge()?.selectImageFile || !getStudioAssetsBridge()?.replaceImage) {
      toast.error("当前环境不支持更换图片");
      return;
    }
    try {
      const filePath = await getStudioAssetsBridge()!.selectImageFile();
      if (!filePath) return;
      const result = await getStudioAssetsBridge()!.replaceImage({ assetId: asset.id, sourceFilePath: filePath });
      if (result) {
        const newImgs = updateImagesAfterReplacingMainImage(images, result);
        setImages(newImgs);
        setFullAsset((current) => current ? { ...current, ...result } : result);
        setCurrentIndex(0);
        toast.success("主图已更换");
      } else {
        toast.error("更换失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "更换失败"));
    }
  };

  const handleRemoveImage = async (img: AssetImage, idx: number) => {
    if (idx === 0 && img.name === "主图") {
      toast.error("不能删除主图");
      return;
    }
    if (!getStudioAssetsBridge()?.removeImage) return;
    try {
      const result = await getStudioAssetsBridge()!.removeImage({ assetId: asset.id, imageFilePath: img.filePath });
      if (result) {
        const newImgs = images.filter((_, i) => i !== idx);
        setImages(newImgs);
        setCurrentIndex(Math.min(currentIndex, newImgs.length - 1));
        toast.success("已删除");
      } else {
        toast.error("删除失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "删除失败"));
    }
  };

 
  async (img: AssetImage, idx: number) => {
    if (idx === 0 && img.name === "主图") return;
    if (!getStudioAssetsBridge()?.renameImage) return;
    const newName = await new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.value = img.name;
      input.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;padding:12px;border-radius:8px;border:1px solid #555;background:#1a1a2e;color:#fff;font-size:14px;width:300px;";
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5);";
      document.body.append(overlay, input);
      input.focus();
      input.select();
      const cleanup = () => { overlay.remove(); input.remove(); };
      input.onkeydown = (e) => { if (e.key === "Enter") { cleanup(); resolve(input.value); } if (e.key === "Escape") { cleanup(); resolve(null); } };
      overlay.onclick = () => { cleanup(); resolve(null); };
    });
    if (!newName?.trim() || newName.trim() === img.name) return;
    try {
      const result = await getStudioAssetsBridge()!.renameImage({ assetId: asset.id, imageFilePath: img.filePath, newName: newName.trim() });
      if (result) {
        const newImgs = [...images];
        newImgs[idx] = { ...newImgs[idx], name: newName.trim() };
        setImages(newImgs);
        toast.success("已重命名");
      } else {
        toast.error("重命名失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "重命名失败"));
    }
  };

  const handleTranscribe = async () => {
    const filePath = asset.sourcePath || asset.filePath;
    if (!filePath) {
      toast.error("无音频文件路径");
      return;
    }
    const ttsRuntime = getTtsRuntimeBridge();
    if (!ttsRuntime?.request) {
      toast.error("TTS 后端未就绪");
      return;
    }
    toast.info("正在识别说话内容...");
    try {
      const result = await ttsRuntime.request({
        method: "POST",
        path: "/transcribe",
        body: { audio_path: filePath },
      }) as { text?: string };
      if (result?.text) {
        setDraftDescription(result.text);
        setRecognizedText(result.text);
        if (getStudioAssetsBridge()?.update) {
          await getStudioAssetsBridge()!.update({
            id: asset.id,
            updates: { description: result.text },
          });
        }
        toast.success("识别完成并已保存");
      } else {
        toast.error("未识别到内容");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "识别失败");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="studio-asset-detail-dialog h-[92vh] !w-[90vw] !max-w-[90vw] overflow-hidden p-0">
        <DialogHeader className={asset.type === "audio" ? "sr-only" : "studio-asset-detail-header border-b border-border px-5 py-4"}>
          <DialogTitle className={asset.type === "audio" ? "sr-only" : "flex min-w-0 items-center gap-2 text-base"}>
            <Icon className="h-4 w-4 text-primary" />
            <span className="truncate">{displayName}</span>
            <Badge variant="outline" className="ml-1">{TYPE_LABEL[asset.type]}</Badge>
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看和编辑资产详情，包括预览、提示词、设定和角色音色绑定。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,420px)_1fr] gap-0 overflow-hidden">
          <StudioAssetDetailPreviewPane
            asset={asset}
            images={images}
            currentIndex={currentIndex}
            spokenText={spokenText}
            audioSrc={audioSrc}
            Icon={Icon}
            onCarouselApi={syncCarouselIndex}
            onTranscribe={handleTranscribe}
            onRemoveImage={handleRemoveImage}
            onAddImage={handleAddImage}
            onReplaceImage={handleReplaceImage}
            onRegenerate={handleRegenerate}
            onCopyPrompt={() => copyText("出图提示词", draftPrompt || draftDescription || regenerationPrompt)}
            onOpenSource={handleOpenSource}
            onOpenFolder={handleOpenFolder}
          />

          {/* 右侧：表单 */}
          <ScrollArea className="max-h-[calc(92vh-72px)] min-w-0 overflow-x-hidden [&>[data-radix-scroll-area-viewport]>div]:!block [&_[data-orientation=vertical]]:bg-transparent">
            <div className="space-y-3 p-5 min-w-0 overflow-hidden">
              {/* 空壳资产生成引导 */}
              {asset.type !== "audio" && !draftDescription.trim() && !draftPrompt.trim() && !draftSetting.trim() && !hasImagePreview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">此角色尚无详细数据</div>
                  <p className="text-xs text-muted-foreground">
                    「{displayName}」在资产库中仅有名称记录，缺少描述、设定和图片。
                    可在「出图提示词」区域走完整生成流程：润色提示词 → 生成图片 → 保存。
                  </p>
                </div>
              )}
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">名字</div>
                <input
                  className="w-full rounded-md border border-border bg-muted/90 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="主名字;副名字1;副名字2"
                />
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>主名字：{parsedDraftName.primaryName}</span>
                  {parsedDraftName.secondaryNames.length > 0 ? (
                    <>
                      <span className="mx-0.5">副名字</span>
                      {parsedDraftName.secondaryNames.map((name) => (
                        <Badge key={name} variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                          {name}
                        </Badge>
                      ))}
                    </>
                  ) : (
                    <span>用英文分号 ; 添加副名字</span>
                  )}
                </div>
              </section>
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{asset.type === "audio" ? "说话内容" : "描述"}</div>
                <Textarea
                  value={asset.type === "audio" ? spokenText : draftDescription}
                  onChange={(event) => {
                    setDraftDescription(event.target.value);
                    setRecognizedText(null);
                  }}
                  placeholder={asset.type === "audio" ? "暂无口播词句" : "暂无描述"}
                  className="min-h-[80px] resize-none bg-muted/90 text-xs leading-5"
                />
              </section>
              {/* 人物属性 — 从 setting 中解析 */}
              {asset.type === "role" && (
                <StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />
              )}
              {/* 音色信息 — 仅角色类型显示 */}
              {asset.type === "role" && (() => {
                if (!roleVoiceBinding || !roleVoiceProfile) {
                  return (
                    <button
                      type="button"
                      onClick={() => setVoiceAssignOpen(true)}
                      className="w-full space-y-2 rounded-lg border border-border bg-muted/90 p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/10"
                    >
                      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5" /> 音色
                      </div>
                      <p className="text-xs text-muted-foreground">尚未分配音色。点击选择资产库音频。</p>
                    </button>
                  );
                }
                return (
                  <section className="space-y-2 rounded-lg border border-border bg-muted/90 p-3">
                    <button
                      type="button"
                      onClick={() => setVoiceAssignOpen(true)}
                      className="w-full rounded-md text-left transition-colors hover:bg-primary/10"
                    >
                      <div className="flex items-center justify-between gap-2 p-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Volume2 className="h-3.5 w-3.5" /> 音色信息
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">点击更换资产库音频</div>
                        </div>
                        <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                          更换音色
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 overflow-hidden p-2 pt-0 text-xs">
                        <div className="truncate" title={roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}><span className="text-muted-foreground">类型：</span>{roleVoiceProfile.type === "preset" ? "预设音色" : "克隆音色"}</div>
                        <div className="truncate" title={roleVoiceProfile.defaultEngine}><span className="text-muted-foreground">引擎：</span>{roleVoiceProfile.defaultEngine}</div>
                        {roleVoiceProfile.presetVoiceId && <div className="truncate" title={roleVoiceProfile.presetVoiceId}><span className="text-muted-foreground">预设：</span>{roleVoiceProfile.presetVoiceId}</div>}
                        {roleVoiceProfile.referenceAudioPath && <div className="col-span-2 truncate" title={roleVoiceProfile.referenceAudioPath}><span className="text-muted-foreground">参考音频：</span>{roleVoiceProfile.referenceAudioPath}</div>}
                        <div className="truncate" title={roleVoiceProfile.id}><span className="text-muted-foreground">Profile：</span>{roleVoiceProfile.id}</div>
                      </div>
                    </button>
                    <RoleVoicePreviewButton
                      profileId={roleVoiceProfile.id}
                      characterName={parsedDraftName.primaryName}
                      defaultEngine={roleVoiceBinding.defaultEngine}
                      defaultModelSize={roleVoiceBinding.defaultModelSize}
                    />
                  </section>
                );
              })()}
              {asset.type !== "audio" ? (
                <>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">出图提示词</div>
                    <Textarea
                      value={draftPrompt}
                      onChange={(event) => setDraftPrompt(event.target.value)}
                      placeholder="暂无出图提示词"
                      className="min-h-[80px] resize-none bg-muted/90 text-xs leading-5"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-6 gap-1 text-[11px]"
                        onClick={handleOneClickGenerateAssetImage}
                        disabled={!!generatePhase || !visualManualId}
                      >
                        {generatePhase ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {generatePhase === "polishing" ? "生成提示词中..." : generatePhase === "generating" ? "生成图片中..." : generatePhase === "saving" ? "保存中..." : generatePhase === "done" ? "生成完成" : "一键生成资产生图"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-[11px]"
                        onClick={handlePolishPrompt}
                        disabled={isPolishingPrompt || !visualManualId}
                      >
                        {isPolishingPrompt ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {isPolishingPrompt ? "润色中..." : "润色提示词"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-[11px]"
                        onClick={() => draftPrompt && navigator.clipboard.writeText(draftPrompt).then(() => toast.success("已复制"))}
                        disabled={!draftPrompt}
                      >
                        <Copy className="h-3 w-3" />
                        复制
                      </Button>
                      {generatePhase && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={generateMessage}>
                          {generateMessage}
                        </span>
                      )}
                    </div>
                  </section>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">设定</div>
                    <Textarea
                      value={draftSetting}
                      onChange={(event) => setDraftSetting(event.target.value)}
                      placeholder="暂无设定"
                      className="min-h-[200px] resize-none bg-muted/90 text-xs leading-5"
                    />
                  </section>
                </>
              ) : (
                null
              )}
              <Button className="w-full" onClick={handleSave}>保存</Button>
              <Button variant="destructive" className="w-full" onClick={handleDelete}>删除</Button>
            </div>
          </ScrollArea>
        </div>
        </DialogContent>
      </Dialog>
      {asset.type === "role" && (
        <RoleVoiceAssignDialog
          character={{ id: asset.id, name: parsedDraftName.primaryName }}
          open={voiceAssignOpen}
          onOpenChange={setVoiceAssignOpen}
        />
      )}
    </>
  );
}
