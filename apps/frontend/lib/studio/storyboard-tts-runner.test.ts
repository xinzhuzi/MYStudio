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
  trackKey: "001", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
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
  emotion: "克制",
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
  it.each(["failed", "canceled"] as const)("explicitly restarts a singular %s backend generation", async (status) => {
    const inputFingerprint = await createStoryboardTtsInputFingerprint({ ...scope, storyboard, profile, referenceAudioSha256: "d".repeat(64) });
    const deps = dependencies({ submit: vi.fn(async (payload) => payload.retry
      ? { id: "restarted", status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" }
      : { id: "old", status: "failed" as const, error: "terminal old run", retryable: false }) });
    const result = await runStoryboardTtsGeneration({ ...scope, profile, dependencies: deps, storyboard: { ...storyboard,
      ttsJob: { schemaVersion: 1, ...scope, shotId: storyboard.id, shotRevision: 1, inputFingerprint, status, attempt: 3,
        retryRequested: true, generationId: "old", createdAt: 1, updatedAt: 1 } } });
    expect(result.generationId).toBe("restarted");
    expect(deps.submit).toHaveBeenCalledOnce();
    expect(deps.submit).toHaveBeenCalledWith(expect.objectContaining({ retry: true }));
  });

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
        emotion: storyboard.emotion,
        voiceStyle: storyboard.voiceStyle,
        generationKind: "storyboard-shot",
      }),
    );
  });

  it("submits only external narration for H3 and rejects legacy unstructured mixed still speech", async () => {
    // H3 镜(烧录音频在位,mediaRef video):合成文本=旁白行正文,角色台词烧在镜内
    const h3Deps = dependencies();
    await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        lines: "林昭：你来。\n旁白：风起。",
        ttsSpokenText: "你来。风起。",
        mediaRef: { kind: "video", path: "project-file://project-a/h3/sb-1.mp4" },
      },
      profile,
      dependencies: h3Deps,
    });
    expect(h3Deps.submit).toHaveBeenCalledWith(
      expect.objectContaining({ text: "风起。" }),
    );

    // 静图产线镜(无 H3 烧录音频):全文照旧——外挂 TTS 是唯一音频来源,
    // 拆行会丢角色台词(R4 静图产线全链现状不动)
    const stillDeps = dependencies();
    await expect(runStoryboardTtsGeneration({
      ...scope,
      storyboard: { ...storyboard, lines: "林昭：你来。\n旁白：风起。", ttsSpokenText: "你来。风起。" },
      profile, dependencies: stillDeps,
    })).rejects.toThrow("speechUtterances");
    expect(stillDeps.submit).not.toHaveBeenCalled();
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
        storyboard: { ...storyboard, emotion: "紧张" },
        profile,
        referenceAudioSha256: "d".repeat(64),
      }),
      createStoryboardTtsInputFingerprint({
        ...scope,
        storyboard: { ...storyboard, voiceStyle: "中文角色对白，紧张，停顿自然。" },
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
    expect(new Set([base, ...variants])).toHaveLength(7);
  });

  it("does not reuse a completed audio job when only storyboard emotion changes", async () => {
    const initial = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: { ...storyboard, emotion: "克制" },
      profile,
      dependencies: dependencies(),
    });
    const deps = dependencies();

    const regenerated = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        emotion: "愤怒",
        ttsJob: initial.ttsJob,
        shotAudioBindings: [initial.shotAudioBinding],
      },
      profile,
      dependencies: deps,
    });

    expect(regenerated.generationId).toBe("generation-1");
    expect(regenerated.ttsJob.inputFingerprint).not.toBe(initial.ttsJob.inputFingerprint);
    expect(deps.submit).toHaveBeenCalledOnce();
    expect(deps.submit).toHaveBeenCalledWith(expect.objectContaining({
      emotion: "愤怒",
      voiceStyle: storyboard.voiceStyle,
    }));
  });

  it("does not reuse a completed audio job when only storyboard voiceStyle changes", async () => {
    const initial = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: { ...storyboard, voiceStyle: "电影级中文旁白，克制。" },
      profile,
      dependencies: dependencies(),
    });
    const deps = dependencies();

    const regenerated = await runStoryboardTtsGeneration({
      ...scope,
      storyboard: {
        ...storyboard,
        voiceStyle: "电影级中文旁白，愤怒。",
        ttsJob: initial.ttsJob,
        shotAudioBindings: [initial.shotAudioBinding],
      },
      profile,
      dependencies: deps,
    });

    expect(regenerated.ttsJob.inputFingerprint).not.toBe(initial.ttsJob.inputFingerprint);
    expect(deps.submit).toHaveBeenCalledOnce();
    expect(deps.submit).toHaveBeenCalledWith(expect.objectContaining({
      emotion: storyboard.emotion,
      voiceStyle: "电影级中文旁白，愤怒。",
    }));
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
    const cancelGeneration = vi.fn(async () => ({
      id: "generation-1",
      status: "failed" as const,
    }));
    const deps = dependencies({ cancelGeneration });
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
    expect(cancelGeneration).toHaveBeenCalledWith("generation-1");
  });
});

describe("ordered fixed voices", () => {
  const otherProfile = { ...profile, id: "profile-dugu", referenceAudioPath: "/voices/dugu.wav" };
  const mixed = { ...storyboard, lines: "旁白：雨落。\n独孤：借灯。", ttsSpokenText: "雨落。 借灯。", speechUtterances: [
    { speaker: "旁白", speakerId: "narrator" as const, text: "雨落。" },
    { speaker: "独孤", speakerId: "character:dugu" as const, text: "借灯。" },
  ] };
  const profiles = { narrator: profile, "character:dugu": otherProfile };
  it.each(["startup", "replay"])("cancels every persisted pending segment during %s despite remote failure", async (phase) => {
    const three = { ...mixed, lines: mixed.lines + "\n旁白：风起。", ttsSpokenText: mixed.ttsSpokenText + " 风起。",
      speechUtterances: [...mixed.speechUtterances, { speaker: "旁白", speakerId: "narrator" as const, text: "风起。" }] };
    let seq = 0;
    const initial = await runStoryboardTtsGeneration({ ...scope, storyboard: three, profile, profiles, dependencies: dependencies({
      submit: vi.fn(async () => ({ id: `persisted-${seq++}`, status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" })),
      composeAudioBytes: vi.fn(async () => new ArrayBuffer(1)) }) });
    const prior = { ...initial.ttsJob, status: "generating" as const, segments: initial.ttsJob.segments!.map((s, i) => ({ ...s,
      status: i === 0 ? "completed" as const : i === 1 ? "generating" as const : "queued" as const })) };
    let canceled = false;
    let lastJob: StoryboardItem["ttsJob"];
    const deps = dependencies({
      startRuntime: vi.fn(async () => { if (phase === "startup") canceled = true; return { success: true }; }),
      fetchAudio: vi.fn(async () => { canceled = true; return new ArrayBuffer(1); }),
      cancelGeneration: vi.fn(async () => { throw new Error("remote unavailable"); }),
    });
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: { ...three, ttsJob: prior }, profile, profiles, dependencies: deps,
      isCanceled: () => canceled, onJob: j => { lastJob = j; } })).rejects.toThrow("取消");
    expect(vi.mocked(deps.cancelGeneration!).mock.calls.map(([id]) => id).sort()).toEqual(["persisted-1", "persisted-2"]);
    expect(lastJob?.segments?.map(s => s.status)).toEqual(["completed", "canceled", "canceled"]);
    expect(lastJob?.errorMessage).toContain("后端取消");
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.writeGeneratedAudio).not.toHaveBeenCalled();
  });

  it.each(["", "无", "无对白"])("rejects persisted mixed placeholder %s before runtime", async (token) => {
    const deps = dependencies();
    const invalid = { ...mixed, lines: `旁白：${token}\n独孤：借灯。`, ttsSpokenText: `${token} 借灯。`,
      speechUtterances: [{ speaker: "旁白", speakerId: "narrator" as const, text: token }, mixed.speechUtterances[1]] };
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: invalid, profile, profiles, dependencies: deps }))
      .rejects.toThrow("混合声音包含空白或占位台词");
    expect(deps.startRuntime).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("submits ordered clean texts to distinct profiles and publishes one WAV", async () => {
    let sequence = 0;
    const deps = dependencies({ submit: vi.fn(async () => ({ id: `g-${++sequence}`, status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" })),
      composeAudioBytes: vi.fn(async () => new Uint8Array([9, 8]).buffer) });
    const result = await runStoryboardTtsGeneration({ ...scope, storyboard: mixed, profile, profiles, dependencies: deps });
    expect(vi.mocked(deps.submit).mock.calls.map(([p]) => [p.text, p.profileId])).toEqual([["雨落。", profile.id], ["借灯。", otherProfile.id]]);
    expect(deps.writeGeneratedAudio).toHaveBeenCalledTimes(1);
    expect(deps.composeAudioBytes).toHaveBeenCalledTimes(1);
    expect(result.ttsJob.segments?.map(s => s.generationId)).toEqual(["g-1", "g-2"]);
    expect(result.shotAudioBinding.durationUs).toBe(1_500_000);
  });
  it("preflights every profile before any service and rejects unstructured mixed labels", async () => {
    const deps = dependencies();
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: mixed, profile, dependencies: deps })).rejects.toThrow("固定 voice profile");
    expect(deps.startRuntime).not.toHaveBeenCalled();
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: { ...mixed, speechUtterances: undefined }, profile, dependencies: deps })).rejects.toThrow("speechUtterances");
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it("invalidates aggregate reuse on second profile, reference or order changes", async () => {
    const fingerprint = (s: StoryboardItem, p = profiles, hashes = { narrator: "a", "character:dugu": "b" }) => createStoryboardTtsInputFingerprint({ ...scope, storyboard: s, profile, profiles: p, referenceAudioSha256BySpeaker: hashes });
    const base = await fingerprint(mixed);
    expect(await fingerprint(mixed, { ...profiles, "character:dugu": { ...otherProfile, id: "changed" } })).not.toBe(base);
    expect(await fingerprint(mixed, profiles, { narrator: "a", "character:dugu": "c" })).not.toBe(base);
    expect(await fingerprint({ ...mixed, speechUtterances: [...mixed.speechUtterances].reverse() })).not.toBe(base);
  });
  it("does not publish partial audio, and explicit retry reuses completed segment identities", async () => {
    let fail = true;
    let sequence = 0;
    let lastJob: StoryboardItem["ttsJob"];
    const deps = dependencies({ submit: vi.fn(async (p: TtsGenerateRequest) => {
      sequence++;
      if (p.profileId === otherProfile.id && fail) return { id: `g-${sequence}`, status: "failed" as const, error: "bad segment", retryable: false };
      return { id: `g-${sequence}`, status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" };
    }), composeAudioBytes: vi.fn(async () => new Uint8Array([9]).buffer) });
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: mixed, profile, profiles, dependencies: deps, onJob: j => { lastJob = j; } })).rejects.toThrow("bad segment");
    expect(lastJob?.status).toBe("failed");
    expect(deps.writeGeneratedAudio).not.toHaveBeenCalled();
    fail = false;
    await runStoryboardTtsGeneration({ ...scope, storyboard: { ...mixed, ttsJob: { ...lastJob!, retryRequested: true } }, profile, profiles, dependencies: deps });
    expect(vi.mocked(deps.submit).mock.calls.filter(([p]) => p.profileId === profile.id)).toHaveLength(1);
    expect(vi.mocked(deps.submit).mock.calls.at(-1)?.[0].retry).toBe(true);
  });
  it("cancels a later segment without publishing a partial binding", async () => {
    let count = 0; let canceled = false;
    const deps = dependencies({ submit: vi.fn(async () => {
      count++; if (count === 2) canceled = true;
      return { id: `g-${count}`, status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" };
    }), cancelGeneration: vi.fn(async () => ({ id: "g-2", status: "failed" as const })), composeAudioBytes: vi.fn(async () => new ArrayBuffer(1)) });
    const jobs: string[] = [];
    await expect(runStoryboardTtsGeneration({ ...scope, storyboard: mixed, profile, profiles, dependencies: deps, isCanceled: () => canceled, onJob: j => { jobs.push(j.status); } })).rejects.toThrow("取消");
    expect(deps.cancelGeneration).toHaveBeenCalledWith("g-2");
    expect(deps.writeGeneratedAudio).not.toHaveBeenCalled();
    expect(jobs).not.toContain("completed");
  });
  it("fingerprints individual narrator-family selections and their references", async () => {
    const base = { ...scope, storyboard: mixed, profile, profiles, utteranceProfiles: [profile, otherProfile], utteranceReferenceSha256s: ["a", "b"] };
    const hash = await createStoryboardTtsInputFingerprint(base);
    expect(await createStoryboardTtsInputFingerprint({ ...base, utteranceReferenceSha256s: ["a", "c"] })).not.toBe(hash);
    expect(await createStoryboardTtsInputFingerprint({ ...base, utteranceProfiles: [{ ...profile, id: "narrator-family-2" }, otherProfile] })).not.toBe(hash);
  });

  it("registers each narrator-family reference immediately before its submit", async () => {
    const selected: string[] = []; let registered = ""; let seq = 0;
    const deps = dependencies({ ensureProfile: vi.fn(async p => { registered = p.referenceAudioPath ?? ""; }),
      submit: vi.fn(async () => { selected.push(registered); return { id: `n-${++seq}`, status: "completed" as const, backend: "qwen-mlx", audioPath: "/real.wav" }; }),
      composeAudioBytes: vi.fn(async () => new ArrayBuffer(1)) });
    const second = { ...profile, referenceAudioPath: "/voices/sad.wav" };
    await runStoryboardTtsGeneration({ ...scope, storyboard: { ...storyboard, lines: "旁白：风起。\n旁白：悲伤。", ttsSpokenText: "风起。 悲伤。", speechUtterances: [{ speaker: "旁白", speakerId: "narrator", text: "风起。" }, { speaker: "旁白", speakerId: "narrator", text: "悲伤。" }] }, profile, utteranceProfiles: [profile, second], dependencies: deps });
    expect(selected).toEqual([profile.referenceAudioPath, second.referenceAudioPath]);
  });

});
