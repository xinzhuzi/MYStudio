import { describe, expect, it, vi } from "vitest";
import type { AssetRef, ShotGroup } from "@/stores/sclass-store";
import {
  createSClassGenerationRecord,
  materializeSClassGenerationReferences,
} from "./sclass-generation-output";

function asset(type: "image" | "video" | "audio", id: string, httpUrl: string | null = null): AssetRef {
  return {
    id,
    type,
    tag: `@${id}`,
    localUrl: `local://${id}`,
    httpUrl,
    fileName: `${id}.bin`,
    fileSize: 1,
    duration: type === "image" ? null : 5,
  };
}

describe("sclass generation output", () => {
  it("assigns image roles and materializes previous/video/audio references", async () => {
    const convert = vi.fn(async (rawUrl: unknown) => {
      const url = String(rawUrl);
      return url.includes("failed") ? "" : `https://cdn.test/${url}`;
    });
    const result = await materializeSClassGenerationReferences({
      imageRefs: [asset("image", "image-1"), asset("image", "image-2")],
      videoRefs: [asset("video", "video-http", "https://ready.test/video.mp4"), asset("video", "video-local")],
      audioRefs: [asset("audio", "audio-local"), asset("audio", "failed-audio")],
      prevVideoUrl: "local://previous",
      isExtendOrEdit: false,
    }, convert);

    expect(result.imageWithRoles).toEqual([
      { url: "https://cdn.test/local://image-1", role: "first_frame" },
      { url: "https://cdn.test/local://image-2", role: "last_frame" },
    ]);
    expect(result.videoRefUrls).toEqual([
      "https://cdn.test/local://previous",
      "https://ready.test/video.mp4",
      "https://cdn.test/local://video-local",
    ]);
    expect(result.audioRefUrls).toEqual(["https://cdn.test/local://audio-local"]);
  });

  it("does not prepend the previous video for extend/edit generation", async () => {
    const convert = vi.fn(async (rawUrl: unknown) => `https://cdn.test/${String(rawUrl)}`);
    const result = await materializeSClassGenerationReferences({
      imageRefs: [],
      videoRefs: [],
      audioRefs: [],
      prevVideoUrl: "local://previous",
      isExtendOrEdit: true,
    }, convert);

    expect(result.videoRefUrls).toEqual([]);
    expect(convert).not.toHaveBeenCalled();
  });

  it("creates the compatible completed history record", () => {
    const times = [100, 101];
    const reference = asset("image", "image-1");
    const record = createSClassGenerationRecord({
      group: { id: "group-1" } as ShotGroup,
      prompt: "prompt",
      videoUrl: "local://video.mp4",
      assetRefs: [reference],
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 10,
    }, () => times.shift()!);

    expect(record).toEqual({
      id: "gen_100_group-1",
      timestamp: 101,
      prompt: "prompt",
      videoUrl: "local://video.mp4",
      status: "completed",
      error: null,
      assetRefs: [reference],
      config: { aspectRatio: "16:9", resolution: "720p", duration: 10 },
    });
  });
});
