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

/** 正文文件（章节 Markdown）解析结果：`# 标题` + `> ` 元数据块 + 正文 +（可选）`## 事件分析` 段。
 *  文件里缺哪行就缺哪个键；sourceText 恒为字符串（无正文为空串）。 */
export type NovelChapterMirror = {
  title: string;
  volume?: string;
  sourceId?: string;
  revision?: number;
  sourceName?: string;
  sourceText: string;
  eventSummary?: string;
  eventState?: string;
  eventRawOutput?: string;
};

export type NovelChapterMirrorMergeMode = "file-wins" | "fill-missing-events";

const MIRROR_EVENT_MARK = "## 事件分析";
const MIRROR_HEAD_FIELD_PATTERN = /^> (卷|源ID|修订|来源)：(.*)$/;
const MIRROR_HEAD_FIELD_BY_MARK: Record<string, "volume" | "sourceId" | "revision" | "sourceName"> = {
  卷: "volume",
  源ID: "sourceId",
  修订: "revision",
  来源: "sourceName",
};

/** 把一份正文文件解析成 NovelChapterMirror。
 *  首行不是 `# ` 标题行 → null；正文为空返回空串（不返回 null）。
 *  头部扫描跳过空行、停在第一个正文行（正文里偶见的 `> ` 引文行不误吞）；
 *  修订号只收十进制整数。解析语义与离线修复工具（apps/build/scripts/novel_store_align.py
 *  的 parse_mirror / novel_text_audit.py 的 mirror_head）逐条对齐。 */
export function parseNovelChapterMirror(markdown: string): NovelChapterMirror | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (!(lines[0] ?? "").startsWith("# ")) return null;
  const title = lines[0]!.slice(2).trim();
  let volume: string | undefined;
  let sourceId: string | undefined;
  let revision: number | undefined;
  let sourceName: string | undefined;
  for (let cursor = 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]!;
    if (line.trim() === "") continue;
    if (!line.startsWith("> ")) break;
    const matched = line.match(MIRROR_HEAD_FIELD_PATTERN);
    // 非标准 `> ` 行（外部工具/手改批注）跳过继续收其后标准字段——与
    // novel_text_audit.mirror_head 的 `elif line.startswith("> "): continue`
    // 逐条对齐（复核 medium：此处曾是 break，混入一条非标准行会丢掉其后
    // 全部头部字段，对账按 Python 修库、App 读回丢字段再写回旧值，重新制造不一致）。
    if (!matched) continue;
    const field = MIRROR_HEAD_FIELD_BY_MARK[matched[1]!];
    const value = matched[2]!.trim();
    if (field === "revision") {
      if (/^\d+$/.test(value)) revision = Number(value);
    } else if (value) {
      if (field === "volume") volume = value;
      else if (field === "sourceId") sourceId = value;
      else sourceName = value;
    }
  }

  let body = lines.slice(findMirrorBodyStart(lines)).join("\n");
  let eventsSection: string | null = null;
  const eventIdx = body.indexOf(`\n${MIRROR_EVENT_MARK}`);
  if (eventIdx >= 0) {
    eventsSection = body.slice(eventIdx + 1);
    body = body.slice(0, eventIdx);
  } else if (body.startsWith(MIRROR_EVENT_MARK)) {
    eventsSection = body;
    body = "";
  }
  body = body.replace(/\s+$/, "");

  const events = eventsSection ? parseNovelChapterMirrorEvents(eventsSection) : {};
  return {
    title,
    ...(volume !== undefined ? { volume } : {}),
    ...(sourceId !== undefined ? { sourceId } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(sourceName !== undefined ? { sourceName } : {}),
    sourceText: body,
    ...(events.eventSummary !== undefined ? { eventSummary: events.eventSummary } : {}),
    ...(events.eventState !== undefined ? { eventState: events.eventState } : {}),
    ...(events.eventRawOutput !== undefined ? { eventRawOutput: events.eventRawOutput } : {}),
  };
}

/** 解析 `## 事件分析` 段文本（含或不含 `## 事件分析` 标题行均可）的 摘要：/状态：（多行）/
 *  原始输出： 三字段；缺或空 → 该键不出现。与 novel_store_align.py 的 parse_event_section
 *  逐条对齐：状态段吃到 `原始输出：` 行为止；原始输出只取标记行本身；后值覆盖前值。 */
export function parseNovelChapterMirrorEvents(
  section: string,
): Pick<Partial<NovelChapterMirror>, "eventSummary" | "eventState" | "eventRawOutput"> {
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const events: Pick<Partial<NovelChapterMirror>, "eventSummary" | "eventState" | "eventRawOutput"> = {};
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.startsWith("摘要：")) {
      const value = line.slice("摘要：".length).trim();
      if (value) events.eventSummary = value;
      cursor += 1;
    } else if (line.startsWith("状态：")) {
      const rest = line.slice("状态：".length).trim();
      cursor += 1;
      const buffer: string[] = rest ? [rest] : [];
      while (cursor < lines.length && !lines[cursor]!.startsWith("原始输出：")) {
        buffer.push(lines[cursor]!);
        cursor += 1;
      }
      const state = buffer.join("\n").trim();
      if (state) events.eventState = state;
    } else if (line.startsWith("原始输出：")) {
      const value = line.slice("原始输出：".length).trim();
      if (value) events.eventRawOutput = value;
      cursor += 1;
    } else {
      cursor += 1;
    }
  }
  return events;
}

/** file-wins（装载用）或 fill-missing-events（读回已带正文的条目用）。
 *  纯函数；无变化时原对象原样返回（changed=false、changedFields=[]）。 */
export function mergeNovelChapterWithMirror(
  chapter: NovelChapter,
  mirror: NovelChapterMirror,
  mode: NovelChapterMirrorMergeMode,
): { chapter: NovelChapter; changed: boolean; changedFields: string[] } {
  const patch: Partial<NovelChapter> = {};
  const changedFields: string[] = [];
  const mark = (field: keyof NovelChapterMirror) => {
    if (!changedFields.includes(field)) changedFields.push(field);
  };

  if (mode === "file-wins" && mirrorBodyAndMetaShouldWin(chapter, mirror)) {
    if (mirror.sourceText !== chapter.sourceText) {
      patch.sourceText = mirror.sourceText;
      mark("sourceText");
    }
    if (mirror.title && mirror.title !== chapter.title) {
      patch.title = mirror.title;
      mark("title");
    }
    if (mirror.volume !== undefined && mirror.volume !== chapter.volume) {
      patch.volume = mirror.volume;
      mark("volume");
    }
    if (mirror.sourceId !== undefined && mirror.sourceId !== chapter.sourceId) {
      patch.sourceId = mirror.sourceId;
      mark("sourceId");
    }
    if (mirror.revision !== undefined && mirror.revision !== chapter.revision) {
      patch.revision = mirror.revision;
      mark("revision");
    }
    if (mirror.sourceName !== undefined && mirror.sourceName !== chapter.sourceName) {
      patch.sourceName = mirror.sourceName;
      mark("sourceName");
    }
  }

  // 事件字段两种模式同规：只在库内该字段为空时，用正文文件里的非空值补上
  for (const field of ["eventSummary", "eventState", "eventRawOutput"] as const) {
    const mirrorValue = mirror[field];
    const chapterValue = chapter[field];
    const chapterEmpty = (chapterValue ?? "").trim() === "";
    if (mirrorValue && mirrorValue.trim() !== "" && chapterEmpty && mirrorValue !== chapterValue) {
      patch[field] = mirrorValue;
      mark(field);
    }
  }

  if (changedFields.length === 0) return { chapter, changed: false, changedFields };
  return { chapter: { ...chapter, ...patch }, changed: true, changedFields };
}

/** file-wins 的正文/元数据取向：条目没有正文 → 文件赢；条目已有正文 → 库内修订号严格
 *  大于正文文件修订号（两边都有修订号）视为「App 刚保存、文件写回未落盘」，保留库内；
 *  其余情况以正文文件为准。 */
function mirrorBodyAndMetaShouldWin(chapter: NovelChapter, mirror: NovelChapterMirror): boolean {
  const hasBody = (chapter.sourceText ?? "").trim() !== "";
  if (!hasBody) return true;
  if (chapter.revision !== undefined && mirror.revision !== undefined && chapter.revision > mirror.revision) {
    return false;
  }
  return true;
}

/** 正文在文件里的起始行：标题行 + 连续元数据行 + 至多一个空行之后（不越界）。
 *  镜像正文可能自带 `#`/`> ` 开头的行，所以头部剥离按前缀吃，与离线工具一致。 */
function findMirrorBodyStart(lines: string[]): number {
  let cursor = 0;
  if ((lines[cursor] ?? "").startsWith("# ")) cursor += 1;
  if (cursor < lines.length && lines[cursor]!.trim() === "" && lines[cursor + 1]?.startsWith("> ")) cursor += 1;
  while (cursor < lines.length && lines[cursor]!.startsWith("> ")) cursor += 1;
  if (cursor < lines.length && lines[cursor]!.trim() === "") cursor += 1;
  return cursor;
}

/** 从镜像 Markdown 提取小说正文（剥离镜像头，截断到 `## 事件分析` 段之前）。
 *  无正文返回 null。基于 parseNovelChapterMirror 实现，契约不变。 */
export function parseNovelChapterMirrorBody(markdown: string): string | null {
  const mirror = parseNovelChapterMirror(markdown);
  return mirror && mirror.sourceText.length > 0 ? mirror.sourceText : null;
}

function createChapterId(index: number) {
  return `chapter-${String(index).padStart(3, "0")}`;
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s*/, "").trim();
}
