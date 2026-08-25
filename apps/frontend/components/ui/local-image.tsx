// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * LocalImage Component
 * Handles displaying images that may be stored locally (local-image://) or remotely
 * The local-image:// protocol is handled by Electron's custom protocol handler
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";

interface LocalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: string;
  /** 开启后在图片右上角叠加 1K/2K/4K 分辨率角标(默认关闭,关闭时渲染结构与纯 <img> 一致) */
  resolutionBadge?: boolean;
}

export function LocalImage({ src, fallback, className, alt, resolutionBadge = false, ...props }: LocalImageProps) {
  const [error, setError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(normalizeImageSrc(src));

  const handleError = () => {
    if (!error && fallback) {
      setError(true);
      setCurrentSrc(normalizeImageSrc(fallback));
    } else {
      setError(true);
    }
  };

  useEffect(() => {
    setCurrentSrc(normalizeImageSrc(src));
    setError(false);
  }, [src]);

  if (error && !fallback) {
    return (
      <div 
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground text-xs",
          className
        )}
        style={props.style}
      >
        图片加载失败
      </div>
    );
  }

  const image = (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={handleError}
      {...props}
    />
  );

  if (!resolutionBadge) return image;

  return (
    <span className="relative flex h-full w-full">
      {image}
      <ResolutionBadge src={currentSrc} />
    </span>
  );
}

function normalizeImageSrc(value: string) {
  if (hasUrlScheme(value) || value.startsWith("//")) return value;
  if (isWindowsAbsolutePath(value)) {
    return `file:///${encodeURI(value.replace(/\\/g, "/"))}`;
  }
  if (isMacFilesystemPath(value)) {
    return `file://${encodeURI(value)}`;
  }
  return value;
}

function hasUrlScheme(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isWindowsAbsolutePath(value: string) {
  return /^[a-z]:[\\/]/i.test(value);
}

function isMacFilesystemPath(value: string) {
  return /^\/(?:Users|Volumes|private|tmp|var|Applications|Library|opt)\//.test(value);
}
