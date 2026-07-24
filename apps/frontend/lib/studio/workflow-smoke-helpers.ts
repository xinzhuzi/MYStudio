import type { AgentWorkData, StudioAgentRun } from "@/types/studio";

export function upsertWorks(items: AgentWorkData[], updates: AgentWorkData[]) {
  return upsertBy(items, updates, (item) => `${item.key}:${item.episodeId}`);
}

export function upsertRuns(items: StudioAgentRun[], updates: StudioAgentRun[]) {
  return upsertBy(items, updates, (item) => item.id);
}

function upsertBy<T>(items: T[], updates: T[], keyOf: (item: T) => string): T[] {
  const next = [...items];
  for (const update of updates) {
    const existingIndex = next.findIndex((item) => keyOf(item) === keyOf(update));
    if (existingIndex >= 0) next[existingIndex] = update;
    else next.push(update);
  }
  return next;
}
