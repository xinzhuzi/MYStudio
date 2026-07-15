// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const director = vi.hoisted(() => ({
  updateSplitSceneEndFrame: vi.fn(),
  updateSplitSceneCharacters: vi.fn(),
  updateSplitSceneCharacterVariationMap: vi.fn(),
  updateSplitSceneEmotions: vi.fn(),
  updateSplitSceneShotSize: vi.fn(),
  updateSplitSceneDuration: vi.fn(),
  updateSplitSceneAmbientSound: vi.fn(),
  updateSplitSceneSoundEffects: vi.fn(),
  updateSplitSceneImage: vi.fn(),
  updateSplitSceneImageStatus: vi.fn(),
  deleteSplitScene: vi.fn(),
  resetStoryboard: vi.fn(),
}));
const persistSceneImage = vi.hoisted(() => vi.fn());

vi.mock("@/stores/director-store", () => ({ useDirectorStore: () => director }));
vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { useStoryboardSceneActions } from "./use-storyboard-scene-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStoryboardSceneActions", () => {
  it("prunes character variation bindings when characters are removed", () => {
    const { result } = renderHook(() => useStoryboardSceneActions({
      scenes: [{ id: 4, characterVariationMap: { a: "a-1", b: "b-1" } }],
      formatDeletedSceneNumber: (sceneId) => sceneId + 1,
    }));

    act(() => result.current.updateCharacters(4, ["b"]));

    expect(director.updateSplitSceneCharacters).toHaveBeenCalledWith(4, ["b"]);
    expect(director.updateSplitSceneCharacterVariationMap).toHaveBeenCalledWith(4, { b: "b-1" });
  });

  it("persists uploaded first frames before updating the scene", async () => {
    persistSceneImage.mockResolvedValue({ localPath: "/images/scene-2.png", httpUrl: "http://local/scene-2.png" });
    const { result } = renderHook(() => useStoryboardSceneActions({ scenes: [], formatDeletedSceneNumber: (id) => id }));

    await act(async () => result.current.uploadImage(2, "data:image/png;base64,test"));

    expect(director.updateSplitSceneImage).toHaveBeenCalledWith(2, "/images/scene-2.png", undefined, undefined, "http://local/scene-2.png");
  });
});
