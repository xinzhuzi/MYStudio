import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Clipboard,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Music2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";

const waveformBars = [42, 68, 50, 84, 46, 72, 58, 92, 54, 76, 48, 66, 40, 60, 36, 70];

interface StudioAssetDetailPreviewPaneProps {
  asset: StudioAssetSummary;
  images: AssetImage[];
  currentIndex: number;
  spokenText: string;
  audioSrc: string;
  Icon: LucideIcon;
  onCarouselApi: (api: CarouselApi) => void;
  onTranscribe: () => void | Promise<void>;
  onRemoveImage: (image: AssetImage, index: number) => void | Promise<void>;
  onAddImage: () => void | Promise<void>;
  onReplaceImage: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  onCopyPrompt: () => void | Promise<void>;
  onOpenSource: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
}

export function StudioAssetDetailPreviewPane({
  asset,
  images,
  currentIndex,
  spokenText,
  audioSrc,
  Icon,
  onCarouselApi,
  onTranscribe,
  onRemoveImage,
  onAddImage,
  onReplaceImage,
  onRegenerate,
  onCopyPrompt,
  onOpenSource,
  onOpenFolder,
}: StudioAssetDetailPreviewPaneProps) {
  const hasImagePreview = asset.type !== "audio" && images.length > 0;

  return (
    <div className="studio-asset-detail-preview border-r border-border bg-muted/90 p-4">
      <div className="relative">
        {asset.type === "audio" ? (
          <div className="space-y-3 rounded-lg border border-border bg-background/90 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                <Music2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">说话内容</div>
                <div className="mt-0.5 text-sm leading-6 text-foreground">
                  {spokenText || "暂无口播词句"}
                </div>
              </div>
            </div>
            <div className="studio-audio-waveform studio-audio-waveform-large" aria-hidden="true">
              {waveformBars.map((height, index) => (
                <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
              ))}
            </div>
            <div className="rounded-md border border-border bg-muted/90 p-3">
              {audioSrc ? (
                <audio controls src={audioSrc} className="w-full" />
              ) : (
                <div className="text-xs text-muted-foreground">暂无可播放的音频地址</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div className="col-span-2">
                <Button variant="outline" size="sm" className="w-full" onClick={onTranscribe}>
                  ✨ 智能生成说话内容
                </Button>
              </div>
            </div>
          </div>
        ) : hasImagePreview ? (
          <div className="relative">
            <Carousel
              key={images.length}
              className="w-full"
              opts={{ startIndex: currentIndex }}
              setApi={onCarouselApi}
            >
              <CarouselContent>
                {images.map((image, index) => (
                  <CarouselItem key={image.filePath || index}>
                    <div className="aspect-square overflow-hidden rounded-lg border border-border bg-background">
                      <img
                        src={image.url}
                        alt={image.name}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="truncate text-xs text-muted-foreground">{image.name}</span>
                      {index > 0 || image.name !== "主图" ? (
                        <div className="flex gap-1">
                          <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onRemoveImage(image, index)}
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
            {images.length > 1 && (
              <div className="mt-1 flex justify-center gap-1">
                {images.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 w-1.5 rounded-full ${index === currentIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
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

      {asset.type === "audio" ? null : (
        <>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onAddImage}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            添加图片
          </Button>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={onReplaceImage}>
            <ImageIcon className="mr-2 h-3.5 w-3.5" />
            更换主图
          </Button>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="default" size="sm" onClick={onRegenerate}>
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              重新出图
            </Button>
            <Button variant="outline" size="sm" onClick={onCopyPrompt}>
              <Clipboard className="mr-2 h-3.5 w-3.5" />
              复制出图提示词
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenSource}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              查看图片
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenFolder}>
              <FolderOpen className="mr-2 h-3.5 w-3.5" />
              打开本地文件夹
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
