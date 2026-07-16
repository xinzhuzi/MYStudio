import {
  CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Film, Loader2,
  MapPin, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { calculateProgress, getShotCompletionStatus } from "@/lib/script/shot-utils";
import { cn } from "@/lib/utils";
import type { CompletionStatus, Episode, ScriptScene, Shot } from "@/types/script";

type TreeItemType = "character" | "scene" | "shot" | "episode";

interface EpisodeTreeStructureProps {
  episodes: Episode[];
  scenes: ScriptScene[];
  shots: Shot[];
  shotsByScene: Record<string, Shot[]>;
  filter: "all" | "pending" | "completed";
  expandedEpisodes: Set<string>;
  expandedScenes: Set<string>;
  selectedItemId: string | null;
  selectedItemType: TreeItemType | null;
  shotStatus?: "idle" | "generating" | "ready" | "error";
  episodeGenerationStatus?: Record<number, "idle" | "generating" | "completed" | "error">;
  sceneCalibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  onSelectItem: (id: string, type: TreeItemType) => void;
  onToggleEpisode: (id: string) => void;
  onToggleScene: (id: string) => void;
  onAddScene: (episodeId: string) => void;
  onEditEpisode: (episode: Episode) => void;
  onEditScene: (scene: ScriptScene) => void;
  onDeleteItem: (type: "episode" | "scene" | "shot", id: string, name: string) => void;
  onGenerateEpisodeShots?: (episodeIndex: number) => void;
  onCalibrateShots?: (episodeIndex: number) => void;
  onCalibrateEpisodeScenes?: (episodeIndex: number) => void;
  onCalibrateScenesShots?: (sceneId: string) => void;
}

function StatusIcon({ status }: { status?: CompletionStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-3 w-3 text-green-500" />;
  if (status === "in_progress") return <Clock className="h-3 w-3 text-yellow-500" />;
  return <Circle className="h-3 w-3 text-muted-foreground" />;
}

export function EpisodeTreeStructure({
  episodes, scenes, shots, shotsByScene, filter, expandedEpisodes, expandedScenes,
  selectedItemId, selectedItemType, shotStatus, episodeGenerationStatus,
  sceneCalibrationStatus, onSelectItem, onToggleEpisode, onToggleScene,
  onAddScene, onEditEpisode, onEditScene, onDeleteItem, onGenerateEpisodeShots,
  onCalibrateShots, onCalibrateEpisodeScenes, onCalibrateScenesShots,
}: EpisodeTreeStructureProps) {
  return episodes.map((episode) => {
    const episodeScenes = scenes.filter((scene) => episode.sceneIds.includes(scene.id));
    const episodeShots = shots.filter((shot) => episodeScenes.some((scene) => scene.id === shot.sceneRefId));
    const episodeProgress = calculateProgress(episodeShots.map((shot) => ({ status: getShotCompletionStatus(shot) })));

    return (
      <div key={episode.id} className="space-y-0.5">
        <div className="flex items-center group">
          <button
            aria-label={`切换${episode.title}`}
            onClick={() => onToggleEpisode(episode.id)}
            className={cn(
              "flex-1 min-w-0 flex items-center gap-1 px-2 py-1.5 rounded hover:bg-muted text-left overflow-hidden",
              selectedItemId === `episode_${episode.index}` && selectedItemType === "episode" && "bg-primary/10",
            )}
          >
            {expandedEpisodes.has(episode.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Film className="h-3 w-3 text-primary" />
            <span
              className="text-sm font-medium flex-1 truncate"
              onClick={(event) => {
                event.stopPropagation();
                onSelectItem(`episode_${episode.index}`, "episode");
              }}
            >{episode.title}</span>
            <span className="text-xs text-muted-foreground">{episodeProgress}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button aria-label={`管理${episode.title}`} variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onGenerateEpisodeShots && (
                <DropdownMenuItem onClick={() => onGenerateEpisodeShots(episode.index)} disabled={episodeGenerationStatus?.[episode.index] === "generating"}>
                  {episodeGenerationStatus?.[episode.index] === "generating"
                    ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" />生成中...</>
                    : episodeGenerationStatus?.[episode.index] === "completed"
                      ? <><RefreshCw className="h-3 w-3 mr-2" />更新分镜</>
                      : <><Wand2 className="h-3 w-3 mr-2" />生成分镜</>}
                </DropdownMenuItem>
              )}
              {onCalibrateShots && episodeGenerationStatus?.[episode.index] === "completed" && (
                <DropdownMenuItem onClick={() => onCalibrateShots(episode.index)}><Wand2 className="h-3 w-3 mr-2" />AI校准分镜</DropdownMenuItem>
              )}
              {onCalibrateEpisodeScenes && (
                <DropdownMenuItem onClick={() => onCalibrateEpisodeScenes(episode.index)} disabled={sceneCalibrationStatus === "calibrating"}>
                  {sceneCalibrationStatus === "calibrating"
                    ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" />校准中...</>
                    : <><MapPin className="h-3 w-3 mr-2" />校准本集场景</>}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onAddScene(episode.id)}><Plus className="h-3 w-3 mr-2" />新建场景</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEditEpisode(episode)}><Pencil className="h-3 w-3 mr-2" />编辑</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => onDeleteItem("episode", episode.id, episode.title)}><Trash2 className="h-3 w-3 mr-2" />删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {expandedEpisodes.has(episode.id) && (
          <div className="ml-4 space-y-0.5">
            {episodeScenes.map((scene) => {
              const sceneShots = shotsByScene[scene.id] || [];
              const sceneProgress = calculateProgress(sceneShots.map((shot) => ({ status: getShotCompletionStatus(shot) })));
              return (
                <div key={scene.id} className="space-y-0.5">
                  <div className="flex items-center group">
                    <button
                      aria-label={`切换${scene.name || scene.location}`}
                      onClick={() => onToggleScene(scene.id)}
                      className={cn(
                        "flex-1 flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-left",
                        selectedItemId === scene.id && selectedItemType === "scene" && "bg-primary/10",
                      )}
                    >
                      {sceneShots.length > 0
                        ? expandedScenes.has(scene.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                        : <span className="w-3" />}
                      {shotStatus === "generating" && sceneShots.length === 0
                        ? <Loader2 className="h-3 w-3 text-primary animate-spin" />
                        : <MapPin className="h-3 w-3 text-blue-500" />}
                      <span
                        className="text-xs flex-1 truncate"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectItem(scene.id, "scene");
                        }}
                      >{scene.name || scene.location}</span>
                      <StatusIcon status={scene.status} />
                      <span className="text-xs text-muted-foreground">{sceneProgress}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button aria-label={`管理${scene.name || scene.location}`} variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onCalibrateScenesShots && sceneShots.length > 0 && <DropdownMenuItem onClick={() => onCalibrateScenesShots(scene.id)}><Wand2 className="h-3 w-3 mr-2" />AI校准分镜</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => onEditScene(scene)}><Pencil className="h-3 w-3 mr-2" />编辑</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => onDeleteItem("scene", scene.id, scene.name || scene.location)}><Trash2 className="h-3 w-3 mr-2" />删除</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {expandedScenes.has(scene.id) && sceneShots.length > 0 && (
                    <div className="ml-4 space-y-0.5">
                      {sceneShots.filter((shot) => {
                        if (filter === "all") return true;
                        const status = getShotCompletionStatus(shot);
                        return filter === "completed" ? status === "completed" : status !== "completed";
                      }).map((shot) => (
                        <div key={shot.id} className="flex items-center group">
                          <button
                            onClick={() => onSelectItem(shot.id, "shot")}
                            className={cn(
                              "flex-1 flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-left",
                              selectedItemId === shot.id && selectedItemType === "shot" && "bg-primary/10",
                            )}
                          >
                            <span className="text-xs font-mono text-muted-foreground w-5">{String(shot.index).padStart(2, "0")}</span>
                            <span className="text-xs flex-1 truncate">{shot.shotSize || "镜头"} - {shot.actionSummary?.slice(0, 20)}...</span>
                            <StatusIcon status={getShotCompletionStatus(shot)} />
                          </button>
                          <Button aria-label={`删除镜头 ${shot.index}`} variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive" onClick={(event) => { event.stopPropagation(); onDeleteItem("shot", shot.id, `镜头 ${shot.index}`); }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });
}
