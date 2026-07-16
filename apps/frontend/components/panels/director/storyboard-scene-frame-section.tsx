"use client";

import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { readImageAsBase64 } from "@/lib/image-storage";
import { type SplitScene } from "@/stores/director-store";
import {
  Download,
  Grid2X2,
  Loader2,
  RotateCw,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePreviewStore } from "@/stores/preview-store";
import { useResolvedImageUrl } from "@/hooks/use-resolved-image-url";
import { CharacterSelector } from "./character-selector";
import { MediaLibrarySelector } from "./media-library-selector";
import { SceneLibrarySelector } from "./scene-library-selector";

export interface StoryboardSceneFrameSectionProps {
  scene: SplitScene;
  onUpdateNeedsEndFrame: (id: number, needsEndFrame: boolean) => void;
  onUpdateEndFrame: (id: number, imageUrl: string | null) => void;
  onUpdateCharacters: (id: number, characterIds: string[]) => void;
  onUpdateCharacterVariationMap?: (id: number, map: Record<string, string>) => void;
  onUpdateSceneReference?: (
    id: number,
    sceneLibraryId?: string,
    viewpointId?: string,
    referenceImage?: string,
    subViewId?: string,
  ) => void;
  onUpdateEndFrameSceneReference?: (
    id: number,
    sceneLibraryId?: string,
    viewpointId?: string,
    referenceImage?: string,
    subViewId?: string,
  ) => void;
  onGenerateEndFrame?: (sceneId: number) => void;
  onRemoveImage?: (sceneId: number) => void;
  onUploadImage?: (sceneId: number, imageDataUrl: string) => void;
  onAngleSwitch?: (sceneId: number, type: "start" | "end") => void;
  onQuadGrid?: (sceneId: number, type: "start" | "end") => void;
  onStopImageGeneration?: (sceneId: number) => void;
  onStopEndFrameGeneration?: (sceneId: number) => void;
  isAngleSwitching?: boolean;
  isQuadGridGenerating?: boolean;
  isGeneratingAny?: boolean;
}

type FrameKind = "start" | "end";

interface FrameActionButtonsProps {
  kind: FrameKind;
  sceneId: number;
  onAngleSwitch?: (sceneId: number, type: FrameKind) => void;
  onQuadGrid?: (sceneId: number, type: FrameKind) => void;
  onDownload: () => void;
  onRemove: () => void;
  isAngleSwitching?: boolean;
  isQuadGridGenerating?: boolean;
}

function FrameActionButtons({
  kind,
  sceneId,
  onAngleSwitch,
  onQuadGrid,
  onDownload,
  onRemove,
  isAngleSwitching,
  isQuadGridGenerating,
}: FrameActionButtonsProps) {
  const label = kind === "start" ? "首帧" : "尾帧";
  return (
    <div
      className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/image:opacity-100 group-hover/endframe:opacity-100 transition-opacity"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onAngleSwitch?.(sceneId, kind);
        }}
        disabled={isAngleSwitching}
        className="p-0.5 rounded bg-black/50 text-white hover:bg-amber-600 disabled:opacity-50"
        title="切换视角"
      >
        <RotateCw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onQuadGrid?.(sceneId, kind);
        }}
        disabled={isQuadGridGenerating}
        className="p-0.5 rounded bg-foreground/20 text-foreground hover:bg-primary/60 disabled:opacity-50"
        title="四宫格生成"
      >
        <Grid2X2 className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onDownload();
        }}
        className="p-0.5 rounded bg-foreground/20 text-foreground hover:bg-primary/60"
        title={`下载${label}`}
      >
        <Download className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onRemove();
        }}
        className="p-0.5 rounded bg-black/50 text-white hover:bg-red-600"
        title={`删除${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function StopGenerationButton({
  sceneId,
  onStop,
  className = "mt-1",
}: {
  sceneId: number;
  onStop?: (sceneId: number) => void;
  className?: string;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onStop?.(sceneId);
      }}
      className={`${className} px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-600 text-white text-[9px] flex items-center gap-0.5 transition-colors`}
      title="停止生成"
    >
      <Square className="h-2.5 w-2.5" />停止
    </button>
  );
}

export function StoryboardSceneFrameSection({
  scene,
  onUpdateNeedsEndFrame,
  onUpdateEndFrame,
  onUpdateCharacters,
  onUpdateCharacterVariationMap,
  onUpdateSceneReference,
  onUpdateEndFrameSceneReference,
  onGenerateEndFrame,
  onRemoveImage,
  onUploadImage,
  onAngleSwitch,
  onQuadGrid,
  onStopImageGeneration,
  onStopEndFrameGeneration,
  isAngleSwitching,
  isQuadGridGenerating,
  isGeneratingAny,
}: StoryboardSceneFrameSectionProps) {
  const [selectedFrameTarget, setSelectedFrameTarget] = useState<FrameKind>("start");
  const endFrameInputRef = useRef<HTMLInputElement>(null);
  const firstFrameInputRef = useRef<HTMLInputElement>(null);
  const { setPreviewItem } = usePreviewStore();
  const effectiveImageUrl = scene.imageDataUrl || scene.imageHttpUrl || "";
  const effectiveEndFrameUrl = scene.endFrameImageUrl || scene.endFrameHttpUrl || "";
  const resolvedImageUrl = useResolvedImageUrl(effectiveImageUrl);
  const resolvedEndFrameUrl = useResolvedImageUrl(effectiveEndFrameUrl);
  const hasImage = Boolean(effectiveImageUrl);
  const hasEndFrame = Boolean(effectiveEndFrameUrl);
  const isImageGenerating = scene.imageStatus === "generating" || scene.imageStatus === "uploading";

  const readUploadedImage = (
    event: React.ChangeEvent<HTMLInputElement>,
    onLoad: (dataUrl: string) => void,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const dataUrl = loadEvent.target?.result;
      if (typeof dataUrl === "string") onLoad(dataUrl);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleFirstFrameUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    readUploadedImage(event, (dataUrl) => {
      onUploadImage?.(scene.id, dataUrl);
      toast.success(`分镜 ${scene.id + 1} 首帧已上传`);
    });
  };

  const handleEndFrameUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    readUploadedImage(event, (dataUrl) => {
      onUpdateEndFrame(scene.id, dataUrl);
      if (!scene.needsEndFrame) onUpdateNeedsEndFrame(scene.id, true);
      toast.success(`分镜 ${scene.id + 1} 尾帧已上传`);
    });
  };

  const handleDownloadImage = async (imageUrl: string, filename: string) => {
    try {
      const source = imageUrl.startsWith("local-image://")
        ? await readImageAsBase64(imageUrl)
        : imageUrl;
      if (!source) throw new Error("无法读取本地图片");
      const response = await fetch(source);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`${filename} 下载完成`);
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("下载失败");
    }
  };

  const renderFrame = (kind: FrameKind) => {
    const isStart = kind === "start";
    const url = isStart ? resolvedImageUrl : resolvedEndFrameUrl;
    const hasFrame = isStart ? hasImage : hasEndFrame;
    const isSelected = selectedFrameTarget === kind;
    const isGeneratingEnd = scene.endFrameStatus === "generating";
    const imageClass = isStart
      ? isSelected
        ? "border-primary border-solid"
        : "border-dashed border-muted-foreground/20 hover:border-primary/50"
      : isSelected
        ? "border-orange-500 border-solid"
        : scene.needsEndFrame
          ? "border-dashed border-orange-500/30 hover:border-orange-500/50"
          : "border-dashed border-blue-400/30 hover:border-blue-400/50";
    return (
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedFrameTarget(kind)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                isSelected
                  ? isStart
                    ? "bg-primary/20 text-primary font-medium"
                    : "bg-orange-500/20 text-orange-500 font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isStart ? "首帧" : "尾帧"}
            </button>
            {!isStart && (
              <button
                onClick={() => onUpdateNeedsEndFrame(scene.id, !scene.needsEndFrame)}
                disabled={isGeneratingAny}
                className={cn(
                  "text-[9px] px-1 py-0.5 rounded transition-colors",
                  scene.needsEndFrame
                    ? "bg-orange-500/20 text-orange-500 hover:bg-orange-500/30"
                    : "bg-muted text-muted-foreground/60 hover:bg-muted/80",
                )}
              >
                {scene.needsEndFrame ? "需要" : "可选"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasFrame && (
              <>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onAngleSwitch?.(scene.id, kind);
                  }}
                  disabled={isAngleSwitching}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 hover:bg-amber-500/30 disabled:opacity-50 flex items-center gap-0.5"
                >
                  <RotateCw className="h-2.5 w-2.5" />视角
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuadGrid?.(scene.id, kind);
                  }}
                  disabled={isQuadGridGenerating}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 flex items-center gap-0.5"
                >
                  <Grid2X2 className="h-2.5 w-2.5" />四宫格
                </button>
              </>
            )}
            {!isStart && !hasFrame && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerateEndFrame?.(scene.id);
                }}
                disabled={isGeneratingAny || isGeneratingEnd}
                className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded disabled:opacity-50",
                  scene.needsEndFrame
                    ? "bg-orange-500/20 text-orange-500 hover:bg-orange-500/30"
                    : "bg-blue-500/20 text-blue-500 hover:bg-blue-500/30",
                )}
              >
                {isGeneratingEnd ? (
                  <span className="flex items-center gap-0.5">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />{scene.endFrameProgress}%
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5"><Sparkles className="h-2.5 w-2.5" />AI生成</span>
                )}
              </button>
            )}
          </div>
        </div>
        <div
          className={cn(
            "aspect-video bg-muted rounded cursor-pointer relative group/image group/endframe overflow-hidden border-2 transition-colors",
            imageClass,
          )}
          onClick={() => {
            setSelectedFrameTarget(kind);
            if (hasFrame && url) {
              setPreviewItem({ type: "image", url, name: `分镜 ${scene.id + 1} ${isStart ? "首帧" : "尾帧"}` });
            } else {
              (isStart ? firstFrameInputRef : endFrameInputRef).current?.click();
            }
          }}
        >
          {hasFrame ? (
            <>
              <img src={url || ""} alt={`分镜 ${scene.id + 1} ${isStart ? "首帧" : "尾帧"}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              <FrameActionButtons
                kind={kind}
                sceneId={scene.id}
                onAngleSwitch={onAngleSwitch}
                onQuadGrid={onQuadGrid}
                onDownload={() => void handleDownloadImage(url || "", `分镜${scene.id + 1}_${isStart ? "首帧" : "尾帧"}.png`)}
                onRemove={() => {
                  if (isStart) {
                    onRemoveImage?.(scene.id);
                    toast.success(`分镜 ${scene.id + 1} 首帧已移除`);
                  } else {
                    onUpdateEndFrame(scene.id, null);
                    toast.success(`分镜 ${scene.id + 1} 尾帧已移除`);
                  }
                }}
                isAngleSwitching={isAngleSwitching}
                isQuadGridGenerating={isQuadGridGenerating}
              />
              {((isStart && scene.imageSource === "ai-generated") || (!isStart && scene.endFrameSource === "ai-generated")) && (
                <span className={cn("absolute bottom-0.5 left-0.5 text-[8px] text-white px-1 rounded", isStart ? "bg-primary" : "bg-orange-500")}>AI</span>
              )}
            </>
          ) : isGeneratingEnd && !isStart ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-orange-500/10">
              <Loader2 className="h-4 w-4 text-orange-500 animate-spin" />
              <span className="text-[10px] text-orange-500">生成中 {scene.endFrameProgress}%</span>
              <StopGenerationButton sceneId={scene.id} onStop={onStopEndFrameGeneration} className="mt-0.5" />
            </div>
          ) : !isStart && scene.needsEndFrame ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-orange-500/5"><span className="text-orange-500 text-lg">◉</span><span className="text-[10px] text-orange-500/70">需要尾帧</span></div>
          ) : (
            <div className={cn("w-full h-full flex flex-col items-center justify-center gap-1", isStart ? "" : "bg-blue-500/5")}>
              <Upload className={cn("h-4 w-4", isStart ? "text-muted-foreground/50" : "text-blue-400/60")} />
              <span className={cn("text-[10px]", isStart ? "text-muted-foreground/50" : "text-blue-400/60")}>{isStart ? "上传" : "上传/生成"}</span>
            </div>
          )}
          {isStart && isImageGenerating && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
              <Loader2 className="h-4 w-4 text-white animate-spin" />
              <span className="text-[10px] text-white">生成中 {scene.imageProgress}%</span>
              <StopGenerationButton sceneId={scene.id} onStop={onStopImageGeneration} />
            </div>
          )}
        </div>
        <input
          ref={isStart ? firstFrameInputRef : endFrameInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={isStart ? handleFirstFrameUpload : handleEndFrameUpload}
        />
      </div>
    );
  };

  return (
    <div className="p-2 space-y-2">
      <div className="flex gap-2">
        {renderFrame("start")}
        {renderFrame("end")}
        <div className="flex flex-col gap-1 justify-end">
          <CharacterSelector
            selectedIds={scene.characterIds || []}
            onChange={(ids) => onUpdateCharacters(scene.id, ids)}
            characterVariationMap={scene.characterVariationMap}
            onChangeVariation={(charId, variationId) => {
              const current = { ...(scene.characterVariationMap || {}) };
              if (variationId) current[charId] = variationId;
              else delete current[charId];
              onUpdateCharacterVariationMap?.(scene.id, current);
            }}
            disabled={isGeneratingAny}
          />
          {onUpdateSceneReference && (
            <SceneLibrarySelector
              sceneId={scene.id}
              selectedSceneLibraryId={scene.sceneLibraryId}
              selectedViewpointId={scene.viewpointId}
              selectedSubViewId={scene.subViewId}
              isEndFrame={false}
              onChange={(sceneLibraryId, viewpointId, referenceImage, subViewId) => onUpdateSceneReference(scene.id, sceneLibraryId, viewpointId, referenceImage, subViewId)}
              disabled={isGeneratingAny}
            />
          )}
          {selectedFrameTarget === "end" && onUpdateEndFrameSceneReference && (
            <SceneLibrarySelector
              sceneId={scene.id}
              selectedSceneLibraryId={scene.endFrameSceneLibraryId}
              selectedViewpointId={scene.endFrameViewpointId}
              selectedSubViewId={scene.endFrameSubViewId}
              isEndFrame={true}
              onChange={(sceneLibraryId, viewpointId, referenceImage, subViewId) => onUpdateEndFrameSceneReference(scene.id, sceneLibraryId, viewpointId, referenceImage, subViewId)}
              disabled={isGeneratingAny}
            />
          )}
          {onUploadImage && (
            <MediaLibrarySelector
              sceneId={scene.id}
              isEndFrame={selectedFrameTarget === "end"}
              onSelect={(imageUrl) => selectedFrameTarget === "start" ? onUploadImage(scene.id, imageUrl) : onUpdateEndFrame(scene.id, imageUrl)}
              disabled={isGeneratingAny}
            />
          )}
        </div>
      </div>
    </div>
  );
}
