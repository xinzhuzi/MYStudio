import { describe, expect, it, vi } from "vitest";
import {
  probeProductionMedia,
  runProductionEpisodeMerge,
  runProductionTrackRender,
} from "./production-runners";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

const storyboard: StoryboardItem = {
  id: "sb-1",
  episodeId: "chapter-001",
  index: 1,
  trackKey: "scene-1",
  trackId: "track-1",
  duration: 4,
  prompt: "雨落码头",
  videoDesc: "独孤按剑",
  assetIds: [],
  mediaRef: { kind: "image", path: "/tmp/frame.png" },
  audioRef: { kind: "audio", path: "/tmp/voice.wav" },
  state: "ready",
};

const track: ProductionTrack = {
  id: "track-1",
  episodeId: "chapter-001",
  trackKey: "scene-1",
  storyboardIds: [storyboard.id],
  prompt: "雨落码头",
  duration: 4,
  candidateVideoIds: [],
  state: "ready",
};

describe("production runners", () => {
  it("returns a real track candidate path and propagates renderer failures", async () => {
    const renderTrackCandidate = vi.fn(async () => ({
      success: true,
      filePath: "/tmp/track.mp4",
    }));
    await expect(
      runProductionTrackRender({
        track,
        storyboards: [storyboard],
        renderer: { renderTrackCandidate },
      }),
    ).resolves.toMatchObject({ filePath: "/tmp/track.mp4" });
    expect(renderTrackCandidate).toHaveBeenCalledTimes(1);

    await expect(
      runProductionTrackRender({
        track,
        storyboards: [storyboard],
        renderer: {
          renderTrackCandidate: async () => ({
            success: false,
            error: "ffmpeg failed",
          }),
        },
      }),
    ).rejects.toThrow("ffmpeg failed");
  });

  it("merges selected candidates and propagates merge failures", async () => {
    const candidate: VideoCandidate = {
      id: "candidate-1",
      trackId: track.id,
      provider: "ffmpeg-local",
      filePath: "/tmp/track.mp4",
      state: "ready",
      createdAt: 1,
    };
    await expect(
      runProductionEpisodeMerge({
        candidates: [candidate],
        renderer: {
          mergeEpisode: async () => ({
            success: true,
            filePath: "/tmp/final.mp4",
          }),
        },
      }),
    ).resolves.toMatchObject({ filePath: "/tmp/final.mp4" });

    await expect(
      runProductionEpisodeMerge({
        candidates: [candidate],
        renderer: {
          mergeEpisode: async () => ({ success: false, error: "merge failed" }),
        },
      }),
    ).rejects.toThrow("merge failed");
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
