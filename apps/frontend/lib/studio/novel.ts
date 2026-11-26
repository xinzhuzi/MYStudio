import type { NovelChapter, StudioSourceIdentity } from "@/types/studio";

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
        sourceId: createChapterId(index),
        revision: 1,
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
      sourceId: createChapterId(index),
      revision: 1,
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
  const metaLines = [
    `> 卷：${chapter.volume ?? defaultVolume}`,
    `> 源ID：${chapter.sourceId ?? chapter.id}`,
    `> 修订：${chapter.revision ?? 1}`,
  ];
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

/** Read the stable chapter identity from a persisted Markdown mirror. */
export function parseNovelChapterMirrorIdentity(markdown: string): StudioSourceIdentity {
  const sourceId = markdown.match(/^>\s*源ID：([^\n]+)$/m)?.[1]?.trim();
  const revisionValue = markdown.match(/^>\s*修订：(\d+)$/m)?.[1];
  const revision = revisionValue ? Number(revisionValue) : undefined;
  return {
    ...(sourceId ? { sourceId: sourceId } : {}),
    ...(typeof revision === "number" && Number.isInteger(revision) && revision > 0 ? { revision: revision } : {}),
  };
}

/** 1127 正文按需装载：章节镜像的相对路径（与 buildNovelChapterMirror 的 key 对称，
 *  去掉 `_p/{projectId}/` 前缀即项目根相对路径，走 projectFiles.readText）。 */
export function novelChapterMirrorRelativePath(chapterIndex: number): string {
  return `novel/chapters/${createChapterId(chapterIndex)}.md`;
}

/** 从镜像 Markdown 提取小说正文（剥离镜像头：`# 标题` + `> ` 元数据块 + 其后单个空行；
 *  正文截断到 `## 事件分析` 段之前——事件分析由 chapter 字段重建，不属正文）。
 *  无正文返回 null。镜像正文可能自带 `#` 开头的行，所以头部剥离只吃
 *  「标题行 + 连续元数据行 + 至多一个空行」，不越界。 */
export function parseNovelChapterMirrorBody(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  // 镜像头：`# 标题` → 空行 → `> ` 元数据块 → 空行 → 正文（与 buildNovelChapterMirror 对称）
  if ((lines[cursor] ?? "").startsWith("# ")) cursor += 1;
  if (cursor < lines.length && lines[cursor]!.trim() === "" && lines[cursor + 1]?.startsWith("> ")) cursor += 1;
  while (cursor < lines.length && lines[cursor]!.startsWith("> ")) cursor += 1;
  if (cursor < lines.length && lines[cursor]!.trim() === "") cursor += 1;
  let body = lines.slice(cursor).join("\n");
  const eventIdx = body.indexOf("\n## 事件分析");
  if (eventIdx >= 0) body = body.slice(0, eventIdx);
  else if (body.startsWith("## 事件分析")) body = "";
  body = body.replace(/\s+$/, "");
  return body.length > 0 ? body : null;
}

function createChapterId(index: number) {
  return `chapter-${String(index).padStart(3, "0")}`;
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s*/, "").trim();
}
