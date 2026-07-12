import type { EntityExtractionResult, NovelChapter, SeriesBible } from "@/types/studio";

export interface ProjectEventNode {
  id: string;
  projectId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  summary: string;
  state: string;
  characters: string[];
  emotionTags: string[];
  timelineOrder: number;
  retrievalText: string;
}

export interface ProjectMemoryRecord {
  id: string;
  projectId: string;
  scope: "event" | "entity" | "seriesBible";
  episodeId?: string;
  entityId?: string;
  entityKind?: "character" | "scene" | "prop";
  title: string;
  text: string;
  createdAt: number;
}

export function buildProjectEventGraph(input: { projectId: string; chapters: NovelChapter[] }): ProjectEventNode[] {
  return input.chapters
    .filter((chapter) => chapter.eventAnalysis || chapter.eventSummary || chapter.eventState)
    .sort((left, right) => left.index - right.index)
    .map((chapter, order) => {
      const analysis = chapter.eventAnalysis;
      const summary = analysis?.coreEvent || chapter.eventSummary || chapter.sourceText.slice(0, 120);
      const state = [
        analysis?.mainlineRelation ? `主线：${analysis.mainlineRelation}` : "",
        analysis?.informationDensity ? `信息密度：${analysis.informationDensity}` : "",
        chapter.eventState || "",
      ].filter(Boolean).join("\n");
      const characters = analysis?.characters ?? [];
      const emotionTags = analysis?.emotionTags ?? [];
      const retrievalText = [
        chapter.title,
        summary,
        state,
        characters.join("、"),
        emotionTags.join("、"),
      ].filter(Boolean).join("\n");
      return {
        id: `${input.projectId}:event:${chapter.id}`,
        projectId: input.projectId,
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        summary,
        state,
        characters,
        emotionTags,
        timelineOrder: order + 1,
        retrievalText,
      };
    });
}

export function buildProjectMemoryRecords(input: {
  projectId: string;
  chapters: NovelChapter[];
  entityExtractions?: EntityExtractionResult[];
  seriesBible?: SeriesBible | null;
  createdAt?: number;
}): ProjectMemoryRecord[] {
  const createdAt = input.createdAt ?? Date.now();
  const eventRecords = buildProjectEventGraph(input).map<ProjectMemoryRecord>((event) => ({
    id: `${event.id}:memory`,
    projectId: input.projectId,
    scope: "event",
    episodeId: event.chapterId,
    title: event.chapterTitle,
    text: event.retrievalText,
    createdAt,
  }));
  const entityRecords = (input.entityExtractions ?? []).flatMap((batch) => [
    ...batch.characters.map<ProjectMemoryRecord>((item) => ({
      id: `${input.projectId}:entity:character:${item.characterId}`,
      projectId: input.projectId,
      scope: "entity",
      episodeId: batch.episodeId,
      entityId: item.characterId,
      entityKind: "character",
      title: item.name,
      text: [item.name, item.aliases.join("、")].filter(Boolean).join("\n"),
      createdAt,
    })),
    ...batch.scenes.map<ProjectMemoryRecord>((item) => ({
      id: `${input.projectId}:entity:scene:${item.sceneId}`,
      projectId: input.projectId,
      scope: "entity",
      episodeId: batch.episodeId,
      entityId: item.sceneId,
      entityKind: "scene",
      title: item.name,
      text: item.name,
      createdAt,
    })),
    ...batch.props.map<ProjectMemoryRecord>((item) => ({
      id: `${input.projectId}:entity:prop:${item.assetId}`,
      projectId: input.projectId,
      scope: "entity",
      episodeId: batch.episodeId,
      entityId: item.assetId,
      entityKind: "prop",
      title: item.name,
      text: item.name,
      createdAt,
    })),
  ]);
  const bibleRecords: ProjectMemoryRecord[] = input.seriesBible
    ? [{
        id: `${input.projectId}:seriesBible`,
        projectId: input.projectId,
        scope: "seriesBible",
        title: "剧集圣经",
        text: [
          input.seriesBible.projectId,
          input.seriesBible.aspectRatio,
          ...input.seriesBible.characterLocks.map((item) => `${item.characterId}:${item.appearance}`),
          ...input.seriesBible.sceneLocks,
        ].join("\n"),
        createdAt,
      }]
    : [];
  return [...eventRecords, ...entityRecords, ...bibleRecords];
}

export function retrieveProjectMemory(input: {
  records: ProjectMemoryRecord[];
  projectId: string;
  episodeId?: string;
  query?: string;
  limit?: number;
}): ProjectMemoryRecord[] {
  const terms = tokenize(input.query ?? "");
  return input.records
    .filter((record) => record.projectId === input.projectId)
    .filter((record) => !input.episodeId || !record.episodeId || record.episodeId === input.episodeId || record.scope === "seriesBible")
    .map((record) => ({ record, score: scoreRecord(record, terms, input.episodeId) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit ?? 8)
    .map((item) => item.record);
}

export function formatProjectMemoryContext(records: ProjectMemoryRecord[]): string {
  if (!records.length) return "";
  return [
    "## 项目记忆（当前项目/集范围）",
    ...records.map((record) => `- [${record.scope}] ${record.title}: ${record.text.replace(/\s+/g, " ").slice(0, 240)}`),
  ].join("\n");
}

export function purgeProjectMemory(records: ProjectMemoryRecord[], projectId: string): ProjectMemoryRecord[] {
  return records.filter((record) => record.projectId !== projectId);
}

function scoreRecord(record: ProjectMemoryRecord, terms: string[], episodeId?: string) {
  let score = record.episodeId && episodeId && record.episodeId === episodeId ? 4 : 1;
  if (record.scope === "seriesBible") score += 2;
  const haystack = `${record.title}\n${record.text}`;
  for (const term of terms) {
    if (haystack.includes(term)) score += 2;
  }
  return score;
}

function tokenize(query: string): string[] {
  return query.split(/[\s,，。；;、]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
}
