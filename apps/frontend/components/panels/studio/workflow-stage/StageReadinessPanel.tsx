import type {
  WorkflowReadiness,
  WorkflowStageReadiness,
} from "@/lib/studio/workflow-readiness";
import { Check, Image as ImageIcon } from "lucide-react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 纯视图 tab(不在 readiness 流水线):面板「工作流视图」组入口。
 * 分镜面板刻意不在此列——唯一入口是节点图「分镜面板」节点的「进入」按钮
 * (2026-08-23 用户裁定:其他位置不得出现进入分镜面板的途径)。 */
const WORKFLOW_VIEW_ITEMS = [{ id: "imageWorkflow", label: "图像节点图" }] as const;

/** 悬浮球面板:6 阶段完整就绪清单 + 阶段切换入口(横幅下拉的升级接班)。 */
export function StageReadinessPanel({
  readiness,
  activeStage,
  onStageChange,
  onClose,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
  onClose: () => void;
}) {
  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];

  return (
    <div className="flex max-h-[60vh] flex-col">
      <div className="px-1 pb-2">
        <p className="text-sm font-semibold text-foreground">
          待推进：{currentStage?.label ?? "工作流"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {readiness.nextActionLabel}
        </p>
      </div>
      <div
        className="flex-1 overflow-y-auto"
        role="group"
        aria-label="切换阶段"
      >
        <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          切换阶段
        </p>
        {readiness.stages.map((stage) => (
          <StageItem
            key={stage.id}
            stage={stage}
            active={stage.id === activeStage}
            onSelect={() => {
              onStageChange(stage.id);
              onClose();
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
              "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
              view.id === activeStage && "bg-accent/60",
            )}
            onClick={() => {
              onStageChange(view.id);
              onClose();
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
      </div>
    </div>
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
        "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
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
