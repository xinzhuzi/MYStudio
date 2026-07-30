import { describe, expect, it } from "vitest";
import { probeProductionMedia } from "./production-runners";

describe("production runners", () => {
  it("requires final media audio/video streams, duration, size, and sha256", async () => {
    await expect(
      probeProductionMedia({
        filePath: "/tmp/final.mp4",
        renderer: {
          probeMedia: async () => ({
            path: "/tmp/final.mp4",
            sizeBytes: 1024,
            mtimeMs: 1_700_000_000_000,
            sha256: "a".repeat(64),
            duration: 120,
            streams: ["video", "audio"],
          }),
        },
      }),
    ).resolves.toMatchObject({ duration: 120, sha256: "a".repeat(64) });

    await expect(
      probeProductionMedia({
        filePath: "/tmp/final.mp4",
        renderer: {
          probeMedia: async () => ({
            path: "/tmp/different.mp4",
            sizeBytes: 1024,
            mtimeMs: 1_700_000_000_000,
            sha256: "a".repeat(64),
            duration: 120,
            streams: ["video", "audio"],
          }),
        },
      }),
    ).rejects.toThrow("路径不匹配");

    await expect(
      probeProductionMedia({
        filePath: "/tmp/final.mp4",
        renderer: {
          probeMedia: async () => ({
            path: "/tmp/final.mp4",
            sizeBytes: 1024,
            mtimeMs: 0,
            sha256: "a".repeat(64),
            duration: 120,
            streams: ["video", "audio"],
          }),
        },
      }),
    ).rejects.toThrow("修改时间证据非法");

    await expect(
      probeProductionMedia({
        filePath: "/tmp/final.mp4",
        renderer: {
          probeMedia: async () => ({
            path: "/tmp/final.mp4",
            sizeBytes: 1024,
            mtimeMs: 1_700_000_000_000,
            sha256: "a".repeat(64),
            duration: 181,
            streams: ["video"],
          }),
        },
      }),
    ).rejects.toThrow("180 秒上限");
  });
});
