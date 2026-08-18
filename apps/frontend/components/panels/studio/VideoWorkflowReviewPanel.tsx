import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoWorkflowReviewReplyV1 } from "@rendering/contracts/video-workflow-ipc";
import { ChapterQcReportCard } from "./ChapterQcReportCard";

export function VideoWorkflowReviewPanel(props: {
  projectId?: string;
  chapterId: string;
  revision?: number;
  onAccepted?: () => Promise<void>;
}) {
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<VideoWorkflowReviewReplyV1>();
  const [applyError, setApplyError] = useState<string>();
  const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;
  const hasRevision = Number.isInteger(props.revision) && (props.revision ?? 0) > 0;
  const reviewResult = applyError
    ? "blocked"
    : reply?.success
      ? "accepted"
      : reply
        ? "blocked"
        : "pending";

  useEffect(() => {
    setApplyError(undefined);
  }, [props.revision]);

  async function confirm() {
    if (!bridge || !props.projectId || !props.chapterId || !hasRevision || !reviewer.trim()) return;
    const revision = props.revision!;
    setBusy(true);
    setApplyError(undefined);
    try {
      const next = await bridge.review({
        projectId: props.projectId,
        chapterId: props.chapterId,
        revision,
        reviewer: reviewer.trim(),
      });
      setReply(next);
      if (next.success && props.onAccepted) {
        try {
          await props.onAccepted();
        } catch (error) {
          setApplyError(error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      setReply({
        schemaVersion: 1,
        success: false,
        projectId: props.projectId,
        chapterId: props.chapterId,
        revision,
        status: "blocked",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="video-use 用户确认"
      className="rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-4 py-3 text-xs"
      data-video-use-review
      data-video-use-review-pending={String(reviewResult === "pending")}
      data-video-use-review-result={reviewResult}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">video-use 预览确认</span>
        <span
          className={reply?.success ? "text-emerald-400" : "text-muted-foreground"}
          data-video-use-review-status
        >
          {reply?.success ? "已确认" : "等待确认"}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        先在 video-use preview/self-eval 中检查当前 revision；未确认时 HyperFrames 和 Remotion ChapterVideo 会保持 blocked。revision 由当前预览锁定，确认只写入该 revision 的 review sidecar，不会改写原始预览。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <label className="grid gap-1 text-muted-foreground">
          确认人
          <input
            aria-label="video-use 确认人"
            className="h-8 rounded border border-border bg-background px-2 text-foreground"
            value={reviewer}
            onChange={(event) => setReviewer(event.currentTarget.value)}
            placeholder="例如：张三"
          />
        </label>
        <div className="grid gap-1 text-muted-foreground">
          revision
          <output
            aria-label="video-use revision"
            className="flex h-8 items-center rounded border border-border bg-muted/30 px-2 text-foreground"
            data-video-use-review-revision={hasRevision ? String(props.revision) : ""}
          >
            {hasRevision ? props.revision : "-"}
          </output>
        </div>
        <Button
          size="sm"
          data-video-use-review-confirm
          onClick={() => { void confirm(); }}
          disabled={busy || !bridge || !props.projectId || !hasRevision || !reviewer.trim()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          确认当前预览
        </Button>
      </div>
      {!props.projectId ? <p className="mt-2 text-muted-foreground">请先选择项目；当前章节身份未就绪。</p> : null}
      {!hasRevision ? <p className="mt-2 text-muted-foreground">请先运行 video-use 章节预览，再确认对应 revision。</p> : null}
      {reply && !reply.success ? <p className="mt-2 text-destructive" role="alert">{reply.message ?? "video-use 确认被阻塞"}</p> : null}
      {reply?.success && !applyError ? <p className="mt-2 text-emerald-400">已写入 review sidecar：{reply.artifactPath ?? "当前 revision"}</p> : null}
      {applyError ? <p className="mt-2 text-destructive" role="alert">确认已写入，但后续 HyperFrames/EditingProject 应用被阻塞：{applyError}</p> : null}
      <div className="mt-3">
        <ChapterQcReportCard projectId={props.projectId} chapterId={props.chapterId} />
      </div>
    </section>
  );
}
