import { describe, expect, it, vi } from "vitest";
import {
  runChapterAutoVideo,
  type ChapterAutoVideoDependencies,
} from "./chapter-auto-video";
import type { ProductionTrack, StoryboardItem, VideoCandidate } from "@/types/studio";
import type { VoiceProfile } from "@/types/tts";

function storyboard(index: number, overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: "chapter-001-scene-1",
    trackId: "track-1",
    duration: 4,
    prompt: `画面 ${index}`,
    videoDesc: `动作 ${index}`,
    assetIds: [],
    mediaRef: { kind: "image", path: `/frame-${index}.png` },
    audioRef: index === 1 ? { kind: "audio", path: "/audio-1.wav" } : undefined,
    state: "ready",
    speaker: index === 1 ? "旁白" : "独孤剑尘",
    speakerId: index === 1 ? "narrator" : "character:dugu",
    line: `台词 ${index}`,
    ttsSpokenText: `台词 ${index}`,
    durationTarget: 4,
    voiceStyle: "克制",
    requiresFixedVoice: true,
    ...overrides,
  };
}

const profiles = {
  narrator: {
    id: "profile-narrator",
    name: "旁白",
    type: "reference" as const,
    language: "zh",
    defaultEngine: "qwen" as const,
    referenceAudioPath: "/voice/narrator.wav",
    referenceText: "旁白参考",
    createdAt: 1,
    updatedAt: 1,
  },
  "character:dugu": {
    id: "profile-dugu",
    name: "独孤剑尘",
    type: "reference" as const,
    language: "zh",
    defaultEngine: "qwen" as const,
    referenceAudioPath: "/voice/dugu.wav",
    referenceText: "角色参考",
    createdAt: 1,
    updatedAt: 1,
  },
} satisfies Record<string, VoiceProfile>;

function createDependencies(options: { missingMedia?: boolean } = {}) {
  const calls: string[] = [];
  let storyboards = [
    storyboard(1),
    storyboard(2, options.missingMedia ? { mediaRef: undefined } : {}),
  ];
  const track: ProductionTrack = {
    id: "track-1",
    episodeId: "chapter-001",
    trackKey: "chapter-001-scene-1",
    storyboardIds: storyboards.map((item) => item.id),
    prompt: "第一场",
    duration: 8,
    candidateVideoIds: [],
    state: "ready",
  };
  const rendered: VideoCandidate = {
    id: "candidate-1",
    trackId: track.id,
    provider: "ffmpeg-local",
    filePath: "/track.mp4",
    state: "ready",
    createdAt: 1,
  };
  const dependencies: ChapterAutoVideoDependencies = {
    ensurePlanning: vi.fn(async () => {
      calls.push("planning");
    }),
    loadStoryboards: () => storyboards,
    ensureFixedVoiceProfiles: vi.fn(async () => {
      calls.push("binding");
      return profiles;
    }),
    resolveMediaPath: vi.fn(async (path) => path),
    generateAudio: vi.fn(async (item) => {
      calls.push(`tts:${item.id}`);
      return {
        audioRef: { kind: "audio" as const, path: `/generated-${item.id}.wav` },
        generationId: `generation-${item.id}`,
        ttsBackend: "qwen-mlx",
        ttsMocked: false as const,
      };
    }),
    writeStoryboardAudio: (storyboardId, result) => {
      storyboards = storyboards.map((item) =>
        item.id === storyboardId ? { ...item, audioRef: result.audioRef } : item,
      );
    },
    rebuildTracks: vi.fn(() => calls.push("rebuild")),
    loadTracks: () => [track],
    loadCandidates: () => [],
    renderTrack: vi.fn(async () => {
      calls.push("render");
      return rendered;
    }),
    mergeEpisode: vi.fn(async () => {
      calls.push("merge");
      return "/final.mp4";
    }),
    probeFinalMedia: vi.fn(async () => ({
      path: "/final.mp4",
      sizeBytes: 1024,
      mtimeMs: 1_700_000_000_000,
      sha256: "a".repeat(64),
      duration: 120,
      streams: ["video", "audio"],
    })),
    writeFinalEvidence: vi.fn(() => calls.push("write-final")),
  };
  return { dependencies, calls };
}

describe("chapter auto video orchestration", () => {
  it("runs planning, fixed voice, missing TTS, render, merge, and final evidence in order", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];
    const result = await runChapterAutoVideo({
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result).toMatchObject({ finalPath: "/final.mp4", storyboards: 2 });
    expect(calls).toEqual([
      "planning",
      "binding",
      "tts:sb-2",
      "rebuild",
      "render",
      "merge",
      "write-final",
    ]);
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
      "render",
      "merge",
      "completed",
    ]);
  });

  it("stops before rendering when a storyboard image is missing", async () => {
    const { dependencies, calls } = createDependencies({ missingMedia: true });
    const statuses: string[] = [];
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies,
        onStatus: (status) => statuses.push(status.stage),
      }),
    ).rejects.toThrow("缺少可读分镜图");
    expect(calls).not.toContain("render");
    expect(calls).not.toContain("merge");
    expect(statuses.at(-1)).toBe("failed");
  });

  it("blocks incomplete voiceover and missing fixed profile before TTS", async () => {
    const incomplete = createDependencies();
    incomplete.dependencies.loadStoryboards = () => [
      storyboard(1, { ttsSpokenText: "" }),
    ];
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies: incomplete.dependencies,
      }),
    ).rejects.toThrow("缺少 ttsSpokenText");
    expect(incomplete.dependencies.generateAudio).not.toHaveBeenCalled();

    const missingProfile = createDependencies();
    missingProfile.dependencies.ensureFixedVoiceProfiles = async () => ({
      narrator: profiles.narrator,
    });
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies: missingProfile.dependencies,
      }),
    ).rejects.toThrow("character:dugu 缺少固定 voice profile");
    expect(missingProfile.dependencies.generateAudio).not.toHaveBeenCalled();
  });
});
