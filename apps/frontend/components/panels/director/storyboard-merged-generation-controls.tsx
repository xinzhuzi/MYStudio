import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, Square } from "lucide-react";

export type StoryboardFrameMode = "first" | "last" | "both";
export type StoryboardReferenceStrategy = "cluster" | "minimal" | "none";

type StoryboardMergedGenerationControlsProps = {
  frameMode: StoryboardFrameMode;
  onFrameModeChange: (mode: StoryboardFrameMode) => void;
  refStrategy: StoryboardReferenceStrategy;
  onRefStrategyChange: (strategy: StoryboardReferenceStrategy) => void;
  useExemplar: boolean;
  onUseExemplarChange: (useExemplar: boolean) => void;
  isGenerating: boolean;
  isMergedRunning: boolean;
  sceneCount: number;
  onGenerate: (
    mode: StoryboardFrameMode,
    strategy: StoryboardReferenceStrategy,
    useExemplar: boolean,
  ) => void;
  onStop: () => void;
};

export function StoryboardMergedGenerationControls({
  frameMode,
  onFrameModeChange,
  refStrategy,
  onRefStrategyChange,
  useExemplar,
  onUseExemplarChange,
  isGenerating,
  isMergedRunning,
  sceneCount,
  onGenerate,
  onStop,
}: StoryboardMergedGenerationControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">首/尾帧:</span>
        <div className="flex rounded-md border overflow-hidden">
          <button
            onClick={() => onFrameModeChange("first")}
            className={cn(
              "px-3 py-1.5 text-xs",
              frameMode === "first" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          >仅首帧</button>
          <button
            onClick={() => onFrameModeChange("last")}
            className={cn(
              "px-3 py-1.5 text-xs border-l",
              frameMode === "last" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          >仅尾帧</button>
          <button
            onClick={() => onFrameModeChange("both")}
            className={cn(
              "px-3 py-1.5 text-xs border-l",
              frameMode === "both" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          >首+尾</button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">参考图策略:</span>
        <Select value={refStrategy} onValueChange={(value) => onRefStrategyChange(value as StoryboardReferenceStrategy)}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="选择策略" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cluster" className="text-xs">Cluster（聚类去重）</SelectItem>
            <SelectItem value="minimal" className="text-xs">Minimal（单参考）</SelectItem>
            <SelectItem value="none" className="text-xs">None（无参考）</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => onUseExemplarChange(!useExemplar)}
          className={cn("px-2 py-1 text-xs rounded border", useExemplar ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
          title="同组格引用已生成的范例成片作为锚点"
        >范例锚图 {useExemplar ? "开" : "关"}</button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          className="h-8 px-4 text-xs font-medium"
          disabled={isGenerating || isMergedRunning || sceneCount === 0}
          onClick={() => {
            console.log("[MergedGenControls] 执行合并生成按钮点击, frameMode:", frameMode, "refStrategy:", refStrategy, "useExemplar:", useExemplar);
            onGenerate(frameMode, refStrategy, useExemplar);
          }}
        >
          {isMergedRunning ? (<><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />合并生成中...</>) : (<><Sparkles className="h-3.5 w-3.5 mr-1.5" />执行合并生成</>)}
        </Button>
        {isMergedRunning && (
          <Button
            variant="destructive"
            className="h-8 px-3 text-xs"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5 mr-1" />停止
          </Button>
        )}
      </div>
    </div>
  );
}
