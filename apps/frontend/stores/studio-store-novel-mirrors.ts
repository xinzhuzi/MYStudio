import { buildNovelChapterMirror } from "@/lib/studio/novel";
import type { NovelChapter } from "@/types/studio";

type NovelMirrorFiles = {
  writeText?: (key: string, value: string) => Promise<unknown>;
  removeText?: (key: string) => Promise<unknown>;
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
