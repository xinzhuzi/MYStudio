import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StoryboardTrailerScenesPanelProps } from "../storyboard-trailer-scenes-panel";
import { StoryboardTrailerScenesPanel } from "../storyboard-trailer-scenes-panel";

type SplitScenesTrailerTabProps = Omit<StoryboardTrailerScenesPanelProps, "headerActions"> & {
  isGeneratingPrompts: boolean;
  onAutoGeneratePrompts: () => void;
};

export function SplitScenesTrailerTab({
  isGenerating,
  isGeneratingPrompts,
  onAutoGeneratePrompts,
  ...trailerPanelProps
}: SplitScenesTrailerTabProps) {
  return (
    <StoryboardTrailerScenesPanel
      {...trailerPanelProps}
      isGenerating={isGenerating}
      headerActions={(
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
      )}
    />
  );
}
