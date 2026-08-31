/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 资产详情对话框动作钩子——润色/保存/删除/一键生图/带入重生成/打开/增删换图/转写。
 * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;闭包引用经 ctx 注入
 * (通读人工核验,非正则法);any 为迁移期务实妥协。
 */
import { toast } from "sonner";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { eventBus } from "@/lib/event-bus";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { polishAssetPrompt, type AssetType, type PolishResult } from "@/lib/ai/prompt-polisher";
import { generateAsset } from "@/lib/studio/asset-generation-orchestrator";
import { getAssetImageOpenTarget, getAssetOperationError, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
import { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

export function useStudioAssetDialogActions(ctx: {
  asset: any;
  onOpenChange: any;
  visualManualId: any;
  detail: any;
  images: any;
  currentIndex: any;
  draftName: any;
  draftDescription: any;
  draftPrompt: any;
  draftSetting: any;
  setIsPolishingPrompt: any;
  setDraftName: any;
  setDraftDescription: any;
  setDraftPrompt: any;
  setDraftSetting: any;
  setFullAsset: any;
  setImages: any;
  setCurrentIndex: any;
  setGeneratePhase: any;
  setGenerateMessage: any;
  setRecognizedText: any;
  setImagePrompt: any;
  setImageResult: any;
  setActiveStudio: any;
  setActiveTab: any;
  resolveAssetGenerationReferenceImage: any;
  resolveThreeTrackAssetType: any;
}) {
  const {
    asset,
    onOpenChange,
    visualManualId,
    detail,
    images,
    currentIndex,
    draftName,
    draftDescription,
    draftPrompt,
    draftSetting,
    setIsPolishingPrompt,
    setDraftName,
    setDraftDescription,
    setDraftPrompt,
    setDraftSetting,
    setFullAsset,
    setImages,
    setCurrentIndex,
    setGeneratePhase,
    setGenerateMessage,
    setRecognizedText,
    setImagePrompt,
    setImageResult,
    setActiveStudio,
    setActiveTab,
    resolveAssetGenerationReferenceImage,
    resolveThreeTrackAssetType,
  } = ctx;

  /** 润色当前资产的提示词 */
  const handlePolishPrompt = async () => {
    if (!asset || !visualManualId) {
      toast.error(!visualManualId ? "请先选择视觉手册" : "无资产信息");
      return;
    }

    setIsPolishingPrompt(true);
    try {
      let assetType: AssetType;
      try {
        assetType = resolveThreeTrackAssetType(asset.type);
      } catch {
        toast.error("该资产类型不支持生图提示词（仅角色/场景/道具三轨）");
        return;
      }

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
      let assetType: AssetType;
      try {
        assetType = resolveThreeTrackAssetType(asset.type);
      } catch {
        toast.error("该资产类型不支持生成图片（仅角色/场景/道具三轨）");
        setGeneratePhase(null);
        return;
      }
      let promptPersistPromise: Promise<boolean> | null = null;
      const applyPolishedPrompt = (polishResult?: PolishResult) => {
        const prompt = polishResult?.status === "success" ? polishResult.prompt?.trim() : "";
        if (!prompt) return;
        setDraftPrompt(prompt);
        setFullAsset((current) => current ? { ...current, prompt } : current);
      };
      // 以当前查看的设定图为参考再生成(身份一致性;道劫链据此加参考图降噪锁)
      const referenceImage = resolveAssetGenerationReferenceImage(images, currentIndex);
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
          referenceImages: referenceImage ? [referenceImage] : undefined,
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
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
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
          eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
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

  return {
    handlePolishPrompt, handleSave, handleDelete, copyText,
    handleOneClickGenerateAssetImage, handleRegenerate, handleOpenSource,
    handleOpenFolder, handleAddImage, handleReplaceImage, handleRemoveImage,
    handleTranscribe,
  };
}
