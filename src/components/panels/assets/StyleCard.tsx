// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * StyleCard - 风格卡片组件
 * 默认风格和自定义风格共用
 */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { LocalImage } from "@/components/ui/local-image";
import type { StyleCategory } from "@/lib/constants/visual-styles";

// 风格分类色块（与 StylePicker 一致）
const CATEGORY_COLORS: Record<string, string> = {
  '3d': 'bg-blue-500/20 text-blue-600',
  '2d': 'bg-green-500/20 text-green-600',
  'real': 'bg-amber-500/20 text-amber-600',
  'stop_motion': 'bg-purple-500/20 text-purple-600',
};

const CATEGORY_LABELS: Record<string, string> = {
  '3d': '3D',
  '2d': '2D',
  'real': '真人',
  'stop_motion': '定格',
};

interface StyleCardProps {
  name: string;
  description?: string;
  category?: StyleCategory;     // 内置风格分类（用于色块显示）
  thumbnailSrc?: string;
  referenceImages?: string[];   // 自定义风格参考图
  isCustom?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

const styleCardVisibilityStyle = {
  contentVisibility: "auto",
  containIntrinsicSize: "260px 220px",
} satisfies CSSProperties;

function StyleCardComponent({
  name,
  description,
  category,
  thumbnailSrc,
  referenceImages,
  isCustom = false,
  isSelected = false,
  onClick,
  onDoubleClick,
}: StyleCardProps) {
  // 自定义风格用第一张参考图
  const customImage = isCustom ? referenceImages?.[0] : undefined;
  const displayImage = customImage || thumbnailSrc;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoadImage, setShouldLoadImage] = useState(!displayImage);

  useEffect(() => {
    if (!displayImage) {
      setShouldLoadImage(true);
      return;
    }
    if (shouldLoadImage) return;
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoadImage(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoadImage(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayImage, shouldLoadImage]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "group relative flex flex-col rounded-lg border bg-card overflow-hidden cursor-pointer transition-[border-color,box-shadow] hover:shadow-md",
        isSelected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-primary/50"
      )}
      style={styleCardVisibilityStyle}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* 缩略图区域 */}
      <div className="relative aspect-[4/3] bg-muted overflow-hidden">
        {displayImage && shouldLoadImage ? (
          <LocalImage
            src={displayImage}
            alt={name}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : displayImage ? (
          <div className="h-full w-full bg-muted/70" />
        ) : category ? (
          /* 内置风格：色块占位 + 分类标签 */
          <div className={cn(
            "w-full h-full flex flex-col items-center justify-center",
            CATEGORY_COLORS[category] || 'bg-muted/30'
          )}>
            <div className="text-lg font-bold">{CATEGORY_LABELS[category] || category}</div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            无参考图
          </div>
        )}
        {/* 自定义标记 */}
        {isCustom && (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] bg-primary/80 text-primary-foreground">
            自定义
          </div>
        )}
      </div>

      {/* 信息区域 */}
      <div className="p-2 space-y-0.5">
        <div className="text-sm font-medium truncate">{name}</div>
        {description && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

export const StyleCard = memo(StyleCardComponent);
