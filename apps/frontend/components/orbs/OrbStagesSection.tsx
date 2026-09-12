"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-11 模块隔离裁定:阶段=工作流专属(「12345 只有工作流有」),本分区仅
// 工作流视图渲染——多模块内容不得在球 UI 上并行展示。
// 数据/门禁由调用方注入(工作流内=就地切换;跨视图=手册门禁+落档+跳转),
// 本组件只管清单渲染。分镜面板入口不进(08-23 唯一入口裁定)。

import { Check, Image as ImageIcon, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { OrbSection } from "./OrbSection";
import type { OrbSectionProps } from "./OrbSection";
import type {
  WorkflowReadiness,
  WorkflowStageReadiness,
} from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";

/** 纯视图 tab(不在 readiness 流水线):「工作流视图」入口。 */
const WORKFLOW_VIEW_ITEMS = [{ id: "imageWorkflow", label: "图像节点图" }] as const;

/** 「切换阶段」分区:阶段就绪清单+图像节点图(仅工作流视图挂载)。
 * onStageChange 由调用方注入(就地切换/带门禁跳转);onClose 选传(面板内切换后收面板)。 */
export function OrbStagesSection({
  readiness,
  activeStage,
  onStageChange,
  onClose,
  open,
  onToggle,
}: Pick<OrbSectionProps, "open" | "onToggle"> & {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
  onClose?: () => void;
}) {
  return (
    <OrbSection section="stages" title="切换阶段" open={open} onToggle={onToggle}>
      {readiness.stages.map((stage) => (
        <StageItem
          key={stage.id}
          stage={stage}
          active={stage.id === activeStage}
          onSelect={() => {
            onStageChange(stage.id);
            onClose?.();
          }}
        />
      ))}
      <div className="my-1.5 border-t border-border/60" />
      {WORKFLOW_VIEW_ITEMS.map((view) => (
        <button
          key={view.id}
          type="button"
          data-orb-stage-item={view.id}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent motion-reduce:transition-none",
            view.id === activeStage && "bg-accent/60",
          )}
          onClick={() => {
            onStageChange(view.id);
            onClose?.();
          }}
        >
          <span className="flex items-center gap-2 text-sm text-foreground">
            <ImageIcon className="h-4 w-4 text-info" />
            {view.label}
          </span>
          {view.id === activeStage ? (
            <Check className="h-4 w-4 text-success" />
          ) : null}
        </button>
      ))}
    </OrbSection>
  );
}

function StageItem({
  stage,
  active,
  onSelect,
}: {
  stage: WorkflowStageReadiness;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon =
    stage.status === "ready" ? CheckCircle2 : stage.status === "active" ? Clock : AlertCircle;
  const tone =
    stage.status === "ready"
      ? "text-success"
      : stage.status === "active"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <button
      type="button"
      data-orb-stage-item={stage.id}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent motion-reduce:transition-none",
        stage.status === "ready" && "bg-success/8",
        stage.status === "active" && "bg-warning/12",
        active && "bg-accent/60",
      )}
      onClick={onSelect}
    >
      <Icon className={cn("mt-0.5 h-4 w-4", tone)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {stage.label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {stage.status === "ready"
            ? (stage.completed[0] ?? "已完成")
            : (stage.missing[0] ?? stage.actionLabel)}
        </span>
      </span>
      {active ? <Check className="mt-0.5 h-4 w-4 text-primary" /> : null}
    </button>
  );
}
