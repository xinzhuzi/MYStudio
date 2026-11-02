import { describe, expect, it } from "vitest";
import { probeProductionMedia } from "./production-runners";

describe("production runners", () => {
  it.each([180, 195])("strict Daojie media accepts %s seconds with explicit source context", async (duration) => {
    const evidence = { path: "/tmp/strict.mp4", sizeBytes: 1, mtimeMs: 1, sha256: "a".repeat(64), duration, streams: ["video", "audio"] };
    await expect(probeProductionMedia({ filePath: evidence.path, directorManualId: "Daojie_xianxia", sourceText: "真实原文", renderer: { probeMedia: async () => evidence } })).resolves.toEqual(evidence);
  });

  it.each([196, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])("strict Daojie media rejects invalid duration %s", async (duration) => {
    const evidence = { path: "/tmp/strict.mp4", sizeBytes: 1, mtimeMs: 1, sha256: "a".repeat(64), duration, streams: ["video", "audio"] };
    await expect(probeProductionMedia({ filePath: evidence.path, directorManualId: "Daojie_xianxia", sourceText: "真实原文", renderer: { probeMedia: async () => evidence } })).rejects.toThrow("195 秒上限");
  });

  it.each([{ directorManualId: "other", sourceText: "原文" }, { directorManualId: "Daojie_xianxia", sourceText: " " }])("non-strict media retains 180 seconds: %j", async (context) => {
    const evidence = { path: "/tmp/generic.mp4", sizeBytes: 1, mtimeMs: 1, sha256: "a".repeat(64), duration: 181, streams: ["video", "audio"] };
    await expect(probeProductionMedia({ filePath: evidence.path, ...context, renderer: { probeMedia: async () => evidence } })).rejects.toThrow("180 秒上限");
  });

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
