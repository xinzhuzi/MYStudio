import { describe, expect, it } from 'vitest';

import type { SplitScene } from './director-store';
import { normalizeDirectorSplitScene } from './director-scene-normalizer';

describe('director scene normalizer', () => {
  it('preserves persisted values while filling legacy defaults', () => {
    const normalized = normalizeDirectorSplitScene({
      id: 7,
      imageDataUrl: 'frame.png',
      width: 1920,
      height: 1080,
      videoPrompt: 'legacy motion',
      imageStatus: undefined,
      imageProgress: undefined,
      videoStatus: undefined,
      duration: 0,
    } as unknown as SplitScene);

    expect(normalized).toMatchObject({
      id: 7,
      sceneName: '',
      imagePrompt: 'legacy motion',
      imagePromptZh: 'legacy motion',
      imageStatus: 'completed',
      imageProgress: 100,
      needsEndFrame: false,
      endFrameStatus: 'idle',
      videoStatus: 'idle',
      duration: 0,
      characterIds: [],
      soundEffects: [],
    });
  });

  it('keeps explicit prompts, statuses, and scene metadata', () => {
    const scene = {
      id: 1,
      sceneName: '桥头',
      sceneLocation: '河岸',
      imagePrompt: 'first',
      imagePromptZh: '首帧',
      imageStatus: 'failed',
      imageProgress: 25,
      videoPrompt: 'motion',
      videoPromptZh: '动作',
      videoStatus: 'generating',
      duration: 8,
      characterIds: ['hero'],
    } as SplitScene;

    expect(normalizeDirectorSplitScene(scene)).toMatchObject(scene);
  });
});
