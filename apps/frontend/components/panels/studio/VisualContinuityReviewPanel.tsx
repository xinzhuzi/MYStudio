import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  continuityAssetSafeReviewEvidencePaths,
  isContinuityAssetVersionApproved,
  normalizeOrderedReferences,
  storyboardContinuityStateIssues,
  storyboardPrimarySceneIssues,
  storyboardReferenceApprovalIssues,
} from "@/lib/studio/visual-continuity";
import { cn } from "@/lib/utils";
import type {
  ContinuityAssetVersion,
  HumanContinuityAssetApprovalInput,
  HumanVisualReviewInput,
  StoryboardItem,
  StoryboardOrderedReference,
} from "@/types/studio";
import { toPreviewSrc } from "./WorkflowNodePreviews";

type VisualContinuityReviewPanelProps = {
  storyboards: StoryboardItem[];
  continuityAssetVersions: ContinuityAssetVersion[];
  onReview: (storyboardId: string, review: HumanVisualReviewInput) => void;
  onReviewAsset: (
    assetId: string,
    versionId: string,
    review: HumanContinuityAssetApprovalInput,
  ) => void;
};

export function VisualContinuityReviewPanel({
  storyboards,
  continuityAssetVersions,
  onReview,
  onReviewAsset,
}: VisualContinuityReviewPanelProps) {
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
  const [checkedProps, setCheckedProps] = useState<string[]>([]);
  const [scenePassed, setScenePassed] = useState(false);
  const [transitionPassed, setTransitionPassed] = useState(false);
  const [textWatermarkPassed, setTextWatermarkPassed] = useState(false);
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
    setCheckedProps([]);
    setScenePassed(false);
    setTransitionPassed(false);
    setTextWatermarkPassed(false);
    setRejectionReason("");
  }, [selected?.id]);

  if (!selected) return null;

  const characterIds = [...new Set(selected.continuityState?.characters.map((item) => item.characterId) ?? [])];
  const propReferences = selected.orderedReferenceManifest?.filter(
    (reference) => reference.referenceRole === "prop-state",
  ) ?? [];
  const assetApprovalIssues = storyboardReferenceApprovalIssues(selected, continuityAssetVersions);
  const continuityStateIssues = storyboardContinuityStateIssues(selected);
  const primarySceneIssues = storyboardPrimarySceneIssues(selected);
  const requiresTransition = Boolean(selected.continuityState?.previousStoryboardId);
  const hasCurrentImage = Boolean(selected.mediaRef?.path);
  const canApprove = hasCurrentImage
    && !selected.stale
    && Boolean(selected.continuityState)
    && Boolean(selected.continuityState?.sceneVersionId)
    && scenePassed
    && (!requiresTransition || transitionPassed)
    && characterIds.every((id) => checkedCharacters.includes(id))
    && propReferences.every((reference) => checkedProps.includes(`${reference.assetId}:${reference.versionId ?? ""}`))
    && textWatermarkPassed
    && continuityStateIssues.length === 0
    && assetApprovalIssues.length === 0
    && primarySceneIssues.length === 0;
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
      propChecks: propReferences.map((reference) => ({
        assetId: reference.assetId,
        versionId: reference.versionId,
        passed: checkedProps.includes(`${reference.assetId}:${reference.versionId ?? ""}`),
      })),
      transitionChecks: requiresTransition
        ? [{ previousStoryboardId: selected.continuityState?.previousStoryboardId, passed: transitionPassed }]
        : [],
      textWatermarkCheck: { passed: textWatermarkPassed },
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
          <CanonicalAssetEvidence
            references={normalizeOrderedReferences(selected.orderedReferenceManifest)}
            versions={continuityAssetVersions}
            onReviewAsset={onReviewAsset}
          />
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
          <ReviewWarnings
            storyboard={selected}
            contractReasons={[
              ...continuityStateIssues,
              ...assetApprovalIssues,
              ...primarySceneIssues,
            ].map((issue) => issue.message)}
          />
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
            {propReferences.map((reference) => (
              <ReviewCheck
                key={`${reference.assetId}:${reference.versionId ?? ""}`}
                label={`道具 ${reference.assetId} 的状态和摆放一致`}
                checked={checkedProps.includes(`${reference.assetId}:${reference.versionId ?? ""}`)}
                onCheckedChange={(checked) => setCheckedProps((current) => checked
                  ? [...new Set([...current, `${reference.assetId}:${reference.versionId ?? ""}`])]
                  : current.filter((id) => id !== `${reference.assetId}:${reference.versionId ?? ""}`))}
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
            <ReviewCheck
              label="文字与水印检查通过"
              checked={textWatermarkPassed}
              onCheckedChange={setTextWatermarkPassed}
            />
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

function CanonicalAssetEvidence({
  references,
  versions,
  onReviewAsset,
}: {
  references: StoryboardOrderedReference[];
  versions: ContinuityAssetVersion[];
  onReviewAsset: VisualContinuityReviewPanelProps["onReviewAsset"];
}) {
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const versionsByKey = new Map(
    versions.map((version) => [`${version.assetId}:${version.versionId}`, version]),
  );
  return (
    <section aria-label="本镜 canonical 资产对照" className="rounded-lg border border-zinc-800 bg-black/25 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-zinc-200">有序 canonical / 场景 / 道具对照</div>
        <div className="text-[10px] text-zinc-500">按 provider 引用顺序展示</div>
      </div>
      <div className="space-y-2">
        {references.map((reference) => {
          const version = versionsByKey.get(`${reference.assetId}:${reference.versionId ?? ""}`);
          const approved = Boolean(version && isContinuityAssetVersionApproved(version));
          const rejected = version?.approval?.status === "rejected";
          const safeReviewEvidencePaths = version ? continuityAssetSafeReviewEvidencePaths(version) : [];
          const hasCompleteReviewEvidence = Boolean(
            version && safeReviewEvidencePaths.length === version.referenceImagePaths.length,
          );
          const hasVerifiedReviewEvidence = Boolean(version?.reviewEvidenceVerifiedAt);
          const versionKey = version ? `${version.assetId}:${version.versionId}` : "";
          const reviewReason = versionKey ? reviewReasons[versionKey] ?? "" : "";
          const paths = version?.referenceImagePaths ?? reference.referenceImagePaths ?? [reference.imagePath ?? ""];
          const viewTypes = version?.referenceViewTypes ?? reference.referenceViewTypes ?? [];
          const anchors = version?.identityAnchors ?? reference.identityAnchors;
          const anchorText = [
            anchors?.faceShape,
            anchors?.hairStyle,
            ...(anchors?.uniqueMarks ?? []),
          ].filter(Boolean).join("；");
          const sceneText = version?.assetKind === "scene"
            ? [version.spatialLayout, version.lightingDesign, version.colorPalette].filter(Boolean).join("；")
            : "";
          return (
            <article key={`${reference.order}:${reference.assetId}:${reference.versionId ?? ""}`} className="rounded-md border border-zinc-800 bg-zinc-950/80 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="font-medium text-zinc-200">
                  @{reference.order} · {reference.assetName || reference.assetId} · {reference.versionId || "未设置版本"}
                </div>
                <Badge
                  variant="outline"
                  className={approved
                    ? "border-emerald-600/50 bg-emerald-950/50 text-emerald-200"
                    : rejected
                      ? "border-red-600/50 bg-red-950/50 text-red-200"
                      : "border-amber-600/50 bg-amber-950/50 text-amber-200"}
                >
                  {approved ? "已人工批准" : rejected ? "已人工驳回" : "待人工审核"}
                </Badge>
              </div>
              <div className="mt-1 text-[10px] text-zinc-500">
                {reference.referenceRole ?? "未设置角色"}
                {version?.wardrobeVersion ? ` · 服装 ${version.wardrobeVersion}` : ""}
                {version?.sceneViewpointId ? ` · 视角 ${version.sceneViewpointId}` : ""}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {paths.filter(Boolean).map((path, index) => (
                  <figure key={`${path}:${index}`} className="overflow-hidden rounded border border-zinc-800 bg-black">
                    <img
                      src={toPreviewSrc(path)}
                      alt={`${version?.label ?? reference.assetName ?? reference.assetId} ${viewTypes[index] ?? reference.sceneViewpointId ?? reference.referenceRole ?? `图${index + 1}`} 参考图`}
                      className="aspect-video h-full w-full object-contain"
                    />
                  </figure>
                ))}
              </div>
              {anchorText ? <div className="mt-2 text-[10px] leading-4 text-zinc-400">文字锚点：{anchorText}</div> : null}
              {sceneText ? <div className="mt-2 text-[10px] leading-4 text-zinc-400">场景锚点：{sceneText}</div> : null}
              {version?.contentFingerprint ? (
                <div className="mt-1 break-all text-[9px] leading-4 text-zinc-600">
                  内容指纹：{version.contentFingerprint.slice(0, 48)}{version.contentFingerprint.length > 48 ? "…" : ""}
                </div>
              ) : null}
              {version?.approvalFingerprint ? (
                <div className="mt-1 break-all text-[9px] leading-4 text-zinc-600">
                  批准指纹：{version.approvalFingerprint.slice(0, 48)}{version.approvalFingerprint.length > 48 ? "…" : ""}
                </div>
              ) : null}
              {version?.approval?.reason ? (
                <div className="mt-1 text-[10px] leading-4 text-zinc-400">上次审核说明：{version.approval.reason}</div>
              ) : null}
              {version && !hasCompleteReviewEvidence ? (
                <div className="mt-1 text-[10px] leading-4 text-amber-300">
                  缺少逐图安全缩略证据；请先生成严格小于 1MB 的 *_thumb.png。
                </div>
              ) : null}
              {version && hasCompleteReviewEvidence && !hasVerifiedReviewEvidence ? (
                <div className="mt-1 text-[10px] leading-4 text-amber-300">
                  缩略图尚未完成本地文件、尺寸、字节数与 SHA-256 安全校验；请使用单资产安全推广命令。
                </div>
              ) : null}
              {!approved && version ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={reviewReason}
                    onChange={(event) => setReviewReasons((current) => ({
                      ...current,
                      [versionKey]: event.target.value,
                    }))}
                    aria-label={`资产审核说明 ${version.assetId} ${version.versionId}`}
                    placeholder="批准可填写核对说明；驳回必须说明具体问题"
                    className="min-h-16 border-zinc-800 bg-black/30 text-[10px]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-7 text-[11px]"
                      disabled={!reviewReason.trim()}
                      aria-label={`驳回资产 ${version.assetId} ${version.versionId}`}
                      onClick={() => onReviewAsset(version.assetId, version.versionId, {
                        status: "rejected",
                        reason: reviewReason.trim(),
                        evidencePaths: safeReviewEvidencePaths,
                      })}
                    >
                      驳回资产
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={!version.structurallyComplete || !hasCompleteReviewEvidence || !hasVerifiedReviewEvidence}
                      aria-label={`批准资产 ${version.assetId} ${version.versionId}`}
                      onClick={() => onReviewAsset(version.assetId, version.versionId, {
                        status: "approved",
                        ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {}),
                        evidencePaths: safeReviewEvidencePaths,
                      })}
                    >
                      人工批准该资产
                    </Button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
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

function ReviewWarnings({
  storyboard,
  contractReasons,
}: {
  storyboard: StoryboardItem;
  contractReasons: string[];
}) {
  const reasons = [
    ...(storyboard.visualReview?.reasons ?? []),
    ...(storyboard.stale ? [storyboard.staleReason || "镜头已过期，必须重新生成"] : []),
    ...(!storyboard.mediaRef?.path ? ["缺少当前镜画面证据"] : []),
    ...(!storyboard.continuityState ? ["缺少连续镜头状态"] : []),
    ...contractReasons,
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
