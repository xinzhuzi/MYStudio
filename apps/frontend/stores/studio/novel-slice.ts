/**
 * Novel slice — 从 studio-store.ts 拆出(Child 2 R3 Step 4)。
 *
 * 模式与 material/config slice 一致。novel 域操作 novelChapters,
 * 并通过注入的 mirror 同步函数与 library store 联动。
 */
import type { NovelChapter } from "@/types/studio";
import {
  appendNovelChapters,
  mergeNovelChapterWithMirror,
  parseNovelChapters,
  replaceNovelChapters,
  type NovelChapterMirror,
} from "@/lib/studio/novel";

/** Novel slice 契约。 */
export interface NovelSlice {
  novelChapters: NovelChapter[];
  sourceBible: string;
  importNovelText: (sourceText: string) => void;
  appendNovelText: (sourceText: string, sourceName?: string) => void;
  replaceNovelText: (sourceText: string, sourceName?: string) => void;
  updateNovelChapter: (id: string, updates: Partial<NovelChapter>) => void;
  /** 1127 正文真源读回:轻索引条目(窗口化瘦身,无 sourceText)打开编辑/展示前,
   *  从正文文件(novel/chapters/<章>.md,唯一真源)读回并与内存条目合并(design §1.1);
   *  文件缺失且无正文返回 null(fail-open,调用方按缺失处理)。 */
  ensureNovelChapterBody?: (chapterId: string) => Promise<NovelChapter | null>;
  saveSourceBible: (text: string) => void;
}

/** slice 能看到的 store 局部视图。 */
interface NovelSliceStore {
  novelChapters: NovelChapter[];
  sourceBible: string;
}

type SetFn = (
  fnOrPartial:
    | ((state: NovelSliceStore) => Partial<NovelSliceStore>)
    | Partial<NovelSliceStore>,
) => void;
type GetFn = () => NovelSliceStore;

/** 窗口化 v1：导入/追加/替换后锚定激活章并瘦身非激活章（经全 store 视图，避免 slice 类型耦合） */
type WindowStoreView = {
  activeChapterId?: string | null;
  slimNonActiveChapters: () => boolean;
};
function windowHook(
  get: GetFn,
  set: SetFn,
  novelChapters: NovelChapter[],
): void {
  const view = get() as unknown as WindowStoreView;
  if (!view.activeChapterId) {
    (set as unknown as (partial: Record<string, unknown>) => void)({
      activeChapterId: novelChapters[0]?.id ?? null,
    });
  }
  const after = get() as unknown as WindowStoreView;
  after.slimNonActiveChapters?.();
}

/** mirror 同步注入(由 store 提供,内部转发到 library stores 与项目文件)。 */
export interface NovelMirrorDeps {
  syncNovelChapterMirrors: (chapters: NovelChapter[]) => void;
  removeNovelChapterMirrors: (chapters: NovelChapter[]) => void;
  syncSourceBibleMirror?: (text: string) => void;
}

/** novel slice 的 action 实现。 */
export function createNovelSliceActions(
  set: SetFn,
  get: GetFn,
  mirrors: NovelMirrorDeps,
  /** 1127 正文真源读回注入(读整份正文文件并解析;由 store 提供,保持 slice 无存储依赖)。 */
  loadChapterMirror?: (chapter: NovelChapter) => Promise<NovelChapterMirror | null>,
) {
  return {
    ensureNovelChapterBody: async (chapterId: string): Promise<NovelChapter | null> => {
      const existing = get().novelChapters.find((chapter) => chapter.id === chapterId);
      if (!existing) return null;
      const hasBody = (existing.sourceText ?? "").trim() !== "";
      const hasEvents = (existing.eventSummary ?? "").trim() !== ""
        || (existing.eventState ?? "").trim() !== "";
      // 已带正文且有事件:快路径零读盘(design §1.1「读回」)
      if (hasBody && hasEvents) return existing;
      if (!loadChapterMirror) return null;
      const mirror = await loadChapterMirror(existing);
      // 读正文文件失败:有正文返回原条目,无正文按缺失处理(fail-open)
      if (!mirror) return hasBody ? existing : null;
      const { chapter: merged, changed } = mergeNovelChapterWithMirror(
        existing,
        mirror,
        hasBody ? "fill-missing-events" : "file-wins",
      );
      if (!changed) return existing;
      // 原位回填(按 id 替换保序);不触发瘦身——正文就该留在内存供编辑展示
      set((state) => ({
        novelChapters: state.novelChapters.map((chapter) => (
          chapter.id === chapterId ? merged : chapter
        )),
      }));
      return get().novelChapters.find((chapter) => chapter.id === chapterId) ?? merged;
    },

    importNovelText: (sourceText: string): void => {
      const novelChapters = parseNovelChapters(sourceText);
      set({ novelChapters });
      windowHook(get, set, novelChapters);
      mirrors.syncNovelChapterMirrors(novelChapters);
    },

    appendNovelText: (sourceText: string, sourceName?: string): void => {
      const novelChapters = appendNovelChapters(get().novelChapters, sourceText, {
        sourceName,
      });
      const importedChapters = novelChapters.slice(get().novelChapters.length);
      set({ novelChapters });
      windowHook(get, set, novelChapters);
      mirrors.syncNovelChapterMirrors(importedChapters);
    },

    replaceNovelText: (sourceText: string, sourceName?: string): void => {
      const previousChapters = get().novelChapters;
      const novelChapters = replaceNovelChapters(sourceText, { sourceName });
      set({ novelChapters });
      windowHook(get, set, novelChapters);
      mirrors.syncNovelChapterMirrors(novelChapters);
      mirrors.removeNovelChapterMirrors(
        previousChapters.filter(
          (chapter) => !novelChapters.some((next) => next.id === chapter.id),
        ),
      );
    },

    updateNovelChapter: (id: string, updates: Partial<NovelChapter>): void => {
      const chapterUpdates = { ...updates };
      delete chapterUpdates.sourceId;
      delete chapterUpdates.revision;
      set((state) => ({
        novelChapters: state.novelChapters.map((chapter) => {
          if (chapter.id !== id) return chapter;

          const sourceId = chapter.sourceId ?? chapter.id;
          const revision = chapter.revision ?? 1;
          const nextChapter = { ...chapter, ...chapterUpdates };
          const sourceIdentityChanged =
            nextChapter.title !== chapter.title ||
            nextChapter.volume !== chapter.volume ||
            nextChapter.sourceText !== chapter.sourceText;

          return {
            ...nextChapter,
            sourceId,
            revision: sourceIdentityChanged ? revision + 1 : revision,
            updatedAt: Date.now(),
          };
        }),
      }));
      const updatedChapter = get().novelChapters.find(
        (chapter) => chapter.id === id,
      );
      if (updatedChapter) {
        mirrors.syncNovelChapterMirrors([updatedChapter]);
      }
    },

    saveSourceBible: (text: string): void => {
      set({ sourceBible: text });
      mirrors.syncSourceBibleMirror?.(text);
    },
  };
}
