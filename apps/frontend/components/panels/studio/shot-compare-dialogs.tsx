// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 分镜版本对对比入口(09-15 teman-absorption P1b):
 * - ShotImageCompareDialog:本镜关键帧 帧一 vs 帧二(图,ABCompare 滑帘+放大镜);
 * - ShotVideoCompareDialog:单镜视频 当前版 vs 上一版(videoCandidates 版本史,
 *   ABVideoCompare 同步对比,probeVideo=主进程 ffprobe 桥判帧对齐)。
 * 数据源结论(探查):09-03 生成记录弹窗随图片工作室退役(09-10),现役版本对
 * =分镜 keyframes(图)与 videoCandidates(单镜视频);兄弟落位分镜面板目录。
 */

import { useCallback, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { ABCompare } from "@/components/ui/ab-compare";
import { ABVideoCompare, type ABVideoMeta } from "@/components/ui/ab-video-compare";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { effectiveKeyframes } from "@/lib/studio/keyframes";
import type { StoryboardItem } from "@/types/studio";
import type { VideoCandidate } from "@/types/studio-production-types";

function CompareOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[998] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      data-shot-compare-overlay
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col gap-3 rounded-lg border border-border/50 bg-card p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <button
            type="button"
            aria-label="关闭对比"
            onClick={onClose}
            className="rounded-full border border-border/40 bg-background/80 p-2 text-foreground transition-colors hover:bg-background"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** 关键帧两帧对比(帧一 vs 帧二):帧不足 2 时不渲染(调用方守门) */
export function ShotImageCompareDialog({
  storyboard,
  open,
  onClose,
}: {
  storyboard: StoryboardItem;
  open: boolean;
  onClose: () => void;
}) {
  const frames = useMemo(
    () => effectiveKeyframes(storyboard).filter((frame) => frame.mediaRef?.path).slice(0, 2),
    [storyboard],
  );
  if (!open || frames.length < 2) return null;
  return (
    <CompareOverlay
      title={`S${String(storyboard.index).padStart(2, "0")} 关键帧对比`}
      onClose={onClose}
    >
      <ABCompare
        urlA={toPreviewSrc(frames[0]!.mediaRef!.path)}
        urlB={toPreviewSrc(frames[1]!.mediaRef!.path)}
        labelA="第 1 帧"
        labelB="第 2 帧"
        height={480}
      />
    </CompareOverlay>
  );
}

/** 候选版本号(id 形如 h3-<shotId>-<N>;取不出回退时间序) */
function candidateVersionLabel(candidate: VideoCandidate, ordinal: number): string {
  const match = /-(\d+)$/.exec(candidate.id);
  return match ? `第 ${match[1]} 版` : `较早一版(${ordinal + 1})`;
}

/**
 * 单镜视频版本对:当前成片(mediaRef)vs 最近一个历史候选。
 * probeVideo 注入主进程 ffprobe 桥(仅桌面+项目内视频可用;缺失时对比器
 * 自动降级「按时间对齐(估)」,不弹错)。
 */
export function ShotVideoCompareDialog({
  projectId,
  storyboard,
  candidates,
  open,
  onClose,
}: {
  projectId?: string;
  storyboard: StoryboardItem;
  candidates: VideoCandidate[];
  open: boolean;
  onClose: () => void;
}) {
  const pair = useMemo(() => {
    const currentPath = storyboard.mediaRef?.kind === "video" ? storyboard.mediaRef.path : undefined;
    if (!currentPath) return null;
    const history = candidates
      .filter((candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId && candidate.filePath)
      .sort((left, right) => right.createdAt - left.createdAt);
    // 当前版若即最新候选,对比对象取次新;当前版不在候选史里(如手迁)则取最新
    const previous = history[0]?.filePath === currentPath ? history[1] : history[0];
    if (!previous?.filePath) return null;
    return { currentPath, previousPath: previous.filePath, previous };
  }, [candidates, storyboard]);
  if (!open || !pair) return null;

  // probeVideo 身份须稳定(useCallback):ABVideoCompare 的换源 effect 依赖该
  // 函数身份,漂移会把「面板重渲染」误判成换源——滑帘/进度/播放态归零、
  // 同步循环被杀(store 刷新/后台任务回写都会触发面板重渲染)。
  const probeVideo = useCallback(
    (url: string): Promise<ABVideoMeta | null> => {
      if (!projectId) return Promise.resolve(null);
      const bridge = typeof window !== "undefined" ? window.shotKeyframes : undefined;
      if (!bridge || !url.startsWith("project-file://")) return Promise.resolve(null);
      return bridge.probeVideo({ schemaVersion: 1, projectId, videoUrl: url }).then((reply) =>
        reply.success
          ? {
              durationS: reply.durationS,
              ...(reply.fps !== undefined ? { fps: reply.fps } : {}),
              ...(reply.frameCount !== undefined
                ? { frameCount: reply.frameCount, frameCountEstimated: reply.frameCountEstimated }
                : {}),
            }
          : null,
      );
    },
    [projectId],
  );

  return (
    <CompareOverlay
      title={`S${String(storyboard.index).padStart(2, "0")} 视频对比上一版`}
      onClose={onClose}
    >
      <ABVideoCompare
        urlA={toPreviewSrc(pair.previousPath)}
        urlB={toPreviewSrc(pair.currentPath)}
        labelA={candidateVersionLabel(pair.previous, 0)}
        labelB="当前版"
        probeVideo={projectId ? probeVideo : undefined}
        height={440}
      />
    </CompareOverlay>
  );
}

/** 分镜卡版本对入口可用性:图=帧≥2;视频=当前成片+至少一条历史候选 */
export function shotCompareAvailability(
  storyboard: StoryboardItem,
  videoCandidates: VideoCandidate[],
): { frames: boolean; video: boolean } {
  const frames = effectiveKeyframes(storyboard).filter((frame) => frame.mediaRef?.path);
  const currentPath = storyboard.mediaRef?.kind === "video" ? storyboard.mediaRef.path : undefined;
  const history = videoCandidates.filter(
    (candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId && candidate.filePath,
  );
  const hasPrevious = currentPath
    ? history.some((candidate) => candidate.filePath !== currentPath) || history.length >= 2
    : history.length >= 2;
  return { frames: frames.length >= 2, video: Boolean(currentPath) && hasPrevious };
}
