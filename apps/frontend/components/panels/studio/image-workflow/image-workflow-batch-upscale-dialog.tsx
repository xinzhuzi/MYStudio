import { Loader2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { ImageWorkflowGeneratedNode } from "@/types/studio";

/** 批量超分进度浮层形态(use-image-workflow-upscale 的 UpscaleBatchState)。 */
export interface BatchUpscaleProgressState {
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  currentNodeTitle?: string;
}

/**
 * 批量超分勾选 Dialog + 进行中进度浮层(T2 自 Canvas 抽取,行为零变化)。
 * 两者同源(一次批量任务的选单与执行反馈),故同组件导出。
 */
export function ImageWorkflowBatchUpscaleDialog({
  open,
  onOpenChange,
  upscalableNodes,
  selection,
  onSelectionChange,
  onStart,
  denoise = false,
  onDenoiseChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upscalableNodes: ImageWorkflowGeneratedNode[];
  selection: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onStart: () => void;
  /** 轻度去噪预处理开关(超分前压斑驳噪点;缺省关,存量行为不变)。 */
  denoise?: boolean;
  onDenoiseChange?: (next: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>批量超分 4K</DialogTitle>
          <DialogDescription>
            勾选要放大的成图节点(本地 Real-ESRGAN 原生 ×4,逐张顺序执行,可随时取消)。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto" data-image-workflow-batch-upscale-list>
          {upscalableNodes.map((node) => (
            <label
              key={node.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
            >
              <Checkbox
                checked={selection.has(node.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(selection);
                  if (checked) next.add(node.id);
                  else next.delete(node.id);
                  onSelectionChange(next);
                }}
              />
              <span className="min-w-0 truncate">{node.title || node.id}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{node.status}</span>
            </label>
          ))}
        </div>
        {onDenoiseChange ? (
          <label
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
            data-image-workflow-batch-upscale-denoise
          >
            <Checkbox
              checked={denoise}
              onCheckedChange={(checked) => onDenoiseChange(checked === true)}
            />
            <span>先去噪（轻度，压掉斑驳噪点再放大）</span>
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={onStart} disabled={selection.size === 0}>
            <ZoomIn className="mr-1 h-3.5 w-3.5" />
            超分 {selection.size} 张
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImageWorkflowBatchUpscaleProgress({
  state,
  onCancel,
}: {
  state: BatchUpscaleProgressState;
  onCancel: () => void;
}) {
  if (!state.running) return null;
  return (
    <div
      className="absolute bottom-4 right-4 z-30 w-[320px] rounded-lg border border-border bg-card p-3"
      data-image-workflow-batch-upscale-progress
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="truncate">批量超分：{state.currentNodeTitle ?? "…"}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {state.completed + state.failed}/{state.total}
        </span>
      </div>
      <Progress
        value={
          state.total > 0
            ? ((state.completed + state.failed) / state.total) * 100
            : 0
        }
      />
      {state.failed > 0 ? (
        <p className="mt-1.5 text-xs text-destructive">失败 {state.failed} 张(已跳过,继续处理)</p>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消剩余
        </Button>
      </div>
    </div>
  );
}
