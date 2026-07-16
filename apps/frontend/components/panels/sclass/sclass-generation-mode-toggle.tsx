import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

type SClassGenerationMode = "group" | "single";

type SClassGenerationModeToggleProps = {
  generationMode: SClassGenerationMode;
  groupCount: number;
  sceneCount: number;
  isBatchCalibrationDisabled: boolean;
  onGenerationModeChange: (mode: SClassGenerationMode) => void;
  onBatchCalibrate: () => void;
  onRegroup: () => void;
};

export function SClassGenerationModeToggle({
  generationMode,
  groupCount,
  sceneCount,
  isBatchCalibrationDisabled,
  onGenerationModeChange,
  onBatchCalibrate,
  onRegroup,
}: SClassGenerationModeToggleProps) {
  return (
    <div className="flex items-center gap-2 pb-2">
      <span className="text-xs text-muted-foreground">视频生成模式:</span>
      <div className="flex rounded-md border overflow-hidden">
        <button
          type="button"
          onClick={() => onGenerationModeChange("group")}
          className={cn(
            "px-3 py-1.5 text-xs",
            generationMode === "group" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          )}
        >分组生成 ({groupCount} 组)</button>
        <button
          type="button"
          onClick={() => onGenerationModeChange("single")}
          className={cn(
            "px-3 py-1.5 text-xs border-l",
            generationMode === "single" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          )}
        >单镜生成 ({sceneCount} 镜)</button>
      </div>
      {generationMode === "group" && (
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={isBatchCalibrationDisabled}
            onClick={onBatchCalibrate}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            批量校准
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onRegroup}
          >重新分组</Button>
        </div>
      )}
    </div>
  );
}
