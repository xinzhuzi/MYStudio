from pathlib import Path
base=Path('apps/frontend/electron/rendering/plugins/remotion/queue')
s=(base/'remotion-render-queue.test.ts').read_text()
a=s.index('async function makePlan(');b=s.index('async function withCinematicInput(',a)
prefix='''// @vitest-environment node
import { expect, it, vi } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { makeChapterManifestV2, makeShotAudioBindingV2 } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { createReadyShotJob } from "@/lib/studio/remotion/remotion-job-factory";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { RemotionRenderQueue, type RemotionQueueEventV1, type RemotionQueueShotInput } from "./remotion-render-queue";
'''+s[a:b]
tests='''
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
'''
(base/'queue-consistency.test.ts').write_text(prefix+tests)
