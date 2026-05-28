"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { Box, Film, Map, Music2, UserCircle } from "lucide-react";

const assetCardVisibilityStyle = {
  contentVisibility: "auto",
  containIntrinsicSize: "172px 232px",
} satisfies CSSProperties;

const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: Film,
  audio: Music2,
} as const;

const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "素材",
  audio: "音频",
} as const;

const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;

function getDisplayName(asset: StudioAssetSummary) {
  const rawName = asset.name || asset.sourcePath || asset.filePath || "未命名素材";
  const fileName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}

function getAssetCaption(asset: StudioAssetSummary) {
  const text = asset.description || asset.prompt || asset.setting || asset.sourcePath || asset.filePath || "";
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return asset.type === "audio" ? "本地口播音频" : "本地制作素材";
  return compact.split(/[\\/]/).filter(Boolean).pop() || compact;
}

function getSourceLabel(asset: StudioAssetSummary) {
  return asset.source === "toonflow-runtime" ? "项目存储" : "工作台";
}

function getAudioLine(asset: StudioAssetSummary) {
  return getDisplayName(asset)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const waveformBars = [34, 56, 42, 74, 48, 86, 60, 38, 68, 50, 78, 44, 62, 36];

function StudioAssetCardComponent({
  asset,
  onOpen,
}: {
  asset: StudioAssetSummary;
  onOpen?: (asset: StudioAssetSummary) => void;
}) {
  const Icon = TYPE_ICON[asset.type];
  const displayName = getDisplayName(asset);
  const caption = getAssetCaption(asset);
  const sourceLabel = getSourceLabel(asset);
  const audioLine = getAudioLine(asset);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoadPreview, setShouldLoadPreview] = useState(!asset.thumbnailUrl);

  useEffect(() => {
    if (!asset.thumbnailUrl) {
      setShouldLoadPreview(true);
      return;
    }
    setShouldLoadPreview(false);
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoadPreview(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoadPreview(true);
        observer.disconnect();
      },
      { rootMargin: "360px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [asset.thumbnailUrl]);

  return (
    <button
      type="button"
      ref={cardRef}
      className="studio-asset-card group flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-[border-color,box-shadow,transform] hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={assetCardVisibilityStyle}
      title={[displayName, asset.filePath, asset.sourcePath].filter(Boolean).join("\n")}
      onClick={() => onOpen?.(asset)}
    >
      <div className="studio-asset-preview relative overflow-hidden bg-muted">
        {asset.type === "audio" ? (
          <div className="studio-asset-audio-preview flex h-full flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">Voice Sample</span>
              <Music2 className="h-4 w-4 text-primary" />
            </div>
            <div className="studio-audio-waveform" aria-hidden="true">
              {waveformBars.map((height, index) => (
                <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
              ))}
            </div>
            <div className="truncate text-[11px] font-medium text-foreground">{audioLine}</div>
          </div>
        ) : asset.thumbnailUrl && shouldLoadPreview ? (
          <img
            src={asset.thumbnailUrl}
            alt={displayName}
            className="studio-asset-thumbnail h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : asset.thumbnailUrl ? (
          <div className="h-full w-full bg-muted/70" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className="h-9 w-9 text-muted-foreground/40" />
          </div>
        )}
        <Badge
          variant="secondary"
          className={cn(
            "studio-asset-badge absolute left-1.5 top-1.5 h-5 px-1.5 text-[10px]",
            asset.source === "toonflow-runtime" ? "bg-background/85" : "bg-primary/85 text-primary-foreground",
          )}
        >
          {TYPE_LABEL[asset.type]}
        </Badge>
      </div>

      <div className="studio-asset-body flex min-h-0 flex-1 flex-col px-2.5 py-2">
        <div className="studio-asset-title text-xs font-semibold leading-4 text-foreground">{displayName}</div>
        <div className="studio-asset-caption mt-1 text-[10px] leading-4 text-muted-foreground">{caption}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="studio-asset-source truncate text-[10px]">{sourceLabel}</span>
          <span className="studio-asset-kind text-[10px]">{TYPE_LABEL[asset.type]}</span>
        </div>
      </div>
    </button>
  );
}

export const StudioAssetCard = memo(StudioAssetCardComponent);
