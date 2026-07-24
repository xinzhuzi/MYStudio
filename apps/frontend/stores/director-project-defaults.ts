import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from '@/lib/constants/cinematography-profiles';

import type {
  DirectorEditorPrefs,
  DirectorProjectData,
  DirectorScreenplayDraft,
} from './director-store-types';

export const DEFAULT_DIRECTOR_SCREENPLAY_DRAFT: DirectorScreenplayDraft = {
  prompt: '',
  selectedCharacterIds: [],
  updatedAt: 0,
};

export const DEFAULT_DIRECTOR_EDITOR_PREFS: DirectorEditorPrefs = {
  imageGenMode: 'merged',
  frameMode: 'first',
  refStrategy: 'cluster',
  useExemplar: true,
  activeTab: 'editing',
  episodeViewScope: 'episode',
};

export function createDefaultDirectorProjectData(): DirectorProjectData {
  return {
    storyboardImage: null,
    storyboardImageMediaId: null,
    storyboardStatus: 'editing',
    storyboardError: null,
    splitScenes: [],
    projectFolderId: null,
    storyboardConfig: {
      aspectRatio: '9:16',
      resolution: '2K',
      videoResolution: '480p',
      sceneCount: 5,
      storyPrompt: '',
      styleTokens: [],
      characterReferenceImages: [],
      characterDescriptions: [],
    },
    screenplay: null,
    screenplayStatus: 'idle',
    screenplayError: null,
    trailerConfig: {
      duration: 30,
      shotIds: [],
      status: 'idle',
    },
    trailerScenes: [],
    cinematographyProfileId: DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
    screenplayDraft: {
      ...DEFAULT_DIRECTOR_SCREENPLAY_DRAFT,
      selectedCharacterIds: [],
    },
    editorPrefs: { ...DEFAULT_DIRECTOR_EDITOR_PREFS },
  };
}

export function normalizeDirectorProjectData(project: unknown): DirectorProjectData {
  const defaults = createDefaultDirectorProjectData();
  const source = project && typeof project === 'object'
    ? project as Partial<DirectorProjectData>
    : {};

  return {
    ...defaults,
    ...source,
    storyboardConfig: {
      ...defaults.storyboardConfig,
      ...(source.storyboardConfig || {}),
    },
    trailerConfig: {
      ...defaults.trailerConfig,
      ...(source.trailerConfig || {}),
    },
    screenplayDraft: {
      ...DEFAULT_DIRECTOR_SCREENPLAY_DRAFT,
      selectedCharacterIds: [],
      ...(source.screenplayDraft || {}),
    },
    editorPrefs: {
      ...DEFAULT_DIRECTOR_EDITOR_PREFS,
      ...(source.editorPrefs || {}),
    },
  };
}
