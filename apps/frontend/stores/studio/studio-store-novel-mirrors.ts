import { buildNovelChapterMirror, novelChapterMirrorRelativePath, parseNovelChapterMirrorBody } from "@/lib/studio/novel";
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

/** 1127 正文按需装载：从章节正文镜像（novel/chapters/<章>.md，README 真源）读回小说正文。
 *  剥离镜像头取正文（parseNovelChapterMirrorBody）；读不到/解析不出=返回 null（fail-open，
 *  调用方按缺失处理）。raw=true 走 16MB 通道：自家写入的镜像可信，免 2MB 预览截断。 */
export async function loadNovelChapterMirrorBody(
  projectId: string | null | undefined,
  chapter: Pick<NovelChapter, "index">,
  projectFiles: NovelMirrorFiles | undefined,
): Promise<string | null> {
  if (!projectId || !projectFiles?.readText) return null;
  const relativePath = novelChapterMirrorRelativePath(chapter.index);
  const result = await projectFiles.readText({ projectId, relativePath, raw: true });
  const text = typeof result === "string" ? result : result?.text;
  if (typeof text !== "string" || text.length === 0) return null;
  return parseNovelChapterMirrorBody(text);
}

/** 启动/切项目治愈：store 圣经为空时只从 MEMORY.md 回读，外部编辑可被拾取。 */
export async function loadSourceBibleMirror(
  projectId: string | null | undefined,
  projectFiles: NovelMirrorFiles | undefined,
): Promise<string> {
  if (!projectId || !projectFiles?.readText) return "";
  return readResidentBible({ projectId, readText: projectFiles.readText });
}
