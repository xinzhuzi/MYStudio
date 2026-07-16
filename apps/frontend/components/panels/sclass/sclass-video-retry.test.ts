import { describe, expect, it, vi } from "vitest";

import { runSClassVideoWithKeyRotation } from "./sclass-video-retry";

function keyManager(keys: string[]) {
  let index = 0;
  return {
    getCurrentKey: vi.fn(() => keys[index] || null),
    getTotalKeyCount: vi.fn(() => keys.length),
    handleError: vi.fn(() => {
      index += 1;
      return true;
    }),
  };
}

describe("runSClassVideoWithKeyRotation", () => {
  it("rotates on a retryable status parsed from the message", async () => {
    const manager = keyManager(["key-1", "key-2"]);
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error("upstream 503 unavailable"))
      .mockResolvedValueOnce("https://video.test/out.mp4");

    const result = await runSClassVideoWithKeyRotation({
      keyManager: manager,
      invoke,
      label: "Group video",
      context: { groupId: "group-1" },
    });

    expect(result).toBe("https://video.test/out.mp4");
    expect(manager.handleError).toHaveBeenCalledWith(503, "upstream 503 unavailable");
    expect(invoke.mock.calls.map(([key]) => key)).toEqual(["key-1", "key-2"]);
  });

  it("does not retry a non-retryable generation error", async () => {
    const manager = keyManager(["key-1", "key-2"]);
    const invoke = vi.fn().mockRejectedValue(new Error("invalid frame geometry"));

    await expect(runSClassVideoWithKeyRotation({
      keyManager: manager,
      invoke,
      label: "Single shot",
      context: { sceneId: 1 },
    })).rejects.toThrow("invalid frame geometry");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves the no-key terminal error", async () => {
    const manager = keyManager([]);
    await expect(runSClassVideoWithKeyRotation({
      keyManager: manager,
      invoke: vi.fn(),
      label: "Group video",
      context: {},
    })).rejects.toThrow("视频生成失败：没有可用 API Key");
  });
});
