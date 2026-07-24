import { useProjectStore } from "@/stores/project-store";
import type { NovelChapter } from "@/types/studio";
import {
  removeNovelChapterMirrors as removeNovelChapterMirrorsInFiles,
  syncNovelChapterMirrors as syncNovelChapterMirrorsInFiles,
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

function getActiveProjectId() {
  return useProjectStore.getState().activeProjectId;
}

function getProjectFiles() {
  return typeof window !== "undefined" ? window.projectFiles : undefined;
}
