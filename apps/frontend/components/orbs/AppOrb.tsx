"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 悬浮球独立模块(components/orbs/)的全局面孔(09-11 终局结构裁定):
// - 球是全局模块,Layout 应用层挂载,项目内所有视图唯一常驻导航枢纽;
// - 阶段=工作流专属(09-11 裁定:「12345 之类的阶段只有工作流有」):
//   工作流视图=进度环+阶段序号+待推进+切换阶段(默认展开)+前往;
//   其他视图=中性导航面孔(Compass 图标+胶囊显当前模块名),面板无任何阶段内容;
//   本地模型沉浸态追加「本视图」(画布/配音室,默认展开);其他视图「前往」默认展开。
// 内部边界:OrbShell/OrbSection/use-orb-position 保持零业务依赖(不 import
// panels/stores);业务接线只出现在本文件与两个分区组件——模块对外的唯一门面是 AppOrb。
// 分镜面板入口刻意不进(2026-08-23 唯一入口=节点图「分镜面板」的「进入」)。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Mic, Palette, Compass } from "lucide-react";
import { useMediaPanelStore, tabs as TAB_LABELS, type Tab } from "@/stores/navigation/media-panel-store";
import { useFreedomStore, type StudioMode } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useWorkflowReadiness, resolveVisibleWorkflowStage } from "@/components/panels/studio/workflow-stage";
import { resolveProductionEpisodeId } from "@/components/panels/studio/workflow-helpers";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";
import { OrbSection } from "./OrbSection";
import { OrbShell } from "./OrbShell";
import { WORKFLOW_ORB_POSITION_KEY } from "./use-orb-position";
import { OrbGotoSection } from "./OrbGotoSection";
import { OrbStagesSection } from "./OrbStagesSection";

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string; icon: typeof Palette }> = [
  { id: "comfy", label: "ComfyUI 画布", icon: Palette },
  { id: "tts", label: "配音室", icon: Mic },
];

/** 上下文默认(09-11 裁定:进不同模块默认展开该模块自己的分区):
 * 工作流→切换阶段;本地模型→本视图;其他视图→前往(导航是首要诉求)。
 * 视图切换即重置到新视图默认;同视图内面板重开保留用户开合。 */
function sectionDefaults(tab: Tab) {
  return {
    views: tab === "freedom",
    stages: tab === "studio",
    goto: tab !== "freedom" && tab !== "studio",
  };
}

/** 全应用唯一悬浮球。工作流视图内点阶段=手册门禁后就地落档切换;
 * 阶段入口不出现于其他视图(09-11 裁定:阶段只有工作流有)。 */
export function AppOrb() {
  const activeTab = useMediaPanelStore((state) => state.activeTab);
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

  const inStudio = activeTab === "studio";
  const inFreedom = activeTab === "freedom";
  const activeStage = resolveVisibleWorkflowStage(workflowConfig.workflowStage);
  const moduleLabel = TAB_LABELS[activeTab]?.label ?? "导航";

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

  // 球面分域(09-11 裁定):工作流=进度环+阶段序号;其他=中性导航面孔,零阶段内容
  const ariaLabel = inStudio
    ? `工作流进度：${currentStage?.label ?? "工作流"}，${readyCount}/${total} 已就绪，点按打开阶段面板`
    : `导航：当前${moduleLabel}，点按打开导航面板`;
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
    </>
  ) : (
    <Compass
      className="h-5 w-5 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
      aria-hidden
    />
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
