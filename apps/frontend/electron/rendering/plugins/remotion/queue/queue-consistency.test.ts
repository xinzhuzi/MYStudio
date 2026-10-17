// @vitest-environment node
import { expect, it, vi } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { makeChapterManifestV2, makeShotAudioBindingV2 } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { createReadyShotJob } from "@/lib/studio/remotion/remotion-job-factory";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { RemotionRenderQueue, type RemotionQueueEventV1, type RemotionQueueShotInput } from "./remotion-render-queue";
async function makePlan(chapterId = "chapter-001", shotIndex = 0, projectId = "project-a"): Promise<RemotionShotPlanV1> {
  const chapter = await makeChapterManifestV2();
  const shotId = `shot-${String(shotIndex + 1).padStart(3, "0")}`;
  const voice = await makeShotAudioBindingV2({ projectId, chapterId, shotId });
  const shot = {
    ...chapter.shots[0]!,
    shotId,
    index: shotIndex,
    visualSource: { ...chapter.shots[0]!.visualSource, projectId },
    audioBindings: [voice],
  };
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId,
    chapterId,
    renderSettings: chapter.renderSettings,
    visualKind: "image" as const,
    shot,
  };
  return {
    schemaVersion: 1,
    target: "shot",
    projectId,
    chapterId,
    chapterRevision: chapter.revision,
    sourceSnapshotHash: chapter.sourceSnapshotHash,
    renderSettings: chapter.renderSettings,
    visualKind: "image",
    shot,
    inputHash: await sha256CanonicalJson(hashInput),
  };
}

async function makeInput(shotIndex = 0, projectId = "project-a"): Promise<RemotionQueueShotInput> {
  const plan = await makePlan("chapter-001", shotIndex, projectId);
  const job = await createReadyShotJob({
    plan,
    bundleContentHash: "d".repeat(64),
    templateVersion: "1.0.0",
    remotionVersion: "4.0.534",
    now: 100,
  });
  return { kind: "shot", job, plan };
}


const executor = { render: vi.fn(async () => ({ success: false as const, jobId: "unused", canceled: false, error: "fixture" })), cancel: vi.fn((jobId: string) => ({ success: false, jobId, canceled: false, error: "not running" })) };
function memory() {
 const events: RemotionQueueEventV1[] = [];
 return { events, snapshot: undefined as unknown, load: vi.fn(async () => ({ snapshot: undefined as unknown, events: [] as unknown[] })), append: vi.fn(async (event: RemotionQueueEventV1) => { await new Promise(resolve => setTimeout(resolve, 1)); events.push(event); }), writeSnapshot: vi.fn(async (_value: unknown) => {}) };
}
it('serializes 50 public enqueues with single-flight init and restores every journal job', async () => {
 const inputs = await Promise.all(Array.from({ length: 50 }, (_, i) => makeInput(i)));
 for (const input of inputs) input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
 const persistence = memory();
 const queue = new RemotionRenderQueue({ persistence, executor, concurrency: 3 });
 await Promise.all(inputs.map(input => queue.enqueueShot(input)));
 expect(persistence.load).toHaveBeenCalledTimes(1);
 expect(persistence.events.map(event => event.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
 persistence.load.mockImplementation(async () => ({ snapshot: undefined, events: persistence.events }));
 const restored = new RemotionRenderQueue({ persistence, executor });
 await restored.init();
 expect(restored.getJobs({ projectId: 'project-a' })).toHaveLength(50);
});
it('rejects conflicting historical sequence even when a snapshot covers it, without writing', async () => {
 const input = await makeInput();
 input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
 const persistence = memory();
 const seed = new RemotionRenderQueue({ persistence, executor });
 await seed.enqueueShot(input);
 const event = persistence.events[0]!;
 persistence.load.mockImplementation(async () => ({ snapshot: { schemaVersion: 1, lastSeq: 1, jobs: [input], updatedAt: 100 }, events: [event, { ...event, at: event.at + 1 }] }));
 const queue = new RemotionRenderQueue({ persistence, executor });
 const before = persistence.append.mock.calls.length;
 await expect(queue.init()).rejects.toThrow(/冲突|序列/);
 expect(queue.getJobs({ projectId: 'project-a' })).toHaveLength(0);
 await expect(queue.enqueueShot(input)).rejects.toThrow();
 expect(persistence.append).toHaveBeenCalledTimes(before);
});
it('cancels blocked jobs durably and never delegates them to an absent executor', async () => {
 const input = await makeInput();
 input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
 const persistence = memory();
 const queue = new RemotionRenderQueue({ persistence, executor });
 await queue.enqueueShot(input);
 const result = await queue.cancel(input.job.jobId);
 expect(result.success).toBe(true);
 expect(queue.getJob(input.job.jobId)?.status).toBe('canceled');
 expect(persistence.events.at(-1)?.item.job.status).toBe('canceled');
});
it('append failure rejects, leaves memory unchanged and permits a later retry', async () => {
 const input = await makeInput();
 input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
 const persistence = memory(); persistence.append.mockRejectedValueOnce(new Error('disk full'));
 const queue = new RemotionRenderQueue({ persistence, executor });
 await expect(queue.enqueueShot(input)).rejects.toThrow('disk full');
 expect(queue.getJob(input.job.jobId)).toBeUndefined();
 await expect(queue.enqueueShot(input)).resolves.toMatchObject({ accepted: true });
 expect(persistence.events[0]?.seq).toBe(1);
});
it('snapshot failure preserves committed journal state and reports the failure', async () => {
 const input = await makeInput();
 input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
 const persistence = memory(); persistence.writeSnapshot.mockRejectedValueOnce(new Error('snapshot full'));
 const queue = new RemotionRenderQueue({ persistence, executor });
 await expect(queue.enqueueShot(input)).resolves.toMatchObject({ accepted: true });
 expect(queue.getJob(input.job.jobId)?.status).toBe('blocked');
 expect(queue.getPersistenceError()).toContain('snapshot full');
 await queue.cancel(input.job.jobId);
 expect(queue.getPersistenceError()).toBeUndefined();
});

it('cancels a reserved ready job before executor dispatch even when append is pending', async () => {
  const input = await makeInput();
  const persistence = memory();
  const dispatch = vi.fn(async () => ({ success: false as const, jobId: input.job.jobId, canceled: false, error: 'unexpected dispatch' }));
  let release!: () => void;
  let queued!: () => void;
  const reached = new Promise<void>(resolve => { queued = resolve; });
  persistence.append.mockImplementation(async event => {
    if (event.item.job.status === 'queued') { queued(); await new Promise<void>(resolve => { release = resolve; }); }
    persistence.events.push(event);
  });
  const queue = new RemotionRenderQueue({ persistence, executor: { ...executor, render: dispatch } });
  await queue.enqueueShot(input);
  await reached;
  const cancellation = queue.cancel(input.job.jobId);
  release();
  expect((await cancellation).success).toBe(true);
  await queue.waitForIdle();
  expect(dispatch).not.toHaveBeenCalled();
  expect(queue.getJob(input.job.jobId)?.status).toBe('canceled');
});
it('does not report cancellation success if its journal append fails', async () => {
  const input = await makeInput();
  input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
  const persistence = memory();
  const queue = new RemotionRenderQueue({ persistence, executor });
  await queue.enqueueShot(input);
  persistence.append.mockRejectedValueOnce(new Error('cancel disk full'));
  expect(await queue.cancel(input.job.jobId)).toMatchObject({ success: false, error: 'cancel disk full' });
  expect(queue.getJob(input.job.jobId)?.status).toBe('blocked');
  expect((await queue.cancel(input.job.jobId)).success).toBe(true);
});
it('isolates listener errors from already committed jobs', async () => {
  const input = await makeInput();
  input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
  const persistence = memory();
  const queue = new RemotionRenderQueue({ persistence, executor });
  const received = vi.fn();
  queue.subscribe(() => { throw new Error('listener fixture'); });
  queue.subscribe(received);
  await expect(queue.enqueueShot(input)).resolves.toMatchObject({ accepted: true });
  expect(received).toHaveBeenCalledOnce();
  expect(queue.getJob(input.job.jobId)?.status).toBe('blocked');
});

it('accepts an identical concurrent enqueue only once', async () => {
  const input = await makeInput();
  input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
  const persistence = memory();
  const queue = new RemotionRenderQueue({ persistence, executor });
  const replies = await Promise.all(Array.from({ length: 10 }, () => queue.enqueueShot(input)));
  expect(replies.filter(reply => reply.accepted)).toHaveLength(1);
  expect(persistence.events).toHaveLength(1);
  expect(queue.getJobs({ projectId: 'project-a' })).toHaveLength(1);
});

it('replays real files after a stale snapshot and preserves conflicting history byte for byte', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createRemotionQueueFilePersistence } = await import('./remotion-queue-utils');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remotion-gap-replay-'));
  const disk = createRemotionQueueFilePersistence({ stateRoot: root, eventsRoot: root });
  let snapshots = 0;
  const persistence = { ...disk, writeSnapshot: async (snapshot: Parameters<typeof disk.writeSnapshot>[0]) => {
    if (++snapshots === 1) await disk.writeSnapshot(snapshot);
  } };
  const queue = new RemotionRenderQueue({ persistence, executor });
  const inputs = await Promise.all([makeInput(0), makeInput(1)]);
  for (const input of inputs) {
    input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
    await queue.enqueueShot(input);
  }
  const snapshotPath = path.join(root, 'queue-state.json');
  const eventPath = path.join(root, 'queue-events.jsonl');
  const snapshot = await fs.readFile(snapshotPath, 'utf8');
  expect(JSON.parse(snapshot).lastSeq).toBe(1);
  const restored = new RemotionRenderQueue({ persistence: disk, executor });
  await restored.init();
  expect(restored.getJobs({ projectId: 'project-a' })).toHaveLength(2);
  const journal = await fs.readFile(eventPath, 'utf8');
  const last = JSON.parse(journal.trim().split('\n').at(-1)!);
  const conflicted = `${journal}${JSON.stringify({ ...last, at: last.at + 1 })}\n`;
  await fs.writeFile(eventPath, conflicted);
  const invalidQueue = new RemotionRenderQueue({ persistence: disk, executor });
  await expect(invalidQueue.init()).rejects.toThrow('全局');
  expect(await fs.readFile(eventPath, 'utf8')).toBe(conflicted);
  expect(await fs.readFile(snapshotPath, 'utf8')).toBe(snapshot);
});

it('suspends dispatch after journal failure and resumes only after cancellation and explicit retry', async () => {
  const input = await makeInput();
  const persistence = memory();
  let writable = false;
  persistence.append.mockImplementation(async event => {
    if (persistence.events.length && !writable) throw new Error('disk full');
    persistence.events.push(event);
  });
  const render = vi.fn(async () => ({ success: false as const, jobId: input.job.jobId, canceled: false, error: 'fixture' }));
  const queue = new RemotionRenderQueue({ persistence, executor: { ...executor, render } });
  await queue.enqueueShot(input);
  await queue.waitForIdle();
  expect(render).not.toHaveBeenCalled();
  expect(persistence.append.mock.calls.length).toBeLessThanOrEqual(3);
  expect(queue.getPersistenceError()).toContain('暂停');
  writable = true;
  await expect(queue.cancel(input.job.jobId)).resolves.toMatchObject({ success: true, canceled: true });
  expect(render).not.toHaveBeenCalled();
  await queue.retry(input.job.jobId);
  await queue.waitForIdle();
  expect(render).toHaveBeenCalledOnce();
});

it('rejects snapshot-ahead and missing journal sequences while allowing identical duplicates', async () => {
  const input = await makeInput();
  input.job = { ...input.job, status: 'blocked', error: { code: 'gate', stage: 'S4', message: 'gate' } };
  const persistence = memory();
  await new RemotionRenderQueue({ persistence, executor }).enqueueShot(input);
  const event = persistence.events[0]!;
  persistence.load.mockResolvedValue({ snapshot: { schemaVersion: 1, lastSeq: 2, jobs: [input], updatedAt: 100 }, events: [event] });
  await expect(new RemotionRenderQueue({ persistence, executor }).init()).rejects.toThrow('领先');
  persistence.load.mockResolvedValue({ snapshot: undefined, events: [event, { ...event, seq: 3 }] });
  await expect(new RemotionRenderQueue({ persistence, executor }).init()).rejects.toThrow('不连续');
  persistence.load.mockResolvedValue({ snapshot: undefined, events: [event, JSON.parse(JSON.stringify(event))] });
  const restored = new RemotionRenderQueue({ persistence, executor });
  await restored.init();
  expect(restored.getJobs({ projectId: 'project-a' })).toHaveLength(1);
});
