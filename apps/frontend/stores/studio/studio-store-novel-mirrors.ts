import {
  buildNovelChapterMirror,
  novelChapterMirrorRelativePath,
  parseNovelChapterMirror,
  type NovelChapterMirror,
} from "@/lib/studio/novel";
import { readResidentBible, sourceBibleMirrorKey } from "@/lib/studio/source-bible";
import type { NovelChapter } from "@/types/studio";

type NovelMirrorFiles = {
  writeText?: (key: string, value: string) => Promise<unknown>;
  removeText?: (key: string) => Promise<unknown>;
  readText?: (payload: { projectId: string; relativePath: string; raw?: boolean }) => Promise<
    { success?: boolean; text?: string } | string | null
  >;
};

export function syncNovelChapterMirrors(
  projectId: string | null | undefined,
  chapters: NovelChapter[],
  projectFiles: NovelMirrorFiles | undefined,
) {
  if (!projectId || !projectFiles?.writeText) return;
  for (const chapter of chapters) {
    // 窗口化 v1：轻索引项（无正文）不重写镜像——其镜像在激活期已写入
    if (typeof chapter.sourceText !== "string") continue;
    const mirror = buildNovelChapterMirror(projectId, chapter);
    projectFiles.writeText(mirror.key, mirror.content).catch((error: unknown) => {
      console.warn("[StudioStore] Failed to write novel chapter mirror:", error);
    });
  }
}

export function removeNovelChapterMirrors(
  projectId: string | null | undefined,
  chapters: NovelChapter[],
  projectFiles: NovelMirrorFiles | undefined,
) {
  if (!projectId || !projectFiles?.removeText) return;
  for (const chapter of chapters) {
    // 窗口化 v1：轻索引项（无正文）不重写镜像——其镜像在激活期已写入
    if (typeof chapter.sourceText !== "string") continue;
    const mirror = buildNovelChapterMirror(projectId, chapter);
    projectFiles.removeText(mirror.key).catch((error: unknown) => {
      console.warn("[StudioStore] Failed to remove novel chapter mirror:", error);
    });
  }
}

/** 原著圣经保存时同步唯一常驻层 MEMORY.md，文件随项目目录走。 */
export function syncSourceBibleMirror(
  projectId: string | null | undefined,
  text: string,
  projectFiles: NovelMirrorFiles | undefined,
) {
  if (!projectId || !projectFiles?.writeText) return;
  projectFiles
    .writeText(sourceBibleMirrorKey(projectId), text)
    .catch((error: unknown) => {
      console.warn("[StudioStore] Failed to write source bible mirror:", error);
    });
}

/** 1127 正文真源读回：读整份正文文件（novel/chapters/<章>.md，唯一真源）并解析为
 *  NovelChapterMirror（头部元数据+正文+事件段），供 mergeNovelChapterWithMirror 三入口
 *  （启动对齐/切章/读回）共用。读不到/读取失败/解析不出 → null（fail-open，调用方按
 *  缺失处理）。raw=true 走 16MB 通道：正文文件可信，免 2MB 预览截断。 */
export async function loadNovelChapterMirror(
  projectId: string | null | undefined,
  chapter: Pick<NovelChapter, "index">,
  projectFiles: NovelMirrorFiles | undefined,
): Promise<NovelChapterMirror | null> {
  if (!projectId || !projectFiles?.readText) return null;
  const relativePath = novelChapterMirrorRelativePath(chapter.index);
  let result: { success?: boolean; text?: string } | string | null;
  try {
    result = await projectFiles.readText({ projectId, relativePath, raw: true });
  } catch {
    return null;
  }
  const text = typeof result === "string" ? result : result?.text;
  if (typeof text !== "string" || text.length === 0) return null;
  return parseNovelChapterMirror(text);
}

/** 启动/切项目治愈：store 圣经为空时只从 MEMORY.md 回读，外部编辑可被拾取。 */
export async function loadSourceBibleMirror(
  projectId: string | null | undefined,
  projectFiles: NovelMirrorFiles | undefined,
): Promise<string> {
  if (!projectId || !projectFiles?.readText) return "";
  return readResidentBible({ projectId, readText: projectFiles.readText });
}
