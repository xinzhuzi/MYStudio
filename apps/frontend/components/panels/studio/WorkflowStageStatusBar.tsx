import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  WorkflowReadiness,
  WorkflowStageReadiness,
} from "@/lib/studio/workflow-readiness";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 纯视图型 tab(不在 readiness 流水线,无就绪状态):下拉「工作流视图」组入口。
 * 分镜面板刻意不在此列——唯一入口是节点图「分镜面板」节点的「进入」按钮
 * (2026-08-23 用户裁定:其他位置不得出现进入分镜面板的途径)。 */
const WORKFLOW_VIEW_ITEMS = [
  { id: "imageWorkflow", label: "图像节点图", Icon: ImageIcon },
] as const;

export function WorkflowStageStatusBar({
  readiness,
  activeStage,
  onStageChange,
  stageActions,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
  stageActions?: ReactNode;
}) {
  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];

  return (
    <div
      data-workflow-active-stage={activeStage}
      className="mb-4 rounded-lg border border-border/70 bg-card/80 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-foreground">
            待推进：{currentStage?.label ?? "工作流"}
          </h3>
          <span className="min-w-0 text-sm text-muted-foreground">
            {readiness.nextActionLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeStage === "script" && stageActions ? stageActions : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="gap-2">
                切换阶段
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>选择工作流阶段</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {readiness.stages.map((stage) => (
                <WorkflowStageMenuItem
                  key={stage.id}
                  stage={stage}
                  active={stage.id === activeStage}
                  onClick={() => onStageChange(stage.id)}
                />
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>工作流视图</DropdownMenuLabel>
              {WORKFLOW_VIEW_ITEMS.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  data-workflow-view-entry={view.id}
                  className={cn(
                    "flex items-center justify-between gap-3",
                    view.id === activeStage && "bg-accent/60",
                  )}
                  onClick={() => onStageChange(view.id)}
                >
                  <span className="flex items-center gap-2">
                    <view.Icon className="h-4 w-4 text-info" />
                    {view.label}
                  </span>
                  {view.id === activeStage ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 阶段导轨流水线 (Cinematic Pipeline Ribbon) */}
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-border/40 pt-2.5 pb-0.5 text-xs text-muted-foreground no-scrollbar">
        {readiness.stages.map((stage, index) => {
          const isActive = stage.id === activeStage;
          const isReady = stage.status === "ready";
          const stepNum = String(index + 1).padStart(2, "0");
          return (
            <div key={stage.id} className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onStageChange(stage.id)}
                title={`${stage.label} - ${isReady ? "已完成" : stage.actionLabel || "点击切换"}`}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-all",
                  isActive
                    ? "border-primary/50 bg-primary/10 text-primary font-medium ring-1 ring-primary/20"
                    : isReady
                      ? "border-border/60 bg-muted/20 text-foreground/90 hover:border-border hover:bg-muted/40"
                      : "border-border/30 bg-transparent text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-mono",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : isReady
                        ? "bg-success/20 text-success font-semibold"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {isReady && !isActive ? "✓" : stepNum}
                </span>
                <span className="truncate max-w-[130px]">
                  {stepNum} · {stage.label}
                </span>
              </button>
              {index < readiness.stages.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
              )}
            </div>
          );
        })}
        {WORKFLOW_VIEW_ITEMS.length > 0 && (
          <>
            <div className="mx-1 h-3.5 w-px bg-border/50 shrink-0" />
            {WORKFLOW_VIEW_ITEMS.map((view) => {
              const isActive = view.id === activeStage;
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => onStageChange(view.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-all shrink-0",
                    isActive
                      ? "border-primary/50 bg-primary/10 text-primary font-medium ring-1 ring-primary/20"
                      : "border-border/30 bg-transparent text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/20",
                  )}
                >
                  <view.Icon className="h-3.5 w-3.5 text-info shrink-0" />
                  <span>{view.label}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function WorkflowStageMenuItem({
  stage,
  active,
  onClick,
}: {
  stage: WorkflowStageReadiness;
  active: boolean;
  onClick: () => void;
}) {
  const Icon =
    stage.status === "ready"
      ? CheckCircle2
      : stage.status === "active"
        ? Clock
        : AlertCircle;
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn(
        "items-start gap-3 py-2",
        stage.status === "ready" && "bg-success/8 text-success",
        stage.status === "active" && "bg-warning/12 text-warning",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4",
          stage.status === "ready"
            ? "text-success"
            : stage.status === "active"
              ? "text-warning"
              : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {stage.label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {stage.status === "ready"
            ? (stage.completed[0] ?? "已完成")
            : (stage.missing[0] ?? stage.actionLabel)}
        </span>
      </span>
      {active ? (
        <Check className="ml-auto mt-0.5 h-4 w-4 text-primary" />
      ) : null}
    </DropdownMenuItem>
  );
}
