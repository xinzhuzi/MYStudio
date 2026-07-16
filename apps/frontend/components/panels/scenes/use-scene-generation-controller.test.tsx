// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { saveImageToLocal } from "@/lib/image-storage";
import { useSceneGenerationController } from "./use-scene-generation-controller";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: vi.fn(),
    featureNotConfiguredMessage: vi.fn(),
    image: vi.fn(),
  },
}));
vi.mock("@/lib/image-storage", () => ({ saveImageToLocal: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));

const selectedScene = {
  id: "scene-1",
  name: "雨巷",
  location: "旧城雨巷",
  time: "day",
  atmosphere: "peaceful",
  styleId: "real_movie",
};

function createOptions() {
  return {
    selectedScene,
    allShots: [{ id: "shot-1", sceneId: "scene-1", actionSummary: "行人撑伞穿过雨幕" }],
    name: "雨巷",
    location: "旧城雨巷深处",
    time: "night",
    atmosphere: "tense",
    visualPrompt: "湿润青石板",
    tags: ["雨夜"],
    notes: "保持无人环境",
    styleId: "real_movie",
    resourceProjectId: "project-1",
    updateScene: vi.fn(),
    setGenerationStatus: vi.fn(),
    setGeneratingScene: vi.fn(),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn().mockReturnValue("ai-folder"),
  };
}

describe("useSceneGenerationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiManager.featureConfig).mockReturnValue({} as never);
    vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://image.test/scene.png" } as never);
    vi.mocked(saveImageToLocal).mockResolvedValue("local-image://scene.png");
  });

  it("generates a preview and preserves the scene status transitions", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSceneGenerationController(options as never));

    await act(async () => result.current.handleGenerate());

    expect(options.updateScene).toHaveBeenCalledWith("scene-1", expect.objectContaining({
      location: "旧城雨巷深处",
      time: "night",
      atmosphere: "tense",
    }));
    expect(aiManager.image).toHaveBeenCalledWith(expect.objectContaining({
      styleId: "real_movie",
      negativePrompt: expect.stringContaining("anime"),
    }));
    expect(options.setGenerationStatus).toHaveBeenNthCalledWith(1, "generating");
    expect(options.setGenerationStatus).toHaveBeenNthCalledWith(2, "completed");
    expect(options.setGeneratingScene).toHaveBeenLastCalledWith(null);
    expect(result.current.previewUrl).toBe("https://image.test/scene.png");
  });

  it("persists and archives an accepted preview", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSceneGenerationController(options as never));
    await act(async () => result.current.handleGenerate());
    await act(async () => result.current.handleSavePreview());

    expect(saveImageToLocal).toHaveBeenCalledWith(
      "https://image.test/scene.png",
      "scenes",
      expect.stringMatching(/^雨巷_\d+\.png$/),
    );
    expect(options.updateScene).toHaveBeenLastCalledWith("scene-1", expect.objectContaining({
      referenceImage: "local-image://scene.png",
    }));
    expect(options.addMediaFromUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: "local-image://scene.png",
      folderId: "ai-folder",
      projectId: "project-1",
    }));
    expect(result.current.previewUrl).toBeNull();
  });
});
