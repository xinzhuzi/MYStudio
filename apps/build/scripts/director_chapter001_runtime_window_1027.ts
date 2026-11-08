/** Task-only launcher. Import/default tests are inert. Never stops a shared service. */
export interface WindowIO {
  get(route: string): Promise<Record<string, unknown>>;
  prepare(): Promise<void>;
  start(): Promise<Record<string, unknown>>;
  pause(): Promise<void>;
}
export async function runtimeWindow(io: WindowIO): Promise<Record<string, unknown>> {
  const idle = async () => {
    const q = await io.get('queue');
    if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)
      || q.queue_running.length || q.queue_pending.length) throw new Error('live queue not empty or invalid');
  };
  const identity = async () => {
    const s = await io.get('identity');
    if (s.port !== 17001 || s.healthy !== true || s.sidecarTokenMatch !== true
      || typeof s.engineTokenMatch !== 'boolean' || typeof s.statusRunning !== 'boolean') {
      throw new Error('runtime identity unavailable; no lifecycle action');
    }
    if (s.statusRunning !== s.engineTokenMatch) throw new Error('status/token mismatch is inconsistent');
    return s;
  };
  await idle(); await identity();
  await io.prepare();
  await idle();
  const before = await identity();
  let jobReady = false; let jobId: string | null = null;
  if (!before.engineTokenMatch) {
    const started = await io.start();
    if (typeof started.jobId !== 'string' || !/^[a-f0-9]{12}$/.test(started.jobId)) throw new Error('invalid start job id');
    jobId = started.jobId;
    for (;;) {
      const job = await io.get('job/' + started.jobId);
      if (job.id !== started.jobId || job.kind !== 'engine-start') throw new Error('wrong start job');
      if (job.status === 'error') throw new Error('normal start job failed; no retry');
      if (job.status === 'complete') { jobReady = true; break; }
      if (job.status !== 'running') throw new Error('invalid job status');
      await io.pause();
    }
  }
  await idle(); const after = await identity();
  if (!after.engineTokenMatch || !after.statusRunning) throw new Error('engine not ready after normal route');
  return { ready: true, startPosts: before.engineTokenMatch ? 0 : 1, reused: before.engineTokenMatch,
    jobReady, jobId, identityBefore: before, identityAfter: after, controllerStopCalled: false, generationPosts: 0 };
}

/** Root-session opt-in only. Requires an already healthy normal sidecar; no spawn/reclaim. */
export async function rootRuntimeWindow(): Promise<void> {
  if (process.env.DIRECTOR_CHAPTER001_RUNTIME_WINDOW !== 'root-one-normal-restart') throw new Error('explicit root opt-in required');
  const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
  const root = path.resolve(import.meta.dirname, '../../..');
  const research = path.join(root, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research');
  const output = path.join(research, 'chapter001-runtime-window-1027-live.json');
  const fd = fs.openSync(output, 'wx');
  const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), ready: false,
    lifecycleCalls: 0, startPosts: 0, generationPosts: 0, controllerStopCalled: false, sidecarSpawned: false };
  const deadline = Date.now() + 180_000;
  const request = async (url: string, token?: string, method = 'GET') => {
    const remaining = deadline - Date.now(); if (remaining <= 0) throw new Error('window deadline exceeded; shared job left running');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(Math.min(5000, remaining)),
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      ...(method === 'POST' ? { body: '{}' } : {}) });
    if (!response.ok) throw new Error(`runtime HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  };
  try {
    const storage = fs.realpathSync(path.join(os.homedir(), 'Library/Application Support', '漫影工作室'));
    const profile = JSON.parse(fs.readFileSync(path.join(storage, 'python/profiles/image-gen/config.json'), 'utf8'));
    if (typeof profile.controlToken !== 'string' || !profile.controlToken) throw new Error('existing control token required; never create config');
    const manifestFile = path.join(storage, 'comfyui/manifest.json');
    const checkManifest = () => {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.engine?.port !== 17001) throw new Error('manifest exact engine port must be 17001');
    };
    checkManifest();
    const { createImageGenRuntimeController } = await import('@/electron/rendering/plugins/image_gen/image-gen-runtime-controller');
    const controller = createImageGenRuntimeController({ storageBasePath: storage,
      backendRoot: path.join(root, 'apps/backend'), modelCacheDir: () => path.join(storage, 'model/imagegen'),
      spawnProcess: () => { throw new Error('sidecar spawn/reclaim not authorized by bounded launcher'); },
    });
    const sidecar = controller.baseUrl; const engine = 'http://127.0.0.1:17001'; const token = profile.controlToken;
    Object.assign(receipt, await runtimeWindow({
      async get(route) {
        checkManifest();
        if (route === 'queue') return request(engine + '/queue');
        if (route.startsWith('job/')) return request(sidecar + '/comfy/jobs/' + route.slice(4), token);
        if (route !== 'identity') throw new Error('unsupported read route');
        const health = await request(sidecar + '/health');
        const status = await request(sidecar + '/comfy/engine/status', token);
        const bridge = await request(engine + '/my_bridge/config');
        if (typeof bridge.bridgeToken !== 'string' || status.installed !== true) throw new Error('bridge ownership evidence missing');
        return { healthy: health.ok === true && health.service === 'manying-local-image', sidecarTokenMatch: true,
          engineTokenMatch: bridge.bridgeToken === token, statusRunning: status.running, port: status.port };
      },
      async prepare() {
        receipt.lifecycleCalls = 1;
        await controller.prepareLifecycle();
        if (!controller.status().running) throw new Error('sidecar reuse failed; no engine start');
      },
      async start() {
        const marker = path.join(research, 'chapter001-runtime-window-1027-restart-used.json');
        fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), maximumStartPosts: 1 }), { flag: 'wx' });
        receipt.startPosts = 1;
        return request(sidecar + '/comfy/engine/start', token, 'POST');
      },
      async pause() {
        if (Date.now() >= deadline) throw new Error('window deadline exceeded; no stop or retry');
        await new Promise(resolve => setTimeout(resolve, 500));
      },
    }));
  } catch (error) {
    // Never copy provider bodies, status payloads or credentials to the receipt.
    receipt.failure = error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, 'Bearer [redacted]') : 'runtime operation failed';
    throw new Error(String(receipt.failure));
  } finally {
    receipt.finishedAt = new Date().toISOString();
    receipt.cleanup = 'no owned sidecar; no controller.stop; existing normal sidecar and its engine stay under their prior owner';
    fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n'); fs.closeSync(fd);
  }
}
