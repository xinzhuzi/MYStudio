// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  Image as ImageIcon,
  Loader2,
  Play,
  RotateCw,
  Sparkles,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";

type FrameGenerationTarget = "start" | "end" | "video";

interface ShotFrameGenerationSectionProps {
  startImageUrl?: string;
  endImageUrl?: string;
  hasVideo: boolean;
  previewMode: FrameGenerationTarget;
  processingType: FrameGenerationTarget | null;
  isAngleSwitching: boolean;
  onPreviewFrame: (type: FrameGenerationTarget) => void;
  onGenerateImage?: (type: "start" | "end") => void | Promise<void>;
  onGenerateVideo?: () => void | Promise<void>;
  onAngleSwitchClick: (type: "start" | "end") => void;
}

export function ShotFrameGenerationSection({
  startImageUrl,
  endImageUrl,
  hasVideo,
  previewMode,
  processingType,
  isAngleSwitching,
  onPreviewFrame,
  onGenerateImage,
  onGenerateVideo,
  onAngleSwitchClick,
}: ShotFrameGenerationSectionProps) {
  const hasStartImage = !!startImageUrl;
  const hasEndImage = !!endImageUrl;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="w-3 h-3" />
          <span>关键帧</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div
            className={cn(
              "rounded-lg border overflow-hidden cursor-pointer transition-all",
              previewMode === "start" ? "border-primary" : "border-border"
            )}
            onClick={() => onPreviewFrame("start")}
          >
            <div className="aspect-video bg-muted relative">
              {hasStartImage ? (
                <>
                  <img src={startImageUrl} className="w-full h-full object-cover" />
                  <ResolutionBadge src={startImageUrl} />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-muted-foreground/30" />
                </div>
              )}
              {processingType === "start" && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-foreground animate-spin" />
                </div>
              )}
            </div>
            <div className="p-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px]">起始帧</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.("start");
                  }}
                  disabled={processingType === "start" || !onGenerateImage}
                >
                  <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                  {hasStartImage ? "重新" : "生成"}
                </Button>
              </div>
              {hasStartImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-full text-[10px] text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAngleSwitchClick("start");
                  }}
                  disabled={isAngleSwitching}
                >
                  <RotateCw className="w-2.5 h-2.5 mr-0.5" />
                  视角
                </Button>
              )}
            </div>
          </div>

          <div
            className={cn(
              "rounded-lg border overflow-hidden cursor-pointer transition-all",
              previewMode === "end" ? "border-primary" : "border-border"
            )}
            onClick={() => onPreviewFrame("end")}
          >
            <div className="aspect-video bg-muted relative">
              {hasEndImage ? (
                <>
                  <img src={endImageUrl} className="w-full h-full object-cover" />
                  <ResolutionBadge src={endImageUrl} />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground/50">可选</span>
                </div>
              )}
              {processingType === "end" && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-foreground animate-spin" />
                </div>
              )}
            </div>
            <div className="p-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px]">结束帧</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.("end");
                  }}
                  disabled={processingType === "end" || !onGenerateImage}
                >
                  <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                  {hasEndImage ? "重新" : "生成"}
                </Button>
              </div>
              {hasEndImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-full text-[10px] text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAngleSwitchClick("end");
                  }}
                  disabled={isAngleSwitching}
                >
                  <RotateCw className="w-2.5 h-2.5 mr-0.5" />
                  视角
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Video className="w-3 h-3" />
          <span>视频</span>
        </div>

        <div
          className={cn(
            "rounded-lg border overflow-hidden",
            previewMode === "video" ? "border-primary" : "border-border"
          )}
        >
          <div
            className="aspect-video bg-muted relative cursor-pointer"
            onClick={() => onPreviewFrame("video")}
          >
            {hasVideo ? (
              <>
                <img src={startImageUrl} className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="w-4 h-4 text-foreground ml-0.5" />
                  </div>
                </div>
                <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-success rounded text-[9px] text-white font-mono">
                  已生成
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="w-6 h-6 text-muted-foreground/30" />
              </div>
            )}
            {processingType === "video" && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-foreground animate-spin" />
              </div>
            )}
          </div>

          <div className="p-2">
            <Button
              className="w-full h-7 text-xs"
              variant={hasVideo ? "outline" : "default"}
              onClick={onGenerateVideo}
              disabled={!hasStartImage || processingType === "video" || !onGenerateVideo}
            >
              {processingType === "video" ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Video className="w-3 h-3 mr-1.5" />
                  {hasVideo ? "重新生成视频" : "生成视频"}
                </>
              )}
            </Button>
            {!hasStartImage && (
              <p className="text-[9px] text-muted-foreground text-center mt-1">
                请先生成起始帧
              </p>
            )}
            {hasStartImage && !hasEndImage && (
              <p className="text-[9px] text-muted-foreground text-center mt-1">
                将使用单图模式 (Image-to-Video)
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
