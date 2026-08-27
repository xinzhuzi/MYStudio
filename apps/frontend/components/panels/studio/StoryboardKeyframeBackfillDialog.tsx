import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardKeyframe } from "@/types/studio";

/**
 * 回接旧镜图对话框(M3c/Trellis 08-27 keyframe-sequence)。
 * 导入回接脚本产出的 mapping.json(storyboard-keyframe-backfill.mjs),
 * 逐镜预览分配(帧/来源/置信)→ 人工确认 → setStoryboardKeyframes(reason=backfill)
 * 写入。只处理当前尚无 keyframes 的镜(幂等);置信度低/缺帧镜标黄提示走帧规划器补。
 */

interface BackfillMappingRow {
  shotId: string;
  index: number;
  durationUs: number;
  frames: Array<{
    frameId: string;
    legacyIndex: number;
    path: string;
    inUs: number;
    confidence: string;
  }>;
  candidateCount: number;
}

interface BackfillMappingFile {
  summary?: { highConfidenceRatio?: number; framesReused?: number };
  mapping?: BackfillMappingRow[];
}

const CONFIDENCE_CLASS: Record<string, string> = {
  high: "text-success",
  medium: "text-warning",
  low: "text-destructive",
};

export function StoryboardKeyframeBackfillDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mapping, setMapping] = useState<BackfillMappingRow[] | null>(null);
  const [summary, setSummary] = useState<BackfillMappingFile["summary"]>(undefined);
  const [error, setError] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  const storyboardsById = useStudioStore((state) => state.storyboards);
  const applicable = useMemo(() => {
    if (!mapping) return [];
    return mapping.filter((row) => {
      const shot = storyboardsById.find((item) => item.id === row.shotId);
      return Boolean(shot) && !shot?.keyframes?.length && row.frames.length > 0;
    });
  }, [mapping, storyboardsById]);

  const onFile = async (file: File) => {
    setError(undefined);
    setAppliedCount(null);
    try {
      const parsed = JSON.parse(await file.text()) as BackfillMappingFile;
      if (!Array.isArray(parsed.mapping)) {
        throw new Error("mapping.json 缺少 mapping 数组(请用 storyboard-keyframe-backfill.mjs 生成)");
      }
      setMapping(parsed.mapping);
      setSummary(parsed.summary);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "文件解析失败");
      setMapping(null);
    }
  };

  const apply = () => {
    if (!applicable.length) return;
    setApplying(true);
    let applied = 0;
    for (const row of applicable) {
      const frames: StoryboardKeyframe[] = row.frames.map((frame, frameIndex) => ({
        frameId: frame.frameId,
        mediaRef: { kind: "image", path: frame.path },
        inUs: frameIndex === 0 ? 0 : frame.inUs,
        origin: { kind: "legacy-shot", legacyIndex: frame.legacyIndex },
      }));
      try {
        useStudioStore.getState().setStoryboardKeyframes(row.shotId, frames, "backfill");
        applied += 1;
      } catch {
        // 单镜失败不阻断整批(校验拒绝的镜保持单帧态,人审后走帧规划器)
      }
    }
    setApplying(false);
    setAppliedCount(applied);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] w-[min(880px,92vw)] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-card-foreground">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-lg font-bold">回接旧镜图 → 关键帧序列</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            导入回接脚本的 mapping.json,人工确认分配后写入。仅处理当前尚无关键帧的镜;写入即触发审核指纹重置(门禁纪律)。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground hover:border-primary/50">
            <FileUp className="h-4 w-4" />
            选择 mapping.json(storyboard-keyframe-backfill.mjs 产出)
            <input
              type="file"
              accept="application/json"
              className="hidden"
              data-backfill-file-input
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>

          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}

          {mapping ? (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                回接 {summary?.framesReused ?? "?"} 帧 · 高置信{" "}
                {summary?.highConfidenceRatio != null ? `${(summary.highConfidenceRatio * 100).toFixed(1)}%` : "?"}
                {" "}· 本次可写入 <span className="font-semibold text-foreground">{applicable.length}</span> 镜(已有帧序列的镜跳过)
              </p>
              <table className="mt-3 w-full min-w-[640px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2">镜</th>
                    <th className="px-2 py-2">帧</th>
                    <th className="px-2 py-2">来源旧镜 · inUs · 置信</th>
                    <th className="px-2 py-2">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((row) => {
                    const shot = storyboardsById.find((item) => item.id === row.shotId);
                    const isApplicable = applicable.some((entry) => entry.shotId === row.shotId);
                    return (
                      <tr key={row.shotId} className="border-b border-border/30">
                        <td className="px-2 py-2 font-mono">S{String(row.index).padStart(2, "0")}</td>
                        <td className="px-2 py-2">{row.frames.length}</td>
                        <td className="px-2 py-2">
                          {row.frames.map((frame) => (
                            <span key={frame.frameId} className="mr-2">
                              旧{frame.legacyIndex}
                              <span className="text-muted-foreground"> · {Math.round(frame.inUs / 1000)}ms</span>
                              <span className={`${CONFIDENCE_CLASS[frame.confidence] ?? ""} ml-0.5`}>
                                {frame.confidence}
                              </span>
                            </span>
                          ))}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {!shot ? "不在当前章节" : isApplicable ? "待写入" : "已有帧序列,跳过"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground" data-backfill-apply-result>
            {appliedCount != null ? `已写入 ${appliedCount} 镜(校验失败的镜保持单帧态,可走帧规划器补槽)` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
            <Button
              size="sm"
              data-backfill-apply
              disabled={!applicable.length || applying || appliedCount != null}
              onClick={apply}
            >
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              确认写入 {applicable.length} 镜
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
