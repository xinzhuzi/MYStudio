import path from 'node:path';
import type { StoryboardItem } from '@/types/studio';
import type { SubtitleAuthority } from '@/types/editing';
import type { VideoUseReviewSidecarV1 } from '@rendering/contracts/video-workflow';
import { isDaojieAdaptation } from '@/lib/studio/daojie-generation-audit';
import { DAOJIE_STRICT_DURATION_SECONDS } from '@/lib/studio/daojie-duration-policy';
import { storyboardEffectiveDurationUs } from '@/lib/studio/remotion/remotion-shot-plan-builder';
import { validateSubtitleAuthority } from '@/lib/studio/video-workflow/subtitle-authority';
import { hashFileSha256 } from '../remotion/render-smoke-evidence';

export function requireSourceHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) throw new Error('缺少真实 SHA-256 identity');
}
export function assertCliDuration(state: Record<string, unknown>, chapterId: string, shots: StoryboardItem[], partial = false, projectionUs?: number): void {
  const config = state.workflowConfig as { directorManualId?: string } | undefined;
  const chapters = state.novelChapters as { id: string; sourceText?: string }[] | undefined;
  const source = chapters?.find(chapter => chapter.id === chapterId)?.sourceText;
  if (partial || !isDaojieAdaptation(config?.directorManualId, source)) return;
  const durations = shots.map(storyboardEffectiveDurationUs);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  for (const value of [...durations, total, ...(projectionUs === undefined ? [] : [projectionUs])]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > DAOJIE_STRICT_DURATION_SECONDS * 1_000_000) {
      throw new Error(`strict Daojie effective/projection duration ${value}us exceeds valid ${DAOJIE_STRICT_DURATION_SECONDS}s budget (total=${total}us)`);
    }
  }
}
interface ReviewArtifactIdentity {
  projectId: string; chapterId: string; revision: number;
  sourceSha256: string; audioSha256: string; textSha256: string;
  evidence: { artifactSha256: string };
}
export interface PipelineReviewInput extends VideoUseReviewSidecarV1 {
  sourceSha256: string; audioSha256: string; textSha256: string;
  subtitleAuthority: SubtitleAuthority;
}
/** External review, never generated from a successful CLI/model return. */
export async function validatePipelineReview(value: unknown, artifact: ReviewArtifactIdentity): Promise<PipelineReviewInput> {
  if (!value || typeof value !== 'object') throw new Error('需要外部 source-bound review');
  const review = value as PipelineReviewInput;
  for (const key of ['projectId', 'chapterId', 'revision', 'sourceSha256', 'audioSha256', 'textSha256'] as const) {
    if (review[key] !== artifact[key]) throw new Error(`review ${key} 与当前 artifact 不一致`);
  }
  for (const hash of [review.sourceSha256, review.audioSha256, review.textSha256, review.artifactSha256]) requireSourceHash(hash);
  if (review.artifactSha256 !== artifact.evidence.artifactSha256 || review.decision !== 'accepted'
    || typeof review.reviewer !== 'string' || !review.reviewer.trim() || !Number.isFinite(review.timestamp) || review.timestamp <= 0) throw new Error('review artifact identity/decision 无效');
  const authority = review.subtitleAuthority;
  if (validateSubtitleAuthority(authority).length || !authority.evidence
    || authority.evidence.sourceFingerprint !== artifact.sourceSha256
    || authority.evidence.decision === 'legacy-unknown'
    || (authority.evidence.decision === 'human' && authority.evidence.reviewer !== 'human')
    || !Number.isFinite(authority.evidence.reviewedAt) || (authority.evidence.reviewedAt ?? 0) <= 0) throw new Error('subtitle source-bound review evidence 无效');
  for (const file of authority.evidence.evidencePaths) {
    const expected = authority.evidence.evidenceSha256?.[file];
    requireSourceHash(expected);
    if (!path.isAbsolute(file) || await hashFileSha256(file) !== expected) throw new Error('review evidence 文件 hash 不一致');
  }
  return review;
}
