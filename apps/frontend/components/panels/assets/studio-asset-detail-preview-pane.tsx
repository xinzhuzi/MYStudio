import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import {
  Clipboard,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Loader2,
  Music2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
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
  /** 10-19 用户令:点击轮播图开全屏缩放预览(MediaPreviewModal) */
  onImageClick?: (index: number) => void;
  onTranscribe: () => void | Promise<void>;
  onRemoveImage: (image: AssetImage, index: number) => void | Promise<void>;
  onAddImage: () => void | Promise<void>;
  onReplaceImage: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  /** 10-19 图生图·画风转换:取轮播当前图作唯一参考,qwen-image-2-1 本地渠道整体转画风。 */
  onImageToImage?: () => void | Promise<void>;
  /** 画风转换相位("generating"|"done"|"failed"|null);在跑时 Loader2+相位文案并禁点。 */
  i2iPhase?: string | null;
  /** 画风转换相位文案(运行态按钮 title 全文,如「正在转换 主角 的画风...」)。 */
  i2iMessage?: string;
  /** 一键生成相位(互斥:任一生成相位在跑即禁点)。 */
  generatePhase?: string | null;
  /** 三轨且有图才可转(role/scene/tool 且轮播非空);缺省 true 由装配方守门。 */
  canImageToImage?: boolean;
  onCopyPrompt: () => void | Promise<void>;
  onOpenSource: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  /** R4 族聚显:条目级删除可见性(族兄弟只读条目不显示删除);缺省恒可删
   *  (10-19 用户裁定:主图亦可删——含首位主图)。 */
  isImageRemovable?: (image: AssetImage, index: number) => boolean;
}

export function StudioAssetDetailPreviewPane({
  asset,
  images,
  currentIndex,
  spokenText,
  audioSrc,
  Icon,
  onCarouselApi,
  onImageClick,
  onTranscribe,
  onRemoveImage,
  onAddImage,
  onReplaceImage,
  onRegenerate,
  onImageToImage,
  i2iPhase,
  i2iMessage,
  generatePhase,
  canImageToImage = true,
  onCopyPrompt,
  onOpenSource,
  onOpenFolder,
  isImageRemovable,
}: StudioAssetDetailPreviewPaneProps) {
  const hasImagePreview = asset.type !== "audio" && images.length > 0;
  const imageToImageDisabled = !!i2iPhase || !!generatePhase || !canImageToImage;
  const imageToImageTitle = !canImageToImage
    ? "仅角色/场景/道具三轨且有图资产可转画风"
    : generatePhase
      ? "图片生成中，请稍候"
      : i2iPhase
        ? (i2iMessage || "正在转换画风，请稍候")
        : undefined;
  const i2iPhaseLabel = i2iPhase === "done"
    ? "画风转换完成"
    : i2iPhase === "failed"
      ? "画风转换失败"
      : "正在转换画风…";

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
                    <div
                      className="relative aspect-square overflow-hidden rounded-lg border border-border bg-background"
                      onClick={() => onImageClick?.(index)}
                      role={onImageClick ? "button" : undefined}
                      style={onImageClick ? { cursor: "zoom-in" } : undefined}
                    >
                      <img
                        src={image.url}
                        alt={image.name}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                      <ResolutionBadge src={image.url} />
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="truncate text-xs text-muted-foreground">{image.name}</span>
                      {/* 10-19 用户裁定:主图亦可删——缺省(未注入 isImageRemovable)恒显示删除钮 */}
                      {(isImageRemovable ? isImageRemovable(image, index) : true) ? (
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
            更换图片
          </Button>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="default" size="sm" onClick={onRegenerate}>
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              重新出图
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onImageToImage}
              disabled={imageToImageDisabled}
              title={imageToImageTitle}
            >
              {i2iPhase ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-3.5 w-3.5" />
              )}
              {i2iPhase ? i2iPhaseLabel : "图生图"}
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
