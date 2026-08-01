import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoryboardTtsInputFingerprint,
  runStoryboardTtsGeneration,
  type StoryboardTtsRunnerDependencies,
} from "./storyboard-tts-runner";
import { createRemotionAudioBindingFingerprint } from "./remotion/remotion-audio-fingerprint";
import type { StoryboardItem } from "@/types/studio";
import type { TtsGenerateRequest, VoiceProfile } from "@/types/tts";

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
        shotRevision: 1,
        referenceAudioSha256: "d".repeat(64),
        generationKind: "storyboard-shot",
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

  it("fails closed instead of reusing a completed voice binding from another scope", async () => {
    const initial = await runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: dependencies(),
    });
    const crossScopeBinding = {
      ...initial.shotAudioBinding,
      projectId: "project-b",
      chapterId: "chapter-999",
      shotId: "other-shot",
      source: {
        ...initial.shotAudioBinding.source,
        projectId: "project-b",
      },
    };
    crossScopeBinding.bindingFingerprint = await createRemotionAudioBindingFingerprint(crossScopeBinding);
    const deps = dependencies();

    await expect(runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        ttsJob: initial.ttsJob,
        shotAudioBindings: [crossScopeBinding],
      },
      profile,
      dependencies: deps,
    })).rejects.toThrow("voice binding 身份或 fingerprint 不匹配");
    expect(deps.startRuntime).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("reuses an exact completed voice binding without restarting the provider", async () => {
    const initial = await runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: dependencies(),
    });
    const deps = dependencies();

    const reused = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        ttsJob: initial.ttsJob,
        shotAudioBindings: [initial.shotAudioBinding],
        ttsBackend: initial.ttsBackend,
      },
      profile,
      dependencies: deps,
    });

    expect(reused.generationId).toBe(initial.generationId);
    expect(reused.shotAudioBinding).toEqual(initial.shotAudioBinding);
    expect(deps.startRuntime).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("fails closed when a completed voice binding fingerprint is corrupted", async () => {
    const initial = await runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: dependencies(),
    });
    const deps = dependencies();

    await expect(runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        ttsJob: initial.ttsJob,
        shotAudioBindings: [{
          ...initial.shotAudioBinding,
          bindingFingerprint: "0".repeat(64),
        }],
      },
      profile,
      dependencies: deps,
    })).rejects.toThrow("voice binding 身份或 fingerprint 不匹配");
    expect(deps.startRuntime).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("does not exceed the three-attempt budget when a retry resumes at attempt two", async () => {
    const inputFingerprint = await createStoryboardTtsInputFingerprint({
      ...scope,
      storyboard,
      profile,
      referenceAudioSha256: "d".repeat(64),
    });
    const submit = vi.fn(async () => ({ id: "generation-after-restart", status: "queued" as const }));
    const deps = dependencies({
      submit,
      getStatus: vi.fn(async () => ({
        id: "generation-existing-attempt-two",
        status: "failed" as const,
        error: "temporary outage",
        errorCode: "network",
        retryable: true,
      })),
    });

    await expect(runStoryboardTtsGeneration({
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
          attempt: 2,
          generationId: "generation-existing-attempt-two",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      profile,
      dependencies: deps,
    })).rejects.toThrow("temporary outage");
    expect(submit).toHaveBeenCalledOnce();
    const submittedPayload = (submit.mock.calls as unknown as Array<[TtsGenerateRequest]>)[0]?.[0];
    expect(submittedPayload).toMatchObject({ retry: true, inputFingerprint });
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

  it("retries a submit response that is already failed and retryable", async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({
        id: "generation-submit-failed",
        status: "failed" as const,
        error: "temporary provider outage",
        errorCode: "provider-unavailable",
        retryable: true,
      })
      .mockResolvedValueOnce({
        id: "generation-submit-recovered",
        status: "completed" as const,
        audioPath: "/runtime/audio.wav",
        backend: "qwen-mlx",
        mocked: false,
      });
    const getStatus = vi.fn(async () => ({
      id: "unexpected-poll",
      status: "completed" as const,
      audioPath: "/runtime/audio.wav",
      backend: "qwen-mlx",
      mocked: false,
    }));
    const deps = dependencies({ submit, getStatus });

    const result = await runStoryboardTtsGeneration({
      ...scope,
      storyboard,
      profile,
      dependencies: deps,
    });

    expect(result.generationId).toBe("generation-submit-recovered");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(getStatus).not.toHaveBeenCalled();
    expect(submit.mock.calls.map(([payload]) => payload.retry)).toEqual([false, true]);
  });

  it("bounds an explicit retry to three attempts even after a prior run exhausted its budget", async () => {
    const inputFingerprint = await createStoryboardTtsInputFingerprint({
      ...scope,
      storyboard,
      profile,
      referenceAudioSha256: "d".repeat(64),
    });
    const submit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("network"), { code: "network" }))
      .mockResolvedValue({ id: "generation-retry", status: "queued" as const });
    const attempts: number[] = [];
    const deps = dependencies({ submit });
    await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        ttsJob: {
          schemaVersion: 1,
          ...scope,
          shotId: storyboard.id,
          shotRevision: 1,
          inputFingerprint,
          status: "failed",
          attempt: 3,
          retryRequested: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      profile,
      dependencies: deps,
      onJob: (job) => { if (job.status === "generating") attempts.push(job.attempt); },
    });
    expect(submit).toHaveBeenCalledTimes(3);
    expect(attempts.slice(0, 3)).toEqual([1, 2, 3]);
    expect(Math.max(...attempts)).toBe(3);
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
