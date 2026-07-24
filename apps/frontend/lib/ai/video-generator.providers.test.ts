import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const keyManager = {
  getCurrentKey: () => 'rotated-key',
  handleError: vi.fn(() => false),
  getAvailableKeyCount: () => 1,
  getTotalKeyCount: () => 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): RequestInit & {
  headers: Record<string, string>;
  body?: string | FormData;
} {
  return fetchMock.mock.calls[callIndex][1] as RequestInit & {
    headers: Record<string, string>;
    body?: string | FormData;
  };
}

function useVideoFeature(model: string, baseUrl = 'https://api.example.test'): void {
  mocks.getFeatureConfig.mockReturnValue({
    platform: 'memefast',
    models: [model],
    baseUrl,
    keyManager,
  });
}

describe('video provider public route contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ modelEndpointTypes: {} });
    mocks.prepareImages.mockImplementation(async (images: unknown[]) => images);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('submits Wan requests with clamped parameters and polls Bailian task status', async () => {
    useVideoFeature('wan-2.2');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: 'wan-task' } }))
      .mockResolvedValueOnce(jsonResponse({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.test/wan.mp4' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callVideoGenerationApi(
      'fallback-key',
      'hero walks',
      12,
      '16:9',
      [{ url: 'data:image/png;base64,AAAA', role: 'first_frame' }],
      undefined,
      keyManager,
      undefined,
      '720p',
      undefined,
      undefined,
      false,
    )).resolves.toBe('https://cdn.test/wan.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/alibailian/api/v1/services/aigc/video-generation/video-synthesis');
    expect(requestInit(fetchMock, 0).headers.Authorization).toBe('Bearer rotated-key');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'wan-2.2',
      input: {
        prompt: 'hero walks',
        img_url: 'data:image/png;base64,AAAA',
      },
      parameters: {
        resolution: '720P',
        prompt_extend: true,
        duration: 10,
        audio: false,
      },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/alibailian/api/v1/tasks/wan-task');
  });

  it('submits Wan text-only requests with default resolution and audio enabled', async () => {
    useVideoFeature('wan-2.2');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: 'wan-text-task' } }))
      .mockResolvedValueOnce(jsonResponse({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.test/wan-text.mp4' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callVideoGenerationApi(
      'fallback-key',
      'text-only shot',
      0,
      '16:9',
      [],
      undefined,
      keyManager,
    )).resolves.toBe('https://cdn.test/wan-text.mp4');

    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'wan-2.2',
      input: {
        prompt: 'text-only shot',
      },
      parameters: {
        resolution: '480P',
        prompt_extend: true,
        audio: true,
      },
    });
  });

  it('surfaces Wan submit HTTP errors with the parsed message and status', async () => {
    useVideoFeature('wan-2.2');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'bad request' }, 400)));

    await expect(callVideoGenerationApi(
      'fallback-key',
      'bad wan request',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).rejects.toMatchObject({ message: 'bad request', status: 400 });
    expect(keyManager.handleError).toHaveBeenCalledWith(400, '{"message":"bad request"}');
  });

  it('skips Wan non-OK poll responses and succeeds on a later poll', async () => {
    useVideoFeature('wan-2.2');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: 'wan-retry-task' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.test/wan-retry.mp4' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'retry wan poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/wan-retry.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/alibailian/api/v1/services/aigc/video-generation/video-synthesis',
      'https://api.example.test/alibailian/api/v1/tasks/wan-retry-task',
      'https://api.example.test/alibailian/api/v1/tasks/wan-retry-task',
    ]);
  });

  it('surfaces Wan failed task statuses', async () => {
    useVideoFeature('wan-2.2');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: 'wan-failed-task' } }))
      .mockResolvedValueOnce(jsonResponse({ output: { task_status: 'FAILED', message: 'wan provider rejected' } })));

    await expect(callVideoGenerationApi(
      'fallback-key',
      'failed wan poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).rejects.toThrow('wan provider rejected');
  });

  it('submits Kling image2video requests and mirrors the path during polling', async () => {
    useVideoFeature('kling-image-v1-5');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { task_id: 'kling-task' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          task_status: 'succeed',
          task_result: { videos: [{ url: 'https://cdn.test/kling.mp4' }] },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'hero turns',
      3,
      '9:16',
      [
        { url: 'data:image/png;base64,FIRST', role: 'first_frame' },
        { url: 'data:image/png;base64,LAST', role: 'last_frame' },
      ],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/kling.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/kling/v1/videos/image2video');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toMatchObject({
      model_name: 'kling-v1-5',
      prompt: 'hero turns',
      aspect_ratio: '9:16',
      duration: '5',
      mode: 'std',
      image_url: 'data:image/png;base64,FIRST',
      tail_image_url: 'data:image/png;base64,LAST',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/kling/v1/videos/image2video/kling-task');
  });

  it('submits Kling text2video requests without image fields', async () => {
    useVideoFeature('kling-video-v1');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { task_id: 'kling-text-task' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          task_status: 'completed',
          task_result: { video_url: 'https://cdn.test/kling-text.mp4' },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'text only kling',
      12,
      '1:1',
      [],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/kling-text.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/kling/v1/videos/text2video');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model_name: 'kling-video-v1',
      prompt: 'text only kling',
      aspect_ratio: '1:1',
      duration: '10',
      mode: 'std',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/kling/v1/videos/text2video/kling-text-task');
  });

  it('surfaces Kling submit HTTP errors with the parsed message and status', async () => {
    useVideoFeature('kling-video-v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'bad request' }, 400)));

    await expect(callVideoGenerationApi(
      'fallback-key',
      'bad kling request',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).rejects.toMatchObject({ message: 'bad request', status: 400 });
    expect(keyManager.handleError).toHaveBeenCalledWith(400, '{"message":"bad request"}');
  });

  it('skips Kling non-OK poll responses and succeeds on a later poll', async () => {
    useVideoFeature('kling-video-v1');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { task_id: 'kling-retry-task' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          task_status: 'success',
          task_result: { videos: [{ url: 'https://cdn.test/kling-retry.mp4' }] },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'retry kling poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/kling-retry.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/kling/v1/videos/text2video',
      'https://api.example.test/kling/v1/videos/text2video/kling-retry-task',
      'https://api.example.test/kling/v1/videos/text2video/kling-retry-task',
    ]);
  });

  it('surfaces Kling failed task statuses', async () => {
    useVideoFeature('kling-video-v1');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { task_id: 'kling-failed-task' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { task_status: 'failed', task_status_msg: 'kling provider rejected' } })));

    const result = callVideoGenerationApi(
      'fallback-key',
      'failed kling poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    const failure = expect(result).rejects.toThrow('kling provider rejected');
    await vi.runAllTimersAsync();
    await failure;
  });

  it('submits OpenAI official video requests as FormData and falls back to content URL', async () => {
    useVideoFeature('sora-2');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'sora-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'city flythrough',
      7,
      '9:16',
      [],
      undefined,
      keyManager,
      undefined,
      '1080p',
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://api.example.test/v1/videos/sora-task/content');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/videos');
    const form = requestInit(fetchMock, 0).body as FormData;
    expect(form.get('model')).toBe('sora-2');
    expect(form.get('prompt')).toBe('city flythrough');
    expect(form.get('size')).toBe('1080x1920');
    expect(form.get('seconds')).toBe('7');
    expect(requestInit(fetchMock, 0).headers).toEqual({ Authorization: 'Bearer rotated-key' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/v1/videos/sora-task');
  });

  it('submits Replicate predictions from async endpoint metadata and strips a v1 base suffix', async () => {
    useVideoFeature('custom-video-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-video-model': ['owner/model异步'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'prediction-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'succeeded', output: ['https://cdn.test/replicate.mp4'] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'robot dance',
      6,
      '1:1',
      [
        { url: 'data:image/png;base64,FIRST', role: 'first_frame' },
        { url: 'data:image/png;base64,LAST', role: 'last_frame' },
      ],
      undefined,
      keyManager,
      undefined,
      '480p',
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/replicate.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/replicate/v1/predictions');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'custom-video-model',
      input: {
        prompt: 'robot dance',
        aspect_ratio: '1:1',
        duration: 6,
        resolution: '480p',
        image: 'data:image/png;base64,FIRST',
        tail_image: 'data:image/png;base64,LAST',
      },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/replicate/v1/predictions/prediction-1');
  });

  it('returns direct Replicate output URLs without polling', async () => {
    useVideoFeature('custom-video-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-video-model': ['owner/model异步'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: 'https://cdn.test/replicate-direct.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callVideoGenerationApi(
      'fallback-key',
      'direct replicate output',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).resolves.toBe('https://cdn.test/replicate-direct.mp4');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces Replicate submit HTTP errors with the parsed message and status', async () => {
    useVideoFeature('custom-video-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-video-model': ['owner/model异步'] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'bad request' }, 400)));

    await expect(callVideoGenerationApi(
      'fallback-key',
      'bad replicate request',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).rejects.toMatchObject({ message: 'bad request', status: 400 });
    expect(keyManager.handleError).toHaveBeenCalledWith(400, '{"message":"bad request"}');
  });

  it('skips Replicate non-OK poll responses and succeeds on a later poll', async () => {
    useVideoFeature('custom-video-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-video-model': ['owner/model异步'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'replicate-retry-task' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'succeeded', video_url: 'https://cdn.test/replicate-retry.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'retry replicate poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/replicate-retry.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/replicate/v1/predictions',
      'https://api.example.test/replicate/v1/predictions/replicate-retry-task',
      'https://api.example.test/replicate/v1/predictions/replicate-retry-task',
    ]);
  });

  it('surfaces Replicate failed prediction statuses', async () => {
    useVideoFeature('custom-video-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-video-model': ['owner/model异步'] } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'replicate-failed-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', error: 'replicate provider rejected' })));

    const result = callVideoGenerationApi(
      'fallback-key',
      'failed replicate poll',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    const failure = expect(result).rejects.toThrow('replicate provider rejected');
    await vi.runAllTimersAsync();
    await failure;
  });

  it('submits unified Grok requests to metadata-selected paths with top-level aspect and resolution', async () => {
    useVideoFeature('custom-unified-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'custom-unified-model': ['grok视频'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'grok-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', video_url: 'https://cdn.test/grok.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'hero sprints',
      5,
      '2:3',
      [{ url: 'data:image/png;base64,FIRST', role: 'first_frame' }],
      undefined,
      keyManager,
      undefined,
      '720p',
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/grok.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/video/create');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'custom-unified-model',
      prompt: 'hero sprints',
      duration: 5,
      aspect_ratio: '2:3',
      resolution: '720p',
      image: 'data:image/png;base64,FIRST',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/v1/video/query?id=grok-task');
  });

  it('submits unified Luma requests with duration suffix and image-end metadata', async () => {
    useVideoFeature('luma-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'luma-model': ['luma视频生成'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'luma-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', video_url: 'https://cdn.test/luma.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'moon rises',
      5,
      '16:9',
      [
        { url: 'data:image/png;base64,FIRST', role: 'first_frame' },
        { url: 'data:image/png;base64,LAST', role: 'last_frame' },
      ],
      undefined,
      keyManager,
      undefined,
      '720p',
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/luma.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/luma/generations');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'luma-model',
      prompt: 'moon rises',
      duration: '5s',
      image: 'data:image/png;base64,FIRST',
      metadata: {
        aspect_ratio: '16:9',
        resolution: '720p',
        image_end: 'data:image/png;base64,LAST',
      },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/luma/generations/luma-task');
  });

  it('submits unified Runway requests with pixel ratio and no resolution metadata', async () => {
    useVideoFeature('runway-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'runway-model': ['runway图生视频'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'runway-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'succeeded', video_url: 'https://cdn.test/runway.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'camera pans',
      8,
      '16:9',
      [{ url: 'data:image/png;base64,FIRST', role: 'first_frame' }],
      undefined,
      keyManager,
      undefined,
      '1080p',
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/runway.mp4');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/runwayml/v1/image_to_video');
    expect(JSON.parse(String(requestInit(fetchMock, 0).body))).toEqual({
      model: 'runway-model',
      prompt: 'camera pans',
      duration: 8,
      image: 'data:image/png;base64,FIRST',
      metadata: {
        ratio: '1280:720',
      },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/runwayml/v1/tasks/runway-task');
  });

  it('surfaces unified submit HTTP errors with the parsed message and status', async () => {
    useVideoFeature('luma-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'luma-model': ['luma视频生成'] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'bad request' }, 400)));

    await expect(callVideoGenerationApi(
      'fallback-key',
      'moon rises',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    )).rejects.toMatchObject({ message: 'bad request', status: 400 });
    expect(keyManager.handleError).toHaveBeenCalledWith(400, '{"message":"bad request"}');
  });

  it('skips unified non-OK poll responses and succeeds on a later poll', async () => {
    useVideoFeature('luma-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'luma-model': ['luma视频生成'] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'retry-task' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', video_url: 'https://cdn.test/retry.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callVideoGenerationApi(
      'fallback-key',
      'moon rises',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('https://cdn.test/retry.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/luma/generations',
      'https://api.example.test/luma/generations/retry-task',
      'https://api.example.test/luma/generations/retry-task',
    ]);
  });

  it('surfaces unified failed task statuses', async () => {
    useVideoFeature('luma-model', 'https://api.example.test/v1/');
    mocks.getState.mockReturnValue({ modelEndpointTypes: { 'luma-model': ['luma视频生成'] } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'failed-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', error: { message: 'provider rejected' } })));

    const result = callVideoGenerationApi(
      'fallback-key',
      'moon rises',
      5,
      '16:9',
      [],
      undefined,
      keyManager,
    );

    const failure = expect(result).rejects.toThrow('provider rejected');
    await vi.runAllTimersAsync();
    await failure;
  });
});
