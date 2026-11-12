import { markContinuityDependentsStale } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ProductionTrack,
  StoryboardItem,
  StoryboardMediaRef,
  VideoCandidate,
} from "@/types/studio";

export function continuityAssetVersionKey(version: Pick<ContinuityAssetVersion, "assetId" | "versionId">) {
  return `${version.assetId}:${version.versionId}`;
}

export function invalidateStoryboardsForAssetVersionChanges(
  storyboards: StoryboardItem[],
  changedKeys: Set<string>,
  staleReason = "引用的角色、场景或道具基准资产已变化",
  reviewReason = "引用资产已变化，必须重新生成并审核",
) {
  const staleSince = Date.now();
  const directlyAffectedIds = storyboards
    .filter((storyboard) => storyboard.orderedReferenceManifest?.some((reference) => (
      changedKeys.has(`${reference.assetId}:${reference.versionId ?? ""}`)
    )))
    .map((storyboard) => storyboard.id);
  let next = storyboards.map((storyboard) => directlyAffectedIds.includes(storyboard.id)
    ? {
        ...storyboard,
        stale: true,
        staleReason,
        staleSince,
        visualReview: storyboard.visualReview
          ? {
              ...storyboard.visualReview,
              status: "pending" as const,
              reasons: [reviewReason],
            }
          : storyboard.visualReview,
      }
    : storyboard);
  for (const storyboardId of directlyAffectedIds) {
    next = markContinuityDependentsStale(next, storyboardId, staleSince);
  }
  return next;
}

export function mergeStoryboardReplacement(previous: StoryboardItem, next: StoryboardItem, staleReason: string): StoryboardItem {
  const previousFingerprint = previous.sourceFingerprint ?? storyboardSourceFingerprint(previous);
  const nextFingerprint = storyboardSourceFingerprint(next);
  const sourceChanged = previousFingerprint !== nextFingerprint;
  const hasOutput = Boolean(previous.mediaRef || previous.audioRef || previous.imageWorkflowId || previous.imageWorkflowNodeId);
  const mediaRefChanged = mediaRefFingerprint(next.mediaRef) !== mediaRefFingerprint(previous.mediaRef);
  const audioRefChanged = mediaRefFingerprint(next.audioRef) !== mediaRefFingerprint(previous.audioRef);
  const freshWrite = Boolean(
    mediaRefChanged ||
      audioRefChanged ||
      next.imageWorkflowId !== previous.imageWorkflowId ||
      next.imageWorkflowNodeId !== previous.imageWorkflowNodeId,
  );
  const visualInputChanged = Boolean(
    mediaRefChanged ||
    next.imageWorkflowId !== previous.imageWorkflowId ||
    next.imageWorkflowNodeId !== previous.imageWorkflowNodeId,
  );
  const carriedVisualReview = next.visualReview ?? previous.visualReview;
  if (freshWrite) {
    return {
      ...next,
      stale: false,
      staleReason: undefined,
      staleSince: undefined,
      sourceFingerprint: nextFingerprint,
      outputVersion: (previous.outputVersion ?? 0) + 1,
      visualReview: visualInputChanged && carriedVisualReview
        ? {
            ...carriedVisualReview,
            status: "pending",
            reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
          }
        : carriedVisualReview,
    };
  }
  if (sourceChanged && hasOutput) {
    return {
      ...next,
      ...markStale(next, staleReason),
      sourceFingerprint: nextFingerprint,
      outputVersion: previous.outputVersion,
      visualReview: carriedVisualReview
        ? {
            ...carriedVisualReview,
            status: "pending",
            reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
          }
        : carriedVisualReview,
    };
  }
  return {
    ...next,
    sourceFingerprint: nextFingerprint,
    outputVersion: previous.outputVersion,
    visualReview: carriedVisualReview,
  };
}

function mediaRefFingerprint(media: StoryboardMediaRef | undefined): string {
  if (!media) return "";
  return JSON.stringify({
    kind: media.kind,
    path: media.path,
    contentSha256: media.contentSha256,
    imageWorkflowId: media.imageWorkflowId,
    imageWorkflowNodeId: media.imageWorkflowNodeId,
  });
}

export function markStale<T extends { stale?: boolean; staleReason?: string; staleSince?: number }>(item: T, reason: string): T {
  return {
    ...item,
    stale: true,
    staleReason: reason,
    staleSince: Date.now(),
  };
}

export function storyboardSourceFingerprint(item: Partial<StoryboardItem>) {
  return stableHash({
    episodeId: item.episodeId,
    index: item.index,
    trackKey: item.trackKey,
    duration: item.duration,
    prompt: item.prompt,
    videoDesc: item.videoDesc,
    assetIds: item.assetIds ?? [],
    shouldGenerateImage: item.shouldGenerateImage,
    orderedReferenceManifest: item.orderedReferenceManifest ?? [],
    ...(item.sourceEvidence?.scene ? { sourceScene: item.sourceEvidence.scene } : {}),
    shotSemantics: item.shotSemantics,
    cinematic: (item as { cinematic?: unknown }).cinematic,
    continuityState: item.continuityState
      ? { ...item.continuityState, inputFingerprint: undefined }
      : undefined,
    lines: item.lines,
    speakerId: item.speakerId,
  });
}

/**
 * W1(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):文本层指纹
 * = 全指纹剔除 continuityState/orderedReferenceManifest 两层。replace 链据此判
 * 「源文本是否真变了」——真变才失效旧 continuity 层;未变的重新保存零扰动
 * (continuity 原样保留,全指纹稳定,不误标脏)。
 */
export function storyboardTextLayerFingerprint(item: Partial<StoryboardItem>) {
  return stableHash({
    episodeId: item.episodeId,
    index: item.index,
    trackKey: item.trackKey,
    duration: item.duration,
    prompt: item.prompt,
    videoDesc: item.videoDesc,
    assetIds: item.assetIds ?? [],
    shouldGenerateImage: item.shouldGenerateImage,
    ...(item.sourceEvidence?.scene ? { sourceScene: item.sourceEvidence.scene } : {}),
    shotSemantics: item.shotSemantics,
    cinematic: (item as { cinematic?: unknown }).cinematic,
    lines: item.lines,
    speakerId: item.speakerId,
  });
}

/**
 * W2(1112 验尸):「脏而未标」判定——存档 sourceFingerprint ≠ 现算指纹,即
 * 文本/continuity/manifest 层已被裸写改过(离线 CLI 直写分片改 lines / 手术
 * 脚本 pop continuityState 均不动存档指纹),而 stale 未置。批量消费面据此把
 * 该镜计为缺帧纳入队列,斩断「脏镜被当新鲜跳过」的 media 冻结。
 */
export function storyboardSourceFingerprintDrifted(item: Partial<StoryboardItem>): boolean {
  return item.sourceFingerprint !== undefined
    && item.sourceFingerprint !== storyboardSourceFingerprint(item);
}

/**
 * W1(1112 验尸):水合自愈——分片里的 sourceFingerprint 是上次 merge 存档的
 * 快照串,裸写路径永不重算,快照永久滞旧且永不置 stale(11-04 实弹验尸:19 镜
 * revision/5 镜 lines 变了而指纹逐字节未变)。水合时存档指纹≠现算指纹且已有
 * 产出 ⇒ 标脏 + 审核回 pending。不重算指纹——漂移证据保留给消费面(W2 双保险),
 * 产出重写(freshWrite)时指纹自然收敛。
 */
export function healStaleFingerprintDrift(storyboards: StoryboardItem[]): StoryboardItem[] {
  const staleSince = Date.now();
  return storyboards.map((item) => {
    if (!storyboardSourceFingerprintDrifted(item)) return item;
    const hasOutput = Boolean(
      item.mediaRef || item.audioRef || item.imageWorkflowId || item.imageWorkflowNodeId,
    );
    if (!hasOutput) return item;
    return {
      ...item,
      stale: true,
      staleReason: "分镜源已变化（离线写入未重算指纹），需重新生成",
      staleSince,
      visualReview: item.visualReview
        ? {
            ...item.visualReview,
            status: "pending" as const,
            reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
          }
        : item.visualReview,
    };
  });
}

export function trackSourceFingerprint(track: ProductionTrack, storyboards: StoryboardItem[]) {
  return stableHash({
    episodeId: track.episodeId,
    trackKey: track.trackKey,
    storyboardIds: track.storyboardIds,
    prompt: track.prompt,
    duration: track.duration,
    storyboardFingerprints: track.storyboardIds.map(
      (id) => storyboards.find((storyboard) => storyboard.id === id)?.sourceFingerprint,
    ),
  });
}

export function videoCandidateFingerprint(candidate: Partial<VideoCandidate>) {
  return stableHash({
    trackId: candidate.trackId,
    provider: candidate.provider,
    filePath: candidate.filePath,
  });
}

function stableHash(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}
