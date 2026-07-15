import { describe, expect, it } from 'vitest';

import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from '@/lib/constants/cinematography-profiles';

import {
  createDefaultDirectorProjectData,
  normalizeDirectorProjectData,
} from './director-project-defaults';

describe('director project defaults', () => {
  it('creates independent nested defaults', () => {
    const first = createDefaultDirectorProjectData();
    const second = createDefaultDirectorProjectData();

    first.storyboardConfig.styleTokens?.push('mutated');
    first.trailerConfig.shotIds.push('shot-1');
    first.screenplayDraft.selectedCharacterIds.push('character-1');

    expect(second.storyboardConfig.styleTokens).toEqual([]);
    expect(second.trailerConfig.shotIds).toEqual([]);
    expect(second.screenplayDraft.selectedCharacterIds).toEqual([]);
    expect(second.cinematographyProfileId).toBe(DEFAULT_CINEMATOGRAPHY_PROFILE_ID);
  });

  it('fills nested defaults without overwriting persisted values', () => {
    const normalized = normalizeDirectorProjectData({
      storyboardConfig: { storyPrompt: 'persisted prompt' },
      trailerConfig: { duration: 60 },
      screenplayDraft: { prompt: 'persisted draft' },
      editorPrefs: { activeTab: 'trailer' },
    });

    expect(normalized.storyboardConfig).toMatchObject({
      aspectRatio: '9:16',
      storyPrompt: 'persisted prompt',
    });
    expect(normalized.trailerConfig).toMatchObject({ duration: 60, status: 'idle', shotIds: [] });
    expect(normalized.screenplayDraft).toMatchObject({
      prompt: 'persisted draft',
      selectedCharacterIds: [],
    });
    expect(normalized.editorPrefs).toMatchObject({
      activeTab: 'trailer',
      imageGenMode: 'merged',
    });
  });

  it('normalizes missing or invalid persisted values to project defaults', () => {
    expect(normalizeDirectorProjectData(undefined)).toEqual(createDefaultDirectorProjectData());
    expect(normalizeDirectorProjectData('invalid')).toEqual(createDefaultDirectorProjectData());
  });
});
