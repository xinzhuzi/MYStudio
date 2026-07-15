import { describe, expect, it } from "vitest";
import type { EditingSourceSnapshotInput } from "./source-snapshot";
import { buildEditingSourceSnapshotHash } from "./source-snapshot";

describe("editing source snapshot", () => {
  it("is deterministic across input ordering and changes when selected media changes", async () => {
    const input = fixture();
    const reordered = {
      ...input,
      storyboards: [...input.storyboards].reverse(),
      productionTracks: [...input.productionTracks].reverse(),
      videoCandidates: [...input.videoCandidates].reverse(),
    };

    const first = await buildEditingSourceSnapshotHash(input);
    const second = await buildEditingSourceSnapshotHash(reordered);
    const changed = await buildEditingSourceSnapshotHash({
      ...input,
      videoCandidates: input.videoCandidates.map((item) =>
        item.id === "candidate-1" ? { ...item, filePath: "/changed.mp4" } : item,
      ),
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});

function fixture(): EditingSourceSnapshotInput {
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    aspectRatio: "9:16",
    storyboards: [
      {
        id: "storyboard-2",
        episodeId: "episode-1",
        index: 2,
        trackKey: "track",
        trackId: "track-1",
        duration: 3,
        prompt: "第二镜",
        videoDesc: "第二镜",
        assetIds: [],
        mediaRef: { kind: "image", path: "/shot-2.png" },
        audioRef: { kind: "audio", path: "/voice-2.wav" },
        state: "ready",
      },
      {
        id: "storyboard-1",
        episodeId: "episode-1",
        index: 1,
        trackKey: "track",
        trackId: "track-1",
        duration: 4,
        prompt: "第一镜",
        videoDesc: "第一镜",
        assetIds: [],
        mediaRef: { kind: "image", path: "/shot-1.png" },
        audioRef: { kind: "audio", path: "/voice-1.wav" },
        state: "ready",
      },
    ],
    productionTracks: [
      {
        id: "track-1",
        episodeId: "episode-1",
        trackKey: "track",
        storyboardIds: ["storyboard-1", "storyboard-2"],
        prompt: "track",
        duration: 7,
        candidateVideoIds: ["candidate-1"],
        selectedVideoId: "candidate-1",
        state: "ready",
      },
    ],
    videoCandidates: [
      {
        id: "candidate-1",
        trackId: "track-1",
        provider: "ffmpeg-local",
        filePath: "/candidate.mp4",
        state: "ready",
        createdAt: 1,
      },
    ],
  };
}
