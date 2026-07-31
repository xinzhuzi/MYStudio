import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoryboardTtsInputFingerprint,
  runStoryboardTtsGeneration,
  type StoryboardTtsRunnerDependencies,
} from "./storyboard-tts-runner";
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

const scope = { projectId: "project-a", chapterId: "chapter-001" } as const;

function dependencies(
  overrides: Partial<StoryboardTtsRunnerDependencies> = {},
): StoryboardTtsRunnerDependencies {
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
    writeGeneratedAudio: vi.fn(async () => ({
      source: {
        kind: "project-file" as const,
        projectId: "project-a",
        relativePath: `remotion/audio/chapter-001/shots/${storyboard.id}/voice/${"c".repeat(64)}.wav`,
        contentSha256: "c".repeat(64),
        provenance: {
          sourceKind: "generated" as const,
          sourceId: "c".repeat(64),
          sourceVersion: `sha256:${"c".repeat(64)}`,
        },
      },
      durationUs: 1_500_000,
      streams: ["audio"],
      sizeBytes: 3,
    })),
    resolveReferenceAudioPath: vi.fn(async (path: string) => path),
    hashReferenceAudio: vi.fn(async () => "d".repeat(64)),
    delay: vi.fn(async () => undefined),
    now: vi.fn(() => 100),
    ...overrides,
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("storyboard TTS runner", () => {
  it("keeps the fixed-voice bridge error when the TTS preload is unavailable", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { studioAssets: { saveMaterial: vi.fn() } },
    });

    await expect(
      runStoryboardTtsGeneration({ ...scope, storyboard, profile }),
    ).rejects.toThrow("固定音色文件校验接口仅在桌面应用中可用");
  });

  it("generates and saves one real fixed-voice audio file", async () => {
    const deps = dependencies();
    const result = await runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      audioRef: {
        kind: "audio",
        path: expect.stringContaining("project-file://project-a/remotion/audio/chapter-001/shots/"),
        contentSha256: "c".repeat(64),
      },
      shotAudioBinding: {
        renderScope: "shot",
        role: "voice",
        projectId: "project-a",
        chapterId: "chapter-001",
        shotId: storyboard.id,
        shotRevision: 1,
      },
      generationId: "generation-1",
      ttsBackend: "qwen-mlx",
      ttsMocked: false,
    });
    expect(deps.ensureProfile).toHaveBeenCalledWith(profile);
    expect(deps.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "雨落码头。",
        profileId: profile.id,
        projectId: "project-a",
        chapterId: "chapter-001",
        shotId: storyboard.id,
        inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("blocks unreadable fixed audio and mock generation before writeback", async () => {
    const unreadable = dependencies({
      resolveReferenceAudioPath: vi.fn(async () => null),
    });
    await expect(
      runStoryboardTtsGeneration({ ...scope, storyboard, profile, dependencies: unreadable }),
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
      runStoryboardTtsGeneration({ ...scope, storyboard, profile, dependencies: mocked }),
    ).rejects.toThrow("TTS 返回 mock 音频");
    expect(mocked.writeGeneratedAudio).not.toHaveBeenCalled();
  });

  it("blocks missing spoken text and failed material saves", async () => {
    await expect(
      runStoryboardTtsGeneration({
        ...scope,
        storyboard: { ...storyboard, ttsSpokenText: "" },
        profile,
        dependencies: dependencies(),
      }),
    ).rejects.toThrow("口播文本为空");

    await expect(
      runStoryboardTtsGeneration({
        ...scope,
        storyboard,
        profile,
        dependencies: dependencies({
          writeGeneratedAudio: vi.fn(async () => {
            throw new Error("disk full");
          }),
        }),
      }),
    ).rejects.toThrow("disk full");
  });

  it("isolates the input fingerprint by revision, text, profile and reference-audio SHA", async () => {
    const base = await createStoryboardTtsInputFingerprint({
      ...scope,
      storyboard,
      profile,
      referenceAudioSha256: "d".repeat(64),
    });
    const variants = await Promise.all([
      createStoryboardTtsInputFingerprint({
        ...scope,
        storyboard: { ...storyboard, outputVersion: 2 },
        profile,
        referenceAudioSha256: "d".repeat(64),
      }),
      createStoryboardTtsInputFingerprint({
        ...scope,
        storyboard: { ...storyboard, ttsSpokenText: "另一句" },
        profile,
        referenceAudioSha256: "d".repeat(64),
      }),
      createStoryboardTtsInputFingerprint({
        ...scope,
        storyboard,
        profile: { ...profile, defaultModelSize: "0.6B" },
        referenceAudioSha256: "d".repeat(64),
      }),
      createStoryboardTtsInputFingerprint({
        ...scope,
        storyboard,
        profile,
        referenceAudioSha256: "e".repeat(64),
      }),
    ]);
    expect(new Set([base, ...variants])).toHaveLength(5);
  });

  it("resumes an exact persisted generation without a duplicate submit", async () => {
    const inputFingerprint = await createStoryboardTtsInputFingerprint({
      ...scope,
      storyboard,
      profile,
      referenceAudioSha256: "d".repeat(64),
    });
    const deps = dependencies();
    const result = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        ttsJob: {
          schemaVersion: 1,
          ...scope,
          shotId: storyboard.id,
          shotRevision: 1,
          inputFingerprint,
          status: "generating",
          attempt: 1,
          generationId: "generation-existing",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      profile,
      dependencies: deps,
    });
    expect(result.generationId).toBe("generation-existing");
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.getStatus).toHaveBeenCalledWith("generation-existing");
  });

  it("retries only structured transient failures and keeps one logical fingerprint", async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("network"), { code: "network" }))
      .mockResolvedValue({ id: "generation-1", status: "queued" as const });
    const deps = dependencies({ submit });
    const result = await runStoryboardTtsGeneration({ ...scope, storyboard, profile, dependencies: deps });
    expect(result.generationId).toBe("generation-1");
    expect(submit).toHaveBeenCalledTimes(3);
    const payloads = submit.mock.calls.map(([payload]) => payload);
    expect(payloads.map((payload) => payload.retry)).toEqual([false, true, true]);
    expect(new Set(payloads.map((payload) => payload.inputFingerprint))).toHaveLength(1);

    const terminal = dependencies({
      submit: vi.fn(async () => { throw Object.assign(new Error("bad profile"), { status: 400 }); }),
    });
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard, profile, dependencies: terminal }))
      .rejects.toThrow("bad profile");
    expect(terminal.submit).toHaveBeenCalledOnce();
  });

  it("cooperatively cancels after project audio save and never reports completion", async () => {
    let canceled = false;
    const jobs: string[] = [];
    const deps = dependencies();
    const writeGeneratedAudio = deps.writeGeneratedAudio;
    deps.writeGeneratedAudio = vi.fn(async (payload) => {
      const result = await writeGeneratedAudio(payload);
      canceled = true;
      return result;
    });
    await expect(runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: deps,
      isCanceled: () => canceled,
      onJob: (job) => { jobs.push(job.status); },
    })).rejects.toThrow("已取消");
    expect(jobs.at(-1)).toBe("canceled");
    expect(jobs).not.toContain("completed");
  });
});
