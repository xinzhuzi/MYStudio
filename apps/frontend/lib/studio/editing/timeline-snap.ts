import type { EditingProjectV1 } from "@/types/editing";

export interface TimelineSnapRequest {
  project: EditingProjectV1;
  proposedTimeUs: number;
  thresholdUs: number;
  markersUs?: number[];
  excludeClipId?: string;
}

export type TimelineSnapResult =
  | { snapped: true; timeUs: number; targetUs: number }
  | { snapped: false; timeUs: number };

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function snapTimelineTime(
  request: TimelineSnapRequest,
): TimelineSnapResult {
  if (
    !isNonNegativeSafeInteger(request.proposedTimeUs)
    || !isNonNegativeSafeInteger(request.thresholdUs)
  ) {
    return { snapped: false, timeUs: request.proposedTimeUs };
  }
  const targets = new Set<number>([0]);
  for (const clip of request.project.clips) {
    if (clip.id === request.excludeClipId) continue;
    targets.add(clip.startUs);
    targets.add(clip.startUs + clip.durationUs);
  }
  for (const marker of request.markersUs ?? []) {
    if (isNonNegativeSafeInteger(marker)) targets.add(marker);
  }
  const ordered = [...targets].sort((left, right) => left - right);
  let nearest: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of ordered) {
    const distance = Math.abs(target - request.proposedTimeUs);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  if (nearest !== undefined && nearestDistance <= request.thresholdUs) {
    return { snapped: true, timeUs: nearest, targetUs: nearest };
  }
  return { snapped: false, timeUs: request.proposedTimeUs };
}
