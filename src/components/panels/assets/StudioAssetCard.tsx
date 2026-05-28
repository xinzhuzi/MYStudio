"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { Box, Map, Music2, UserCircle } from "lucide-react";

const assetCardVisibilityStyle = {
  contentVisibility: "auto",
  containIntrinsicSize: "150px 180px",
} satisfies CSSProperties;

const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: Box,
  audio: Music2,
} as const;

const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;

function getDisplayName(asset: StudioAssetSummary) {
  const rawName = asset.name || asset.sourcePath || asset.filePath || "未命名";
  const fileName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}

function StudioAssetCardComponent({
  asset,
  onOpen,
}: {
  asset: StudioAssetSummary;
  onOpen?: (asset: StudioAssetSummary) => void;
}) {
  const Icon = TYPE_ICON[asset.type];
  const displayName = getDisplayName(asset);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(!asset.thumbnailUrl);

  useEffect(() => {
    if (!asset.thumbnailUrl) { setShouldLoad(true); return; }
    setShouldLoad(false);
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShouldLoad(true); return; }
    const obs = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShouldLoad(true); obs.disconnect(); } }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [asset.thumbnailUrl]);

  return (
    <button
      type="button"
      ref={cardRef}
      className="group relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted text-left transition-[border-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={assetCardVisibilityStyle}
      title={displayName}
      onClick={() => onOpen?.(asset)}
    >
      {/* 图片铺满 */}
      {asset.thumbnailUrl && shouldLoad ? (
        <img
          src={asset.thumbnailUrl}
          alt={displayName}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : !asset.thumbnailUrl ? (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className="h-10 w-10 text-muted-foreground/30" />
        </div>
      ) : null}

      {/* 底部名字叠加 */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
        <div className="truncate text-xs font-medium text-white">{displayName}</div>
      </div>
    </button>
  );
}

export const StudioAssetCard = memo(StudioAssetCardComponent);
