import type { AutoEditingRun, EditingProjectV1 } from "@/types/editing";

export function filterCurrentEditingProjectIds(
  value: unknown,
  editingProjects: Record<string, EditingProjectV1>,
): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([episodeId, editingProjectId]) => {
      if (typeof editingProjectId !== "string") return false;
      const project = editingProjects[editingProjectId];
      return project?.episodeId === episodeId;
    }),
  ) as Record<string, string>;
}

export function filterAutoEditingRunIds(
  value: unknown,
  autoEditingRuns: Record<string, AutoEditingRun>,
): Record<string, string[]> {
  const indexed = new Set<string>();
  const result: Record<string, string[]> = {};
  if (isRecord(value)) {
    for (const [episodeId, runIds] of Object.entries(value)) {
      if (!Array.isArray(runIds)) continue;
      for (const runId of runIds) {
        if (typeof runId !== "string" || indexed.has(runId)) continue;
        const run = autoEditingRuns[runId];
        if (!run || run.episodeId !== episodeId) continue;
        (result[episodeId] ??= []).push(runId);
        indexed.add(runId);
      }
    }
  }
  for (const run of Object.values(autoEditingRuns).sort(
    (left, right) =>
      left.startedAt - right.startedAt || left.id.localeCompare(right.id),
  )) {
    if (indexed.has(run.id)) continue;
    (result[run.episodeId] ??= []).push(run.id);
    indexed.add(run.id);
  }
  return result;
}

export function appendEpisodeRecordId(
  records: Record<string, string[]>,
  episodeId: string,
  recordId: string,
): Record<string, string[]> {
  const existing = records[episodeId] ?? [];
  if (existing.includes(recordId)) return records;
  return { ...records, [episodeId]: [...existing, recordId] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
