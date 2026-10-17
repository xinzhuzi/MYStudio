// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }));
import { registerFileStorageIpcHandlers } from './file-storage-ipc';
afterEach(() => vi.restoreAllMocks());
it('writes and reads real temporary files and reports filesystem failure without modifying the source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mystudio-storage-1018-'));
  registerFileStorageIpcHandlers({ getDataDir: () => root });
  const set = handlers.get('file-storage-set')!;
  const get = handlers.get('file-storage-get')!;
  const original = '{"state":{"items":["retained"]}}';
  expect(await set({}, 'valid', original)).toBe(true);
  expect(JSON.parse(String(await get({}, 'valid')))).toEqual(JSON.parse(original));
  expect(await get({}, 'absent')).toBeNull();
  fs.writeFileSync(path.join(root, 'blocked'), 'retained source', 'utf8');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(await set({}, 'blocked/value', original)).toBe(false);
  expect(fs.readFileSync(path.join(root, 'blocked'), 'utf8')).toBe('retained source');
  const read = vi.spyOn(fs, 'readFileSync');
  read.mockImplementationOnce(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
  await expect(get({}, 'valid')).rejects.toThrow('denied');
  read.mockRestore();
  expect(JSON.parse(String(await get({}, 'valid')))).toEqual(JSON.parse(original));
});
