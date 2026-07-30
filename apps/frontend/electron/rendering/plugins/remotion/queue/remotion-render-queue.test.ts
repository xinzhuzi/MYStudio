// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { buildRemotionCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { makeChapterManifest } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import {
  createReadyShotJob,
  RemotionRenderQueue,
  type RemotionQueueEventV1,
  type RemotionQueuePersistence,
  type RemotionQueueShotInput,
} from "./remotion-render-queue";

class MemoryPersistence implements RemotionQueuePersistence {
  snapshot: unknown;
  events: RemotionQueueEventV1[] = [];

  async load() { return { snapshot: this.snapshot, events: this.events }; }
  async append(event: RemotionQueueEventV1) { this.events.push(event); }
  async writeSnapshot(snapshot: unknown) { this.snapshot = snapshot; }
}

function makePlan(chapterId = "chapter-001", shotIndex = 0, projectId = "project-a"): Promise<RemotionShotPlanV1> {
  const chapter = makeChapterManifest();
  const sharedAudioTracks = chapter.sharedAudioTracks.map((track) => ({
    ...track,
    source: { ...track.source, projectId },
  }));
  const shot = {
    ...chapter.shots[0]!,
    shotId: `shot-${String(shotIndex + 1).padStart(3, "0")}`,
    index: shotIndex,
    visualSource: { ...chapter.shots[0]!.visualSource, projectId },
    audioBindings: chapter.shots[0]!.audioBindings.map((binding) => (
      binding.renderScope === "shot"
        ? { ...binding, source: { ...binding.source, projectId } }
        : binding
    )),
  };
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId,
    chapterId,
    renderSettings: chapter.renderSettings,
    visualKind: "image" as const,
    shot,
    sharedAudioTracks,
  };
  return sha256CanonicalJson(hashInput).then((inputHash) => ({
    schemaVersion: 1,
    target: "shot",
    projectId,
    chapterId,
    chapterRevision: chapter.revision,
    sourceSnapshotHash: chapter.sourceSnapshotHash,
    renderSettings: chapter.renderSettings,
    visualKind: "image",
    shot,
    sharedAudioTracks,
    inputHash,
  }));
}

async function makeInput(shotIndex = 0, projectId = "project-a"): Promise<RemotionQueueShotInput> {
  const plan = await makePlan("chapter-001", shotIndex, projectId);
  const job = await createReadyShotJob({
    plan,
    bundleContentHash: "d".repeat(64),
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    now: 100,
  });
  return { kind: "shot", job, plan };
}

function successSlot(job: RemotionRenderJobV1): RemotionCurrentSlotV1 {
  const succeeded: RemotionRenderJobV1 = {
    ...job,
    status: "succeeded",
    attempt: Math.max(1, job.attempt),
    progress: 1,
    startedAt: 110,
    completedAt: 120,
    outputPath: `outputs/shots/${job.target.kind === "shot" ? job.target.chapterId : "unknown"}/${job.target.kind === "shot" ? job.target.shotId : "unknown"}/current.mp4`,
    evidencePath: `evidence/shots/${job.target.kind === "shot" ? job.target.chapterId : "unknown"}/${job.target.kind === "shot" ? job.target.shotId : "unknown"}/current.json`,
  };
  return buildRemotionCurrentSlot(job.projectId, job.target, succeeded, {
    schemaVersion: 1,
    jobId: succeeded.jobId,
    projectId: succeeded.projectId,
    target: succeeded.target,
    inputHash: succeeded.inputHash,
    bundleContentHash: succeeded.bundleContentHash,
    renderSettingsHash: succeeded.renderSettingsHash,
    templateVersion: succeeded.templateVersion,
    remotionVersion: succeeded.remotionVersion,
    attempt: succeeded.attempt,
    compositionId: "StoryboardShot",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath: succeeded.outputPath!,
    sizeBytes: 100,
    mtimeMs: 120,
    sha256: "e".repeat(64),
    width: 1080,
    height: 1920,
    durationUs: 2_000_000,
    streams: [
      { kind: "video", codec: "h264", width: 1080, height: 1920 },
      { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
    ],
    inputManifestPath: `chapters/${succeeded.target.kind === "shot" ? succeeded.target.chapterId : "unknown"}.json`,
    startedAt: 110,
    completedAt: 120,
  }, 120);
}

function successChapterSlot(job: RemotionRenderJobV1): RemotionCurrentSlotV1 {
  if (job.target.kind !== "chapter") throw new Error("chapter fixture target required");
  const succeeded: RemotionRenderJobV1 = {
    ...job,
    status: "succeeded",
    attempt: Math.max(1, job.attempt),
    progress: 1,
    startedAt: 110,
    completedAt: 120,
    outputPath: `outputs/chapters/${job.target.chapterId}/current.mp4`,
    evidencePath: `evidence/chapters/${job.target.chapterId}/current.json`,
  };
  return buildRemotionCurrentSlot(job.projectId, job.target, succeeded, {
    schemaVersion: 1,
    jobId: succeeded.jobId,
    projectId: succeeded.projectId,
    target: succeeded.target,
    inputHash: succeeded.inputHash,
    bundleContentHash: succeeded.bundleContentHash,
    renderSettingsHash: succeeded.renderSettingsHash,
    templateVersion: succeeded.templateVersion,
    remotionVersion: succeeded.remotionVersion,
    attempt: succeeded.attempt,
    compositionId: "ChapterVideo",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath: succeeded.outputPath!,
    sizeBytes: 100,
    mtimeMs: 120,
    sha256: "c".repeat(64),
    width: 1080,
    height: 1920,
    durationUs: 4_000_000,
    streams: [
      { kind: "video", codec: "h264", width: 1080, height: 1920 },
      { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
    ],
    inputManifestPath: `chapters/${job.target.chapterId}.json`,
    renderPlanPath: `jobs/chapter/${job.target.chapterId}/current-render-plan.json`,
    snapshotPath: `jobs/chapter/${job.target.chapterId}/current-editing-project.json`,
    startedAt: 110,
    completedAt: 120,
  }, 120);
}

describe("RemotionRenderQueue", () => {
  it("runs one shot at a time, persists transitions, and accepts a verified current slot", async () => {
    const persistence = new MemoryPersistence();
    const inputs = await Promise.all([makeInput(0), makeInput(1)]);
    const running: string[] = [];
    let maxRunning = 0;
    const queue = new RemotionRenderQueue({
      persistence,
      now: () => 200,
      executor: {
        async render(plan) {
          running.push(plan.shot.shotId);
          maxRunning = Math.max(maxRunning, running.length);
          await new Promise((resolve) => setTimeout(resolve, 2));
          running.pop();
          const job = queue.getJobs({ projectId: plan.projectId, chapterId: plan.chapterId }).find((candidate) => candidate.target.kind === "shot" && candidate.target.shotId === plan.shot.shotId)!;
          return { success: true, slot: successSlot(job) };
        },
        cancel: (jobId) => ({ success: true, jobId, canceled: true }),
      },
    });
    await queue.enqueueShot(inputs[0]!);
    await queue.enqueueShot(inputs[1]!);
    await queue.waitForIdle();
    expect(maxRunning).toBe(1);
    expect(queue.getJobs({ projectId: "project-a", chapterId: "chapter-001" }).every((job) => job.status === "succeeded")).toBe(true);
    expect(persistence.events.length).toBeGreaterThanOrEqual(6);
    expect(persistence.snapshot).toBeDefined();
  });

  it("rejects duplicate active identity and resumes a failed job with a new attempt", async () => {
    const persistence = new MemoryPersistence();
    const input = await makeInput();
    let renderCount = 0;
    const queue = new RemotionRenderQueue({
      persistence,
      executor: {
        async render() {
          renderCount += 1;
          return { success: false, jobId: input.job.jobId, canceled: false, error: "fixture failed" };
        },
        cancel: (jobId) => ({ success: true, jobId, canceled: true }),
      },
    });
    const first = await queue.enqueueShot(input);
    expect(first.accepted).toBe(true);
    const duplicate = await queue.enqueueShot(input);
    expect(duplicate).toMatchObject({ accepted: false, reason: "duplicate-active" });
    await queue.waitForIdle();
    expect(queue.getJob(input.job.jobId)?.status).toBe("failed");
    const retry = await queue.retry(input.job.jobId);
    expect(retry).toMatchObject({ accepted: true });
    await queue.waitForIdle();
    expect(renderCount).toBe(2);
    expect(queue.getJob(input.job.jobId)?.attempt).toBe(2);
  });

  it("keeps chapter blocked when one shot fails while independent shots finish", async () => {
    const persistence = new MemoryPersistence();
    const first = await makeInput(0);
    const second = await makeInput(1);
    const queue = new RemotionRenderQueue({
      persistence,
      executor: {
        async render(plan) {
          if (plan.shot.shotId === first.plan.shot.shotId) return { success: false, jobId: first.job.jobId, canceled: false, error: "bad shot" };
          const job = queue.getJob(second.job.jobId)!;
          return { success: true, slot: successSlot(job) };
        },
        cancel: (jobId) => ({ success: true, jobId, canceled: true }),
      },
    });
    await queue.enqueueShot(first);
    await queue.enqueueShot(second);
    await queue.waitForIdle();
    const chapterIdentity = {
      projectId: first.plan.projectId,
      target: { kind: "chapter" as const, chapterId: first.plan.chapterId, editingProjectId: "editing-001", editingRevision: 1 },
      inputHash: "f".repeat(64),
      bundleContentHash: "d".repeat(64),
      renderSettingsHash: await sha256CanonicalJson(first.plan.renderSettings),
    };
    const chapter = {
      schemaVersion: 1 as const,
      jobId: await createRemotionRenderJobId(chapterIdentity),
      ...chapterIdentity,
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      status: "pending" as const,
      attempt: 0,
      progress: 0,
      createdAt: 100,
    };
    const result = await queue.enqueueChapter({ kind: "chapter", job: chapter, dependencyJobIds: [first.job.jobId, second.job.jobId] });
    expect(result).toMatchObject({ accepted: true, job: { status: "blocked" } });
    expect(queue.getJob(first.job.jobId)?.status).toBe("failed");
    expect(queue.getJob(second.job.jobId)?.status).toBe("succeeded");
  });

  it("executes ChapterVideo only after all shot dependencies succeed", async () => {
    const persistence = new MemoryPersistence();
    const first = await makeInput(0);
    const second = await makeInput(1);
    let chapterRenders = 0;
    const queue = new RemotionRenderQueue({
      persistence,
      now: () => 200,
      executor: {
        async render(plan) {
          const input = plan.shot.shotId === first.plan.shot.shotId ? first : second;
          const job = queue.getJob(input.job.jobId)!;
          return { success: true, slot: successSlot(job) };
        },
        async renderChapter(input) {
          chapterRenders += 1;
          const job = queue.getJobs({ projectId: input.plan.projectId, chapterId: input.plan.episodeId })
            .find((candidate) => candidate.target.kind === "chapter");
          if (!job) throw new Error("chapter job fixture missing");
          return { success: true, slot: successChapterSlot(job) };
        },
        cancel: (jobId) => ({ success: true, jobId, canceled: true }),
      },
    });
    await queue.enqueueShot(first);
    await queue.enqueueShot(second);
    await queue.waitForIdle();
    const chapterIdentity = {
      projectId: first.plan.projectId,
      target: { kind: "chapter" as const, chapterId: first.plan.chapterId, editingProjectId: "editing-001", editingRevision: 1 },
      inputHash: "f".repeat(64),
      bundleContentHash: "d".repeat(64),
      renderSettingsHash: await sha256CanonicalJson(first.plan.renderSettings),
    };
    const chapter = {
      schemaVersion: 1 as const,
      jobId: await createRemotionRenderJobId(chapterIdentity),
      ...chapterIdentity,
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      status: "pending" as const,
      attempt: 0,
      progress: 0,
      createdAt: 100,
    };
    const shotSlots = [successSlot(queue.getJob(first.job.jobId)!), successSlot(queue.getJob(second.job.jobId)!)];
    const chapterPlan = { projectId: first.plan.projectId, episodeId: first.plan.chapterId } as TimelineRenderPlan;
    const result = await queue.enqueueChapter({
      kind: "chapter",
      job: chapter,
      dependencyJobIds: [first.job.jobId, second.job.jobId],
      plan: chapterPlan,
      currentShotSlots: shotSlots,
      chapterAudioClipIds: [],
    });
    expect(result).toMatchObject({ accepted: true, job: { status: "ready" } });
    await queue.waitForIdle();
    expect(chapterRenders).toBe(1);
    expect(queue.getJob(chapter.jobId)?.status).toBe("succeeded");
  });

  it("recovers running jobs as failed and blocks project switch until queue cleanup", async () => {
    const persistence = new MemoryPersistence();
    const input = await makeInput();
    const running = { ...input, job: { ...input.job, status: "running" as const, attempt: 1, startedAt: 110 } };
    persistence.snapshot = { schemaVersion: 1, lastSeq: 1, activeProjectId: "project-a", activeChapterId: "chapter-001", jobs: [running], updatedAt: 110 };
    const queue = new RemotionRenderQueue({
      persistence,
      executor: { render: async () => { throw new Error("must not auto-render recovery"); }, cancel: (jobId) => ({ success: true, jobId, canceled: true }) },
    });
    await queue.init();
    expect(queue.getJob(input.job.jobId)).toMatchObject({ status: "failed", error: { code: "app-restart-recovery" } });
    expect(queue.requestProjectSwitch("project-b")).toMatchObject({ allowed: true });
    await queue.retry(input.job.jobId);
    expect(queue.requestProjectSwitch("project-b")).toMatchObject({ allowed: false, code: "queued-jobs" });
  });

  it("does not allow a second project to claim the active scheduler", async () => {
    const persistence = new MemoryPersistence();
    const input = await makeInput();
    const queue = new RemotionRenderQueue({
      persistence,
      executor: { render: async () => ({ success: false, jobId: input.job.jobId, canceled: false, error: "stop" }), cancel: (jobId) => ({ success: true, jobId, canceled: true }) },
    });
    await queue.enqueueShot(input);
    const other = await makeInput(0, "project-b");
    const result = await queue.enqueueShot(other);
    expect(result).toMatchObject({ accepted: false, reason: "blocked" });
  });

  it("rejects chapter dependencies that are missing instead of treating them as failed shots", async () => {
    const persistence = new MemoryPersistence();
    const input = await makeInput();
    const queue = new RemotionRenderQueue({
      persistence,
      executor: {
        render: async () => ({ success: false, jobId: input.job.jobId, canceled: false, error: "fixture stop" }),
        cancel: (jobId) => ({ success: true, jobId, canceled: true }),
      },
    });
    await queue.enqueueShot(input);
    await queue.waitForIdle();
    const chapterIdentity = {
      projectId: input.plan.projectId,
      target: { kind: "chapter" as const, chapterId: input.plan.chapterId, editingProjectId: "editing-001", editingRevision: 1 },
      inputHash: "f".repeat(64),
      bundleContentHash: "d".repeat(64),
      renderSettingsHash: await sha256CanonicalJson(input.plan.renderSettings),
    };
    const chapter: RemotionRenderJobV1 = {
      schemaVersion: 1,
      jobId: await createRemotionRenderJobId(chapterIdentity),
      ...chapterIdentity,
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      status: "pending",
      attempt: 0,
      progress: 0,
      createdAt: 100,
    };
    const result = await queue.enqueueChapter({
      kind: "chapter",
      job: chapter,
      dependencyJobIds: ["missing-shot-job"],
    });
    expect(result).toMatchObject({ accepted: false, reason: "invalid" });
    if (!result.accepted && result.reason === "invalid") expect(result.message).toContain("不存在");
  });
});
