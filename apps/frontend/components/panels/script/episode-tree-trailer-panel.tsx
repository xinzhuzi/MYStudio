"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Clapperboard, Loader2, Play, Sparkles, Timer, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TrailerGenerationOptions } from "@/lib/script/trailer-service";
import { cn } from "@/lib/utils";
import type { TrailerConfig, TrailerDuration } from "@/stores/director-store";
import type { Shot } from "@/types/script";

interface EpisodeTreeTrailerPanelProps {
  shots: Shot[];
  selectedItemId: string | null;
  selectedItemType: "character" | "scene" | "shot" | "episode" | null;
  onSelectItem: (id: string, type: "character" | "scene" | "shot" | "episode") => void;
  trailerConfig?: TrailerConfig | null;
  onGenerateTrailer?: (duration: TrailerDuration) => void;
  onClearTrailer?: () => void;
  trailerApiOptions?: TrailerGenerationOptions | null;
  onCalibrateSingleShot?: (shotId: string) => void;
  singleShotCalibrationStatus?: Record<string, "idle" | "calibrating" | "completed" | "error">;
}

export function EpisodeTreeTrailerPanel({
  shots,
  selectedItemId,
  selectedItemType,
  onSelectItem,
  trailerConfig,
  onGenerateTrailer,
  onClearTrailer,
  trailerApiOptions,
  onCalibrateSingleShot,
  singleShotCalibrationStatus,
}: EpisodeTreeTrailerPanelProps) {
  const [selectedDuration, setSelectedDuration] = useState<TrailerDuration>(30);
  const [isGenerating, setIsGenerating] = useState(false);

  const trailerShots = useMemo(() => {
    if (!trailerConfig?.shotIds || !shots.length) return [];
    return trailerConfig.shotIds
      .map((id) => shots.find((shot) => shot.id === id))
      .filter((shot): shot is Shot => !!shot);
  }, [shots, trailerConfig?.shotIds]);

  const handleGenerate = useCallback(async () => {
    if (!trailerApiOptions || isGenerating) return;

    setIsGenerating(true);
    try {
      onGenerateTrailer?.(selectedDuration);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, onGenerateTrailer, selectedDuration, trailerApiOptions]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">预告片时长</Label>
          <div className="flex gap-1">
            {([10, 30, 60] as TrailerDuration[]).map((duration) => (
              <Button
                key={duration}
                size="sm"
                variant={selectedDuration === duration ? "default" : "outline"}
                className="h-7 text-xs px-2"
                onClick={() => setSelectedDuration(duration)}
              >
                <Timer className="h-3 w-3 mr-1" />
                {duration === 60 ? "1分钟" : `${duration}秒`}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 h-8"
            onClick={handleGenerate}
            disabled={!trailerApiOptions || isGenerating || shots.length === 0 || trailerConfig?.status === "generating"}
          >
            {isGenerating || trailerConfig?.status === "generating" ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />AI 分析中...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI 智能挑选分镜</>
            )}
          </Button>
          {!!trailerConfig?.shotIds?.length && (
            <Button size="sm" variant="outline" className="h-8" onClick={onClearTrailer}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {!trailerApiOptions && <p className="text-xs text-amber-500">请先在设置中配置 AI API 密钥</p>}
        {shots.length === 0 && <p className="text-xs text-amber-500">请先生成分镜</p>}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {trailerConfig?.error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
              {trailerConfig.error}
            </div>
          )}
          {trailerShots.length > 0 ? (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                已选择 {trailerShots.length} 个分镜，预计时长 {trailerShots.reduce((sum, shot) => sum + (shot.duration || 5), 0)} 秒
              </div>
              {trailerShots.map((shot, index) => {
                const calibrationStatus = singleShotCalibrationStatus?.[shot.id] || "idle";
                return (
                  <div
                    key={shot.id}
                    className={cn(
                      "p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors",
                      selectedItemId === shot.id && selectedItemType === "shot" && "bg-primary/10 border-primary",
                    )}
                    onClick={() => onSelectItem(shot.id, "shot")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-5">#{index + 1}</span>
                      <Play className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs flex-1 truncate">
                        {shot.shotSize || "镜头"} - {shot.actionSummary?.slice(0, 30)}...
                      </span>
                      <span className="text-xs text-muted-foreground">{shot.duration || 5}s</span>
                      {onCalibrateSingleShot && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 shrink-0"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCalibrateSingleShot(shot.id);
                          }}
                          disabled={calibrationStatus === "calibrating"}
                          title="AI 校准分镜"
                        >
                          {calibrationStatus === "calibrating" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : calibrationStatus === "completed" ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : calibrationStatus === "error" ? (
                            <X className="h-3 w-3 text-destructive" />
                          ) : (
                            <Wand2 className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>
                    {shot.dialogue && (
                      <p className="text-xs text-muted-foreground mt-1 pl-7 truncate">
                        「{shot.dialogue.slice(0, 40)}...」
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          ) : trailerConfig?.status === "completed" ? (
            <div className="text-center text-muted-foreground text-sm py-8">暂无挑选的分镜</div>
          ) : (
            <div className="text-center text-muted-foreground text-sm py-8">
              <Clapperboard className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>选择时长后点击「AI 智能挑选分镜」</p>
              <p className="text-xs mt-1">AI 将根据叙事功能和情感张力自动挑选</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
