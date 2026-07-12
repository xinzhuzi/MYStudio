import { describe, expect, it, vi } from "vitest";
import { runStoryboardTtsGeneration } from "./storyboard-tts-runner";
import type { StoryboardItem } from "@/types/studio";
import type { VoiceProfile } from "@/types/tts";

const storyboard: StoryboardItem = {
  id: "sb-chapter-001-001",
  episodeId: "chapter-001",
  index: 1,
  trackKey: "chapter-001-scene-1",
  trackId: "",
  duration: 4,
  prompt: "雨落码头",
  videoDesc: "独孤按剑",
  assetIds: [],
  state: "idle",
  speaker: "旁白",
  speakerId: "narrator",
  line: "雨落码头。",
  ttsSpokenText: "雨落码头。",
  durationTarget: 4,
  voiceStyle: "电影级中文旁白",
  requiresFixedVoice: true,
};

const profile: VoiceProfile = {
  id: "profile-narrator",
  name: "固定旁白",
  type: "reference",
  language: "zh",
  defaultEngine: "qwen",
  defaultModelSize: "1.7B",
  referenceAudioPath: "/voices/narrator.wav",
  referenceText: "这一夜，雨没有停。",
  createdAt: 1,
  updatedAt: 1,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    startRuntime: vi.fn(async () => ({ success: true })),
    ensureProfile: vi.fn(async () => profile),
    submit: vi.fn(async () => ({ id: "generation-1", status: "queued" as const })),
    getStatus: vi.fn(async () => ({
      id: "generation-1",
      status: "completed" as const,
      audioPath: "/runtime/audio.wav",
      backend: "qwen-mlx",
      mocked: false,
    })),
    fetchAudio: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    saveMaterial: vi.fn(async () => ({
      success: true,
      localPath: "local-image://studio-material/audio.wav",
      filePath: "/project/audio.wav",
    })),
    resolveReferenceAudioPath: vi.fn(async (path: string) => path),
    delay: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("storyboard TTS runner", () => {
  it("generates and saves one real fixed-voice audio file", async () => {
    const deps = dependencies();
    const result = await runStoryboardTtsGeneration({
      storyboard,
      profile,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      audioRef: { kind: "audio", path: "/project/audio.wav" },
      generationId: "generation-1",
      ttsBackend: "qwen-mlx",
      ttsMocked: false,
    });
    expect(deps.ensureProfile).toHaveBeenCalledWith(profile);
    expect(deps.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "雨落码头。",
        profileId: profile.id,
      }),
    );
  });

  it("blocks unreadable fixed audio and mock generation before writeback", async () => {
    const unreadable = dependencies({
      resolveReferenceAudioPath: vi.fn(async () => null),
    });
    await expect(
      runStoryboardTtsGeneration({ storyboard, profile, dependencies: unreadable }),
    ).rejects.toThrow("固定音色文件不可读");
    expect(unreadable.submit).not.toHaveBeenCalled();

    const mocked = dependencies({
      getStatus: vi.fn(async () => ({
        id: "generation-1",
        status: "completed" as const,
        audioPath: "/runtime/audio.wav",
        backend: "mock",
        mocked: true,
      })),
    });
    await expect(
      runStoryboardTtsGeneration({ storyboard, profile, dependencies: mocked }),
    ).rejects.toThrow("TTS 返回 mock 音频");
    expect(mocked.saveMaterial).not.toHaveBeenCalled();
  });

  it("blocks missing spoken text and failed material saves", async () => {
    await expect(
      runStoryboardTtsGeneration({
        storyboard: { ...storyboard, ttsSpokenText: "" },
        profile,
        dependencies: dependencies(),
      }),
    ).rejects.toThrow("口播文本为空");

    await expect(
      runStoryboardTtsGeneration({
        storyboard,
        profile,
        dependencies: dependencies({
          saveMaterial: vi.fn(async () => ({
            success: false,
            error: "disk full",
          })),
        }),
      }),
    ).rejects.toThrow("disk full");
  });
});
