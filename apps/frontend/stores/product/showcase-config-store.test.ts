// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHOWCASE_CONFIG,
  SHOWCASE_CONFIG_STORAGE_KEY,
  useShowcaseConfigStore,
} from "./showcase-config-store";

/** 回到出厂态并清掉持久化残留,让每条用例互不污染。 */
function resetStore() {
  useShowcaseConfigStore.setState({ ...DEFAULT_SHOWCASE_CONFIG });
  localStorage.clear();
}

beforeEach(resetStore);

describe("showcase-config-store(A9 配置持久化)", () => {
  it("初始态等于默认配置", () => {
    const state = useShowcaseConfigStore.getState();
    expect(state.brandName).toBe(DEFAULT_SHOWCASE_CONFIG.brandName);
    expect(state.brandTagline).toBe(DEFAULT_SHOWCASE_CONFIG.brandTagline);
    expect(state.contactEmail).toBe(DEFAULT_SHOWCASE_CONFIG.contactEmail);
    expect(state.socialLinks).toEqual([]);
  });

  it("patchConfig 只动指定字段", () => {
    useShowcaseConfigStore.getState().patchConfig({ brandName: "道劫", contactEmail: "a@b.c" });
    const state = useShowcaseConfigStore.getState();
    expect(state.brandName).toBe("道劫");
    expect(state.contactEmail).toBe("a@b.c");
    expect(state.brandTagline).toBe(DEFAULT_SHOWCASE_CONFIG.brandTagline);
  });

  it("社媒链接三动作:追加、按行更新、按行删除", () => {
    const store = useShowcaseConfigStore.getState();
    store.addSocialLink();
    store.addSocialLink();
    expect(useShowcaseConfigStore.getState().socialLinks).toEqual([
      { platform: "", url: "" },
      { platform: "", url: "" },
    ]);

    useShowcaseConfigStore.getState().updateSocialLink(1, { platform: "小红书", url: "https://xhslink.com/a" });
    expect(useShowcaseConfigStore.getState().socialLinks[1]).toEqual({
      platform: "小红书",
      url: "https://xhslink.com/a",
    });
    expect(useShowcaseConfigStore.getState().socialLinks[0]).toEqual({ platform: "", url: "" });

    useShowcaseConfigStore.getState().removeSocialLink(0);
    expect(useShowcaseConfigStore.getState().socialLinks).toEqual([
      { platform: "小红书", url: "https://xhslink.com/a" },
    ]);
  });

  it("变更后写入 localStorage 指定 key,动作函数不持久化", () => {
    useShowcaseConfigStore.getState().patchConfig({ brandName: "世事软件" });
    const raw = localStorage.getItem(SHOWCASE_CONFIG_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.brandName).toBe("世事软件");
    expect(Object.keys(parsed.state).sort()).toEqual(
      ["brandName", "brandTagline", "contactEmail", "socialLinks"],
    );
    expect(parsed.state.patchConfig).toBeUndefined();
  });
});

describe("showcase-config-store 水合(A9:面板切页签回来不丢)", () => {
  it("localStorage 已有持久化值时,新读入的 store 从中水合", async () => {
    localStorage.setItem(
      SHOWCASE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        state: {
          brandName: "水合品牌",
          brandTagline: "水合标语",
          contactEmail: "hi@example.com",
          socialLinks: [{ platform: "X", url: "https://x.example.com/hi" }],
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const mod = await import("./showcase-config-store");
    const state = mod.useShowcaseConfigStore.getState();
    expect(state.brandName).toBe("水合品牌");
    expect(state.brandTagline).toBe("水合标语");
    expect(state.contactEmail).toBe("hi@example.com");
    expect(state.socialLinks).toEqual([{ platform: "X", url: "https://x.example.com/hi" }]);
    // 动作仍然可用
    state.addSocialLink();
    expect(mod.useShowcaseConfigStore.getState().socialLinks).toHaveLength(2);
  });
});
