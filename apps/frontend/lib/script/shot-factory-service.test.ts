import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getScriptState: vi.fn(),
  getCharacterLibraryState: vi.fn(),
  getVariationForEpisode: vi.fn(),
}));

vi.mock("@/stores/script-store", () => ({
  useScriptStore: { getState: mocks.getScriptState },
}));
vi.mock("@/stores/character-library-store", () => ({
  useCharacterLibraryStore: { getState: mocks.getCharacterLibraryState },
}));
vi.mock("./character-stage-analyzer", () => ({
  getVariationForEpisode: mocks.getVariationForEpisode,
}));

import { createShot, getEpisodeIndexFromId } from "./shot-factory-service";

describe("shot factory service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getScriptState.mockReturnValue({ projects: {} });
    mocks.getCharacterLibraryState.mockReturnValue({ getCharacterById: vi.fn() });
  });

  it("parses episode ids with the existing fallback", () => {
    expect(getEpisodeIndexFromId("ep_2")).toBe(2);
    expect(getEpisodeIndexFromId("invalid")).toBe(1);
  });

  it("creates a shot with stable defaults and the matched character variation", () => {
    const getCharacterById = vi.fn().mockReturnValue({
      variations: [{ id: "variation-2", name: "中年阶段" }],
    });
    mocks.getCharacterLibraryState.mockReturnValue({ getCharacterById });
    mocks.getScriptState.mockReturnValue({
      projects: {
        project: {
          scriptData: {
            characters: [{ id: "character-1", name: "张明", characterLibraryId: "library-1" }],
          },
        },
      },
    });
    mocks.getVariationForEpisode.mockReturnValue({ id: "variation-2", name: "中年阶段" });
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const shot = createShot({
      index: 3,
      episodeId: "ep_2",
      sceneRefId: "scene-1",
      actionSummary: "推门",
      visualDescription: "雨夜推开木门",
      characterNames: ["张明"],
      characterIds: ["character-1"],
      shotSize: "Medium Shot",
      duration: 4,
    });

    expect(shot).toMatchObject({
      id: "shot_1234_3",
      cameraMovement: "Static",
      imageStatus: "idle",
      imageProgress: 0,
      videoStatus: "idle",
      videoProgress: 0,
      characterVariations: { "character-1": "variation-2" },
    });
    expect(mocks.getVariationForEpisode).toHaveBeenCalledWith(expect.any(Array), 2);
  });
});
