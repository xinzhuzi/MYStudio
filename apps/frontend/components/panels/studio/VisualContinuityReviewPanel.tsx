import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { HumanVisualReviewInput, StoryboardItem } from "@/types/studio";
import { toPreviewSrc } from "./WorkflowNodePreviews";

type VisualContinuityReviewPanelProps = {
  storyboards: StoryboardItem[];
  onReview: (storyboardId: string, review: HumanVisualReviewInput) => void;
};

export function VisualContinuityReviewPanel({ storyboards, onReview }: VisualContinuityReviewPanelProps) {
  const ordered = useMemo(
    () => [...storyboards].sort((left, right) => left.index - right.index),
    [storyboards],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const selectedPosition = Math.max(0, ordered.findIndex((item) => item.id === selectedId));
  const selected = ordered[selectedPosition];
  const previous = selectedPosition > 0 ? ordered[selectedPosition - 1] : undefined;
  const next = selectedPosition < ordered.length - 1 ? ordered[selectedPosition + 1] : undefined;
  const [checkedCharacters, setCheckedCharacters] = useState<string[]>([]);
  const [scenePassed, setScenePassed] = useState(false);
  const [transitionPassed, setTransitionPassed] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    if (!ordered.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !ordered.some((item) => item.id === selectedId)) {
      setSelectedId(ordered.find((item) => item.visualReview?.status !== "approved")?.id ?? ordered[0]!.id);
    }
  }, [ordered, selectedId]);

  useEffect(() => {
    setCheckedCharacters([]);
    setScenePassed(false);
    setTransitionPassed(false);
    setRejectionReason("");
  }, [selected?.id]);

  if (!selected) return null;

  const characterIds = [...new Set(selected.continuityState?.characters.map((item) => item.characterId) ?? [])];
  const requiresTransition = Boolean(selected.continuityState?.previousStoryboardId);
  const hasCurrentImage = Boolean(selected.mediaRef?.path);
  const canApprove = hasCurrentImage
    && !selected.stale
    && Boolean(selected.continuityState)
    && Boolean(selected.continuityState?.sceneVersionId)
    && scenePassed
    && (!requiresTransition || transitionPassed)
    && characterIds.every((id) => checkedCharacters.includes(id));
  const statusCounts = ordered.reduce(
    (counts, item) => {
      counts[item.visualReview?.status ?? "pending"] += 1;
      return counts;
    },
    { pending: 0, approved: 0, rejected: 0 },
  );

  const submit = (status: "approved" | "rejected") => {
    onReview(selected.id, {
      status,
      reasons: status === "rejected" ? [rejectionReason] : [],
      characterChecks: characterIds.map((characterId) => ({
        characterId,
        passed: checkedCharacters.includes(characterId),
      })),
      sceneChecks: selected.continuityState?.sceneVersionId
        ? [{ sceneVersionId: selected.continuityState.sceneVersionId, passed: scenePassed }]
        : [],
      transitionChecks: requiresTransition
        ? [{ previousStoryboardId: selected.continuityState?.previousStoryboardId, passed: transitionPassed }]
        : [],
      evidencePaths: selected.mediaRef?.path ? [selected.mediaRef.path] : [],
    });
  };

  return (
    <section
      aria-label="分镜视觉连续性人工审核"
      className="overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-[linear-gradient(110deg,rgba(39,39,42,.96),rgba(9,9,11,.98))] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Eye className="h-4 w-4 text-amber-300" />
            分镜视觉连续性人工审核
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">逐镜核对身份、场景和动作承接；未人工批准的镜头不能进入最终成片。</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200">待审 {statusCounts.pending}</Badge>
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">通过 {statusCounts.approved}</Badge>
          <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-200">驳回 {statusCounts.rejected}</Badge>
        </div>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 bg-black/35 p-2" aria-label="选择待审核分镜">
        {ordered.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={`审核第 ${item.index} 镜`}
            aria-pressed={item.id === selected.id}
            onClick={() => setSelectedId(item.id)}
            className={cn(
              "h-8 min-w-10 rounded border px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-300",
              item.id === selected.id
                ? "border-amber-300 bg-amber-300 text-zinc-950"
                : item.visualReview?.status === "approved"
                  ? "border-emerald-700/70 bg-emerald-950/40 text-emerald-200"
                  : item.visualReview?.status === "rejected"
                    ? "border-red-700/70 bg-red-950/40 text-red-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500",
            )}
          >
            {String(item.index).padStart(2, "0")}
          </button>
        ))}
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <FrameEvidence label="上一镜" storyboard={previous} muted />
            <FrameEvidence label="当前镜" storyboard={selected} current />
            <FrameEvidence label="下一镜" storyboard={next} muted />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!previous}
              onClick={() => previous && setSelectedId(previous.id)}
              aria-label="审核上一镜"
            >
              <ChevronLeft className="h-4 w-4" />上一镜
            </Button>
            <div className="min-w-0 text-center">
              <div className="truncate text-xs font-medium">第 {selected.index} 镜 · {selected.continuityState?.groupId ?? "未分组"}</div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-500">{selected.videoDesc || selected.prompt}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!next}
              onClick={() => next && setSelectedId(next.id)}
              aria-label="审核下一镜"
            >
              下一镜<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <ReviewWarnings storyboard={selected} />
          <div className="space-y-2" aria-label="视觉检查项">
            {characterIds.map((characterId) => (
              <ReviewCheck
                key={characterId}
                label={`角色 ${characterId} 的脸、服装和体型一致`}
                checked={checkedCharacters.includes(characterId)}
                onCheckedChange={(checked) => setCheckedCharacters((current) => checked
                  ? [...new Set([...current, characterId])]
                  : current.filter((id) => id !== characterId))}
              />
            ))}
            <ReviewCheck
              label={`场景 ${selected.continuityState?.sceneVersionId ?? "未设置"} 的布局、光线和色调一致`}
              checked={scenePassed}
              onCheckedChange={setScenePassed}
            />
            {requiresTransition ? (
              <ReviewCheck
                label={`与上一镜 ${selected.continuityState?.previousStoryboardId} 的方向和动作连续`}
                checked={transitionPassed}
                onCheckedChange={setTransitionPassed}
              />
            ) : null}
          </div>
          <div>
            <label htmlFor={`visual-review-reason-${selected.id}`} className="text-[11px] font-medium text-zinc-300">驳回原因</label>
            <Textarea
              id={`visual-review-reason-${selected.id}`}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="指出具体换脸、服装、体型、空间或动作问题"
              className="mt-1 min-h-20 border-zinc-700 bg-black/25 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectionReason.trim()}
              onClick={() => submit("rejected")}
              aria-label={`驳回第 ${selected.index} 镜`}
            >
              <XCircle className="h-4 w-4" />驳回
            </Button>
            <Button
              type="button"
              disabled={!canApprove}
              onClick={() => submit("approved")}
              aria-label={`批准第 ${selected.index} 镜`}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <CheckCircle2 className="h-4 w-4" />人工批准
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FrameEvidence({
  label,
  storyboard,
  current = false,
  muted = false,
}: {
  label: string;
  storyboard?: StoryboardItem;
  current?: boolean;
  muted?: boolean;
}) {
  return (
    <figure className={cn(
      "overflow-hidden rounded-lg border bg-black",
      current ? "border-amber-300/80 ring-1 ring-amber-300/25" : "border-zinc-800",
      muted && "opacity-75",
    )}>
      <figcaption className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-400">
        <span>{label}</span><span>{storyboard ? `#${storyboard.index}` : "—"}</span>
      </figcaption>
      <div className="aspect-video bg-[radial-gradient(circle_at_50%_45%,#27272a,#09090b_70%)]">
        {storyboard?.mediaRef?.path ? (
          <img
            src={toPreviewSrc(storyboard.mediaRef.path)}
            alt={`${label}第 ${storyboard.index} 镜画面`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">无画面证据</div>
        )}
      </div>
    </figure>
  );
}

function ReviewCheck({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-black/20 px-2.5 py-2 text-[11px] leading-4 text-zinc-300">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={label}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  );
}

function ReviewWarnings({ storyboard }: { storyboard: StoryboardItem }) {
  const reasons = [
    ...(storyboard.visualReview?.reasons ?? []),
    ...(storyboard.stale ? [storyboard.staleReason || "镜头已过期，必须重新生成"] : []),
    ...(!storyboard.mediaRef?.path ? ["缺少当前镜画面证据"] : []),
    ...(!storyboard.continuityState ? ["缺少连续镜头状态"] : []),
  ];
  return (
    <div className={cn(
      "rounded-md border px-2.5 py-2 text-[11px]",
      reasons.length ? "border-amber-600/40 bg-amber-950/30 text-amber-200" : "border-zinc-800 bg-black/20 text-zinc-400",
    )}>
      <div className="flex items-center gap-1.5 font-medium">
        {reasons.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
        {storyboard.visualReview?.status === "approved" ? "已有人工作出批准记录" : "当前审核状态"}
      </div>
      <div className="mt-1">{reasons.join("；") || "无已记录问题；仍需逐项人工勾选确认。"}</div>
    </div>
  );
}
