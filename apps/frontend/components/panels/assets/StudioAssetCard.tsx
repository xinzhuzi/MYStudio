"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { Box, Film, Map, Music2, UserCircle } from "lucide-react";

const assetCardVisibilityStyle = {
  contentVisibility: "auto",
  containIntrinsicSize: "150px 180px",
} satisfies CSSProperties;

const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: Film,
  audio: Music2,
} as const;

const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;
const AUDIO_WAVEFORM_BARS = [42, 72, 54, 86, 48, 64, 92, 58, 76, 44, 68, 52] as const;

function getDisplayName(asset: StudioAssetSummary) {
  const rawName = asset.name || asset.sourcePath || asset.filePath || "未命名";
  const fileName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}

function getAudioLine(asset: StudioAssetSummary) {
  const text = asset.description?.trim() || getDisplayName(asset);
  return text.replace(/[_-]+/g, " ").trim();
}

function StudioAssetCardComponent({
  asset,
  onOpen,
  selected,
  selectMode,
  onToggleSelect,
}: {
  asset: StudioAssetSummary;
  onOpen?: (asset: StudioAssetSummary) => void;
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelect?: (id: string) => void;
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
      className={`group relative h-full w-full overflow-hidden rounded-lg border bg-muted text-left transition-[border-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
      style={assetCardVisibilityStyle}
      title={displayName}
      onClick={() => selectMode ? onToggleSelect?.(asset.id) : onOpen?.(asset)}
    >
      {/* 多选勾选框 */}
      {selectMode && (
        <div className={`absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-white/70 bg-black/40"}`}>
          {selected && <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
        </div>
      )}
      {asset.type === "audio" ? (
        <div className="studio-asset-preview studio-asset-audio-preview flex h-[132px] flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-primary">
              音频素材
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-full border border-foreground/10 bg-background/45 shadow-inner">
              <Music2 className="h-4 w-4 text-primary" />
            </span>
          </div>
          <div className="studio-audio-waveform" aria-hidden="true">
            {AUDIO_WAVEFORM_BARS.map((height, index) => (
              <span key={`${height}-${index}`} style={{ "--bar-height": `${height}%` } as CSSProperties} />
            ))}
          </div>
          <div className="truncate text-[11px] font-medium text-foreground/80">{getAudioLine(asset)}</div>
        </div>
      ) : asset.thumbnailUrl && shouldLoad ? (
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
