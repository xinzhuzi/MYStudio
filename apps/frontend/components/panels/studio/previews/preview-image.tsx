import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { toPreviewSrc } from "./preview-src";
import { useRevealWhenSettled } from "./interaction-defer";

/**
 * 节点预览统一 <img>:加载失败(死链/scheme 未注册)时落到占位卡片,
 * 不再静默空白——QC 一眼可见。(08-24 审查 P2-7)
 */
export function PreviewImage({
  src,
  alt,
  className,
  fallbackLabel = "图片不可用",
  onLoad,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  onLoad?: (image: HTMLImageElement) => void;
  /** eager=true 绕过 loading=lazy(5s 门闸场景:门闸已管加载时机,lazy 在
   * overflow-y-auto 网格中会致 Chromium 可见性判定失灵,全部 pending)。 */
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // 交互门闸:拖拽/滑动/缩放进行中不挂 <img>(零请求零解码),静止 1s 后
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
  return (
    <img
      src={toPreviewSrc(src)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
}
