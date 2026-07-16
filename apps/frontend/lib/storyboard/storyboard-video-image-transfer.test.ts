import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepareMany: vi.fn() }));

vi.mock('@/lib/ai/image-transfer', () => ({
  prepareReferenceImagesForTransfer: mocks.prepareMany,
}));
vi.mock('@/lib/ai/ai-manager', () => ({ aiManager: {} }));

import { generateSceneVideos } from './storyboard-service';

describe('storyboard video image transfer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends only prepared first-frame and character references', async () => {
    mocks.prepareMany.mockResolvedValue([
      'data:image/jpeg;base64,ZnJhbWU=',
      'data:image/jpeg;base64,cmVm',
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: 'task-1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', result: { videos: [{ url: 'https://cdn.example.com/video.mp4' }] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSceneVideos(
      [{ id: 1, imageDataUrl: 'file:///shot.png', videoPrompt: '向前走' }],
      {
        aspectRatio: '16:9',
        apiKey: 'test-key',
        model: 'video-model',
        baseUrl: 'https://api.example.com',
        characterReferenceImages: ['local-image://character.png'],
      },
    );

    expect(result.get(1)).toBe('https://cdn.example.com/video.mp4');
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.image_with_roles).toEqual([
      { url: 'data:image/jpeg;base64,ZnJhbWU=', role: 'first_frame' },
      { url: 'data:image/jpeg;base64,cmVm', role: 'reference_image' },
    ]);
  });

  it('does not call the provider when thumbnailing fails', async () => {
    mocks.prepareMany.mockRejectedValue(new Error('参考图发送前缩略失败'));
    const fetchMock = vi.fn();
    const onFailed = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await generateSceneVideos(
      [{ id: 1, imageDataUrl: 'data:image/png;base64,%%%', videoPrompt: '向前走' }],
      { aspectRatio: '16:9', apiKey: 'test-key', model: 'video-model', baseUrl: 'https://api.example.com' },
      undefined,
      undefined,
      onFailed,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(1, '参考图发送前缩略失败');
  });
});
