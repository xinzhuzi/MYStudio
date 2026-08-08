// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import type { VoiceProfile } from "@/types/tts";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  createJob: vi.fn(),
}));

vi.mock("@/lib/studio/remotion/remotion-shot-plan-builder", () => ({
  buildRemotionShotPlans: mocks.build,
}));
vi.mock("@/lib/studio/remotion/remotion-job-factory", () => ({
  createReadyShotJob: mocks.createJob,
}));

import { useFirstShotPreviewActions } from "./use-first-shot-preview-actions";

const storyboard = {
  id: "sb-chapter-001-001",
  episodeId: "chapter-001",
  index: 1,
  trackKey: "track-001",
  trackId: "track-001",
  duration: 2,
  prompt: "码头",
  videoDesc: "码头",
  assetIds: [],
  state: "ready",
} as StoryboardItem;

const plan = {
  projectId: "project-a",
  chapterId: "chapter-001",
  renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
  shot: { shotId: storyboard.id, revision: 1 },
} as unknown as RemotionShotPlanV1;

const job = {
  schemaVersion: 1,
  jobId: "job-first-shot",
  projectId: "project-a",
  target: { kind: "shot", chapterId: "chapter-001", shotId: storyboard.id, shotRevision: 1 },
  inputHash: "a".repeat(64),
  bundleContentHash: "b".repeat(64),
  renderSettingsHash: "c".repeat(64),
  templateVersion: "1.0.0",
  remotionVersion: "4.0.499",
  status: "ready",
  attempt: 0,
  progress: 0,
  createdAt: 1,
} as RemotionRenderJobV1;

const voiceProfile: VoiceProfile = {
  id: "profile-narrator",
  name: "旁白",
  type: "reference",
  language: "zh",
  defaultEngine: "qwen",
  defaultModelSize: "1.7B",
  referenceAudioPath: "/voice/reference.wav",
  referenceText: "参考文本",
  createdAt: 1,
  updatedAt: 1,
};

const legacyStoryboard = {
  ...storyboard,
  outputVersion: 1,
  audioRef: { kind: "audio", path: "/project/exports/chapter-001/shot-001.wav" },
  speakerId: "narrator",
  voiceProfileId: voiceProfile.id,
  ttsSpokenText: "傍晚，码头醒来。",
  requiresFixedVoice: true,
  ttsBackend: "qwen-mlx",
} as StoryboardItem;

describe("useFirstShotPreviewActions", () => {
  let previousProjectId: string | null;
  let previousStoryboards: StoryboardItem[];
  let previousTtsState: Pick<ReturnType<typeof useTtsStore.getState>, "activeProjectId" | "projects" | "voiceProfiles">;

  beforeEach(() => {
    previousProjectId = useProjectStore.getState().activeProjectId;
    previousStoryboards = useStudioStore.getState().storyboards;
    const ttsState = useTtsStore.getState();
    previousTtsState = {
      activeProjectId: ttsState.activeProjectId,
      projects: ttsState.projects,
      voiceProfiles: ttsState.voiceProfiles,
    };
    useProjectStore.setState({ activeProjectId: "project-a" });
    mocks.build.mockReset();
    mocks.createJob.mockReset();
    delete window.remotionRuntime;
    delete window.remotionQueue;
    delete window.remotionChapterManifest;
  });

  afterEach(() => {
    useProjectStore.setState({ activeProjectId: previousProjectId });
    useStudioStore.setState({ storyboards: previousStoryboards });
    useTtsStore.setState(previousTtsState);
    delete window.remotionRuntime;
    delete window.remotionQueue;
    delete window.remotionChapterManifest;
  });

  it("fails closed when the project or first storyboard is missing", async () => {
    const missingProject = renderHook(() => useFirstShotPreviewActions({
      projectId: undefined,
      chapterId: "chapter-001",
      storyboards: [storyboard],
    }));
    await act(async () => { await missingProject.result.current.generateFirstShotPreview(); });
    expect(missingProject.result.current.error).toContain("请先选择项目");

    const missingShot = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [],
    }));
    await act(async () => { await missingShot.result.current.generateFirstShotPreview(); });
    expect(missingShot.result.current.error).toContain("没有可生成的首个分镜");
  });

  it("submits the real first storyboard with explicit landscape settings", async () => {
    const enqueueShot = vi.fn(async () => ({ accepted: true as const, job, reused: false as const }));
    window.remotionRuntime = {
      workspaceRuntime: vi.fn(async () => ({
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "b".repeat(64),
        defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      })),
    } as unknown as NonNullable<Window["remotionRuntime"]>;
    window.remotionQueue = { enqueueShot } as unknown as NonNullable<Window["remotionQueue"]>;
    mocks.build.mockResolvedValue({ success: true, sourceSnapshotHash: "d".repeat(64), plans: [plan] });
    mocks.createJob.mockResolvedValue(job);

    const view = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [storyboard],
    }));
    await act(async () => { await view.result.current.generateFirstShotPreview(); });

    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
      chapterId: "chapter-001",
      renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      storyboards: [storyboard],
      requireHumanApproval: true,
      continuityPolicy: "required",
    }));
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      plan,
      bundleContentHash: "b".repeat(64),
    }));
    expect(enqueueShot).toHaveBeenCalledWith({ job, plan });
    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.busy).toBe(false);
  });

  it("imports a valid absolute legacy voice and persists canonical shot audio before enqueue", async () => {
    const sourceSha = "e".repeat(64);
    const enqueueShot = vi.fn(async () => ({ accepted: true as const, job, reused: false as const }));
    const importAudio = vi.fn(async () => ({
      source: {
        kind: "local-import" as const,
        projectId: "project-a",
        relativePath: `remotion/audio/chapter-001/shots/${legacyStoryboard.id}/voice/${sourceSha}.wav`,
        contentSha256: sourceSha,
        provenance: { sourceKind: "imported" as const, sourceId: sourceSha, sourceVersion: `sha256:${sourceSha}` },
      },
      durationUs: 2_100_000,
      streams: ["audio"],
      sizeBytes: 1024,
    }));
    useStudioStore.setState({ storyboards: [legacyStoryboard] });
    useTtsStore.setState({
      activeProjectId: "project-a",
      projects: {
        "project-a": {
          voiceLines: {},
          bindings: { narrator: { speakerId: "narrator", profileId: voiceProfile.id } },
        },
      },
      voiceProfiles: { [voiceProfile.id]: voiceProfile },
    });
    window.remotionRuntime = {
      workspaceRuntime: vi.fn(async () => ({
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "b".repeat(64),
        defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      })),
    } as unknown as NonNullable<Window["remotionRuntime"]>;
    window.remotionQueue = { enqueueShot } as unknown as NonNullable<Window["remotionQueue"]>;
    window.remotionChapterManifest = {
      read: vi.fn(async () => ({ status: "missing" as const, projectId: "project-a", chapterId: "chapter-001" })),
      importAudio,
    } as unknown as NonNullable<Window["remotionChapterManifest"]>;
    mocks.build.mockImplementation(async (input) => {
      const normalized = input.storyboards[0];
      expect(normalized.audioRef).toEqual({
        kind: "audio",
        path: `project-file://project-a/remotion/audio/chapter-001/shots/${legacyStoryboard.id}/voice/${sourceSha}.wav`,
        contentSha256: sourceSha,
      });
      expect(normalized.shotAudioBindings).toHaveLength(1);
      expect(normalized.ttsJob).toEqual(expect.objectContaining({ status: "completed", shotRevision: 1 }));
      return { success: true, sourceSnapshotHash: "d".repeat(64), plans: [plan] };
    });
    mocks.createJob.mockResolvedValue(job);

    const view = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [legacyStoryboard],
    }));
    await act(async () => { await view.result.current.generateFirstShotPreview(); });

    expect(importAudio).toHaveBeenCalledWith({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: legacyStoryboard.id,
      role: "voice",
      sourcePath: legacyStoryboard.audioRef?.path,
    });
    const persisted = useStudioStore.getState().storyboards[0];
    expect(persisted.shotAudioBindings?.[0]).toEqual(expect.objectContaining({
      role: "voice",
      sourceFingerprint: sourceSha,
      ttsInputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(persisted.ttsJob).toEqual(expect.objectContaining({
      status: "completed",
      generationId: `legacy-import:${sourceSha}`,
    }));
    expect(persisted.ttsMocked).toBe(false);
    expect(enqueueShot).toHaveBeenCalledOnce();
  });

  it("surfaces plan and queue rejection without fallback", async () => {
    const enqueueShot = vi.fn(async () => ({ accepted: false as const, reason: "blocked" as const, message: "人工审核未完成" }));
    window.remotionRuntime = {
      workspaceRuntime: vi.fn(async () => ({
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "b".repeat(64),
        defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      })),
    } as unknown as NonNullable<Window["remotionRuntime"]>;
    window.remotionQueue = { enqueueShot } as unknown as NonNullable<Window["remotionQueue"]>;
    mocks.build.mockResolvedValue({
      success: false,
      sourceSnapshotHash: "d".repeat(64),
      plans: [],
      blockedShotIds: [storyboard.id],
      issues: [{ path: "shots.sb-chapter-001-001.visualReview", message: "人工审核未完成" }],
    });

    const view = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [storyboard],
    }));
    await act(async () => { await view.result.current.generateFirstShotPreview(); });
    expect(view.result.current.error).toContain("人工审核未完成");
    expect(enqueueShot).not.toHaveBeenCalled();

    mocks.build.mockResolvedValue({ success: true, sourceSnapshotHash: "d".repeat(64), plans: [plan] });
    mocks.createJob.mockResolvedValue(job);
    await act(async () => { await view.result.current.generateFirstShotPreview(); });
    expect(view.result.current.error).toContain("人工审核未完成");
  });

  it("fails closed for legacy audio when the import bridge is missing or canonical state is partial", async () => {
    window.remotionRuntime = {
      workspaceRuntime: vi.fn(async () => ({
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "b".repeat(64),
        defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      })),
    } as unknown as NonNullable<Window["remotionRuntime"]>;
    window.remotionQueue = { enqueueShot: vi.fn() } as unknown as NonNullable<Window["remotionQueue"]>;
    useStudioStore.setState({ storyboards: [legacyStoryboard] });

    const missingBridge = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [legacyStoryboard],
    }));
    await act(async () => { await missingBridge.result.current.generateFirstShotPreview(); });
    expect(missingBridge.result.current.error).toContain("音频导入 bridge 不可用");
    expect(mocks.build).not.toHaveBeenCalled();

    const partialStoryboard = {
      ...legacyStoryboard,
      ttsJob: {
        schemaVersion: 1 as const,
        projectId: "project-a",
        chapterId: "chapter-001",
        shotId: legacyStoryboard.id,
        shotRevision: 1,
        inputFingerprint: "f".repeat(64),
        status: "completed" as const,
        attempt: 1,
        generationId: "old-generation",
        createdAt: 1,
        updatedAt: 1,
      },
    };
    useStudioStore.setState({ storyboards: [partialStoryboard] });
    window.remotionChapterManifest = {
      importAudio: vi.fn(),
    } as unknown as NonNullable<Window["remotionChapterManifest"]>;
    const partial = renderHook(() => useFirstShotPreviewActions({
      projectId: "project-a",
      chapterId: "chapter-001",
      storyboards: [partialStoryboard],
    }));
    await act(async () => { await partial.result.current.generateFirstShotPreview(); });
    expect(partial.result.current.error).toContain("旧音频 canonical 状态不完整");
    expect(window.remotionChapterManifest.importAudio).not.toHaveBeenCalled();
  });

  it("stops an in-flight submission when the chapter changes", async () => {
    let resolveRuntime: ((value: {
      templateVersion: string;
      remotionVersion: string;
      bundleContentHash: string;
      defaultRenderSettings: typeof DEFAULT_REMOTION_RENDER_SETTINGS;
    }) => void) | undefined;
    window.remotionRuntime = {
      workspaceRuntime: vi.fn(() => new Promise((resolve) => { resolveRuntime = resolve; })),
    } as unknown as NonNullable<Window["remotionRuntime"]>;
    const enqueueShot = vi.fn();
    window.remotionQueue = { enqueueShot } as unknown as NonNullable<Window["remotionQueue"]>;
    const view = renderHook(
      ({ chapterId }) => useFirstShotPreviewActions({
        projectId: "project-a",
        chapterId,
        storyboards: [{ ...storyboard, episodeId: chapterId }],
      }),
      { initialProps: { chapterId: "chapter-001" } },
    );
    let pending: Promise<RemotionRenderJobV1 | undefined> | undefined;
    act(() => { pending = view.result.current.generateFirstShotPreview(); });
    view.rerender({ chapterId: "chapter-002" });
    await act(async () => {
      resolveRuntime?.({
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "b".repeat(64),
        defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
      });
      await pending;
    });

    expect(view.result.current.error).toContain("章节已切换");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(enqueueShot).not.toHaveBeenCalled();
  });
});
