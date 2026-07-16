import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import type { MergedFrameTask } from "../director/storyboard-merged-grid-utils";
import { createSClassMergedPageGenerator } from "./sclass-merged-page-generation";

const mocks = vi.hoisted(() => ({
  imageGrid: vi.fn(),
  poll: vi.fn(),
  slice: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: vi.fn(), imageGrid: mocks.imageGrid } }));
vi.mock("@/lib/storyboard/image-task-transport", () => ({ pollImageTaskUrl: mocks.poll }));
vi.mock("../director/storyboard-merged-grid-image-slicer", () => ({ sliceStoryboardMergedGridImage: mocks.slice }));
vi.mock("../director/storyboard-merged-image-writeback", () => ({ writeStoryboardMergedImages: mocks.write }));

const tasks: MergedFrameTask[] = [
  { scene: { id: 1, characterIds: ["c1"], imagePromptZh: "首帧", width: 100, height: 200 } as unknown as SplitScene, type: "first" },
  { scene: { id: 2, characterIds: [], endFramePromptZh: "尾帧" } as unknown as SplitScene, type: "end" },
];

function setup(controller = new AbortController()) {
  const generate = createSClassMergedPageGenerator({
    aspect: "16:9",
    fullStylePrompt: "水墨",
    fullStyleNegative: "photorealistic",
    model: "sclass-model",
    apiKey: "secret",
    imageBaseUrl: "https://api.example.com",
    resolution: "2K",
    keyManager: { getCurrentKey: () => "secret" } as never,
    signal: controller.signal,
    updateFirstFrameStatus: vi.fn(),
    updateEndFrameStatus: vi.fn(),
    folderId: () => "folder",
    projectId: "project",
    persistImage: vi.fn(),
    updateFirstFrame: vi.fn(),
    updateEndFrame: vi.fn(),
    addMedia: vi.fn(),
    setLastGridImage: vi.fn(),
    readImage: vi.fn(async () => "data:image/png;base64,cmVm"),
  });
  return { controller, generate };
}

describe("createSClassMergedPageGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.slice.mockResolvedValue(["tile-1", "tile-2"]);
    mocks.write.mockResolvedValue(undefined);
  });

  it("keeps S-Class prompt, slicing, and writeback contracts", async () => {
    mocks.imageGrid.mockResolvedValue({ imageUrl: "grid-url" });
    const { generate } = setup();

    await expect(generate(tasks, ["https://ref.example.com/ref.png"])).resolves.toEqual(["tile-1", "tile-2"]);
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      model: "sclass-model",
      referenceImages: ["https://ref.example.com/ref.png"],
      prompt: expect.stringContaining("[END FRAME] (no people): 尾帧"),
    }));
    expect(mocks.slice).toHaveBeenCalledWith("grid-url", 2, 2, 2, "16:9");
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      tasks,
      images: ["tile-1", "tile-2"],
      signal: expect.any(AbortSignal),
    }));
  });

  it("stops before slicing when the request is aborted", async () => {
    const controller = new AbortController();
    mocks.imageGrid.mockImplementation(async () => {
      controller.abort();
      return { imageUrl: "grid-url" };
    });
    const { generate } = setup(controller);

    await expect(generate(tasks, [])).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.slice).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
