import { useEffect, useState } from "react";
import { Grid2x2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * 切图对话框(09-01-extraction-split-reverse):行×列(1-4)把图均分,
 * 确认后由画布层经 infra 管线逐格落血缘参考节点。
 * 交互形态参考 infinite-canvas 切图设计,实现从零(AGPL)。
 */
export function SplitGridDialog({
  open,
  imageUrl,
  sourceTitle,
  onClose,
  onConfirm,
}: {
  open: boolean;
  imageUrl: string | null;
  sourceTitle: string;
  onClose: () => void;
  onConfirm: (rows: number, cols: number) => void;
}) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);

  useEffect(() => {
    if (open) {
      setRows(2);
      setCols(2);
    }
  }, [open]);

  return (
    <Dialog open={open && Boolean(imageUrl)} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>切图「{sourceTitle}」</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center">
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-border">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="block max-h-[52vh] max-w-full" draggable={false} />
            ) : null}
            {/* 网格预览线 */}
            <div className="pointer-events-none absolute inset-0">
              {Array.from({ length: cols - 1 }, (_, index) => (
                <div
                  key={`v${index}`}
                  className="absolute inset-y-0 w-px bg-white/70"
                  style={{ left: `${((index + 1) / cols) * 100}%` }}
                />
              ))}
              {Array.from({ length: rows - 1 }, (_, index) => (
                <div
                  key={`h${index}`}
                  className="absolute inset-x-0 h-px bg-white/70"
                  style={{ top: `${((index + 1) / rows) * 100}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <Stepper label="行" value={rows} onChange={setRows} />
            <Stepper label="列" value={cols} onChange={setCols} />
          </div>
          <span>将切为 {rows * cols} 张,各落一张血缘参考图</span>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
            取消
          </Button>
          <Button onClick={() => onConfirm(rows, cols)}>
            <Grid2x2 className="h-4 w-4" />
            确认切图
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-label={`${label} 减一`} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
          −
        </Button>
        <span className="w-6 text-center text-sm font-semibold tabular-nums text-foreground">{value}</span>
        <Button size="sm" variant="ghost" aria-label={`${label} 加一`} disabled={value >= 4} onClick={() => onChange(Math.min(4, value + 1))}>
          +
        </Button>
      </div>
    </div>
  );
}
