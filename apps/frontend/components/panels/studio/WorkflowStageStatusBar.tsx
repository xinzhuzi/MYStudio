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
  Check,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="mb-4 rounded-lg border border-border/70 bg-card/80 px-4 py-3 shadow-sm">
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        stage.status === "ready" && "bg-emerald-500/8 text-emerald-900",
        stage.status === "active" && "bg-amber-500/12 text-amber-950",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4",
          stage.status === "ready"
            ? "text-emerald-500"
            : stage.status === "active"
              ? "text-amber-500"
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
