// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  return {
    toast,
    ttsClient: {
      getTtsRuntimeStatus: vi.fn().mockResolvedValue({ running: false, setupStage: "idle", port: 17593, baseUrl: "http://127.0.0.1:17593" }),
      getTtsRuntimeConfig: vi.fn().mockResolvedValue({ pythonRuntimeDir: "/python", installedItems: [] }),
      getModelStatus: vi.fn().mockResolvedValue({ models: [] }),
      getActiveTasks: vi.fn().mockResolvedValue({ downloads: [], generations: [] }),
      getModelCacheDir: vi.fn().mockResolvedValue({ path: "/cache" }),
      scanTtsModelInventory: vi.fn().mockResolvedValue([]),
      startTtsRuntime: vi.fn(),
      stopTtsRuntime: vi.fn(),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      deleteModel: vi.fn(),
      unloadModel: vi.fn(),
      migrateTtsRuntimeStorage: vi.fn(),
      setTtsModelCacheDir: vi.fn(),
      subscribeModelProgress: vi.fn(),
      readPythonRequirements: vi.fn(),
    },
    ttsStore: {
      voiceProfiles: [],
      createVoiceProfile: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/bridge/storage-manager", () => ({ getStorageManagerBridge: () => null }));
vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge: () => null }));
vi.mock("@/lib/tts/client", () => mocks.ttsClient);
vi.mock("@/lib/tts/model-catalog", () => ({
  TTS_MODEL_GROUPS: [],
  applyModelStatuses: () => [],
  groupTtsModelsByPurpose: () => [],
}));
vi.mock("@/lib/tts/voice-profile-capabilities", () => ({
  getAllPresetVoices: () => [],
  getDefaultModelSizeForEngine: () => "0.6B",
  resolvePresetVoiceSelection: () => null,
  supportsVoiceInstruction: () => false,
  validateVoiceProfileForGeneration: () => null,
}));
vi.mock("@/stores/tts/tts-store", () => ({ useTtsStore: () => mocks.ttsStore }));
vi.mock("./VoiceProfileSection", () => ({ VoiceProfileSection: () => <div data-testid="voice-section" /> }));
vi.mock("./LocalTtsRuntimeCard", () => ({
  LocalTtsRuntimeCard: () => <div data-testid="runtime-card" />,
}));
vi.mock("./local-tts-panel-lifecycle", () => ({
  applyLocalTtsRuntimeStatus: vi.fn(),
  canApplyLocalTtsUpdate: () => true,
}));
vi.mock("./local-tts-model-state", () => ({
  getLocalTtsModelState: () => "missing",
}));
vi.mock("./LocalTtsPanelPresentation", () => ({
  ErrorBanner: () => null,
  LocalTtsModelDetailsDialog: () => null,
  ModelRow: () => null,
  NativeTtsSelect: () => null,
}));

import { LocalTtsPanel } from "./LocalTtsPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocalTtsPanel", () => {
  it("renders runtime card and voice section on mount", async () => {
    render(<LocalTtsPanel />);
    // The component delays refresh by 500ms; wait for it
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.getByTestId("runtime-card")).toBeTruthy();
    expect(screen.getByTestId("voice-section")).toBeTruthy();
  });

  it("renders embedded without scroll area wrapper", () => {
    const { container } = render(<LocalTtsPanel embedded />);
    expect(screen.getByTestId("runtime-card")).toBeTruthy();
    // embedded mode should not wrap in ScrollArea
    const scrollArea = container.querySelector('[class*="scroll-area"], [data-radix-scroll-area-viewport]');
    // In embedded mode the content is returned directly without ScrollArea
    expect(scrollArea).toBeNull();
  });
});
