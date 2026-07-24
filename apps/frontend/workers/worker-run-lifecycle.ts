export interface WorkerRun {
  readonly id: number;
  readonly controller: AbortController;
}

export interface WorkerRunLifecycle {
  begin(requestedRunId?: number): WorkerRun;
  cancel(runId?: number): void;
  isCurrent(run: WorkerRun): boolean;
}

export function createWorkerRunLifecycle(): WorkerRunLifecycle {
  let nextRunId = 0;
  let activeRun: WorkerRun | null = null;

  return {
    begin(requestedRunId) {
      activeRun?.controller.abort();
      const id = requestedRunId ?? ++nextRunId;
      nextRunId = Math.max(nextRunId, id);
      activeRun = { id, controller: new AbortController() };
      return activeRun;
    },
    cancel(runId) {
      if (!activeRun || (runId !== undefined && activeRun.id !== runId)) return;
      activeRun.controller.abort();
    },
    isCurrent(run) {
      return activeRun === run && !run.controller.signal.aborted;
    },
  };
}
