export type StoryboardAspectRatio = "16:9" | "9:16";
export type StoryboardImageResolution = "1K" | "2K" | "4K";
export type StoryboardVideoResolution = "480p" | "720p" | "1080p";
export type StoryboardImageGenerationMode = "single" | "merged";

export interface StoryboardConfigToolbarProps {
  styleId: string;
  onStyleChange: (styleId: string) => void;
  cinematographyProfileId?: string;
  onCinematographyProfileChange?: (profileId: string) => void;
  aspectRatio: StoryboardAspectRatio;
  onAspectRatioChange: (aspectRatio: StoryboardAspectRatio) => void;
  imageResolution: StoryboardImageResolution;
  onImageResolutionChange: (resolution: StoryboardImageResolution) => void;
  videoResolution: StoryboardVideoResolution;
  onVideoResolutionChange: (resolution: StoryboardVideoResolution) => void;
  imageGenerationMode?: StoryboardImageGenerationMode;
  onImageGenerationModeChange?: (mode: StoryboardImageGenerationMode) => void;
  styleTokens?: string[];
  disabled?: boolean;
}

export type StoryboardTrailerToolbarProps = Pick<
  StoryboardConfigToolbarProps,
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
