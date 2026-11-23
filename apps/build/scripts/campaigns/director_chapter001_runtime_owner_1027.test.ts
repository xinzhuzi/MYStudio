// @vitest-environment node
/** Offline contract probes, NOT a live launcher. All external effects are replaced. */
import type { ChildProcess, spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageGenRuntimeController } from '@/electron/rendering/plugins/image_gen/image-gen-runtime-controller';

const probe = vi.hoisted(() => ({
  holders: true,
  execFile: vi.fn(),
  spawn: vi.fn(() => { throw new Error('real spawn forbidden in offline probe'); }),
  readFileSync: vi.fn(() => JSON.stringify({ activeModel: 'comfyui-bridge', controlToken: 'offline-fixture' })),
  mutation: vi.fn(() => { throw new Error('filesystem mutation forbidden in offline probe'); }),
}));
vi.mock('node:fs', () => ({ default: {
  existsSync: () => true,
  readFileSync: probe.readFileSync,
  mkdirSync: probe.mutation, writeFileSync: probe.mutation, renameSync: probe.mutation,
} }));
vi.mock('node:child_process', () => ({ spawn: probe.spawn, execFile: probe.execFile }));
vi.mock('node:net', () => ({ default: { createServer: () => ({
  unref() {}, once() {},
  listen(_port: number, _host: string, done: () => void) { done(); },
  address: () => ({ port: 17999 }),
  close(done: () => void) { done(); },
}) } }));
vi.mock('@rendering/plugins/video-workflow/video-workflow-runtime', () => ({
  resolveVideoWorkflowRuntimePaths: () => ({
    storageBasePath: '/offline-runtime', pythonRuntimeDir: '/offline-runtime/python',
    pythonExecutable: '/offline-runtime/python/bin/python3',
  }),
}));
vi.mock('@/electron/diagnostics/sidecar-log-capture', () => ({ captureSidecarOutput: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  probe.holders = true;
  probe.execFile.mockImplementation((command: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (error: Error | null, result?: { stdout: string }) => void;
    if (command === 'lsof') callback(null, { stdout: probe.holders ? '424242' : '' });
    else if (command === 'ps') callback(null, { stdout: 'offline python -m image_gen.main' });
    else callback(new Error('unexpected subprocess in offline probe'));
  });
  vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
    if (signal === 'SIGTERM') probe.holders = false;
    return true;
  }) as typeof process.kill);
});
afterEach(() => {
  expect(probe.spawn).not.toHaveBeenCalled();
  expect(probe.mutation).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeProbeController(mode: 'success' | 'early-exit' | 'uncertain-single-spawn') {
  const children: { exitCode: number | null; kill: ReturnType<typeof vi.fn> }[] = [];
  const spawnProcess = vi.fn((..._args: Parameters<typeof spawn>) => {
    if (mode === 'uncertain-single-spawn' && children.length) throw new Error('second spawn refused');
    const child = {
      pid: 424242 + children.length,
      exitCode: mode === 'early-exit' && children.length === 0 ? 1 : null,
      on: vi.fn(), kill: vi.fn(), unref: vi.fn(), stdout: null, stderr: null,
    };
    children.push(child);
    return child as unknown as ChildProcess;
  });
  const requests = vi.fn(async (url: string) => {
    // No actual socket: only the controller's fixed health endpoint is accepted.
    expect(url).toBe('http://127.0.0.1:17595/health');
    const healthy = mode !== 'uncertain-single-spawn' && children.length > 0
      && children.at(-1)?.exitCode === null;
    return { ok: healthy };
  });
  vi.stubGlobal('fetch', requests);
  const controller = createImageGenRuntimeController({
    storageBasePath: '/offline-runtime', backendRoot: '/offline-backend',
    modelCacheDir: () => '/offline-runtime/model/imagegen',
    inventoryScanner: async () => [],
    spawnProcess: spawnProcess as unknown as typeof spawn,
  });
  return { controller, children, spawnProcess, requests };
}
async function settlePrepare(controller: ReturnType<typeof createImageGenRuntimeController>) {
  const pending = controller.prepareLifecycle();
  await vi.runAllTimersAsync();
  return pending;
}

describe('normal controller foreground ownership constraints (offline evidence)', () => {
  it('can boot an absent sidecar normally on the successful path, with parent-bound pipes', async () => {
    const { controller, spawnProcess } = makeProbeController('success');
    await settlePrepare(controller);
    expect(controller.status().running).toBe(true);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess.mock.calls[0][1]).toEqual([
      '-m', 'image_gen.main', '--host', '127.0.0.1', '--port', '17595',
    ]);
    const options = spawnProcess.mock.calls[0][2];
    expect(options?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(options?.detached).not.toBe(true);
    expect(process.kill).not.toHaveBeenCalled();
    expect(probe.execFile).not.toHaveBeenCalled();
  });

  it('one prepare reclaims and starts twice after early failure; no task policy hook intervenes', async () => {
    const { controller, spawnProcess } = makeProbeController('early-exit');
    await settlePrepare(controller);
    expect(controller.status().running).toBe(true);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(vi.mocked(process.kill).mock.calls.map(call => call[1])).toEqual(['SIGCONT', 'SIGTERM']);
  });

  it('a single-spawn wrapper still allows reclamation before rejecting the retry after uncertain health', async () => {
    const { controller, spawnProcess, children } = makeProbeController('uncertain-single-spawn');
    await settlePrepare(controller);
    expect(controller.status().setupStage).toBe('failed');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(1);
    expect(vi.mocked(process.kill).mock.calls.map(call => call[1])).toEqual(['SIGCONT', 'SIGTERM']);
    expect(vi.mocked(process.kill).mock.invocationCallOrder.at(-1))
      .toBeLessThan(spawnProcess.mock.invocationCallOrder[1]);
  });

  it('normal controller stop terminates its child and also runs port reclamation', async () => {
    const { controller, children } = makeProbeController('success');
    await settlePrepare(controller);
    const pending = controller.stop();
    await vi.runAllTimersAsync();
    await pending;
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(probe.execFile).toHaveBeenCalled();
    expect(vi.mocked(process.kill).mock.calls.map(call => call[1])).toEqual(['SIGCONT', 'SIGTERM']);
  });
});
