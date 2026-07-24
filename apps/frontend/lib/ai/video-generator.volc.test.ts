import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFeatureConfig: vi.fn(),
  getState: vi.fn(),
  prepareImages: vi.fn(),
}));

vi.mock('@/lib/ai/feature-router', () => ({ getFeatureConfig: mocks.getFeatureConfig }));
vi.mock('@/stores/api-config-store', () => ({ useAPIConfigStore: { getState: mocks.getState } }));
vi.mock('@/lib/ai/video-generator-image-transfer', () => ({
  prepareVideoImageRolesForTransfer: mocks.prepareImages,
  buildImageWithRoles: vi.fn(),
  convertToHttpUrl: vi.fn(),
}));
vi.mock('@/lib/image-host', () => ({ isImageHostConfigured: () => false, uploadToImageHost: vi.fn() }));
vi.mock('@/lib/image-storage', () => ({ saveVideoToLocal: vi.fn() }));

import { callVideoGenerationApi } from './video-generator';

const keyManager = { getCurrentKey: () => 'rotated-key', handleError: vi.fn(() => false), getAvailableKeyCount: () => 1, getTotalKeyCount: () => 1 };

describe('Volc video public route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getFeatureConfig.mockReturnValue({ platform: 'memefast', models: ['seedance-2.0'], baseUrl: 'https://api.example.com/', keyManager });
    mocks.getState.mockReturnValue({ modelEndpointTypes: {} });
    mocks.prepareImages.mockImplementation(async (images: unknown[]) => images);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('sends deterministic Volc body and authorization headers', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://cdn/video.mp4' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const resultPromise = callVideoGenerationApi('fallback-key', 'hero walks', 6, '16:9', [], undefined, keyManager, undefined, '1080p', ['https://v/ref.mp4'], ['https://a/ref.mp3'], true, true);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toBe('https://cdn/video.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/volc/v1/contents/generations/tasks');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer rotated-key' });
    expect(JSON.parse(init.body)).toEqual({ model: 'seedance-2.0', content: [
      { type: 'text', text: 'hero walks --rs 1080p --rt 16:9 --dur 6 --cf true' },
      { type: 'video_url', video_url: { url: 'https://v/ref.mp4' } },
      { type: 'audio_url', audio_url: { url: 'https://a/ref.mp3' } },
    ] });
  });

  it('throws on HTTP and proxy business failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"message":"bad request"}', { status: 400 })));
    await expect(callVideoGenerationApi('key', 'p', 4, '1:1', [], undefined, keyManager)).rejects.toThrow('bad request');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', message: 'status 451: blocked' }), { status: 200 })));
    await expect(callVideoGenerationApi('key', 'p', 4, '1:1', [], undefined, keyManager)).rejects.toThrow('blocked');
  });

  it('throws task failure and honors pre-abort and polling abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-f' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', error: { message: 'upstream failed' } }), { status: 200 })));
    const failure = expect(callVideoGenerationApi('key', 'p', 4, '1:1', [], undefined, keyManager)).rejects.toThrow('upstream failed');
    await vi.runAllTimersAsync();
    await failure;
    const preAbort = new AbortController(); preAbort.abort();
    await expect(callVideoGenerationApi('key', 'p', 4, '1:1', [], undefined, keyManager, undefined, undefined, undefined, undefined, undefined, undefined, preAbort.signal)).rejects.toThrow('用户已取消');
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-a' }), { status: 200 })));
    const pending = expect(callVideoGenerationApi('key', 'p', 4, '1:1', [], undefined, keyManager, undefined, undefined, undefined, undefined, undefined, undefined, controller.signal)).rejects.toThrow('用户已取消');
    controller.abort();
    await vi.runAllTimersAsync();
    await pending;
  });
});
