import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIScreenplay, GenerationConfig } from '@opencut/ai-core';

const transferMocks = vi.hoisted(() => ({
  prepareOne: vi.fn(),
  prepareMany: vi.fn(),
}));

vi.mock('@/lib/ai/image-transfer', () => ({
  prepareReferenceImageForTransfer: transferMocks.prepareOne,
  prepareReferenceImagesForTransfer: transferMocks.prepareMany,
}));

import { AIWorkerBridge } from './worker-bridge';

function screenplayWithFrame(imageUrl: string): AIScreenplay {
  return {
    id: 'screenplay-1',
    title: 'test',
    scenes: [{ sceneId: 1, imageUrl }],
  } as AIScreenplay;
}

function configWithReferences(referenceImages: string[]): GenerationConfig {
  return { characterReferenceImages: referenceImages } as unknown as GenerationConfig;
}

describe('AIWorkerBridge image transfer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares character references before posting an image-generation command', async () => {
    transferMocks.prepareMany.mockResolvedValue(['data:image/jpeg;base64,c2FmZQ==']);
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });

    await bridge.executeScreenplayImages(
      screenplayWithFrame('local-image://unused-for-image-only'),
      configWithReferences(['local-image://character.png']),
    );

    expect(transferMocks.prepareMany).toHaveBeenCalledWith(['local-image://character.png']);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'EXECUTE_SCREENPLAY_IMAGES',
      payload: expect.objectContaining({
        config: expect.objectContaining({
          characterReferenceImages: ['data:image/jpeg;base64,c2FmZQ=='],
        }),
      }),
    }));
  });

  it('prepares the video frame and references before posting a video command', async () => {
    transferMocks.prepareMany.mockResolvedValue(['data:image/jpeg;base64,cmVm']);
    transferMocks.prepareOne.mockResolvedValue('data:image/jpeg;base64,ZnJhbWU=');
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });

    await bridge.executeScreenplayVideos(
      screenplayWithFrame('project-file://shot-001.png'),
      configWithReferences(['file:///character.png']),
    );

    expect(transferMocks.prepareOne).toHaveBeenCalledWith('project-file://shot-001.png');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'EXECUTE_SCREENPLAY_VIDEOS',
      payload: expect.objectContaining({
        screenplay: expect.objectContaining({
          scenes: [expect.objectContaining({ imageUrl: 'data:image/jpeg;base64,ZnJhbWU=' })],
        }),
      }),
    }));
  });

  it('does not post a command when thumbnail preparation fails', async () => {
    transferMocks.prepareMany.mockRejectedValue(new Error('参考图发送前缩略失败'));
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });

    await expect(bridge.executeScreenplayImages(
      screenplayWithFrame('https://cdn.example.com/frame.png'),
      configWithReferences(['data:image/png;base64,%%%']),
    )).rejects.toThrow('参考图发送前缩略失败');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
