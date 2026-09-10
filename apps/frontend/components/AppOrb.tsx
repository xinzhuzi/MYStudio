"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 终裁(09-10 用户:悬浮球是 1 个,要展示全面,不能因模块问题丢了出入口):
// 全应用唯一一枚悬浮球,挂 Layout 应用层,项目内所有视图(含沉浸态)都在场。
// 球面=工作流进度环+阶段序号(唯一面孔);面板=待推进(恒显)+切换阶段+前往,
// 沉浸视图(freedom)追加「本视图」(画布/配音室)——任何视图都能找到全部进出口。
// 交互壳=@/components/orbs(零业务依赖);分区=features/orb-nav 共享组件。
// 分镜面板入口刻意不进(2026-08-23 唯一入口=节点图「分镜面板」的「进入」)。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Mic, Palette } from "lucide-react";
import {
  OrbSection,
  OrbShell,
  WORKFLOW_ORB_POSITION_KEY,
} from "@/components/orbs";
import { OrbGotoSection, OrbStagesSection } from "@/components/features/orb-nav";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";
import { useFreedomStore, type StudioMode } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useWorkflowReadiness, resolveVisibleWorkflowStage } from "@/components/panels/studio/workflow-stage";
import { resolveProductionEpisodeId } from "@/components/panels/studio/workflow-helpers";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string; icon: typeof Palette }> = [
  { id: "comfy", label: "ComfyUI 画布", icon: Palette },
  { id: "tts", label: "配音室", icon: Mic },
];

/** 上下文默认(09-11 裁定:进不同模块默认展开该模块自己的分区):
 * 工作流→切换阶段;本地模型→本视图;其他视图→前往(导航是首要诉求)。
 * 其余分区默认收起;面板重开/切换视图都回当前视图默认。 */
function sectionDefaults(tab: Tab) {
  return {
    views: tab === "freedom",
    stages: tab === "studio",
    goto: tab !== "freedom" && tab !== "studio",
  };
}

/** 全应用唯一悬浮球。任何阶段点击=手册门禁后落工作流阶段档并跳工作流视图
 * (工作流视图内即就地切换,setActiveTab 为幂等空操作)。 */
export function AppOrb() {
  const activeTab = useMediaPanelStore((state) => state.activeTab);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const activeStudio = useFreedomStore((state) => state.activeStudio);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);

  const {
    workflowConfig,
    setWorkflowConfig,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
  } = useStudioStore();
  const readiness = useWorkflowReadiness({
    workflowConfig,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
    episodeId: resolveProductionEpisodeId(useStudioStore.getState()),
  });

  // 分区开合=上下文默认起步;视图切换即重置到新视图的默认(09-11 裁定)
  const [sections, setSections] = useState(() => sectionDefaults(activeTab));
  const lastTabRef = useRef(activeTab);
  useEffect(() => {
    if (lastTabRef.current !== activeTab) {
      lastTabRef.current = activeTab;
      setSections(sectionDefaults(activeTab));
    }
  }, [activeTab]);

  const activeStage = resolveVisibleWorkflowStage(workflowConfig.workflowStage);
  // 「本视图」分区仅沉浸态有意义(画布/配音室切换)
  const inFreedom = activeTab === "freedom";

  const handleStageChange = (stageId: string) => {
    const visibleStage = resolveVisibleWorkflowStage(stageId);
    const cfg = useStudioStore.getState().workflowConfig;
    if (
      visibleStage !== "manuals" &&
      (!cfg.visualManualId || !cfg.directorManualId)
    ) {
      toast.error("请先选择视觉风格与导演手册，才能进入下一步");
      return;
    }
    setWorkflowConfig({ workflowStage: visibleStage });
    setActiveTab("studio");
  };

  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];
  const readyCount = readiness.stages.filter(
    (stage) => stage.status === "ready",
  ).length;
  const total = readiness.stages.length;
  const stageNumber = currentStage
    ? readiness.stages.indexOf(currentStage) + 1
    : 0;
  const firstMissing = currentStage?.missing[0] ?? currentStage?.actionLabel ?? "";
  const ariaLabel = `工作流进度：${currentStage?.label ?? "工作流"}，${readyCount}/${total} 已就绪，点按打开阶段面板`;
  const capsuleText = `${currentStage?.label ?? "工作流"} · ${readyCount}/${total}${
    firstMissing ? ` · 缺：${firstMissing}` : ""
  }`;

  const ballContent: ReactNode = (
    <>
      <ProgressRing readiness={readiness} />
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
        {stageNumber || total}
      </span>
    </>
  );

  return (
    <OrbShell
      storageKey={WORKFLOW_ORB_POSITION_KEY}
      defaultAnchor="bottom-right"
      dataOrb="workflow-orb"
      dataAttrs={{ "data-workflow-active-stage": activeStage }}
      ariaLabel={ariaLabel}
      capsuleText={capsuleText}
      ballContent={ballContent}
      panelContent={({ close }) => (
        <div className="flex max-h-[60vh] flex-col">
          <div className="px-1 pb-2">
            <p className="text-sm font-semibold text-foreground">
              待推进：{currentStage?.label ?? "工作流"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {readiness.nextActionLabel}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {inFreedom ? (
              <OrbSection
                section="views"
                title="本视图"
                open={sections.views}
                onToggle={() =>
                  setSections((s) => ({ ...s, views: !s.views }))
                }
              >
                <div className="grid grid-cols-2 gap-1">
                  {MODE_ENTRIES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-orb-nav-mode={item.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                        item.id === activeStudio
                          ? "bg-accent/60 text-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setActiveStudio(item.id)}
                    >
                      <item.icon className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </OrbSection>
            ) : null}
            <OrbStagesSection
              readiness={readiness}
              activeStage={activeStage}
              onStageChange={handleStageChange}
              onClose={close}
              open={sections.stages}
              onToggle={() =>
                setSections((s) => ({ ...s, stages: !s.stages }))
              }
            />
            <OrbGotoSection
              activeTab={activeTab}
              open={sections.goto}
              onToggle={() => setSections((s) => ({ ...s, goto: !s.goto }))}
            />
          </div>
        </div>
      )}
    />
  );
}

/** 六段进度弧:ready=success / active=warning / blocked=muted。 */
function ProgressRing({ readiness }: { readiness: WorkflowReadiness }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const segmentGap = 3;
  const segmentLength = circumference / readiness.stages.length - segmentGap;
  return (
    <svg
      viewBox="0 0 48 48"
      className="absolute inset-0 h-full w-full -rotate-90"
      aria-hidden
    >
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        strokeWidth="3"
        className="stroke-border/50"
      />
      {readiness.stages.map((stage, index) => (
        <circle
          key={stage.id}
          data-orb-segment={stage.id}
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(segmentLength, 0)} ${circumference - Math.max(segmentLength, 0)}`}
          strokeDashoffset={-(index * circumference) / readiness.stages.length}
          className={cn(
            stage.status === "ready" && "stroke-success",
            stage.status === "active" && "stroke-warning",
            stage.status === "blocked" && "stroke-muted-foreground/40",
          )}
        />
      ))}
    </svg>
  );
}
