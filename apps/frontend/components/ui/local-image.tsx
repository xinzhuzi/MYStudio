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

interface LocalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: string;
}

export function LocalImage({ src, fallback, className, alt, ...props }: LocalImageProps) {
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

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={handleError}
      {...props}
    />
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
