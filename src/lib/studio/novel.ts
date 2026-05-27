import type { NovelChapter } from "@/types/studio";

export interface ParseNovelOptions {
  importedAt?: number;
  startIndex?: number;
  sourceName?: string;
  defaultVolume?: string;
}

const chapterHeadingPattern = /^(?:#{1,6}\s*)?(第[0-9一二三四五六七八九十百千万两〇零]+[章节回卷集][^\n]*)$/gm;
const defaultVolume = "正文卷";

export function parseNovelChapters(sourceText: string, options: ParseNovelOptions = {}): NovelChapter[] {
  const normalized = sourceText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const importedAt = options.importedAt ?? Date.now();
  const startIndex = options.startIndex ?? 1;
  const volume = options.defaultVolume ?? defaultVolume;
  const matches = [...normalized.matchAll(chapterHeadingPattern)];

  if (matches.length === 0) {
    const index = startIndex;
    return [
      {
        id: createChapterId(index),
        index,
        volume,
        title: "未分章正文",
        sourceText: normalized,
        sourceName: options.sourceName,
        importedAt,
        updatedAt: importedAt,
      },
    ];
  }

  return matches.map((match, idx) => {
    const next = matches[idx + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? normalized.length;
    const index = startIndex + idx;
    return {
      id: createChapterId(index),
      index,
      volume,
      title: cleanHeading(match[1] ?? match[0]),
      sourceText: normalized.slice(start, end).replace(/^\s+|\s+$/g, ""),
      sourceName: options.sourceName,
      importedAt,
      updatedAt: importedAt,
    };
  });
}

export function appendNovelChapters(
  existingChapters: NovelChapter[],
  sourceText: string,
  options: ParseNovelOptions = {},
): NovelChapter[] {
  const nextIndex = existingChapters.reduce((max, chapter) => Math.max(max, chapter.index), 0) + 1;
  const imported = parseNovelChapters(sourceText, { ...options, startIndex: nextIndex });
  return [...existingChapters, ...imported];
}

export function replaceNovelChapters(sourceText: string, options: ParseNovelOptions = {}): NovelChapter[] {
  return parseNovelChapters(sourceText, { ...options, startIndex: 1 });
}

export function buildNovelChapterMirror(projectId: string, chapter: NovelChapter) {
  const chapterId = createChapterId(chapter.index);
  const metaLines = [`> 卷：${chapter.volume ?? defaultVolume}`];
  if (chapter.sourceName) {
    metaLines.push(`> 来源：${chapter.sourceName}`);
  }
  const eventLines = [
    chapter.eventSummary ? `摘要：${chapter.eventSummary}` : "",
    chapter.eventState ? `状态：\n${chapter.eventState}` : "",
    chapter.eventRawOutput ? `原始输出：${chapter.eventRawOutput}` : "",
  ].filter(Boolean);

  return {
    key: `_p/${projectId}/novel/chapters/${chapterId}.md`,
    content: [
      `# ${chapter.title}`,
      "",
      ...metaLines,
      "",
      chapter.sourceText,
      ...(eventLines.length ? ["", "## 事件分析", "", ...eventLines] : []),
    ].join("\n"),
  };
}

function createChapterId(index: number) {
  return `chapter-${String(index).padStart(3, "0")}`;
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s*/, "").trim();
}
