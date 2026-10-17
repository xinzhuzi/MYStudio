// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fileStorage } from './indexed-db-storage';

afterEach(() => { vi.unstubAllGlobals(); });
const payload = JSON.stringify({ state: { characters: [{ id: 'only-copy' }] } });
function bridge(getItem: (key: string) => Promise<string | null>, setItem: (key: string, value: string) => Promise<boolean> = vi.fn(async () => false)) {
  vi.stubGlobal('window', { fileStorage: { getItem, setItem, removeItem: vi.fn(async () => false) } });
  return setItem;
}
it('rejects negative save acknowledgements without browser fallback', async () => {
  bridge(async () => null);
  await expect(fileStorage.setItem('ack-save', payload)).rejects.toThrow();
  expect(localStorage.getItem('ack-save')).toBeNull();
});
it('retains the source when migration cannot save', async () => {
  localStorage.setItem('ack-migration', payload);
  bridge(async () => null);
  expect(await fileStorage.getItem('ack-migration')).toBe(payload);
  expect(localStorage.getItem('ack-migration')).toBe(payload);
});
it('retains the source when confirmed writes read back a different value', async () => {
  localStorage.setItem('ack-readback', payload);
  bridge(async () => null, vi.fn(async () => true));
  expect(await fileStorage.getItem('ack-readback')).toBe(payload);
  expect(localStorage.getItem('ack-readback')).toBe(payload);
});
it('cleans only equivalent sources after semantic JSON readback', async () => {
  let stored: string | null = null;
  localStorage.setItem('ack-equivalent', payload);
  bridge(async () => stored, vi.fn(async (_key: string, value: string) => { stored = JSON.stringify(JSON.parse(value), null, 2); return true; }));
  expect(await fileStorage.getItem('ack-equivalent')).toBe(payload);
  expect(localStorage.getItem('ack-equivalent')).toBeNull();
});
it('protects an unreadable file from subsequent empty hydration saves', async () => {
  const save = bridge(async () => { throw new Error('read denied'); });
  await expect(fileStorage.getItem('ack-unreadable')).rejects.toThrow('read denied');
  await expect(fileStorage.setItem('ack-unreadable', '{}')).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});
it('preserves conflicting browser copies when the disk already has data', async () => {
  const other = JSON.stringify({ state: { characters: [{ id: 'different-copy' }] } });
  localStorage.setItem('ack-conflict', other);
  bridge(async () => payload);
  expect(await fileStorage.getItem('ack-conflict')).toBe(payload);
  expect(localStorage.getItem('ack-conflict')).toBe(other);
});
it('rejects failed removals instead of reporting browser success', async () => {
  bridge(async () => payload);
  await expect(fileStorage.removeItem('ack-remove')).rejects.toThrow('文件移除失败');
});
it('keeps the IndexedDB source after failure and removes it only after confirmed readback', async () => {
  const source = new Map([['ack-idb', payload]]);
  vi.stubGlobal('indexedDB', {
    open: () => {
      const db = {
        objectStoreNames: { contains: () => true },
        close: vi.fn(),
        transaction: () => ({ objectStore: () => ({
          get: (key: string) => {
            const request = { result: source.get(key), onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          delete: (key: string) => source.delete(key),
        }) }),
      };
      const request = { result: db, onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  bridge(async () => null);
  expect(await fileStorage.getItem('ack-idb')).toBe(payload);
  expect(source.get('ack-idb')).toBe(payload);
  let disk: string | null = null;
  bridge(async () => disk, vi.fn(async (_key: string, value: string) => { disk = value; return true; }));
  expect(await fileStorage.getItem('ack-idb')).toBe(payload);
  expect(source.has('ack-idb')).toBe(false);
});
