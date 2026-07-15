import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { StylePicker } from "@/components/ui/style-picker";
import { CinematographyProfilePicker } from "@/components/ui/cinematography-profile-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ImageResolution = "1K" | "2K" | "4K";
type VideoResolution = "480p" | "720p" | "1080p";
type ImageGenerationMode = "single" | "merged";

interface StoryboardConfigToolbarProps {
  styleId: string;
  onStyleChange: (styleId: string) => void;
  cinematographyProfileId?: string;
  onCinematographyProfileChange?: (profileId: string) => void;
  aspectRatio: "16:9" | "9:16";
  onAspectRatioChange: (aspectRatio: "16:9" | "9:16") => void;
  imageResolution: ImageResolution;
  onImageResolutionChange: (resolution: ImageResolution) => void;
  videoResolution: VideoResolution;
  onVideoResolutionChange: (resolution: VideoResolution) => void;
  imageGenerationMode?: ImageGenerationMode;
  onImageGenerationModeChange?: (mode: ImageGenerationMode) => void;
  styleTokens?: string[];
  disabled?: boolean;
}

export function StoryboardConfigToolbar({
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
  disabled = false,
}: StoryboardConfigToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/30 border">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">视觉风格:</span>
        <StylePicker value={styleId} onChange={onStyleChange} disabled={disabled} />
      </div>

      {onCinematographyProfileChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">摄影风格:</span>
          <CinematographyProfilePicker
            value={cinematographyProfileId || ""}
            onChange={onCinematographyProfileChange}
            disabled={disabled}
            styleId={styleId || undefined}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">画面比例:</span>
        <div className="flex rounded-md border overflow-hidden">
          <button
            type="button"
            disabled={disabled}
            aria-pressed={aspectRatio === "16:9"}
            onClick={() => onAspectRatioChange("16:9")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
              aspectRatio === "16:9" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          ><Monitor className="h-3.5 w-3.5" />横屏</button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={aspectRatio === "9:16"}
            onClick={() => onAspectRatioChange("9:16")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-l",
              aspectRatio === "9:16" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          ><Smartphone className="h-3.5 w-3.5" />竖屏</button>
        </div>
      </div>

      <Select value={imageResolution} onValueChange={onImageResolutionChange} disabled={disabled}>
        <SelectTrigger aria-label="图片分辨率" className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="1K" className="text-xs">标准 (1K)</SelectItem>
          <SelectItem value="2K" className="text-xs">高清 (2K)</SelectItem>
          <SelectItem value="4K" className="text-xs">超清 (4K)</SelectItem>
        </SelectContent>
      </Select>

      <Select value={videoResolution} onValueChange={onVideoResolutionChange} disabled={disabled}>
        <SelectTrigger aria-label="视频分辨率" className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="480p" className="text-xs">标准 (480P)</SelectItem>
          <SelectItem value="720p" className="text-xs">高清 (720P)</SelectItem>
          <SelectItem value="1080p" className="text-xs">高品质 (1080P)</SelectItem>
        </SelectContent>
      </Select>

      {imageGenerationMode && onImageGenerationModeChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">图片生成方式:</span>
          <div className="flex rounded-md border overflow-hidden">
            <button type="button" disabled={disabled} aria-pressed={imageGenerationMode === "single"} onClick={() => onImageGenerationModeChange("single")} className={cn("px-3 py-1.5 text-xs", imageGenerationMode === "single" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>单图生成</button>
            <button type="button" disabled={disabled} aria-pressed={imageGenerationMode === "merged"} onClick={() => onImageGenerationModeChange("merged")} className={cn("px-3 py-1.5 text-xs border-l", imageGenerationMode === "merged" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>合并生成</button>
          </div>
        </div>
      )}

      <div className="flex-1 text-xs text-muted-foreground/70 truncate">
        {styleTokens?.slice(0, 2).join(", ")}...
      </div>
    </div>
  );
}
