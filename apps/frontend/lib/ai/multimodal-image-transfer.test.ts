import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareOne: vi.fn(),
  readImage: vi.fn(),
  featureMultimodal: vi.fn(),
  managerMultimodal: vi.fn(),
}));

vi.mock('@/lib/ai/image-transfer', () => ({
  prepareReferenceImageForTransfer: mocks.prepareOne,
}));
vi.mock('@/lib/image-storage', () => ({
  readImageAsBase64: mocks.readImage,
}));
vi.mock('@/lib/ai/feature-router', () => ({
  callFeatureMultimodalAPI: mocks.featureMultimodal,
}));
vi.mock('@/lib/ai/ai-manager', () => ({
  aiManager: { chatMultimodal: mocks.managerMultimodal },
}));

import { extractStyleTokens } from './style-extractor';
import { generateScenePrompts } from '@/lib/storyboard/scene-prompt-generator';

describe('multimodal image transfer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends only the prepared style reference image', async () => {
    mocks.readImage.mockResolvedValue('data:image/png;base64,b3JpZ2luYWw=');
    mocks.prepareOne.mockResolvedValue('data:image/jpeg;base64,dGh1bWI=');
    mocks.featureMultimodal.mockResolvedValue(JSON.stringify({
      styleTokens: 'ink wash',
      sceneTokens: 'misty dock',
      category: '2d',
      summaryZh: '水墨码头',
    }));

    await extractStyleTokens('', ['local-image://style.png']);

    expect(mocks.prepareOne).toHaveBeenCalledWith('data:image/png;base64,b3JpZ2luYWw=');
    const messages = mocks.featureMultimodal.mock.calls[0][1];
    expect(messages[1].content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,dGh1bWI=' },
    });
  });

  it('hard-fails style analysis before network when thumbnailing fails', async () => {
    mocks.prepareOne.mockRejectedValue(new Error('参考图发送前缩略失败'));

    await expect(extractStyleTokens('', ['data:image/png;base64,%%%']))
      .rejects.toThrow('参考图发送前缩略失败');
    expect(mocks.featureMultimodal).not.toHaveBeenCalled();
  });

  it('prepares the storyboard before vision prompt analysis', async () => {
    mocks.prepareOne.mockResolvedValue('data:image/jpeg;base64,dGh1bWI=');
    mocks.managerMultimodal.mockResolvedValue('[]');

    await generateScenePrompts({
      storyboardImage: 'project-file://contact-sheet.png',
      storyPrompt: '码头',
      scenes: [{ id: 1, row: 0, col: 0 }],
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com',
      model: 'vision-model',
    });

    expect(mocks.prepareOne).toHaveBeenCalledWith('project-file://contact-sheet.png');
    const messages = mocks.managerMultimodal.mock.calls[0][1];
    expect(messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,dGh1bWI=');
  });

  it('hard-fails storyboard vision before network when thumbnailing fails', async () => {
    mocks.prepareOne.mockRejectedValue(new Error('参考图发送前缩略失败'));

    await expect(generateScenePrompts({
      storyboardImage: 'data:image/png;base64,%%%',
      storyPrompt: '码头',
      scenes: [{ id: 1, row: 0, col: 0 }],
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com',
      model: 'vision-model',
    })).rejects.toThrow('参考图发送前缩略失败');
    expect(mocks.managerMultimodal).not.toHaveBeenCalled();
  });
});
