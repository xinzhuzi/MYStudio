import type { WorkerEvent } from '@opencut/ai-core/protocol';
import type { WorkerRun } from './worker-run-lifecycle';

type PostWorkerEvent = (event: WorkerEvent, run?: WorkerRun) => void;

export function createWorkerSceneEventReporter(postEvent: PostWorkerEvent) {
  const reportSceneProgress = (
    run: WorkerRun,
    screenplayId: string,
    sceneId: number,
    status: 'pending' | 'generating' | 'completed' | 'failed',
    stage: 'idle' | 'image' | 'video' | 'audio' | 'done',
    progress: number,
  ): void => {
    postEvent({
      type: 'SCENE_PROGRESS',
      payload: {
        screenplayId,
        sceneId,
        progress: {
          sceneId,
          status,
          stage,
          progress,
        },
      },
    }, run);
  };

  const reportSceneFailed = (
    run: WorkerRun,
    screenplayId: string,
    sceneId: number,
    error: string,
    retryable: boolean,
  ): void => {
    postEvent({
      type: 'SCENE_FAILED',
      payload: {
        screenplayId,
        sceneId,
        error,
        retryable,
      },
    }, run);
  };

  return { reportSceneProgress, reportSceneFailed };
}
