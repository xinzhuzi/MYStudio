"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useFreedomStore } from "@/stores/freedom-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import {
  Box,
  Clipboard,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Map,
  Music2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";

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

const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;
const waveformBars = [42, 68, 50, 84, 46, 72, 58, 92, 54, 76, 48, 66, 40, 60, 36, 70];

export function getAssetDisplayName(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  const rawName = asset.name || asset.sourcePath || asset.filePath || "未命名素材";
  const fileName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}

export function getAssetSpokenText(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  const text = asset.description?.trim();
  if (text && !looksLikePath(text)) return text;
  return getAssetDisplayName(asset)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || MEDIA_EXT_PATTERN.test(value);
}

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

  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const settingRef = useRef<HTMLTextAreaElement>(null);

  const [images, setImages] = useState<AssetImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullAsset, setFullAsset] = useState<StudioAssetSummary | null>(null);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const regenerationPrompt = useMemo(() => buildAssetRegenerationPrompt(fullAsset || asset), [fullAsset, asset]);

  // 打开弹窗时获取完整数据
  const prevAssetId = useRef<string | null>(null);
  if (asset && asset.id !== prevAssetId.current) {
    prevAssetId.current = asset.id;
    setFullAsset(null);
    setRecognizedText(null);
    // 异步加载完整数据
    if (window.studioAssets?.get) {
      window.studioAssets.get(asset.id).then((result) => {
        if (result) {
          setFullAsset(result);
          // 更新多图列表
          const updatedImgs: AssetImage[] = [];
          if (result.previewUrl || result.thumbnailUrl) {
            updatedImgs.push({ name: "主图", filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl });
          }
          if (result.images?.length) {
            updatedImgs.push(...result.images);
          }
          if (updatedImgs.length > 0) setImages(updatedImgs);
        }
      });
    }
    const imgs: AssetImage[] = [];
    // 主图作为第一张
    if (asset.previewUrl || asset.thumbnailUrl) {
      imgs.push({ name: "主图", filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
    }
    // 追加多图
    if (asset.images?.length) {
      imgs.push(...asset.images);
    }
    setImages(imgs);
    setCurrentIndex(0);
  }

  if (!asset) return null;

  const detail = fullAsset || asset;
  const Icon = TYPE_ICON[asset.type];
  const displayName = getAssetDisplayName(asset);
  const spokenText = recognizedText ?? (detail.description?.trim() || "");
  const audioSrc = asset.previewUrl || asset.filePath || "";
  const hasImagePreview = asset.type !== "audio" && images.length > 0;

  const handleSave = async () => {
    if (!window.studioAssets?.update) {
      toast.error("当前环境不支持保存");
      return;
    }
    const updates: Record<string, unknown> = {};
    if (nameRef.current) updates.name = nameRef.current.value;
    if (descRef.current) updates.description = descRef.current.value;
    if (promptRef.current) updates.prompt = promptRef.current.value;
    if (settingRef.current) updates.setting = settingRef.current.value;
    const result = await window.studioAssets.update({ id: asset.id, updates });
    if (result) {
      toast.success("已保存");
    } else {
      toast.error("保存失败");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除「${asset.name}」？此操作不可撤销。`)) return;

    let success = false;
    if (asset.id.startsWith("manying-prop:")) {
      // 本地道具库数据，从 localStorage store 删除
      const { usePropsLibraryStore } = await import("@/stores/props-library-store");
      const realId = asset.id.replace("manying-prop:", "");
      usePropsLibraryStore.getState().deleteProp(realId);
      success = true;
    } else if (window.studioAssets?.delete) {
      success = await window.studioAssets.delete(asset.id);
    } else {
      toast.error("当前环境不支持删除");
      return;
    }

    if (success) {
      toast.success("已删除");
      const { eventBus } = await import("@/lib/event-bus");
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

  const handleRegenerate = async () => {
    const currentPrompt = promptRef.current?.value?.trim()
      || descRef.current?.value?.trim()
      || detail.prompt?.trim()
      || detail.description?.trim()
      || "";
    if (!currentPrompt) {
      toast.error("没有可用于出图的描述或提示词");
      return;
    }

    // 监听图片生成完成事件，自动保存回素材
    const { eventBus } = await import("@/lib/event-bus");
    eventBus.once("image:generated", async (data: { url: string }) => {
      if (!data.url || !window.studioAssets?.replaceImage) return;
      // 下载图片到本地临时文件再替换
      try {
        const resp = await fetch(data.url);
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const result = await window.studioAssets.saveMaterial({ name: `${asset.name}_regen.png`, bytes: buffer });
        if (result.success && result.localPath) {
          await window.studioAssets.replaceImage({ assetId: asset.id, sourceFilePath: result.localPath });
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
    const target = asset.sourcePath || asset.filePath;
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    const result = await window.electronAPI.openPath(target);
    if (!result.success) {
      toast.error(result.error || "打开失败");
    }
  };

  const handleOpenFolder = async () => {
    const target = asset.sourcePath || asset.filePath;
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    const dir = target.substring(0, target.lastIndexOf("/")) || target;
    const result = await window.electronAPI.openPath(dir);
    if (!result.success) {
      toast.error(result.error || "打开失败");
    }
  };

  const handleAddImage = async () => {
    if (!window.studioAssets?.selectImageFile || !window.studioAssets?.addImage) {
      toast.error("当前环境不支持添加图片");
      return;
    }
    const filePath = await window.studioAssets.selectImageFile();
    if (!filePath) return;

    const imageName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "新图片";

    const result = await window.studioAssets.addImage({
      assetId: asset.id,
      imageName: imageName.trim(),
      sourceFilePath: filePath,
    });
    if (result?.images) {
      const newImgs: AssetImage[] = [];
      if (asset.previewUrl || asset.thumbnailUrl) {
        newImgs.push({ name: "主图", filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
      }
      newImgs.push(...result.images);
      setImages(newImgs);
      setCurrentIndex(newImgs.length - 1);
      toast.success(`已添加图片「${imageName.trim()}」`);
    } else {
      toast.error("添加失败");
    }
  };

  const handleReplaceImage = async () => {
    if (!window.studioAssets?.selectImageFile || !window.studioAssets?.replaceImage) {
      toast.error("当前环境不支持更换图片");
      return;
    }
    const filePath = await window.studioAssets.selectImageFile();
    if (!filePath) return;
    const result = await window.studioAssets.replaceImage({ assetId: asset.id, sourceFilePath: filePath });
    if (result) {
      // 更新主图显示
      const newImgs = [...images];
      if (newImgs.length > 0 && newImgs[0].name === "主图") {
        newImgs[0] = { name: "主图", filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl };
      }
      setImages(newImgs);
      toast.success("主图已更换");
    } else {
      toast.error("更换失败");
    }
  };

  const handleRemoveImage = async (img: AssetImage, idx: number) => {
    if (idx === 0 && img.name === "主图") {
      toast.error("不能删除主图");
      return;
    }
    if (!window.studioAssets?.removeImage) return;
    const result = await window.studioAssets.removeImage({ assetId: asset.id, imageFilePath: img.filePath });
    if (result) {
      const newImgs = images.filter((_, i) => i !== idx);
      setImages(newImgs);
      setCurrentIndex(Math.min(currentIndex, newImgs.length - 1));
      toast.success("已删除");
    }
  };

  const handleRenameImage = async (img: AssetImage, idx: number) => {
    if (idx === 0 && img.name === "主图") return;
    if (!window.studioAssets?.renameImage) return;
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
    const result = await window.studioAssets.renameImage({ assetId: asset.id, imageFilePath: img.filePath, newName: newName.trim() });
    if (result) {
      const newImgs = [...images];
      newImgs[idx] = { ...newImgs[idx], name: newName.trim() };
      setImages(newImgs);
      toast.success("已重命名");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="studio-asset-detail-dialog h-[92vh] !w-[90vw] !max-w-[90vw] overflow-hidden p-0">
        <DialogHeader className="studio-asset-detail-header border-b border-border px-5 py-4">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-primary" />
            <span className="truncate">{displayName}</span>
            <Badge variant="outline" className="ml-1">{TYPE_LABEL[asset.type]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,420px)_1fr] gap-0">
          {/* 左侧：图片/音频预览 */}
          <div className="studio-asset-detail-preview border-r border-border bg-muted/20 p-4">
            <div className="relative">
              {asset.type === "audio" ? (
                <div className="space-y-3 rounded-lg border border-border bg-background/80 p-4 shadow-inner">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                      <Music2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">{displayName}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">说话内容</div>
                      <div className="mt-0.5 text-sm leading-6 text-foreground">{spokenText || "暂无口播词句"}</div>
                    </div>
                  </div>
                  <div className="studio-audio-waveform studio-audio-waveform-large" aria-hidden="true">
                    {waveformBars.map((height, index) => (
                      <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
                    ))}
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    {audioSrc ? (
                      <audio controls src={audioSrc} className="w-full" />
                    ) : (
                      <div className="text-xs text-muted-foreground">暂无可播放的音频地址</div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div className="col-span-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          const filePath = asset.sourcePath || asset.filePath;
                          if (!filePath) { toast.error("无音频文件路径"); return; }
                          if (!window.ttsRuntime?.request) { toast.error("TTS 后端未就绪"); return; }
                          toast.info("正在识别说话内容...");
                          try {
                            const res = await window.ttsRuntime.request({ method: "POST", path: "/transcribe", body: { audio_path: filePath } }) as { text?: string };
                            if (res?.text && descRef.current) {
                              descRef.current.value = res.text;
                              setRecognizedText(res.text);
                              // 自动保存到资产库
                              if (window.studioAssets?.update) {
                                await window.studioAssets.update({ id: asset.id, updates: { description: res.text } });
                              }
                              toast.success("识别完成并已保存");
                            } else {
                              toast.error("未识别到内容");
                            }
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "识别失败");
                          }
                        }}
                      >
                        ✨ 智能生成说话内容
                      </Button>
                    </div>
                  </div>
                </div>
              ) : hasImagePreview ? (
                <div className="relative">
                  <Carousel key={images.length} className="w-full" opts={{ startIndex: currentIndex }}>
                    <CarouselContent>
                      {images.map((img, idx) => (
                        <CarouselItem key={img.filePath || idx}>
                          <div className="aspect-square overflow-hidden rounded-lg border border-border bg-background">
                            <img
                              src={img.url}
                              alt={img.name}
                              className="h-full w-full object-contain"
                              draggable={false}
                            />
                          </div>
                          {/* 图片名称 + 操作 */}
                          <div className="mt-2 flex items-center justify-between px-1">
                            <span className="truncate text-xs text-muted-foreground">{img.name}</span>
                            {idx > 0 || img.name !== "主图" ? (
                              <div className="flex gap-1">
                                <button
                                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => handleRemoveImage(img, idx)}
                                  title="删除"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {images.length > 1 && (
                      <>
                        <CarouselPrevious className="left-2" />
                        <CarouselNext className="right-2" />
                      </>
                    )}
                  </Carousel>
                  {/* 图片计数指示器 */}
                  {images.length > 1 && (
                    <div className="mt-1 flex justify-center gap-1">
                      {images.map((_, idx) => (
                        <div
                          key={idx}
                          className={`h-1.5 w-1.5 rounded-full ${idx === currentIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background text-muted-foreground">
                  <Icon className="h-12 w-12 opacity-40" />
                  <span className="text-xs">暂无预览图</span>
                </div>
              )}
            </div>

            {/* 添加图片按钮 */}
            {asset.type === "audio" ? null : (
              <>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={handleAddImage}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  添加图片
                </Button>
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={handleReplaceImage}>
                  <ImageIcon className="mr-2 h-3.5 w-3.5" />
                  更换主图
                </Button>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="default" size="sm" onClick={handleRegenerate}>
                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                    重新出图
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyText("出图提示词", promptRef.current?.value || descRef.current?.value || regenerationPrompt)}>
                    <Clipboard className="mr-2 h-3.5 w-3.5" />
                    复制出图提示词
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenSource}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    查看图片
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenFolder}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    打开本地文件夹
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* 右侧：表单 */}
          <ScrollArea className="max-h-[calc(92vh-72px)] [&>[data-radix-scroll-area-viewport]>div]:!block [&_[data-orientation=vertical]]:bg-transparent">
            <div className="space-y-3 p-5">
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">名字</div>
                <input
                  ref={nameRef}
                  className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  defaultValue={displayName}
                />
              </section>
              <section className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{asset.type === "audio" ? "说话内容" : "描述"}</div>
                <Textarea
                  key={`desc-${detail.id}-${detail.description?.length ?? 0}`}
                  ref={descRef}
                  defaultValue={(asset.type === "audio" ? spokenText : detail.description?.trim()) || ""}
                  placeholder={asset.type === "audio" ? "暂无口播词句" : "暂无描述"}
                  className="min-h-[80px] resize-none bg-muted/20 text-xs leading-5"
                />
              </section>
              {asset.type !== "audio" ? (
                <>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">出图提示词</div>
                    <Textarea
                      key={`prompt-${detail.id}-${detail.prompt?.length ?? 0}`}
                      ref={promptRef}
                      defaultValue={detail.prompt?.trim() || ""}
                      placeholder="暂无出图提示词"
                      className="min-h-[80px] resize-none bg-muted/20 text-xs leading-5"
                    />
                  </section>
                  <section className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">设定</div>
                    <Textarea
                      key={`setting-${detail.id}-${detail.setting?.length ?? 0}`}
                      ref={settingRef}
                      defaultValue={detail.setting?.trim() || ""}
                      placeholder="暂无设定"
                      className="min-h-[200px] resize-none bg-muted/20 text-xs leading-5"
                    />
                  </section>
                </>
              ) : (
                <section className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">来源</div>
                  <div className="min-h-[96px] break-all rounded-md border border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {asset.sourcePath || asset.filePath || "暂无来源路径"}
                  </div>
                </section>
              )}
              <Button className="w-full" onClick={handleSave}>保存</Button>
              <Button variant="destructive" className="w-full" onClick={handleDelete}>删除</Button>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function buildAssetRegenerationPrompt(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  return [asset.prompt, asset.setting, asset.description]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
}
