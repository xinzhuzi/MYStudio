/**
 * B3 跨项目视图全局 store——聚合所有项目的 task history,支持分页与懒加载。
 * 不绑项目 scope,作为跨项目视图的数据源。
 *
 * 设计要点:
 * - 从各项目 `_p/{projectId}/self-media` 读取 history 记录
 * - 懒加载:首次访问全局视图时加载,之后缓存
 * - 分页:避免一次性渲染全部记录导致卡顿
 * - 产品筛选:可按 productId 过滤
 */
import { create } from "zustand";
import { fileStorage } from "@/lib/storage/indexed-db-storage";
import { useProjectStore } from "@/stores/project/project-store";
import type { SelfMediaHistoryRecord } from "@/types/self-media";

/** 单条全局历史记录,附带项目名称 */
export interface GlobalHistoryRecord extends SelfMediaHistoryRecord {
  projectName: string;
}

/** 分页配置 */
const PAGE_SIZE = 20;

export interface SelfMediaGlobalStore {
  /** 聚合的历史记录(按 finishedAt 降序) */
  allHistory: GlobalHistoryRecord[];
  /** 当前显示的分页页码(从 1 开始) */
  currentPage: number;
  /** 每页条数 */
  pageSize: number;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否已完成首次加载 */
  loaded: boolean;
  /** 产品筛选(空字符串=全部) */
  filterProductId: string;
  /** 错误信息 */
  error: string | null;

  /** 从所有项目加载历史记录(首次加载或强制刷新) */
  loadAllHistory: (force?: boolean) => Promise<void>;
  /** 加载更多(翻页) */
  loadMore: () => void;
  /** 重置分页到第一页 */
  resetPage: () => void;
  /** 设置产品筛选 */
  setFilterProductId: (productId: string) => void;

  /** 计算属性:当前页的记录 */
  getPagedHistory: () => GlobalHistoryRecord[];
  /** 计算属性:总记录数(筛选后) */
  getFilteredTotal: () => number;
  /** 计算属性:是否有更多页 */
  hasMore: () => boolean;
}

/**
 * 从持久化的 zustand 数据中安全提取 history 记录。
 * zustand persist 格式: { state: { history: [...] }, version: N }
 */
function extractHistoryFromPersisted(raw: string): SelfMediaHistoryRecord[] {
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state ?? parsed;
    const history = state?.history;
    if (!Array.isArray(history)) return [];
    return history.filter(
      (item): item is SelfMediaHistoryRecord =>
        item && typeof item === "object" && typeof item.id === "string" && typeof item.projectId === "string",
    );
  } catch {
    return [];
  }
}

export const useSelfMediaGlobalStore = create<SelfMediaGlobalStore>((set, get) => ({
  allHistory: [],
  currentPage: 1,
  pageSize: PAGE_SIZE,
  loading: false,
  loaded: false,
  filterProductId: "",
  error: null,

  loadAllHistory: async (force = false) => {
    const state = get();
    if (state.loading) return;
    if (state.loaded && !force) return;

    set({ loading: true, error: null });

    try {
      // 获取所有已注册项目
      const projects = useProjectStore.getState().projects;
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const projectIds = projects.map((p) => p.id);

      // 并行读取各项目的 self-media store
      const results = await Promise.allSettled(
        projectIds.map(async (projectId): Promise<GlobalHistoryRecord[]> => {
          const key = `_p/${projectId}/self-media`;
          const raw = await fileStorage.getItem(key);
          if (!raw) return [];
          const records = extractHistoryFromPersisted(raw);
          const projectName = projectMap.get(projectId) ?? projectId;
          return records.map((record) => ({ ...record, projectName }));
        }),
      );

      // 合并并按 finishedAt 降序排序
      const allHistory: GlobalHistoryRecord[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          allHistory.push(...result.value);
        }
      }
      allHistory.sort((a, b) => {
        const aTime = a.finishedAt ? Date.parse(a.finishedAt) : 0;
        const bTime = b.finishedAt ? Date.parse(b.finishedAt) : 0;
        return bTime - aTime; // 降序,最新的在前
      });

      set({
        allHistory,
        currentPage: 1,
        loading: false,
        loaded: true,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "加载跨项目历史失败",
      });
    }
  },

  loadMore: () => {
    const state = get();
    if (!state.hasMore()) return;
    set({ currentPage: state.currentPage + 1 });
  },

  resetPage: () => {
    set({ currentPage: 1 });
  },

  setFilterProductId: (productId) => {
    set({ filterProductId: productId, currentPage: 1 });
  },

  getPagedHistory: () => {
    const { allHistory, currentPage, pageSize, filterProductId } = get();
    const filtered = filterProductId
      ? allHistory.filter((r) => r.productId === filterProductId)
      : allHistory;
    return filtered.slice(0, currentPage * pageSize);
  },

  getFilteredTotal: () => {
    const { allHistory, filterProductId } = get();
    return filterProductId
      ? allHistory.filter((r) => r.productId === filterProductId).length
      : allHistory.length;
  },

  hasMore: () => {
    const { currentPage, pageSize } = get();
    const total = get().getFilteredTotal();
    return currentPage * pageSize < total;
  },
}));
