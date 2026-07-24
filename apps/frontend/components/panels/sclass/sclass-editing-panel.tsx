import type { ReactNode } from "react";
import { AlertCircle, ArrowLeft, Loader2, Music, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Character } from "@/stores/character-library-store";
import type { SplitScene } from "@/stores/director-store";
import type { Scene } from "@/stores/scene-store";
import type { SClassAspectRatio, ShotGroup } from "@/stores/sclass-store";
import { SceneVoiceBatchToolbar } from "../director/scene-voice-batch-toolbar";
import {
  StoryboardMergedGenerationControls,
  type StoryboardFrameMode,
  type StoryboardReferenceStrategy,
} from "../director/storyboard-merged-generation-controls";
import type { BatchGenerationProgress } from "./sclass-generation-types";
import { SClassGenerationModeToggle } from "./sclass-generation-mode-toggle";
import { SClassStoryboardConfigToolbar } from "./sclass-storyboard-config-toolbar";
import { ShotGroupCard } from "./shot-group";

type ImageResolution = "1K" | "2K" | "4K";
type VideoResolution = "480p" | "720p" | "1080p";
type ImageGenerationMode = "single" | "merged";
type SClassGenerationMode = "group" | "single";

export interface SClassEditingPanelProps {
  scenes: SplitScene[];
  renderSceneCard: (scene: SplitScene) => ReactNode;
  isGenerating: boolean;
  onBack: () => void;
  styleId: string;
  onStyleChange: (styleId: string) => void;
  cinematographyProfileId: string;
  onCinematographyProfileChange: (profileId: string) => void;
  aspectRatio: SClassAspectRatio;
  onAspectRatioChange: (aspectRatio: SClassAspectRatio) => void;
  imageResolution: ImageResolution;
  onImageResolutionChange: (resolution: ImageResolution) => void;
  videoResolution: VideoResolution;
  onVideoResolutionChange: (videoResolution: VideoResolution) => void;
  imageGenerationMode: ImageGenerationMode;
  onImageGenerationModeChange: (mode: ImageGenerationMode) => void;
  styleTokens?: string[];
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
  sclassGenerationMode: SClassGenerationMode;
  onSClassGenerationModeChange: (mode: SClassGenerationMode) => void;
  shotGroups: ShotGroup[];
  sceneMap: ReadonlyMap<number, SplitScene>;
  isBatchCalibrationDisabled: boolean;
  onBatchCalibrate: () => void;
  onRegroup: () => void;
  onCalibrateGroup: (groupId: string) => void;
  onGenerateGroupVideo: (groupId: string) => void;
  onExtendGroup: (groupId: string) => void;
  onEditGroup: (groupId: string) => void;
  allCharacters: Character[];
  sceneLibrary: Scene[];
  batchProgress: BatchGenerationProgress | null;
  onGenerateGroupVideos: () => void;
  onGenerateVideos: () => void;
  onAbortGeneration: () => void;
}

export function SClassEditingPanel({
  scenes,
  renderSceneCard,
  isGenerating,
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
  sclassGenerationMode,
  onSClassGenerationModeChange,
  shotGroups,
  sceneMap,
  isBatchCalibrationDisabled,
  onBatchCalibrate,
  onRegroup,
  onCalibrateGroup,
  onGenerateGroupVideo,
  onExtendGroup,
  onEditGroup,
  allCharacters,
  sceneLibrary,
  batchProgress,
  onGenerateGroupVideos,
  onGenerateVideos,
  onAbortGeneration,
}: SClassEditingPanelProps) {
  const scenesWithImages = scenes.filter((scene) => scene.imageDataUrl).length;
  const scenesNeedVideo = scenes.filter((scene) => (
    scene.imageDataUrl && (scene.videoStatus === "idle" || scene.videoStatus === "failed")
  )).length;
  const groupsNeedGeneration = shotGroups.filter((group) => (
    group.videoStatus === "idle" || group.videoStatus === "failed"
  )).length;
  const noImages = scenesWithImages === 0;

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
            variant="text"
            size="sm"
            onClick={onBack}
            className="h-7 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            重新生成
          </Button>
        </div>
      </div>

      <SClassStoryboardConfigToolbar
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

      <div className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-muted/20 border">
        <Music className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">音频/运镜: 复用每个分镜的独立开关（对白 / 音效 / 环境声 / 运镜）自动聚合</span>
        <span className="text-xs text-muted-foreground/60">时长上限 15s · Seedance 2.0</span>
      </div>

      {imageGenerationMode === "merged" && (
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

      {scenes.some((scene) => !scene.videoPrompt.trim()) && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <div className="text-xs text-yellow-600 dark:text-yellow-400">
            <p>部分分镜缺少提示词，点击分镜下方的文字区域可编辑。</p>
          </div>
        </div>
      )}

      <SClassGenerationModeToggle
        generationMode={sclassGenerationMode}
        groupCount={shotGroups.length}
        sceneCount={scenes.length}
        isBatchCalibrationDisabled={isBatchCalibrationDisabled}
        onGenerationModeChange={onSClassGenerationModeChange}
        onBatchCalibrate={onBatchCalibrate}
        onRegroup={onRegroup}
      />

      <SceneVoiceBatchToolbar scenes={scenes} />

      {sclassGenerationMode === "group" ? (
        <div className="flex flex-col gap-3">
          {shotGroups.map((group, groupIdx) => {
            const groupScenes = group.sceneIds
              .map((id) => sceneMap.get(id))
              .filter((scene): scene is SplitScene => Boolean(scene));

            return (
              <ShotGroupCard
                key={group.id}
                group={group}
                scenes={groupScenes}
                allScenes={scenes}
                groupIndex={groupIdx}
                isGeneratingAny={isGenerating}
                characters={allCharacters}
                sceneLibrary={sceneLibrary}
                onCalibrateGroup={onCalibrateGroup}
                onGenerateGroupVideo={onGenerateGroupVideo}
                onExtendGroup={onExtendGroup}
                onEditGroup={onEditGroup}
                renderSceneCard={renderSceneCard}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {scenes.map(renderSceneCard)}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  if (sclassGenerationMode === "group") {
                    onGenerateGroupVideos();
                    return;
                  }
                  onGenerateVideos();
                }}
                disabled={isGenerating || scenes.length === 0 || noImages}
                className="flex-1"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {batchProgress
                      ? `生成中 (${batchProgress.completed}/${batchProgress.total})...`
                      : "生成中..."
                    }
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    {sclassGenerationMode === "group"
                      ? `Seedance 2.0 组级生成 (${groupsNeedGeneration}/${shotGroups.length} 组)`
                      : `生成视频 (${scenesNeedVideo}/${scenes.length})`
                    }
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {noImages ? (
                <p>请先为分镜生成图片，再生成视频</p>
              ) : sclassGenerationMode === "group" ? (
                <p>{groupsNeedGeneration} 个组待生成，每组合并多镜头 + @引用 调用 Seedance 2.0，逐组尾帧传递</p>
              ) : (
                <p>{scenesWithImages} 个分镜已有图片，{scenesNeedVideo} 个待生成视频</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isGenerating && sclassGenerationMode === "group" && (
          <Button
            variant="destructive"
            size="lg"
            onClick={onAbortGeneration}
          >
            <Square className="h-4 w-4 mr-2" />
            停止
          </Button>
        )}
      </div>

      <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
        {sclassGenerationMode === "group" ? (
          <p>💡 分组模式：每组 2~4 个镜头合并为一个视频，总时长 ≤15s。点击「重新分组」可重新自动分配。</p>
        ) : (
          <p>💡 单镜模式：每个镜头独立生成一个视频。点击分镜下方的文字区域可编辑提示词。</p>
        )}
      </div>
    </>
  );
}
