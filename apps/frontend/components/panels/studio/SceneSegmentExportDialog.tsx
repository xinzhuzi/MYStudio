import { Loader2 } from "lucide-react";
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
import type { SceneStoryboardGroup } from "@/lib/studio/remotion/scene-segments";

/**
 * 按场分段导出选单 Dialog（仿批量超分范式：勾选 + 确认即关，长任务在
 * 队列后台跑，进度非模态展示）。导出走 Remotion chapter composition 的
 * frameRange 范围渲染，与整章成片同口径（转场/字幕/混音一致）。
 */
export function SceneSegmentExportDialog({
  open,
  onOpenChange,
  scenes,
  selection,
  onSelectionChange,
  onStart,
  exporting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenes: SceneStoryboardGroup[];
  selection: Set<number>;
  onSelectionChange: (next: Set<number>) => void;
  onStart: (selectedSceneNos: number[]) => void;
  exporting: boolean;
}) {
  const allSelected = scenes.length > 0 && scenes.every((scene) => selection.has(scene.sceneNo));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-scene-segment-export-dialog>
        <DialogHeader>
          <DialogTitle>按场分段导出</DialogTitle>
          <DialogDescription>
            每场输出一个 MP4，与整章成片同口径（Remotion 渲染，含转场/字幕/混音）。队列串行渲染，总量约等于多渲一遍本章。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          <label className="flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted/50">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => {
                onSelectionChange(checked === true ? new Set(scenes.map((scene) => scene.sceneNo)) : new Set());
              }}
              aria-label="全选场次"
            />
            全选（{scenes.length} 场）
          </label>
          {scenes.map((scene) => (
            <label
              key={scene.sceneNo}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
              data-scene-segment-row={scene.sceneNo}
            >
              <Checkbox
                checked={selection.has(scene.sceneNo)}
                onCheckedChange={(checked) => {
                  const next = new Set(selection);
                  if (checked === true) next.add(scene.sceneNo);
                  else next.delete(scene.sceneNo);
                  onSelectionChange(next);
                }}
                aria-label={`导出场 ${scene.sceneNo}`}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">场 {scene.sceneNo}</span> · {scene.sceneName || "未命名"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {scene.shotCount} 镜{typeof scene.durationSeconds === "number" ? ` · 约 ${Math.round(scene.durationSeconds)}s` : ""}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            size="sm"
            data-scene-segment-export-start
            disabled={exporting || selection.size === 0}
            onClick={() => onStart([...selection])}
          >
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            导出 {selection.size > 0 ? `${selection.size} 场` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 非模态进度列表：每场一条队列 job 状态（不锁 UI）。 */
export function SceneSegmentExportProgress({
  items,
}: {
  items: Array<{
    segment: { sceneNo: number; sceneName: string };
    status: string;
    progress: number;
  }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs" data-scene-segment-export-progress>
      <div className="mb-1 font-medium">场分段渲染中 · {items.length} 个</div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={`${item.segment.sceneNo}-${item.status}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">场 {item.segment.sceneNo} · {item.segment.sceneName || "未命名"}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.status === "succeeded" ? "完成" : item.status === "failed" ? "失败" : `${Math.round(item.progress * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
