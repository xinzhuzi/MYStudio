import { RunVideoUseChapterInput } from "@/lib/studio/chapter-auto-video";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1 } from "@/types/remotion-workspace";

/**
 * 章节自动视频工具族——manifest 创建/内容哈希/镜头槽等待/集合等价。file-size-reduction P3 拆出,体逐字保留。
 */
export async function createChapterManifestForPlans({
  projectId,
  chapterId,
  revision,
  sourceSnapshotHash,
  renderSettings,
  plans,
  existing,
}: {
  projectId: string;
  chapterId: string;
  revision: number;
  sourceSnapshotHash: string;
  renderSettings: typeof DEFAULT_REMOTION_RENDER_SETTINGS;
  plans: ReadonlyArray<{ shot: RemotionChapterManifestV2["shots"][number] }>;
  existing?: RemotionChapterManifestV2;
}): Promise<RemotionChapterManifestV2> {
  const now = Date.now();
  const manifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId,
    chapterId,
    revision,
    sourceSnapshotHash,
    requiredShotIds: plans.map((plan) => plan.shot.shotId),
    sharedAudioBindings: existing?.sharedAudioBindings ?? [],
    shots: plans.map((plan) => plan.shot),
    renderSettings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(manifest);
  return manifest;
}

export function sameShotSet(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((item) => item.id));
  return left.every((item) => rightIds.has(item.id));
}

export async function chapterManifestContentHash(manifest: RemotionChapterManifestV2): Promise<string> {
  return sha256CanonicalJson({
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
    requiredShotIds: manifest.requiredShotIds,
    sharedAudioBindings: manifest.sharedAudioBindings,
    shots: manifest.shots,
    renderSettings: manifest.renderSettings,
  });
}

export const REMOTION_SHOT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
export const REMOTION_SHOT_POLL_INTERVAL_MS = 500;

export async function waitForCurrentChapterShotSlots(
  input: RunVideoUseChapterInput & { assertProjectStillActive: () => void },
): Promise<RemotionCurrentSlotV1[]> {
  const queue = typeof window !== "undefined" ? window.remotionQueue : undefined;
  if (!queue?.get) throw new Error("Remotion 队列读取接口不可用，已停止 video-use preview");
  const expectedRevisions = new Map(
    input.storyboards.map((storyboard) => [
      storyboard.id,
      Math.max(1, storyboard.outputVersion ?? 1),
    ]),
  );
  const submittedJobs = new Map(input.submission.jobs.map((job) => [job.jobId, job]));
  const startedAt = Date.now();
  const terminalFailureStatuses = new Set(["failed", "blocked", "canceled", "stale"]);
  while (Date.now() - startedAt <= REMOTION_SHOT_WAIT_TIMEOUT_MS) {
    input.assertProjectStillActive();
    const scope = await queue.get({ projectId: input.projectId, chapterId: input.chapterId });
    const failedJob = scope.jobs.find((job) =>
      input.submission.jobs.some((submitted) => submitted.jobId === job.jobId)
      && terminalFailureStatuses.has(job.status),
    );
    if (failedJob) {
      throw new Error(`Remotion 分镜 ${failedJob.jobId} ${failedJob.status}，已阻止 video-use preview`);
    }
    const currentSlots = scope.currentShotSlots.filter((slot) =>
      slot.target.kind === "shot"
      && expectedRevisions.get(slot.target.shotId) === slot.target.shotRevision
      && submittedJobs.has(slot.job.jobId)
      && submittedJobs.get(slot.job.jobId)?.inputHash === slot.job.inputHash
      && slot.job.status === "succeeded",
    );
    if (currentSlots.length === expectedRevisions.size) return currentSlots;
    await new Promise<void>((resolve) => setTimeout(resolve, REMOTION_SHOT_POLL_INTERVAL_MS));
  }
  throw new Error("等待全部单镜 MP4 超时，已阻止 video-use preview");
}
