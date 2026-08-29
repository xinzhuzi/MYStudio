import { useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toPreviewSrc } from "./preview-src";
import { useRevealWhenSettled } from "./interaction-defer";
import { ImagePreviewModal } from "@/components/features/media/media-preview-modal";

/**
 * 节点预览统一 <img>:加载失败(死链/scheme 未注册)时落到占位卡片,
 * 不再静默空白——QC 一眼可见。(08-24 审查 P2-7)
 *
 * previewable=true 时右下角常驻「展示」角标,点击用 ImagePreviewModal 全屏
 * 看原图(自动剥 ?thumb=1 缩略变体);弹窗经 portal 挂 body,不受宿主
 * transform/overflow 影响。角标 stopPropagation,不触发瓦片自身的点击导航。
 */
export function PreviewImage({
  src,
  alt,
  className,
  fallbackLabel = "图片不可用",
  onLoad,
  eager = false,
  previewable = false,
  previewSrc,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  onLoad?: (image: HTMLImageElement) => void;
  /** eager=true 绕过 loading=lazy(5s 门闸场景:门闸已管加载时机,lazy 在
   * overflow-y-auto 网格中会致 Chromium 可见性判定失灵,全部 pending)。 */
  eager?: boolean;
  /** 内置「展示」大图入口(08-30 裁定:节点图链路看图一律可放大看原图) */
  previewable?: boolean;
  /** 大图地址;缺省取 src 剥 ?thumb=1(消费方普遍传缩略变体) */
  previewSrc?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 交互门闸:拖拽/滑动/缩放进行中不挂 <img>(零请求零解码),静止 5s 后
  // 才开始加载;粘性放行,已显示的图交互期间不卸载不闪烁。
  const revealed = useRevealWhenSettled(toPreviewSrc(src));
  if (!revealed) {
    return (
      <div
        className={cn("bg-muted/30", className)}
        data-preview-image-deferred={alt}
      />
    );
  }
  if (failed) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/30 text-muted-foreground",
          className,
        )}
        data-preview-image-failed={alt}
      >
        <ImageOff className="h-5 w-5 text-muted-foreground/50" />
        <span className="px-1 text-center text-[9px] leading-3">{fallbackLabel}</span>
      </div>
    );
  }
  const image = (
    <img
      src={toPreviewSrc(src)}
      alt={alt}
      className={previewable ? cn("h-full w-full", className) : className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
  if (!previewable) return image;
  const fullSrc = previewSrc ?? toPreviewSrc(src).replace(/\?thumb=1$/, "");
  return (
    <span className="relative block h-full w-full">
      {image}
      <button
        type="button"
        aria-label={`展示大图 ${alt}`}
        title="全屏查看原图"
        onClick={(event) => {
          event.stopPropagation();
          setPreviewOpen(true);
        }}
        className="absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 text-foreground transition-colors hover:bg-background"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
      {previewOpen
        ? createPortal(
            <ImagePreviewModal imageUrl={fullSrc} isOpen onClose={() => setPreviewOpen(false)} />,
            document.body,
          )
        : null}
    </span>
  );
}
