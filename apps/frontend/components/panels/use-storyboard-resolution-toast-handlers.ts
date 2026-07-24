import { useCallback } from "react";
import { toast } from "sonner";

export type StoryboardImageResolution = "1K" | "2K" | "4K";
export type StoryboardVideoResolution = "480p" | "720p" | "1080p";

type SetStoryboardConfig = (updates: {
  resolution?: StoryboardImageResolution;
  videoResolution?: StoryboardVideoResolution;
}) => void;

export function useStoryboardResolutionToastHandlers(setStoryboardConfig: SetStoryboardConfig) {
  const handleImageResolutionChange = useCallback((resolution: StoryboardImageResolution) => {
    setStoryboardConfig({ resolution });
    toast.success(`图片分辨率已切换为 ${resolution}`);
  }, [setStoryboardConfig]);

  const handleVideoResolutionChange = useCallback((videoResolution: StoryboardVideoResolution) => {
    setStoryboardConfig({ videoResolution });
    toast.success(`视频分辨率已切换为 ${videoResolution}`);
  }, [setStoryboardConfig]);

  return { handleImageResolutionChange, handleVideoResolutionChange };
}
