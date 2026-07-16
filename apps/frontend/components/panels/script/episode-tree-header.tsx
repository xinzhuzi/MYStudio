import { Clapperboard, Film, Filter, Loader2, Plus, RefreshCw, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type EpisodeTreeTab = "structure" | "trailer";
export type EpisodeTreeFilter = "all" | "pending" | "completed";

interface EpisodeTreeHeaderProps {
  activeTab: EpisodeTreeTab;
  onActiveTabChange: (tab: EpisodeTreeTab) => void;
  title: string;
  genre?: string;
  overallProgress: string;
  filter: EpisodeTreeFilter;
  onFilterChange: (filter: EpisodeTreeFilter) => void;
  onCalibrateScenes?: () => void;
  sceneCalibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  onRegenerateAllShots?: () => void;
  onAddEpisode: () => void;
}

export function EpisodeTreeHeader({
  activeTab,
  onActiveTabChange,
  title,
  genre,
  overallProgress,
  filter,
  onFilterChange,
  onCalibrateScenes,
  sceneCalibrationStatus,
  onRegenerateAllShots,
  onAddEpisode,
}: EpisodeTreeHeaderProps) {
  return (
    <>
      <div className="border-b">
        <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as EpisodeTreeTab)} className="w-full">
          <TabsList className="w-full justify-start h-9 rounded-none bg-transparent border-b-0 p-0">
            <TabsTrigger
              value="structure"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
            >
              <Film className="h-3 w-3 mr-1" />
              剧集结构
            </TabsTrigger>
            <TabsTrigger
              value="trailer"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-9 px-4"
            >
              <Clapperboard className="h-3 w-3 mr-1" />
              预告片
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "structure" && (
        <>
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm">{title}</h3>
                {genre && <span className="text-xs text-muted-foreground">{genre}</span>}
              </div>
              <span className="text-xs text-muted-foreground">进度: {overallProgress}</span>
            </div>
          </div>
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <div className="flex gap-1">
                {(["all", "pending", "completed"] as EpisodeTreeFilter[]).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? "default" : "ghost"}
                    className="h-6 text-xs px-2"
                    onClick={() => onFilterChange(value)}
                  >
                    {value === "all" ? "全部" : value === "pending" ? "未完成" : "已完成"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex gap-1">
              {onCalibrateScenes && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={onCalibrateScenes}
                  disabled={sceneCalibrationStatus === "calibrating"}
                >
                  {sceneCalibrationStatus === "calibrating" ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />校准中...</>
                  ) : (
                    <><Wand2 className="h-3 w-3 mr-1" />AI场景校准</>
                  )}
                </Button>
              )}
              {onRegenerateAllShots && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={onRegenerateAllShots}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />更新全部
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onAddEpisode}>
                <Plus className="h-3 w-3 mr-1" />新建集
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
