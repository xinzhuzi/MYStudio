/**
 * Novel slice — 从 studio-store.ts 拆出(Child 2 R3 Step 4)。
 *
 * 模式与 material/config slice 一致。novel 域操作 novelChapters,
 * 并通过注入的 mirror 同步函数与 library store 联动。
 */
import type { NovelChapter } from "@/types/studio";
import {
  appendNovelChapters,
  parseNovelChapters,
  replaceNovelChapters,
} from "@/lib/studio/novel";

/** Novel slice 契约。 */
export interface NovelSlice {
  novelChapters: NovelChapter[];
  sourceBible: string;
  importNovelText: (sourceText: string) => void;
  appendNovelText: (sourceText: string, sourceName?: string) => void;
  replaceNovelText: (sourceText: string, sourceName?: string) => void;
  updateNovelChapter: (id: string, updates: Partial<NovelChapter>) => void;
  /** 1127 正文按需装载:轻索引条目(窗口化瘦身,无 sourceText)打开编辑/展示前,
   *  从章分片读回完整章并回填内存;失败返回 null(fail-open,调用方按缺失处理)。 */
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
  /** 1127 正文按需装载注入(读章分片;由 store 提供,保持 slice 无存储依赖)。 */
  loadChapterBody?: (chapterId: string) => Promise<NovelChapter | null>,
) {
  return {
    ensureNovelChapterBody: async (chapterId: string): Promise<NovelChapter | null> => {
      const existing = get().novelChapters.find((chapter) => chapter.id === chapterId);
      // 已带全文(激活章/曾装载章)直接返回,不重复读盘
      if (existing && typeof existing.sourceText === "string" && existing.sourceText.length > 0) {
        return existing;
      }
      if (!loadChapterBody) return null;
      const full = await loadChapterBody(chapterId);
      if (!full || typeof full.sourceText !== "string" || full.sourceText.length === 0) return null;
      // 回填内存(按 id 原位替换保序);不触发瘦身——正文就该留在内存供编辑展示
      set((state) => ({
        novelChapters: state.novelChapters.map((chapter) => (
          chapter.id === chapterId ? { ...chapter, ...full, id: chapter.id } : chapter
        )),
      }));
      return get().novelChapters.find((chapter) => chapter.id === chapterId) ?? full;
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
