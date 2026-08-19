// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { calculateProgress, getShotCompletionStatus } from "@/lib/script/shot-utils";
import { cn } from "@/lib/utils";
import type {
  CompletionStatus,
  Episode,
  ScriptScene,
  Shot,
} from "@/types/script";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Film,
  MapPin,
  Plus,
  Send,
} from "lucide-react";

interface DirectorContextTreeProps {
  episodes: Episode[];
  scenes: ScriptScene[];
  shots: Shot[];
  shotsByScene: Record<string, Shot[]>;
  expandedEpisodes: Set<string>;
  expandedScenes: Set<string>;
  selectedSceneId: string | null;
  selectedShotId: string | null;
  onToggleEpisode: (episodeId: string) => void;
  onToggleScene: (sceneId: string) => void;
  onSendScene: (scene: ScriptScene) => void;
  onAddScene: (scene: ScriptScene) => void;
  onSendShot: (shot: Shot, scene: ScriptScene) => void;
  onAddShot: (shot: Shot, scene: ScriptScene) => void;
}

function StatusIcon({ status }: { status?: CompletionStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-success" />;
    case "in_progress":
      return <Clock className="h-3 w-3 text-warning" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
}

export function DirectorContextTree({
  episodes,
  scenes,
  shots,
  shotsByScene,
  expandedEpisodes,
  expandedScenes,
  selectedSceneId,
  selectedShotId,
  onToggleEpisode,
  onToggleScene,
  onSendScene,
  onAddScene,
  onSendShot,
  onAddShot,
}: DirectorContextTreeProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-1">
        {episodes.map((episode) => {
          const episodeScenes = scenes.filter((scene) =>
            episode.sceneIds.includes(scene.id),
          );
          const episodeShots = shots.filter((shot) =>
            episodeScenes.some((scene) => scene.id === shot.sceneRefId),
          );
          const episodeProgress = calculateProgress(
            episodeShots.map((shot) => ({
              status: getShotCompletionStatus(shot),
            })),
          );

          return (
            <div key={episode.id} className="space-y-0.5">
              <button
                onClick={() => onToggleEpisode(episode.id)}
                className="w-full flex items-center gap-1 px-2 py-1.5 rounded hover:bg-muted text-left"
              >
                {expandedEpisodes.has(episode.id) ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <Film className="h-3 w-3 text-primary" />
                <span className="text-sm font-medium flex-1 truncate">
                  {episode.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {episodeProgress}
                </span>
              </button>

              {expandedEpisodes.has(episode.id) && (
                <div className="ml-4 space-y-0.5">
                  {episodeScenes.map((scene) => {
                    const sceneShots = shotsByScene[scene.id] || [];
                    const sceneProgress = calculateProgress(
                      sceneShots.map((shot) => ({
                        status: getShotCompletionStatus(shot),
                      })),
                    );
                    const isSceneSelected = selectedSceneId === scene.id;

                    return (
                      <div key={scene.id} className="space-y-0.5">
                        <div className="flex items-center group">
                          <button
                            onClick={() => onToggleScene(scene.id)}
                            className={cn(
                              "flex-1 flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-left",
                              isSceneSelected &&
                                "bg-primary/10 ring-1 ring-primary/30",
                            )}
                          >
                            {sceneShots.length > 0 ? (
                              expandedScenes.has(scene.id) ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )
                            ) : (
                              <span className="w-3" />
                            )}
                            <MapPin className="h-3 w-3 text-primary" />
                            <span className="text-xs flex-1 truncate">
                              {scene.name || scene.location}
                            </span>
                            <StatusIcon status={scene.status} />
                            <span className="text-xs text-muted-foreground">
                              {sceneProgress}
                            </span>
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddScene(scene);
                            }}
                            title="添加所有分镜到分镜编辑"
                          >
                            <Plus className="h-3 w-3 text-success" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSendScene(scene);
                            }}
                            title="发送整个场景到AI导演生成图片"
                          >
                            <Send className="h-3 w-3 text-primary" />
                          </Button>
                        </div>

                        {expandedScenes.has(scene.id) &&
                          sceneShots.length > 0 && (
                            <div className="ml-4 space-y-0.5">
                              {sceneShots.map((shot) => {
                                const isShotSelected =
                                  selectedShotId === shot.id;

                                return (
                                  <div
                                    key={shot.id}
                                    className="flex items-center group"
                                  >
                                    <button
                                      onClick={() => onSendShot(shot, scene)}
                                      onDoubleClick={() => onAddShot(shot, scene)}
                                      className={cn(
                                        "flex-1 flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-left",
                                        isShotSelected &&
                                          "bg-primary/10 ring-1 ring-primary/30",
                                      )}
                                      title="单击: 发送到AI导演输入 | 双击: 直接添加到分镜编辑"
                                    >
                                      <span className="text-xs font-mono text-muted-foreground w-5">
                                        {String(shot.index).padStart(2, "0")}
                                      </span>
                                      <span className="text-xs flex-1 truncate">
                                        {shot.shotSize || "镜头"} -{" "}
                                        {shot.actionSummary?.slice(0, 20)}...
                                      </span>
                                      <StatusIcon
                                        status={getShotCompletionStatus(shot)}
                                      />
                                    </button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onAddShot(shot, scene);
                                      }}
                                      title="添加到分镜编辑"
                                    >
                                      <Plus className="h-3 w-3 text-success" />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
