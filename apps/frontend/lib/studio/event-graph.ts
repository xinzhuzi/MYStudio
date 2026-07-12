import type {
  NovelChapter,
  ProjectEventGraphRecord,
  ProjectMemoryContext,
  ProjectMemoryQuery,
  ProjectMemoryRecord,
} from "@/types/studio";

export function buildProjectEventGraph(input: {
  projectId: string;
  chapters: NovelChapter[];
  now?: number;
}): ProjectEventGraphRecord[] {
  const now = input.now ?? Date.now();
  return input.chapters
    .filter((chapter) => Boolean(chapter.eventAnalysis))
    .map((chapter) => {
      const analysis = chapter.eventAnalysis!;
      const retrievalText = [
        `章节：${chapter.title}`,
        `事件：${analysis.coreEvent}`,
        `角色：${analysis.characters.join("、")}`,
        `主线：${analysis.mainlineRelation}`,
        `情绪：${analysis.emotionTags.join("+")}`,
      ].join("\n");
      return {
        id: `event-${input.projectId}-${chapter.id}`,
        projectId: input.projectId,
        episodeId: chapter.id,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        entities: analysis.characters,
        coreEvent: analysis.coreEvent,
        mainlineRelation: analysis.mainlineRelation,
        informationDensity: analysis.informationDensity,
        estimatedDurationSec: analysis.estimatedDurationSec,
        emotionTags: analysis.emotionTags,
        timelineOrder: chapter.index,
        retrievalText,
        source: "novelEventAnalysis",
        createdAt: now,
        updatedAt: now,
      };
    });
}

export function projectEventGraphToMemoryRecords(events: ProjectEventGraphRecord[]): ProjectMemoryRecord[] {
  return events.map((event) => ({
    id: `memory-${event.id}`,
    projectId: event.projectId,
    episodeId: event.episodeId,
    kind: "event",
    title: `${event.chapterIndex}. ${event.chapterTitle}`,
    content: event.retrievalText,
    entities: event.entities,
    timelineOrder: event.timelineOrder,
    sourceRef: event.id,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }));
}

export function retrieveProjectMemory(
  records: ProjectMemoryRecord[],
  query: ProjectMemoryQuery,
): ProjectMemoryContext {
  const limit = query.limit ?? 6;
  const includePriorEpisodes = query.includePriorEpisodes ?? true;
  const entities = new Set((query.entities ?? []).map(normalizeToken).filter(Boolean));
  const scored = records
    .filter((record) => record.projectId === query.projectId)
    .map((record) => ({
      record,
      score: scoreMemoryRecord(record, query, entities, includePriorEpisodes),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.record.timelineOrder ?? 0) - (b.record.timelineOrder ?? 0))
    .slice(0, limit)
    .map((item) => item.record);

  return {
    records: scored,
    markdown: formatProjectMemoryContext(scored, query),
  };
}

export function formatProjectMemoryContext(records: ProjectMemoryRecord[], query: ProjectMemoryQuery): string {
  if (!records.length) return "";
  const title = query.purpose === "production" ? "## 项目记忆（制作阶段范围检索）" : "## 项目记忆（编剧阶段范围检索）";
  return [
    title,
    ...records.map((record) => {
      const scope = record.episodeId ? `episode=${record.episodeId}` : "project";
      return `- [${record.kind}] ${record.title} (${scope})\n${indent(record.content)}`;
    }),
  ].join("\n");
}

function scoreMemoryRecord(
  record: ProjectMemoryRecord,
  query: ProjectMemoryQuery,
  entities: Set<string>,
  includePriorEpisodes: boolean,
) {
  let score = 0;
  if (query.episodeId && record.episodeId === query.episodeId) score += 100;
  if (
    includePriorEpisodes &&
    typeof query.chapterIndex === "number" &&
    typeof record.timelineOrder === "number" &&
    record.timelineOrder < query.chapterIndex
  ) {
    score += 35;
  }
  for (const entity of record.entities) {
    if (entities.has(normalizeToken(entity))) score += 25;
  }
  if (!query.episodeId && !query.chapterIndex && entities.size === 0) score += 1;
  return score;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function indent(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}
