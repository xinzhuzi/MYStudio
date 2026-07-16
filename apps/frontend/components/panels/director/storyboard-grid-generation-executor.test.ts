import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";
import { executeStoryboardGridGeneration } from "./storyboard-grid-generation-executor";

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { imageGrid: vi.fn() } }));
vi.mock("@/lib/storyboard/image-task-transport", () => ({ pollImageTaskUrl: vi.fn() }));

const request = {
  model: "model-1",
  prompt: "grid",
  apiKey: "key",
  baseUrl: "https://api.test",
  aspectRatio: "16:9",
  resolution: "2K",
};

describe("executeStoryboardGridGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("slices an immediate grid URL without polling", async () => {
    vi.mocked(aiManager.imageGrid).mockResolvedValue({ imageUrl: "https://image.test/grid.png" });
    const sliceImage = vi.fn(async () => ["tile-1", "tile-2", "tile-3", "tile-4"]);

    await expect(executeStoryboardGridGeneration({
      request,
      poll: { apiKey: "key", baseUrl: "https://api.test" },
      layout: { columns: 2, rows: 2, actualCount: 4 },
      sliceImage,
    })).resolves.toEqual({
      gridImageUrl: "https://image.test/grid.png",
      slicedImages: ["tile-1", "tile-2", "tile-3", "tile-4"],
    });
    expect(pollImageTaskUrl).not.toHaveBeenCalled();
  });

  it("polls an async task before slicing", async () => {
    vi.mocked(aiManager.imageGrid).mockResolvedValue({ taskId: "task-1" });
    vi.mocked(pollImageTaskUrl).mockResolvedValue("https://image.test/polled.png");
    const sliceImage = vi.fn(async () => ["tile"]);

    await executeStoryboardGridGeneration({
      request,
      poll: { apiKey: "key", baseUrl: "https://api.test" },
      layout: { columns: 1, rows: 1, actualCount: 1 },
      sliceImage,
    });

    expect(pollImageTaskUrl).toHaveBeenCalledWith({
      taskId: "task-1", apiKey: "key", baseUrl: "https://api.test", signal: undefined,
    });
    expect(sliceImage).toHaveBeenCalledWith("https://image.test/polled.png", expect.any(Object));
  });

  it("rejects a completed request without an image URL", async () => {
    vi.mocked(aiManager.imageGrid).mockResolvedValue({});
    await expect(executeStoryboardGridGeneration({
      request,
      poll: { apiKey: "key", baseUrl: "https://api.test" },
      layout: { columns: 2, rows: 2, actualCount: 4 },
      sliceImage: vi.fn(),
    })).rejects.toThrow("未获取到四宫格图片 URL");
  });
});
