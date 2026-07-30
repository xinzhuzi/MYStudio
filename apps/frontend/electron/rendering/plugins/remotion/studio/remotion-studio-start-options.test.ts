import { describe, expect, it, vi } from "vitest";
import type { RenderJobWithCleanup } from "@remotion/studio-shared";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import {
  RemotionStudioRenderQueueBridge,
  type RemotionStudioChapterRenderContext,
} from "./remotion-studio-start-options";

function nativeJob(id: string, compositionId = "ChapterVideo"): RenderJobWithCleanup {
  return {
    id,
    compositionId,
    status: "idle",
  } as unknown as RenderJobWithCleanup;
}

function remotionJob(status: RemotionRenderJobV1["status"], progress = 0): RemotionRenderJobV1 {
  return {
    status,
    progress,
    jobId: "chapter-job-1",
  } as RemotionRenderJobV1;
}

function context(): RemotionStudioChapterRenderContext {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    revision: 1,
    plan: {} as RemotionStudioChapterRenderContext["plan"],
    currentShotSlots: [],
    chapterAudioClipIds: [],
  };
}

function createBridge(overrides: Partial<ConstructorParameters<typeof RemotionStudioRenderQueueBridge>[0]> = {}) {
  let currentJob: RemotionRenderJobV1 | undefined;
  const enqueueChapter = vi.fn(async () => ({
    accepted: true,
    job: currentJob ?? remotionJob("queued"),
  }));
  const options = {
    getContext: () => context(),
    enqueueChapter,
    getJob: () => currentJob,
    cancelJob: () => ({ success: true, canceled: true }),
    ...overrides,
  };
  const bridge = new RemotionStudioRenderQueueBridge(options);
  return { bridge, enqueueChapter: options.enqueueChapter, setJob: (job: RemotionRenderJobV1) => { currentJob = job; } };
}

describe("RemotionStudioRenderQueueBridge", () => {
  it("rejects non-ChapterVideo compositions before durable enqueue", () => {
    const { bridge, enqueueChapter } = createBridge();
    const job = nativeJob("still-1", "StoryboardShot");

    bridge.queueMethods.addJob({ job, entryPoint: "/tmp/entry.tsx", remotionRoot: "/tmp", logLevel: "error" });

    expect(job.status).toBe("failed");
    expect(enqueueChapter).not.toHaveBeenCalled();
  });

  it("fails closed without an active chapter Studio context", () => {
    const { bridge, enqueueChapter } = createBridge({ getContext: () => undefined });
    const job = nativeJob("chapter-1");

    bridge.queueMethods.addJob({ job, entryPoint: "/tmp/entry.tsx", remotionRoot: "/tmp", logLevel: "error" });

    expect(job.status).toBe("failed");
    expect(enqueueChapter).not.toHaveBeenCalled();
  });

  it("allows one active native ChapterVideo job at a time", () => {
    let resolve: ((value: { accepted: true; job: RemotionRenderJobV1 }) => void) | undefined;
    const { bridge, enqueueChapter } = createBridge({
      enqueueChapter: vi.fn(() => new Promise((res) => { resolve = res; })),
    });
    const first = nativeJob("chapter-1");
    const second = nativeJob("chapter-2");

    bridge.queueMethods.addJob({ job: first, entryPoint: "/tmp/entry.tsx", remotionRoot: "/tmp", logLevel: "error" });
    bridge.queueMethods.addJob({ job: second, entryPoint: "/tmp/entry.tsx", remotionRoot: "/tmp", logLevel: "error" });

    expect(enqueueChapter).toHaveBeenCalledTimes(1);
    expect(second.status).toBe("failed");
    resolve?.({ accepted: true, job: remotionJob("queued") });
  });

  it("maps accepted native jobs to durable status and cancellation", async () => {
    const cancelJob = vi.fn(() => ({ success: true, canceled: true }));
    const queued = remotionJob("queued", 0.25);
    const { bridge, enqueueChapter, setJob } = createBridge({
      cancelJob,
      enqueueChapter: vi.fn(async () => ({ accepted: true, job: queued })),
    });
    const native = nativeJob("chapter-1");

    bridge.queueMethods.addJob({ job: native, entryPoint: "/tmp/entry.tsx", remotionRoot: "/tmp", logLevel: "error" });
    await vi.waitFor(() => expect(enqueueChapter).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(bridge.getRenderQueue()[0]?.status).toBe("running"));
    const running = bridge.getRenderQueue()[0];
    expect(running && "progress" in running ? running.progress.value : undefined).toBe(0.25);

    bridge.queueMethods.cancelJob(native.id);
    expect(cancelJob).toHaveBeenCalledWith("chapter-job-1");

    setJob(remotionJob("succeeded", 1));
    expect(bridge.getRenderQueue()[0]?.status).toBe("done");
    bridge.queueMethods.removeJob(native.id);
    expect(bridge.getRenderQueue()).toHaveLength(0);
  });
});
