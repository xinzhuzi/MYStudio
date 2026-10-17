// @vitest-environment node
// Product code is read-only; file operations use an in-memory fixture.
import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('@/lib/bridge/file-storage', () => ({ getFileStorageBridge: () => ({
  exists: async () => true,
  getItem: async (key: string) => fixture.values.get(key) ?? null,
}) }));
vi.mock('@/lib/storage/indexed-db-storage', () => ({ fileStorage: {
  getItem: async (key: string) => fixture.values.get(key) ?? null,
  setItem: vi.fn(async (key: string, value: string) => { fixture.values.set(key, value); }),
} }));
import { recoverFromLegacy } from '@/lib/storage/storage-migration';
beforeEach(() => {
  fixture.values.clear();
  fixture.values.set('mystudio-project-store', JSON.stringify({ state: { projects: [{ id: 'p1' }] } }));
  fixture.values.set('mystudio-script-store', JSON.stringify({ state: { projects: { p1: { rawScript: 'an old script deliberately cleared by the user' } } } }));
});
it('audit: startup recovery resurrects a deliberately emptied script from the retained legacy file', async () => {
  fixture.values.set('_p/p1/script', JSON.stringify({ state: { activeProjectId: 'p1', projectData: { rawScript: '', shots: [] } } }));
  await recoverFromLegacy();
  const actual = JSON.parse(fixture.values.get('_p/p1/script')!);
  expect(actual.state.projectData.rawScript).toBe('an old script deliberately cleared by the user');
});
it('audit: startup recovery overwrites malformed current bytes instead of preserving them for recovery', async () => {
  fixture.values.set('_p/p1/script', '{truncated latest script');
  await recoverFromLegacy();
  expect(fixture.values.get('_p/p1/script')).not.toBe('{truncated latest script');
  expect(JSON.parse(fixture.values.get('_p/p1/script')!).state.projectData.rawScript).toBe('an old script deliberately cleared by the user');
});
