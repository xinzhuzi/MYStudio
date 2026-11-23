// @vitest-environment node
/** Explicit local runtime operation. Default skipped, task evidence only. */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createImageGenRuntimeController } from '@/electron/rendering/plugins/image_gen/image-gen-runtime-controller';
const mode = process.env.DIRECTOR_CHAPTER001_RUNTIME_MODE;
const output = process.env.DIRECTOR_CHAPTER001_RUNTIME_OUTPUT;
const requestFile = process.env.DIRECTOR_CHAPTER001_IMAGE_REQUEST;
const root = path.resolve(import.meta.dirname, '../../../');
const evidence = path.join(root, '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026');
function scoped(file: string) {
  const resolved = path.join(realpathSync(path.dirname(file)), path.basename(file));
  expect(resolved.startsWith(realpathSync(evidence) + path.sep)).toBe(true);
  return resolved;
}
it.skipIf(!mode || !output)('chapter001 explicit local runtime operation', async () => {
  expect(['probe', 'generate']).toContain(mode);
  const destination = scoped(output!);
  expect(existsSync(destination)).toBe(false);
  const storage = realpathSync(path.join(os.homedir(), 'Library/Application Support', '漫影工作室'));
  const config = path.join(storage, 'python/profiles/image-gen/config.json');
  expect(typeof JSON.parse(readFileSync(config, 'utf8')).controlToken).toBe('string');
  let owned = false;
  const controller = createImageGenRuntimeController({
    storageBasePath: storage, backendRoot: path.join(root, 'apps/backend'),
    modelCacheDir: () => path.join(storage, 'model/imagegen'),
    spawnProcess: ((...args: Parameters<typeof spawn>) => { owned = true; return spawn(...args); }) as typeof spawn,
  });
  const receipt: Record<string, unknown> = { mode, startedAt: new Date().toISOString(), projectWrites: 0, generatedImages: 0 };
  try {
    if (mode === 'generate') {
      // A healthy existing sidecar avoids the controller's orphan reclamation path.
      const health = await fetch(`${controller.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      expect(health.ok, 'Generation pilot requires a healthy sidecar; do not reclaim a shared process').toBe(true);
    }
    const status = mode === 'probe' ? await controller.probeLifecycle() : await controller.prepareLifecycle();
    Object.assign(receipt, { status, running: controller.status().running });
    if (mode === 'generate') {
      expect(controller.status().running).toBe(true);
      expect(requestFile).toBeTruthy();
      const request = JSON.parse(readFileSync(scoped(requestFile!), 'utf8'));
      expect(request.model).toBe('qwen-image-2-1');
      expect(request.prompt?.trim()).toBeTruthy();
      expect(request.image_urls?.length ?? 0).toBeLessThanOrEqual(1);
      const manifest = JSON.parse(readFileSync(path.join(storage, 'comfyui/manifest.json'), 'utf8'));
      expect(Number.isInteger(manifest.engine.port)).toBe(true);
      let queue: { queue_running: unknown[]; queue_pending: unknown[] } | undefined;
      try {
        const check = await fetch(`http://127.0.0.1:${manifest.engine.port}/queue`, { signal: AbortSignal.timeout(3000) });
        expect(check.ok).toBe(true); queue = await check.json();
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        receipt.engineBefore = 'not listening; production ensure may start it';
      }
      if (queue) { expect(queue.queue_running).toHaveLength(0); expect(queue.queue_pending).toHaveLength(0); }
      receipt.queueBefore = queue;
      const startedFile = destination + '.request-started.json';
      expect(existsSync(startedFile)).toBe(false);
      writeFileSync(startedFile, JSON.stringify({ startedAt: new Date().toISOString(), requestSha256: crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'), postCount: 1 }), { flag: 'wx' });
      receipt.generationPostCount = 1;
      const response = await fetch(`${controller.baseUrl}/v1/images/generations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controller.getControlToken()}` },
        body: JSON.stringify(request), signal: AbortSignal.timeout(35 * 60_000),
      });
      receipt.httpStatus = response.status;
      const responseText = await response.text();
      const result = JSON.parse(responseText) as { created?: number; error?: unknown; data?: { b64_json?: string }[] };
      receipt.responseMetadata = { created: result.created, error: result.error, responseBytes: Buffer.byteLength(responseText), responseSha256: crypto.createHash('sha256').update(responseText).digest('hex'), images: result.data?.map((item) => ({ b64Characters: item.b64_json?.length })) };
      expect(response.ok, `local image HTTP ${response.status}`).toBe(true);
      expect(result.data).toHaveLength(1); expect(result.data![0].b64_json).toBeTruthy();
      const png = destination.replace(/\.json$/, '.png');
      expect(png).not.toBe(destination); expect(existsSync(png)).toBe(false);
      const bytes = Buffer.from(result.data![0].b64_json!, 'base64');
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      writeFileSync(png, bytes, { flag: 'wx' });
      Object.assign(receipt, { generatedImages: 1, imageFile: png, imageBytes: bytes.length, imageSha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  } catch (error) {
    receipt.failure = error instanceof Error ? { name: error.name, message: error.message } : String(error);
    throw error;
  } finally {
    if (owned) await controller.stop();
    Object.assign(receipt, { finishedAt: new Date().toISOString(), cleanup: { ownedSidecarSpawned: owned, controllerStopCalled: owned, sharedEngineStopped: false } });
    writeFileSync(destination, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
}, 40 * 60_000);
