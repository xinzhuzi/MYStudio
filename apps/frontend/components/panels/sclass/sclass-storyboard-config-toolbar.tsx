import { cn } from "@/lib/utils";
import { StylePicker } from "@/components/ui/style-picker";
import { CinematographyProfilePicker } from "@/components/ui/cinematography-profile-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SClassAspectRatio } from "@/stores/sclass-store";

const SCLASS_ASPECT_RATIOS: Array<{ value: SClassAspectRatio; label: string }> = [
  { value: "16:9", label: "横屏 16:9" },
  { value: "9:16", label: "竖屏 9:16" },
  { value: "4:3", label: "经典 4:3" },
  { value: "3:4", label: "人像 3:4" },
  { value: "21:9", label: "宽屏 21:9" },
  { value: "1:1", label: "方形 1:1" },
];

interface SClassStoryboardConfigToolbarProps {
  styleId: string;
  onStyleChange: (styleId: string) => void;
  cinematographyProfileId: string;
  onCinematographyProfileChange: (profileId: string) => void;
  aspectRatio: SClassAspectRatio;
  onAspectRatioChange: (aspectRatio: SClassAspectRatio) => void;
  imageResolution: "1K" | "2K" | "4K";
  onImageResolutionChange: (resolution: "1K" | "2K" | "4K") => void;
  videoResolution: "480p" | "720p" | "1080p";
  onVideoResolutionChange: (resolution: "480p" | "720p" | "1080p") => void;
  imageGenerationMode: "single" | "merged";
  onImageGenerationModeChange: (mode: "single" | "merged") => void;
  styleTokens?: string[];
  disabled?: boolean;
}

export function SClassStoryboardConfigToolbar({
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
}: SClassStoryboardConfigToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/30 border">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">视觉风格:</span>
        <StylePicker value={styleId} onChange={onStyleChange} disabled={disabled} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">摄影风格:</span>
        <CinematographyProfilePicker
          value={cinematographyProfileId}
          onChange={onCinematographyProfileChange}
          disabled={disabled}
          styleId={styleId}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">画幅比:</span>
        <Select value={aspectRatio} onValueChange={onAspectRatioChange} disabled={disabled}>
          <SelectTrigger aria-label="S-Class 画幅比" className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCLASS_ASPECT_RATIOS.map((ratio) => (
              <SelectItem key={ratio.value} value={ratio.value} className="text-xs">{ratio.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">图片生成方式:</span>
        <div className="flex rounded-md border overflow-hidden">
          <button type="button" disabled={disabled} aria-pressed={imageGenerationMode === "single"} onClick={() => onImageGenerationModeChange("single")} className={cn("px-3 py-1.5 text-xs", imageGenerationMode === "single" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>单图生成</button>
          <button type="button" disabled={disabled} aria-pressed={imageGenerationMode === "merged"} onClick={() => onImageGenerationModeChange("merged")} className={cn("px-3 py-1.5 text-xs border-l", imageGenerationMode === "merged" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>合并生成</button>
        </div>
      </div>
      <div className="flex-1 text-xs text-muted-foreground/70 truncate">{styleTokens?.slice(0, 2).join(", ")}...</div>
    </div>
  );
}
