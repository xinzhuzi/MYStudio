import { useProjectStore } from "@/stores/project/project-store";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import type { NovelChapter } from "@/types/studio";
import {
  loadNovelChapterMirrorBody,
  loadSourceBibleMirror as loadSourceBibleMirrorInFiles,
  removeNovelChapterMirrors as removeNovelChapterMirrorsInFiles,
  syncNovelChapterMirrors as syncNovelChapterMirrorsInFiles,
  syncSourceBibleMirror as syncSourceBibleMirrorInFiles,
} from "./studio-store-novel-mirrors";

export function createStudioWorkflowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function syncNovelChapterMirrorsForActiveProject(chapters: NovelChapter[]) {
  syncNovelChapterMirrorsInFiles(
    getActiveProjectId(),
    chapters,
    getProjectFiles(),
  );
}

export function removeNovelChapterMirrorsForActiveProject(chapters: NovelChapter[]) {
  removeNovelChapterMirrorsInFiles(
    getActiveProjectId(),
    chapters,
    getProjectFiles(),
  );
}

export function syncSourceBibleMirrorForActiveProject(text: string) {
  syncSourceBibleMirrorInFiles(getActiveProjectId(), text, getProjectFiles());
}

export function loadSourceBibleMirrorForActiveProject(): Promise<string> {
  return loadSourceBibleMirrorInFiles(getActiveProjectId(), getProjectFiles());
}

/** 1127 正文按需装载:按活动项目从章节正文镜像读回小说正文(轻索引条目编辑/展示前调)。 */
export function loadNovelChapterMirrorBodyForActiveProject(
  chapter: Pick<NovelChapter, "index">,
): Promise<string | null> {
  return loadNovelChapterMirrorBody(getActiveProjectId(), chapter, getProjectFiles());
}

function getActiveProjectId() {
  return useProjectStore.getState().activeProjectId;
}

function getProjectFiles() {
  return getProjectFilesBridge();
}
