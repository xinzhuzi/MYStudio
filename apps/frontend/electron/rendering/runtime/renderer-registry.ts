import type {
  TimelineRenderCancelResult,
  TimelineRenderPlan,
  TimelineRenderResult,
  TimelineRendererEvidence,
} from "@/types/editing";
import type { TimelineRendererId } from "../contracts/timeline-renderer";

export interface TimelineRendererAdapter {
  id: TimelineRendererId;
  render: (
    plan: TimelineRenderPlan,
    context: { renderer: TimelineRendererEvidence },
  ) => Promise<TimelineRenderResult>;
  cancel: (jobId: string) => TimelineRenderCancelResult;
}

export interface TimelineRendererRegistry {
  get: (id: TimelineRendererId) => TimelineRendererAdapter | undefined;
}

export function createTimelineRendererRegistry(
  adapters: readonly TimelineRendererAdapter[],
): TimelineRendererRegistry {
  const byId = new Map<TimelineRendererId, TimelineRendererAdapter>();
  adapters.forEach((adapter) => {
    if (byId.has(adapter.id)) {
      throw new Error(`重复注册时间线渲染器: ${adapter.id}`);
    }
    byId.set(adapter.id, adapter);
  });
  return { get: (id) => byId.get(id) };
}
