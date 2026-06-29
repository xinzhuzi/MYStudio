import { describe, expect, it } from "vitest";
import { buildToonflowWorkbenchModel } from "./workbench-view-model";
import type { ProductionTrack, StoryboardItem, VideoCandidate } from "@/types/studio";

describe("Toonflow workbench view model", () => {
  it("projects MYStudio tracks into Toonflow style trackList", () => {
    const model = buildToonflowWorkbenchModel({
      storyboards: [
        storyboard("shot-1", 1, {
          kind: "image",
          path: "/tmp/shot-1.png",
        }),
      ],
      tracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "opening",
          storyboardIds: ["shot-1"],
          prompt: "雨夜推镜",
          duration: 5,
          candidateVideoIds: ["video-1"],
          selectedVideoId: "video-1",
          state: "ready",
        },
      ],
      candidates: [
        {
          id: "video-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/video-1.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
    });

    expect(model.canMergeEpisode).toBe(true);
    expect(model.selectedReadyCount).toBe(1);
    expect(model.trackList[0]).toMatchObject({
      id: "track-1",
      name: "opening",
      prompt: "雨夜推镜",
      state: "ready",
      duration: 5,
      selectVideoId: "video-1",
      medias: [
        {
          id: "shot-1",
          sources: "storyboard",
          fileType: "image",
          src: "/tmp/shot-1.png",
          prompt: "镜头 1",
          name: "分镜 1",
          index: 1,
        },
      ],
      videoList: [
        {
          id: "video-1",
          src: "/tmp/video-1.mp4",
          path: "/tmp/video-1.mp4",
          state: "ready",
          selected: true,
        },
      ],
    });
  });

  it("includes storyboard audio and filters missing media", () => {
    const model = buildToonflowWorkbenchModel({
      storyboards: [
        {
          ...storyboard("shot-1", 1, {
            kind: "image",
            path: "/tmp/missing-shot.png",
          }),
          audioRef: { kind: "audio", path: "/tmp/line.wav" },
        },
      ],
      tracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "opening",
          storyboardIds: ["shot-1"],
          prompt: "雨夜推镜",
          duration: 5,
          candidateVideoIds: ["video-1"],
          selectedVideoId: "video-1",
          state: "ready",
        },
      ],
      candidates: [
        {
          id: "video-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/missing-video.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
      fileExists: (filePath) => filePath === "/tmp/line.wav",
    });

    expect(model.canMergeEpisode).toBe(false);
    expect(model.trackList[0]?.medias).toEqual([
      {
        id: "shot-1",
        sources: "storyboard",
        fileType: "audio",
        src: "/tmp/line.wav",
        path: "/tmp/line.wav",
        prompt: "镜头 1",
        name: "分镜 1",
        index: 1,
      },
    ]);
    expect(model.trackList[0]?.videoList[0]).toMatchObject({
      id: "video-1",
      src: "",
      path: undefined,
      selected: true,
    });
  });

  it("merges associated asset images before storyboard image and audio", () => {
    const model = buildToonflowWorkbenchModel({
      storyboards: [
        {
          ...storyboard("shot-1", 1, {
            kind: "image",
            path: "/tmp/shot.png",
          }),
          assetIds: ["role-1", "scene-1", "missing-asset"],
          audioRef: { kind: "audio", path: "/tmp/voice.wav" },
        },
      ],
      tracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "opening",
          storyboardIds: ["shot-1"],
          prompt: "雨夜推镜",
          duration: 5,
          candidateVideoIds: [],
          state: "ready",
        },
      ],
      candidates: [],
      assetMediaById: {
        "role-1": {
          id: "role-1",
          name: "独孤剑尘",
          fileType: "image",
          path: "/tmp/role.png",
          prompt: "玄衣剑修",
        },
        "scene-1": {
          id: "scene-1",
          name: "道口镇",
          fileType: "image",
          path: "/tmp/scene.png",
          prompt: "雨夜镇口",
        },
        "missing-asset": {
          id: "missing-asset",
          name: "缺失资产",
          fileType: "image",
          path: "/tmp/missing.png",
        },
      },
      fileExists: (filePath) => filePath !== "/tmp/missing.png",
    });

    expect(model.trackList[0]?.medias.map((media) => [media.sources, media.name, media.fileType])).toEqual([
      ["assets", "独孤剑尘", "image"],
      ["assets", "道口镇", "image"],
      ["storyboard", "分镜 1", "image"],
      ["storyboard", "分镜 1", "audio"],
    ]);
  });
});

function storyboard(
  id: string,
  index: number,
  mediaRef: StoryboardItem["mediaRef"],
): StoryboardItem {
  return {
    id,
    episodeId: "chapter-001",
    index,
    trackKey: "opening",
    trackId: "track-1",
    duration: 5,
    prompt: `prompt ${index}`,
    videoDesc: `镜头 ${index}`,
    assetIds: [],
    mediaRef,
    state: "ready",
  };
}
