import { describe, expect, it, vi } from "vitest";
import {
  mergeAppSettingsState,
  useAppSettingsStore,
} from "./app-settings-store";

vi.mock("@/lib/storage/indexed-db-storage", () => ({
  fileStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

describe("useAppSettingsStore development settings", () => {
  it("keeps developer tools entry hidden until development mode is enabled", () => {
    expect(useAppSettingsStore.getState().developmentSettings.showDevToolsControls).toBe(false);

    useAppSettingsStore.getState().setDevelopmentSettings({ showDevToolsControls: true });

    expect(useAppSettingsStore.getState().developmentSettings.showDevToolsControls).toBe(true);
  });

  it("stores global image generation size defaults", () => {
    expect(useAppSettingsStore.getState().imageGenerationSettings).toMatchObject({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });

    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "4K",
      compatibilityRetryEnabled: false,
    });

    expect(useAppSettingsStore.getState().imageGenerationSettings).toMatchObject({
      defaultAspectRatio: "3:2",
      defaultResolution: "4K",
      compatibilityRetryEnabled: false,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  it("uses Remotion as the default and migrates legacy or invalid persisted renderer state", () => {
    const current = useAppSettingsStore.getState();

    expect(current.renderingSettings.renderer).toBe("remotion");
    expect(mergeAppSettingsState({}, current).renderingSettings.renderer).toBe("remotion");
    expect(mergeAppSettingsState({
      renderingSettings: { renderer: "ffmpeg" },
    }, current).renderingSettings.renderer).toBe("remotion");
    expect(mergeAppSettingsState({
      renderingSettings: { renderer: "auto" },
    }, current).renderingSettings.renderer).toBe("remotion");
  });

  it("restores an exact persisted renderer selection", () => {
    const current = useAppSettingsStore.getState();

    expect(mergeAppSettingsState({
      renderingSettings: { renderer: "remotion" },
    }, current).renderingSettings.renderer).toBe("remotion");
  });

  it("backfills defaultImageModel for pre-09-12 persisted state and restores exact picks (09-12 生图路由设置)", () => {
    const current = useAppSettingsStore.getState();
    // 旧装机:imageGenerationSettings 整块持久化但没有 defaultImageModel 键
    // (浅合并会把它洗成 undefined)——merge 须逐字段回填为空串(跟随渠道链)。
    const legacy = mergeAppSettingsState({
      imageGenerationSettings: {
        defaultAspectRatio: "16:9",
        defaultResolution: "2K",
        autoDenoiseEnabled: true,
        compatibilityRetryEnabled: true,
        compatibilityRetryAspectRatio: "1:1",
        compatibilityRetryResolution: "1K",
      },
    }, current);
    expect(legacy.imageGenerationSettings.defaultImageModel).toBe("");
    expect(legacy.imageGenerationSettings.autoDenoiseEnabled).toBe(true);
    // 用户显式选过的模型原样恢复
    const picked = mergeAppSettingsState({
      imageGenerationSettings: {
        ...legacy.imageGenerationSettings,
        defaultImageModel: "gpt-image-2",
      },
    }, current);
    expect(picked.imageGenerationSettings.defaultImageModel).toBe("gpt-image-2");
  });

  it("stores and normalizes the last project parent directory", () => {
    const current = useAppSettingsStore.getState();
    expect(current.projectLocationDefaults.lastParentDir).toBe("");

    useAppSettingsStore.getState().setProjectLocationDefaults({ lastParentDir: "/Users/x/Project/IP" });
    expect(useAppSettingsStore.getState().projectLocationDefaults.lastParentDir).toBe("/Users/x/Project/IP");

    expect(mergeAppSettingsState({
      projectLocationDefaults: { lastParentDir: "/kept/dir" },
    }, current).projectLocationDefaults.lastParentDir).toBe("/kept/dir");

    expect(mergeAppSettingsState({
      projectLocationDefaults: { lastParentDir: 42 as unknown as string },
    }, current).projectLocationDefaults.lastParentDir).toBe(current.projectLocationDefaults.lastParentDir);

    expect(mergeAppSettingsState({}, current).projectLocationDefaults.lastParentDir).toBe(
      current.projectLocationDefaults.lastParentDir,
    );
  });
});
