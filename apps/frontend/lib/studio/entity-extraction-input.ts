/**
 * 实体提取的逐章输入源解析(纯逻辑+注入读文件通道,C1 Step 4;design §2 / D1 / D22)。
 *
 * 优先级:该章 scriptDraft(agentWorkData)> novel/drama/chapter-NNN_漫剧.md > 无。
 * **不回落小说原文**——D1/轮3 D22 统一口径:本模块类型面上就没有小说
 * sourceText 参数,「不回落」由签名锁死,单章与批量共用同一输入解析。
 *
 * drama 文件名补零规则同 createChapterId(novel.ts:114 padStart(3,"0")):
 * chapter-001…chapter-999 三位、≥1000 自然四位(盘上 4125 章实证)。
 * readText truncated===true → 判失败 input_truncated(AC1,不静默用半文)。
 */

export interface DramaFileReadResult {
  success: boolean;
  text?: string;
  truncated?: boolean;
  error?: string;
}

/** drama 文件读取通道(注入;生产走 electronAPI.projectFiles.readText)。 */
export type ReadDramaFile = (relativePath: string) => Promise<DramaFileReadResult>;

export type ResolvedExtractionChapterInput =
  | { status: "ok"; source: "scriptDraft" | "drama"; text: string }
  | { status: "no_input" }
  | { status: "input_truncated" };

/** 章号 → chapterId(补零规则同 lib/studio/novel.ts createChapterId)。 */
export function chapterIdFromNumber(chapterNumber: number): string {
  return `chapter-${String(chapterNumber).padStart(3, "0")}`;
}

/** 章号 → drama 剧本文件的项目相对路径。 */
export function dramaRelativePathForChapter(chapterNumber: number): string {
  return `novel/drama/${chapterIdFromNumber(chapterNumber)}_漫剧.md`;
}

export interface ResolveExtractionChapterInputOptions {
  chapterNumber: number;
  /** 该章最新剧本草稿(agentWorkData);空白视为无。 */
  scriptDraft?: string | null;
  readDramaFile: ReadDramaFile;
}

/** 解析单章提取输入(D1 优先级;D22:无小说回落分支)。 */
export async function resolveExtractionChapterInput(
  options: ResolveExtractionChapterInputOptions,
): Promise<ResolvedExtractionChapterInput> {
  const draft = options.scriptDraft?.trim();
  if (draft) {
    return { status: "ok", source: "scriptDraft", text: options.scriptDraft! };
  }

  const read = await options.readDramaFile(
    dramaRelativePathForChapter(options.chapterNumber),
  );
  if (!read.success) {
    return { status: "no_input" };
  }
  if (read.truncated === true) {
    return { status: "input_truncated" };
  }
  const text = read.text?.trim();
  if (!text) {
    return { status: "no_input" };
  }
  return { status: "ok", source: "drama", text: read.text! };
}
