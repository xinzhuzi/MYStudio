import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelfMediaGlobalStore } from "./self-media-global-store";
import type { GlobalHistoryRecord } from "./self-media-global-store";
import type { SelfMediaHistoryRecord } from "@/types/self-media";

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    projects: [] as Array<{ id: string; name: string }>,
    throwOnGetState: false,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  };
});

vi.mock("@/lib/storage/indexed-db-storage", () => ({
  fileStorage: {
    getItem: mocks.getItem,
  },
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: {
    getState: () => {
      if (mocks.throwOnGetState) throw new Error("project store unavailable");
      return { projects: mocks.projects };
    },
  },
}));

function historyRecord(overrides: Partial<SelfMediaHistoryRecord> & Pick<SelfMediaHistoryRecord, "id" | "projectId">): SelfMediaHistoryRecord {
  return {
    attemptId: `attempt-${overrides.id}`,
    providerId: "aitoearn-local",
    accountId: "account-1",
    sourceAssetIds: [],
    status: "success",
    progress: 100,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:01:00.000Z",
    finishedAt: "2026-11-01T00:01:00.000Z",
    ...overrides,
  };
}

/** 以 zustand persist 形态写入某个项目的 self-media 存储 */
function persistProjectHistory(projectId: string, history: unknown[]) {
  mocks.storage.set(`_p/${projectId}/self-media`, JSON.stringify({ state: { history }, version: 0 }));
}

beforeEach(() => {
  mocks.storage.clear();
  mocks.getItem.mockImplementation(async (key: string) => mocks.storage.get(key) ?? null);
  mocks.projects = [
    { id: "project-a", name: "项目甲" },
    { id: "project-b", name: "项目乙" },
  ];
  mocks.throwOnGetState = false;
  useSelfMediaGlobalStore.setState({
    allHistory: [],
    currentPage: 1,
    loading: false,
    loaded: false,
    filterProductId: "",
    error: null,
  });
});

describe("loadAllHistory", () => {
  it("aggregates every project's history, attaches project names, and sorts newest first", async () => {
    persistProjectHistory("project-a", [
      historyRecord({ id: "a-old", projectId: "project-a", finishedAt: "2026-11-01T00:00:00.000Z" }),
      historyRecord({ id: "a-new", projectId: "project-a", finishedAt: "2026-11-03T00:00:00.000Z" }),
    ]);
    persistProjectHistory("project-b", [
      historyRecord({ id: "b-mid", projectId: "project-b", finishedAt: "2026-11-02T00:00:00.000Z" }),
    ]);

    await useSelfMediaGlobalStore.getState().loadAllHistory();

    const state = useSelfMediaGlobalStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.allHistory.map((record) => record.id)).toEqual(["a-new", "b-mid", "a-old"]);
    const byId = new Map(state.allHistory.map((record) => [record.id, record]));
    expect(byId.get("a-new")?.projectName).toBe("项目甲");
    expect(byId.get("b-mid")?.projectName).toBe("项目乙");
  });

  it("accepts bare {history} payloads and drops malformed entries", async () => {
    mocks.storage.set("_p/project-a/self-media", JSON.stringify({ history: [historyRecord({ id: "bare", projectId: "project-a" })] }));
    // 构造缺 projectId 的坏记录(JSON.stringify 会丢弃 undefined 键)
    const withoutProject = { ...historyRecord({ id: "no-project", projectId: "project-b" }), projectId: undefined };
    mocks.storage.set("_p/project-b/self-media", JSON.stringify({ history: [withoutProject] }));
    mocks.storage.set("_p/project-c/self-media", "{ not json");
    mocks.projects = [...mocks.projects, { id: "project-c", name: "项目丙" }];

    await useSelfMediaGlobalStore.getState().loadAllHistory();

    expect(useSelfMediaGlobalStore.getState().allHistory.map((record) => record.id)).toEqual(["bare"]);
  });

  it("returns [] for projects with no stored data", async () => {
    await useSelfMediaGlobalStore.getState().loadAllHistory();
    expect(useSelfMediaGlobalStore.getState().allHistory).toEqual([]);
    expect(useSelfMediaGlobalStore.getState().loaded).toBe(true);
  });

  it("is lazy: a loaded store skips re-reading until forced", async () => {
    persistProjectHistory("project-a", [historyRecord({ id: "first", projectId: "project-a" })]);
    await useSelfMediaGlobalStore.getState().loadAllHistory();
    expect(useSelfMediaGlobalStore.getState().allHistory.map((record) => record.id)).toEqual(["first"]);

    // 缓存命中:存储已变但不刷新
    persistProjectHistory("project-a", [historyRecord({ id: "second", projectId: "project-a" })]);
    await useSelfMediaGlobalStore.getState().loadAllHistory();
    expect(useSelfMediaGlobalStore.getState().allHistory.map((record) => record.id)).toEqual(["first"]);

    // force 刷新拿到新数据,并重置回第一页
    useSelfMediaGlobalStore.setState({ currentPage: 3 });
    await useSelfMediaGlobalStore.getState().loadAllHistory(true);
    expect(useSelfMediaGlobalStore.getState().allHistory.map((record) => record.id)).toEqual(["second"]);
    expect(useSelfMediaGlobalStore.getState().currentPage).toBe(1);
  });

  it("does not start a second load while one is in flight", async () => {
    persistProjectHistory("project-a", [historyRecord({ id: "first", projectId: "project-a" })]);
    useSelfMediaGlobalStore.setState({ loading: true });

    await useSelfMediaGlobalStore.getState().loadAllHistory();

    // loading 中的调用直接返回:既不读存储也不置 loaded
    const state = useSelfMediaGlobalStore.getState();
    expect(state.allHistory).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(true);
  });

  it("swallows a single project's storage failure and still loads the rest", async () => {
    mocks.getItem.mockImplementationOnce(async () => {
      throw new Error("db corrupted");
    });
    persistProjectHistory("project-b", [historyRecord({ id: "b-ok", projectId: "project-b" })]);

    await useSelfMediaGlobalStore.getState().loadAllHistory();

    const state = useSelfMediaGlobalStore.getState();
    expect(state.allHistory.map((record) => record.id)).toEqual(["b-ok"]);
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
  });

  it("records the error and clears loading when reading projects fails", async () => {
    mocks.throwOnGetState = true;
    await useSelfMediaGlobalStore.getState().loadAllHistory();

    const state = useSelfMediaGlobalStore.getState();
    expect(state.error).toBe("project store unavailable");
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(false);
  });
});

describe("pagination and filtering (computed on demand)", () => {
  function seedHistory(count: number, productOf: (index: number) => string): GlobalHistoryRecord[] {
    return Array.from({ length: count }, (_, index) => ({
      ...historyRecord({
        id: `record-${index}`,
        projectId: "project-a",
        finishedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
        productId: productOf(index),
      }),
      projectName: "项目甲",
    }));
  }

  beforeEach(() => {
    // 25 条:前 20 条属 product-1,后 5 条属 product-2
    const records = seedHistory(25, (index) => (index < 20 ? "product-1" : "product-2"));
    useSelfMediaGlobalStore.setState({ allHistory: records, loaded: true });
  });

  it("pages through history with pageSize 20", () => {
    const store = useSelfMediaGlobalStore.getState();
    expect(store.pageSize).toBe(20);
    expect(store.getPagedHistory()).toHaveLength(20);
    expect(store.hasMore()).toBe(true); // 1*20 < 25

    store.loadMore();
    const afterLoadMore = useSelfMediaGlobalStore.getState();
    expect(afterLoadMore.currentPage).toBe(2);
    expect(afterLoadMore.getPagedHistory()).toHaveLength(25);
    expect(afterLoadMore.hasMore()).toBe(false); // 2*20 >= 25

    // 没有更多页时 loadMore 是空操作
    afterLoadMore.loadMore();
    expect(useSelfMediaGlobalStore.getState().currentPage).toBe(2);
  });

  it("resets to the first page", () => {
    useSelfMediaGlobalStore.getState().loadMore();
    expect(useSelfMediaGlobalStore.getState().currentPage).toBe(2);
    useSelfMediaGlobalStore.getState().resetPage();
    expect(useSelfMediaGlobalStore.getState().currentPage).toBe(1);
  });

  it("filters by product and restarts pagination from page 1", () => {
    useSelfMediaGlobalStore.getState().loadMore(); // 翻到第 2 页
    useSelfMediaGlobalStore.getState().setFilterProductId("product-2");

    const state = useSelfMediaGlobalStore.getState();
    expect(state.filterProductId).toBe("product-2");
    expect(state.currentPage).toBe(1);
    expect(state.getFilteredTotal()).toBe(5);
    expect(state.getPagedHistory().map((record) => record.productId)).toEqual(["product-2", "product-2", "product-2", "product-2", "product-2"]);
    expect(state.hasMore()).toBe(false); // 1*20 >= 5

    state.setFilterProductId("");
    expect(useSelfMediaGlobalStore.getState().getFilteredTotal()).toBe(25);
    expect(useSelfMediaGlobalStore.getState().hasMore()).toBe(true);
  });
});
