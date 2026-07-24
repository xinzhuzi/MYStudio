import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIScene, AIScreenplay, GenerationConfig } from '@opencut/ai-core';
import type { CancelCommand, GenerateScreenplayCommand, WorkerCommand, WorkerEvent } from '@opencut/ai-core/protocol';

interface WorkerSelfStub {
  onmessage?: (event: MessageEvent<WorkerCommand>) => void | Promise<void>;
  postMessage: ReturnType<typeof vi.fn>;
  location: { origin: string };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function screenplayFixture(id: string): AIScreenplay {
  return screenplayWithScenes(id, []);
}

function sceneFixture(sceneId: number, overrides: Partial<AIScene> = {}): AIScene {
  return {
    sceneId,
    narration: `旁白 ${sceneId}`,
    visualContent: `Scene ${sceneId} visual`,
    action: `Scene ${sceneId} action`,
    camera: 'Medium Shot',
    characterDescription: `Character ${sceneId}`,
    status: 'pending',
    ...overrides,
  };
}

function screenplayWithScenes(id: string, scenes: AIScene[]): AIScreenplay {
  return {
    id,
    title: id,
    estimatedDurationSeconds: scenes.length * 5,
    aspectRatio: '16:9',
    orientation: 'landscape',
    characters: [],
    scenes,
    createdAt: 0,
    updatedAt: 0,
  };
}

type TestGenerationConfig = GenerationConfig & {
  apiKey?: string;
  mockImage?: boolean;
  mockVideo?: boolean;
  apiKeys?: { memefast?: string };
  baseUrl?: string;
};

function generationConfigFixture(overrides: Partial<TestGenerationConfig> = {}): TestGenerationConfig {
  return {
    styleTokens: [],
    qualityTokens: [],
    negativePrompt: '',
    aspectRatio: '16:9',
    imageSize: '1K',
    videoSize: '720p',
    sceneCount: 1,
    concurrency: 1,
    imageProvider: 'mock',
    videoProvider: 'mock',
    chatProvider: 'mock',
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateScreenplayCommand(runId: number, prompt: string): GenerateScreenplayCommand {
  const config: Partial<GenerationConfig> & { baseUrl: string; mockMode: boolean } = {
    baseUrl: 'https://api.test',
    mockMode: true,
    sceneCount: 1,
  };
  return {
    type: 'GENERATE_SCREENPLAY',
    runId,
    payload: {
      prompt,
      config,
    },
  };
}

function cancelCommand(runId: number): CancelCommand {
  return { type: 'CANCEL', runId };
}

async function loadWorker(): Promise<WorkerSelfStub> {
  const workerSelf: WorkerSelfStub = {
    postMessage: vi.fn(),
    location: { origin: 'https://worker.test' },
  };
  vi.stubGlobal('self', workerSelf);
  await import('./ai-worker');
  expect(workerSelf.onmessage).toBeTypeOf('function');
  workerSelf.postMessage.mockClear();
  return workerSelf;
}

async function dispatch(workerSelf: WorkerSelfStub, command: WorkerCommand): Promise<void> {
  const handler = workerSelf.onmessage;
  if (!handler) throw new Error('worker onmessage was not installed');
  await handler({ data: command } as MessageEvent<WorkerCommand>);
}

function postedEvents(workerSelf: WorkerSelfStub): WorkerEvent[] {
  return workerSelf.postMessage.mock.calls.map(([event]) => event as WorkerEvent);
}

function eventsOfType<T extends WorkerEvent['type']>(
  workerSelf: WorkerSelfStub,
  type: T,
): Array<Extract<WorkerEvent, { type: T }>> {
  return postedEvents(workerSelf).filter((event): event is Extract<WorkerEvent, { type: T }> => event.type === type);
}

describe('ai worker protocol harness', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('aborts a superseded screenplay run and suppresses its late ready event', async () => {
    const workerSelf = await loadWorker();
    const firstResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(jsonResponse(screenplayFixture('second')));
    vi.stubGlobal('fetch', fetchMock);

    const firstTurn = dispatch(workerSelf, generateScreenplayCommand(1, 'first'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const secondTurn = dispatch(workerSelf, generateScreenplayCommand(2, 'second'));
    await secondTurn;

    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);

    firstResponse.resolve(jsonResponse(screenplayFixture('first')));
    await firstTurn;

    const readyEvents = postedEvents(workerSelf).filter((event) => event.type === 'SCREENPLAY_READY');
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]).toMatchObject({
      type: 'SCREENPLAY_READY',
      runId: 2,
      payload: { id: 'second' },
    });
  });

  it('cancels only the matching screenplay run and suppresses late success/error events', async () => {
    const workerSelf = await loadWorker();
    const pendingResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(pendingResponse.promise);
    vi.stubGlobal('fetch', fetchMock);

    const runTurn = dispatch(workerSelf, generateScreenplayCommand(7, 'cancelled'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await dispatch(workerSelf, { type: 'CANCEL', runId: 6 });
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await dispatch(workerSelf, cancelCommand(7));
    expect(signal.aborted).toBe(true);

    pendingResponse.resolve(jsonResponse(screenplayFixture('cancelled')));
    await runTurn;

    const terminalEvents = postedEvents(workerSelf).filter((event) => (
      event.type === 'SCREENPLAY_READY'
      || event.type === 'SCREENPLAY_ERROR'
      || event.type === 'WORKER_ERROR'
    ));
    expect(terminalEvents).toHaveLength(0);
  });

  it('reports image progress and completion counts through the real screenplay-image command', async () => {
    vi.useFakeTimers();
    const workerSelf = await loadWorker();
    const screenplay = screenplayWithScenes('images', [sceneFixture(1), sceneFixture(2)]);
    const turn = dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY_IMAGES',
      runId: 11,
      payload: {
        screenplay,
        config: generationConfigFixture({ mockImage: true, concurrency: 2 }),
      },
    });

    await vi.runAllTimersAsync();
    await turn;

    const progressEvents = eventsOfType(workerSelf, 'SCENE_PROGRESS');
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 11,
        payload: expect.objectContaining({
          screenplayId: 'images',
          sceneId: 1,
          progress: expect.objectContaining({ stage: 'image', progress: 50 }),
        }),
      }),
      expect.objectContaining({
        runId: 11,
        payload: expect.objectContaining({
          screenplayId: 'images',
          sceneId: 2,
          progress: expect.objectContaining({ stage: 'image', progress: 50 }),
        }),
      }),
    ]));

    expect(eventsOfType(workerSelf, 'SCENE_IMAGE_COMPLETED')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 11,
        payload: {
          screenplayId: 'images',
          sceneId: 1,
          imageUrl: 'https://picsum.photos/seed/1/1280/720',
        },
      }),
      expect.objectContaining({
        runId: 11,
        payload: {
          screenplayId: 'images',
          sceneId: 2,
          imageUrl: 'https://picsum.photos/seed/2/1280/720',
        },
      }),
    ]));

    expect(eventsOfType(workerSelf, 'ALL_IMAGES_COMPLETED')).toEqual([
      expect.objectContaining({
        runId: 11,
        payload: {
          screenplayId: 'images',
          completedCount: 2,
          failedCount: 0,
          totalCount: 2,
        },
      }),
    ]);
  });

  it('suppresses terminal image events when a matching cancel arrives during batch execution', async () => {
    vi.useFakeTimers();
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const screenplay = screenplayWithScenes('cancel-images', [sceneFixture(1), sceneFixture(2)]);
    const turn = dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY_IMAGES',
      runId: 13,
      payload: {
        screenplay,
        config: generationConfigFixture({ mockImage: true, concurrency: 2 }),
      },
    });

    await vi.advanceTimersByTimeAsync(200);
    await dispatch(workerSelf, cancelCommand(13));
    await vi.runAllTimersAsync();
    await turn;

    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Scene 1 image failed:', 'Cancelled');
    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Scene 2 image failed:', 'Cancelled');
    expect(eventsOfType(workerSelf, 'SCENE_IMAGE_COMPLETED')).toHaveLength(0);
    expect(eventsOfType(workerSelf, 'ALL_IMAGES_COMPLETED')).toHaveLength(0);
  });

  it('reports video progress and mixed completion counts through the real screenplay-video command', async () => {
    vi.useFakeTimers();
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const screenplay = screenplayWithScenes('videos', [
      sceneFixture(1, { imageUrl: 'https://cdn.test/scene-1.png' }),
      sceneFixture(2),
    ]);
    const turn = dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY_VIDEOS',
      runId: 12,
      payload: {
        screenplay,
        config: generationConfigFixture({
          mockVideo: true,
          concurrency: 2,
          duration: 7,
          aspectRatio: '9:16',
        }),
      },
    });

    await vi.runAllTimersAsync();
    await turn;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[AI Worker] Scene 2 video failed:',
      'Scene 2 has no image, cannot generate video',
    );
    expect(eventsOfType(workerSelf, 'SCENE_PROGRESS')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 12,
        payload: expect.objectContaining({
          screenplayId: 'videos',
          sceneId: 1,
          progress: expect.objectContaining({ stage: 'video', progress: 100 }),
        }),
      }),
      expect.objectContaining({
        runId: 12,
        payload: expect.objectContaining({
          screenplayId: 'videos',
          sceneId: 1,
          progress: expect.objectContaining({ status: 'completed', stage: 'done', progress: 100 }),
        }),
      }),
    ]));

    const completedEvents = eventsOfType(workerSelf, 'SCENE_COMPLETED');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      runId: 12,
      payload: {
        screenplayId: 'videos',
        sceneId: 1,
        metadata: {
          duration: 7,
          width: 720,
          height: 1280,
          mimeType: 'video/mp4',
        },
      },
    });
    expect(completedEvents[0].payload.mediaBlob).toBeInstanceOf(Blob);

    expect(eventsOfType(workerSelf, 'ALL_SCENES_COMPLETED')).toEqual([
      expect.objectContaining({
        runId: 12,
        payload: {
          screenplayId: 'videos',
          completedCount: 1,
          failedCount: 1,
          totalCount: 2,
        },
      }),
    ]);
  });

  it('responds to ping without assigning a run id', async () => {
    const workerSelf = await loadWorker();
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    await dispatch(workerSelf, { type: 'PING', payload: { timestamp: 99 } });

    expect(postedEvents(workerSelf)).toEqual([
      {
        type: 'PONG',
        payload: {
          timestamp: 99,
          workerTimestamp: 123456,
        },
      },
    ]);
  });

  it('posts screenplay ready with the exact API request payload', async () => {
    const workerSelf = await loadWorker();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(screenplayFixture('ready')));
    vi.stubGlobal('fetch', fetchMock);

    await dispatch(workerSelf, generateScreenplayCommand(21, 'screenplay prompt'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/ai/screenplay',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      prompt: 'screenplay prompt',
      sceneCount: 1,
      aspectRatio: '9:16',
      apiKey: '',
      provider: 'memefast',
      mockMode: true,
    });
    expect(eventsOfType(workerSelf, 'SCREENPLAY_READY')).toEqual([
      expect.objectContaining({
        runId: 21,
        payload: expect.objectContaining({ id: 'ready' }),
      }),
    ]);
  });

  it('reports screenplay API errors without leaking a worker error event', async () => {
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'provider boom' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })));

    await dispatch(workerSelf, generateScreenplayCommand(22, 'bad screenplay'));

    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Screenplay API error:', 500, { message: 'provider boom' });
    expect(eventsOfType(workerSelf, 'SCREENPLAY_ERROR')).toEqual([
      expect.objectContaining({
        runId: 22,
        payload: expect.objectContaining({ error: 'provider boom' }),
      }),
    ]);
    expect(eventsOfType(workerSelf, 'WORKER_ERROR')).toHaveLength(0);
  });

  it('reports every image scene failed when the image API key is missing', async () => {
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const screenplay = screenplayWithScenes('missing-image-key', [sceneFixture(1), sceneFixture(2)]);

    await dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY_IMAGES',
      runId: 23,
      payload: {
        screenplay,
        config: generationConfigFixture({ mockImage: false, apiKeys: {} }),
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Image API Key not configured');
    expect(eventsOfType(workerSelf, 'ALL_IMAGES_COMPLETED')).toEqual([
      expect.objectContaining({
        runId: 23,
        payload: {
          screenplayId: 'missing-image-key',
          completedCount: 0,
          failedCount: 2,
          totalCount: 2,
          error: '未配置图片生成 API Key，请在服务映射中配置',
        },
      }),
    ]);
    expect(eventsOfType(workerSelf, 'SCENE_FAILED')).toEqual([
      expect.objectContaining({
        runId: 23,
        payload: {
          screenplayId: 'missing-image-key',
          sceneId: 1,
          error: '未配置图片生成 API Key',
          retryable: false,
        },
      }),
      expect.objectContaining({
        runId: 23,
        payload: {
          screenplayId: 'missing-image-key',
          sceneId: 2,
          error: '未配置图片生成 API Key',
          retryable: false,
        },
      }),
    ]);
  });

  it('suppresses terminal video events when a matching cancel arrives during batch execution', async () => {
    vi.useFakeTimers();
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const screenplay = screenplayWithScenes('cancel-videos', [
      sceneFixture(1, { imageUrl: 'https://cdn.test/scene-1.png' }),
      sceneFixture(2, { imageUrl: 'https://cdn.test/scene-2.png' }),
    ]);
    const turn = dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY_VIDEOS',
      runId: 24,
      payload: {
        screenplay,
        config: generationConfigFixture({ mockVideo: true, concurrency: 2 }),
      },
    });

    await vi.advanceTimersByTimeAsync(200);
    await dispatch(workerSelf, cancelCommand(24));
    await vi.runAllTimersAsync();
    await turn;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Scene 1 video failed:', 'Cancelled');
    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Scene 2 video failed:', 'Cancelled');
    expect(eventsOfType(workerSelf, 'SCENE_COMPLETED')).toHaveLength(0);
    expect(eventsOfType(workerSelf, 'ALL_SCENES_COMPLETED')).toHaveLength(0);
  });

  it('executes a single scene through image, video, and blob API calls', async () => {
    const workerSelf = await loadWorker();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', imageUrl: 'https://cdn.test/scene.png' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', videoUrl: 'https://cdn.test/scene.mp4' }))
      .mockResolvedValueOnce(new Response('video-bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await dispatch(workerSelf, {
      type: 'EXECUTE_SCENE',
      runId: 25,
      payload: {
        screenplayId: 'single-scene',
        scene: sceneFixture(5),
        config: generationConfigFixture({
          apiKey: 'key',
          imageProvider: 'memefast',
          videoProvider: 'memefast',
          duration: 8,
          aspectRatio: '9:16',
        }),
        characterReferenceImages: ['data:image/png;base64,REF'],
      },
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.test/api/ai/image',
      'https://worker.test/api/ai/video',
      'https://cdn.test/scene.mp4',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      apiKey: 'key',
      provider: 'memefast',
      referenceImages: ['data:image/png;base64,REF'],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({
      imageUrl: 'https://cdn.test/scene.png',
      apiKey: 'key',
      provider: 'memefast',
      duration: 8,
      referenceImages: ['data:image/png;base64,REF'],
    });
    expect(eventsOfType(workerSelf, 'SCENE_PROGRESS')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 25,
        payload: expect.objectContaining({
          screenplayId: 'single-scene',
          sceneId: 5,
          progress: expect.objectContaining({ stage: 'image', progress: 0 }),
        }),
      }),
      expect.objectContaining({
        runId: 25,
        payload: expect.objectContaining({
          screenplayId: 'single-scene',
          sceneId: 5,
          progress: expect.objectContaining({ stage: 'video', progress: 50 }),
        }),
      }),
      expect.objectContaining({
        runId: 25,
        payload: expect.objectContaining({
          screenplayId: 'single-scene',
          sceneId: 5,
          progress: expect.objectContaining({ status: 'completed', stage: 'done', progress: 100 }),
        }),
      }),
    ]));
    const completedEvents = eventsOfType(workerSelf, 'SCENE_COMPLETED');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      runId: 25,
      payload: {
        screenplayId: 'single-scene',
        sceneId: 5,
        metadata: {
          duration: 8,
          width: 720,
          height: 1280,
          mimeType: 'video/mp4',
        },
      },
    });
    expect(completedEvents[0].payload.mediaBlob).toBeInstanceOf(Blob);
  });

  it('suppresses terminal full-flow screenplay events after cancellation', async () => {
    vi.useFakeTimers();
    const workerSelf = await loadWorker();
    const screenplay = screenplayWithScenes('cancel-full', [sceneFixture(1), sceneFixture(2)]);
    const turn = dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY',
      runId: 26,
      payload: {
        screenplay,
        config: generationConfigFixture({
          mockImage: true,
          mockVideo: true,
          concurrency: 1,
        }),
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await dispatch(workerSelf, cancelCommand(26));
    await vi.runAllTimersAsync();
    await turn;

    expect(eventsOfType(workerSelf, 'SCENE_COMPLETED')).toHaveLength(0);
    expect(eventsOfType(workerSelf, 'ALL_SCENES_COMPLETED')).toHaveLength(0);
    expect(eventsOfType(workerSelf, 'SCENE_FAILED')).toHaveLength(0);
    expect(eventsOfType(workerSelf, 'WORKER_ERROR')).toHaveLength(0);
  });

  it('reports non-mock screenplay image failures as retryable scene failures', async () => {
    const workerSelf = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const screenplay = screenplayWithScenes('non-mock-failure', [sceneFixture(1)]);

    await dispatch(workerSelf, {
      type: 'EXECUTE_SCREENPLAY',
      runId: 27,
      payload: {
        screenplay,
        config: generationConfigFixture({
          apiKeys: { memefast: 'key' },
          baseUrl: 'https://api.test',
          mockImage: false,
          mockVideo: false,
          concurrency: 1,
        }),
      },
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://api.test/api/ai/image']);
    expect(consoleError).toHaveBeenCalledWith('[AI Worker] Scene 1 failed:', 'network down');
    expect(eventsOfType(workerSelf, 'SCENE_FAILED')).toEqual([
      expect.objectContaining({
        runId: 27,
        payload: {
          screenplayId: 'non-mock-failure',
          sceneId: 1,
          error: 'network down',
          retryable: true,
        },
      }),
    ]);
    expect(eventsOfType(workerSelf, 'ALL_SCENES_COMPLETED')).toEqual([
      expect.objectContaining({
        runId: 27,
        payload: {
          screenplayId: 'non-mock-failure',
          completedCount: 0,
          failedCount: 1,
          totalCount: 1,
        },
      }),
    ]);
  });
});
