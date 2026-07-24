import type { ReactNode } from "react";
import { ArrowLeft, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SplitScene } from "@/stores/director-store";
import { StoryboardConfigToolbar } from "./storyboard-config-toolbar";
import {
  StoryboardMergedGenerationControls,
  type StoryboardFrameMode,
  type StoryboardReferenceStrategy,
} from "./storyboard-merged-generation-controls";
import { SplitScenesPromptWarning } from "./split-scenes-prompt-warning";
import { SceneVoiceBatchToolbar } from "./scene-voice-batch-toolbar";
import { SplitSceneVideoActionBar } from "./split-scene-video-action-bar";

type ImageResolution = "1K" | "2K" | "4K";
type VideoResolution = "480p" | "720p" | "1080p";
type ImageGenerationMode = "single" | "merged";

export interface SplitScenesEditingPanelProps {
  scenes: SplitScene[];
  renderSceneCard: (scene: SplitScene) => ReactNode;
  isGenerating: boolean;
  isGeneratingPrompts: boolean;
  onAutoGeneratePrompts: () => void;
  onBack: () => void;
  styleId: string;
  onStyleChange: (styleId: string) => void;
  cinematographyProfileId?: string;
  onCinematographyProfileChange: (profileId: string) => void;
  aspectRatio: "16:9" | "9:16";
  onAspectRatioChange: (aspectRatio: "16:9" | "9:16") => void;
  imageResolution: ImageResolution;
  onImageResolutionChange: (resolution: ImageResolution) => void;
  videoResolution: VideoResolution;
  onVideoResolutionChange: (videoResolution: VideoResolution) => void;
  imageGenerationMode: ImageGenerationMode;
  onImageGenerationModeChange: (mode: ImageGenerationMode) => void;
  styleTokens: string[];
  frameMode: StoryboardFrameMode;
  onFrameModeChange: (mode: StoryboardFrameMode) => void;
  refStrategy: StoryboardReferenceStrategy;
  onRefStrategyChange: (strategy: StoryboardReferenceStrategy) => void;
  useExemplar: boolean;
  onUseExemplarChange: (useExemplar: boolean) => void;
  isMergedRunning: boolean;
  onMergedGenerate: (
    mode: StoryboardFrameMode,
    strategy: StoryboardReferenceStrategy,
    useExemplar: boolean,
  ) => void;
  onStopMerged: () => void;
  hasMissingPrompt: boolean;
  onAddBlank: () => void;
  onGenerateVideos: () => void;
}

export function SplitScenesEditingPanel({
  scenes,
  renderSceneCard,
  isGenerating,
  isGeneratingPrompts,
  onAutoGeneratePrompts,
  onBack,
  styleId,
  onStyleChange,
  cinematographyProfileId,
  onCinematographyProfileChange,
  aspectRatio,
  onAspectRatioChange,
  imageResolution,
  onImageResolutionChange,
  videoResolution,
  onVideoResolutionChange,
  imageGenerationMode,
  onImageGenerationModeChange,
  styleTokens,
  frameMode,
  onFrameModeChange,
  refStrategy,
  onRefStrategyChange,
  useExemplar,
  onUseExemplarChange,
  isMergedRunning,
  onMergedGenerate,
  onStopMerged,
  hasMissingPrompt,
  onAddBlank,
  onGenerateVideos,
}: SplitScenesEditingPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">分镜编辑</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {scenes.length} 个分镜
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onAutoGeneratePrompts}
            disabled={isGeneratingPrompts || isGenerating}
            className="hidden h-7 px-2 text-xs"
          >
            {isGeneratingPrompts ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1 text-yellow-500" />
            )}
            AI 自动填写提示词
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={onBack}
            className="hidden h-7 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            重新生成
          </Button>
        </div>
      </div>

      <StoryboardConfigToolbar
        styleId={styleId}
        onStyleChange={onStyleChange}
        cinematographyProfileId={cinematographyProfileId}
        onCinematographyProfileChange={onCinematographyProfileChange}
        aspectRatio={aspectRatio}
        onAspectRatioChange={onAspectRatioChange}
        imageResolution={imageResolution}
        onImageResolutionChange={onImageResolutionChange}
        videoResolution={videoResolution}
        onVideoResolutionChange={onVideoResolutionChange}
        imageGenerationMode={imageGenerationMode}
        onImageGenerationModeChange={onImageGenerationModeChange}
        styleTokens={styleTokens}
        disabled={isGenerating}
      />

      {imageGenerationMode === 'merged' && (
        <StoryboardMergedGenerationControls
          frameMode={frameMode}
          onFrameModeChange={onFrameModeChange}
          refStrategy={refStrategy}
          onRefStrategyChange={onRefStrategyChange}
          useExemplar={useExemplar}
          onUseExemplarChange={onUseExemplarChange}
          isGenerating={isGenerating}
          isMergedRunning={isMergedRunning}
          sceneCount={scenes.length}
          onGenerate={onMergedGenerate}
          onStop={onStopMerged}
        />
      )}

      <SplitScenesPromptWarning hasMissingPrompt={hasMissingPrompt} />

      <SceneVoiceBatchToolbar scenes={scenes} />

      <div className="flex flex-col gap-3">
        {scenes.map(renderSceneCard)}

        <button
          type="button"
          onClick={onAddBlank}
          disabled={isGenerating}
          className={cn(
            "w-full rounded-lg border-2 border-dashed border-muted-foreground/25",
            "flex items-center justify-center gap-2 py-6",
            "text-sm text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5",
            "transition-colors cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Plus className="h-5 w-5" />
          <span>添加空白分镜</span>
        </button>
      </div>

      <SplitSceneVideoActionBar
        scenes={scenes}
        isGenerating={isGenerating}
        onGenerateVideos={onGenerateVideos}
      />

      <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
        <p>💡 点击每个分镜下方的文字区域可编辑视频生成提示词。悬停在分镜上可以删除不需要的分镜。</p>
      </div>
    </>
  );
}
