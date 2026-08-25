// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 图片分辨率角标(1K/2K/4K)
 *
 * 尺寸探测两级:受管 scheme(project-file/asset-file/local-image/file)优先走
 * 主进程 `image-probe-size` IPC(只读文件头,零整图拉取/解码——图片密集
 * 视图 82 张 4K 同发曾把应用冻死,2026-08-25 根修);IPC 不可用/不认识该
 * 格式时回退 `new Image()` 探测(同现状)。同一 URL 全局只探测一次(模块级
 * 缓存,失败也缓存,视频/坏路径不反复探测)。探测 URL 统一剥离 ?thumb=1
 * (资产缩略图是 200×200 独立文件)。未知/失败/过小(<700 长边)一律渲染
 * null,不占位、不闪烁。
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ImageResolution } from "@/lib/ai/image-size-presets";
import { classifyImageResolution, toResolutionProbeSrc } from "@/lib/image-resolution";

interface ImagePixelSize {
  width: number;
  height: number;
}

const sizeCache = new Map<string, ImagePixelSize | null>();
const inflightProbes = new Map<string, Promise<ImagePixelSize | null>>();

/** 走主进程文件头解析的 scheme;其余(http/data/blob)只能 Image 探测。 */
const BACKEND_PROBE_SCHEME = /^(?:project-file:|asset-file:|local-image:|file:)/;

async function probeViaBackend(url: string): Promise<ImagePixelSize | null> {
  if (!BACKEND_PROBE_SCHEME.test(url)) return null;
  const probe = typeof window !== "undefined" ? window.imageProbe?.size : undefined;
  if (typeof probe !== "function") return null;
  try {
    const size = await probe(url);
    return size && size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null;
  } catch {
    return null;
  }
}

function probeViaImageElement(url: string): Promise<ImagePixelSize | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 对外探测入口(带缓存/去重):分镜瓦片 4K 预判等非角标场景复用,勿绕行 new Image()。 */
export function probeImagePixelSize(src: string): Promise<ImagePixelSize | null> {
  return probeImageSize(src);
}

function probeImageSize(src: string): Promise<ImagePixelSize | null> {
  const cached = sizeCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = inflightProbes.get(src);
  if (inflight) return inflight;
  const probe = (async () => {
    const backend = await probeViaBackend(src);
    if (backend) return backend;
    return probeViaImageElement(src);
  })().then((size) => {
    sizeCache.set(src, size);
    return size;
  });
  inflightProbes.set(src, probe);
  void probe.finally(() => inflightProbes.delete(src));
  return probe;
}

function classifyCached(src: string): ImageResolution | null {
  const cached = sizeCache.get(src);
  if (!cached) return null;
  return classifyImageResolution(cached.width, cached.height);
}

/** 仅供测试:清空模块级探测缓存。 */
export function __resetImageResolutionCacheForTests() {
  sizeCache.clear();
  inflightProbes.clear();
}

export function useImageResolution(src?: string): ImageResolution | null {
  const [resolution, setResolution] = useState<ImageResolution | null>(() =>
    src ? classifyCached(src) : null,
  );

  useEffect(() => {
    if (!src) {
      setResolution(null);
      return;
    }
    const cached = sizeCache.get(src);
    if (cached !== undefined) {
      setResolution(classifyCached(src));
      return;
    }
    let cancelled = false;
    void probeImageSize(src).then(() => {
      if (!cancelled) setResolution(classifyCached(src));
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolution;
}

export function ResolutionBadge({ src, className }: { src?: string; className?: string }) {
  const probeSrc = src ? toResolutionProbeSrc(src) : undefined;
  const resolution = useImageResolution(probeSrc);
  if (!resolution) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-1 top-1 z-[1] rounded bg-background/80 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground select-none",
        className,
      )}
    >
      {resolution}
    </span>
  );
}
