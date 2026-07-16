import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SplitScene } from "@/stores/director-store";
import { Loader2, Play } from "lucide-react";

type SplitSceneVideoActionBarProps = {
  scenes: SplitScene[];
  isGenerating: boolean;
  onGenerateVideos: () => void;
};

export function SplitSceneVideoActionBar({
  scenes,
  isGenerating,
  onGenerateVideos,
}: SplitSceneVideoActionBarProps) {
  const scenesWithImages = scenes.filter((scene) => scene.imageDataUrl).length;
  const scenesNeedVideo = scenes.filter(
    (scene) => scene.imageDataUrl && (scene.videoStatus === "idle" || scene.videoStatus === "failed"),
  ).length;
  const noImages = scenesWithImages === 0;

  return (
    <div className="flex gap-2 pt-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onGenerateVideos}
              disabled={isGenerating || scenes.length === 0 || noImages}
              className="flex-1"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  生成视频 ({scenesNeedVideo}/{scenes.length})
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {noImages ? (
              <p>请先为分镜生成图片，再生成视频</p>
            ) : (
              <p>{scenesWithImages} 个分镜已有图片，{scenesNeedVideo} 个待生成视频</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
