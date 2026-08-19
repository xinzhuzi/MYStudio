// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Shot Breakdown View
 * Based on CineGen-AI StageScript.tsx renderShotBreakdown
 * Features: sticky scene headers, left index bar
 */

import { useMemo, useRef } from "react";
import type { Shot, ScriptScene, ScriptData } from "@/types/script";
import { cn } from "@/lib/utils";
import { Camera, MapPin, Clock, MessageSquare, Film } from "lucide-react";

interface ShotBreakdownProps {
  shots: Shot[];
  scriptData: ScriptData | null;
  onShotClick?: (shot: Shot) => void;
  selectedShotId?: string;
}

interface ShotsByScene {
  scene: ScriptScene;
  shots: Shot[];
}

export function ShotBreakdown({
  shots,
  scriptData,
  onShotClick,
  selectedShotId,
}: ShotBreakdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Group shots by scene
  const shotsByScene = useMemo<ShotsByScene[]>(() => {
    if (!scriptData?.scenes) return [];

    return scriptData.scenes
      .map((scene) => ({
        scene,
        shots: shots.filter((s) => String(s.sceneRefId) === String(scene.id)),
      }))
      .filter((group) => group.shots.length > 0);
  }, [shots, scriptData]);

  // Calculate total shots for index display
 
  let globalIndex = 0;

  if (shots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Film className="w-12 h-12 text-foreground mb-4" />
        <p className="text-sm text-muted-foreground">暂无分镜</p>
        <p className="text-xs text-muted-foreground mt-1">解析剧本后点击"生成分镜列表"</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-y-auto">
      {/* Left index bar */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-muted/60/50 border-r border-border z-10 flex flex-col">
        {shotsByScene.map((group) => (
          <div key={group.scene.id} className="flex-shrink-0">
            {/* Scene marker */}
            <div className="h-10 flex items-center justify-center text-[10px] text-muted-foreground font-mono border-b border-border">
              S{(scriptData?.scenes.indexOf(group.scene) ?? -1) + 1}
            </div>
            {/* Shot indices */}
            {group.shots.map((shot, _idx) => {
              const currentGlobalIndex = ++globalIndex;
              return (
                <button
                  key={shot.id}
                  onClick={() => onShotClick?.(shot)}
                  className={cn(
                    "h-8 w-full flex items-center justify-center text-[10px] font-mono transition-colors",
                    selectedShotId === shot.id
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  {String(currentGlobalIndex).padStart(2, "0")}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Main content with sticky headers */}
      <div className="ml-8">
        {shotsByScene.map((group, groupIdx) => (
          <div key={group.scene.id} className="relative">
            {/* Sticky scene header */}
            <div className="sticky top-0 z-20 bg-muted/60/95 backdrop-blur-sm border-b border-border px-4 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    场景 {groupIdx + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {group.scene.name || group.scene.location}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {group.shots.length} shots
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {group.scene.location}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {group.scene.time}
                </span>
                {group.scene.atmosphere && (
                  <span className="text-muted-foreground truncate max-w-[150px]">
                    {group.scene.atmosphere}
                  </span>
                )}
              </div>
            </div>

            {/* Shots in this scene */}
            <div className="divide-y divide-border/50">
              {group.shots.map((shot, _shotIdx) => (
                <ShotRow
                  key={shot.id}
                  shot={shot}
                  isSelected={selectedShotId === shot.id}
                  onClick={() => onShotClick?.(shot)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ShotRowProps {
  shot: Shot;
  isSelected: boolean;
  onClick: () => void;
}

function ShotRow({ shot, isSelected, onClick }: ShotRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 transition-colors",
        isSelected
          ? "bg-primary/10 border-l-2 border-primary/40"
          : "hover:bg-muted/60/50 border-l-2 border-transparent"
      )}
    >
      {/* Shot header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            镜头 {shot.index}
          </span>
          {shot.shotSize && (
            <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
              {shot.shotSize}
            </span>
          )}
          {shot.cameraMovement && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Camera className="w-3 h-3" />
              {shot.cameraMovement}
            </span>
          )}
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-1">
          {shot.imageUrl && (
            <span className="w-2 h-2 rounded-full bg-success" title="图片已生成" />
          )}
          {shot.videoUrl && (
            <span className="w-2 h-2 rounded-full bg-primary" title="视频已生成" />
          )}
        </div>
      </div>

      {/* Action summary */}
      <p className="text-sm text-muted-foreground line-clamp-2">{shot.actionSummary}</p>

      {/* Dialogue if present */}
      {shot.dialogue && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/60/30 px-2 py-1.5 rounded">
          <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="italic line-clamp-1">{shot.dialogue}</span>
        </div>
      )}

      {/* Character tags */}
      {shot.characterNames && shot.characterNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {shot.characterNames.map((name, i) => (
            <span
              key={i}
              className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded"
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
