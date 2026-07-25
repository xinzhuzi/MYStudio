import { describe, expect, it, vi } from "vitest";
import { useAppSettingsStore } from "./app-settings-store";

vi.mock("../lib/indexed-db-storage", () => ({
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
});
