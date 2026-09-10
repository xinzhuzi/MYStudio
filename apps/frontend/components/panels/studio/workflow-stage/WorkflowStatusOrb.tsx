"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 拆双球裁定:本组件=工作流业务球,只在工作流视图挂载;
// 通用球交互(拖拽/吸附/判点击/胶囊/面板壳)在 @/components/orbs 基础设施,
// 视图导航不在本球(沉浸视图归 panels/assist/LocalModelOrb)。

import type { ReactNode } from "react";
import { OrbShell, WORKFLOW_ORB_POSITION_KEY } from "@/components/orbs";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";
import { StageReadinessPanel } from "./StageReadinessPanel";

/** 工作流状态悬浮球:收起(进度弧)/hover(胶囊)/点击(就绪面板)三态。
 * 接替退役的 WorkflowStageStatusBar;面板「切换阶段」分区默认收起
 * (09-10 裁定:折叠点开),待推进头恒显。 */
export function WorkflowStatusOrb({
  readiness,
  activeStage,
  onStageChange,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
}) {
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
      dataOrb="workflow-orb"
      dataAttrs={{ "data-workflow-active-stage": activeStage }}
      ariaLabel={ariaLabel}
      capsuleText={capsuleText}
      ballContent={ballContent}
      panelContent={({ close }) => (
        <StageReadinessPanel
          readiness={readiness}
          activeStage={activeStage}
          onStageChange={onStageChange}
          onClose={close}
        />
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
