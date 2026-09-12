"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 悬浮球独立模块(components/orbs/)的全局面孔:
// - 09-11 中转枢纽+模块隔离裁定:球=各模块中转站——「最近」记录模块跳转(MRU 一键回跳);
//   模块状态区只在本模块视图渲染(工作流阶段不出现在本地模型,反之亦然——
//   多模块内容不得在球 UI 上并行展示):工作流=六阶段就绪,本地模型=画布/配音室;
// - 球面标识仍分域:进度环+阶段序号仅工作流(12345 只有工作流有),其他=Compass 中性面;
// - 上下文默认:工作流→工作流区开;本地模型→本地模型区开;其他→前往开+当前模块高亮;
// - 内部边界:OrbShell/OrbSection/use-orb-position 零业务依赖;门面=AppOrb;
//   分镜面板入口刻意不进(2026-08-23 唯一入口=节点图「分镜面板」的「进入」)。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Compass } from "lucide-react";
import { useMediaPanelStore, tabs as TAB_LABELS, type Tab } from "@/stores/navigation/media-panel-store";
import { useFreedomStore, type StudioMode } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useWorkflowReadiness, resolveVisibleWorkflowStage } from "@/components/panels/studio/workflow-stage";
import { resolveProductionEpisodeId } from "@/components/panels/studio/workflow-helpers";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";
import { OrbShell } from "./OrbShell";
import { WORKFLOW_ORB_POSITION_KEY } from "./use-orb-position";
import { OrbGotoSection } from "./OrbGotoSection";
import { OrbStagesSection } from "./OrbStagesSection";
import { OrbLocalModelsSection } from "./OrbLocalModelsSection";
import { OrbRecentSection } from "./OrbRecentSection";
import { OrbTaskBadge, OrbTasksSection } from "./OrbTasksSection";
import { useTaskCenter } from "./use-task-center";
import { useRecentTabs } from "./use-recent-tabs";

/** 上下文默认(进不同模块默认展开该模块自己的分区):
 * 工作流→工作流(切换阶段);本地模型→本地模型(画布/配音室);其他→前往。
 * 「最近」恒收起;「任务」恒收起(可见性由球面徽章承担);视图切换即重置;
 * 同视图内面板重开保留用户开合。 */
function sectionDefaults(tab: Tab) {
  return {
    recent: false,
    stages: tab === "studio",
    local: tab === "freedom",
    tasks: false,
    goto: tab !== "freedom" && tab !== "studio",
  };
}

/** 全应用唯一悬浮球=各模块中转枢纽。 */
export function AppOrb() {
  const activeTab = useMediaPanelStore((state) => state.activeTab);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const activeStudio = useFreedomStore((state) => state.activeStudio);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);
  const recentTabs = useRecentTabs();
  // 任务中心(09-12):后台任务态上球——徽章+面板分区+完成提醒(零 toast)
  const { tasks: activeTasks, recent: recentTasks, bumpTick } = useTaskCenter();
  const taskBadge = (
    <OrbTaskBadge count={activeTasks.length} bumpTick={bumpTick} />
  );

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

  // 分区开合=上下文默认起步;视图切换即重置到新视图的默认
  const [sections, setSections] = useState(() => sectionDefaults(activeTab));
  const lastTabRef = useRef(activeTab);
  useEffect(() => {
    if (lastTabRef.current !== activeTab) {
      lastTabRef.current = activeTab;
      setSections(sectionDefaults(activeTab));
    }
  }, [activeTab]);

  const inStudio = activeTab === "studio";
  const inFreedom = activeTab === "freedom";
  const activeStage = resolveVisibleWorkflowStage(workflowConfig.workflowStage);
  const moduleLabel = TAB_LABELS[activeTab]?.label ?? "导航";

  // 阶段直达(任何视图):手册门禁→落档→跳工作流该阶段(工作流内=就地切换)
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

  // 模式直达(任何视图):跳本地模型并直切该模式(模块内=纯切换)
  const handleModeSelect = (mode: StudioMode) => {
    setActiveStudio(mode);
    setActiveTab("freedom");
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

  // 球面分域:工作流=进度环+阶段序号;其他=中性导航面孔。任务徽章全域在场。
  const taskSuffix =
    activeTasks.length > 0 ? `，${activeTasks.length} 个任务进行中` : "";
  const ariaLabel = inStudio
    ? `工作流进度：${currentStage?.label ?? "工作流"}，${readyCount}/${total} 已就绪${taskSuffix}，点按打开阶段面板`
    : `导航：当前${moduleLabel}${taskSuffix}，点按打开导航面板`;
  const capsuleText = inStudio
    ? `${currentStage?.label ?? "工作流"} · ${readyCount}/${total}${
        firstMissing ? ` · 缺：${firstMissing}` : ""
      }`
    : moduleLabel;
  const ballContent: ReactNode = inStudio ? (
    <>
      <ProgressRing readiness={readiness} />
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
        {stageNumber || total}
      </span>
      {taskBadge}
    </>
  ) : (
    <>
      <Compass
        className="h-5 w-5 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        aria-hidden
      />
      {taskBadge}
    </>
  );

  return (
    <OrbShell
      storageKey={WORKFLOW_ORB_POSITION_KEY}
      defaultAnchor="bottom-right"
      dataOrb="workflow-orb"
      dataAttrs={inStudio ? { "data-workflow-active-stage": activeStage } : undefined}
      ariaLabel={ariaLabel}
      capsuleText={capsuleText}
      ballContent={ballContent}
      resetKey={activeTab}
      panelContent={({ close }) => (
        <div className="flex max-h-[60vh] flex-col">
          {inStudio ? (
            <div className="px-1 pb-2">
              <p className="text-sm font-semibold text-foreground">
                待推进：{currentStage?.label ?? "工作流"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {readiness.nextActionLabel}
              </p>
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto space-y-1">
            <OrbRecentSection
              recent={recentTabs}
              open={sections.recent}
              onToggle={() => setSections((s) => ({ ...s, recent: !s.recent }))}
            />
            {inStudio ? (
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
            ) : null}
            {inFreedom ? (
              <OrbLocalModelsSection
                activeMode={activeStudio}
                onModeSelect={handleModeSelect}
                open={sections.local}
                onToggle={() => setSections((s) => ({ ...s, local: !s.local }))}
              />
            ) : null}
            {activeTasks.length > 0 || recentTasks.length > 0 ? (
              <OrbTasksSection
                active={activeTasks}
                recent={recentTasks}
                open={sections.tasks}
                onToggle={() => setSections((s) => ({ ...s, tasks: !s.tasks }))}
                onJump={(tab) => {
                  setActiveTab(tab as Tab);
                  close();
                }}
              />
            ) : null}
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

/** 六段进度弧:ready=success / active=warning(加重+柔光=状态指示)/ blocked=muted
 * (仅工作流球面渲染;09-11 质感:激活段 strokeWidth 3.5 + 低强度 drop-shadow)。 */
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
          strokeWidth={stage.status === "active" ? 3.5 : 3}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(segmentLength, 0)} ${circumference - Math.max(segmentLength, 0)}`}
          strokeDashoffset={-(index * circumference) / readiness.stages.length}
          className={cn(
            stage.status === "ready" && "stroke-success",
            stage.status === "active" && "stroke-warning drop-shadow-[0_0_3px_currentColor]",
            stage.status === "blocked" && "stroke-muted-foreground/40",
          )}
        />
      ))}
    </svg>
  );
}
