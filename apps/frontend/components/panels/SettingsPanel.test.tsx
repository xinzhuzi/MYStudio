// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  advancedOptions: {
    enableVisualContinuity: true,
    enableResumeGeneration: true,
    enableContentModeration: true,
    enableAutoModelSwitch: false,
  },
  imageGenerationSettings: {
    defaultAspectRatio: "16:9",
    defaultResolution: "2K",
    compatibilityRetryEnabled: true,
    compatibilityRetryAspectRatio: "1:1",
    compatibilityRetryResolution: "1K",
  },
  isImageHostConfigured: vi.fn(() => false),
  resetAdvancedOptions: vi.fn(),
  setAdvancedOption: vi.fn(),
  setImageGenerationSettings: vi.fn(),
}));

vi.mock("@/stores/api-config-store", () => ({
  useAPIConfigStore: () => ({
    advancedOptions: mocks.advancedOptions,
    isImageHostConfigured: mocks.isImageHostConfigured,
    resetAdvancedOptions: mocks.resetAdvancedOptions,
    setAdvancedOption: mocks.setAdvancedOption,
  }),
}));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: () => ({
    imageGenerationSettings: mocks.imageGenerationSettings,
    setImageGenerationSettings: mocks.setImageGenerationSettings,
  }),
}));
vi.mock("./settings/AppearanceSettingsTab", () => ({
  AppearanceSettingsTab: () => <div>appearance settings panel</div>,
}));
vi.mock("./settings/ApiSettingsContainer", () => ({
  ApiSettingsContainer: () => <div>api settings panel</div>,
  ApiSettingsMigration: () => null,
}));
vi.mock("./settings/ImageSizeSettingsTab", () => ({
  ImageSizeSettingsTab: () => <div>image-size settings panel</div>,
}));
vi.mock("./settings/PythonSettingsTab", () => ({
  PythonSettingsTab: () => <div>python settings panel</div>,
}));
vi.mock("@/components/panels/tts/LocalTtsPanel", () => ({
  LocalTtsPanel: () => <div>tts settings panel</div>,
}));
vi.mock("./settings/AdvancedSettingsTab", () => ({
  AdvancedSettingsTab: () => <div>advanced settings panel</div>,
}));
vi.mock("./settings/ImageHostSettingsContainer", () => ({
  ImageHostSettingsContainer: () => <div>image-host settings panel</div>,
}));
vi.mock("./settings/StorageSettingsTab", () => ({
  StorageSettingsTab: () => <div>storage settings panel</div>,
}));
vi.mock("./settings/DevelopmentSettingsContainer", () => ({
  DevelopmentSettingsContainer: () => <div>development settings panel</div>,
}));
vi.mock("./settings/SupportSettingsTab", () => ({
  SupportSettingsTab: () => <div>support settings panel</div>,
}));

import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, SettingsPanel } from "./SettingsPanel";

afterEach(cleanup);

describe("SettingsPanel tab navigation", () => {
  it("keeps the public tab navigation and extracted panels connected", async () => {
    render(<SettingsPanel />);

    expect(screen.getAllByRole("tab")).toHaveLength(SETTINGS_TABS.length);
    const appearanceTab = screen.getByRole("tab", { name: "外观" });
    expect(appearanceTab.getAttribute("aria-selected")).toBe("true");
    expect(DEFAULT_SETTINGS_TAB).toBe("appearance");
    expect(screen.getByText("appearance settings panel")).toBeTruthy();

    const navigations = [
      ["API 管理", "api settings panel"],
      ["图片规格", "image-size settings panel"],
      ["Python 配置", "python settings panel"],
      ["TTS 配置", "tts settings panel"],
      ["高级选项", "advanced settings panel"],
      ["图床配置", "image-host settings panel"],
      ["存储", "storage settings panel"],
      ["开发", "development settings panel"],
      ["请作者喝杯咖啡", "support settings panel"],
    ] as const;

    for (const [label, panelText] of navigations) {
      fireEvent.mouseDown(screen.getByRole("tab", { name: label }), { button: 0, ctrlKey: false });
      expect(screen.getByRole("tab", { name: label }).getAttribute("aria-selected")).toBe("true");
      await waitFor(() => expect(screen.getByText(panelText)).toBeTruthy());
    }
  });
});
