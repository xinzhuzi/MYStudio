import { describe, expect, it, vi } from 'vitest';
import type { AIScreenplay, GenerationConfig, WorkerEvent } from '@opencut/ai-core';

import { AIWorkerBridge } from './worker-bridge';

function dispatchWorkerEvent(bridge: AIWorkerBridge, event: WorkerEvent): void {
  const privateBridge = bridge as unknown as {
    handleWorkerMessage(message: MessageEvent<WorkerEvent>): void;
  };
  privateBridge.handleWorkerMessage({ data: event } as MessageEvent<WorkerEvent>);
}

function screenplayFixture(id: string): AIScreenplay {
  return { id, scenes: [] } as unknown as AIScreenplay;
}

describe('AIWorkerBridge event/command contract', () => {
  it('transmits cancel scope exactly, including explicit falsey scene ids only when supplied', () => {
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });

    bridge.cancel();
    bridge.cancel('screenplay-a', 0);

    expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'CANCEL', payload: undefined });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'CANCEL',
      payload: { screenplayId: 'screenplay-a', sceneId: 0 },
    });
  });

  it('forwards known event payload fields without rewriting unknown payload fields', () => {
    const bridge = new AIWorkerBridge();
    const handler = vi.fn();
    bridge.on('SCENE_PROGRESS', handler);
    (bridge as any).handleWorkerMessage({ data: {
      type: 'SCENE_PROGRESS',
      payload: { screenplayId: 'p', sceneId: 2, progress: { stage: 'image', progress: 0.5 }, traceTag: 'opaque', error: '' },
    } });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      screenplayId: 'p', sceneId: 2, traceTag: 'opaque', error: '',
    }));
  });

  it('ignores unknown event types without throwing or invoking registered handlers', () => {
    const bridge = new AIWorkerBridge();
    const handler = vi.fn();
    bridge.on('WORKER_ERROR', handler);

    expect(() => (bridge as any).handleWorkerMessage({ data: { type: 'FUTURE_EVENT', payload: { error: 'opaque' } } })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores late scene events after a newer generation supersedes the active run', async () => {
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });
    const handler = vi.fn();
    bridge.on('SCENE_PROGRESS', handler);

    await bridge.executeScreenplayImages(screenplayFixture('first'), {} as GenerationConfig);
    await bridge.executeScreenplayImages(screenplayFixture('second'), {} as GenerationConfig);

    expect(postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'EXECUTE_SCREENPLAY_IMAGES', runId: 1,
    }));
    expect(postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'EXECUTE_SCREENPLAY_IMAGES', runId: 2,
    }));

    dispatchWorkerEvent(bridge, {
      type: 'SCENE_PROGRESS',
      runId: 1,
      payload: { screenplayId: 'first', sceneId: 1, progress: { sceneId: 1, status: 'generating', stage: 'image', progress: 10 } },
    });
    dispatchWorkerEvent(bridge, {
      type: 'SCENE_PROGRESS',
      runId: 2,
      payload: { screenplayId: 'second', sceneId: 1, progress: { sceneId: 1, status: 'generating', stage: 'image', progress: 10 } },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ screenplayId: 'second' }));
  });

  it('cancels the active run and settles its screenplay promise before late events arrive', async () => {
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });
    const handler = vi.fn();
    bridge.on('SCREENPLAY_READY', handler);

    const pendingScreenplay = bridge.generateScreenplay('draft');
    bridge.cancel();

    await expect(pendingScreenplay).rejects.toThrow('Generation cancelled');
    expect(postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'GENERATE_SCREENPLAY', runId: 1,
    }));
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'CANCEL', runId: 1, payload: undefined,
    });

    dispatchWorkerEvent(bridge, {
      type: 'SCREENPLAY_READY', runId: 1, payload: screenplayFixture('late'),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a late worker error from a cancelled run', async () => {
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });
    const handler = vi.fn();
    bridge.on('WORKER_ERROR', handler);

    await bridge.executeScreenplayImages(screenplayFixture('cancelled'), {} as GenerationConfig);
    bridge.cancel();

    dispatchWorkerEvent(bridge, {
      type: 'WORKER_ERROR',
      runId: 1,
      payload: { message: 'Cancelled', stack: 'late' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts a worker error for the current run after a prior run was superseded', async () => {
    const postMessage = vi.fn();
    const bridge = new AIWorkerBridge();
    Object.assign(bridge, { worker: { postMessage } });
    const handler = vi.fn();
    bridge.on('WORKER_ERROR', handler);

    await bridge.executeScreenplayImages(screenplayFixture('first'), {} as GenerationConfig);
    await bridge.executeScreenplayImages(screenplayFixture('second'), {} as GenerationConfig);

    dispatchWorkerEvent(bridge, {
      type: 'WORKER_ERROR',
      runId: 1,
      payload: { message: 'stale', stack: 'old' },
    });
    dispatchWorkerEvent(bridge, {
      type: 'WORKER_ERROR',
      runId: 2,
      payload: { message: 'current', stack: 'new' },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ message: 'current', stack: 'new' });
  });
});
