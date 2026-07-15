import { ArrowLeft, GitBranch, Save, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageWorkflowScopedPendingProps {
  projectName: string;
  sourceLabel: string;
  sourceStageLabel?: string;
  writebackTargetLabel: string;
  onBack?: () => void;
}

export function ImageWorkflowScopedPending({
  projectName,
  sourceLabel,
  sourceStageLabel,
  writebackTargetLabel,
  onBack,
}: ImageWorkflowScopedPendingProps) {
  const sourceSummary = sourceStageLabel
    ? `${sourceStageLabel} / ${sourceLabel}`
    : sourceLabel;

  return (
    <section className="grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="relative min-w-0 overflow-hidden bg-muted/20">
        <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/92 p-2 text-card-foreground shadow-lg backdrop-blur">
          {onBack ? (
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Button>
          ) : null}
          <div className={cn("flex min-w-[180px] flex-1 items-center text-xs", onBack ? "border-l border-border pl-2" : "")}>
            <span className="shrink-0 text-muted-foreground">来源</span>
            <span className="ml-2 truncate font-medium">{sourceSummary}</span>
          </div>
          <div className="flex min-w-[180px] max-w-[320px] items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100">
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-cyan-200/75">回写目标</span>
            <span className="truncate font-medium">{writebackTargetLabel}</span>
          </div>
          <Button size="sm" disabled>
            <WandSparkles className="h-3.5 w-3.5" />
            运行生成
          </Button>
          <Button size="sm" variant="secondary" disabled>
            <Save className="h-3.5 w-3.5" />
            写回目标
          </Button>
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <div className="max-w-sm rounded-md border border-border bg-card/92 px-4 py-3 text-sm text-card-foreground shadow-lg backdrop-blur">
            <div className="font-semibold">正在打开当前图片工作流</div>
            <div className="mt-1 text-xs text-muted-foreground">
              稍候将只显示当前节点的参考图、提示词和生成结果。
            </div>
          </div>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-200" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">当前节点图片工作流</h3>
              <p className="text-[11px] text-muted-foreground">{projectName}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2" data-scoped-image-workflow-summary>
            <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">来源</div>
              <div className="mt-1 truncate">{sourceSummary}</div>
            </div>
            <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">回写目标</div>
              <div className="mt-1 truncate">{writebackTargetLabel}</div>
            </div>
          </div>
        </div>
      </aside>
    </section>
  );
}
