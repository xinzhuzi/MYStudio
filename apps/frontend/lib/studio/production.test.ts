import { describe, expect, it } from "vitest";
import { findTrackOwnership, groupStoryboardsIntoTracks } from "./production";
import type { ProductionTrack, StoryboardItem, VideoCandidate } from "@/types/studio";

describe("findTrackOwnership", () => {
  it("groups tracks by episodeId correctly", () => {
    const mockTracks: ProductionTrack[] = [
      { id: "track-001", episodeId: "chapter-001", trackKey: "001", storyboardIds: ["sb1", "sb2"], prompt: "track 1", duration: 200, candidateVideoIds: [], state: "idle" },
      { id: "track-002", episodeId: "chapter-002", trackKey: "002", storyboardIds: ["sb3"], prompt: "track 2", duration: 100, candidateVideoIds: [], state: "idle" },
    ];

    const mockCandidates: VideoCandidate[] = [
      { id: "v1", trackId: "track-001", provider: "ffmpeg-local", state: "ready", createdAt: Date.now() },
      { id: "v2", trackId: "track-002", provider: "model-placeholder", state: "pending" as any, createdAt: Date.now() },
    ];

    const ownership = findTrackOwnership(mockTracks, mockCandidates);

    expect(ownership.size).toBe(2);
    expect(ownership.get("chapter-001")?.has("track-001")).toBe(true);
    expect(ownership.get("chapter-002")?.has("track-002")).toBe(true);
  });

  it("handles empty inputs", () => {
    const ownership = findTrackOwnership([], []);
    expect(ownership.size).toBe(0);
  });

  it("excludes tracks without episodeId", () => {
    const mockTracks: ProductionTrack[] = [
      { id: "track-001", episodeId: "chapter-001", trackKey: "001", storyboardIds: ["sb1"], prompt: "track 1", duration: 100, candidateVideoIds: [], state: "idle" },
      { id: "track-orphan", episodeId: "", trackKey: "orphan", storyboardIds: ["sb2"], prompt: "orphan", duration: 50, candidateVideoIds: [], state: "idle" },
    ];

    const mockCandidates: VideoCandidate[] = [];

    const ownership = findTrackOwnership(mockTracks, mockCandidates);

    expect(ownership.has("chapter-001")).toBe(true);
    expect(ownership.has("")).toBe(false);
  });
});

describe("groupStoryboardsIntoTracks", () => {
  it("groups storyboards by trackKey", () => {
    const storyboards: StoryboardItem[] = [
      { id: "sb1", episodeId: "chapter-001", index: 1, trackKey: "001", trackId: "", duration: 100, prompt: "test 1", videoDesc: "desc 1", assetIds: [], state: "idle" },
      { id: "sb2", episodeId: "chapter-001", index: 2, trackKey: "001", trackId: "", duration: 100, prompt: "test 2", videoDesc: "desc 2", assetIds: [], state: "idle" },
      { id: "sb3", episodeId: "chapter-002", index: 1, trackKey: "002", trackId: "", duration: 100, prompt: "test 3", videoDesc: "desc 3", assetIds: [], state: "idle" },
    ];

    const tracks = groupStoryboardsIntoTracks(storyboards);

    expect(tracks.length).toBe(2);
    expect(tracks[0].id).toContain("track-001"); // Should contain the slugified trackKey
    expect(tracks[0].episodeId).toBe("chapter-001");
    expect(tracks[0].storyboardIds).toEqual(["sb1", "sb2"]);
    expect(tracks[1].storyboardIds).toEqual(["sb3"]);
  });

  it("sorts storyboards by index before grouping", () => {
    const storyboards: StoryboardItem[] = [
      { id: "sb2", episodeId: "chapter-001", index: 2, trackKey: "001", trackId: "", duration: 100, prompt: "test 2", videoDesc: "desc 2", assetIds: [], state: "idle" },
      { id: "sb1", episodeId: "chapter-001", index: 1, trackKey: "001", trackId: "", duration: 100, prompt: "test 1", videoDesc: "desc 1", assetIds: [], state: "idle" },
    ];

    const tracks = groupStoryboardsIntoTracks(storyboards);

    expect(tracks[0].storyboardIds).toEqual(["sb1", "sb2"]);
  });
});
