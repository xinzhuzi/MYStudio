import { buildNovelChapterMirror } from "@/lib/studio/novel";
import { sourceBibleMirrorKey } from "@/lib/studio/source-bible";
import type { NovelChapter } from "@/types/studio";

type NovelMirrorFiles = {
  writeText?: (key: string, value: string) => Promise<unknown>;
  removeText?: (key: string) => Promise<unknown>;
  readText?: (payload: { projectId: string; relativePath: string }) => Promise<
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
    const mirror = buildNovelChapterMirror(projectId, chapter);
    projectFiles.removeText(mirror.key).catch((error: unknown) => {
      console.warn("[StudioStore] Failed to remove novel chapter mirror:", error);
    });
  }
}

/** 原著圣经保存时同步项目内 Markdown 镜像（novel/source-bible.md），文件随项目目录走。 */
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

/** 启动/切项目治愈：store 圣经为空时从项目文件回读（外部编辑器改动也能被拾取）。 */
export async function loadSourceBibleMirror(
  projectId: string | null | undefined,
  projectFiles: NovelMirrorFiles | undefined,
): Promise<string> {
  if (!projectId || !projectFiles?.readText) return "";
  try {
    const result = await projectFiles.readText({
      projectId,
      relativePath: "novel/source-bible.md",
    });
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && result.success) {
      return typeof result.text === "string" ? result.text : "";
    }
    return "";
  } catch {
    return "";
  }
}
