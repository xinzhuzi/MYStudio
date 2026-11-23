// @vitest-environment node
import { expect, it } from 'vitest';
import { runtimeWindow, rootRuntimeWindow, type WindowIO } from './director_chapter001_runtime_window_1027';
function fixture(mismatch = false, busy = false) {
  const calls: string[] = [];
  const io: WindowIO = {
    async get(route) {
      calls.push(route);
      if (route === 'queue') return { queue_running: busy ? [1] : [], queue_pending: [] };
      if (route === 'identity') return { healthy: true, sidecarTokenMatch: true, engineTokenMatch: !mismatch, statusRunning: !mismatch, port: 17001 };
      if (route === 'job/abcdef123456') { mismatch = false; return { id: 'abcdef123456', kind: 'engine-start', status: 'complete', result: { port: 17001 } }; }
      throw new Error('unexpected route');
    },
    async prepare() { calls.push('prepare'); },
    async start() { calls.push('start'); return { jobId: 'abcdef123456' }; },
    async pause() {},
  };
  return { io, calls };
}
it('reuses a healthy matching engine without start', async () => {
  const f = fixture(); const result = await runtimeWindow(f.io);
  expect(result.startPosts).toBe(0); expect(f.calls).not.toContain('start');
  expect(f.calls.indexOf('queue')).toBeLessThan(f.calls.indexOf('prepare'));
});
it('sends one start and waits for its exact terminal job on mismatch', async () => {
  const f = fixture(true); const result = await runtimeWindow(f.io);
  expect(result.startPosts).toBe(1); expect(f.calls.filter(x => x === 'start')).toHaveLength(1);
  expect(f.calls).toContain('job/abcdef123456');
});
it('rejects a busy live queue before lifecycle', async () => {
  const f = fixture(false, true); await expect(runtimeWindow(f.io)).rejects.toThrow('queue');
  expect(f.calls).not.toContain('prepare');
});
it('does not start after an unreadable queue', async () => {
  const f = fixture(); f.io.get = async () => { throw new Error('queue unavailable'); };
  await expect(runtimeWindow(f.io)).rejects.toThrow('queue unavailable'); expect(f.calls).toEqual([]);
});

it.skipIf(process.env.DIRECTOR_CHAPTER001_RUNTIME_WINDOW !== 'root-one-normal-restart')('root explicit normal runtime window', rootRuntimeWindow, 210_000);
it('refuses unavailable identity without preparing', async () => {
  const f = fixture(); const original = f.io.get;
  f.io.get = async route => route === 'identity' ? { healthy: false } : original(route);
  await expect(runtimeWindow(f.io)).rejects.toThrow('identity'); expect(f.calls).not.toContain('prepare');
});
it('leaves failed start terminal without a second POST', async () => {
  const f = fixture(true); const original = f.io.get;
  f.io.get = async route => route.startsWith('job/') ? { id: 'abcdef123456', kind: 'engine-start', status: 'error' } : original(route);
  await expect(runtimeWindow(f.io)).rejects.toThrow('no retry'); expect(f.calls.filter(x => x === 'start')).toHaveLength(1);
});
it('propagates bounded polling timeout without another start', async () => {
  const f = fixture(true); const original = f.io.get;
  f.io.get = async route => route.startsWith('job/') ? { id: 'abcdef123456', kind: 'engine-start', status: 'running' } : original(route);
  f.io.pause = async () => { throw new Error('deadline'); };
  await expect(runtimeWindow(f.io)).rejects.toThrow('deadline'); expect(f.calls.filter(x => x === 'start')).toHaveLength(1);
});
