"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 本地模型球=沉浸视图(freedom)专属导航枢纽;交互壳与折叠分区原语来自
// @/components/orbs 基础设施。09-10 终裁(用户:悬浮球功能应一致、都展示全面):
// 「切换阶段」「前往」与工作流球共用 features/orb-nav 分区——点阶段=手册门禁
// 后落档跳工作流该阶段(恢复直达,原 Q3「两步路径」裁定就此反转)。
// 「本视图」为沉浸态专属(画布/配音室);分镜面板入口不进(08-23 唯一入口裁定)。

import { useState } from "react";
import { Mic, Palette, Boxes } from "lucide-react";
import {
  OrbSection,
  OrbShell,
  LOCAL_MODEL_ORB_POSITION_KEY,
} from "@/components/orbs";
import { OrbGotoSection, OrbStagesSection } from "@/components/features/orb-nav";
import { cn } from "@/lib/utils";
import type { StudioMode } from "@/stores/assist/freedom-store";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string; icon: typeof Palette }> = [
  { id: "comfy", label: "ComfyUI 画布", icon: Palette },
  { id: "tts", label: "配音室", icon: Mic },
];

/** 本地模型球面板:三个折叠分区(默认收起,点标题行展开,面板重开回默认)。
 * 沉浸视图零应用 chrome,本球=唯一出入。 */
export function LocalModelOrb({
  mode,
  onModeChange,
  readiness,
  activeStage,
  onStageChange,
}: {
  mode: StudioMode;
  onModeChange: (mode: StudioMode) => void;
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const currentModeLabel =
    MODE_ENTRIES.find((entry) => entry.id === mode)?.label ?? "ComfyUI 画布";

  return (
    <OrbShell
      storageKey={LOCAL_MODEL_ORB_POSITION_KEY}
      dataOrb="local-model-orb"
      ariaLabel={`本地模型导航:当前${currentModeLabel},点按打开导航面板`}
      capsuleText={currentModeLabel}
      ballContent={
        <Boxes className="h-5 w-5 text-foreground" aria-hidden />
      }
      panelContent={() => (
        <div className="space-y-1">
          <OrbSection
            section="views"
            title="本视图"
            open={viewsOpen}
            onToggle={() => setViewsOpen((open) => !open)}
          >
            <div className="grid grid-cols-2 gap-1">
              {MODE_ENTRIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-orb-nav-mode={item.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                    item.id === mode
                      ? "bg-accent/60 text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onModeChange(item.id)}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </OrbSection>
          <OrbStagesSection
            readiness={readiness}
            activeStage={activeStage}
            onStageChange={onStageChange}
            open={stagesOpen}
            onToggle={() => setStagesOpen((open) => !open)}
          />
          <OrbGotoSection
            open={gotoOpen}
            onToggle={() => setGotoOpen((open) => !open)}
          />
        </div>
      )}
    />
  );
}
