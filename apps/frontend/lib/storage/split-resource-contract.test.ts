// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { SplitFn, MergeFn } from './storage-project-sharded';

const mock = vi.hoisted(() => ({
  values: new Map<string, string>(),
  active: 'p1', sharing: { shareCharacters: true, shareScenes: true, shareMedia: true },
  recipes: new Map<string, { split: SplitFn<unknown>; merge: MergeFn<unknown> }>(),
}));
vi.mock('./indexed-db-storage', () => ({
  migrateFromLocalStorage: vi.fn(async () => undefined),
  fileStorage: {
    getItem: vi.fn(async (key: string) => mock.values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mock.values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mock.values.delete(key); }),
  },
}));
vi.mock('@/stores/project/project-store', () => ({ useProjectStore: { getState: () => ({ activeProjectId: mock.active, projects: [{ id: 'p1' }, { id: 'p2' }] }), persist: { hasHydrated: () => true } } }));
vi.mock('@/stores/app/app-settings-store', () => ({ useAppSettingsStore: { getState: () => ({ resourceSharing: mock.sharing }) } }));
vi.mock('./project-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('./project-storage')>();
  return { ...actual, createSplitStorage: (name: string, split: SplitFn<unknown>, merge: MergeFn<unknown>) => {
    mock.recipes.set(name, { split, merge });
    return { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined };
  } };
});

it('uses all four real store split/merge recipes without wiping hidden scopes or resurrecting deletions', async () => {
  await import('@/stores/library/character-library-store');
  await import('@/stores/library/scene-store');
  await import('@/stores/media/media-store');
  await import('@/stores/library/props-library-store');
  const { createSplitStorage } = await vi.importActual<typeof import('./project-storage')>('./project-storage');
  for (const [storeName, field, sharingKey] of [
    ['characters', 'characters', 'shareCharacters'], ['scenes', 'scenes', 'shareScenes'], ['media', 'mediaFiles', 'shareMedia'], ['props', 'items', undefined],
  ] as const) {
    const recipe = mock.recipes.get(storeName)!;
    expect(recipe).toBeDefined();
    mock.values.clear();
    const seed = (id: string, projectId?: string) => ({ folders: [], [field]: [{ id, ...(projectId ? { projectId } : {}) }], currentFolderId: null, selectedFolderId: 'all' });
    const serialize = (state: unknown) => JSON.stringify({ state, version: 0 });
    mock.values.set(`_p/p1/${storeName}`, serialize(seed('own', 'p1')));
    mock.values.set(`_p/p2/${storeName}`, serialize(seed('last', 'p2')));
    const shared = serialize(seed('global'));
    mock.values.set(`_shared/${storeName}`, shared);
    if (sharingKey) {
      mock.sharing[sharingKey] = false;
      const off = createSplitStorage(storeName, recipe.split, recipe.merge, sharingKey);
      await off.setItem('contract', (await off.getItem('contract'))!);
      expect(mock.values.get(`_shared/${storeName}`)).toBe(shared);
      expect(JSON.parse(mock.values.get(`_p/p2/${storeName}`)!).state[field]).toHaveLength(1);
      mock.sharing[sharingKey] = true;
    }
    const storage = createSplitStorage(storeName, recipe.split, recipe.merge, sharingKey);
    const loaded = JSON.parse((await storage.getItem('contract'))!);
    expect(loaded.state[field].some((item: { id: string }) => item.id === 'global')).toBe(Boolean(sharingKey));
    if (sharingKey) {
      loaded.state[field] = loaded.state[field].filter((item: { id: string }) => item.id !== 'last');
      await storage.setItem('contract', JSON.stringify(loaded));
      const reloaded = JSON.parse((await storage.getItem('contract'))!);
      expect(reloaded.state[field].some((item: { id: string }) => item.id === 'last')).toBe(false);
    } else {
      await storage.setItem('contract', JSON.stringify(loaded));
      expect(mock.values.get(`_shared/${storeName}`)).toBe(shared);
    }
  }
});
