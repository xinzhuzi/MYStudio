/**
 * Memory slice — 从 studio-store.ts 拆出(Child 2 R3 Step 5)。
 *
 * 操作 eventGraph + projectMemoryRecords,依赖 novelChapters(读)和
 * buildProjectEventGraph/projectEventGraphToMemoryRecords/retrieveProjectMemory 工具。
 */
import type {
  NovelChapter,
  ProjectEventGraphRecord,
  ProjectMemoryContext,
  ProjectMemoryQuery,
  ProjectMemoryRecord,
} from "@/types/studio";
import {
  buildProjectEventGraph,
  projectEventGraphToMemoryRecords,
  retrieveProjectMemory,
} from "@/lib/studio/event-graph";

/** Memory slice 契约。 */
export interface MemorySlice {
  eventGraph: ProjectEventGraphRecord[];
  projectMemoryRecords: ProjectMemoryRecord[];
  rebuildProjectMemoryFromChapters: (projectId: string) => void;
  retrieveProjectMemory: (query: ProjectMemoryQuery) => ProjectMemoryContext;
  purgeProjectMemory: (projectId: string) => void;
}

/** slice 能看到的 store 局部视图。 */
interface MemorySliceStore {
  novelChapters: NovelChapter[];
  eventGraph: ProjectEventGraphRecord[];
  projectMemoryRecords: ProjectMemoryRecord[];
}

type SetFn = (
  fn: (state: MemorySliceStore) => Partial<MemorySliceStore>,
) => void;
type GetFn = () => MemorySliceStore;

/** memory slice 的 action 实现。 */
export function createMemorySliceActions(set: SetFn, get: GetFn) {
  return {
    rebuildProjectMemoryFromChapters: (projectId: string): void => {
      const eventGraph = buildProjectEventGraph({
        projectId,
        chapters: get().novelChapters,
      });
      const memoryRecords = projectEventGraphToMemoryRecords(eventGraph);
      set((state) => ({
        eventGraph: [
          ...state.eventGraph.filter((record) => record.projectId !== projectId),
          ...eventGraph,
        ],
        projectMemoryRecords: [
          ...state.projectMemoryRecords.filter(
            (record) => record.projectId !== projectId || record.kind !== "event",
          ),
          ...memoryRecords,
        ],
      }));
    },

    retrieveProjectMemory: (query: ProjectMemoryQuery): ProjectMemoryContext =>
      retrieveProjectMemory(get().projectMemoryRecords, query),

    purgeProjectMemory: (projectId: string): void => {
      set((state) => ({
        eventGraph: state.eventGraph.filter(
          (record) => record.projectId !== projectId,
        ),
        projectMemoryRecords: state.projectMemoryRecords.filter(
          (record) => record.projectId !== projectId,
        ),
      }));
    },
  };
}
