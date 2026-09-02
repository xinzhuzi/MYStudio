// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 图片真实像素尺寸角标(例如 1920×1080)
 *
 * 尺寸探测两级:受管 scheme(project-file/asset-file/local-image/file)优先走
 * 主进程 `image-probe-size` IPC(只读文件头,零整图拉取/解码——图片密集
 * 视图 82 张高分辨率图片同发曾把应用冻死,2026-08-25 根修);IPC 不可用/不认识该
 * 格式时回退 `new Image()` 探测(同现状)。同一 URL 全局只探测一次(模块级
 * 缓存,失败也缓存,视频/坏路径不反复探测)。探测 URL 统一剥离 ?thumb=1
 * (资产缩略图是 200×200 独立文件)。探测成功(宽高均大于 0)即显示真实
 * 像素尺寸;未知/失败仍渲染 null,不占位、不闪烁。
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toResolutionProbeSrc } from "@/lib/image-resolution";
import { whenInteractionSettled } from "@/hooks/interaction-defer";

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

/** 对外探测入口(带缓存/去重):分镜瓦片分辨率预判等非角标场景复用,勿绕行 new Image()。 */
export function probeImagePixelSize(src: string): Promise<ImagePixelSize | null> {
  return probeImageSize(src);
}

function probeImageSize(src: string): Promise<ImagePixelSize | null> {
  const cached = sizeCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = inflightProbes.get(src);
  if (inflight) return inflight;
  const probe = (async () => {
    // 交互门闸(用户裁定):拖拽/缩放/滚轮期间不发起任何探测——含 IPC 文件头
    // 读取;静止 5s 开闸后才放行。inflight 已先行登记,并发去重不受影响。
    await whenInteractionSettled();
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

/** 仅供测试:清空模块级探测缓存。 */
export function __resetImageResolutionCacheForTests() {
  sizeCache.clear();
  inflightProbes.clear();
}

export function useImagePixelSize(src?: string): ImagePixelSize | null {
  const [size, setSize] = useState<ImagePixelSize | null>(() =>
    src ? sizeCache.get(src) ?? null : null,
  );

  useEffect(() => {
    if (!src) {
      setSize(null);
      return;
    }
    const cached = sizeCache.get(src);
    if (cached !== undefined) {
      setSize(cached);
      return;
    }
    // 未探测过的 src 先清空旧值:探测是异步的(交互门闸下最长延迟数秒),
    // 不清空会在新图上短暂显示上一张图的尺寸。
    setSize(null);
    let cancelled = false;
    void probeImageSize(src).then((nextSize) => {
      if (!cancelled) setSize(nextSize);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return size;
}

export function ResolutionBadge({ src, className }: { src?: string; className?: string }) {
  const probeSrc = src ? toResolutionProbeSrc(src) : undefined;
  const size = useImagePixelSize(probeSrc);
  if (!size) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1 top-1 z-[1] rounded bg-background/80 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground select-none",
        className,
      )}
    >
      {size.width}×{size.height}
    </span>
  );
}
