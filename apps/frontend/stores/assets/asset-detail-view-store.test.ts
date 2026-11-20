import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetDetailViewStore } from "./asset-detail-view-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { StudioAssetSummary } from "@/types/studio-assets";

/**
 * 1120-asset-detail-standalone-view §5.6/§10.6:store 三用例——
 * 二态切换 / 跨 tab 跳转 / closedAt 触发(script-tab 订阅静默刷新的驱动位)。
 */
function asset(id: string, name = id): StudioAssetSummary {
  return { id, name, type: "role", source: "manying-local" };
}

beforeEach(() => {
  useAssetDetailViewStore.setState({ target: null, origin: null, closedAt: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("asset-detail-view-store 二态切换(openFromLibrary/close)", () => {
  it("openFromLibrary 落 target+origin;close 清 target 记 closedAt,origin 留存", () => {
    const row = asset("role-1", "晏燎");
    useAssetDetailViewStore.getState().openFromLibrary(row);

    const opened = useAssetDetailViewStore.getState();
    expect(opened.target?.id).toBe("role-1");
    expect(opened.origin).toBe("library");
    expect(opened.closedAt).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0));
    useAssetDetailViewStore.getState().close();

    const closed = useAssetDetailViewStore.getState();
    expect(closed.target).toBeNull();
    expect(closed.closedAt).toBe(new Date(2026, 10, 20, 12, 0, 0).getTime());
    // origin 留存供下次(§5.2)
    expect(closed.origin).toBe("library");
    vi.useRealTimers();
  });

  it("close 空置态零副作用(closedAt 不虚记)", () => {
    useAssetDetailViewStore.getState().close();
    expect(useAssetDetailViewStore.getState().closedAt).toBeNull();
  });
});

describe("asset-detail-view-store 跨 tab 跳转(openFromScriptTab)", () => {
  it("先切资产 tab 再落 target,origin=script-tab", () => {
    useMediaPanelStore.setState({ activeTab: "script" });
    const row = asset("role-2", "玄止");

    useAssetDetailViewStore.getState().openFromScriptTab(row);

    // tab 已切到 assets(蓝图钉序的行为可见面:两者都生效)
    expect(useMediaPanelStore.getState().activeTab).toBe("assets");
    const state = useAssetDetailViewStore.getState();
    expect(state.target?.id).toBe("role-2");
    expect(state.origin).toBe("script-tab");
  });

  it("openFromLibrary 不动 tab(库内入口无跨 tab 语义)", () => {
    useMediaPanelStore.setState({ activeTab: "script" });
    useAssetDetailViewStore.getState().openFromLibrary(asset("role-3"));
    expect(useMediaPanelStore.getState().activeTab).toBe("script");
  });
});

describe("asset-detail-view-store closedAt 触发(script-tab 静默刷新驱动位)", () => {
  it("close 推动 closedAt;订阅方按 closedAt 变化收到通知,打开新详情不虚发", () => {
    vi.useFakeTimers();
    let now = new Date(2026, 10, 20, 12, 0, 0).getTime();
    vi.setSystemTime(now);

    const notifications: Array<{ closedAt: number | null; origin: string | null }> = [];
    const unsubscribe = useAssetDetailViewStore.subscribe((state, prev) => {
      if (state.closedAt !== prev.closedAt) {
        notifications.push({ closedAt: state.closedAt, origin: state.origin });
      }
    });

    // script-tab 打开→关闭:closedAt 落时戳,订阅收到一次
    useAssetDetailViewStore.getState().openFromScriptTab(asset("role-4", "甲"));
    useAssetDetailViewStore.getState().close();
    now = new Date(2026, 10, 20, 12, 5, 0).getTime();
    vi.setSystemTime(now);
    expect(notifications).toEqual([{ closedAt: expect.any(Number), origin: "script-tab" }]);

    // 打开另一详情(不论入口)closedAt 不动→零通知(打开不是关闭)
    useAssetDetailViewStore.getState().openFromScriptTab(asset("role-5", "乙"));
    expect(notifications).toHaveLength(1);

    // 再次关闭:时戳只增,再通知一次
    useAssetDetailViewStore.getState().close();
    expect(notifications).toHaveLength(2);
    expect(notifications[1].closedAt).toBe(now);

    unsubscribe();
    vi.useRealTimers();
  });
});
