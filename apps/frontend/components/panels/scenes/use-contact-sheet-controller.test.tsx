// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/scene-store";
import type { Shot } from "@/types/script";

const mocks = vi.hoisted(() => ({
  generateContactSheetPrompt: vi.fn(),
  getStyleById: vi.fn(),
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  writeText: vi.fn(),
  featureConfig: vi.fn(),
  imageGrid: vi.fn(),
}));

vi.mock("@/lib/script/scene-viewpoint-generator", () => ({ generateContactSheetPrompt: mocks.generateContactSheetPrompt }));
vi.mock("@/lib/constants/visual-styles", () => ({ getStyleById: mocks.getStyleById }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: () => "未配置图片模型",
    imageGrid: mocks.imageGrid,
  },
}));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: { defaultResolution: "2K" } }) },
}));

import { useContactSheetController } from "./use-contact-sheet-controller";

const scene = { id: "scene-1", name: "旧书房", location: "书房" } as Scene;

function createOptions(selectedScene: Scene | null = scene) {
  return {
    selectedScene,
    allShots: [
      { id: "shot-1", sceneRefId: "scene-1" } as Shot,
      { id: "shot-2", sceneId: "other" } as Shot,
    ],
    name: "表单书房",
    location: "表单地点",
    styleId: "ink",
    contactSheetAspectRatio: "16:9" as const,
    contactSheetLayout: "2x2" as const,
    contactSheetPrompt: "english prompt",
    contactSheetPromptZh: "中文提示词",
    setContactSheetPrompt: vi.fn(),
    setContactSheetPromptZh: vi.fn(),
    setExtractedViewpoints: vi.fn(),
    setContactSheetImage: vi.fn(),
    setIsGeneratingContactSheet: vi.fn(),
    setContactSheetProgress: vi.fn(),
  };
}

describe("useContactSheetController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
    mocks.getStyleById.mockReturnValue({ name: "水墨", prompt: "ink wash" });
    mocks.generateContactSheetPrompt.mockReturnValue({
      prompt: "generated-en",
      promptZh: "generated-zh",
      viewpoints: [{ id: "view-1" }],
    });
    mocks.featureConfig.mockReturnValue({
      apiKey: "key",
      baseUrl: "https://api.test/",
      models: ["image-model"],
      keyManager: { current: "key" },
    });
    mocks.imageGrid.mockResolvedValue({ imageUrl: "data:image/png;base64,abc" });
  });

  it("guards missing scenes and filters scene shots", () => {
    const missing = renderHook(() => useContactSheetController(createOptions(null)));
    act(() => missing.result.current.handleGenerateContactSheetPrompt());
    expect(mocks.toast.error).toHaveBeenCalledWith("请先选择场景");

    const options = createOptions();
    const { result } = renderHook(() => useContactSheetController(options));
    act(() => result.current.handleGenerateContactSheetPrompt());
    expect(mocks.generateContactSheetPrompt).toHaveBeenCalledWith(expect.objectContaining({
      scene: expect.objectContaining({ name: "表单书房", location: "表单地点" }),
      shots: [expect.objectContaining({ id: "shot-1" })],
      styleTokens: ["ink wash"],
    }));
    expect(options.setContactSheetPrompt).toHaveBeenCalledWith("generated-en");
    expect(options.setContactSheetPromptZh).toHaveBeenCalledWith("generated-zh");
  });

  it("copies the selected prompt with layout metadata", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useContactSheetController(createOptions()));
    await act(async () => result.current.handleCopyPrompt(true));
    expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining("Grid Layout: 2 rows x 2 cols (2x2)"));
    expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining("english prompt"));
    expect(mocks.toast.success).toHaveBeenCalledWith("英文提示词已复制（含风格和宽高比）");
  });

  it("reports clipboard failures without a false success toast", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.writeText.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useContactSheetController(createOptions()));
    await act(async () => result.current.handleCopyPrompt(true));
    expect(mocks.toast.error).toHaveBeenCalledWith("复制提示词失败");
    expect(mocks.toast.success).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("generates a contact sheet image and preserves progress cleanup", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useContactSheetController(options));
    await act(async () => result.current.handleGenerateContactSheetImage());
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      model: "image-model",
      apiKey: "key",
      baseUrl: "https://api.test",
      aspectRatio: "16:9",
      resolution: "2K",
    }));
    expect(options.setContactSheetImage).toHaveBeenCalledWith("data:image/png;base64,abc");
    expect(options.setIsGeneratingContactSheet.mock.calls).toEqual([[true], [false]]);
    expect(options.setContactSheetProgress).toHaveBeenLastCalledWith(0);
  });
});
