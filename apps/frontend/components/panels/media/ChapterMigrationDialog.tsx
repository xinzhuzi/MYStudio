// 产物中心「章节整理」对话框:把旧平铺分镜目录迁入章节子目录,并同步改写全库引用。
// 面向用户的操作说明即本对话框正文(是什么/做什么/安全性),执行结果即时反馈。
import { useCallback, useMemo, useState } from "react";
import { FolderInput, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useChapterArtifactMigration, type ChapterMigrationRunResult } from "./use-chapter-artifact-migration";

export function ChapterMigrationDialog({
  projectId,
  onClose,
  onFinished,
}: {
  projectId: string | null | undefined;
  onClose: () => void;
  onFinished?: () => void;
}) {
  const { scan, run } = useChapterArtifactMigration(projectId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ChapterMigrationRunResult | null>(null);

  const summary = useMemo(() => {
    const { plans } = scan();
    return {
      count: plans.length,
      refs: plans.reduce((total, plan) => total + plan.urlCount, 0),
      chapters: [...new Set(plans.map((plan) => plan.chapterId))].sort(),
    };
  }, [scan]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const runResult = await run();
      setResult(runResult);
      if (runResult.status === "done") onFinished?.();
    } finally {
      setRunning(false);
    }
  }, [run, onFinished]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5 text-primary" />
            章节整理
          </DialogTitle>
          <DialogDescription className="text-left space-y-2 pt-1">
            <p>
              早期版本的分镜工作流图片平铺存放在 <code className="text-xs bg-muted px-1 rounded">workflow-images/</code> 根目录;
              当前版本按章节归档——公共资源留在根目录,章节产物进入
              <code className="text-xs bg-muted px-1 rounded">workflow-images/chapter-XXX/</code> 子目录。
            </p>
            <p>
              本操作会把旧布局的分镜目录整体移入对应章节子目录,并同步更新分镜表、素材库与生成台账中的全部引用。
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>同盘改名,不复制数据,不改动图片内容</li>
              <li>任何一步失败会自动还原已移动的目录</li>
              <li>可重复执行:已整理过的目录会自动跳过</li>
              <li>建议在空闲时段执行;执行中请勿同时进行渲染任务</li>
            </ul>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          {summary.count > 0 ? (
            <div className="space-y-1">
              <div>
                检测到 <span className="font-medium text-foreground">{summary.count}</span> 个待整理工作流目录
                (涉及 {summary.chapters.join("、")}),
                共 <span className="font-medium text-foreground">{summary.refs}</span> 处引用将被更新。
              </div>
            </div>
          ) : (
            <div>当前项目的分镜产物均已按章节归档,无需整理。</div>
          )}
        </div>

        {result && (
          <div className="rounded-md border px-4 py-3 text-sm" role="status">
            {result.status === "clean" && <div>无需整理:未检测到旧布局的分镜产物。</div>}
            {result.status === "done" && (
              <div>
                整理完成:已移动 <span className="font-medium">{result.moved}</span> 个目录,
                更新 <span className="font-medium">{result.refsReplaced}</span> 处引用。
              </div>
            )}
            {result.status === "failed" && (
              <div className="text-destructive">
                整理未完成:{result.error}
                {result.rolledBack > 0 && <span className="block">(已自动还原 {result.rolledBack} 个目录)</span>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>关闭</Button>
          <Button onClick={() => void handleRun()} disabled={running || summary.count === 0 || !projectId}>
            {running ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />整理中…</> : "开始整理"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
