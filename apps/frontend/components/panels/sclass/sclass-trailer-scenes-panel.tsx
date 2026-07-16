import type { ComponentProps, ReactNode } from "react";
import { Clapperboard, Loader2, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SplitScene } from "@/stores/director-store";
import { StoryboardConfigToolbar } from "../director/storyboard-config-toolbar";

type TrailerToolbarProps = Pick<
  ComponentProps<typeof StoryboardConfigToolbar>,
  | "styleId"
  | "onStyleChange"
  | "aspectRatio"
  | "onAspectRatioChange"
  | "imageResolution"
  | "onImageResolutionChange"
  | "videoResolution"
  | "onVideoResolutionChange"
  | "styleTokens"
>;

export type SClassTrailerScenesPanelProps = TrailerToolbarProps & {
  trailerScenes: SplitScene[];
  isGenerating: boolean;
  renderSceneCard: (scene: SplitScene) => ReactNode;
  onDeleteScene: (sceneId: number) => void;
  onClearTrailer: () => void;
  onGenerateVideo: (sceneId: number) => void | Promise<void>;
};

export function SClassTrailerScenesPanel({
  trailerScenes,
  isGenerating,
  renderSceneCard,
  onDeleteScene,
  onClearTrailer,
  onGenerateVideo,
  styleId,
  onStyleChange,
  aspectRatio,
  onAspectRatioChange,
  imageResolution,
  onImageResolutionChange,
  videoResolution,
  onVideoResolutionChange,
  styleTokens,
}: SClassTrailerScenesPanelProps) {
  const handleClearTrailer = () => {
    trailerScenes.forEach((scene) => onDeleteScene(scene.id));
    onClearTrailer();
    toast.success(`已清空 ${trailerScenes.length} 个预告片分镜`);
  };
  const handleGenerateTrailerVideos = () => {
    toast.info(`开始生成 ${trailerScenes.length} 个预告片视频...`);
    trailerScenes.forEach((scene) => {
      if (scene.imageDataUrl && scene.videoStatus !== "completed") {
        void onGenerateVideo(scene.id);
      }
    });
  };

  if (trailerScenes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Clapperboard className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p>预告片功能</p>
        <p className="mt-1 text-xs">请在左侧「剧本」面板中的「预告片」标签页生成预告片</p>
        <p className="mt-1 text-xs">挑选的分镜将在此显示并可进行图片/视频生成</p>
      </div>
    );
  }

  const totalDuration = trailerScenes.reduce((sum, scene) => sum + (scene.duration || 5), 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">预告片分镜</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {trailerScenes.length} 个分镜
          </span>
          <span className="text-xs text-muted-foreground">预计 {totalDuration} 秒</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              disabled={isGenerating}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              清空分镜
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认清空预告片分镜</AlertDialogTitle>
              <AlertDialogDescription>
                这将删除所有 {trailerScenes.length} 个预告片分镜（包括已生成的图片和视频）。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearTrailer}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                确认清空
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <StoryboardConfigToolbar
        styleId={styleId}
        onStyleChange={onStyleChange}
        aspectRatio={aspectRatio}
        onAspectRatioChange={onAspectRatioChange}
        imageResolution={imageResolution}
        onImageResolutionChange={onImageResolutionChange}
        videoResolution={videoResolution}
        onVideoResolutionChange={onVideoResolutionChange}
        styleTokens={styleTokens}
        disabled={isGenerating}
      />

      <div className="flex flex-col gap-3">{trailerScenes.map(renderSceneCard)}</div>

      <div className="flex gap-2 pt-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleGenerateTrailerVideos}
                disabled={isGenerating}
                className="flex-1"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    生成预告片视频 ({trailerScenes.length})
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>为预告片分镜生成视频</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <p>💡 预告片分镜与主分镜共享数据，修改会同步。点击每个分镜下方的文字区域可编辑提示词。</p>
      </div>
    </>
  );
}
