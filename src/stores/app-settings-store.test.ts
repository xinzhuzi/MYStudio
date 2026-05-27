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
});
