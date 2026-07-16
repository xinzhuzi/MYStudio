import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import type { MergedFrameTask } from "./storyboard-merged-grid-utils";
import { createStoryboardMergedPageGenerator } from "./storyboard-merged-page-generation";

const mocks = vi.hoisted(() => ({
  imageGrid: vi.fn(),
  pollImageTaskUrl: vi.fn(),
  slice: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: vi.fn(), imageGrid: mocks.imageGrid } }));
vi.mock("@/lib/storyboard/image-task-transport", () => ({ pollImageTaskUrl: mocks.pollImageTaskUrl }));
vi.mock("./storyboard-merged-grid-image-slicer", () => ({ sliceStoryboardMergedGridImage: mocks.slice }));
vi.mock("./storyboard-merged-image-writeback", () => ({ writeStoryboardMergedImages: mocks.write }));

const tasks: MergedFrameTask[] = [
  { scene: { id: 1, characterIds: ["char"], imagePromptZh: "首帧", width: 100, height: 200 } as unknown as SplitScene, type: "first" },
  { scene: { id: 2, characterIds: [], endFramePromptZh: "尾帧" } as unknown as SplitScene, type: "end" },
];

function setup(controller = new AbortController()) {
  const updateFirstFrameStatus = vi.fn();
  const updateEndFrameStatus = vi.fn();
  const processReferenceImagesForApi = vi.fn(async (references: string[]) => references.map((item) => `api:${item}`));
  const generate = createStoryboardMergedPageGenerator({
    aspect: "16:9",
    resolution: "2K",
    fullStylePrompt: "ink style",
    fullStyleNegative: "photorealistic",
    model: "image-model",
    apiKey: "key",
    imageBaseUrl: "https://api.test",
    keyManager: { getCurrentKey: () => "key" } as never,
    signal: controller.signal,
    getSceneCharacterContexts: (ids) => ids.length ? [{ referenceImages: ["char-ref"] } as never] : [],
    getSceneIdentityLockLines: () => ["- keep face"],
    processReferenceImagesForApi,
    updateFirstFrameStatus,
    updateEndFrameStatus,
    folderId: () => "folder",
    projectId: "project",
    persistImage: vi.fn(),
    updateFirstFrame: vi.fn(),
    updateEndFrame: vi.fn(),
    addMedia: vi.fn(),
  });
  return { controller, generate, processReferenceImagesForApi, updateFirstFrameStatus, updateEndFrameStatus };
}

describe("createStoryboardMergedPageGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.slice.mockResolvedValue(["tile-1", "tile-2"]);
    mocks.write.mockResolvedValue(undefined);
  });

  it("preserves prompt, dual reference processing, slicing, and writeback", async () => {
    mocks.imageGrid.mockResolvedValue({ imageUrl: "grid-url" });
    const { generate, processReferenceImagesForApi, updateFirstFrameStatus, updateEndFrameStatus } = setup();

    await expect(generate(tasks, ["ref-1"])).resolves.toEqual(["tile-1", "tile-2"]);

    expect(processReferenceImagesForApi).toHaveBeenCalledTimes(2);
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      model: "image-model",
      aspectRatio: "16:9",
      resolution: "2K",
      referenceImages: ["api:ref-1"],
      prompt: expect.stringContaining("[END FRAME] (no people): 尾帧"),
    }));
    expect(updateFirstFrameStatus).toHaveBeenCalledWith(1, { imageStatus: "generating", imageProgress: 10 });
    expect(updateEndFrameStatus).toHaveBeenCalledWith(2, { endFrameStatus: "generating", endFrameProgress: 10 });
    expect(mocks.slice).toHaveBeenCalledWith("grid-url", 2, 2, 2, "16:9");
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      tasks,
      images: ["tile-1", "tile-2"],
      folderId: "folder",
      projectId: "project",
    }));
  });

  it("polls tasks and forwards page progress", async () => {
    mocks.imageGrid.mockResolvedValue({ taskId: "task-1" });
    mocks.pollImageTaskUrl.mockImplementation(async ({ onProgress }) => {
      onProgress?.(50);
      return "polled-grid";
    });
    const { generate, updateFirstFrameStatus, updateEndFrameStatus } = setup();

    await generate(tasks, []);

    expect(mocks.pollImageTaskUrl).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      maxAttempts: 90,
      signal: expect.any(AbortSignal),
    }));
    expect(updateFirstFrameStatus).toHaveBeenCalledWith(1, { imageProgress: 50 });
    expect(updateEndFrameStatus).toHaveBeenCalledWith(2, { endFrameProgress: 50 });
  });

  it("stops before slicing or writing when the request is aborted", async () => {
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
