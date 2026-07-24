import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFeatureConfig: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@/lib/ai/feature-router', () => ({ getFeatureConfig: mocks.getFeatureConfig }));
vi.mock('@/stores/api-config-store', () => ({ useAPIConfigStore: { getState: mocks.getState } }));
vi.mock('@/lib/image-host', () => ({ isImageHostConfigured: () => false, uploadToImageHost: vi.fn() }));
vi.mock('@/lib/image-storage', () => ({ saveVideoToLocal: vi.fn() }));

import { callJuxinVideoGenerationApi, isContentModerationError } from './video-generator';

type JuxinKeyManager = NonNullable<Parameters<typeof callJuxinVideoGenerationApi>[5]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): RequestInit & {
  headers: Record<string, string>;
  body?: string;
} {
  return fetchMock.mock.calls[callIndex][1] as RequestInit & {
    headers: Record<string, string>;
    body?: string;
  };
}

function keyManager(overrides: Partial<JuxinKeyManager> = {}): JuxinKeyManager {
  return {
    getCurrentKey: () => 'rotated-key',
    handleError: vi.fn(() => false),
    getAvailableKeyCount: () => 1,
    getTotalKeyCount: () => 1,
    ...overrides,
  };
}

describe('Juxin/Grok video API boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getFeatureConfig.mockReturnValue(null);
    mocks.getState.mockReturnValue({ modelEndpointTypes: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('submits the Grok request body and polls the task with the supplied signal', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const manager = keyManager();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', video_url: 'https://cdn.test/video.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callJuxinVideoGenerationApi(
      'fallback-key',
      'hero walks',
      '9:16',
      [
        { url: 'https://cdn.test/first.png', role: 'first_frame' },
        { url: 'https://cdn.test/last.png', role: 'last_frame' },
      ],
      onProgress,
      manager,
      'https://api.example.com/',
      'grok-video',
      controller.signal,
    )).resolves.toBe('https://cdn.test/video.mp4');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/video/create');
    expect(requestInit(fetchMock, 0).headers.Authorization).toBe('Bearer rotated-key');
    expect(JSON.parse(requestInit(fetchMock, 0).body ?? '{}')).toEqual({
      model: 'grok-video',
      prompt: 'hero walks',
      aspect_ratio: '2:3',
      size: '720P',
      images: ['https://cdn.test/first.png'],
    });

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/v1/video/query?id=task-1');
    expect(requestInit(fetchMock, 1).signal).toBe(controller.signal);
    expect(onProgress).toHaveBeenCalledWith(20);
  });

  it('surfaces missing task ids, 404 polling, and failed task statuses', async () => {
    const manager = keyManager();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({})));
    await expect(callJuxinVideoGenerationApi(
      'key',
      'prompt',
      '1:1',
      [],
      undefined,
      manager,
      'https://api.example.com',
      'grok-video',
    )).rejects.toThrow('Grok API 返回空的任务 ID');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'missing-task' }))
      .mockResolvedValueOnce(textResponse('not found', 404)));
    await expect(callJuxinVideoGenerationApi(
      'key',
      'prompt',
      '1:1',
      [],
      undefined,
      manager,
      'https://api.example.com',
      'grok-video',
    )).rejects.toThrow('任务不存在');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'failed-task' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', error_message: 'blocked by provider' })));
    await expect(callJuxinVideoGenerationApi(
      'key',
      'prompt',
      '1:1',
      [],
      undefined,
      manager,
      'https://api.example.com',
      'grok-video',
    )).rejects.toThrow('blocked by provider');
  });

  it('honors polling cancellation while a task remains pending', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-pending' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'processing' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = expect(callJuxinVideoGenerationApi(
      'key',
      'prompt',
      '16:9',
      [],
      undefined,
      keyManager(),
      'https://api.example.com',
      'grok-video',
      controller.signal,
    )).rejects.toThrow('用户已取消');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await pending;
  });

  it('retries submit rate limits with the key manager current key', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let currentKey = 'first-key';
    const manager = keyManager({
      getCurrentKey: vi.fn(() => currentKey),
      handleError: vi.fn(() => {
        currentKey = 'second-key';
        return true;
      }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(textResponse('{"message":"rate limited"}', 429))
      .mockResolvedValueOnce(jsonResponse({ id: 'task-retry' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'success', url: 'https://cdn.test/retry.mp4' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callJuxinVideoGenerationApi(
      'fallback-key',
      'prompt',
      '16:9',
      [],
      undefined,
      manager,
      'https://api.example.com',
      'grok-video',
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toBe('https://cdn.test/retry.mp4');

    expect(manager.handleError).toHaveBeenCalledWith(429, '{"message":"rate limited"}');
    expect(consoleError).toHaveBeenCalledWith('[VideoGen] Grok video error:', 429, '{"message":"rate limited"}');
    expect(consoleWarn).toHaveBeenCalledWith('[VideoGen][Grok] Retryable error, retrying in 3000ms... (Attempt 1/3)');
    expect(requestInit(fetchMock, 0).headers.Authorization).toBe('Bearer first-key');
    expect(requestInit(fetchMock, 1).headers.Authorization).toBe('Bearer second-key');
  });
});

describe('video content moderation classifier', () => {
  it('detects English and Chinese moderation failures from strings and errors', () => {
    expect(isContentModerationError('request refused by policy')).toBe(true);
    expect(isContentModerationError(new Error('内容审核：画面敏感'))).toBe(true);
    expect(isContentModerationError('provider returned NOT_ALLOWED')).toBe(true);
  });

  it('does not classify unrelated values as moderation failures', () => {
    expect(isContentModerationError('network timeout')).toBe(false);
    expect(isContentModerationError({ message: 'plain object is not an Error' })).toBe(false);
    expect(isContentModerationError(null)).toBe(false);
  });
});
